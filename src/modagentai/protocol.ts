/** 官网账号（modagentai.com）接入：API 路径与类型（辉哥 2026-09-22 定稿：个人中心登录 + 自动配置中转）。 */

/** 面板 API 路径（loopback + 同源写围栏，与其它模块同规矩）。 */
export const MODAGENTAI_API = {
  status: '/api/dsh-devforge/modagentai/status',
  packages: '/api/dsh-devforge/modagentai/packages',
  login: '/api/dsh-devforge/modagentai/login',
  logout: '/api/dsh-devforge/modagentai/logout',
  applyGateway: '/api/dsh-devforge/modagentai/apply-gateway',
} as const

/** 官网站点与用户级网关（OpenAI 兼容）地址。 */
export const MODAGENTAI_SITE = 'https://modagentai.com'
export const MODAGENTAI_GW_BASE = 'https://modagentai.com/api/gw/v1'

/** 受管凭据引用：官网会话令牌（即中转 API Key）与端点密钥引用。 */
export const MODAGENTAI_SESSION_REF = 'MODAGENTAI_SESSION_TOKEN'
export const MODAGENTAI_GW_KEY_REF = 'MODAGENTAI_GW_API_KEY'

/** OpenAI 中转端点列表里的固定端点 id。 */
export const MODAGENTAI_ENDPOINT_ID = 'modagentai'

/** 官网账号登录态（含中转自动配置状态）。 */
export interface ModagentaiStatus {
  loggedIn: boolean
  username: string
  /** 'admin' 才能看到 Coding Plan 页签。 */
  role: '' | 'admin' | 'user'
  /** 会话令牌是否已失效（登录过但官网校验不过）。 */
  expired: boolean
  /** 中转端点是否已自动写入并同步模型。 */
  autoApplied: boolean
  appliedModels: number
}

/** 套餐实例行（官网 gem_packs 视角）：剩余/总量/激活态。 */
export interface ModagentaiPackRow {
  packKey: string
  gemsTotal: number
  gemsLeft: number
  active: boolean
  activatedAt?: string
  expiresAt?: string
}

/** 套餐用量视图（辉哥 2026-09-23 定稿：插件采用用户登录后，侧栏看板显示「什么套餐/总量/剩余」）。 */
export interface ModagentaiPackages {
  loggedIn: boolean
  /** 会话失效（曾登录但官网 401）。 */
  expired?: boolean
  username?: string
  balance?: number
  costPerSearch?: number
  searchesLeft?: number
  /** 套餐目录（name/ico/days 映射用，官网 GEM_PACKS 原样）。 */
  catalog?: Array<{ key: string; name: string; ico: string; days: number }>
  /** 我的套餐实例（官网 listPacks 序）。 */
  mine?: ModagentaiPackRow[]
}

/** 登录结果：登录即自动配置中转，失败时 gatewayApplied=false 并给出原因。 */
export interface ModagentaiLoginResult {
  status: ModagentaiStatus
  gatewayApplied: boolean
  gatewayModels: number
  message: string
}
