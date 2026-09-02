/**
 * rag_run 会话工具 —— 全部 DSH 会话可运行已配置的 RAG 工作流。
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { WorkflowEngine } from './engine.ts'

function text(value: string): Array<{ type: 'text'; text: string }> {
  return [{ type: 'text', text: value }]
}

interface RagRunToolOutput {
  ok: boolean
  answer?: string
  sources?: Array<{ fileName: string; headingPath: string; score: number }>
  steps?: Array<{ name: string; ms: number }>
  message?: string
}

export function ragRunTool(engine: WorkflowEngine) {
  return defineTool({
    name: 'rag_run',
    description: '运行天工造梦 RAG 工作流（改写→多源检索→精排→生成→自评重试），返回带引用标注的答案与出处。' +
      'Triggers: 跑工作流, RAG 问答, rag_run, 工作流检索, 带引用回答.',
    parameters: {
      query: { type: 'string', description: '要回答的问题' },
      workflowId: { type: 'string', description: '工作流 id 或名称（缺省用第一个已定义工作流）' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          answer: { type: 'string' },
          sources: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                fileName: { type: 'string', required: true },
                headingPath: { type: 'string', required: true },
                score: { type: 'number', required: true },
              },
            },
          },
          steps: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                name: { type: 'string', required: true },
                ms: { type: 'number', required: true },
              },
            },
          },
          message: { type: 'string' },
        },
      },
      render: (_args, value: RagRunToolOutput) => {
        if (!value.ok) return text(value.message ?? '工作流运行失败')
        const steps = (value.steps ?? []).map((step) => step.name + ' ' + step.ms + 'ms').join(' → ')
        const sources = (value.sources ?? []).map((source, i) => {
          const label = source.headingPath !== '' ? source.fileName + ' · ' + source.headingPath : source.fileName
          return '[' + (i + 1) + '] ' + label + '（' + source.score.toFixed(3) + '）'
        }).join('\n')
        return text((steps !== '' ? '步骤：' + steps + '\n\n' : '') + value.answer + '\n\n出处：\n' + sources)
      },
    },
    async execute(args): Promise<RagRunToolOutput> {
      const query = args.query ?? ''
      if (query.trim() === '') return { ok: false, message: 'query 必填' }
      try {
        const result = await engine.run({ query, ...(args.workflowId !== undefined && args.workflowId !== '' ? { workflowId: args.workflowId } : {}) })
        return { ok: true, answer: result.answer, sources: result.sources, steps: result.steps.map((step) => ({ name: step.name, ms: step.ms })) }
      } catch (error) {
        return { ok: false, message: '工作流运行失败：' + (error instanceof Error ? error.message : String(error)).slice(0, 200) }
      }
    },
  })
}
