/** MiniMax Coding Plan 官方工具：联网搜索 / 图像理解 / 图像生成 / 语音合成 / 视频生成。 */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { formatSearchResult, MiniMaxApiClient, safeApiError } from './api-client.ts'
import { ImageInputError, toImageDataUrl } from './image-input.ts'

function text(value: string): ContentBlock[] { return [{ type: 'text', text: value }] }

/** 激活配置（不包含任何凭据明文）。 */
export interface MiniMaxToolsActivationConfig {
  /** 是否启用官方工具。 */
  enabled: boolean
  /** 受管凭据引用名（MiniMax 国内站 Key）。 */
  apiKeyEnv: string
  /** 单请求超时（毫秒）。 */
  timeoutMs: number
}

/** 构造官方客户端；凭据每次请求重新解析。 */
export function makeMiniMaxApiClient(config: MiniMaxToolsActivationConfig, resolveApiKey: () => Promise<string>): MiniMaxApiClient {
  return new MiniMaxApiClient(resolveApiKey, config.timeoutMs)
}

/** 工具统一输出契约（与智谱工具一致）。 */
interface ToolOutput {
  ok: boolean
  content?: string
  error?: string
}

const TOOL_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: { ok: { type: 'boolean', required: true }, content: { type: 'string' }, error: { type: 'string' } },
} as const

/** 构造 5 个官方工具定义。 */
export function makeMiniMaxToolDefinitions(client: MiniMaxApiClient) {
  return [
    defineTool({
      name: 'minimax_web_search',
      description: '用 MiniMax 官方联网搜索 API（Coding Plan）搜索全网信息，返回网页标题、链接、摘要与相关搜索建议。',
      parameters: {
        query: { type: 'string', required: true, description: '搜索内容。' },
      },
      output: { schema: TOOL_OUTPUT_SCHEMA, render: (_args, value: ToolOutput) => text(value.ok ? (value.content ?? '') : '调用失败：' + (value.error ?? '未知错误')) },
      async execute(args: { query?: string }) {
        const query = typeof args.query === 'string' ? args.query.trim() : ''
        if (query === '') return { ok: false, error: 'query 不能为空。' }
        try {
          const result = await client.search(query)
          return { ok: true, content: formatSearchResult(result) }
        } catch (error) {
          return { ok: false, error: safeApiError(error) }
        }
      },
    }),
    defineTool({
      name: 'minimax_understand_image',
      description: '用 MiniMax 官方视觉 API 分析图片内容并回答问题；支持本机路径、http(s) 或 data URL，仅 JPEG/PNG/WebP。',
      parameters: {
        prompt: { type: 'string', required: true, description: '想从图片中了解或提取的信息。' },
        image_source: { type: 'string', required: true, description: '图片来源：本机绝对路径或 http(s)/data URL。' },
      },
      output: { schema: TOOL_OUTPUT_SCHEMA, render: (_args, value: ToolOutput) => text(value.ok ? (value.content ?? '') : '调用失败：' + (value.error ?? '未知错误')) },
      async execute(args: { prompt?: string; image_source?: string }) {
        const prompt = typeof args.prompt === 'string' ? args.prompt.trim() : ''
        const source = typeof args.image_source === 'string' ? args.image_source.trim() : ''
        if (prompt === '') return { ok: false, error: 'prompt 不能为空。' }
        if (source === '') return { ok: false, error: 'image_source 不能为空。' }
        try {
          const imageDataUrl = await toImageDataUrl(source)
          const content = await client.understandImage(prompt, imageDataUrl)
          return { ok: true, content }
        } catch (error) {
          if (error instanceof ImageInputError) return { ok: false, error: error.message }
          return { ok: false, error: safeApiError(error) }
        }
      },
    }),
    defineTool({
      name: 'minimax_image_generation',
      description: '用 MiniMax 官方图像生成 API（Coding Plan）按文本描述生成一张或多张图片，返回公开 URL。',
      parameters: {
        prompt: { type: 'string', required: true, description: '图像内容描述。' },
        model: { type: 'string', description: '官方图像模型（默认 image-01）。' },
        width: { type: 'number', description: '图像宽度像素。' },
        height: { type: 'number', description: '图像高度像素。' },
        reference_images: { type: 'array', description: '参考图 URL 列表（可选）。' },
      },
      output: { schema: TOOL_OUTPUT_SCHEMA, render: (_args, value: ToolOutput) => text(value.ok ? (value.content ?? '') : '调用失败：' + (value.error ?? '未知错误')) },
      async execute(args: { prompt?: string; model?: string; width?: number; height?: number; reference_images?: unknown[] }) {
        const prompt = typeof args.prompt === 'string' ? args.prompt.trim() : ''
        if (prompt === '') return { ok: false, error: 'prompt 不能为空。' }
        const model = typeof args.model === 'string' && args.model.trim() !== '' ? args.model.trim() : undefined
        const referenceImages = Array.isArray(args.reference_images) ? args.reference_images.filter((value): value is string => typeof value === 'string') : undefined
        try {
          const urls = await client.imageGeneration(prompt, {
            ...(model !== undefined ? { model } : {}),
            ...(typeof args.width === 'number' ? { width: args.width } : {}),
            ...(typeof args.height === 'number' ? { height: args.height } : {}),
            ...(referenceImages !== undefined ? { referenceImages: referenceImages as string[] } : {}),
          })
          if (urls.length === 0) return { ok: false, error: '图像生成接口返回为空。' }
          return { ok: true, content: urls.join('\n') }
        } catch (error) {
          return { ok: false, error: safeApiError(error) }
        }
      },
    }),
    defineTool({
      name: 'minimax_text_to_speech',
      description: '用 MiniMax 官方语音合成 API（Coding Plan）把文本转为音频，返回十六进制音频字符串与格式。',
      parameters: {
        text: { type: 'string', required: true, description: '要朗读的文本。' },
        model: { type: 'string', description: '语音模型（默认 speech-2.6-hd）。' },
        voice_id: { type: 'string', description: '声音 ID（如 male-qn-jingying、female-shaonv 等）。' },
        speed: { type: 'number', description: '语速（默认 1）。' },
        pitch: { type: 'number', description: '音调（默认 0）。' },
        format: { type: 'string', description: '音频格式（mp3/wav/pcm，默认 mp3）。' },
        sample_rate: { type: 'number', description: '采样率（默认 32000）。' },
        bitrate: { type: 'number', description: '比特率（默认 128000）。' },
      },
      output: { schema: TOOL_OUTPUT_SCHEMA, render: (_args, value: ToolOutput) => text(value.ok ? (value.content ?? '') : '调用失败：' + (value.error ?? '未知错误')) },
      async execute(args: { text?: string; model?: string; voice_id?: string; speed?: number; pitch?: number; format?: string; sample_rate?: number; bitrate?: number }) {
        const textValue = typeof args.text === 'string' ? args.text.trim() : ''
        if (textValue === '') return { ok: false, error: 'text 不能为空。' }
        const model = typeof args.model === 'string' && args.model.trim() !== '' ? args.model.trim() : undefined
        const voiceId = typeof args.voice_id === 'string' && args.voice_id.trim() !== '' ? args.voice_id.trim() : undefined
        try {
          const result = await client.textToSpeech(textValue, {
            ...(model !== undefined ? { model } : {}),
            ...(voiceId !== undefined ? { voiceId } : {}),
            ...(typeof args.speed === 'number' ? { speed: args.speed } : {}),
            ...(typeof args.pitch === 'number' ? { pitch: args.pitch } : {}),
            ...(typeof args.format === 'string' ? { format: args.format } : {}),
            ...(typeof args.sample_rate === 'number' ? { sampleRate: args.sample_rate } : {}),
            ...(typeof args.bitrate === 'number' ? { bitrate: args.bitrate } : {}),
          })
          const preview = result.hex.length > 600 ? result.hex.slice(0, 600) + '...' : result.hex
          return { ok: true, content: result.mime + ' · ' + result.bytes + ' 字节 · hex 预览：' + preview }
        } catch (error) {
          return { ok: false, error: safeApiError(error) }
        }
      },
    }),
    defineTool({
      name: 'minimax_video_generation',
      description: '用 MiniMax 官方视频生成 API（Coding Plan）异步提交视频生成任务并轮询到完成，返回视频 URL。',
      parameters: {
        prompt: { type: 'string', required: true, description: '视频内容描述。' },
        model: { type: 'string', description: '视频模型（默认 MiniMax-Hailuo-02）。' },
        duration: { type: 'number', description: '目标时长秒（可选）。' },
        resolution: { type: 'string', description: '分辨率（如 768P/1080P）。' },
        first_frame_image: { type: 'string', description: '首帧参考图 URL（可选）。' },
        last_frame_image: { type: 'string', description: '尾帧参考图 URL（可选）。' },
        poll_interval_seconds: { type: 'number', description: '轮询间隔秒（默认 5）。' },
        timeout_seconds: { type: 'number', description: '最大等待秒（默认 600）。' },
      },
      output: { schema: TOOL_OUTPUT_SCHEMA, render: (_args, value: ToolOutput) => text(value.ok ? (value.content ?? '') : '调用失败：' + (value.error ?? '未知错误')) },
      async execute(args: { prompt?: string; model?: string; duration?: number; resolution?: string; first_frame_image?: string; last_frame_image?: string; poll_interval_seconds?: number; timeout_seconds?: number }) {
        const prompt = typeof args.prompt === 'string' ? args.prompt.trim() : ''
        if (prompt === '') return { ok: false, error: 'prompt 不能为空。' }
        const model = typeof args.model === 'string' && args.model.trim() !== '' ? args.model.trim() : undefined
        const firstFrame = typeof args.first_frame_image === 'string' && args.first_frame_image.trim() !== '' ? args.first_frame_image.trim() : undefined
        const lastFrame = typeof args.last_frame_image === 'string' && args.last_frame_image.trim() !== '' ? args.last_frame_image.trim() : undefined
        const pollInterval = typeof args.poll_interval_seconds === 'number' && args.poll_interval_seconds > 0 ? args.poll_interval_seconds : 5
        const timeoutSeconds = typeof args.timeout_seconds === 'number' && args.timeout_seconds > 0 ? args.timeout_seconds : 600
        const deadline = Date.now() + timeoutSeconds * 1000
        try {
          const { taskId } = await client.createVideoGeneration(prompt, {
            ...(model !== undefined ? { model } : {}),
            ...(typeof args.duration === 'number' ? { duration: args.duration } : {}),
            ...(typeof args.resolution === 'string' ? { resolution: args.resolution } : {}),
            ...(firstFrame !== undefined ? { firstFrameImage: firstFrame } : {}),
            ...(lastFrame !== undefined ? { lastFrameImage: lastFrame } : {}),
          })
          while (Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, pollInterval * 1000))
            const result = await client.queryVideoGeneration(taskId)
            const lower = result.status.toLowerCase()
            if (lower === 'success' || lower === 'succeeded' || lower === 'completed' || lower === 'done') {
              return { ok: true, content: '任务完成 task_id=' + taskId + (result.videoUrl !== undefined ? ('\nvideo_url=' + result.videoUrl) : '') }
            }
            if (lower === 'failed' || lower === 'error' || lower === 'canceled' || lower === 'cancelled') {
              return { ok: false, error: '视频任务失败：' + result.status + ' task_id=' + taskId }
            }
          }
          return { ok: false, error: '视频任务超时（' + timeoutSeconds + ' 秒），task_id=' + taskId }
        } catch (error) {
          return { ok: false, error: safeApiError(error) }
        }
      },
    }),
  ]
}

/** 在插件作用域注册 MiniMax 官方工具；返回卸载函数。 */
export function activateMiniMaxTools(ctx: Context, config: MiniMaxToolsActivationConfig, resolveApiKey: () => Promise<string>): { dispose: () => void } {
  if (!config.enabled) return { dispose: () => undefined }
  const client = makeMiniMaxApiClient(config, resolveApiKey)
  const tools = makeMiniMaxToolDefinitions(client)
  const dispose = ctx.effect(() => {
    const disposers = tools.map((tool) => ctx.tools.register(tool))
    return () => { for (const dispose of disposers) dispose() }
  }, 'dsh-devforge: minimax tools')
  return { dispose: () => dispose() }
}
