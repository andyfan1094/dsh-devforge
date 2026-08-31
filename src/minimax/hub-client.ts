/** MiniMax Hub 桌面端 Gateway HTTP 客户端（localhost:8001，免鉴权，复用 Hub 客户端已登录 token）。 */
import { homedir } from 'node:os'

/** Hub Gateway 默认监听端口（Hub 桌面端固定值，与 --gateway-url 启动参数无关）。 */
const DEFAULT_GATEWAY_URL = 'http://127.0.0.1:8001'

/** Hub 默认产物输出目录（macOS；Electron app 内部配置硬编码到 userData 目录）。 */
const DEFAULT_OUTPUT_DIR_HINT = '/Library/Application Support/@hilo/desktop/output_files'

/** Hub 视频生成最大单请求等待（默认 30 分钟，覆盖 5-15s H3 + 排队 + 2K 再生）。 */
const DEFAULT_VIDEO_TIMEOUT_MS = 30 * 60 * 1000

/** Hub 图像/能力查询默认超时（轻量端点）。 */
const DEFAULT_LIGHT_TIMEOUT_MS = 60 * 1000

/** 可直接呈现给模型的调用失败；消息已脱敏（隐藏 Gateway URL 中的 token、不打印绝对路径细节）。 */
export class MiniMaxHubError extends Error {
  /** 语义 HTTP 状态码（502 表示 Gateway 不可达；504 表示超时）。 */
  readonly status: number

  constructor(message: string, status = 502) {
    super(message)
    this.name = 'MiniMaxHubError'
    this.status = status
  }
}

/** 脱敏错误文本：绝不打印 Authorization / Cookie 头信息（Hub Gateway 通常不需要，但保险）。 */
export function safeHubError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  return raw
    .replace(/Bearer\s+[^\s]+/gi, 'Bearer [redacted]')
    .replace(/Cookie\s*[:=]\s*[^;\s]+/gi, 'Cookie [redacted]')
    .slice(0, 300)
}

/** Hub 视频生成参数（与 /api/models 端点返回的 videoModels[i].params 字段对应）。 */
export interface MiniMaxHubVideoOptions {
  /** 模型 ID（默认 MiniMax-H3，可选 MiniMax-H3-Max 高速版）。 */
  modelId?: string
  /** 后端标识符（默认 minimax_v3，与 Hub 注册一致）。 */
  backend?: string
  /** 视频时长（秒，4-15，整数）。 */
  duration?: number
  /** 宽高比：adaptive / 16:9 / 4:3 / 1:1 / 3:4 / 9:16 / 21:9。 */
  ratio?: string
  /** 分辨率：768P 或 2K。 */
  resolution?: string
  /** 生成方式：reference / first-last-frame / video-extension。 */
  imageMode?: string
  /** 是否生成原生立体声音频：true / false。 */
  generateAudio?: string
  /** 输出文件名（不含后缀，落盘到 Hub output_files 目录）。 */
  filename?: string
  /** AbortSignal，用于取消请求。 */
  signal?: AbortSignal
}

/** Hub 视频生成成功响应。 */
export interface MiniMaxHubVideoResult {
  ok: boolean
  /** Hub 云端任务 ID。 */
  taskId?: string
  /** Hub 落地产物文件名（mp4/png，落到 output_files/ 目录）。 */
  assetPath?: string
  /** Hub 落地产物的绝对路径（拼接 Hub 默认产物目录）。 */
  absolutePath?: string
  /** 视频宽度像素（Hub 响应中常见字段；缺省时为 undefined）。 */
  width?: number
  /** 视频高度像素。 */
  height?: number
  /** 视频时长（秒）。 */
  duration?: number
  /** Hub 节点 ID（用于跨画布关联）。 */
  nodeId?: string
}

/** Hub 能力查询返回的视频/图像/音频模型条目（仅保留必要字段）。 */
export interface MiniMaxHubVideoModel {
  id: string
  name: string
  backend: string
  modelName?: string
  promptMaxLength?: number
  params: Record<string, unknown>
  costPerSecond?: number
}

export interface MiniMaxHubImageModel {
  id: string
  name: string
  backend: string
  modelName?: string
  promptMaxLength?: number
  params: Record<string, unknown>
}

export interface MiniMaxHubCapabilities {
  videoModels: MiniMaxHubVideoModel[]
  imageModels: MiniMaxHubImageModel[]
  audioModels: Array<Record<string, unknown>>
  /** 模型 名称（与模型目录呼应）。 */
  series: string
  fetchedAt: number
}

/** 单客户端绑定 Hub Gateway URL；不需要鉴权头（Hub 客户端已登录）。 */
export class MiniMaxHubClient {
  /** Hub Gateway 地址（默认 http://127.0.0.1:8001）。 */
  private readonly gatewayURL: string
  /** Hub 默认产物输出目录（用于把 assetPath 解析为绝对路径）。 */
  private readonly outputDir: string
  /** 视频生成最大等待时间（毫秒）。 */
  private readonly videoTimeoutMs: number
  /** 轻量端点（/api/health、/api/models）的超时时间（毫秒）。 */
  private readonly lightTimeoutMs: number

  constructor(options: { gatewayURL?: string; outputDir?: string; videoTimeoutMs?: number; lightTimeoutMs?: number } = {}) {
    this.gatewayURL = options.gatewayURL ?? DEFAULT_GATEWAY_URL
    this.outputDir = options.outputDir ?? joinOSPath(homedir(), DEFAULT_OUTPUT_DIR_HINT)
    this.videoTimeoutMs = Math.max(options.videoTimeoutMs ?? DEFAULT_VIDEO_TIMEOUT_MS, 60_000)
    this.lightTimeoutMs = Math.max(options.lightTimeoutMs ?? DEFAULT_LIGHT_TIMEOUT_MS, 5000)
  }

  /** 检查 Gateway 健康（GET /api/health，Hub 始终返回 ok）。 */
  async health(signal?: AbortSignal): Promise<boolean> {
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), this.lightTimeoutMs)
      signal?.addEventListener('abort', () => controller.abort(), { once: true })
      try {
        const response = await fetch(this.gatewayURL + '/api/health', { method: 'GET', signal: controller.signal })
        if (!response.ok) return false
        const data = await response.json().catch(() => null) as Record<string, unknown> | null
        return typeof data?.status === 'string' && data.status.toLowerCase() === 'ok'
      } finally {
        clearTimeout(timer)
      }
    } catch {
      return false
    }
  }

  /** 查询 Hub 注册的所有模型（视频/图像/音频），返回规整结果。 */
  async listCapabilities(signal?: AbortSignal): Promise<MiniMaxHubCapabilities> {
    const data = await this.get('/api/models', signal)
    const video = Array.isArray(data.videoModels) ? data.videoModels : []
    const image = Array.isArray(data.imageModels) ? data.imageModels : []
    const audio = Array.isArray(data.audioModels) ? data.audioModels : []
    return {
      videoModels: video.filter((entry): entry is Record<string, unknown> => entry !== null && typeof entry === 'object').map((entry) => normalizeVideoModel(entry)),
      imageModels: image.filter((entry): entry is Record<string, unknown> => entry !== null && typeof entry === 'object').map((entry) => normalizeImageModel(entry)),
      audioModels: audio.filter((entry): entry is Record<string, unknown> => entry !== null && typeof entry === 'object'),
      series: 'MiniMax',
      fetchedAt: Date.now(),
    }
  }

  /**
   * 调用 Hub Gateway 生成视频（POST /api/generate/video，Hub 内部同步等待云端完成 + 落盘后才返回）。
   * 单请求可能耗时 5-30 分钟，构造时务必设置充足超时。
   */
  async generateVideo(prompt: string, options: MiniMaxHubVideoOptions = {}): Promise<MiniMaxHubVideoResult> {
    const trimmed = prompt.trim()
    if (trimmed === '') throw new MiniMaxHubError('Hub 视频生成：prompt 不能为空。', 400)

    const backend = options.backend ?? 'minimax_v3'
    const modelId = options.modelId ?? 'MiniMax-H3'
    const filename = options.filename ?? ('hub_video_' + String(Date.now()))
    const params: Record<string, unknown> = {}
    if (options.imageMode !== undefined) params.image_mode = options.imageMode
    if (options.duration !== undefined) params.duration = options.duration
    if (options.ratio !== undefined) params.ratio = options.ratio
    if (options.resolution !== undefined) params.resolution = options.resolution
    if (options.generateAudio !== undefined) params.generate_audio = options.generateAudio

    const payload: Record<string, unknown> = {
      backend,
      model_id: modelId,
      prompt: trimmed,
      filename,
    }
    if (Object.keys(params).length > 0) payload.params = params

    const data = await this.post('/api/generate/video', payload, this.videoTimeoutMs, options.signal)
    return parseVideoResult(data, this.outputDir)
  }

  /** 调用 Hub Gateway 生成图像（POST /api/generate/image）。 */
  async generateImage(prompt: string, options: { backend?: string; modelId?: string; filename?: string; referenceImages?: string[]; signal?: AbortSignal } = {}): Promise<{ ok: boolean; path?: string; width?: number; height?: number; nodeId?: string }> {
    const trimmed = prompt.trim()
    if (trimmed === '') throw new MiniMaxHubError('Hub 图像生成：prompt 不能为空。', 400)
    const payload: Record<string, unknown> = {
      backend: options.backend ?? 'nano_banana',
      model_id: options.modelId ?? 'banana_2',
      prompt: trimmed,
      filename: options.filename ?? ('hub_image_' + String(Date.now())),
    }
    if (Array.isArray(options.referenceImages) && options.referenceImages.length > 0) payload.reference_images = options.referenceImages
    const data = await this.post('/api/generate/image', payload, this.lightTimeoutMs, options.signal)
    return parseImageResult(data, this.outputDir)
  }

  /** GET 请求封装。 */
  private async get(path: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.lightTimeoutMs)
    signal?.addEventListener('abort', () => controller.abort(), { once: true })
    let response: Response
    try {
      response = await fetch(this.gatewayURL + path, { method: 'GET', signal: controller.signal })
    } catch (error) {
      throw new MiniMaxHubError('Hub Gateway 不可达：' + safeHubError(error), 502)
    } finally {
      clearTimeout(timer)
    }
    return await parseJsonResponse(response)
  }

  /** POST 请求封装。 */
  private async post(path: string, body: Record<string, unknown>, timeoutMs: number, signal?: AbortSignal): Promise<Record<string, unknown>> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    signal?.addEventListener('abort', () => controller.abort(), { once: true })
    let response: Response
    try {
      response = await fetch(this.gatewayURL + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
    } catch (error) {
      const reason = (error instanceof Error && error.name === 'AbortError') ? '请求超时或被取消' : '不可达'
      throw new MiniMaxHubError('Hub Gateway ' + reason + '：' + safeHubError(error), reason === '请求超时或被取消' ? 504 : 502)
    } finally {
      clearTimeout(timer)
    }
    return await parseJsonResponse(response)
  }
}

/** 按字节流读取响应并 JSON 解析。 */
async function parseJsonResponse(response: Response): Promise<Record<string, unknown>> {
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new MiniMaxHubError('Hub Gateway HTTP ' + response.status + '：' + (text || '无响应体').slice(0, 200), response.status === 401 ? 401 : 502)
  }
  const text = await response.text().catch(() => '')
  let payload: unknown
  try { payload = JSON.parse(text) } catch { throw new MiniMaxHubError('Hub Gateway 返回了无法解析的数据。', 502) }
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new MiniMaxHubError('Hub Gateway 返回了意外结构。', 502)
  }
  return payload as Record<string, unknown>
}

/** 拼接 OS 路径（macOS/Linux 仅 / 分隔；跨平台 dev 部署也安全）。 */
function joinOSPath(...parts: string[]): string {
  return parts.filter((part) => part !== '').join('/').replace(/\/{2,}/g, '/')
}

/** 规整 Hub 视频模型字段。 */
function normalizeVideoModel(entry: Record<string, unknown>): MiniMaxHubVideoModel {
  const id = typeof entry.id === 'string' ? entry.id : ''
  const name = typeof entry.display_name === 'string' ? entry.display_name : (typeof entry.name === 'string' ? entry.name : id)
  const backend = typeof entry.backend === 'string' ? entry.backend : ''
  const modelName = typeof entry.model_name === 'string' ? entry.model_name : undefined
  const promptMaxLength = typeof entry.promptMaxLength === 'number' ? entry.promptMaxLength : undefined
  const params = (entry.params !== null && typeof entry.params === 'object') ? entry.params as Record<string, unknown> : {}
  const promotion = (entry.promotion !== null && typeof entry.promotion === 'object') ? entry.promotion as Record<string, unknown> : {}
  const costPerSecond = typeof promotion.costPerSecond === 'number' ? promotion.costPerSecond : undefined
  return { id, name, backend, ...(modelName !== undefined ? { modelName } : {}), ...(promptMaxLength !== undefined ? { promptMaxLength } : {}), params, ...(costPerSecond !== undefined ? { costPerSecond } : {}) }
}

/** 规整 Hub 图像模型字段。 */
function normalizeImageModel(entry: Record<string, unknown>): MiniMaxHubImageModel {
  const id = typeof entry.id === 'string' ? entry.id : ''
  const name = typeof entry.display_name === 'string' ? entry.display_name : (typeof entry.name === 'string' ? entry.name : id)
  const backend = typeof entry.backend === 'string' ? entry.backend : ''
  const modelName = typeof entry.model_name === 'string' ? entry.model_name : undefined
  const promptMaxLength = typeof entry.promptMaxLength === 'number' ? entry.promptMaxLength : undefined
  const params = (entry.params !== null && typeof entry.params === 'object') ? entry.params as Record<string, unknown> : {}
  return { id, name, backend, ...(modelName !== undefined ? { modelName } : {}), ...(promptMaxLength !== undefined ? { promptMaxLength } : {}), params }
}

/** 规整 Hub 视频生成响应。 */
function parseVideoResult(data: Record<string, unknown>, outputDir: string): MiniMaxHubVideoResult {
  const ok = data.ok === true
  if (!ok) {
    const error = typeof data.error === 'string' ? data.error : 'Hub 视频生成失败。'
    const code = typeof data.error_code === 'string' ? data.error_code : ''
    throw new MiniMaxHubError('Hub 视频生成失败：' + error + (code !== '' ? '（' + code + '）' : ''), 502)
  }
  const taskId = typeof data.task_id === 'string' ? data.task_id : undefined
  const assetPath = typeof data.path === 'string' ? data.path : (typeof data.assetPath === 'string' ? data.assetPath : undefined)
  const width = typeof data.width === 'number' ? data.width : undefined
  const height = typeof data.height === 'number' ? data.height : undefined
  const duration = typeof data.duration === 'number' ? data.duration : undefined
  const nodeId = typeof data.node_id === 'string' ? data.node_id : undefined
  const absolutePath = assetPath !== undefined ? joinOSPath(outputDir, assetPath) : undefined
  return {
    ok: true,
    ...(taskId !== undefined ? { taskId } : {}),
    ...(assetPath !== undefined ? { assetPath } : {}),
    ...(absolutePath !== undefined ? { absolutePath } : {}),
    ...(width !== undefined ? { width } : {}),
    ...(height !== undefined ? { height } : {}),
    ...(duration !== undefined ? { duration } : {}),
    ...(nodeId !== undefined ? { nodeId } : {}),
  }
}

/** 规整 Hub 图像生成响应。 */
function parseImageResult(data: Record<string, unknown>, outputDir: string): { ok: boolean; path?: string; width?: number; height?: number; nodeId?: string } {
  const ok = data.ok === true
  if (!ok) {
    const error = typeof data.error === 'string' ? data.error : 'Hub 图像生成失败。'
    throw new MiniMaxHubError('Hub 图像生成失败：' + error, 502)
  }
  const assetPath = typeof data.path === 'string' ? data.path : undefined
  const width = typeof data.width === 'number' ? data.width : undefined
  const height = typeof data.height === 'number' ? data.height : undefined
  const nodeId = typeof data.node_id === 'string' ? data.node_id : undefined
  const absolutePath = assetPath !== undefined ? joinOSPath(outputDir, assetPath) : undefined
  return {
    ok: true,
    ...(absolutePath !== undefined ? { path: absolutePath } : { ...(assetPath !== undefined ? { path: assetPath } : {}) }),
    ...(width !== undefined ? { width } : {}),
    ...(height !== undefined ? { height } : {}),
    ...(nodeId !== undefined ? { nodeId } : {}),
  }
}
