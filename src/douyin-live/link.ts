/** 抖音直播链接的纯校验与公开房间号提取；客户端和 Host 共用，避免两端规则漂移。 */
const PUBLIC_ROOM_ID = /^\d{1,20}$/
const SHORT_LINK_PATH = /^\/[^/?#]+\/?$/

/** Host 解析公开抖音链接时允许访问的固定站点。 */
export const DOUYIN_ALLOWED_HOSTS = new Set([
  'v.douyin.com',
  'live.douyin.com',
  'www.douyin.com',
  'www.iesdouyin.com',
  'webcast.amemv.com',
])

/** 判断一个值是否为可用于接收器 WebSocket 路径的公开房间号。 */
export function isDouyinPublicRoomId(value: unknown): value is string {
  return typeof value === 'string' && PUBLIC_ROOM_ID.test(value)
}

/**
 * 从已校验的抖音 URL 中提取公开房间号；分享短链没有房间号时返回空值，
 * 由 Host 继续逐跳读取公开页面，绝不把内部 room_id 当作连接地址。
 */
export function publicRoomIdFromDouyinUrl(url: URL): string | undefined {
  const livePath = url.pathname.match(/^\/(\d{1,20})\/?$/)
  if (url.hostname === 'live.douyin.com' && livePath?.[1]) return livePath[1]
  const webRid = url.searchParams.get('webRid') ?? url.searchParams.get('web_rid')
  if (isDouyinPublicRoomId(webRid)) return webRid
  return undefined
}

/** 判断 URL 是否应由抖音直播侧栏接管，而不是交给通用浏览器标签页。 */
export function isDouyinLiveUrl(url: URL): boolean {
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !DOUYIN_ALLOWED_HOSTS.has(url.hostname)) {
    return false
  }
  if (publicRoomIdFromDouyinUrl(url) !== undefined) return true
  return url.hostname === 'v.douyin.com' && SHORT_LINK_PATH.test(url.pathname)
}
