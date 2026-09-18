/**
 * RAG 会话工具 —— rag_search：全部 DSH 会话可用的知识库检索入口。
 *
 * 0.33.5 修复（记忆中枢半瘫）：
 * - 旧实现只搜 rag.chunk（RAG 文档切块），而 memory.entry（长期记忆唯一事实源）
 *   自 0.26.4 起就不再写入 RAG 库，导致「知识库检索」永远搜不到长期记忆；
 * - 现改为双源并行检索：RAG 文档切块 + 内置长期记忆（memory.entry），
 *   按归一化相关度归并后统一排序，两源任一失败只降级不中断；
 * - 返回体新增 sources 统计，让「一个源废了」不再静默不可见。
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { RagService } from './service.ts'
import type { NativeMemoryStore } from '../memory/native.ts'

function text(value: string): Array<{ type: 'text'; text: string }> {
  return [{ type: 'text', text: value }]
}

/** 双源归并后的统一命中。 */
interface MergedHit {
  fileName: string
  headingPath: string
  text: string
  score: number
  /** 来源：rag=文档切块，memory=内置长期记忆。 */
  origin: 'rag' | 'memory'
}

interface RagSearchToolOutput {
  ok: boolean
  query?: string
  hits?: MergedHit[]
  message?: string
  /** 各源检索情况：命中数与降级原因（故障可见，不再静默）。 */
  sources?: { rag: number; memory: number; degraded: string[] }
}

function renderHits(hits: MergedHit[]): string {
  if (hits.length === 0) return '（知识库中无命中；可先在天工造梦「记忆中枢」页签上传文档）'
  return hits.map((hit, index) => {
    const source = hit.headingPath !== '' ? hit.fileName + ' · ' + hit.headingPath : hit.fileName
    const tag = hit.origin === 'memory' ? '长期记忆' : '文档'
    return '[' + (index + 1) + '] ' + source + '（' + tag + '，相关度 ' + hit.score.toFixed(3) + '）\n' + hit.text
  }).join('\n---\n')
}

/** 记忆条目渲染成与文档切块同形的命中（长期记忆直接以正文为文本）。 */
function memoryHitOf(entry: { content: string; category: string; updatedAt: number }, score: number): MergedHit {
  const stamp = Number.isFinite(entry.updatedAt) ? new Date(entry.updatedAt).toISOString().slice(0, 10) : ''
  return {
    fileName: '长期记忆' + (stamp === '' ? '' : ' · ' + stamp),
    headingPath: entry.category,
    text: entry.content,
    score,
    origin: 'memory',
  }
}

export function ragSearchTool(service: RagService, native?: NativeMemoryStore) {
  return defineTool({
    name: 'rag_search',
    description: '检索天工造梦 RAG 知识库（记忆中枢）：中文全文+向量混合检索，同时检索内置长期记忆（memory.entry），返回带出处与相关度的原文切块。' +
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
                origin: { type: 'string', required: true, enum: ['rag', 'memory'] },
              },
            },
          },
          message: { type: 'string' },
          sources: {
            type: 'object',
            additionalProperties: false,
            properties: {
              rag: { type: 'number', required: true },
              memory: { type: 'number', required: true },
              degraded: { type: 'array', required: true, items: { type: 'string' } },
            },
          },
        },
      },
      render: (_args, value: RagSearchToolOutput) => {
        if (value.message !== undefined) return text(value.message)
        const body = renderHits(value.hits ?? [])
        const sources = value.sources
        // 降级可见：某源故障时把原因附在结果尾部，避免「库废了」被当成「没搜到」。
        if (sources === undefined || sources.degraded.length === 0) return text(body)
        return text(body + '\n---\n[检索降级] ' + sources.degraded.join('；'))
      },
    },
    async execute(args): Promise<RagSearchToolOutput> {
      try {
        const query = args.query ?? ''
        if (query === '') return { ok: false, message: 'query 必填' }
        const topK = args.topK !== undefined && args.topK > 0 ? args.topK : 8
        const degraded: string[] = []

        // 源一：RAG 文档切块（含镜像库/手动库/项目库）。
        let ragHits: MergedHit[] = []
        try {
          const hits = await service.search({ query, kbIds: args.kbIds, topK })
          ragHits = hits.map((hit) => ({ fileName: hit.fileName, headingPath: hit.headingPath, text: hit.text, score: hit.score, origin: 'rag' as const }))
        } catch (error) {
          degraded.push('文档检索失败：' + (error instanceof Error ? error.message : String(error)).slice(0, 120))
        }

        // 源二：内置长期记忆（memory.entry）—— 唯一事实源，不经 RAG 库。
        // kbIds 显式限定时跳过（调用方明确只要某几个知识库的文档切块）。
        let memoryHits: MergedHit[] = []
        if (native !== undefined && (args.kbIds === undefined || args.kbIds.length === 0)) {
          try {
            const ranked = native.searchDetailed(query, { limit: topK })
            const topScore = ranked[0]?.score ?? 0
            // 相对线：低于最高分 55% 的弱相关命中丢弃，与注入侧 RELATIVE_KEEP_RATIO 同口径。
            const floor = topScore * 0.55
            memoryHits = ranked
              .filter((hit) => hit.score >= floor)
              .map((hit) => memoryHitOf(hit.entry, hit.score))
          } catch (error) {
            degraded.push('长期记忆检索失败：' + (error instanceof Error ? error.message : String(error)).slice(0, 120))
          }
        }

        // 两源分数不在同一标尺：各自归一化到 0-1 后再归并，避免一方系统性压制另一方。
        const normalize = (hits: MergedHit[]): MergedHit[] => {
          const max = hits.reduce((m, hit) => Math.max(m, hit.score), 0)
          return max <= 0 ? hits : hits.map((hit) => ({ ...hit, score: hit.score / max }))
        }
        const merged = [...normalize(ragHits), ...normalize(memoryHits)]
          .sort((a, b) => b.score - a.score)
          .slice(0, topK)

        return {
          ok: true,
          query,
          hits: merged,
          sources: { rag: ragHits.length, memory: memoryHits.length, degraded },
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { ok: false, message: 'RAG 检索失败：' + message.slice(0, 200) }
      }
    },
  })
}
