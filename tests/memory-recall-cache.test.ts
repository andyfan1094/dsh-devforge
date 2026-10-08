/**
 * 记忆召回性能改造专项测试（2026-10-08 根治「记忆多了召回卡」）：
 * - 记忆快照缓存：读命中、写后即见、其它连接写入后自动重建；
 * - 向量批量读取：与单条一致、缺失不返回、重复去重；
 * - 召回：query 向量缓存使之不重复走远程嵌入，内容向量已缓存时零嵌入调用。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { closeAllDb } from '../src/store/db.ts'
import { RagStore } from '../src/rag/rag-store.ts'
import { RagService, type RagEmbedder } from '../src/rag/service.ts'
import { vectorKey } from '../src/rag/embedder.ts'
import { NativeMemoryStore } from '../src/memory/native.ts'
import { MemoryRecallService } from '../src/memory/recall.ts'
import type { RagSettings } from '../src/rag/protocol.ts'

function makeRig(): { dir: string; store: RagStore; native: NativeMemoryStore } {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-recall-cache-'))
  const store = new RagStore(join(dir, 'store.db'), join(dir, 'rag-vec.db'))
  return { dir, store, native: new NativeMemoryStore(store) }
}

const TEST_SETTINGS: RagSettings = {
  embedding: { provider: 'modagentai', model: 'test-embed' },
  rerank: { mode: 'off', topN: 4 },
  chunk: { maxSize: 512, overlap: 64 },
  search: { topK: 8, vectorWeight: 0.5, threshold: 0 },
  advanced: { concurrency: 1, cacheEnabled: true, timeoutMs: 30_000 },
  mirrorSync: { enabled: false, intervalMinutes: 60 },
}

/** 直接向 docs 域写一行，模拟「另一个 Host 进程」的写入。 */
function writeRawDoc(dbPath: string, domain: string, id: string, data: unknown): void {
  const db = new DatabaseSync(dbPath)
  const now = Date.now()
  db.prepare('INSERT OR REPLACE INTO docs (domain, id, data, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(domain, id, JSON.stringify(data), now, now, now)
  db.close()
}

test('记忆快照缓存：写入后立刻可见（create/update/archive/delete）', () => {
  const { native } = makeRig()
  native.create({ content: '第一条记忆', importance: 3 }, 'm1')
  assert.equal(native.list({}).length, 1) // 建立快照
  native.create({ content: '第二条记忆', importance: 3 }, 'm2')
  assert.equal(native.list({}).length, 2)
  native.update('m1', { content: '第一条记忆（已改）' })
  assert.equal(native.list({}).find((entry) => entry.id === 'm1')?.content, '第一条记忆（已改）')
  native.archive('m2', true)
  assert.equal(native.list({}).some((entry) => entry.id === 'm2'), false)
  assert.equal(native.delete('m1'), true)
  assert.equal(native.list({}).length, 0)
  closeAllDb()
})

test('记忆快照缓存：markAccessed 高频写不丢条目且计数生效', () => {
  const { native } = makeRig()
  native.create({ content: '曝光计数记忆', importance: 3 }, 'a1')
  native.create({ content: '另一条记忆', importance: 3 }, 'a2')
  assert.equal(native.list({}).length, 2)
  native.markAccessed(['a1'])
  native.markAccessed(['a1'])
  assert.equal(native.getMeta('a1')?.accessCount, 2)
  const listed = native.list({})
  assert.equal(listed.length, 2)
  // 就地更新快照后仍能读到最新计数，且没有因此丢掉任何条目
  assert.equal(listed.find((entry) => entry.id === 'a1')?.accessCount, 2)
  closeAllDb()
})

test('记忆快照缓存：其它连接写入后自动重建（跨进程一致性）', () => {
  const { dir, native } = makeRig()
  native.create({ content: '本地进程写的记忆', importance: 3 }, 'x1')
  assert.equal(native.list({}).length, 1)
  const now = Date.now()
  writeRawDoc(join(dir, 'store.db'), 'memory.entry', 'x2', { id: 'x2', content: '外部进程写入的记忆', category: 'fact', tags: [], importance: 3, pinned: false, trust: 'inferred', createdAt: now, updatedAt: now })
  writeRawDoc(join(dir, 'store.db'), 'memory.meta', 'x2', { entryId: 'x2', schemaVersion: 2, revision: 1, state: 'active', trust: 'inferred', confidence: 0.5, scope: { kind: 'global' }, evidence: [], accessCount: 0, usedCount: 0, helpfulCount: 0, harmfulCount: 0, updatedAt: now })
  assert.equal(native.list({}).length, 2)
  assert.equal(native.get('x2')?.content, '外部进程写入的记忆')
  closeAllDb()
})

test('向量批量读取：与单条一致、缺失不返回、重复去重', () => {
  const { store } = makeRig()
  const v1 = new Float32Array([0.5, -0.25, 1.5])
  const v2 = new Float32Array([2, 3, 4])
  store.putVector('h1', v1)
  store.putVector('h2', v2)
  const batch = store.getVectors(['h1', 'h2', 'missing', 'h1'])
  assert.equal(batch.size, 2)
  assert.deepEqual([...batch.get('h1')!], [...v1])
  assert.deepEqual([...batch.get('h2')!], [...v2])
  assert.equal(batch.has('missing'), false)
  assert.equal(store.getVectors([]).size, 0)
  assert.deepEqual([...store.getVector('h1')!], [...v1])
  closeAllDb()
})

test('召回：同一 query 复用向量缓存，不重复调用远程嵌入', async () => {
  const { store, native } = makeRig()
  let queryCalls = 0
  let embedCalls = 0
  const embedder: RagEmbedder = {
    async embed(texts: string[]): Promise<Float32Array[]> { embedCalls += 1; return texts.map(() => new Float32Array([1, 0, 0])) },
    async embedQuery(): Promise<Float32Array> { queryCalls += 1; return new Float32Array([1, 0, 0]) },
  }
  store.putRagSettings(TEST_SETTINGS)
  const recall = new MemoryRecallService(native, new RagService(store, { modagentai: embedder }), store)
  native.create({ content: '记忆召回性能改造把全量解析换成快照缓存', tags: ['记忆'], importance: 4 }, 'r1')
  const request = { query: '记忆召回性能', scope: { kind: 'global' as const }, isolateScope: false, semantic: true, semanticWeight: 0.35, threshold: 0, limit: 4 }
  const first = await recall.recall(request)
  assert.ok(first.hits.length >= 1)
  assert.equal(first.degradedLayers.length, 0)
  assert.equal(queryCalls, 1)
  const second = await recall.recall(request)
  assert.ok(second.hits.length >= 1)
  assert.equal(queryCalls, 1, '第二次召回应命中 query 向量缓存')
  assert.ok(embedCalls >= 1, '内容向量补齐仍应调用嵌入接口')
  closeAllDb()
})

test('召回：内容向量已在缓存时零嵌入调用', async () => {
  const { store, native } = makeRig()
  let embedCalls = 0
  const embedder: RagEmbedder = {
    async embed(texts: string[]): Promise<Float32Array[]> { embedCalls += 1; return texts.map(() => new Float32Array([1, 0, 0])) },
    async embedQuery(): Promise<Float32Array> { return new Float32Array([1, 0, 0]) },
  }
  store.putRagSettings(TEST_SETTINGS)
  const recall = new MemoryRecallService(native, new RagService(store, { modagentai: embedder }), store)
  const content = '预热过的记忆条目'
  native.create({ content, tags: ['记忆'], importance: 4 }, 'w1')
  store.putVector(vectorKey(TEST_SETTINGS.embedding.model, content), new Float32Array([1, 0, 0]))
  const result = await recall.recall({ query: '预热过的记忆', scope: { kind: 'global' as const }, isolateScope: false, semantic: true, semanticWeight: 0.35, threshold: 0, limit: 4 })
  assert.ok(result.hits.length >= 1)
  assert.equal(embedCalls, 0, '内容向量命中缓存时不应再调用嵌入接口')
  closeAllDb()
})
