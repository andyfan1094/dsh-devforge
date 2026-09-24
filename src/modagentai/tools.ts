/**
 * 官网能力工具（辉哥 2026-09-23 定稿「给官网 web 搜索工具给模型用」）。
 *
 * 定位：把 modagentai.com 的联网搜索服务开放给会话内模型——
 * 服务端多渠道自动切换（Tavily 主力/智谱备用/方舟兜底），按次扣钻石（默认 0.01💎/次），
 * 是智谱/MiniMax 官方 MCP 搜索限额/失效时的第三条通道；配额与渠道健康由官网统一管理。
 * 安全模型：会话令牌只从受管凭据读取进请求头，绝不回显、绝不写日志。
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ModagentaiService } from './service.ts'

type ContentBlock = { type: 'text'; text: string }
function text(value: string): ContentBlock[] { return [{ type: 'text', text: value }] }
function render(value: unknown): string { return JSON.stringify(value, null, 2) }
function jsonValue(value: unknown): any { return JSON.parse(JSON.stringify(value)) }
const schema = { type: 'json' } as const

/** 官网能力工具组。 */
export function modagentaiWebTools(modagentai: ModagentaiService) {
  return [
    // ---- 1. 联网搜索（多渠道服务端切换，按次扣钻石） ----
    defineTool({
      name: 'modagentai_web_search',
      description: '用天工造梦官网账号联网搜索：服务端多渠道自动切换（Tavily/智谱/方舟），返回 AI 答案与带引用的网页列表；按次扣钻石（约 0.01💎/次），登录官网用户可用。zhipu/minimax 官方搜索限额或失效时的备用通道。',
      parameters: {
        query: { type: 'string', description: '搜索词（≤400 字）。' },
      },
      output: { schema, render: (_args, value) => text(render(value)) },
      async execute(args: { query?: string }) {
        if (typeof args.query !== 'string' || args.query.trim() === '') return jsonValue({ ok: false, error: '缺少 query 参数' })
        if (!modagentai.isWebSearchEnabled()) return jsonValue({ ok: false, error: '官网搜索工具已停用（面板个人中心可开启）' })
        try {
          const result = await modagentai.webSearch(args.query)
          return jsonValue({ ok: true, ...result })
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          return jsonValue({ ok: false, error: message.slice(0, 300) })
        }
      },
    }),

    // ---- 2. 搜索余量（余额折算，不扣费） ----
    defineTool({
      name: 'modagentai_search_quota',
      description: '查询天工造梦官网账号的剩余搜索次数（钻石余额折算，不扣费）。',
      parameters: {},
      output: { schema, render: (_args, value) => text(render(value)) },
      async execute() {
        if (!modagentai.isWebSearchEnabled()) return jsonValue({ ok: false, error: '官网搜索工具已停用（面板个人中心可开启）' })
        try {
          const quota = await modagentai.searchQuota()
          return jsonValue({ ok: true, ...quota })
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          return jsonValue({ ok: false, error: message.slice(0, 300) })
        }
      },
    }),
  ]
}
