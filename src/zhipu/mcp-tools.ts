/** 智谱 GLM Coding Plan 官方 MCP 工具：联网搜索 / 网页读取 / Zread 开源仓库。 */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-credentials'
import { ZhipuMcpClient, safeMcpError } from './mcp-client.ts'

function text(value: string): ContentBlock[] { return [{ type: 'text', text: value }] }

/** 官方 MCP 端点（官方直连，无中转）。 */
const SEARCH_ENDPOINT = 'https://open.bigmodel.cn/api/mcp/web_search_prime/mcp'
const READER_ENDPOINT = 'https://open.bigmodel.cn/api/mcp/web_reader/mcp'
const ZREAD_ENDPOINT = 'https://open.bigmodel.cn/api/mcp/zread/mcp'

/** 激活配置（不包含任何凭据明文）。 */
export interface ZhipuMcpActivationConfig {
  /** 是否启用官方 MCP 工具。 */
  enabled: boolean
  /** 单请求超时（毫秒）。 */
  timeoutMs: number
}

/** 构造三个官方客户端；凭据按 Key 池档位每次请求重新解析，401/403/429 自动换挡。 */
export function makeZhipuMcpClients(config: ZhipuMcpActivationConfig, resolveApiKey: (attempt: number) => Promise<string>): { search: ZhipuMcpClient; reader: ZhipuMcpClient; zread: ZhipuMcpClient } {
  return {
    search: new ZhipuMcpClient(SEARCH_ENDPOINT, resolveApiKey, config.timeoutMs),
    reader: new ZhipuMcpClient(READER_ENDPOINT, resolveApiKey, config.timeoutMs),
    zread: new ZhipuMcpClient(ZREAD_ENDPOINT, resolveApiKey, config.timeoutMs),
  }
}

/** 带参数的官方工具包装（参数 schema 校验交给 DSH 工具运行时）。 */
function mcpArgOutput(name: string, description: string, parameters: Record<string, any>, execute: (args: any) => Promise<{ isError: boolean; text: string }>) {
  return defineTool({
    name,
    description,
    parameters,
    output: { schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean', required: true }, content: { type: 'string' }, error: { type: 'string' } } }, render: (_args, value) => text(value.ok ? (value.content ?? '') : `调用失败：${value.error ?? '未知错误'}`) },
    async execute(args: any) {
      try {
        const result = await execute(args)
        return result.isError ? { ok: false, content: '', error: result.text.slice(0, 300) || '官方工具返回错误' } : { ok: true, content: result.text }
      } catch (error) {
        return { ok: false, content: '', error: safeMcpError(error) }
      }
    },
  })
}

/** 构造 5 个官方 MCP 工具定义。 */
export function makeZhipuMcpToolDefinitions(clients: ReturnType<typeof makeZhipuMcpClients>) {
  return [
    mcpArgOutput('zhipu_web_search', '用智谱官方联网搜索 MCP 搜索全网信息，返回网页标题、链接、摘要等（消耗套餐每月搜索额度）。', {
      search_query: { type: 'string', required: true, description: '搜索内容，建议不超过 70 字。' },
      search_recency_filter: { type: 'string', enum: ['oneDay', 'oneWeek', 'oneMonth', 'oneYear', 'noLimit'], description: '时间范围，默认不限。' },
      content_size: { type: 'string', enum: ['medium', 'high'], description: '摘要篇幅：medium 均衡（默认），high 更全面。' },
      location: { type: 'string', enum: ['cn', 'us'], description: '地区倾向，默认 cn。' },
    }, (args) => clients.search.call('web_search_prime', {
      search_query: args.search_query,
      ...(typeof args.search_recency_filter === 'string' ? { search_recency_filter: args.search_recency_filter } : {}),
      ...(typeof args.content_size === 'string' ? { content_size: args.content_size } : {}),
      ...(typeof args.location === 'string' ? { location: args.location } : {}),
    })),
    mcpArgOutput('zhipu_web_reader', '用智谱官方网页读取 MCP 抓取指定 URL，返回对大模型友好的正文（Markdown），消耗套餐每月 MCP 额度。', {
      url: { type: 'string', required: true, description: '要读取的 http(s) 网页地址。' },
      return_format: { type: 'string', enum: ['markdown', 'text'], description: '返回格式，默认 markdown。' },
      retain_images: { type: 'boolean', description: '是否保留图片，默认保留。' },
    }, (args) => clients.reader.call('webReader', {
      url: args.url,
      ...(typeof args.return_format === 'string' ? { return_format: args.return_format } : {}),
      ...(typeof args.retain_images === 'boolean' ? { retain_images: args.retain_images } : {}),
    })),
    mcpArgOutput('zhipu_zread_search', '用智谱官方 Zread MCP 搜索 GitHub 仓库的文档、issue 与提交记录。', {
      repo_name: { type: 'string', required: true, description: 'GitHub 仓库，格式 owner/repo（如 vitejs/vite）。' },
      query: { type: 'string', required: true, description: '搜索关键词或关于该仓库的问题。' },
      language: { type: 'string', enum: ['zh', 'en'], description: '返回语言，按上下文选择。' },
    }, (args) => clients.zread.call('search_doc', {
      repo_name: args.repo_name,
      query: args.query,
      ...(typeof args.language === 'string' ? { language: args.language } : {}),
    })),
    mcpArgOutput('zhipu_zread_read_file', '用智谱官方 Zread MCP 读取 GitHub 仓库中指定文件的完整代码内容。', {
      repo_name: { type: 'string', required: true, description: 'GitHub 仓库，格式 owner/repo。' },
      file_path: { type: 'string', required: true, description: '仓库内相对路径（如 src/index.ts）。' },
    }, (args) => clients.zread.call('read_file', { repo_name: args.repo_name, file_path: args.file_path })),
    mcpArgOutput('zhipu_zread_repo_structure', '用智谱官方 Zread MCP 获取 GitHub 仓库的目录结构与文件列表。', {
      repo_name: { type: 'string', required: true, description: 'GitHub 仓库，格式 owner/repo。' },
      dir_path: { type: 'string', description: '要查看的目录路径，默认根目录。' },
    }, (args) => clients.zread.call('get_repo_structure', {
      repo_name: args.repo_name,
      ...(typeof args.dir_path === 'string' ? { dir_path: args.dir_path } : {}),
    })),
  ]
}

/** 在插件作用域注册智谱官方 MCP 工具；返回卸载函数。 */
export function activateZhipuMcpTools(ctx: Context, config: ZhipuMcpActivationConfig, resolveApiKey: (attempt: number) => Promise<string>): { dispose: () => void } {
  if (!config.enabled) return { dispose: () => undefined }
  const clients = makeZhipuMcpClients(config, resolveApiKey)
  const tools = makeZhipuMcpToolDefinitions(clients)
  const dispose = ctx.effect(() => {
    const disposers = tools.map((tool) => ctx.tools.register(tool))
    return () => { for (const dispose of disposers) dispose() }
  }, 'dsh-devforge: zhipu mcp tools')
  return { dispose: () => dispose() }
}
