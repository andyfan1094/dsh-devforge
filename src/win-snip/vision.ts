/**
 * 截图识别与翻译的模型通道。
 *
 * 为什么集中在这里：模型 Key 只能在宿主进程里解析（受管凭据），
 * 原生助手只负责把图片放进队列、把结果展示给用户，永远接触不到 Key。
 */
import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { MiniMaxApiClient, safeApiError } from '../minimax/api-client.ts'
import { toImageDataUrl } from '../minimax/image-input.ts'
import { normalizeOpenAiBaseURL } from '../openai/api-client.ts'
import type { WinSnipSettings, WinSnipTranslateTarget } from './protocol.ts'

/** 识别/翻译的处理结果。 */
export interface WinSnipVisionResult {
  /** 图中原始文字。 */
  text: string
  /** 译文（仅翻译时给出）。 */
  translation?: string
}

/** 视觉通道依赖：全部为读配置的取值函数，便于热更新与测试。 */
export interface WinSnipVisionDeps {
  /** 读取当前配置。 */
  settings: () => WinSnipSettings
  /** MiniMax 订阅 Key 的受管引用名。 */
  minimaxApiKeyEnv: () => string
  /** OpenAI 中转站地址与 Key 引用名。 */
  openAi: () => { baseURL: string; apiKeyEnv: string }
}

/** 单次模型调用超时（毫秒）。 */
const TIMEOUT_MS = 60000

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

/**
 * 截图识别/翻译服务。
 *
 * 通道选择：配置指定就用指定通道；`auto` 时优先 MiniMax（Coding Plan 自带视觉能力），
 * 不可用再退回 OpenAI 中转站。两条都不可用时给出可操作的中文提示。
 */
export class WinSnipVision {
  private readonly ctx: Context
  private readonly deps: WinSnipVisionDeps

  constructor(ctx: Context, deps: WinSnipVisionDeps) {
    this.ctx = ctx
    this.deps = deps
  }

  /** 解析某个受管凭据的明文；缺失时返回 undefined。 */
  private async resolveKey(envName: string): Promise<string | undefined> {
    const name = envName.trim()
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return undefined
    try {
      const resolved = await this.ctx.credentials.resolve(credentialRef(name))
      const value = resolved?.value.trim()
      return value === undefined || value === '' ? undefined : value
    } catch {
      return undefined
    }
  }

  /**
   * 执行一次识别或翻译。
   *
   * @param request 处理类型、图片路径与目标语言。
   * @throws Error 中文错误信息（已脱敏），由调用方写回响应文件。
   */
  async run(request: { kind: 'ocr' | 'translate'; imagePath: string; targetLang?: WinSnipTranslateTarget }): Promise<WinSnipVisionResult> {
    const settings = this.deps.settings()
    const provider = await this.pickProvider(settings)
    const dataUrl = await toImageDataUrl(request.imagePath)
    const prompt = request.kind === 'ocr' ? OCR_PROMPT : translatePrompt(request.targetLang ?? settings.translateTarget)
    const raw = provider === 'minimax'
      ? await this.callMiniMax(settings, prompt, dataUrl)
      : await this.callOpenAi(settings, prompt, dataUrl)
    return request.kind === 'ocr' ? { text: raw.trim() } : parseTranslateOutput(raw)
  }

  /** 选定实际通道：显式配置优先，auto 时按可用凭据回退。 */
  private async pickProvider(settings: WinSnipSettings): Promise<'minimax' | 'openai'> {
    const configured = settings.visionProvider
    if (configured === 'minimax') {
      if (await this.resolveKey(this.deps.minimaxApiKeyEnv()) === undefined) {
        throw new Error('尚未配置 MiniMax 订阅 Key，无法用 MiniMax 做识别与翻译。')
      }
      return 'minimax'
    }
    if (configured === 'openai') {
      const openAi = this.deps.openAi()
      if (openAi.baseURL.trim() === '') throw new Error('尚未配置 OpenAI 中转站地址，无法用中转站做识别与翻译。')
      if (settings.visionModel.trim() === '') throw new Error('走中转站需要先在面板填写视觉模型名（如 gpt-4o-mini）。')
      if (await this.resolveKey(openAi.apiKeyEnv) === undefined) throw new Error('尚未配置 OpenAI 中转站 API Key。')
      return 'openai'
    }
    // auto：先看 MiniMax，再看中转站；两者都没有时给出明确提示。
    if (await this.resolveKey(this.deps.minimaxApiKeyEnv()) !== undefined) return 'minimax'
    const openAi = this.deps.openAi()
    if (openAi.baseURL.trim() !== '' && settings.visionModel.trim() !== '' && await this.resolveKey(openAi.apiKeyEnv) !== undefined) {
      return 'openai'
    }
    throw new Error('没有可用的模型通道：请先配置 MiniMax 订阅 Key，或配置 OpenAI 中转站地址 + 视觉模型名 + Key。')
  }

  /** MiniMax 官方视觉接口。 */
  private async callMiniMax(settings: WinSnipSettings, prompt: string, dataUrl: string): Promise<string> {
    const apiKey = await this.resolveKey(this.deps.minimaxApiKeyEnv())
    if (apiKey === undefined) throw new Error('尚未配置 MiniMax 订阅 Key。')
    void settings
    const client = new MiniMaxApiClient(async () => apiKey, TIMEOUT_MS)
    try {
      return await client.understandImage(prompt, dataUrl)
    } catch (error) {
      throw new Error(safeApiError(error))
    }
  }

  /** OpenAI 兼容中转站的对话接口（图片以 image_url 传入）。 */
  private async callOpenAi(settings: WinSnipSettings, prompt: string, dataUrl: string): Promise<string> {
    const config = this.deps.openAi()
    const baseURL = normalizeOpenAiBaseURL(config.baseURL.trim())
    if (baseURL === '') throw new Error('尚未配置 OpenAI 中转站地址。')
    const apiKey = await this.resolveKey(config.apiKeyEnv)
    if (apiKey === undefined) throw new Error('尚未配置 OpenAI 中转站 API Key。')
    const model = settings.visionModel.trim()
    if (model === '') throw new Error('走中转站需要先在面板填写视觉模型名。')
    let response: Response
    try {
      response = await fetch(baseURL + '/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + apiKey },
        body: JSON.stringify({
          model,
          temperature: 0,
          messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: dataUrl } }] }],
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    } catch (error) {
      throw new Error('调用中转站失败：' + (error instanceof Error ? error.message : String(error)))
    }
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new Error('中转站返回 HTTP ' + response.status + (detail === '' ? '' : '：' + detail.slice(0, 200)))
    }
    const payload = await response.json().catch(() => undefined) as { choices?: Array<{ message?: { content?: unknown } }> } | undefined
    const content = payload?.choices?.[0]?.message?.content
    const text = typeof content === 'string' ? content : ''
    if (text.trim() === '') throw new Error('中转站返回空内容。')
    return text
  }
}
