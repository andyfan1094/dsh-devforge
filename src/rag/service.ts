/**
 * RAG 服务编排层 —— 入库管线 + 检索管线 + 索引生命周期。
 *
 * 入库：直传文本 → 切块 → 缓存命中判断 → 批量嵌入(未命中的) → 落库 → 索引失效。
 *   幂等：同名同 contentHash 且 ready 的文档直接返回（零嵌入调用）。
 *   防重复计费：chunk 文本 vectorKey 命中向量库的不再调 API。
 * 检索：查询向量化 → 各库 hybrid → 合并排序 → topK（阈值默认不过滤）。
 * 索引惰性加载：首次访问某库时重建 Orama 实例并缓存；变更即失效。
 */
import { createHash, randomUUID } from 'node:crypto'
import { chunkDocument, type TextChunk } from './chunker.ts'
import { RagIndexEngine, type RagIndexChunk, type RagIndexHit } from './index-engine.ts'
import type { RagDocument, RagKnowledgeBase, RagSearchHit, RagSearchRequest, RagSettings } from './protocol.ts'
import { RagStore, type RagChunkRecord } from './rag-store.ts'
import { vectorKey } from './embedder.ts'

/** 向量化器接口（ZhipuEmbedder 实现；单测注入 FakeEmbedder）。model 每次传入，随设置动态切换。 */
export interface RagEmbedder {
  embed(texts: string[], model?: string): Promise<Float32Array[]>
  embedQuery(text: string, model?: string): Promise<Float32Array>
}

/** 全局默认设置（面板未配置时的兜底值）。 */
export const DEFAULT_RAG_SETTINGS: RagSettings = {
  embedding: { provider: 'zhipu', model: 'embedding-3' },
  rerank: { mode: 'zhipu', topN: 4 },
  chunk: { maxSize: 512, overlap: 64 },
  search: { topK: 8, vectorWeight: 0.5, threshold: 0 },
  advanced: { concurrency: 4, cacheEnabled: true, timeoutMs: 30000 },
}

/** RAG 服务（进程内单例由接线层持有）。 */
export class RagService {
  private readonly store: RagStore
  /** 渠道 → 向量化器：设置里切渠道即切凭据与端点（面板可配）。 */
  private readonly embedders: Record<string, RagEmbedder>
  private readonly engines = new Map<string, RagIndexEngine>()

  constructor(store: RagStore, embedders: Record<string, RagEmbedder>) {
    this.store = store
    this.embedders = embedders
  }

  getSettings(): RagSettings {
    return this.store.getRagSettings() ?? DEFAULT_RAG_SETTINGS
  }

  /** 按当前设置的渠道取向量化器；未知渠道回退智谱。 */
  pickEmbedder(settings: RagSettings): RagEmbedder {
    return this.embedders[settings.embedding.provider] ?? this.embedders.zhipu!
  }

  putSettings(settings: RagSettings): void {
    this.store.putRagSettings(settings)
    // 切块/向量模型变化会让索引与向量失效：全部丢弃，下次惰性重建
    this.engines.clear()
  }

  listKbs(): RagKnowledgeBase[] {
    return this.store.listKbs()
  }

  createKb(name: string, options?: { description?: string; source?: RagKnowledgeBase['source'] }): RagKnowledgeBase {
    const kb: RagKnowledgeBase = {
      id: randomUUID(),
      name,
      source: options?.source ?? 'manual',
      createdAt: Date.now(),
      ...(options?.description !== undefined ? { description: options.description } : {}),
    }
    this.store.putKb(kb)
    return kb
  }

  deleteKb(kbId: string): void {
    this.store.deleteKb(kbId)
    this.engines.delete(kbId)
  }

  listDocs(kbId?: string): RagDocument[] {
    return this.store.listDocs(kbId)
  }

  /** 直传文本入库（文件解析由接线层完成后调用；镜像/URL 数据同入口）。 */
  async ingestText(kbId: string, fileName: string, text: string): Promise<RagDocument> {
    const settings = this.getSettings()
    const model = settings.embedding.model
    const embedder = this.pickEmbedder(settings)
    const hash = createHash('sha256').update(text).digest('hex')

    // 幂等：同名同内容且已就绪 → 零成本返回
    const existing = this.store.listDocs(kbId).find(doc => doc.fileName === fileName)
    if (existing !== undefined && existing.contentHash === hash && existing.status === 'ready') return existing

    // 切块（库级参数优先，缺省继承全局）
    const kb = this.listKbs().find(item => item.id === kbId)
    const chunkOptions = kb?.chunk ?? settings.chunk
    const chunks = chunkDocument(text, chunkOptions)

    // 缓存命中判断：命中的直接复用向量，未命中的收集后一次性批量嵌入
    const vectors: Array<Float32Array | null> = chunks.map(() => null)
    const pending: number[] = []
    for (let i = 0; i < chunks.length; i++) {
      const cached = this.store.getVector(vectorKey(model, chunks[i].text))
      if (cached !== null) vectors[i] = cached
      else pending.push(i)
    }
    if (pending.length > 0) {
      const embedded = await embedder.embed(pending.map(i => chunks[i].text), model)
      for (let j = 0; j < pending.length; j++) {
        const chunkIdx = pending[j]
        const key = vectorKey(model, chunks[chunkIdx].text)
        this.store.putVector(key, embedded[j])
        vectors[chunkIdx] = embedded[j]
      }
    }

    // 落库（复用文档 id 便于幂等）
    const docId = existing?.id ?? randomUUID()
    const records: RagChunkRecord[] = chunks.map((chunk, i) => ({
      id: docId + ':c' + i,
      docId,
      kbId,
      seq: chunk.seq,
      headingPath: chunk.headingPath,
      text: chunk.text,
      startLine: chunk.startLine,
      endLine: chunk.endLine,
      vecHash: vectorKey(model, chunk.text),
    }))
    this.store.putChunks(docId, records)
    const doc: RagDocument = {
      id: docId,
      kbId,
      fileName,
      contentHash: hash,
      status: 'ready',
      chunkCount: chunks.length,
      createdAt: existing?.createdAt ?? Date.now(),
    }
    this.store.putDoc(doc)
    this.engines.delete(kbId) // 索引失效，下次访问重建
    return doc
  }

  deleteDoc(docId: string): void {
    const doc = this.store.getDoc(docId)
    this.store.deleteDoc(docId)
    if (doc !== undefined) this.engines.delete(doc.kbId)
  }

  /** 切块预览（不入库、不嵌入，面板调参用）。 */
  previewChunks(text: string, options?: { maxSize?: number; overlap?: number }): TextChunk[] {
    return chunkDocument(text, options)
  }

  async search(request: RagSearchRequest): Promise<RagSearchHit[]> {
    const settings = this.getSettings()
    const topK = request.topK ?? settings.search.topK
    const vectorWeight = request.vectorWeight ?? settings.search.vectorWeight
    const kbIds = request.kbIds ?? this.listKbs().map(kb => kb.id)
    if (kbIds.length === 0) return []
    const queryVector = await this.pickEmbedder(settings).embedQuery(request.query, settings.embedding.model)
    const all: RagIndexHit[] = []
    for (const kbId of kbIds) {
      const engine = await this.ensureEngine(kbId)
      if (engine.size === 0) continue // 空库跳过（维度无从判定，也无需检索）
      const hits = await engine.searchHybrid(request.query, queryVector, { topK, vectorWeight })
      all.push(...hits)
    }
    all.sort((a, b) => b.score - a.score)
    const capped = all.slice(0, topK)
    const threshold = settings.search.threshold
    return capped.filter(hit => threshold <= 0 || hit.score >= threshold).map(hit => ({ ...hit }))
  }

  /** 惰性加载某库索引：从 store 读全部 chunk + 向量重建 Orama 实例。 */
  private async ensureEngine(kbId: string): Promise<RagIndexEngine> {
    const cached = this.engines.get(kbId)
    if (cached !== undefined) return cached
    const docs = this.store.listDocs(kbId)
    let engine: RagIndexEngine | null = null
    const indexChunks: RagIndexChunk[] = []
    for (const doc of docs) {
      if (doc.status !== 'ready') continue
      for (const record of this.store.listChunks(doc.id)) {
        const vector = this.store.getVector(record.vecHash)
        if (vector === null) continue // 向量缺失（跨端恢复未重建）跳过，不炸检索
        // 维度由首个实际向量决定（渠道可切换，不硬编码；空库兜底 1024）
        if (engine === null) engine = new RagIndexEngine(vector.length)
        indexChunks.push({
          chunkId: record.id,
          docId: record.docId,
          kbId: record.kbId,
          fileName: doc.fileName,
          headingPath: record.headingPath,
          text: record.text,
          vector: Array.from(vector),
        })
      }
    }
    const target = engine ?? new RagIndexEngine(1024)
    await target.addChunks(indexChunks)
    this.engines.set(kbId, target)
    return target
  }
}