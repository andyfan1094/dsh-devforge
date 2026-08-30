/** MiniMax Coding Plan 官方模型路由服务（与智谱 Coding Plan 同构）。 */
import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { SettingsConflictError, settingsNamespace } from '@deepseek-ai/dsh-settings'
import type { MiniMaxStatus } from './protocol.ts'

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
    const configuredIds = new Set((provider?.models ?? []).map((model) => model.id).filter((id): id is string => typeof id === 'string'))
    return {
      enabled: this.config.enabled,
      credentialConfigured: credential.configured,
      credentialWritable: credential.writable,
      providerConfigured: provider !== undefined,
      models: MINIMAX_MODELS.map((model) => ({ id: model.id, configured: configuredIds.has(model.id) })),
      tools: this.config.tools,
    }
  }

  /** 补齐官方 provider 路由和最新模型，不覆盖已有模型字段。 */
  async ensureModels(): Promise<MiniMaxStatus> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const descriptor = this.ctx.settings.describe().find((item) => item.ns === LLM_PI_AI_NAMESPACE)
      if (descriptor === undefined) throw new MiniMaxServiceError('DSH 模型设置服务尚未注册 llm-pi-ai。', 409)
      const current = descriptor.value as { providers?: Record<string, Record<string, unknown>> } | undefined
      const provider = current?.providers?.[MINIMAX_PROVIDER_ID]
      try {
        await this.ctx.settings.mutate(LLM_PI_AI_NAMESPACE, [{
          op: 'set',
          path: ['providers', MINIMAX_PROVIDER_ID],
          value: mergeMiniMaxProvider(provider, this.config.apiKeyEnv),
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
}
