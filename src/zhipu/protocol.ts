/** 智谱 Coding Plan capability 的 Host/Client 共用契约。 */

/** 天工造梦内的智谱 API 路径。 */
export const ZHIPU_API = {
  status: '/api/dsh-devforge/zhipu/status',
  dashboard: '/api/dsh-devforge/zhipu/dashboard',
  /** 按 Key 批量查询用量：一次请求返回池内每把已配置 Key 的独立卡片数据。 */
  dashboards: '/api/dsh-devforge/zhipu/dashboards',
  setup: '/api/dsh-devforge/zhipu/setup',
  fetchModels: '/api/dsh-devforge/zhipu/fetch-models',
  setPrimary: '/api/dsh-devforge/zhipu/set-primary',
  keysAdd: '/api/dsh-devforge/zhipu/keys/add',
  keysRemove: '/api/dsh-devforge/zhipu/keys/remove',
  keysRename: '/api/dsh-devforge/zhipu/keys/rename',
  /** 官方 API 直调（开放平台）：补齐 provider 与默认模型。 */
  officialSetup: '/api/dsh-devforge/zhipu/official/setup',
  /** 官方 API 直调（开放平台）：先验证后保存官方 API Key。 */
  officialKeySave: '/api/dsh-devforge/zhipu/official/key',
  /** 官方 API 直调（开放平台）：从官方拉取最新模型清单合并进 provider。 */
  officialFetchModels: '/api/dsh-devforge/zhipu/official/fetch-models',
} as const

/** 智谱官方开放平台（按量付费）聊天路由 provider id。 */
export const ZHIPU_OFFICIAL_PROVIDER_ID = 'zhipu-official'

/** 智谱官方开放平台固定数据面端点：绝不随配置漂移，避免 Key 被引到未知地址。 */
export const ZHIPU_OFFICIAL_BASE_URL = 'https://open.bigmodel.cn/api/paas/v4'

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
  /** 本次数据实际使用的受管凭据引用名（多 Key 池下标明数据归属）。 */
  keyEnv?: string
}

/** 官方 MCP 工具描述（tools/list 规整后）。 */
export interface ZhipuMcpToolDescriptor {
  /** 官方原始工具名。 */
  name: string
  /** 官方工具说明。 */
  description: string
}

/** 一把池内 Key 的脱敏描述。
 * Key 池是用户维护的独立命名列表：名称（label）由用户自定义，
 * 引用名（ref）指向受管凭据；主 Key 只是列表中的一个标记
 * （聊天模型路由 zai-coding-cn 当前指向它），切换主 Key 不会增删池成员。 */
export interface ZhipuPoolKey {
  /** 池内稳定 id（存储主键，前端操作按 id 定位）。 */
  id: string
  /** 用户自定义名称（如「主力号」「备用号A」）。 */
  label: string
  /** 受管凭据引用名。 */
  ref: string
  /** 是否已配置（可参与解析与切换）。 */
  configured: boolean
  /** 是否为主 Key（聊天模型路由当前使用的引用）。 */
  primary: boolean
}

/** 按 Key 查询的用量卡片数据（单把 Key 独立成功或失败，互不影响）。 */
export interface ZhipuKeyUsage {
  /** 池条目 id（与 ZhipuPoolKey.id 对应）。 */
  id: string
  /** 用户自定义名称。 */
  label: string
  /** 受管凭据引用名。 */
  ref: string
  /** 是否为主 Key。 */
  primary: boolean
  /** 该把 Key 的官方查询是否成功。 */
  ok: boolean
  /** 失败时的可读错误（不含 Key 明文）。 */
  error?: string
  /** 成功时的完整看板（keyEnv 恒等于本条 ref）。 */
  dashboard?: ZhipuDashboard
}

/** 官方 API 直调（开放平台）的脱敏状态：与 Coding Plan Key 池相互独立。 */
export interface ZhipuOfficialStatus {
  /** 官方 API Key 的受管凭据引用名。 */
  credentialEnv: string
  /** 官方 API Key 是否已配置。 */
  credentialConfigured: boolean
  /** 官方 provider 是否已写入模型路由。 */
  providerConfigured: boolean
  /** 固定官方接入端点（信息展示用）。 */
  baseURL: string
  /** 官方 provider 模型清单。 */
  models: Array<{ id: string; configured: boolean }>
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
  /** Key 池清单（用户命名列表；主 Key 在前，其余按维护顺序）。 */
  keys: ZhipuPoolKey[]
  /** 官方 API 直调（开放平台按量付费）状态。 */
  official: ZhipuOfficialStatus
}
