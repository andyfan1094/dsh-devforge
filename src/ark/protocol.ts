/** 火山方舟 Agent Plan 的 Host/Client 共用契约。 */

/** 服务工厂内的方舟 API 路径。 */
export const ARK_API = {
  status: '/api/dsh-devforge/ark/status',
  setup: '/api/dsh-devforge/ark/setup',
  dashboard: '/api/dsh-devforge/ark/dashboard',
  usageCredentials: '/api/dsh-devforge/ark/usage/credentials',
  refreshUsage: '/api/dsh-devforge/ark/usage/refresh',
} as const

/** 火山方舟套餐种类。 */
export type ArkUsageProduct = 'agent-plan' | 'coding-plan'

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
  /** 控制面 AK 的受管凭据引用及状态。 */
  usageAccessKeyEnv: string
  usageAccessKeyConfigured: boolean
  /** 控制面 SK 的受管凭据引用及状态。 */
  usageSecretKeyEnv: string
  usageSecretKeyConfigured: boolean
  usageCredentialsWritable: boolean
}
