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
