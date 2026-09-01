/** OpenAI 兼容中转站的 Host/Client 共用契约。 */

/** 天工造梦内的 OpenAI 中转站 API 路径。 */
export const OPENAI_GATEWAY_API = {
  status: '/api/dsh-devforge/openai/status',
  config: '/api/dsh-devforge/openai/config',
  fetchModels: '/api/dsh-devforge/openai/fetch-models',
} as const

/** 中转站配置保存请求；API Key 继续走通用受管凭据路由。 */
export interface OpenAiGatewayConfigPatch {
  baseURL: string
  imageModel?: string
}

/** 凭据、模型路由和生图模型的脱敏状态。 */
export interface OpenAiGatewayStatus {
  enabled: boolean
  credentialConfigured: boolean
  credentialWritable: boolean
  providerConfigured: boolean
  apiKeyEnv: string
  baseURL: string
  imageModel?: string
  models: Array<{ id: string; name?: string; configured: boolean }>
}
