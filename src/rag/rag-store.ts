/**
 * RAG 存储层 —— 主数据进 store.db（随 CNB 备份跨端），向量进独立 rag-vec.db
 * （派生物不进备份，跨端恢复后本地重建）。
 *
 * 数据布局：
 * - store.db docs 域：rag.kb（知识库）/ rag.doc（文档）/ rag.chunk（切块元数据+文本）；
 * - store.db settings 域：rag.settings（全局设置单例）；
 * - rag-vec.db vec 表：hash → 向量 BLOB（小端 float32），主键即 vectorKey。
 *
 * 写入语义：kb 量小走整域 API；doc/chunk 用原生 SQL 细粒度 upsert/delete
 * （万级切块不能每次全量替换），全部包 withTransaction 保证原子。
 */
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { defaultDbPath, getDb, getSettings, putSettings, withTransaction } from '../store/db.ts'
import type { RagDocument, RagKnowledgeBase, RagSettings } from './protocol.ts'

/** 切块持久化记录（文本与元数据进主库，向量本体在 vec 库）。 */
export interface RagChunkRecord {
  id: string
  docId: string
  kbId: string
  seq: number
  headingPath: string
  text: string
  startLine: number
  endLine: number
  /** 向量缓存键（vectorKey(model,text)，指向 rag-vec.db）。 */
  vecHash: string
}

/** 向量库文件路径（与 store.db 同目录）。 */
function defaultVecDbPath(mainDbPath: string): string {
  return join(dirname(mainDbPath), 'rag-vec.db')
}

/** RAG 存储门面。 */
export class RagStore {
  private readonly db: DatabaseSync
  private readonly vecDb: DatabaseSync

  constructor(mainDbPath?: string, vecDbPath?: string) {
    const main = mainDbPath ?? defaultDbPath()
    this.db = getDb(main)
    const vecPath = vecDbPath ?? defaultVecDbPath(main)
    const dir = dirname(vecPath)
    mkdirSync(dir, { recursive: true })
    this.vecDb = new DatabaseSync(vecPath)
    this.vecDb.exec('PRAGMA journal_mode = WAL')
    this.vecDb.exec('PRAGMA busy_timeout = 5000')
    this.vecDb.exec('CREATE TABLE IF NOT EXISTS vec (hash TEXT PRIMARY KEY, dim INTEGER NOT NULL, data BLOB NOT NULL)')
  }

  // ── 知识库 ──

  listKbs(): RagKnowledgeBase[] {
    return this.listDomain('rag.kb') as RagKnowledgeBase[]
  }

  putKb(kb: RagKnowledgeBase): void {
    this.upsertDoc('rag.kb', kb.id, kb)
  }

  deleteKb(kbId: string): void {
    withTransaction(this.db, () => {
      this.db.prepare("DELETE FROM docs WHERE domain = 'rag.kb' AND id = ?").run(kbId)
      this.db.prepare("DELETE FROM docs WHERE domain = 'rag.doc' AND json_extract(data, '$.kbId') = ?").run(kbId)
      this.db.prepare("DELETE FROM docs WHERE domain = 'rag.chunk' AND json_extract(data, '$.kbId') = ?").run(kbId)
    })
  }

  // ── 文档 ──

  listDocs(kbId?: string): RagDocument[] {
    const all = this.listDomain('rag.doc') as RagDocument[]
    return kbId === undefined ? all : all.filter(doc => doc.kbId === kbId)
  }

  getDoc(docId: string): RagDocument | undefined {
    return (this.listDomain('rag.doc') as RagDocument[]).find(doc => doc.id === docId)
  }

  putDoc(doc: RagDocument): void {
    this.upsertDoc('rag.doc', doc.id, doc)
  }

  deleteDoc(docId: string): void {
    withTransaction(this.db, () => {
      this.db.prepare("DELETE FROM docs WHERE domain = 'rag.doc' AND id = ?").run(docId)
      this.db.prepare("DELETE FROM docs WHERE domain = 'rag.chunk' AND json_extract(data, '$.docId') = ?").run(docId)
    })
  }

  // ── 切块 ──

  listChunks(docId: string): RagChunkRecord[] {
    const rows = this.db.prepare("SELECT data FROM docs WHERE domain = 'rag.chunk' AND json_extract(data, '$.docId') = ? ORDER BY sort_order").all(docId) as Array<{ data: string }>
    return rows.map(row => JSON.parse(row.data) as RagChunkRecord)
  }

  /** 整文档覆写切块（先删后插，事务原子）。 */
  putChunks(docId: string, chunks: RagChunkRecord[]): void {
    withTransaction(this.db, () => {
      this.db.prepare("DELETE FROM docs WHERE domain = 'rag.chunk' AND json_extract(data, '$.docId') = ?").run(docId)
      const insert = this.db.prepare("INSERT INTO docs (domain, id, data, sort_order, created_at, updated_at) VALUES ('rag.chunk', ?, ?, ?, ?, ?)")
      const now = Date.now()
      for (let i = 0; i < chunks.length; i++) insert.run(chunks[i].id, JSON.stringify(chunks[i]), i, now, now)
    })
  }

  // ── 向量缓存（rag-vec.db，本地派生物）──

  getVector(hash: string): Float32Array | null {
    const row = this.vecDb.prepare('SELECT dim, data FROM vec WHERE hash = ?').get(hash) as { dim: number; data: Uint8Array } | undefined
    if (row === undefined) return null
    const buffer = Buffer.from(row.data)
    const out = new Float32Array(row.dim)
    for (let i = 0; i < row.dim; i++) out[i] = buffer.readFloatLE(i * 4)
    return out
  }

  putVector(hash: string, vector: Float32Array): void {
    const buffer = Buffer.alloc(vector.length * 4)
    for (let i = 0; i < vector.length; i++) buffer.writeFloatLE(vector[i], i * 4)
    this.vecDb.prepare('INSERT OR REPLACE INTO vec (hash, dim, data) VALUES (?, ?, ?)').run(hash, vector.length, buffer)
  }

  // ── 设置 ──

  getRagSettings(): RagSettings | undefined {
    return getSettings<RagSettings>(this.db, 'rag.settings')
  }

  putRagSettings(settings: RagSettings): void {
    putSettings(this.db, 'rag.settings', settings)
  }

  // ── 内部 ──

  private listDomain(domain: string): unknown[] {
    const rows = this.db.prepare('SELECT data FROM docs WHERE domain = ? ORDER BY sort_order').all(domain) as Array<{ data: string }>
    return rows.map(row => JSON.parse(row.data))
  }

  private upsertDoc(domain: string, id: string, data: unknown): void {
    const now = Date.now()
    this.db.prepare('INSERT OR REPLACE INTO docs (domain, id, data, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(domain, id, JSON.stringify(data), now, now, now)
  }
}
