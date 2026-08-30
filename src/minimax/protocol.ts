/** MiniMax Coding Plan capability 的 Host/Client 共用契约。 */

/** 服务工厂内的 MiniMax API 路径。 */
export const MINIMAX_API = {
  status: '/api/dsh-devforge/minimax/status',
  setup: '/api/dsh-devforge/minimax/setup',
} as const

/** 凭据与模型路由的脱敏状态（不含任何 Key）。 */
export interface MiniMaxStatus {
  enabled: boolean
  credentialConfigured: boolean
  credentialWritable: boolean
  providerConfigured: boolean
  models: Array<{ id: string; configured: boolean }>
  /** 官方工具（联网搜索/图像理解）是否启用。 */
  tools: boolean
}

/** 搜索结果一条（官方 organic 规整后）。 */
export interface MiniMaxSearchItem {
  title: string
  link: string
  snippet: string
  date?: string
}

/** 搜索结果规整输出。 */
export interface MiniMaxSearchResult {
  items: MiniMaxSearchItem[]
  related: string[]
}
