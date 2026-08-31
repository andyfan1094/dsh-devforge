/** 火山方舟 Agent Plan 服务：单 Key 数据面与官方文本模型池。 */
import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { SettingsConflictError, settingsNamespace } from '@deepseek-ai/dsh-settings'
import type { ArkStatus } from './protocol.ts'

const LLM_PI_AI_NAMESPACE = settingsNamespace('llm-pi-ai')

/** Agent Plan 的 OpenAI / Responses 官方 Base URL，不能换为普通 /api/v3。 */
export const ARK_PLAN_BASE_URL = 'https://ark.cn-beijing.volces.com/api/plan/v3'
export const ARK_PROVIDER_ID = 'volcengine-ark-plan'

/**
 * Agent Plan 官方文本模型池。
 * 清单与长度限制来自火山方舟“Agent Plan 个人版 / 套餐概览”，同步时只补缺失项。
 */
export const ARK_DEFAULT_MODELS = [
  { id: 'auto', name: 'Auto', contextWindow: 1_000_000, maxTokens: 131_072, input: ['text', 'image'] },
  { id: 'doubao-seed-evolving', name: 'Doubao-Seed-Evolving', contextWindow: 1_000_000, maxTokens: 262_144, input: ['text'] },
  { id: 'doubao-seed-2.1-turbo', name: 'Doubao-Seed-2.1-turbo', contextWindow: 262_144, maxTokens: 262_144, input: ['text', 'image'] },
  { id: 'doubao-seed-2.0-lite', name: 'Doubao-Seed-2.0-lite', contextWindow: 262_144, maxTokens: 131_072, input: ['text'] },
  { id: 'doubao-seed-2.0-mini', name: 'Doubao-Seed-2.0-mini', contextWindow: 262_144, maxTokens: 131_072, input: ['text'] },
  { id: 'glm-5.3-flash', name: 'GLM-5.3-Flash', contextWindow: 1_000_000, maxTokens: 131_072, input: ['text', 'image'] },
  { id: 'glm-5.3', name: 'GLM-5.3', contextWindow: 1_000_000, maxTokens: 131_072, input: ['text'] },
  { id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro', contextWindow: 1_000_000, maxTokens: 393_216, input: ['text'] },
  { id: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash', contextWindow: 1_000_000, maxTokens: 393_216, input: ['text'] },
  { id: 'kimi-k3', name: 'Kimi-K3', contextWindow: 1_000_000, maxTokens: 131_072, input: ['text', 'image'] },
  { id: 'minimax-m3', name: 'MiniMax-M3', contextWindow: 1_000_000, maxTokens: 131_072, input: ['text', 'image'] },
  { id: 'glm-5.2', name: 'GLM-5.2', contextWindow: 1_000_000, maxTokens: 131_072, input: ['text'] },
  { id: 'kimi-k2.7-code', name: 'Kimi-K2.7-Code', contextWindow: 262_144, maxTokens: 32_768, input: ['text', 'image'] },
  { id: 'ark-code-latest', name: 'Ark Code Latest', contextWindow: 1_000_000, maxTokens: 131_072, input: ['text', 'image'] },
] as const

/** 合并自定义方舟 provider，固定 Plan 数据面并保留用户已有模型字段。 */
export function mergeArkProvider(provider: Record<string, unknown> | undefined, fallbackApiKeyEnv: string): Record<string, unknown> {
  const existing = Array.isArray(provider?.models) ? provider.models as Array<Record<string, unknown>> : []
  const ids = new Set(existing.map((model) => model.id).filter((id): id is string => typeof id === 'string'))
  const additions = ARK_DEFAULT_MODELS.filter((model) => !ids.has(model.id)).map((model) => ({ ...model }))
  return {
    ...(provider ?? {}),
    displayName: typeof provider?.displayName === 'string' ? provider.displayName : '火山方舟 Agent Plan',
    apiKeyEnv: typeof provider?.apiKeyEnv === 'string' ? provider.apiKeyEnv : fallbackApiKeyEnv,
    api: typeof provider?.api === 'string' ? provider.api : 'openai-completions',
    baseURL: ARK_PLAN_BASE_URL,
    models: [...existing, ...additions],
  }
}

/** 方舟 capability 配置。 */
export interface ArkCapabilityConfig {
  enabled: boolean
  /** Agent Plan 数据面 Key。 */
  apiKeyEnv: string
}

/** 可直接呈现给面板的分类错误；内容不得包含 Key。 */
export class ArkServiceError extends Error {
  readonly status: number

  constructor(message: string, status = 502) {
    super(message)
    this.name = 'ArkServiceError'
    this.status = status
  }
}

/** 方舟 Agent Plan 服务。 */
export class ArkCodingPlanService {
  private readonly ctx: Context
  private readonly config: ArkCapabilityConfig

  constructor(ctx: Context, config: ArkCapabilityConfig) {
    this.ctx = ctx
    this.config = config
  }

  /** 返回单 Key 与模型路由的脱敏状态。 */
  async status(): Promise<ArkStatus> {
    const apiCredential = await this.ctx.credentials.describe(this.apiReference())
    const section = this.ctx.settings.get(LLM_PI_AI_NAMESPACE) as { providers?: Record<string, { models?: Array<{ id?: string }>; baseURL?: unknown }> } | undefined
    const provider = section?.providers?.[ARK_PROVIDER_ID]
    const liveIds = (provider?.models ?? []).map((model) => model.id).filter((id): id is string => typeof id === 'string')
    const configuredIds = new Set(liveIds)
    const displayIds = liveIds.length > 0 ? liveIds : ARK_DEFAULT_MODELS.map((model) => model.id)
    const baseURL = typeof provider?.baseURL === 'string' ? provider.baseURL : ARK_PLAN_BASE_URL
    return {
      enabled: this.config.enabled,
      credentialConfigured: apiCredential.configured,
      credentialWritable: apiCredential.writable,
      providerConfigured: provider !== undefined,
      models: displayIds.map((id) => ({ id, configured: configuredIds.has(id) })),
      baseURL,
    }
  }

  /** 补齐 Agent Plan 官方文本模型池，不覆盖用户已有模型。 */
  async ensureModels(): Promise<ArkStatus> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const descriptor = this.ctx.settings.describe().find((item) => item.ns === LLM_PI_AI_NAMESPACE)
      if (descriptor === undefined) throw new ArkServiceError('DSH 模型设置服务尚未注册 llm-pi-ai。', 409)
      const current = descriptor.value as { providers?: Record<string, Record<string, unknown>> } | undefined
      const provider = current?.providers?.[ARK_PROVIDER_ID]
      try {
        await this.ctx.settings.mutate(LLM_PI_AI_NAMESPACE, [{
          op: 'set',
          path: ['providers', ARK_PROVIDER_ID],
          value: mergeArkProvider(provider, this.config.apiKeyEnv),
        }], descriptor.revision)
        return await this.status()
      } catch (error) {
        if (error instanceof SettingsConflictError) {
          if (attempt === 1) throw new ArkServiceError('模型设置并发更新，请重试。', 409)
          continue
        }
        throw error
      }
    }
    throw new ArkServiceError('模型设置并发更新，请重试。', 409)
  }

  private apiReference(): ReturnType<typeof credentialRef> {
    return checkedReference(this.config.apiKeyEnv, '方舟 Agent Plan API Key')
  }
}

function checkedReference(value: string, name: string): ReturnType<typeof credentialRef> {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) throw new ArkServiceError(name + '凭据引用格式无效。', 400)
  return credentialRef(value)
}
