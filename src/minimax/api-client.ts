/** MiniMax Coding Plan 官方 HTTP API 轻量客户端（官方直连，无第三方依赖）。 */
import type { MiniMaxSearchResult } from './protocol.ts'

/** 可直接呈现给模型的调用失败；消息已脱敏。 */
export class MiniMaxApiError extends Error {
  /** HTTP 语义状态码（映射给面板/工具层使用）。 */
  readonly status: number

  constructor(message: string, status = 502) {
    super(message)
    this.name = 'MiniMaxApiError'
    this.status = status
  }
}

/** 脱敏错误文本：绝不把 Bearer Key 带进错误消息或日志。 */
export function safeApiError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  return raw.replace(/Bearer\s+[^\s]+/gi, 'Bearer [redacted]').slice(0, 300)
}

/** 官方 base_resp 状态码映射为稳定、脱敏的错误。 */
export function describeBaseResp(code: number, message: string): MiniMaxApiError {
  if (code === 1004) return new MiniMaxApiError('MiniMax API Key 无效，或与站点地区不匹配（国内/国际需一致）。', 401)
  if (code === 2038) return new MiniMaxApiError('MiniMax 账号需先在开放平台完成实名认证。', 403)
  if (code === 2013) return new MiniMaxApiError('MiniMax 接口参数无效：' + message, 400)
  if (code === 1026) return new MiniMaxApiError('MiniMax 拒绝了输入内容（图片不可读或疑似敏感）。', 400)
  return new MiniMaxApiError('MiniMax 接口返回错误（' + code + '）：' + message)
}

/** 单客户端绑定官方国内站域名；凭据每次请求重新解析，Key 更新无需重启。 */
export class MiniMaxApiClient {
  /** 上游固定为官方 HTTPS 域名，避免自定义地址带走 API Key；仅供单测注入 mock 地址。 */
  private readonly baseURL: string
  /** 每次请求重新解析受管凭据，Key 更新无需重启。 */
  private readonly resolveApiKey: () => Promise<string>
  /** 单请求超时（毫秒）。 */
  private readonly timeoutMs: number

  constructor(resolveApiKey: () => Promise<string>, timeoutMs = 30000, baseURL = 'https://api.minimaxi.com') {
    this.resolveApiKey = resolveApiKey
    this.timeoutMs = timeoutMs
    this.baseURL = baseURL
  }

  /** 联网搜索（官方 q 参数），返回规整结果。 */
  async search(query: string): Promise<MiniMaxSearchResult> {
    const data = await this.post('/v1/coding_plan/search', { q: query })
    return parseSearchResult(data)
  }

  /** 图像理解；imageDataUrl 必须是 data:image/...;base64, 形式。 */
  async understandImage(prompt: string, imageDataUrl: string): Promise<string> {
    const data = await this.post('/v1/coding_plan/vlm', { prompt, image_url: imageDataUrl })
    const content = typeof data.content === 'string' ? data.content : ''
    if (content === '') throw new MiniMaxApiError('MiniMax 视觉接口返回空内容。')
    return content
  }

  /** POST JSON 并按官方 base_resp 约定解析。 */
  private async post(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const apiKey = await this.resolveApiKey()
    let response: Response
    try {
      response = await fetch(this.baseURL + path, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + apiKey,
          // 与官方 MCP 客户端保持同一来源标识。
          'MM-API-Source': 'Minimax-MCP',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch (error) {
      throw new MiniMaxApiError('MiniMax 接口不可达：' + safeApiError(error))
    }
    if (!response.ok) {
      const text = safeApiError(await response.text().catch(() => ''))
      await response.body?.cancel().catch(() => undefined)
      throw new MiniMaxApiError('MiniMax 接口 HTTP ' + response.status + '：' + (text || '无响应体'), response.status === 401 ? 401 : 502)
    }
    const text = await readResponseText(response)
    let payload: unknown
    try { payload = JSON.parse(text) } catch { throw new MiniMaxApiError('MiniMax 接口返回了无法解析的数据。') }
    if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new MiniMaxApiError('MiniMax 接口返回了意外结构。')
    }
    const record = payload as { base_resp?: { status_code?: unknown; status_msg?: unknown }; content?: unknown }
    const code = typeof record.base_resp?.status_code === 'number' ? record.base_resp.status_code : 0
    if (code !== 0) {
      throw describeBaseResp(code, typeof record.base_resp?.status_msg === 'string' ? record.base_resp.status_msg : '')
    }
    return record
  }
}

/** 按字节流式读取响应，超过 4 MiB 立即取消，避免无界内存占用。 */
async function readResponseText(response: Response): Promise<string> {
  const maxBytes = 4 * 1024 * 1024
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel()
    throw new MiniMaxApiError('MiniMax 接口响应超过安全上限。')
  }
  if (response.body === null) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const part = await reader.read()
    if (part.done) break
    total += part.value.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      throw new MiniMaxApiError('MiniMax 接口响应超过安全上限。')
    }
    chunks.push(part.value)
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), total).toString('utf8')
}

/** 规整官方搜索响应为稳定结构（忽略不完整字段）。 */
export function parseSearchResult(data: Record<string, unknown>): MiniMaxSearchResult {
  const items: MiniMaxSearchResult['items'] = []
  const organic = Array.isArray(data.organic) ? data.organic : []
  for (const entry of organic) {
    if (entry === null || typeof entry !== 'object') continue
    const row = entry as { title?: unknown; link?: unknown; snippet?: unknown; date?: unknown }
    if (typeof row.title !== 'string' || typeof row.link !== 'string') continue
    items.push({
      title: row.title,
      link: row.link,
      snippet: typeof row.snippet === 'string' ? row.snippet : '',
      ...(typeof row.date === 'string' && row.date !== '' ? { date: row.date } : {}),
    })
  }
  const related: string[] = []
  const suggestions = Array.isArray(data.related_searches) ? data.related_searches : []
  for (const entry of suggestions) {
    if (entry === null || typeof entry !== 'object') continue
    const query = (entry as { query?: unknown }).query
    if (typeof query === 'string' && query !== '') related.push(query)
  }
  return { items, related }
}

/** 把搜索结果渲染成紧凑的模型友好文本。 */
export function formatSearchResult(result: MiniMaxSearchResult): string {
  const lines: string[] = []
  result.items.forEach((item, index) => {
    const date = item.date !== undefined ? '（' + item.date + '）' : ''
    lines.push((index + 1) + '. ' + item.title + date)
    lines.push('   ' + item.link)
    if (item.snippet !== '') lines.push('   ' + item.snippet)
  })
  if (result.related.length > 0) lines.push('相关搜索：' + result.related.join('、'))
  return lines.join('\n')
}
