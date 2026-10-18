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

/** 识别提示词：只要文字本身，并且必须还原截图里的排版。 */
const OCR_PROMPT = [
  '请把这张截图里的文字原样抄写出来，要求还原截图的排版：',
  '1. 严格保持原有的换行、空行与段落顺序，一行对一行，不要把多行合并成一段；',
  '2. 保持原有的缩进层级、项目符号与编号（如 -、•、1.、(a)），缩进用半角空格表示；',
  '3. 如果截图里有表格或多列对齐的内容，用半角空格补齐各列使其对齐：',
  '   一个汉字占两个半角空格的位置，同一列的文字起始位置要上下对齐；',
  '4. 不要翻译、不要改写、不要补全、不要添加解释、不要用 Markdown 装饰（如 **、#、反引号、表格竖线），除非原图本身就有这些符号；',
  '5. 看不清的字用「□」代替，不要凭猜测编造内容。',
  '只输出抄写结果本身。',
].join('\n')

/** 翻译提示词：一次返回原文与译文，便于结果窗左右对照。 */
function translatePrompt(target: WinSnipTranslateTarget): string {
  return [
    '请先识别这张截图中的全部文字，再把它翻译成' + describeTarget(target) + '。',
    '识别结果要还原截图的排版：保持原有换行、空行、缩进层级、项目符号与表格列对齐，一行对一行，不要合并段落；缩进用半角空格，一个汉字按两个半角空格计。',
    '译文同样保持原文的行结构，逐行对应，便于左右对照。',
    '严格只输出一个 JSON 对象，形如 {"text":"原文","translation":"译文"}；',
    '两个字段内部用 \\n 表示换行；不要输出代码块标记或任何解释。',
  ].join('\n')
}

/** 去掉模型可能加的 ```json 围栏。 */
function stripFence(raw: string): string {
  const trimmed = raw.trim()
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed)
  return fenced === null ? trimmed : fenced[1]
}

/**
 * 归一化模型输出的排版字符，让"按截图排版"在等宽显示里真的成立。
 *
 * 起因：模型常混用全角空格、制表符、不换行空格，这些在等宽字体里的宽度
 * 与半角空格不一致（全角空格恰好等于一个汉字宽），会让原本对齐的列错位。
 * 这里统一成半角空格与普通换行，并去掉行尾多余空白（行尾空格不影响对齐，
 * 留着只会让复制出去的文本变脏）。
 *
 * @param raw 模型原始输出。
 * @returns 归一化后的文本，行数不变。
 */
export function normalizeLayout(raw: string): string {
  const lines = raw
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, '    ')
    .replace(/\u00a0/g, ' ')
    // 全角空格换算成两个半角空格：一个全角字宽 = 两个半角字宽。
    .replace(/\u3000/g, '  ')
    .split('\n')
    .map((line) => line.replace(/[ ]+$/, ''))
  // 只去掉整段首尾的空行，不用 trim()：那会把首行的缩进一起吃掉，
  // 而缩进本身就是"按截图排版"的一部分。
  while (lines.length > 0 && lines[0] === '') lines.shift()
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  return lines.join('\n').replace(/\n{3,}/g, '\n\n')
}

/** 从模型输出里取出 { text, translation }；解析失败时把整段当译文。 */
export function parseTranslateOutput(raw: string): WinSnipVisionResult {
  const body = stripFence(raw)
  try {
    const parsed = JSON.parse(body) as { text?: unknown; translation?: unknown }
    // 排版相关字符在原文与译文里都要归一化，否则两侧列宽对不上。
    const text = typeof parsed.text === 'string' ? normalizeLayout(parsed.text) : ''
    const translation = typeof parsed.translation === 'string' ? normalizeLayout(parsed.translation) : ''
    if (translation !== '') return { text, translation }
  } catch {
    // 落到下面的兜底：模型没按 JSON 返回时，整段视作译文。
  }
  return { text: '', translation: normalizeLayout(body) }
}

/** 附件服务最小形状（只用到登记图片）。 */
interface AttachmentsLike {
  saveImage: (input: { data: Uint8Array; mediaType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'; name?: string }) => Promise<unknown>
}

/** 模型条目最小形状（只关心 id 与是否支持图片输入）。 */
interface LlmModelInfoLike {
  id: string
  name?: string
  /** 缺省表示能力未知；只要显式包含 image 才当作能看图。 */
  inputModalities?: readonly string[]
}

/** 模型服务最小形状（流式调用 + 模型清单）。 */
interface LlmServiceLike {
  listProviders?: () => Array<{ id: string }>
  listModels?: (provider: string) => Promise<readonly LlmModelInfoLike[]>
  stream: (options: {
    provider: string
    model: string
    /** DSH 的 Message 必须带 id/role/content/source 四件套。 */
    messages: Array<{
      id: string
      role: 'user'
      content: Array<Record<string, unknown>>
      source: { kind: 'user' }
    }>
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

  /**
   * 挑选要用的模型。
   *
   * 顺序：面板当前默认模型（且支持图片输入）→ 任一支持图片输入的模型 →
   * 任一有模型的 provider（交给模型自己报错，错误信息会显示在结果窗里）。
   * 关键是按 inputModalities 判断，不能只看"provider 有模型"，
   * 否则会把纯文本模型塞进图片请求，用户只会看到一句看不懂的失败。
   */
  private async pickTarget(): Promise<{ target: WinSnipModelTarget; llm: LlmServiceLike }> {
    const llm = this.ctx.get('llm') as LlmServiceLike | undefined
    if (llm?.stream === undefined) throw new Error('DSH 模型服务不可用，无法做识别与翻译。')

    const selector = this.ctx.get('agentDefaultModel') as AgentDefaultModelLike | undefined
    const configured = readModelTarget(selector?.currentSelection())

    const providers = llm.listProviders?.() ?? []
    const supportsImage = (info: { inputModalities?: readonly string[] }): boolean =>
      info.inputModalities?.includes('image') === true

    const modelInfo = async (provider: string): Promise<readonly LlmModelInfoLike[]> => {
      try { return await llm.listModels?.(provider) ?? [] } catch { return [] }
    }

    // 1) 默认模型能看图就优先用它 —— 与用户在面板里选的模型一致，最不容易意外。
    if (configured !== undefined) {
      const models = await modelInfo(configured.provider)
      const hit = models.find((item) => item.id === configured.model)
      if (hit === undefined || supportsImage(hit)) return { target: configured, llm }
    }

    // 2) 默认模型看不了图：换同provider内第一个能看图的模型，再换其它 provider。
    let fallback: WinSnipModelTarget | undefined
    for (const provider of providers) {
      for (const item of await modelInfo(provider.id)) {
        if (supportsImage(item)) return { target: { provider: provider.id, model: item.id }, llm }
        fallback ??= { provider: provider.id, model: item.id }
      }
    }
    if (fallback !== undefined) return { target: fallback, llm }
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
          // DSH 的 Message 是四件套（id/role/content/source），少一个都会被适配器拒掉。
          id: 'win-snip-' + request.kind + '-' + Date.now().toString(36),
          role: 'user',
          source: { kind: 'user' },
          content: [
            { type: 'text', text: prompt },
            { type: 'image', attachment: ref },
          ],
        }],
      })
      for await (const chunk of stream) {
        if (chunk.type === 'text-delta' && typeof chunk.text === 'string') raw += chunk.text
        if (chunk.type === 'finish') {
          // FinishReason 是判别联合：只有 aborted / error 两种带 failure。
          const reason = chunk.reason as { kind?: string; failure?: { message?: string } } | undefined
          if (reason?.kind === 'error' || reason?.kind === 'aborted') {
            throw new Error('模型调用失败：' + (reason.failure?.message ?? reason.kind))
          }
        }
      }
    } finally {
      clearTimeout(timer)
    }
    if (raw.trim() === '') throw new Error('模型没有返回任何内容。')
    // 识别结果同样要归一化排版字符，否则全角空格/制表符会让列对不齐。
    return request.kind === 'ocr' ? { text: normalizeLayout(raw) } : parseTranslateOutput(raw)
  }
}
