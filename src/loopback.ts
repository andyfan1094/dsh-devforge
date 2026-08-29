/**
 * loopback 信任围栏 —— 与 dsh-winrm/dsh-codebase-memory 同一套实证逻辑。
 * 安全边界：插件全部 HTTP 接口仅接受 127.0.0.1/::1 回环来源。
 */

/** 判断请求是否来自本机回环地址。 */
export function isLoopbackRequest(req: { socket?: { remoteAddress?: string } }): boolean {
  const address = req.socket?.remoteAddress ?? ''
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}
