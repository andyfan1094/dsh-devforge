/** OpenAI 兼容中转站的 Host/Client 共用契约。 */

/** 天工造梦内的 OpenAI 中转站 API 路径。 */
export const OPENAI_GATEWAY_API = {
  status: '/api/dsh-devforge/openai/status',
  config: '/api/dsh-devforge/openai/config',
  fetchModels: '/api/dsh-devforge/openai/fetch-models',
} as const

/** 一个 OpenAI 兼容中转端点（Key 只保存引用名，不保存明文）。 */
export interface OpenAiGatewayEndpointConfig {
  /** 稳定标识，用于关联 llm-pi-ai provider。 */
  id: string
  /** 面板显示名称。 */
  name: string
  /** 裸主机或 /v1 API 根路径。 */
  baseURL: string
  /** 受管凭据引用名。 */
  apiKeyEnv: string
  /** 该端点使用的生图模型，可选。 */
  imageModel?: string
}

/** 端点脱敏状态（不返回 Key）。 */
export interface OpenAiGatewayEndpointStatus extends OpenAiGatewayEndpointConfig {
  providerId: string
  credentialConfigured: boolean
  models: Array<{ id: string; name?: string; configured: boolean }>
}

/** 中转站配置保存请求；API Key 继续走通用受管凭据路由。 */
export interface OpenAiGatewayConfigPatch {
  /** 保留字段：旧版单端点请求继续可用；传 endpoints 时取第一个作为主端点镜像。 */
  baseURL?: string
  apiKeyEnv?: string
  imageModel?: string
  /** 多端点完整替换列表；服务端会校验并规范化。 */
  endpoints?: OpenAiGatewayEndpointConfig[]
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
  /** 多端点状态；旧客户端可忽略该字段。 */
  endpoints: OpenAiGatewayEndpointStatus[]
}
