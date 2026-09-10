/**
 * 硅基流动 SiliconFlow 能力服务 —— 模型目录、受管凭据与 RAG 向量入口。
 *
 * - 模型目录：GET /v1/models 按系列精选最新版对话模型后合并进 llm-pi-ai providers.siliconflow；
 *   FREE_MODELS 内置免费标注（参考，以官网为准）；
 * - 凭据：SILICONFLOW_API_KEY 受管引用，每次请求重新解析；错误一律脱敏。
 */
import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { SettingsConflictError } from '@deepseek-ai/dsh-settings'
import { settingsNamespace } from '../settings-compat.ts'
import { deepEqualJson } from '../provider-settings.ts'
import { upstreamRequestHeaders, upstreamResponseText } from '../upstream-fetch.ts'
import type { SiliconFlowStatus } from './protocol.ts'

const LLM_PI_AI_NAMESPACE = settingsNamespace('llm-pi-ai')
/** llm-pi-ai 下的 provider 路由 id（模型目录 providers 键）。 */
export const SILICONFLOW_PROVIDER_ID = 'siliconflow'
const BASE_URL = 'https://api.siliconflow.cn/v1'
/** 内置免费模型标注（硅基流动免费档，参考清单；未列出的以官网价格页为准）。 */
export const FREE_MODELS = new Set(['BAAI/bge-m3', 'BAAI/bge-large-zh-v1.5', 'BAAI/bge-reranker-v2-m3', 'netease-youdao/bce-embedding-base_v1.5'])

/** 可直接呈现给面板的分类错误。 */
export class SiliconFlowServiceError extends Error {
  readonly status: number
  constructor(message: string, status = 502) {
    super(message)
    this.name = 'SiliconFlowServiceError'
    this.status = status
  }
}

/** 硅基流动 capability 配置。 */
export interface SiliconFlowCapabilityConfig {
  enabled: boolean
  apiKeyEnv: string
  timeoutMs: number
}

/** 从 /v1/models 响应提取模型 id 列表（防御式兼容多种形状）。 */
export function parseModelIds(payload: unknown): string[] {
  const list = (payload as { data?: unknown } | null)?.data
  const arr = Array.isArray(list) ? list : Array.isArray(payload) ? payload as unknown[] : []
  const ids: string[] = []
  for (const item of arr) {
    const id = typeof item === 'string' ? item : (item as { id?: unknown })?.id
    if (typeof id === 'string' && id.trim() !== '' && !ids.includes(id.trim())) ids.push(id.trim())
  }
  return ids
}

/** 非对话用途关键词：图片/视频/语音/OCR/向量/重排等不进聊天模型目录。 */
const NON_CHAT_MODEL_PATTERN = /embedding|reranker|bge|image|i2v|t2v|asr|gsr|tts|ocr|voice|captioner|kolors|whisper/i

/** 从模型名提取版本号：跳过参数规模（32B/A13B）与日期快照（0414/2507）。 */
function parseModelVersion(base: string): number[] | null {
  for (const token of base.split(/[-_]/)) {
    if (/^\d{4}$/.test(token)) continue
    const match = /^([A-Za-z]+)?(\d+(?:\.\d+)*)([A-Za-z]+)?$/.exec(token)
    if (match === null) continue
    if ((match[3] ?? '').toLowerCase() === 'b') continue
    return match[2]!.split('.').map(Number)
  }
  return null
}

/** 逐段比较版本号；缺位按 0 补齐（3 < 3.5，5.2 > 4.5）。 */
function compareVersions(a: number[], b: number[]): number {
  const length = Math.max(a.length, b.length)
  for (let index = 0; index < length; index += 1) {
    const left = a[index] ?? 0
    const right = b[index] ?? 0
    if (left !== right) return left - right
  }
  return 0
}

/**
 * 按系列精选最新版对话模型（辉哥定稿：每系列只保留版本最高的那批）。
 * 规则：剔除 Pro/LoRA 变体与图片/视频/语音/OCR/向量/重排等非对话模型；
 * 以「系列 + 能力线（chat/vl/omni/coder）」分组只留版本最高的成员；
 * 无版本号的模型（如 Seed-OSS-36B）随所在组整体保留；跨组织同名系列合并为一族。
 */
export function curateLatestChatModels(ids: string[]): string[] {
  const families = new Map<string, Array<{ id: string; version: number[] | null }>>()
  for (const raw of ids) {
    if (raw.startsWith('Pro/') || raw.startsWith('LoRA/')) continue
    if (NON_CHAT_MODEL_PATTERN.test(raw)) continue
    const base = raw.includes('/') ? raw.slice(raw.lastIndexOf('/') + 1) : raw
    const tag = /-VL(-|$)|\d+V$/.test(base) ? 'vl' : /omni/i.test(base) ? 'omni' : /coder|code/i.test(base) ? 'coder' : 'chat'
    const series = (/^[A-Za-z]+/.exec(base)?.[0] ?? base).toLowerCase()
    const key = series + ':' + tag
    const bucket = families.get(key) ?? []
    bucket.push({ id: raw, version: parseModelVersion(base) })
    families.set(key, bucket)
  }
  const result: string[] = []
  for (const bucket of families.values()) {
    const versioned = bucket.filter((item): item is { id: string; version: number[] } => item.version !== null)
    if (versioned.length === 0) {
      for (const item of bucket) result.push(item.id)
      continue
    }
    let max = versioned[0]!.version
    for (const item of versioned) if (compareVersions(item.version, max) > 0) max = item.version
    for (const item of versioned) if (compareVersions(item.version, max) === 0) result.push(item.id)
  }
  return result.sort()
}

/** 合并 siliconflow provider 配置：只补缺失模型和凭据引用，保留用户显式字段。 */
export function mergeSiliconFlowProvider(provider: Record<string, unknown> | undefined, fallbackApiKeyEnv: string, modelIds: string[]): Record<string, unknown> {
  const existing = Array.isArray(provider?.models) ? provider.models as Array<Record<string, unknown>> : []
  const ids = new Set(existing.map((model) => model.id).filter((id): id is string => typeof id === 'string'))
  const additions = modelIds.filter((id) => !ids.has(id)).map((id) => ({ id, name: id }))
  return {
    ...(provider ?? {}),
    apiKeyEnv: typeof provider?.apiKeyEnv === 'string' ? provider.apiKeyEnv : fallbackApiKeyEnv,
    displayName: typeof provider?.displayName === 'string' && provider.displayName !== '' ? provider.displayName : '硅基流动',
    // llm-pi-ai 校验红线：内置目录没有 siliconflow 路由，必须显式声明线协议与端点，
    // 否则整条 provider 写入被拒（0.16.3 教训：只写 models 会报 "needs an api"）。
    api: typeof provider?.api === 'string' && provider.api !== '' ? provider.api : 'openai-completions',
    baseURL: typeof provider?.baseURL === 'string' && provider.baseURL !== '' ? provider.baseURL : BASE_URL,
    defaultContextWindow: 128_000,
    defaultMaxTokens: 8_192,
    defaultInput: ['text'],
    models: [...existing, ...additions],
  }
}

/** 硅基流动官方接口服务。 */
export class SiliconFlowService {
  private readonly ctx: Context
  private readonly config: SiliconFlowCapabilityConfig

  constructor(ctx: Context, config: SiliconFlowCapabilityConfig) {
    this.ctx = ctx
    this.config = config
  }

  /** 返回凭据与模型目录的脱敏状态。 */
  async status(): Promise<SiliconFlowStatus> {
    const credential = await this.ctx.credentials.describe(this.reference())
    const section = this.ctx.settings.get(LLM_PI_AI_NAMESPACE) as { providers?: Record<string, { models?: Array<{ id?: string }> }> } | undefined
    const provider = section?.providers?.[SILICONFLOW_PROVIDER_ID]
    const liveIds = (provider?.models ?? []).map((model) => model.id).filter((id): id is string => typeof id === 'string')
    const configured = new Set(liveIds)
    const display = liveIds.length > 0 ? liveIds : [...FREE_MODELS]
    return {
      enabled: this.config.enabled,
      credentialConfigured: credential.configured,
      credentialWritable: credential.writable,
      providerConfigured: provider !== undefined,
      models: display.map((id) => ({ id, configured: configured.has(id), free: FREE_MODELS.has(id) })),
    }
  }

  /** 拉取在线模型清单，按系列精选最新版对话模型后合并进 DSH 模型目录。 */
  async ensureModels(): Promise<SiliconFlowStatus> {
    const apiKey = await this.resolveApiKey()
    const ids = curateLatestChatModels(parseModelIds(await this.get('/models', apiKey)))
    if (ids.length === 0) throw new SiliconFlowServiceError('硅基流动模型清单为空（检查 Key 与网络）。', 502)
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const descriptor = this.ctx.settings.describe().find((item) => item.ns === LLM_PI_AI_NAMESPACE)
      if (descriptor === undefined) throw new SiliconFlowServiceError('DSH 模型设置服务尚未注册 llm-pi-ai。', 409)
      const current = descriptor.value as { providers?: Record<string, Record<string, unknown>> } | undefined
      const merged = mergeSiliconFlowProvider(current?.providers?.[SILICONFLOW_PROVIDER_ID], this.config.apiKeyEnv, ids)
      if (deepEqualJson(merged, current?.providers?.[SILICONFLOW_PROVIDER_ID])) return await this.status()
      try {
        await this.ctx.settings.mutate(LLM_PI_AI_NAMESPACE, [{ op: 'set', path: ['providers', SILICONFLOW_PROVIDER_ID], value: merged }], descriptor.revision)
        return await this.status()
      } catch (error) {
        if (error instanceof SettingsConflictError) {
          if (attempt === 1) throw new SiliconFlowServiceError('模型设置并发更新，请重试。', 409)
          continue
        }
        throw error
      }
    }
    throw new SiliconFlowServiceError('模型设置并发更新，请重试。', 409)
  }

  /** 在线模型清单（不写目录，面板浏览用）。 */
  async listOnlineModels(): Promise<string[]> {
    const apiKey = await this.resolveApiKey()
    return parseModelIds(await this.get('/models', apiKey))
  }

  /** 校验并构造凭据引用。 */
  private reference(): ReturnType<typeof credentialRef> {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(this.config.apiKeyEnv)) throw new SiliconFlowServiceError('硅基流动凭据引用格式无效。', 400)
    return credentialRef(this.config.apiKeyEnv)
  }

  /** 每次请求重新解析凭据。 */
  private async resolveApiKey(): Promise<string> {
    const resolved = await this.ctx.credentials.resolve(this.reference())
    const value = resolved?.value.trim()
    if (value === undefined || value === '') throw new SiliconFlowServiceError('尚未配置硅基流动 API Key（SILICONFLOW_API_KEY）。', 400)
    return value
  }

  /** 访问官方接口，限制响应大小并分类常见错误。 */
  private async get(path: string, apiKey: string): Promise<unknown> {
    let response: Response
    try {
      response = await fetch(BASE_URL + path, {
        headers: upstreamRequestHeaders({ authorization: 'Bearer ' + apiKey, accept: 'application/json' }),
        signal: AbortSignal.timeout(this.config.timeoutMs),
      })
    } catch (error) {
      throw new SiliconFlowServiceError('硅基流动接口请求失败：' + (error instanceof Error ? error.message : String(error)).slice(0, 160))
    }
    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new SiliconFlowServiceError('硅基流动接口 HTTP ' + response.status + '：' + body.replace(/sk-[A-Za-z0-9-]+/gu, 'sk-[redacted]').slice(0, 200))
    }
    return JSON.parse(await upstreamResponseText(response)) as unknown
  }
}
