/** OpenAI 兼容中转站的 Host/Client 共用契约。 */

/** 天工造梦内的 OpenAI 中转站 API 路径。 */
export const OPENAI_GATEWAY_API = {
  status: '/api/dsh-devforge/openai/status',
  config: '/api/dsh-devforge/openai/config',
  endpoint: '/api/dsh-devforge/openai/endpoint',
  fetchModels: '/api/dsh-devforge/openai/fetch-models',
} as const

/** 端点聊天协议：OpenAI Responses（默认，走 /v1 聊天路由）或 Anthropic Messages（Claude 原生 /v1/messages）。 */
export type OpenAiEndpointApi = 'openai-responses' | 'anthropic-messages'

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
  /** 聊天协议；缺省 openai-responses，向后兼容旧配置。 */
  api?: OpenAiEndpointApi
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
/** 单个端点获取模型的结果；失败时保留该端点已有路由。 */
export interface OpenAiGatewayEndpointFetchResult {
  endpointId: string
  providerId: string
  ok: boolean
  modelCount: number
  added: string[]
  removed: string[]
  kept: string[]
  retained: boolean
  error?: string
}

/** 批量获取模型结果；端点失败不影响其它端点。 */
export interface OpenAiGatewayFetchModelsResult {
  status: OpenAiGatewayStatus
  results: OpenAiGatewayEndpointFetchResult[]
  added: string[]
  removed: string[]
  kept: string[]
  total: number
  succeeded: number
  failed: number
}

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
  /** 主端点聊天协议镜像；旧客户端可忽略。 */
  api?: OpenAiEndpointApi
  imageModel?: string
  models: Array<{ id: string; name?: string; configured: boolean }>
  /** 多端点状态；旧客户端可忽略该字段。 */
  endpoints: OpenAiGatewayEndpointStatus[]
}
