/**
 * 内置记忆混合召回：项目作用域硬过滤后，融合词法排名与语义向量排名。
 * 原始词法分与余弦分不在同一标尺，使用加权 RRF 风格的秩归一融合；
 * embedding 或向量缓存异常只降级语义层，词法结果始终可用。
 */
import type { RagStore } from '../rag/rag-store.ts'
import type { RagService } from '../rag/service.ts'
import { vectorKey } from '../rag/embedder.ts'
import type { MemoryScopeContext, MemorySearchHit } from './protocol.ts'
import type { NativeMemoryStore } from './native.ts'

export interface MemoryRecallResult {
  hits: MemorySearchHit[]
  degradedLayers: string[]
}

function cosine(a: Float32Array, b: Float32Array): number {
  if (a.length === 0 || a.length !== b.length) return 0
  let dot = 0
  let aa = 0
  let bb = 0
  for (let index = 0; index < a.length; index += 1) {
    dot += a[index]! * b[index]!
    aa += a[index]! * a[index]!
    bb += b[index]! * b[index]!
  }
  return aa === 0 || bb === 0 ? 0 : dot / Math.sqrt(aa * bb)
}

function normalizedRank(rank: number): number {
  return 61 / (60 + rank)
}

/** 混合召回服务。向量仅是派生缓存，memory.entry 仍是唯一事实源。 */
export class MemoryRecallService {
  private readonly native: NativeMemoryStore
  private readonly rag: RagService
  private readonly store: RagStore
  constructor(native: NativeMemoryStore, rag: RagService, store: RagStore) {
    this.native = native
    this.rag = rag
    this.store = store
  }

  async recall(input: { query: string; scope: MemoryScopeContext; isolateScope: boolean; semantic: boolean; semanticWeight: number; threshold: number; limit: number }): Promise<MemoryRecallResult> {
    const limit = Math.max(1, Math.min(20, Math.floor(input.limit)))
    const lexical = this.native.searchDetailed(input.query, { limit: Math.max(40, limit * 6), scope: input.scope, isolateScope: input.isolateScope })
    const byId = new Map(lexical.map((hit) => [hit.entry.id, { ...hit }]))
    const lexRank = new Map(lexical.map((hit, index) => [hit.entry.id, index + 1]))
    const semanticRank = new Map<string, number>()
    const semanticScore = new Map<string, number>()
    const degradedLayers: string[] = []

    if (input.semantic) {
      try {
        const settings = this.rag.getSettings()
        const embedder = this.rag.pickEmbedder(settings)
        const entries = this.native.list({ limit: 1000, scope: input.scope, isolateScope: input.isolateScope })
        const model = settings.embedding.model
        const vectors = new Map<string, Float32Array>()
        const pending = entries.filter((entry) => {
          const cached = this.store.getVector(vectorKey(model, entry.content))
          if (cached !== null) vectors.set(entry.id, cached)
          return cached === null
        })
        const batchSize = Math.max(8, Math.min(64, settings.advanced.concurrency * 8))
        for (let start = 0; start < pending.length; start += batchSize) {
          const batch = pending.slice(start, start + batchSize)
          const embedded = await embedder.embed(batch.map((entry) => entry.content), model)
          for (let index = 0; index < batch.length; index += 1) {
            const vector = embedded[index]
            if (vector === undefined) continue
            vectors.set(batch[index]!.id, vector)
            this.store.putVector(vectorKey(model, batch[index]!.content), vector)
          }
        }
        const queryVector = await embedder.embedQuery(input.query, model)
        const rawRanked = entries.map((entry) => ({ entry, score: cosine(queryVector, vectors.get(entry.id) ?? new Float32Array()) })).filter((item) => Number.isFinite(item.score) && item.score > 0).sort((a, b) => b.score - a.score)
        const topSemantic = rawRanked[0]?.score ?? 0
        const semanticFloor = Math.max(0.2, topSemantic * 0.55)
        const ranked = rawRanked.filter((item) => item.score >= semanticFloor).slice(0, Math.max(40, limit * 6))
        for (let index = 0; index < ranked.length; index += 1) {
          const item = ranked[index]!
          semanticRank.set(item.entry.id, index + 1)
          semanticScore.set(item.entry.id, item.score)
          if (!byId.has(item.entry.id)) {
            const trustQuality = item.entry.trust === 'confirmed' ? 0.08 : item.entry.trust === 'verified' ? 0.06 : item.entry.trust === 'inferred' ? 0.035 : 0.02
            byId.set(item.entry.id, { entry: item.entry, score: 0, lexicalScore: 0, semanticScore: item.score, qualityScore: trustQuality + item.entry.confidence * 0.04, scopeScore: item.entry.scope.kind === 'global' ? 0 : 0.03, matchedTerms: [], entityHits: [] })
          }
        }
      } catch (error) {
        degradedLayers.push('semantic:' + (error instanceof Error ? error.message : String(error)).slice(0, 120))
      }
    }

    const semanticWeight = input.semantic ? Math.max(0, Math.min(0.8, input.semanticWeight)) : 0
    const lexicalWeight = 1 - semanticWeight
    const ranked = [...byId.values()].map((hit) => {
      const lexicalPart = lexRank.has(hit.entry.id) ? normalizedRank(lexRank.get(hit.entry.id)!) : 0
      const semanticPart = semanticRank.has(hit.entry.id) ? normalizedRank(semanticRank.get(hit.entry.id)!) : 0
      const score = Math.min(1, lexicalPart * lexicalWeight + semanticPart * semanticWeight + hit.qualityScore + hit.scopeScore)
      return { ...hit, score, semanticScore: semanticScore.get(hit.entry.id) ?? 0 }
    }).sort((a, b) => b.score - a.score || b.entry.updatedAt - a.entry.updatedAt)
    const topScore = ranked[0]?.score ?? 0
    const scoreFloor = Math.max(0, Math.min(1, input.threshold), topScore * 0.55)
    const hits = ranked.filter((hit) => hit.score >= scoreFloor).slice(0, limit)

    return { hits, degradedLayers }
  }
}
