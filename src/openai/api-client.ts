/** OpenAI 兼容中转站 HTTP 客户端：模型发现与图片生成。 */

export type ImageMediaType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'

/** 中转站返回的一张已下载图片。 */
export interface OpenAiGeneratedImage {
  data: Uint8Array
  mediaType: ImageMediaType
  model: string
  revisedPrompt?: string
}

/** 中转站模型目录的一条最小记录。 */
export interface OpenAiDiscoveredModel {
  id: string
  name?: string
}

/** 可安全显示给面板或工具的分类错误。 */
export class OpenAiGatewayError extends Error {
  readonly status: number

  constructor(message: string, status = 502) {
    super(message)
    this.name = 'OpenAiGatewayError'
    this.status = status
  }
}

/** 规整用户输入的中转站地址；允许裸主机或以 /v1 结尾的 API 根路径。 */
export function normalizeOpenAiBaseURL(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '')
  if (trimmed === '') return ''
  let url: URL
  try { url = new URL(trimmed) } catch { throw new OpenAiGatewayError('中转站地址不是合法 URL。', 400) }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new OpenAiGatewayError('中转站地址只允许 http 或 https。', 400)
  if (url.username !== '' || url.password !== '') throw new OpenAiGatewayError('中转站地址不能包含用户名或密码。', 400)
  if (url.search !== '' || url.hash !== '') throw new OpenAiGatewayError('中转站地址不能包含查询参数或片段。', 400)
  return url.toString().replace(/\/+$/, '')
}

/** OpenAI 兼容 API 根路径：裸主机自动补 /v1，已带 /v1 时保持不变。 */
export function openAiApiRoot(value: string): string {
  const normalized = normalizeOpenAiBaseURL(value)
  if (normalized === '') return ''
  return /\/v1$/i.test(normalized) ? normalized : normalized + '/v1'
}

/** 规整 OpenAI GET /v1/models 响应，忽略空 id 与重复项。 */
export function parseOpenAiModelList(payload: unknown): OpenAiDiscoveredModel[] {
  if (payload === null || typeof payload !== 'object') return []
  const rows = Array.isArray((payload as { data?: unknown }).data) ? (payload as { data: unknown[] }).data : []
  const seen = new Set<string>()
  const result: OpenAiDiscoveredModel[] = []
  for (const entry of rows) {
    if (entry === null || typeof entry !== 'object') continue
    const row = entry as { id?: unknown; name?: unknown }
    const id = typeof row.id === 'string' ? row.id.trim() : ''
    if (id === '' || seen.has(id)) continue
    seen.add(id)
    const name = typeof row.name === 'string' && row.name.trim() !== '' ? row.name.trim() : undefined
    result.push({ id, ...(name !== undefined ? { name } : {}) })
  }
  return result
}

/** 按魔数判断图片类型；未知格式按 PNG 处理以兼容部分中转站缺失响应头。 */
export function sniffGeneratedImageType(data: Uint8Array): ImageMediaType {
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg'
  if (data.length >= 6 && data[0] === 0x47 && data[1] === 0x49 && data[2] === 0x46) return 'image/gif'
  if (data.length >= 12 && data[0] === 0x52 && data[1] === 0x49 && data[2] === 0x46 && data[8] === 0x57 && data[9] === 0x45 && data[10] === 0x42 && data[11] === 0x50) return 'image/webp'
  return 'image/png'
}

interface ImagesResponseItem { b64_json?: unknown; url?: unknown; revised_prompt?: unknown }

/** 从 images/generations 响应中提取 base64 或 URL。 */
export function extractGeneratedImage(payload: unknown): { data?: Uint8Array; url?: string; revisedPrompt?: string } | undefined {
  if (payload === null || typeof payload !== 'object') return undefined
  const rows = Array.isArray((payload as { data?: unknown }).data) ? (payload as { data: unknown[] }).data : []
  for (const entry of rows) {
    if (entry === null || typeof entry !== 'object') continue
    const row = entry as ImagesResponseItem
    const revisedPrompt = typeof row.revised_prompt === 'string' && row.revised_prompt !== '' ? row.revised_prompt : undefined
    if (typeof row.b64_json === 'string' && row.b64_json !== '') {
      return { data: Buffer.from(row.b64_json, 'base64'), ...(revisedPrompt !== undefined ? { revisedPrompt } : {}) }
    }
    if (typeof row.url === 'string' && row.url !== '') return { url: row.url, ...(revisedPrompt !== undefined ? { revisedPrompt } : {}) }
  }
  return undefined
}

/** 直连通道（绕过环境代理）：懒加载一次，导入失败时保持 undefined 走原通道。 */
type DirectFetch = (url: string, init: Record<string, unknown>) => Promise<Response>
let directFetchPromise: Promise<DirectFetch | undefined> | undefined

/** 用 undici 自带 fetch + 无代理 Agent 构造直连请求，与全局 fetch 的代理分流互不影响。 */
function getDirectFetch(): Promise<DirectFetch | undefined> {
  directFetchPromise ??= (async () => {
    try {
      const undici = (await import('undici')) as unknown as {
        fetch: (url: string, init?: Record<string, unknown>) => Promise<Response>
        Agent: new (options?: Record<string, unknown>) => unknown
      }
      const agent = new undici.Agent({})
      return (url: string, init: Record<string, unknown>) => undici.fetch(url, { ...init, dispatcher: agent }) as unknown as Promise<Response>
    } catch {
      return undefined
    }
  })()
  return directFetchPromise
}

/** 每次请求重新取 Key，避免热更新后继续使用旧凭据。 */
export class OpenAiGatewayClient {
  private readonly baseURL: string
  private readonly resolveApiKey: () => Promise<string>
  private readonly timeoutMs: number

  constructor(baseURL: string, resolveApiKey: () => Promise<string>, timeoutMs: number) {
    this.baseURL = openAiApiRoot(baseURL)
    this.resolveApiKey = resolveApiKey
    this.timeoutMs = timeoutMs
  }

  /** 拉取中转站模型目录。 */
  async fetchModels(signal?: AbortSignal): Promise<OpenAiDiscoveredModel[]> {
    const response = await this.request('/models', { method: 'GET' }, signal, Math.min(this.timeoutMs, 30_000))
    const payload = await this.readJson(response)
    const models = parseOpenAiModelList(payload)
    if (models.length === 0) throw new OpenAiGatewayError('中转站 models 接口未返回有效模型。')
    return models
  }

  /** 调标准 /v1/images/generations，并把 URL 结果下载为受限字节数组。 */
  async generateImage(args: { prompt: string; model: string; size?: string; quality?: string }, signal?: AbortSignal, maxBytes = 20 * 1024 * 1024): Promise<OpenAiGeneratedImage> {
    const response = await this.request('/images/generations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: args.model,
        prompt: args.prompt,
        n: 1,
        response_format: 'b64_json',
        ...(args.size !== undefined && args.size !== 'auto' ? { size: args.size } : {}),
        ...(args.quality !== undefined && args.quality !== 'auto' ? { quality: args.quality } : {}),
      }),
    }, signal, this.timeoutMs)
    const payload = await this.readJson(response)
    const image = extractGeneratedImage(payload)
    if (image === undefined) throw new OpenAiGatewayError('中转站生图接口未返回图片数据。')
    if (image.data !== undefined) {
      if (image.data.byteLength > maxBytes) throw new OpenAiGatewayError('生成图片超过附件大小上限。', 413)
      return { data: image.data, mediaType: sniffGeneratedImageType(image.data), model: args.model, ...(image.revisedPrompt !== undefined ? { revisedPrompt: image.revisedPrompt } : {}) }
    }
    if (image.url === undefined) throw new OpenAiGatewayError('中转站生图接口未返回图片数据。')
    const downloaded = await this.downloadImage(image.url, signal, maxBytes)
    return { ...downloaded, model: args.model, ...(image.revisedPrompt !== undefined ? { revisedPrompt: image.revisedPrompt } : {}) }
  }

  /** 发起带 Bearer 凭据和超时控制的中转站请求。 */
  private async request(path: string, init: RequestInit, signal: AbortSignal | undefined, timeoutMs: number): Promise<Response> {
    if (this.baseURL === '') throw new OpenAiGatewayError('尚未配置 OpenAI 中转站地址。', 400)
    const apiKey = (await this.resolveApiKey()).trim()
    if (apiKey === '') throw new OpenAiGatewayError('尚未配置 OpenAI 中转站 API Key。', 400)
    const controller = new AbortController()
    const abort = (): void => controller.abort()
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted === true) controller.abort()
    const timer = setTimeout(abort, timeoutMs)
    const send = (dispatch: (target: string) => Promise<Response>): Promise<Response> => dispatch(this.baseURL + path).then((response) => {
      if (response.status === 401 || response.status === 403) throw new OpenAiGatewayError('OpenAI 中转站 API Key 无效。', 401)
      if (response.status === 429) throw new OpenAiGatewayError('OpenAI 中转站请求过于频繁，请稍后重试。', 429)
      if (!response.ok) throw new OpenAiGatewayError('OpenAI 中转站接口暂不可用（HTTP ' + response.status + '）。', response.status >= 400 && response.status < 500 ? response.status : 502)
      return response
    })
    const headers = { authorization: 'Bearer ' + apiKey, accept: 'application/json', ...(init.headers ?? {}) }
    try {
      try {
        // 优先直连：环境代理（如 socks5 分流）可能阻断自建中转站（2026-09 sub2api 实证）。
        const direct = await getDirectFetch()
        if (direct !== undefined) {
          return await send((target) => direct(target, { ...init, headers, signal: controller.signal }))
        }
      } catch (error) {
        // HTTP 语义错误（401/429 等）说明端点可达，直接抛出；直连网络错误才回落代理通道。
        if (error instanceof OpenAiGatewayError) throw error
        if (controller.signal.aborted) throw error
      }
      return await send((target) => fetch(target, { ...init, headers, signal: controller.signal }))
    } catch (error) {
      if (error instanceof OpenAiGatewayError) throw error
      if (controller.signal.aborted) throw new OpenAiGatewayError(signal?.aborted === true ? 'OpenAI 中转站请求已取消。' : 'OpenAI 中转站请求超时。', signal?.aborted === true ? 499 : 504)
      throw new OpenAiGatewayError('无法连接 OpenAI 中转站。')
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
    }
  }

  /** 限制 JSON 响应为 4 MiB，防止异常中转站耗尽内存。 */
  private async readJson(response: Response): Promise<unknown> {
    const maxBytes = 4 * 1024 * 1024
    const declared = Number(response.headers.get('content-length'))
    if (Number.isFinite(declared) && declared > maxBytes) throw new OpenAiGatewayError('中转站响应超过安全上限。', 413)
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength > maxBytes) throw new OpenAiGatewayError('中转站响应超过安全上限。', 413)
    try { return JSON.parse(Buffer.from(bytes).toString('utf8')) } catch { throw new OpenAiGatewayError('中转站返回了无法解析的数据。') }
  }

  /** 下载中转站返回的图片 URL，并限制协议、类型和体积。 */
  private async downloadImage(value: string, signal: AbortSignal | undefined, maxBytes: number): Promise<{ data: Uint8Array; mediaType: ImageMediaType }> {
    let url: URL
    try { url = new URL(value) } catch { throw new OpenAiGatewayError('中转站返回了无效图片 URL。') }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new OpenAiGatewayError('中转站返回的图片 URL 协议无效。')
    let response: Response
    try { response = await fetch(url, { signal, redirect: 'follow' }) } catch { throw new OpenAiGatewayError('无法下载中转站生成的图片。') }
    if (!response.ok) throw new OpenAiGatewayError('生成图片下载失败（HTTP ' + response.status + '）。')
    const declared = Number(response.headers.get('content-length'))
    if (Number.isFinite(declared) && declared > maxBytes) throw new OpenAiGatewayError('生成图片超过附件大小上限。', 413)
    const data = new Uint8Array(await response.arrayBuffer())
    if (data.byteLength > maxBytes) throw new OpenAiGatewayError('生成图片超过附件大小上限。', 413)
    return { data, mediaType: sniffGeneratedImageType(data) }
  }
}
