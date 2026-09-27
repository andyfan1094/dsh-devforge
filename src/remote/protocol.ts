/**
 * 远程访问网关协议（0.41.0 面板页）：天工造梦面板「远程访问」页签的数据契约。
 *
 * 密码边界：Host 永不把密码原文回传浏览器——GET 只带 hasPassword；
 * PUT 的 password 留空表示保留已存密码（与 GitHub 账号保存同款约定）。
 */

/** 面板路由前缀（loopback 围栏内）。 */
export const GATEWAY_API = {
  settings: '/api/dsh-devforge/gateway/settings',
} as const

/** Host 内部配置形态（含密码原文；仅内存与 store.db 使用）。 */
export type GatewaySettingsInput = {
  enabled: boolean
  port: number
  host: string
  upstreamPort: number
  sessionHours: number
  password: string
}

/** 面板读到的网关配置视图（密码脱敏）。 */
export type GatewaySettingsView = Omit<GatewaySettingsInput, 'password'> & {
  /** 是否已设置密码（原文永不出 Host）。 */
  hasPassword: boolean
}

/** 面板运行状态。 */
export interface GatewayRuntimeView {
  running: boolean
  /** 实际监听端口（与配置端口一致；未运行为 undefined）。 */
  listeningPort?: number
}

/** 面板保存请求：password 留空 = 保留旧值。 */
export interface GatewaySettingsPatch {
  enabled?: boolean
  port?: number
  host?: string
  password?: string
  upstreamPort?: number
  sessionHours?: number
}
