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
import { setImmediate as yieldToHost } from 'node:timers/promises'
import { chunkDocument, type TextChunk } from './chunker.ts'
import { RagIndexEngine, type RagIndexChunk, type RagIndexHit } from './index-engine.ts'
import type { RagDocument, RagKnowledgeBase, RagReembedReport, RagSearchHit, RagSearchRequest, RagSettings } from './protocol.ts'
import { RagStore, type RagChunkRecord } from './rag-store.ts'
import { vectorKey } from './embedder.ts'
import { LlmReranker, type Reranker, type LlmScoreFn } from './rerank.ts'

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
  mirrorSync: { enabled: false, intervalMinutes: 60 },
}

/** RAG 服务（进程内单例由接线层持有）。 */
export class RagService {
  private readonly store: RagStore
  /** 渠道 → 向量化器：设置里切渠道即切凭据与端点（面板可配）。 */
  private readonly embedders: Record<string, RagEmbedder>
  private readonly engines = new Map<string, RagIndexEngine>()
  /** 同库并发检索共享一次重建；按 Promise 身份判定是否仍有效，防旧任务覆盖更新后的索引。 */
  private readonly engineBuilds = new Map<string, Promise<RagIndexEngine>>()
  /** 智谱精排器（off 模式或未注入时跳过）。 */
  private reranker?: Reranker
  /** LLM 打分精排（rerank.mode=llm 时使用）。 */
  private rerankLlm?: LlmScoreFn

  constructor(store: RagStore, embedders: Record<string, RagEmbedder>) {
    this.store = store
    this.embedders = embedders
  }

  /** 注入精排器（接线层调用；渠道凭据每次请求解析）。 */
  setReranker(reranker: Reranker): void { this.reranker = reranker }

  /** 注入 LLM 打分函数（rerank.mode=llm 兜底）。 */
  setRerankLlm(score: LlmScoreFn): void { this.rerankLlm = score }

  /**
   * 读全局设置：按节与默认值做字段级规整合并。
   *
   * 必要性（2026-09-18）：旧版本写入的设置快照缺少后续新增的节
   *（如 mirrorSync），直接返回会让下游读到 undefined 而抛错；
   * 逐节合并保证「老库 + 新字段」永远拿到完整结构。
   */
  getSettings(): RagSettings {
    const stored = this.store.getRagSettings()
    if (stored === undefined) return DEFAULT_RAG_SETTINGS
    return {
      embedding: { ...DEFAULT_RAG_SETTINGS.embedding, ...stored.embedding },
      rerank: { ...DEFAULT_RAG_SETTINGS.rerank, ...stored.rerank },
      chunk: { ...DEFAULT_RAG_SETTINGS.chunk, ...stored.chunk },
      search: { ...DEFAULT_RAG_SETTINGS.search, ...stored.search },
      advanced: { ...DEFAULT_RAG_SETTINGS.advanced, ...stored.advanced },
      mirrorSync: { ...DEFAULT_RAG_SETTINGS.mirrorSync, ...stored.mirrorSync },
    }
  }

  /** 按当前设置的渠道取向量化器；未知渠道回退智谱。 */
  pickEmbedder(settings: RagSettings): RagEmbedder {
    return this.embedders[settings.embedding.provider] ?? this.embedders.zhipu!
  }

  putSettings(settings: RagSettings): void {
    this.store.putRagSettings(settings)
    // 切块/向量模型变化会让索引与向量失效：全部丢弃，下次惰性重建
    this.engines.clear()
    this.engineBuilds.clear()
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
    this.invalidateEngine(kbId)
  }

  /**
   * 更新知识库元数据（名称/来源/简介）。
   *
   * 用途（2026-09-21 记忆库退役）：外部镜像源退役后，历史镜像库转正为静态
   * 档案库——source 从 mirror 改为 manual 即脱离注入增强层（enhancementKbIds
   * 只收 mirror），检索资产原样保留；名称同步改为档案语义，避免误导。
   */
  updateKb(kbId: string, patch: { name?: string; source?: RagKnowledgeBase['source']; description?: string }): RagKnowledgeBase | undefined {
    const kb = this.store.listKbs().find((item) => item.id === kbId)
    if (kb === undefined) return undefined
    if (patch.name !== undefined && patch.name.trim() === '') throw new Error('name 不能为空')
    if (patch.source !== undefined && !['manual', 'project', 'mirror', 'memory'].includes(patch.source)) {
      throw new Error('source 非法：' + patch.source)
    }
    const next: RagKnowledgeBase = {
      ...kb,
      ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
      ...(patch.source !== undefined ? { source: patch.source } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
    }
    this.store.putKb(next)
    return next
  }

  listDocs(kbId?: string): RagDocument[] {
    return this.store.listDocs(kbId)
  }

  /** 直传文本入库（文件解析由接线层完成后调用；镜像/项目/记忆数据同入口）。 */
  async ingestText(kbId: string, fileName: string, text: string, options?: { sourcePath?: string; source?: RagKnowledgeBase['source'] }): Promise<RagDocument> {
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
      ...(options?.sourcePath !== undefined ? { sourcePath: options.sourcePath } : existing?.sourcePath !== undefined ? { sourcePath: existing.sourcePath } : {}),
      contentHash: hash,
      status: 'ready',
      chunkCount: chunks.length,
      createdAt: existing?.createdAt ?? Date.now(),
    }
    this.store.putDoc(doc)
    this.invalidateEngine(kbId) // 索引失效，下次访问重建
    return doc
  }

  deleteDoc(docId: string): void {
    const doc = this.store.getDoc(docId)
    this.store.deleteDoc(docId)
    if (doc !== undefined) this.invalidateEngine(doc.kbId)
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
      // 维度守卫：库内向量与当前查询向量维度不符（切换过向量模型且未重嵌）时，
      // 该库降级纯关键词检索——绝不因 Orama 维度校验炸掉整个多库检索。
      const hits = engine.dim === queryVector.length
        ? await engine.searchHybrid(request.query, queryVector, { topK, vectorWeight })
        : await engine.searchFulltext(request.query, { topK })
      all.push(...hits)
    }
    all.sort((a, b) => b.score - a.score)
    const capped = all.slice(0, topK)
    const reranked = await this.applyRerank(request.query, capped.map(hit => ({ ...hit })), settings.rerank.topN)
    const threshold = settings.search.threshold
    const kbNames = new Map(this.listKbs().map(kb => [kb.id, kb.name]))
    return reranked.filter(hit => threshold <= 0 || hit.score >= threshold).map(hit => ({ ...hit, kbName: kbNames.get(hit.kbId) ?? '' }))
  }

  /** 按全局重排设置对命中做精排（失败静默回退原序，绝不阻断检索）。导出供工作流复用。 */
  async rerankHits(query: string, hits: RagSearchHit[], topN: number): Promise<RagSearchHit[]> {
    return await this.applyRerank(query, hits, topN)
  }

  /** 重排实现：zhipu 渠道 / LLM 打分 / off 直通；异常回退原序。 */
  private async applyRerank(query: string, hits: RagSearchHit[], topN: number): Promise<RagSearchHit[]> {
    const settings = this.getSettings()
    if (settings.rerank.mode === 'off' || hits.length <= 1 || topN <= 0) return hits
    try {
      let order: number[] | undefined
      if (settings.rerank.mode === 'zhipu' && this.reranker !== undefined) {
        order = await this.reranker.rerank(query, hits.map(hit => ({ text: hit.text })), Math.min(topN, hits.length))
      } else if (settings.rerank.mode === 'llm' && this.rerankLlm !== undefined) {
        order = await new LlmReranker(this.rerankLlm).rerank(query, hits.map(hit => ({ text: hit.text })), Math.min(topN, hits.length))
      }
      if (order === undefined || order.length === 0) return hits
      return order.map(index => hits[index]!).filter(hit => hit !== undefined)
    } catch {
      return hits
    }
  }

  /** 读取某文档全部切块（记忆沉淀去重用）。 */
  listChunks(docId: string) {
    return this.store.listChunks(docId)
  }

  /** 统计某库（缺省全部库）就绪文档的切块总数（设置守卫的重嵌提示用）。 */
  countChunks(kbId?: string): number {
    const docs = this.store.listDocs(kbId).filter(doc => doc.status === 'ready')
    let total = 0
    for (const doc of docs) total += this.store.listChunks(doc.id).length
    return total
  }

  /**
   * 全库重嵌：切换向量模型后用当前设置重建向量空间（文档幂等挡不住的场景由这里兜底）。
   *
   * - 无需原文：逐块以「新模型 + 原文」的缓存键取向量，未命中的批量嵌入后覆写 vecHash；
   * - 同文本同模型永不重复计费（缓存命中计入 cached）；
   * - 单文档嵌入失败保留旧 vecHash（可回退），错误脱敏后计入报告，不中断整库；
   * - 旧模型的向量保留在缓存库（切回旧模型零成本），孤儿向量由跨端重建语义自然消化。
   */
  async reembedAll(kbIds?: string[]): Promise<RagReembedReport[]> {
    const settings = this.getSettings()
    const model = settings.embedding.model
    const embedder = this.pickEmbedder(settings)
    const targets = kbIds !== undefined && kbIds.length > 0 ? kbIds : this.listKbs().map(kb => kb.id)
    const reports: RagReembedReport[] = []
    for (const kbId of targets) {
      const readyDocs = this.store.listDocs(kbId).filter(doc => doc.status === 'ready')
      const report: RagReembedReport = { kbId, docs: readyDocs.length, chunks: 0, embedded: 0, cached: 0, errors: [] }
      for (const doc of readyDocs) {
        const records = this.store.listChunks(doc.id)
        report.chunks += records.length
        // 先按新模型缓存键分流：命中的直接算完成，未命中的凑一批调嵌入
        const pending: Array<{ record: RagChunkRecord; key: string }> = []
        for (const record of records) {
          const key = vectorKey(model, record.text)
          if (this.store.getVector(key) !== null) { report.cached += 1; continue }
          pending.push({ record, key })
        }
        if (pending.length > 0) {
          try {
            const vectors = await embedder.embed(pending.map(item => item.record.text), model)
            for (let i = 0; i < pending.length; i++) this.store.putVector(pending[i]!.key, vectors[i]!)
            report.embedded += pending.length
          } catch (error) {
            // 本文档向量不完整时绝不覆写 vecHash：保持旧指向，检索侧维度守卫可继续降级
            const message = error instanceof Error ? error.message : String(error)
            report.errors.push(doc.fileName + '：' + message.slice(0, 160))
            continue
          }
        }
        for (const record of records) record.vecHash = vectorKey(model, record.text)
        this.store.putChunks(doc.id, records)
        // 分页重建会在 I/O 间隙与重嵌交错：每篇覆写后立即失效，不能等整库嵌入结束，
        // 否则同一切块的新 rowid 可能被旧重建再次读取，形成重复或新旧模型混用。
        this.invalidateEngine(kbId)
      }
      this.invalidateEngine(kbId) // 索引失效，下次检索按新向量重建
      reports.push(report)
    }
    return reports
  }

  /** 惰性加载某库索引：从 store 读全部 chunk + 向量重建 Orama 实例。 */
  private async ensureEngine(kbId: string): Promise<RagIndexEngine> {
    const cached = this.engines.get(kbId)
    if (cached !== undefined) return cached
    const pending = this.engineBuilds.get(kbId)
    if (pending !== undefined) return pending

    // 首步让出事件循环，确保重建身份先存入 Map；同库并发请求只建一次。
    const job = this.buildEngine(kbId, () => this.engineBuilds.get(kbId) === job)
    this.engineBuilds.set(kbId, job)
    try {
      const engine = await job
      if (this.engineBuilds.get(kbId) === job) this.engines.set(kbId, engine)
      return engine
    } finally {
      if (this.engineBuilds.get(kbId) === job) this.engineBuilds.delete(kbId)
    }
  }

  /** 使缓存与在途重建一并失效；旧任务不得在稍后覆盖更新后的索引。 */
  private invalidateEngine(kbId: string): void {
    this.engines.delete(kbId)
    this.engineBuilds.delete(kbId)
  }

  /**
   * 分页重建：有限切块与向量批量读取，页间让出事件循环。
   * 不再逐篇扫描全域，也不一次展开万条高维 JS 数组；检索覆盖范围保持不变。
   */
  private async buildEngine(kbId: string, isCurrent: () => boolean): Promise<RagIndexEngine> {
    await yieldToHost()
    const docs = new Map(this.store.listDocs(kbId).filter(doc => doc.status === 'ready').map(doc => [doc.id, doc]))
    let engine: RagIndexEngine | null = null
    let cursor = 0
    while (true) {
      if (!isCurrent()) throw new Error('知识库内容已更新，请重新检索。')
      const page = this.store.listChunkPage(kbId, cursor)
      if (page.length === 0) break
      cursor = page[page.length - 1]!.cursor
      const records = page.map(row => row.chunk).filter(record => docs.has(record.docId))
      const vectors = this.store.getVectors(records.map(record => record.vecHash))
      const indexChunks: RagIndexChunk[] = []
      for (const record of records) {
        const vector = vectors.get(record.vecHash)
        if (vector === undefined) continue // 向量缺失（跨端恢复未重建）跳过，不炸检索
        // 维度由首个实际向量决定（渠道可切换，不硬编码；空库兜底 1024）
        if (engine === null) engine = new RagIndexEngine(vector.length)
        indexChunks.push({
          chunkId: record.id,
          docId: record.docId,
          kbId: record.kbId,
          fileName: docs.get(record.docId)!.fileName,
          headingPath: record.headingPath,
          text: record.text,
          vector: Array.from(vector),
        })
      }
      if (engine !== null) await engine.addChunks(indexChunks)
      await yieldToHost()
    }
    return engine ?? new RagIndexEngine(1024)
  }
}