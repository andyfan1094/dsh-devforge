/** MiniMax Coding Plan 官方工具：联网搜索 / 图像理解。 */
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

/** 构造 2 个官方工具定义。 */
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
