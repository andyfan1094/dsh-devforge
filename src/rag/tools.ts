/**
 * RAG 会话工具 —— rag_search：全部 DSH 会话可用的知识库检索入口。
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { RagService } from './service.ts'

function text(value: string): Array<{ type: 'text'; text: string }> {
  return [{ type: 'text', text: value }]
}

interface RagSearchToolOutput {
  ok: boolean
  query?: string
  hits?: Array<{ fileName: string; headingPath: string; text: string; score: number }>
  message?: string
}

function renderHits(hits: NonNullable<RagSearchToolOutput['hits']>): string {
  if (hits.length === 0) return '（知识库中无命中；可先在天工造梦「记忆中枢」页签上传文档）'
  return hits.map((hit, index) => {
    const source = hit.headingPath !== '' ? hit.fileName + ' · ' + hit.headingPath : hit.fileName
    return '[' + (index + 1) + '] ' + source + '（相关度 ' + hit.score.toFixed(3) + '）\n' + hit.text
  }).join('\n---\n')
}

export function ragSearchTool(service: RagService) {
  return defineTool({
    name: 'rag_search',
    description: '检索天工造梦 RAG 知识库（记忆中枢）：中文全文+向量混合检索，返回带出处与相关度的原文切块。' +
      'Triggers: 查知识库, 检索文档, RAG, 记忆中枢, 知识库检索.',
    parameters: {
      query: { type: 'string', description: '检索问题或关键词（中文自然语言即可）' },
      kbIds: { type: 'array', items: { type: 'string' }, description: '限定知识库 id（缺省检索全部库）' },
      topK: { type: 'integer', description: '返回条数（默认 8）' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          query: { type: 'string' },
          hits: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                fileName: { type: 'string', required: true },
                headingPath: { type: 'string', required: true },
                text: { type: 'string', required: true },
                score: { type: 'number', required: true },
              },
            },
          },
          message: { type: 'string' },
        },
      },
      render: (_args, value: RagSearchToolOutput) => text(value.message ?? renderHits(value.hits ?? [])),
    },
    async execute(args): Promise<RagSearchToolOutput> {
      try {
        const query = args.query ?? ''
        if (query === '') return { ok: false, message: 'query 必填' }
        const hits = await service.search({ query, kbIds: args.kbIds, topK: args.topK })
        return {
          ok: true,
          query,
          hits: hits.map((hit) => ({ fileName: hit.fileName, headingPath: hit.headingPath, text: hit.text, score: hit.score })),
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { ok: false, message: 'RAG 检索失败：' + message.slice(0, 200) }
      }
    },
  })
}