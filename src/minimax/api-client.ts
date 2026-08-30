/** MiniMax Coding Plan 官方 HTTP API 轻量客户端（官方直连，无第三方依赖）。 */
import type { MiniMaxDashboard, MiniMaxRemainsModel, MiniMaxSearchResult } from './protocol.ts'

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

  /** 查询订阅套餐用量（5h + 周）；返回规整后看板数据。 */
  async fetchRemains(options: { signal?: AbortSignal } = {}): Promise<MiniMaxDashboard> {
    const data = await this.get('/v1/token_plan/remains', options.signal)
    return parseRemainsPayload(data)
  }

  /** 调用官方接口（GET 或 POST JSON），按 base_resp 约定解析。 */
  private async request(method: 'GET' | 'POST', path: string, body?: Record<string, unknown>, signal?: AbortSignal): Promise<Record<string, unknown>> {
    const apiKey = await this.resolveApiKey()
    const headers: Record<string, string> = {
      'Authorization': 'Bearer ' + apiKey,
      // 与官方 MCP 客户端保持同一来源标识。
      'MM-API-Source': 'Minimax-MCP',
    }
    if (method === 'POST') {
      headers['Content-Type'] = 'application/json'
    } else {
      headers['Accept'] = 'application/json'
    }
    const controller = new AbortController()
    const abort = (): void => controller.abort()
    signal?.addEventListener('abort', abort, { once: true })
    const timer = setTimeout(abort, this.timeoutMs)
    let response: Response
    try {
      response = await fetch(this.baseURL + path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      })
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw new MiniMaxApiError('MiniMax 接口请求超时或被取消。', 504)
      throw new MiniMaxApiError('MiniMax 接口不可达：' + safeApiError(error))
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
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

  private async post(path: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<Record<string, unknown>> {
    return await this.request('POST', path, body, signal)
  }

  private async get(path: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
    return await this.request('GET', path, undefined, signal)
  }

  /** 文本生成图片：返回官方 image_urls 数组。 */
  async imageGeneration(prompt: string, options: { model?: string; width?: number; height?: number; referenceImages?: string[]; signal?: AbortSignal } = {}): Promise<string[]> {
    const payload: Record<string, unknown> = { prompt }
    if (options.model !== undefined) payload.model = options.model
    if (options.width !== undefined) payload.width = options.width
    if (options.height !== undefined) payload.height = options.height
    if (Array.isArray(options.referenceImages) && options.referenceImages.length > 0) payload.reference_images = options.referenceImages
    const data = await this.post('/v1/image_generation', payload, options.signal)
    const urls = Array.isArray((data as { data?: unknown }).data) ? (data as { data: unknown[] }).data : []
    const inner = (data as { data?: { image_urls?: unknown } }).data
    const list = Array.isArray(inner?.image_urls) ? inner.image_urls : []
    if (Array.isArray(list) && list.length > 0) return list.filter((value): value is string => typeof value === 'string')
    return urls.filter((value): value is string => typeof value === 'string')
  }

  /** 同步文本转语音：返回十六进制编码的音频字节（hex string）。 */
  async textToSpeech(text: string, options: { model?: string; voiceId?: string; speed?: number; pitch?: number; format?: string; sampleRate?: number; bitrate?: number; signal?: AbortSignal } = {}): Promise<{ hex: string; mime: string; bytes: number }> {
    const voiceSetting: Record<string, unknown> = {}
    if (options.voiceId !== undefined) voiceSetting.voice_id = options.voiceId
    if (options.speed !== undefined) voiceSetting.speed = options.speed
    if (options.pitch !== undefined) voiceSetting.pitch = options.pitch
    const audioSetting: Record<string, unknown> = {}
    if (options.format !== undefined) audioSetting.format = options.format
    if (options.sampleRate !== undefined) audioSetting.sample_rate = options.sampleRate
    if (options.bitrate !== undefined) audioSetting.bitrate = options.bitrate
    const payload: Record<string, unknown> = { text, stream: false }
    if (options.model !== undefined) payload.model = options.model
    if (Object.keys(voiceSetting).length > 0) payload.voice_setting = voiceSetting
    if (Object.keys(audioSetting).length > 0) payload.audio_setting = audioSetting
    const data = await this.post('/v1/t2a_v2', payload, options.signal)
    const inner = (data as { data?: unknown }).data
    const dataObj = (inner !== null && typeof inner === 'object') ? inner as { audio?: unknown; audio_hex?: unknown; mime_type?: unknown } : {}
    const hex = typeof dataObj.audio === 'string' ? dataObj.audio : (typeof dataObj.audio_hex === 'string' ? dataObj.audio_hex : '')
    if (hex === '') throw new MiniMaxApiError('MiniMax 语音接口返回为空。')
    const mime = typeof dataObj.mime_type === 'string' ? dataObj.mime_type : 'audio/mpeg'
    return { hex, mime, bytes: hex.length / 2 }
  }

  /** 创建视频生成任务（异步）。返回 task_id；后续用 queryVideoGeneration 查进度。 */
  async createVideoGeneration(prompt: string, options: { model?: string; duration?: number; resolution?: string; firstFrameImage?: string; lastFrameImage?: string; signal?: AbortSignal } = {}): Promise<{ taskId: string }> {
    const payload: Record<string, unknown> = { prompt }
    if (options.model !== undefined) payload.model = options.model
    const parameters: Record<string, unknown> = {}
    if (options.duration !== undefined) parameters.duration = options.duration
    if (options.resolution !== undefined) parameters.resolution = options.resolution
    if (Object.keys(parameters).length > 0) payload.parameters = parameters
    const content: Array<Record<string, unknown>> = []
    if (options.firstFrameImage !== undefined) content.push({ type: 'first_frame', image_url: options.firstFrameImage })
    if (options.lastFrameImage !== undefined) content.push({ type: 'last_frame', image_url: options.lastFrameImage })
    if (content.length > 0) {
      payload.content = content
    }
    const data = await this.post('/v1/video_generation', payload, options.signal)
    const taskId = (data as { task_id?: unknown }).task_id
    if (typeof taskId !== 'string' || taskId === '') throw new MiniMaxApiError('MiniMax 视频生成任务创建失败。')
    return { taskId }
  }

  /** 查询视频生成任务状态。 */
  async queryVideoGeneration(taskId: string, options: { signal?: AbortSignal } = {}): Promise<{ status: string; fileId?: string; videoUrl?: string; raw: Record<string, unknown> }> {
    const data = await this.get('/v1/query/video_generation?task_id=' + encodeURIComponent(taskId), options.signal)
    const status = (data as { status?: unknown }).status
    const fileId = (data as { file_id?: unknown }).file_id
    const raw = (data as { data?: unknown }).data
    let videoUrl: string | undefined
    if (raw !== null && typeof raw === 'object') {
      const url = (raw as { video_url?: unknown }).video_url
      if (typeof url === 'string') videoUrl = url
    }
    return {
      status: typeof status === 'string' ? status : 'unknown',
      ...(typeof fileId === 'string' && fileId !== '' ? { fileId } : {}),
      ...(videoUrl !== undefined ? { videoUrl } : {}),
      raw: data,
    }
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

/** 官方 base_resp 鉴权失败消息（订阅 Key 与普通 API Key 不能混用）。 */
const AUTH_HINT = 'MiniMax Key 无效或不是订阅 Key。订阅用量查询必须使用订阅 Key，不能使用普通按量付费 API Key。'

/** 判断是否鉴权失败（提示文本或 1004 错误码）。 */
function isAuthFailure(code: number, message: string): boolean {
  if (code === 1004) return true
  return /cookie is missing|log in again|unauthorized|invalid api key|invalid token/i.test(message)
}

/** 仅接纳有限数值，阻止异常响应把 NaN/Infinity 带到前端。 */
function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** 在多个候选键中按顺序取值。 */
function pickNumber(row: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = finiteNumber(row[key])
    if (value !== undefined) return value
  }
  return undefined
}

/** 把候选字符串/数字时间戳归一为毫秒。 */
function normalizeEpochMs(value: unknown, now: number, fallbackMs: number | undefined): number | undefined {
  const num = finiteNumber(value)
  if (num === undefined || num <= 0) return fallbackMs
  if (num > 1e12) return num
  if (num > 1e9) return num * 1000
  return fallbackMs
}

/** 夹紧 0-100。 */
function clampPercent(value: number | undefined): number | undefined {
  if (value === undefined) return undefined
  return Math.min(100, Math.max(0, value))
}

/** 判断是否计入当前订阅：quota 字段大于 0 或 status=1（1 活跃/3 不可用/2 可能受限）。 */
function includedByQuota(row: Record<string, unknown>): boolean {
  const quotaCandidates = ['current_interval_quota', 'current_weekly_quota', 'interval_quota', 'weekly_quota', 'quota']
  for (const key of quotaCandidates) {
    const value = finiteNumber(row[key])
    if (value !== undefined) return value > 0
  }
  // 没有 quota 字段时看 status：仅 status===1 视为当前订阅可用（3 表示该资源不在套餐内）。
  const intervalStatus = finiteNumber(row.current_interval_status)
  const weeklyStatus = finiteNumber(row.current_weekly_status)
  if (intervalStatus !== undefined || weeklyStatus !== undefined) {
    const statuses = [intervalStatus, weeklyStatus].filter((v): v is number => v !== undefined)
    return statuses.every((value) => value === 1)
  }
  return true
}

/** 从根对象取套餐名（多字段容错）。 */
function planNameOf(root: Record<string, unknown>, rows: Array<Record<string, unknown>>): string | undefined {
  const rootCandidates = ['current_subscribe_title', 'plan_name', 'subscribe_title', 'plan']
  for (const key of rootCandidates) {
    const value = root[key]
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
  }
  for (const row of rows) {
    for (const key of rootCandidates) {
      const value = row[key]
      if (typeof value === 'string' && value.trim() !== '') return value.trim()
    }
  }
  return undefined
}

/** 规整官方用量响应为面板契约。 */
export function parseRemainsPayload(data: Record<string, unknown>, now: number = Date.now()): MiniMaxDashboard {
  const base = data.base_resp
  if (base !== undefined && base !== null && typeof base === 'object') {
    const code = finiteNumber((base as { status_code?: unknown }).status_code) ?? 0
    const msg = (base as { status_msg?: unknown }).status_msg
    if (code !== 0) {
      const raw = typeof msg === 'string' ? msg : 'MiniMax 用量接口返回错误（' + code + '）。'
      throw new MiniMaxApiError(isAuthFailure(code, raw) ? AUTH_HINT : raw, code === 1004 ? 401 : 502)
    }
  }
  const rowsRaw = Array.isArray(data.model_remains) ? data.model_remains : Array.isArray(data.models) ? data.models : Array.isArray(data.data) ? data.data : []
  const rows: Array<Record<string, unknown>> = []
  for (const entry of rowsRaw) {
    if (entry !== null && typeof entry === 'object' && !Array.isArray(entry)) rows.push(entry as Record<string, unknown>)
  }
  const warnings: string[] = []
  if (rows.length === 0) warnings.push('用量接口未返回任何资源。')
  const models: MiniMaxRemainsModel[] = []
  for (const row of rows) {
    const name = (typeof row.model_name === 'string' && row.model_name !== '' ? row.model_name : typeof row.name === 'string' ? row.name : typeof row.model === 'string' ? row.model : '').trim()
    if (name === '') continue
    let intervalRemaining = clampPercent(pickNumber(row, ['current_interval_remaining_percent', 'interval_remaining_percent', 'current_interval_remain_percent']))
    let weeklyRemaining = clampPercent(pickNumber(row, ['current_weekly_remaining_percent', 'weekly_remaining_percent', 'current_weekly_remain_percent']))
    if (weeklyRemaining === undefined) {
      const used = pickNumber(row, ['current_weekly_usage_count', 'weekly_usage_count'])
      const total = pickNumber(row, ['current_weekly_total_count', 'weekly_total_count'])
      if (used !== undefined && total !== undefined && total > 0) weeklyRemaining = clampPercent(((total - used) / total) * 100)
    }
    if (intervalRemaining === undefined) {
      const used = pickNumber(row, ['current_interval_usage_count', 'interval_usage_count'])
      const total = pickNumber(row, ['current_interval_total_count', 'interval_total_count'])
      if (used !== undefined && total !== undefined && total > 0) {
        const derived = clampPercent(((total - used) / total) * 100)
        if (derived !== undefined) intervalRemaining = derived
      }
    }
    const intervalRemainsSec = pickNumber(row, ['remains_time', 'current_interval_remains_time', 'interval_remains_time'])
    const weeklyRemainsSec = pickNumber(row, ['weekly_remains_time', 'current_weekly_remains_time'])
    const intervalEndAt = normalizeEpochMs(row.end_time ?? row.current_interval_end_time, now, intervalRemainsSec !== undefined ? now + intervalRemainsSec * 1000 : undefined)
    const weeklyEndAt = normalizeEpochMs(row.weekly_end_time ?? row.current_weekly_end_time, now, weeklyRemainsSec !== undefined ? now + weeklyRemainsSec * 1000 : undefined)
    models.push({
      name,
      included: includedByQuota(row),
      ...(intervalRemaining !== undefined ? { intervalRemainingPercent: intervalRemaining } : {}),
      ...(weeklyRemaining !== undefined ? { weeklyRemainingPercent: weeklyRemaining } : {}),
      ...(intervalEndAt !== undefined ? { intervalEndAt } : {}),
      ...(weeklyEndAt !== undefined ? { weeklyEndAt } : {}),
    })
  }
  return {
    ...(planNameOf(data, rows) !== undefined ? { planName: planNameOf(data, rows) as string } : {}),
    models,
    fetchedAt: now,
    warnings,
  }
}