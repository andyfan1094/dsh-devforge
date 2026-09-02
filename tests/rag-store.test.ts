/**
 * RAG 存储层测试：kb/doc/chunk CRUD、级联删除、向量写入读回精度、设置。
 * 全程独立临时目录，绝不触碰生产 ~/.dsh。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDb } from '../src/store/db.ts'
import { RagStore, type RagChunkRecord } from '../src/rag/rag-store.ts'
import type { RagDocument, RagKnowledgeBase, RagSettings } from '../src/rag/protocol.ts'

function makeStore(): { store: RagStore; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'rag-store-'))
  const store = new RagStore(join(dir, 'main.db'), join(dir, 'vec.db'))
  return { store, dir }
}

const kb: RagKnowledgeBase = { id: 'kb1', name: '部署知识', source: 'manual', createdAt: 1 }
const doc: RagDocument = { id: 'd1', kbId: 'kb1', fileName: '部署.md', contentHash: 'h1', status: 'ready', chunkCount: 2, createdAt: 1 }
const chunks: RagChunkRecord[] = [
  { id: 'c1', docId: 'd1', kbId: 'kb1', seq: 0, headingPath: '部署 > 暂存', text: '暂存实例用隔离 HOME。', startLine: 0, endLine: 2, vecHash: 'v1' },
  { id: 'c2', docId: 'd1', kbId: 'kb1', seq: 1, headingPath: '部署 > 生产', text: '生产在 3080。', startLine: 2, endLine: 4, vecHash: 'v2' },
]

test('kb/doc/chunk 全链路：写入、读取、级联删除', () => {
  const { store, dir } = makeStore()
  store.putKb(kb)
  store.putDoc(doc)
  store.putChunks('d1', chunks)
  assert.equal(store.listKbs().length, 1)
  assert.equal(store.listDocs('kb1').length, 1)
  assert.equal(store.listChunks('d1').length, 2)
  assert.deepEqual(store.listChunks('d1').map(c => c.seq), [0, 1])

  // 删文档级联删切块
  store.deleteDoc('d1')
  assert.equal(store.listChunks('d1').length, 0)
  assert.equal(store.listDocs('kb1').length, 0)
  assert.equal(store.listKbs().length, 1)

  // 删库级联删文档
  store.putDoc(doc)
  store.deleteKb('kb1')
  assert.equal(store.listDocs().length, 0)
  assert.equal(store.listKbs().length, 0)
  closeDb(join(dir, 'main.db'))
})

test('向量写入读回：float32 精度无损、覆盖更新', () => {
  const { store, dir } = makeStore()
  const vec = Float32Array.from([0.1, -0.25, 0.333, 1e-8, 12345.678])
  store.putVector('k1', vec)
  const back = store.getVector('k1')!
  assert.equal(back.length, vec.length)
  for (let i = 0; i < vec.length; i++) {
    // float32 精度内一致（写入读回应逐位相等）
    assert.equal(back[i], vec[i])
  }
  assert.equal(store.getVector('不存在'), null)
  // 覆盖更新
  store.putVector('k1', Float32Array.from([1, 2]))
  assert.equal(store.getVector('k1')!.length, 2)
  closeDb(join(dir, 'main.db'))
})

test('设置单例读写', () => {
  const { store, dir } = makeStore()
  const settings: RagSettings = {
    embedding: { provider: 'zhipu', model: 'embedding-3' },
    rerank: { mode: 'zhipu', topN: 4 },
    chunk: { maxSize: 512, overlap: 64 },
    search: { topK: 8, vectorWeight: 0.5, threshold: 0.35 },
    advanced: { concurrency: 4, cacheEnabled: true, timeoutMs: 30000 },
  }
  store.putRagSettings(settings)
  assert.deepEqual(store.getRagSettings(), settings)
  closeDb(join(dir, 'main.db'))
})
