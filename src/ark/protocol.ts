/** 火山方舟 Agent/Coding Plan 的 Host/Client 共用契约。 */

/** 服务工厂内的方舟 API 路径。 */
export const ARK_API = {
  status: '/api/dsh-devforge/ark/status',
  dashboard: '/api/dsh-devforge/ark/dashboard',
  setup: '/api/dsh-devforge/ark/setup',
  fetchModels: '/api/dsh-devforge/ark/fetch-models',
} as const

/** 一条 AFP 套餐窗口。 */
export interface ArkAfpLimit {
  /** 5 小时、日、周或月。 */
  period: 'fiveHour' | 'daily' | 'weekly' | 'monthly'
  quota: number
  used: number
  subscribeTime?: number
  resetTime?: number
}

/** 方舟套餐用量面板。 */
export interface ArkDashboard {
  planType?: string
  limits: ArkAfpLimit[]
  fetchedAt: number
  warnings: string[]
}

/** 方舟模型路由与凭据的脱敏状态。 */
export interface ArkStatus {
  enabled: boolean
  /** Agent/Coding Plan 数据面 API Key。 */
  credentialConfigured: boolean
  credentialWritable: boolean
  /** 可查询 AFP 与官方模型清单的火山云 AK/SK 是否已完整配置。 */
  managementCredentialsConfigured: boolean
  providerConfigured: boolean
  models: Array<{ id: string; configured: boolean }>
  baseURL: string
}
