/**
 * RAG 索引引擎 —— @orama/orama 封装：中文 tokenizer 接入 + hybrid 检索。
 *
 * 设计要点：
 * - 索引是派生物：主存在 store.db（源文档/切块/向量），本引擎进程内持有
 *   Orama 内存索引，启动或变更时从库重建（万级切块毫秒~秒级，可接受）；
 * - tokenizer 换成自研中文分词（segmenter.ts），中文 BM25 全文检索生效；
 * - 检索三模式：fulltext / vector / hybrid（默认，文本+向量加权融合）；
 * - 删除策略：文档删除走"整库重建"（简单可靠，规模足够）。
 */
import { create, insert, search, type AnyOrama } from '@orama/orama'
import { tokenizeForIndex } from './segmenter.ts'

/** 入索引的切块（向量已由 embedder 产出）。 */
export interface RagIndexChunk {
  chunkId: string
  docId: string
  kbId: string
  fileName: string
  headingPath: string
  text: string
  vector: number[]
}

/** 检索结果。 */
export interface RagIndexHit {
  chunkId: string
  docId: string
  kbId: string
  fileName: string
  headingPath: string
  text: string
  score: number
}

/** hybrid 检索参数。 */
export interface HybridSearchOptions {
  topK?: number
  /** 文本:向量权重（0-1，默认 0.5 均衡）。 */
  vectorWeight?: number
  /** 向量相似度阈值（默认 0，不过滤）。 */
  similarity?: number
}

/** Orama schema：text 做全文索引，embedding 做向量，其余为过滤/展示字段。 */
const SCHEMA = {
  text: 'string',
  embedding: 'vector[1024]',
  chunkId: 'string',
  docId: 'string',
  kbId: 'string',
  fileName: 'string',
  headingPath: 'string',
} as const

/**
 * RAG 索引引擎（进程内单库一实例；多知识库 = 多实例，按 kbId 隔离）。
 */
export class RagIndexEngine {
  private db: AnyOrama | null = null
  private readonly vectorDim: number
  private chunkCount = 0

  constructor(vectorDim = 1024) {
    this.vectorDim = vectorDim
  }

  /** 初始化（幂等）：建库并挂中文 tokenizer。 */
  async init(): Promise<void> {
    if (this.db !== null) return
    this.db = await create({
      // 向量维度动态拼接（智谱 embedding-3 为 1024，其他渠道可变）
      schema: { ...SCHEMA, embedding: ('vector[' + this.vectorDim + ']') as typeof SCHEMA.embedding },
      components: {
        // 中文分词：词典词元 + CJK bigram（查询与索引同源，一致性保证命中）。
        // 实现 Orama Tokenizer 完整接口：normalizationCache 按类型给空表
        //（分词函数自带 bigram，无需 Orama 的标准化缓存参与）。
        tokenizer: {
          language: 'zh',
          normalizationCache: new Map<string, string>(),
          tokenize: (raw: string) => tokenizeForIndex(raw),
        },
      },
    })
  }

  /** 已入索引的切块数（空库检索跳过的判断依据）。 */
  get size(): number {
    return this.chunkCount
  }

  /** 批量入索引。 */
  async addChunks(chunks: RagIndexChunk[]): Promise<void> {
    await this.init()
    this.chunkCount += chunks.length
    for (const chunk of chunks) {
      await insert(this.db!, {
        text: chunk.text,
        embedding: chunk.vector,
        chunkId: chunk.chunkId,
        docId: chunk.docId,
        kbId: chunk.kbId,
        fileName: chunk.fileName,
        headingPath: chunk.headingPath,
      })
    }
  }

  /** 全文检索（纯关键词；查询同样走中文分词）。 */
  async searchFulltext(query: string, options?: HybridSearchOptions): Promise<RagIndexHit[]> {
    await this.init()
    const result = await search(this.db!, {
      term: query,
      mode: 'fulltext',
      limit: options?.topK ?? 8,
    })
    return this.toHits(result)
  }

  /** 向量检索。 */
  async searchVector(queryVector: number[] | Float32Array, options?: HybridSearchOptions): Promise<RagIndexHit[]> {
    await this.init()
    const result = await search(this.db!, {
      mode: 'vector',
      vector: { value: queryVector, property: 'embedding' },
      limit: options?.topK ?? 8,
    })
    return this.toHits(result)
  }

  /** 混合检索（默认入口）：全文 + 向量加权融合。 */
  async searchHybrid(query: string, queryVector: number[] | Float32Array, options?: HybridSearchOptions): Promise<RagIndexHit[]> {
    await this.init()
    const vectorWeight = options?.vectorWeight ?? 0.5
    const result = await search(this.db!, {
      term: query,
      mode: 'hybrid',
      vector: { value: queryVector, property: 'embedding' },
      hybridWeights: { text: 1 - vectorWeight, vector: vectorWeight },
      limit: options?.topK ?? 8,
    })
    return this.toHits(result)
  }

  /** Orama 原始结果转统一命中结构。 */
  private toHits(result: { hits: Array<{ document: unknown; score: number }> }): RagIndexHit[] {
    return result.hits.map(hit => {
      const doc = hit.document as Record<string, unknown>
      return {
        chunkId: String(doc.chunkId),
        docId: String(doc.docId),
        kbId: String(doc.kbId),
        fileName: String(doc.fileName),
        headingPath: String(doc.headingPath ?? ''),
        text: String(doc.text),
        score: hit.score,
      }
    })
  }
}
