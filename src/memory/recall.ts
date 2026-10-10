/**
 * 内置记忆混合召回：项目作用域硬过滤后，融合词法排名与语义向量排名。
 * 原始词法分与余弦分不在同一标尺，使用加权 RRF 风格的秩归一融合；
 * embedding 或向量缓存异常只降级语义层，词法结果始终可用。
 *
 * 性能约定（2026-10-08 根治"记忆多了召回卡"）：
 * - 向量按 hash 批量回库 + 进程内缓存，替代逐条 getVector 的上千次语句编译；
 * - query 向量进 LRU，同一问题反复召回不再重复走远程嵌入；
 * - 未缓存向量超过同步上限时只同步前一批，其余交后台预热——上游按 token 限制
 *   批次（方舟 16 条即 400），不能靠加大 batch 提速，只能不让召回等远程。
 */
import type { RagStore } from '../rag/rag-store.ts'
import type { RagEmbedder, RagService } from '../rag/service.ts'
import { vectorKey } from '../rag/embedder.ts'
import type { MemoryScopeContext, MemorySearchHit } from './protocol.ts'
import type { NativeMemoryStore } from './native.ts'
import { pickNegativeCoverage, type MemoryNegativeStore } from './negatives.ts'

export interface MemoryRecallResult {
  hits: MemorySearchHit[]
  degradedLayers: string[]
}

/** 单次召回同步补齐向量的上限：超出部分转后台预热，保证召回延迟可控。 */
const SYNC_EMBED_LIMIT = 96
/** 后台预热的分批大小（embedder 内部还会按上游 token 限制再分）。 */
const WARM_BATCH_SIZE = 32
/** query 向量缓存容量与有效期。 */
const QUERY_CACHE_LIMIT = 128
const QUERY_CACHE_TTL_MS = 30 * 60 * 1000

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
  /** 负记忆层（可选）：用于召回负覆盖提示；缺省时不做负覆盖。 */
  private readonly negatives?: MemoryNegativeStore
  /** query 向量缓存：vectorKey(model, query) → 向量。 */
  private readonly queryCache = new Map<string, { vector: Float32Array; at: number }>()

  constructor(native: NativeMemoryStore, rag: RagService, store: RagStore, negatives?: MemoryNegativeStore) {
    this.native = native
    this.rag = rag
    this.store = store
    this.negatives = negatives
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
        // 0.43.0：原为 list({ limit: 1000 })。语义路径要逐条算余弦，旧写法把候选硬截到最近
        // 1000 条——超过千条的旧记忆永远无法被语义召回命中（词法侧是全量扫），库越大盲区越大。
        const entries = this.native.listForSemanticRecall({ scope: input.scope, isolateScope: input.isolateScope })
        const model = settings.embedding.model
        const keys = entries.map((entry) => vectorKey(model, entry.content))
        // 一次批量取回全部已缓存向量：逐条取在千条规模下是本轮召回最大的本地开销。
        const vectors = this.store.getVectors(keys)
        const pending: Array<{ key: string; text: string }> = []
        for (let index = 0; index < entries.length; index += 1) {
          const key = keys[index]!
          if (!vectors.has(key)) pending.push({ key, text: entries[index]!.content })
        }
        const sync = pending.slice(0, SYNC_EMBED_LIMIT)
        const deferred = pending.slice(SYNC_EMBED_LIMIT)
        if (sync.length > 0) {
          const batchSize = Math.max(8, Math.min(64, settings.advanced.concurrency * 8))
          for (let start = 0; start < sync.length; start += batchSize) {
            const batch = sync.slice(start, start + batchSize)
            const embedded = await embedder.embed(batch.map((item) => item.text), model)
            for (let index = 0; index < batch.length; index += 1) {
              const vector = embedded[index]
              if (vector === undefined) continue
              this.store.putVector(batch[index]!.key, vector)
              vectors.set(batch[index]!.key, vector)
            }
          }
        }
        if (deferred.length > 0) this.warmVectors(embedder, model, deferred)
        const queryVector = await this.queryVector(embedder, model, input.query)
        const rawRanked = entries.map((entry, index) => ({ entry, score: cosine(queryVector, vectors.get(keys[index]!) ?? new Float32Array()) })).filter((item) => Number.isFinite(item.score) && item.score > 0).sort((a, b) => b.score - a.score)
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

    // P1-5 负覆盖：命中被否定过的说法时回吐警示，防止已被拒绝/证伪的错记忆继续冒充答案。
    // 负层一次取回后在内存比对，绝不逐条回库（负记忆本身不参与召回排序）。
    const negatives = this.negatives === undefined ? [] : this.negatives.list({ scope: input.scope, isolateScope: input.isolateScope })
    const guarded = negatives.length === 0 ? hits : hits.map((hit) => {
      const negative = pickNegativeCoverage(negatives, hit.entry.content)
      return negative === undefined ? hit : { ...hit, negative: { id: negative.id, kind: negative.kind, reason: negative.reason } }
    })

    return { hits: guarded, degradedLayers }
  }

  /** 取 query 向量：命中缓存直接复用，避免同一问题反复走远程嵌入。 */
  private async queryVector(embedder: RagEmbedder, model: string, query: string): Promise<Float32Array> {
    const key = vectorKey(model, query)
    const cached = this.queryCache.get(key)
    if (cached !== undefined && Date.now() - cached.at < QUERY_CACHE_TTL_MS) return cached.vector
    const vector = await embedder.embedQuery(query, model)
    if (!this.queryCache.has(key) && this.queryCache.size >= QUERY_CACHE_LIMIT) {
      const oldest = this.queryCache.keys().next().value
      if (oldest !== undefined) this.queryCache.delete(oldest)
    }
    this.queryCache.set(key, { vector, at: Date.now() })
    return vector
  }

  /**
   * 后台补齐缺失向量：不阻塞本次召回，失败静默（下次召回继续用词法兜底）。
   * 每批之间让出事件循环，避免同步 SQLite 写把宿主事件循环占住。
   */
  private warmVectors(embedder: RagEmbedder, model: string, items: Array<{ key: string; text: string }>): void {
    void (async () => {
      for (let start = 0; start < items.length; start += WARM_BATCH_SIZE) {
        const batch = items.slice(start, start + WARM_BATCH_SIZE)
        try {
          const embedded = await embedder.embed(batch.map((item) => item.text), model)
          for (let index = 0; index < batch.length; index += 1) {
            const vector = embedded[index]
            if (vector !== undefined) this.store.putVector(batch[index]!.key, vector)
          }
        } catch {
          // 预热失败不影响检索正确性：本地词法层始终可用，下一轮再试。
        }
        await new Promise((resolve) => { setTimeout(resolve, 0) })
      }
    })()
  }
}
