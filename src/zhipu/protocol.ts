/** 智谱 Coding Plan capability 的 Host/Client 共用契约。 */

/** 服务工厂内的智谱 API 路径。 */
export const ZHIPU_API = {
  status: '/api/dsh-devforge/zhipu/status',
  dashboard: '/api/dsh-devforge/zhipu/dashboard',
  setup: '/api/dsh-devforge/zhipu/setup',
  fetchModels: '/api/dsh-devforge/zhipu/fetch-models',
} as const

/** 用量查询窗口。 */
export type ZhipuUsageWindow = 'day' | 'week'

/** 官方额度类型。 */
export type ZhipuQuotaKind = 'tokens-5h' | 'tokens-week' | 'tools-month' | 'unknown'

/** 一条官方额度窗口。 */
export interface ZhipuQuotaLimit {
  kind: ZhipuQuotaKind
  usedPercent?: number
  used?: number
  total?: number
  remaining?: number
  nextResetTime?: string | number
  details: Array<{ name: string; used: number }>
}

/** 模型用量摘要。 */
export interface ZhipuModelUsage {
  totalCalls: number
  totalTokens: number
  models: Array<{ name: string; tokens: number }>
}

/** MCP 工具用量摘要。 */
export interface ZhipuToolUsage {
  networkSearch: number
  webRead: number
  zread: number
}

/** 页面一次刷新所需的完整数据。 */
export interface ZhipuDashboard {
  level?: string
  limits: ZhipuQuotaLimit[]
  modelUsage: ZhipuModelUsage
  toolUsage: ZhipuToolUsage
  window: ZhipuUsageWindow
  fetchedAt: number
  warnings: string[]
}

/** 官方 MCP 工具描述（tools/list 规整后）。 */
export interface ZhipuMcpToolDescriptor {
  /** 官方原始工具名。 */
  name: string
  /** 官方工具说明。 */
  description: string
}

/** 模型路由和凭据的脱敏状态。 */
export interface ZhipuStatus {
  enabled: boolean
  credentialConfigured: boolean
  credentialWritable: boolean
  providerConfigured: boolean
  models: Array<{ id: string; configured: boolean }>
  /** 官方 MCP 工具（联网搜索/网页读取/Zread）是否启用。 */
  mcpTools: boolean
}
