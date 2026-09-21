/** 火山方舟 Agent/Coding Plan 的 Host/Client 共用契约。 */

/** 天工造梦内的方舟 API 路径。 */
export const ARK_API = {
  status: '/api/dsh-devforge/ark/status',
  setup: '/api/dsh-devforge/ark/setup',
  dashboard: '/api/dsh-devforge/ark/dashboard',
  usageCredentials: '/api/dsh-devforge/ark/usage/credentials',
  refreshUsage: '/api/dsh-devforge/ark/usage/refresh',
  /** Coding Plan 数据面：补齐 provider 与默认模型（全量恢复并清墓碑）。 */
  codingSetup: '/api/dsh-devforge/ark/coding/setup',
  /** 批量删除模型（body { ids, plan? }，plan 缺省 'agent'；写墓碑防启动复活）。 */
  modelsDelete: '/api/dsh-devforge/ark/models/delete',
} as const

/** 火山方舟套餐种类。 */
export type ArkUsageProduct = 'agent-plan' | 'coding-plan'

/**
 * 大多数方舟思考模型支持的五档推理强度（Agent/Coding Plan 共用）。
 * 定义上移到 protocol：Agent Plan 模型池（service.ts）与 Coding Plan 模型池（本文件）共用一份。
 */
export const FIVE_TIER_REASONING = { low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' } as const

/** Kimi K3 系（Responses 档）的推理档位：以网关实际支持的精简集合为准。 */
export const KIMI_REASONING = { off: null, low: 'low', high: 'high', max: 'max' } as const

/** 方舟 Coding Plan（OpenAI 兼容）聊天路由 provider id。 */
export const ARK_CODING_PROVIDER_ID = 'volcengine-ark-coding'

/** 方舟 Coding Plan 官方数据面端点：无条件覆盖防配置漂移，避免 Key 被引到未知地址。 */
export const ARK_CODING_BASE_URL = 'https://ark.cn-beijing.volces.com/api/coding/v3'

/**
 * Coding Plan 官方模型池（别名由方舟网关动态映射，2026-09-21 实测校准，全部条目实测 HTTP 200）：
 * - ark-code-latest 为控制台管理路由，网关解析为 auto；kimi-k2-250905 / kimi-k2-thinking-251104 解析为 kimi-k2.7-code；
 * - 容量沿用 Agent Plan 网关校准值（保守校准值，可实测后调整）：maxTokens 上限 128000，
 *   kimi 两条按 kimi-k2.7-code 口径为 32768，glm-5-3-flash 为 131072；
 * - 实测 404、禁止收录：auto、glm-4.7、deepseek-v3.2、kimi-k2.5、deepseek-v3-2-251201、
 *   doubao-seed-2-1-pro-260915、doubao-seed-1-8-251228、doubao-smart-router-250928。
 */
export const ARK_CODING_DEFAULT_MODELS = [
  { id: 'ark-code-latest', name: 'Ark Code Latest', contextWindow: 262_144, maxTokens: 128_000, input: ['text', 'image'], reasoningEfforts: FIVE_TIER_REASONING },
  { id: 'doubao-seed-2.0-code', name: 'Doubao-Seed-2.0-Code', contextWindow: 262_144, maxTokens: 128_000, input: ['text', 'image'], reasoningEfforts: FIVE_TIER_REASONING },
  { id: 'doubao-seed-code', name: 'Doubao-Seed-Code', contextWindow: 262_144, maxTokens: 128_000, input: ['text', 'image'], reasoningEfforts: FIVE_TIER_REASONING },
  {
    id: 'kimi-k2-250905',
    name: 'Kimi-K2-250905',
    contextWindow: 262_144,
    maxTokens: 32_768,
    input: ['text', 'image'],
    reasoningEfforts: KIMI_REASONING,
    compat: { thinkingFormat: 'qwen', supportsReasoningEffort: false, supportsDeveloperRole: false },
  },
  {
    id: 'kimi-k2-thinking-251104',
    name: 'Kimi-K2-Thinking-251104',
    contextWindow: 262_144,
    maxTokens: 32_768,
    input: ['text', 'image'],
    reasoningEfforts: KIMI_REASONING,
    compat: { thinkingFormat: 'qwen', supportsReasoningEffort: false, supportsDeveloperRole: false },
  },
  { id: 'deepseek-v4-pro-260425', name: 'DeepSeek-V4-Pro-260425', contextWindow: 1_000_000, maxTokens: 128_000, input: ['text'], reasoningEfforts: FIVE_TIER_REASONING },
  { id: 'glm-5-3-flash-260828', name: 'GLM-5.3-Flash-260828', contextWindow: 1_000_000, maxTokens: 131_072, input: ['text', 'image'], reasoningEfforts: FIVE_TIER_REASONING },
  { id: 'doubao-seed-2-1-turbo-260628', name: 'Doubao-Seed-2.1-turbo-260628', contextWindow: 262_144, maxTokens: 128_000, input: ['text', 'image'], reasoningEfforts: FIVE_TIER_REASONING },
  { id: 'doubao-seed-2-0-lite-260215', name: 'Doubao-Seed-2.0-lite-260215', contextWindow: 262_144, maxTokens: 128_000, input: ['text'], reasoningEfforts: FIVE_TIER_REASONING },
] as const

/** 一个额度周期的已用比例、绝对值与重置时间。 */
export interface ArkUsagePeriod {
  level: string
  used?: number
  total?: number
  usedPercent?: number
  resetAt?: number
}

/** 一个套餐的额度快照。 */
export interface ArkPlanUsage {
  product: ArkUsageProduct
  subscribed: boolean
  periods: ArkUsagePeriod[]
  error?: string
}

/** 火山方舟用量看板快照。 */
export interface ArkUsageDashboard {
  region: string
  plans: ArkPlanUsage[]
  fetchedAt: number
  stale: boolean
  warnings: string[]
}

/** AK/SK 验证并保存后的脱敏结果。 */
export interface ArkUsageCredentialsResult {
  status: ArkStatus
  dashboard: ArkUsageDashboard
}

/** 方舟模型路由与凭据的脱敏状态。 */
export interface ArkStatus {
  enabled: boolean
  /** Agent Plan 数据面 API Key。 */
  credentialConfigured: boolean
  credentialWritable: boolean
  providerConfigured: boolean
  models: Array<{ id: string; configured: boolean }>
  baseURL: string
  /** Coding Plan 数据面 provider 是否已写入模型路由。 */
  codingProviderConfigured: boolean
  /** Coding Plan 数据面 provider 模型清单。 */
  codingModels: Array<{ id: string; configured: boolean }>
  /** 控制面 AK 的受管凭据引用及状态。 */
  usageAccessKeyEnv: string
  usageAccessKeyConfigured: boolean
  /** 控制面 SK 的受管凭据引用及状态。 */
  usageSecretKeyEnv: string
  usageSecretKeyConfigured: boolean
  usageCredentialsWritable: boolean
}
