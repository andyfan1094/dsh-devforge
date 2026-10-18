/**
 * 截图识别与翻译的模型通道 —— 直接走 DSH 自己的模型服务。
 *
 * 为什么这么设计（2026-10-18 辉哥明确要求）：
 * 面板里已经配好的模型（天工造梦 / MiniMax / 智谱 / 方舟 / 中转站…）本来就够用，
 * 再让用户单独填一套"视觉模型 Key + 地址"是重复配置。这里改为：
 * 1) 用 `ctx.attachments.saveImage` 把截图登记为 DSH 附件；
 * 2) 用 `ctx.llm.stream` 走当前默认模型（provider/model 取自 agentDefaultModel）；
 * 3) 收集 text-delta 拼成结果。
 * 好处：跟随面板里已配置的模型与凭据，用户零额外配置，也不需要插件自己解析 Key。
 */
import type { Context } from '@deepseek-ai/cordis'
import type { WinSnipTranslateTarget } from './protocol.ts'

/** 识别/翻译的处理结果。 */
export interface WinSnipVisionResult {
  /** 图中原始文字。 */
  text: string
  /** 译文（仅翻译时给出）。 */
  translation?: string
}

/** 模型选择（provider + model），跟随 DSH 当前默认模型。 */
export interface WinSnipModelTarget {
  provider: string
  model: string
}

/** 单次模型调用超时（毫秒）。 */
const TIMEOUT_MS = 120000

/** 目标语言的提示词描述。 */
function describeTarget(target: WinSnipTranslateTarget): string {
  if (target === 'zh') return '简体中文'
  if (target === 'en') return '英文'
  return '中文或英文（若图中是中文则译成英文，若图中是英文则译成中文）'
}

/** 识别提示词：只要文字本身，避免模型加解释。 */
const OCR_PROMPT = '请识别这张截图中的全部文字，保持原有换行与阅读顺序。只输出文字本身，不要解释、不要加任何前后缀。'

/** 翻译提示词：一次返回原文与译文，便于结果窗左右对照。 */
function translatePrompt(target: WinSnipTranslateTarget): string {
  return '请先识别这张截图中的全部文字，再把它翻译成'
    + describeTarget(target)
    + '。严格只输出一个 JSON 对象，形如 {"text":"原文","translation":"译文"}，不要输出代码块标记或任何解释。'
}

/** 去掉模型可能加的 ```json 围栏。 */
function stripFence(raw: string): string {
  const trimmed = raw.trim()
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed)
  return fenced === null ? trimmed : fenced[1]
}

/** 从模型输出里取出 { text, translation }；解析失败时把整段当译文。 */
export function parseTranslateOutput(raw: string): WinSnipVisionResult {
  const body = stripFence(raw)
  try {
    const parsed = JSON.parse(body) as { text?: unknown; translation?: unknown }
    const text = typeof parsed.text === 'string' ? parsed.text.trim() : ''
    const translation = typeof parsed.translation === 'string' ? parsed.translation.trim() : ''
    if (translation !== '') return { text, translation }
  } catch {
    // 落到下面的兜底：模型没按 JSON 返回时，整段视作译文。
  }
  return { text: '', translation: body }
}

/** 附件服务最小形状（只用到登记图片）。 */
interface AttachmentsLike {
  saveImage: (input: { data: Uint8Array; mediaType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'; name?: string }) => Promise<unknown>
}

/** 模型服务最小形状（只用到流式调用）。 */
interface LlmLike {
  stream: (options: {
    provider: string
    model: string
    messages: Array<{ role: 'user'; content: Array<Record<string, unknown>> }>
    temperature?: number
    signal?: AbortSignal
  }) => AsyncIterable<{ type: string; text?: string; reason?: { kind?: string; failure?: { message?: string } } }>
}

/** 默认模型服务最小形状。 */
interface AgentDefaultModelLike {
  currentSelection: () => unknown
}

/** 从任意形状的"当前模型选择"里读 provider 与 model。 */
export function readModelTarget(selection: unknown): WinSnipModelTarget | undefined {
  if (selection === null || typeof selection !== 'object') return undefined
  const record = selection as Record<string, unknown>
  const provider = record['provider']
  const model = record['model']
  if (typeof provider === 'string' && provider !== '' && typeof model === 'string' && model !== '') {
    return { provider, model }
  }
  return undefined
}

/**
 * 截图识别/翻译：直接走 DSH 的模型服务，不额外要求任何 Key 配置。
 */
export class WinSnipVision {
  private readonly ctx: Context

  constructor(ctx: Context) {
    this.ctx = ctx
  }

  /** 解析当前应使用的 provider/model：默认模型优先，其次取第一个可用 provider 的首个模型。 */
  private async pickTarget(): Promise<{ target: WinSnipModelTarget; llm: LlmLike }> {
    const llm = this.ctx.get('llm') as LlmLike | undefined
    if (llm?.stream === undefined) throw new Error('DSH 模型服务不可用，无法做识别与翻译。')

    const selector = this.ctx.get('agentDefaultModel') as AgentDefaultModelLike | undefined
    const configured = readModelTarget(selector?.currentSelection())
    if (configured !== undefined) return { target: configured, llm }

    // 兜底：当前会话没有显式默认模型时，用第一个已注册 provider 的首个模型。
    const registry = this.ctx.get('llm') as unknown as {
      listProviders?: () => Array<{ id: string }>
      listModels?: (provider: string) => Promise<Array<{ id: string }>>
    }
    for (const provider of registry.listProviders?.() ?? []) {
      const models = await registry.listModels?.(provider.id).catch(() => []) ?? []
      const first = models[0]
      if (first !== undefined) return { target: { provider: provider.id, model: first.id }, llm }
    }
    throw new Error('还没有可用的模型：请先在设置里配置一个模型提供方。')
  }

  /**
   * 执行一次识别或翻译。
   *
   * @param request 处理类型、图片字节与目标语言。
   * @throws Error 中文错误信息（已脱敏），由调用方写回响应文件。
   */
  async run(request: { kind: 'ocr' | 'translate'; imageBytes: Uint8Array; targetLang?: WinSnipTranslateTarget }): Promise<WinSnipVisionResult> {
    const attachments = this.ctx.get('attachments') as AttachmentsLike | undefined
    if (attachments?.saveImage === undefined) throw new Error('DSH 附件服务不可用，无法把截图交给模型。')
    const { target, llm } = await this.pickTarget()

    const ref = await attachments.saveImage({ data: request.imageBytes, mediaType: 'image/png', name: 'win-snip.png' })
    const prompt = request.kind === 'ocr' ? OCR_PROMPT : translatePrompt(request.targetLang ?? 'auto')

    const controller = new AbortController()
    const timer = setTimeout(() => { controller.abort() }, TIMEOUT_MS)
    let raw = ''
    try {
      const stream = llm.stream({
        provider: target.provider,
        model: target.model,
        temperature: 0,
        signal: controller.signal,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image', attachment: ref },
          ],
        }],
      })
      for await (const chunk of stream) {
        if (chunk.type === 'text-delta' && typeof chunk.text === 'string') raw += chunk.text
        if (chunk.type === 'finish') {
          const failure = chunk.reason?.failure
          if (failure !== undefined) throw new Error('模型调用失败：' + (failure.message ?? '未知原因'))
        }
      }
    } finally {
      clearTimeout(timer)
    }
    if (raw.trim() === '') throw new Error('模型没有返回任何内容。')
    return request.kind === 'ocr' ? { text: raw.trim() } : parseTranslateOutput(raw)
  }
}
