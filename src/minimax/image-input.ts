/** 工具图像输入规整：统一转成官方 vlm 接口可用的 base64 data URL（仅 JPEG/PNG/WebP）。 */
import { readFile } from 'node:fs/promises'

/** 官方支持且本插件放行的图片类型。 */
const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp'])

/** 输入图片字节上限（8 MiB，base64 前）。 */
const MAX_BYTES = 8 * 1024 * 1024

/** 图片输入不合法（参数级错误，不重试）。 */
export class ImageInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ImageInputError'
  }
}

/** 通过 magic bytes 嗅探图片类型，不信任外部 content-type。 */
export function sniffImageMime(bytes: Uint8Array): string | undefined {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png'
  if (bytes.length >= 12 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp'
  return undefined
}

/** 把 data URL / http(s) URL / 本地路径统一转为官方可用的 data:image/...;base64,...。 */
export async function toImageDataUrl(source: string): Promise<string> {
  const trimmed = source.trim()
  if (trimmed === '') throw new ImageInputError('图片来源为空。')
  if (/^data:/i.test(trimmed)) {
    const match = /^data:([a-z]+\/[a-z0-9.+-]+);base64,/i.exec(trimmed)
    if (match === null) throw new ImageInputError('data URL 格式无效，需为 base64 图片。')
    if (!ALLOWED.has(match[1].toLowerCase())) throw new ImageInputError('不支持的图片类型 ' + match[1] + '，仅支持 JPEG/PNG/WebP。')
    if (trimmed.length > Math.ceil(MAX_BYTES / 3) * 4 + 64) throw new ImageInputError('图片超过 8 MiB 上限。')
    return trimmed
  }
  if (/^https?:\/\//i.test(trimmed)) {
    let response: Response
    try {
      response = await fetch(trimmed, { signal: AbortSignal.timeout(20000), redirect: 'follow' })
    } catch (error) {
      throw new ImageInputError('图片下载失败：' + (error instanceof Error ? error.message : String(error)))
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined)
      throw new ImageInputError('图片下载失败（HTTP ' + response.status + '）。')
    }
    const bytes = await readLimited(response.body, response.headers.get('content-length'))
    const mime = sniffImageMime(bytes)
    if (mime === undefined) throw new ImageInputError('下载内容不是 JPEG/PNG/WebP 图片。')
    return toDataUrl(mime, bytes)
  }
  let bytes: Buffer
  try {
    bytes = await readFile(trimmed)
  } catch {
    throw new ImageInputError('无法读取本机图片文件：' + trimmed)
  }
  if (bytes.byteLength > MAX_BYTES) throw new ImageInputError('图片超过 8 MiB 上限。')
  const mime = sniffImageMime(bytes)
  if (mime === undefined) throw new ImageInputError('文件内容不是 JPEG/PNG/WebP 图片。')
  return toDataUrl(mime, bytes)
}

/** 编码为 data URL。 */
function toDataUrl(mime: string, bytes: Uint8Array): string {
  return 'data:' + mime + ';base64,' + Buffer.from(bytes).toString('base64')
}

/** 流式读取响应体，超过上限立即取消。 */
async function readLimited(body: ReadableStream<Uint8Array> | null, contentLength: string | null): Promise<Uint8Array> {
  const declared = Number(contentLength)
  if (Number.isFinite(declared) && declared > MAX_BYTES) {
    await body?.cancel().catch(() => undefined)
    throw new ImageInputError('图片超过 8 MiB 上限。')
  }
  if (body === null) throw new ImageInputError('图片响应没有内容。')
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const part = await reader.read()
    if (part.done) break
    total += part.value.byteLength
    if (total > MAX_BYTES) {
      await reader.cancel()
      throw new ImageInputError('图片超过 8 MiB 上限。')
    }
    chunks.push(part.value)
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), total)
}
