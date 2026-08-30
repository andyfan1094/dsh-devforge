/**
 * Camofox 浏览器 capability 的无密契约。
 *
 * 所有目标均固定为服务工厂配置中的运营服务器，前端与模型都不能传入
 * SSH 主机、端口或 Camofox 鉴权信息。
 */

/** 固定运营浏览器所在的服务工厂 SSH 别名。 */
export const CAMOFOX_DEFAULT_ALIAS = 'my'

/** Camofox 在运营服务器上的本地 API 端口。 */
export const CAMOFOX_API_PORT = 9377

/** Camofox noVNC 在运营服务器上的本地端口。 */
export const CAMOFOX_VNC_PORT = 6080

/** 服务工厂浏览器 API 路由。 */
export const CAMOFOX_API = {
  status: '/api/dsh-devforge/camofox/status',
  visual: '/api/dsh-devforge/camofox/visual',
} as const

/** 面板和 Agent 均可安全读取的服务状态。 */
export interface CamofoxStatus {
  configured: boolean
  reachable: boolean
  browserRunning: boolean
  activeTabs: number
  activeSessions: number
  visualReady: boolean
  message?: string
}

/** 标签页最小公开信息。 */
export interface CamofoxTab {
  tabId: string
  url?: string
  title?: string
}
