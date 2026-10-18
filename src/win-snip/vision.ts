/**
 * 截图识别与翻译的模型通道 —— 直接走 DSH 自己的模型服务。
 *
 * 为什么这么设计（2026-10-18 辉哥明确要求）：
 * 面板里已配好的模型（天工造梦 / MiniMax / 智谱 / 方舟 / 中转站…）本来就够用，
 * 再让用户单独填一套"视觉模型 Key + 地址"是重复配置。这里：
 * 1) 用 `ctx.attachments.saveImage` 把截图登记为 DSH 附件；
 * 2) 用 `ctx.llm.stream` 走插件里已配置的模型；
 * 3) 收集 text-delta 拼成结果。
 *
 * 速度与排版的两条硬经验（2026-10-18 逐模型实测，同一张 900×426 中文表格图）：
 * - 模型差异是数量级的：GLM-Flash 4.2s、gpt-6.1-sol 4.5s、Kimi-K3 10.9s、
 *   gpt-5.6-sol 11.6s、gpt-5.6-terra 34.7s；DeepSeek V4.1 Flash 直接返回空（看不了图）。
 *   所以默认按"快且能看图"的偏好挑，而不是撞上哪个用哪个。
 * - 让模型自己数空格对齐，列会错（少一个多一个），还常混全角空格；
 *   改成让模型只输出结构化行列（layout.ts 负责按显示宽度补齐），列必然对齐。
 */
import type { Context } from '@deepseek-ai/cordis'
import type { WinSnipTranslateTarget } from './protocol.ts'
import { parseLayoutDocument, renderLayout } from './layout.ts'

/** 识别/翻译的处理结果。 */
export interface WinSnipVisionResult {
  /** 图中原始文字（已按等宽排版渲染）。 */
  text: string
  /** 译文（仅翻译时给出）。 */
  translation?: string
  /** 实际使用的模型名，用于结果窗标注与排查。 */
  model?: string
  /** 模型耗时（毫秒）。 */
  elapsedMs?: number
}

/** 模型选择（provider + model）。 */
export interface WinSnipModelTarget {
  provider: string
  model: string
}

/** 单次模型调用超时（毫秒）。 */
const TIMEOUT_MS = 120000

/**
 * 快模型偏好：按名称排优先级。
 *
 * 本机实测只有 flash 级模型能在 4~5 秒内出结果，重的推理模型要 10~35 秒，
 * 截图识别这种"看一眼抄下来"的活没必要上重模型。
 * 顺序即优先级；没命中的模型排在最后（仍可用，但只有在用户显式指定时才会选）。
 */
const FAST_MODEL_HINTS: readonly string[] = [
  'glm-flash',
  'flash',
  'gpt-6.1',
  'gpt-6-astra',
  'sol',
  'mini',
  'fast',
  'turbo',
]

/**
 * 明确看不了图的模型：实测返回空内容。
 * 只有用户显式指定时才尝试，自动选择时跳过，避免"识别成功但一片空白"。
 */
const NO_VISION_HINTS: readonly string[] = ['deepseek']

/** 目标语言的提示词描述。 */
function describeTarget(target: WinSnipTranslateTarget): string {
  if (target === 'zh') return '简体中文'
  if (target === 'en') return '英文'
  return '中文或英文（若图中是中文则译成英文，若图中是英文则译成中文）'
}

/**
 * 识别提示词：只让模型"认字 + 分格"，对齐交给渲染层。
 *
 * 关键是禁止模型自己用空格对齐——实测那样会出现某几行多一个空格、
 * 以及全角空格混用，列宽稳不住。
 */
const OCR_PROMPT = [
  '请识别这张截图里的文字，按下面的 JSON 结构输出，不要输出任何其它内容：',
  '{"lines":[',
  '  {"type":"text","text":"普通一行文字","indent":0},',
  '  {"type":"table","rows":[["列1","列2"],["值1","值2"]]},',
  '  {"type":"list","marker":"•","indent":0,"text":"列表条目"}',
  ']}',
  '要求：',
  '1. 按从上到下的阅读顺序排列，一行文字一个对象，不要把多行合并；',
  '2. 表格用 type=table，每个单元格一个字符串，绝对不要自己用空格对齐或加竖线；',
  '3. 缩进层级用 indent 表示（0 为顶格，每层 +1）；',
  '4. 列表项的符号放 marker（如 -、•、1.）；',
  '5. 不要翻译、不要改写、不要补全、不要解释；',
  '6. 看不清的字用「□」，不要编造；空行不用输出。',
  '只输出 JSON，不要代码块标记。',
].join('\n')

/** 翻译提示词：一次返回原文与译文，结构同上，便于渲染与左右对照。 */
function translatePrompt(target: WinSnipTranslateTarget): string {
  return [
    '请先识别这张截图中的全部文字，再翻译成' + describeTarget(target) + '。',
    '严格只输出一个 JSON 对象，不要代码块标记、不要解释：',
    '{"text":{"lines":[...]},"translation":{"lines":[...]}}',
    '其中 lines 的结构与下面一致：',
    '{"type":"text","text":"一行文字","indent":0} / {"type":"table","rows":[["列1","列2"]]} / {"type":"list","marker":"•","indent":0,"text":"条目"}',
    '要求：text 与 translation 两个 lines 的条目数量与顺序一一对应；',
    '表格不要自己用空格对齐或加竖线，单元格各自独立；缩进用 indent 表示。',
  ].join('\n')
}

/** 附件服务最小形状（只用到登记图片）。 */
interface AttachmentsLike {
  saveImage: (input: { data: Uint8Array; mediaType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'; name?: string }) => Promise<unknown>
}

/** 模型条目最小形状。 */
interface LlmModelInfoLike {
  id: string
  name?: string
  /** 缺省表示能力未知；显式包含 image 才当作确定能看图。 */
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
    maxTokens?: number
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
 * 按名称给模型打速度优先级分（越小越优先）。
 *
 * @param id 模型 id 或显示名。
 * @returns 0 起的名次；未命中返回一个较大值。
 */
export function modelSpeedRank(id: string): number {
  const lower = id.toLowerCase()
  const index = FAST_MODEL_HINTS.findIndex((hint) => lower.includes(hint))
  return index < 0 ? FAST_MODEL_HINTS.length + 1 : index
}

/** 判断模型是否属于"实测看不了图"那一类。 */
function isKnownNoVision(id: string): boolean {
  const lower = id.toLowerCase()
  return NO_VISION_HINTS.some((hint) => lower.includes(hint))
}

/** 去掉模型可能加的 ```json 围栏。 */
function stripFence(raw: string): string {
  const trimmed = raw.trim()
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed)
  return fenced === null ? trimmed : fenced[1]
}

/**
 * 归一化纯文本输出的排版字符。
 *
 * 结构化渲染走 layout.ts；这里只兜底模型没按 JSON 返回的情况：
 * 全角空格换算成两个半角空格，统一换行，去行尾空格（保留行首缩进）。
 */
export function normalizeLayout(raw: string): string {
  const lines = raw
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, '    ')
    .replace(/\u00a0/g, ' ')
    .replace(/\u3000/g, '  ')
    .split('\n')
    .map((line) => line.replace(/[ ]+$/, ''))
  while (lines.length > 0 && lines[0] === '') lines.shift()
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  return lines.join('\n').replace(/\n{3,}/g, '\n\n')
}

/** 从模型输出里取出 { text, translation }；解析失败时把整段当译文。 */
export function parseTranslateOutput(raw: string): WinSnipVisionResult {
  const body = stripFence(raw)
  try {
    const parsed = JSON.parse(body) as { text?: unknown; translation?: unknown }
    const text = parsed.text !== undefined && parsed.text !== null ? renderAny(parsed.text) : ''
    const translation = parsed.translation !== undefined && parsed.translation !== null ? renderAny(parsed.translation) : ''
    if (translation !== '') return { text, translation }
  } catch {
    // 落到下面的兜底。
  }
  return { text: '', translation: normalizeLayout(body) }
}

/** 既能吃结构化 lines，也能吃纯字符串。 */
function renderAny(value: unknown): string {
  if (typeof value === 'string') return normalizeLayout(value)
  const document = parseLayoutDocument(JSON.stringify(value))
  if (document !== undefined) return renderLayout(document)
  return ''
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
   * 列出候选模型，按"快且能看图"排序。
   *
   * @param preferred 用户在面板里指定的模型 id；给定时只考虑它（含跨 provider 查找）。
   */
  private async pickTarget(preferred: string): Promise<{ target: WinSnipModelTarget; llm: LlmServiceLike }> {
    const llm = this.ctx.get('llm') as LlmServiceLike | undefined
    if (llm?.stream === undefined) throw new Error('DSH 模型服务不可用，无法做识别与翻译。')

    const providers = llm.listProviders?.() ?? []
    const inventory: Array<{ target: WinSnipModelTarget; info?: LlmModelInfoLike }> = []
    for (const provider of providers) {
      let models: readonly LlmModelInfoLike[] = []
      try { models = await llm.listModels?.(provider.id) ?? [] } catch { models = [] }
      for (const info of models) inventory.push({ target: { provider: provider.id, model: info.id }, info })
    }
    if (inventory.length === 0) throw new Error('还没有可用的模型：请先在设置里配置一个模型提供方。')

    // 用户显式指定：只认这一个，找不到就说清楚，别偷偷换模型。
    if (preferred !== '') {
      const exact = inventory.find((item) => item.target.model === preferred)
      if (exact === undefined) throw new Error('找不到模型「' + preferred + '」：请在设置里重新选择识别模型。')
      return { target: exact.target, llm }
    }

    const selector = this.ctx.get('agentDefaultModel') as AgentDefaultModelLike | undefined
    const configured = readModelTarget(selector?.currentSelection())

    // 排序：确定能看图的 > 能力未知的 > 明确看不了图的；同档内按快模型偏好。
    const score = (item: { target: WinSnipModelTarget; info?: LlmModelInfoLike }): number => {
      const modalities = item.info?.inputModalities
      const vision = modalities?.includes('image') === true ? 0 : isKnownNoVision(item.target.model) ? 2 : 1
      const speed = modelSpeedRank(item.target.model + ' ' + (item.info?.name ?? ''))
      // 面板当前默认模型在同一档内优先，用户选它通常是有意的。
      const sameAsDefault = configured !== undefined && configured.model === item.target.model ? 0 : 1
      return vision * 100 + speed * 10 + sameAsDefault
    }
    const ranked = [...inventory].sort((a, b) => score(a) - score(b))
    const best = ranked[0]
    if (best === undefined) throw new Error('还没有可用的模型：请先在设置里配置一个模型提供方。')
    return { target: best.target, llm }
  }

  /**
   * 执行一次识别或翻译。
   *
   * @param request 处理类型、图片字节、目标语言与可选模型 id。
   * @throws Error 中文错误信息（已脱敏），由调用方写回响应文件。
   */
  async run(request: {
    kind: 'ocr' | 'translate'
    imageBytes: Uint8Array
    targetLang?: WinSnipTranslateTarget
    model?: string
  }): Promise<WinSnipVisionResult> {
    const attachments = this.ctx.get('attachments') as AttachmentsLike | undefined
    if (attachments?.saveImage === undefined) throw new Error('DSH 附件服务不可用，无法把截图交给模型。')
    const { target, llm } = await this.pickTarget(request.model ?? '')

    const ref = await attachments.saveImage({ data: request.imageBytes, mediaType: 'image/png', name: 'win-snip.png' })
    const prompt = request.kind === 'ocr' ? OCR_PROMPT : translatePrompt(request.targetLang ?? 'auto')

    const controller = new AbortController()
    const timer = setTimeout(() => { controller.abort() }, TIMEOUT_MS)
    const started = Date.now()
    let raw = ''
    try {
      const stream = llm.stream({
        provider: target.provider,
        model: target.model,
        temperature: 0,
        // 识别是"看一眼抄下来"，不需要长篇输出；限长也避免模型啰嗦解释。
        maxTokens: 4096,
        signal: controller.signal,
        messages: [{
          // DSH 的 Message 是四件套（id/role/content/source），少一个都会被适配器拒掉。
          id: 'win-snip-' + request.kind + '-' + started.toString(36),
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
    const elapsedMs = Date.now() - started
    if (raw.trim() === '') throw new Error('模型「' + target.model + '」没有返回内容（可能看不了图片），请在设置里换一个识别模型。')

    if (request.kind === 'ocr') {
      // 优先按结构化渲染（列一定对齐）；模型没照结构返回时退回纯文本归一化。
      const document = parseLayoutDocument(raw)
      const text = document !== undefined ? renderLayout(document) : normalizeLayout(stripFence(raw))
      if (text.trim() === '') throw new Error('模型「' + target.model + '」没有识别出文字。')
      return { text, model: target.model, elapsedMs }
    }
    return { ...parseTranslateOutput(raw), model: target.model, elapsedMs }
  }
}
