/** 火山方舟 Agent Plan 的 Host/Client 共用契约。 */

/** 服务工厂内的方舟 API 路径。 */
export const ARK_API = {
  status: '/api/dsh-devforge/ark/status',
  setup: '/api/dsh-devforge/ark/setup',
} as const

/** 方舟模型路由与单凭据的脱敏状态。 */
export interface ArkStatus {
  enabled: boolean
  /** Agent Plan 数据面 API Key。 */
  credentialConfigured: boolean
  credentialWritable: boolean
  providerConfigured: boolean
  models: Array<{ id: string; configured: boolean }>
  baseURL: string
}
