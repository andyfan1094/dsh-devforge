/** 房间标识解析：只请求抖音公开分享页，逐跳校验，绝不代理任意 URL。 */
import { DOUYIN_ALLOWED_HOSTS, publicRoomIdFromDouyinUrl } from './link.ts'

/** 输入错误可安全展示；底层网络异常由服务统一脱敏。 */
export class DouyinInputError extends Error {}

/** 拒绝带凭据、非 HTTPS、非标准端口及非白名单站点的 URL。 */
function checkedUrl(value: string, base?: URL): URL {
  let url: URL
  try { url = new URL(value, base) } catch { throw new DouyinInputError('请输入直播间号码或抖音直播链接。') }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !DOUYIN_ALLOWED_HOSTS.has(url.hostname)) {
    throw new DouyinInputError('仅支持 HTTPS 抖音直播或分享链接。')
  }
  return url
}

/** 只认公开 webRid，不将内部 room_id 误用为 WebSocket 路径。 */
function roomFromUrl(url: URL): string | undefined {
  return publicRoomIdFromDouyinUrl(url)
}

/** 解析数字、直播直链及分享文案；网络总时限由调用方 signal 控制。 */
export async function resolveDouyinRoom(input: unknown, signal: AbortSignal, request: typeof fetch = fetch): Promise<string> {
  if (typeof input !== 'string' || !input.trim() || input.length > 2048) throw new DouyinInputError('房间输入不能为空且不能超过 2048 字符。')
  const text = input.trim()
  if (/^\d{1,20}$/.test(text)) return text
  const match = text.match(/https:\/\/[^\s<>"，。]+/)
  let url = checkedUrl(match?.[0] ?? text)
  for (let hop = 0; hop < 5; hop += 1) {
    const direct = roomFromUrl(url)
    if (direct) return direct
    const response = await request(url, { redirect: 'manual', signal, headers: { 'user-agent': 'Mozilla/5.0' } })
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel()
      const location = response.headers.get('location')
      if (!location) break
      url = checkedUrl(location, url)
      continue
    }
    if (!response.ok) { await response.body?.cancel(); break }
    const reader = response.body?.getReader()
    if (!reader) break
    const parts: Uint8Array[] = []
    let bytes = 0
    try {
      while (true) {
        const chunk = await reader.read()
        if (chunk.done) break
        bytes += chunk.value.byteLength
        if (bytes > 2 * 1024 * 1024) throw new DouyinInputError('分享页过大，请改填直播间号码。')
        parts.push(chunk.value)
      }
    } finally { await reader.cancel() }
    // 分享页的 JSON 有时被嵌在转义脚本中，只抽取公开数字字段，不执行页面脚本。
    const html = Buffer.concat(parts).toString('utf8').replaceAll('\\"', '"')
    const embedded = html.match(/"(?:webRid|web_rid)"\s*:\s*"?(\d{1,20})(?:"|[,}\s])/)
    if (embedded?.[1]) return embedded[1]
    break
  }
  throw new DouyinInputError('无法解析公开直播间号码，请粘贴 live.douyin.com 直播直链或号码。')
}
