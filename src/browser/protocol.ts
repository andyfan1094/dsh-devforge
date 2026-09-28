/**
 * 本地浏览器 capability（Playwright MCP）的无密契约。
 *
 * 浏览器进程直接运行在本机，用户在自己的屏幕上实时看到全部操作；
 * 固定用户档案目录跨重启保存登录状态；契约里没有任何端口、令牌或远程主机字段。
 */

/** 天工造梦浏览器面板 API 路由（仅本机 GUI 可访问）。 */
export const BROWSER_API = {
  status: '/api/dsh-devforge/browser/status',
  navigate: '/api/dsh-devforge/browser/navigate',
  snapshot: '/api/dsh-devforge/browser/snapshot',
  screenshot: '/api/dsh-devforge/browser/screenshot',
  stop: '/api/dsh-devforge/browser/stop',
  settings: '/api/dsh-devforge/browser/settings',
} as const

/** 面板和 Agent 均可安全读取的浏览器状态。 */
export interface BrowserStatus {
  /** 能力是否已启用。 */
  enabled: boolean
  /** playwright-mcp 子进程是否存活。 */
  running: boolean
  /** MCP 握手是否完成（可用工具调用）。 */
  ready: boolean
  /** 当前页地址（就绪时存在）。 */
  currentUrl?: string
  /** 当前页标题（就绪时存在）。 */
  pageTitle?: string
  /** 持久化用户档案目录（登录状态保存位置）。 */
  profileDir: string
  message?: string
}

/**
 * 面板「本地浏览器」页的开关视图（不含任何凭据与宿主路径）。
 *
 * 为什么是两个开关（2026-09-28 辉哥定）：浏览器基础工具只做"看和点"，
 * 失败只影响自己，默认开启让新装用户开箱即用；闲鱼/小红书发布类工具会把内容
 * 真实发出去，属于不可撤销动作，默认关闭并必须由用户在面板显式开启。
 */
export interface BrowserSettingsView {
  /** 浏览器基础工具（browser_*）开关。 */
  enabled: boolean
  /** 闲鱼/小红书发布类工具开关。 */
  publish: boolean
}

/** 面板保存浏览器的增量补丁：字段缺省表示保持原值。 */
export type BrowserSettingsPatch = Partial<BrowserSettingsView>

/** URL 安全校验：只允许 http(s) 地址交给本地浏览器打开。 */
export function isSafeHttpUrl(value: unknown): boolean {
  if (typeof value !== 'string' || value === '') return false
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}
