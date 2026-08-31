/** MiniMax Coding Plan 官方模型路由服务（与智谱 Coding Plan 同构）。 */
import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { SettingsConflictError, settingsNamespace } from '@deepseek-ai/dsh-settings'
import { deepEqualJson } from '../provider-settings.ts'
import { MiniMaxApiClient } from './api-client.ts'
import type { MiniMaxDashboard, MiniMaxStatus } from './protocol.ts'

const LLM_PI_AI_NAMESPACE = settingsNamespace('llm-pi-ai')

/** llm-pi-ai 内置 provider id（pi-ai 目录已内置 minimax-cn 的 anthropic 兼容路由）。 */
export const MINIMAX_PROVIDER_ID = 'minimax-cn'

/**
 * 官方在售最新模型（contextWindow 取自官方参数表：M3 为 1M 多模态，M2 系列为 204800）。
 * 内置目录只收录到 M2.7；这里按“只补缺失”策略补齐 M2.5/M2.1/M2 及 highspeed 变体。
 */
export const MINIMAX_MODELS = [
  { id: 'MiniMax-M3', name: 'MiniMax-M3', contextWindow: 1_000_000, maxTokens: 128_000, input: ['text', 'image'] },
  { id: 'MiniMax-M2.7', name: 'MiniMax-M2.7', contextWindow: 204_800, maxTokens: 131_072, input: ['text'] },
  { id: 'MiniMax-M2.7-highspeed', name: 'MiniMax-M2.7-highspeed', contextWindow: 204_800, maxTokens: 131_072, input: ['text'] },
  { id: 'MiniMax-M2.5', name: 'MiniMax-M2.5', contextWindow: 204_800, maxTokens: 131_072, input: ['text'] },
  { id: 'MiniMax-M2.5-highspeed', name: 'MiniMax-M2.5-highspeed', contextWindow: 204_800, maxTokens: 131_072, input: ['text'] },
  { id: 'MiniMax-M2.1', name: 'MiniMax-M2.1', contextWindow: 204_800, maxTokens: 131_072, input: ['text'] },
  { id: 'MiniMax-M2.1-highspeed', name: 'MiniMax-M2.1-highspeed', contextWindow: 204_800, maxTokens: 131_072, input: ['text'] },
  { id: 'MiniMax-M2', name: 'MiniMax-M2', contextWindow: 204_800, maxTokens: 131_072, input: ['text'] },
] as const

/** 合并 minimax-cn 配置：只补缺失模型和凭据引用，保留用户显式字段。 */
export function mergeMiniMaxProvider(provider: Record<string, unknown> | undefined, fallbackApiKeyEnv: string): Record<string, unknown> {
  const existing = Array.isArray(provider?.models) ? provider.models as Array<Record<string, unknown>> : []
  const ids = new Set(existing.map((model) => model.id).filter((id): id is string => typeof id === 'string'))
  const additions = MINIMAX_MODELS.filter((model) => !ids.has(model.id)).map((model) => ({ ...model }))
  return {
    ...(provider ?? {}),
    apiKeyEnv: typeof provider?.apiKeyEnv === 'string' ? provider.apiKeyEnv : fallbackApiKeyEnv,
    models: [...existing, ...additions],
  }
}

/** MiniMax capability 配置。 */
export interface MiniMaxCapabilityConfig {
  enabled: boolean
  apiKeyEnv: string
  timeoutMs: number
  /** 官方工具开关。 */
  tools: boolean
  /** Hub 桌面端 Gateway 工具开关（默认启用，依赖 Hub 客户端已登录）。 */
  hub?: boolean
  /** Hub Gateway 自定义地址（默认 http://127.0.0.1:8001）。 */
  hubGatewayURL?: string
}

/** 可直接呈现给面板的分类错误；内容不得包含请求头或 Key。 */
export class MiniMaxServiceError extends Error {
  readonly status: number

  constructor(message: string, status = 502) {
    super(message)
    this.name = 'MiniMaxServiceError'
    this.status = status
  }
}

/** MiniMax 官方模型路由服务。 */
export class MiniMaxService {
  private readonly ctx: Context
  private readonly config: MiniMaxCapabilityConfig

  constructor(ctx: Context, config: MiniMaxCapabilityConfig) {
    this.ctx = ctx
    this.config = config
  }

  /** 返回凭据和模型路由的脱敏状态。 */
  async status(): Promise<MiniMaxStatus> {
    const reference = this.reference()
    const credential = await this.ctx.credentials.describe(reference)
    const section = this.ctx.settings.get(LLM_PI_AI_NAMESPACE) as { providers?: Record<string, { models?: Array<{ id?: string }> }> } | undefined
    const provider = section?.providers?.[MINIMAX_PROVIDER_ID]
    const liveIds = (provider?.models ?? []).map((model) => model.id).filter((id): id is string => typeof id === 'string')
    const configuredIds = new Set(liveIds)
    /** 优先展示 settings 中实际配置的模型，未配置任何模型时回退到内置常量。 */
    const displayIds = liveIds.length > 0 ? liveIds : MINIMAX_MODELS.map((model) => model.id)
    return {
      enabled: this.config.enabled,
      credentialConfigured: credential.configured,
      credentialWritable: credential.writable,
      providerConfigured: provider !== undefined,
      models: displayIds.map((id) => ({ id, configured: configuredIds.has(id) })),
      tools: this.config.tools,
    }
  }

  /** 调官方 /v1/models 拉取在售模型清单，合并进 provider，返回更新后状态。 */
  async fetchModelsFromOfficial(): Promise<{ status: MiniMaxStatus; added: string[]; kept: string[]; total: number }> {
    const apiKey = await this.resolveApiKey()
    const controller = new AbortController()
    const timer = setTimeout(controller.abort.bind(controller), this.config.timeoutMs)
    let response: Response
    try {
      response = await fetch('https://api.minimaxi.com/v1/models', {
        headers: { Authorization: 'Bearer ' + apiKey, Accept: 'application/json' },
        signal: controller.signal,
      })
    } catch (error) {
      throw new MiniMaxServiceError('MiniMax 官方 models 接口不可达：' + (error instanceof Error ? error.message : String(error)))
    } finally {
      clearTimeout(timer)
    }
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new MiniMaxServiceError('MiniMax 官方 models 接口 HTTP ' + response.status + '：' + text.slice(0, 200), response.status === 401 ? 401 : 502)
    }
    const payload = await response.json().catch(() => null)
    const official = parseMiniMaxModelList(payload)
    if (official.length === 0) throw new MiniMaxServiceError('MiniMax 官方 models 接口未返回有效数据。', 502)
    return await this.mergeFetchedModels(official)
  }

  /** 查询官方订阅用量（5h + 周双窗口，一次调用返回）。 */
  async dashboard(signal?: AbortSignal): Promise<MiniMaxDashboard> {
    const client = new MiniMaxApiClient(() => this.resolveApiKey(), this.config.timeoutMs)
    return await client.fetchRemains({ signal })
  }

  /** 补齐官方 provider 路由和最新模型，不覆盖已有模型字段。 */
  async ensureModels(): Promise<MiniMaxStatus> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const descriptor = this.ctx.settings.describe().find((item) => item.ns === LLM_PI_AI_NAMESPACE)
      if (descriptor === undefined) throw new MiniMaxServiceError('DSH 模型设置服务尚未注册 llm-pi-ai。', 409)
      const current = descriptor.value as { providers?: Record<string, Record<string, unknown>> } | undefined
      const provider = current?.providers?.[MINIMAX_PROVIDER_ID]
      const merged = mergeMiniMaxProvider(provider, this.config.apiKeyEnv)
      if (deepEqualJson(merged, provider)) return await this.status()
      try {
        await this.ctx.settings.mutate(LLM_PI_AI_NAMESPACE, [{
          op: 'set',
          path: ['providers', MINIMAX_PROVIDER_ID],
          value: merged,
        }], descriptor.revision)
        return await this.status()
      } catch (error) {
        if (error instanceof SettingsConflictError) {
          if (attempt === 1) throw new MiniMaxServiceError('模型设置并发更新，请重试。', 409)
          continue
        }
        throw error
      }
    }
    throw new MiniMaxServiceError('模型设置并发更新，请重试。', 409)
  }

  /** 校验并构造凭据引用，避免错误配置以内部异常呈现。 */
  private reference(): ReturnType<typeof credentialRef> {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(this.config.apiKeyEnv)) throw new MiniMaxServiceError('MiniMax 凭据引用格式无效。', 400)
    return credentialRef(this.config.apiKeyEnv)
  }

  /** 把官方 models 合并进 provider；写 settings 复用并发重试。 */
  private async mergeFetchedModels(official: Array<Record<string, unknown>>): Promise<{ status: MiniMaxStatus; added: string[]; kept: string[]; total: number }> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const descriptor = this.ctx.settings.describe().find((item) => item.ns === LLM_PI_AI_NAMESPACE)
      if (descriptor === undefined) throw new MiniMaxServiceError('DSH 模型设置服务尚未注册 llm-pi-ai。', 409)
      const current = descriptor.value as { providers?: Record<string, Record<string, unknown>> } | undefined
      const provider = current?.providers?.[MINIMAX_PROVIDER_ID]
      const existing = Array.isArray(provider?.models) ? provider.models as Array<Record<string, unknown>> : []
      const existingIds = new Set(existing.map((model) => model.id).filter((id): id is string => typeof id === 'string'))
      const additions = official.filter((model) => {
        const id = typeof model.id === 'string' ? model.id : ''
        return id !== '' && !existingIds.has(id)
      })
      const merged = [...existing, ...additions]
      const added = additions.map((model) => typeof model.id === 'string' ? model.id : '').filter((id) => id !== '')
      const kept = existing.map((model) => typeof model.id === 'string' ? model.id : '').filter((id) => id !== '')
      try {
        await this.ctx.settings.mutate(LLM_PI_AI_NAMESPACE, [{
          op: 'set',
          path: ['providers', MINIMAX_PROVIDER_ID, 'models'],
          value: merged,
        }], descriptor.revision)
        return { status: await this.status(), added, kept, total: merged.length }
      } catch (error) {
        if (error instanceof SettingsConflictError) {
          if (attempt === 1) throw new MiniMaxServiceError('模型设置并发更新，请重试。', 409)
          continue
        }
        throw error
      }
    }
    throw new MiniMaxServiceError('模型设置并发更新，请重试。', 409)
  }

  /** 每次请求重新解析受管凭据，Key 更新无需重启。 */
  private async resolveApiKey(): Promise<string> {
    const resolved = await this.ctx.credentials.resolve(this.reference())
    const value = resolved?.value.trim()
    if (value === undefined || value === '') throw new MiniMaxServiceError('尚未配置 MiniMax 订阅 Key（用量接口必须使用订阅 Key）。', 400)
    return value
  }
}

/** 把 MiniMax 官方 /v1/models 响应规整为最小可用模型字典。 */
export function parseMiniMaxModelList(payload: unknown): Array<Record<string, unknown>> {
  if (payload === null || typeof payload !== 'object') return []
  const data = Array.isArray((payload as { data?: unknown }).data) ? (payload as { data: unknown[] }).data : []
  const result: Array<Record<string, unknown>> = []
  for (const entry of data) {
    if (entry === null || typeof entry !== 'object') continue
    const row = entry as { id?: unknown; owned_by?: unknown; object?: unknown }
    if (typeof row.id !== 'string' || row.id === '') continue
    const record: Record<string, unknown> = { id: row.id }
    if (typeof row.owned_by === 'string' && row.owned_by !== '') record.owned_by = row.owned_by
    if (typeof row.object === 'string' && row.object !== '') record.object = row.object
    result.push(record)
  }
  return result
}
