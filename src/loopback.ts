/**
 * loopback 信任围栏 —— 与 dsh-winrm/dsh-codebase-memory 同一套实证逻辑。
 * 安全边界：插件全部 HTTP 接口仅接受 127.0.0.1/::1 回环来源。
 */

/** 判断请求是否来自本机回环地址。 */
export function isLoopbackRequest(req: { socket?: { remoteAddress?: string } }): boolean {
  const address = req.socket?.remoteAddress ?? ''
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

/** DSH 桌面壳自定义协议：主界面跑在 dsh-app://app 上，插件 API 由壳代转到宿主。 */
const DESKTOP_SHELL_SCHEME = 'dsh-app:'

/** 桌面壳页面主机名白名单：app=产品主界面，shell=壳自有页面。 */
const DESKTOP_SHELL_HOSTS: readonly string[] = ['app', 'shell']

/** 请求来源是否为可信来源：与请求 Host 同源，或来自 DSH 桌面壳页面。 */
function isTrustedSource(source: string, host: string): boolean {
  try {
    const url = new URL(source)
    if (url.host === host) return true
    return url.protocol === DESKTOP_SHELL_SCHEME && DESKTOP_SHELL_HOSTS.includes(url.hostname)
  } catch {
    return false
  }
}

/**
 * 写操作的「本机 GUI 同源」围栏。
 *
 * 为什么需要它：写接口若只留 loopback 围栏，本机任意网页都能借用用户身份改配置、发消息、删模型。
 *
 * 为什么不能只比对 Origin 与请求 Host：DSH 桌面壳（0.2.0）把产品主界面运行在自定义协议
 * dsh-app://app 上，并把非静态资源请求代转到宿主；代转时会显式删除 origin / host / cookie /
 * sec-fetch-site 四个头，只保留 referer。因此桌面版里写请求到达插件时 Origin 必然缺失、
 * Referer 是 dsh-app://app/…，旧的「来源 host === 请求 Host」判定必然 403——面板表现为
 * 「数据能读到、一保存就 forbidden: same-origin request required」。
 *
 * 判定顺序（任一不满足即拒绝）：
 * 1. 来源必须是 loopback：远程请求与局域网访问一律不收。
 * 2. Origin 存在时以 Origin 为准（浏览器对非 GET 请求必定附带 Origin，且网页无法伪造成
 *    dsh-app://app）：与请求 Host 同源、或来自桌面壳页面才放行。
 * 3. Origin 缺失时退回 Referer 判断，覆盖桌面壳代转场景。
 * 4. Origin 与 Referer 都缺失：视作本机非浏览器客户端（脚本、CLI、诊断工具），
 *    loopback 已由第 1 步保证——浏览器不存在「非 GET 写请求两者皆无」的情况。
 * 5. sec-fetch-site: cross-site 直接拒绝，作为跨站写入的兜底防线。
 *
 * @param req - Node 请求对象（读取 socket.remoteAddress 与 headers）。
 * @returns 是否允许执行写操作。
 */
export function isGuiSameOriginRequest(req: {
  socket?: { remoteAddress?: string }
  headers: Record<string, string | string[] | undefined>
}): boolean {
  if (!isLoopbackRequest(req)) return false
  if (req.headers['sec-fetch-site'] === 'cross-site') return false
  const host = req.headers.host
  if (typeof host !== 'string' || host === '') return false
  const origin = req.headers.origin
  if (typeof origin === 'string' && origin !== '') return isTrustedSource(origin, host)
  const referer = req.headers.referer
  if (typeof referer === 'string' && referer !== '') return isTrustedSource(referer, host)
  return true
}
