/** MiniMax Coding Plan capability 的 Host/Client 共用契约。 */

/** 服务工厂内的 MiniMax API 路径。 */
export const MINIMAX_API = {
  status: '/api/dsh-devforge/minimax/status',
  dashboard: '/api/dsh-devforge/minimax/dashboard',
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

/** 一个资源类型（模型/视频等）的一次用量快照。 */
export interface MiniMaxRemainsModel {
  name: string
  /** 是否在当前订阅套餐内（false 时其它数值字段无意义，仅供展示）。 */
  included: boolean
  /** 当前 5 小时窗口剩余百分比（0-100）。 */
  intervalRemainingPercent?: number
  /** 当前周窗口剩余百分比（0-100）。 */
  weeklyRemainingPercent?: number
  /** 5 小时窗口重置时间戳（毫秒）。 */
  intervalEndAt?: number
  /** 周窗口重置时间戳（毫秒）。 */
  weeklyEndAt?: number
}

/** MiniMax 用量看板（一次调用同时拿到 5h 与周维度）。 */
export interface MiniMaxDashboard {
  /** 套餐名（来自 current_subscribe_title 等字段；缺省时为空）。 */
  planName?: string
  /** 每个资源类型一行用量。 */
  models: MiniMaxRemainsModel[]
  fetchedAt: number
  warnings: string[]
}
