/** RAG 响应性与并发回归：独立临时库、假向量，绝不调用生产或付费接口。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setImmediate as yieldToHost } from 'node:timers/promises'
import { closeAllDb, getDb } from '../src/store/db.ts'
import { RagStore, type RagChunkRecord } from '../src/rag/rag-store.ts'
import { RagService } from '../src/rag/service.ts'
import { RagIndexEngine, type RagIndexChunk } from '../src/rag/index-engine.ts'

/** 批量准备既有文档，不经过嵌入与切块管线，以便准确测试冷启动重建。 */
function fixture(count = 192) {
  const dir = mkdtempSync(join(tmpdir(), 'rag-responsive-'))
  const path = join(dir, 'store.db')
  const store = new RagStore(path, join(dir, 'rag-vec.db'))
  const vector = Float32Array.from([0.1, 0.2, 0.3, 0.4])
  store.putVector('v1', vector)
  store.putKb({ id: 'kb', name: '响应性测试', source: 'manual', createdAt: 1 })
  store.putDoc({ id: 'doc', kbId: 'kb', fileName: '测试.md', contentHash: 'h', status: 'ready', chunkCount: count, createdAt: 1 })
  const chunks: RagChunkRecord[] = Array.from({ length: count }, (_, seq) => ({
    id: 'c' + seq, docId: 'doc', kbId: 'kb', seq, headingPath: '',
    text: '暂存实例部署需要隔离 HOME，正文序号 ' + seq, startLine: seq, endLine: seq, vecHash: 'v1',
  }))
  store.putChunks('doc', chunks)
  const fake = { async embedQuery() { return vector }, async embed(texts: string[]) { return texts.map(() => vector) } }
  const service = new RagService(store, { zhipu: fake })
  service.putSettings({ ...service.getSettings(), rerank: { mode: 'off', topN: 0 } })
  return { store, service, path, chunks, cleanup() { closeAllDb(); rmSync(dir, { recursive: true, force: true }) } }
}

test('切块游标分页无重漏，查询计划命中 kb/doc 表达式索引', () => {
  const f = fixture(193)
  try {
    const ids: string[] = []
    let cursor = 0
    while (true) {
      const page = f.store.listChunkPage('kb', cursor, 32)
      if (page.length === 0) break
      assert.ok(page.length <= 32)
      ids.push(...page.map(row => row.chunk.id))
      assert.ok(page[page.length - 1]!.cursor > cursor)
      cursor = page[page.length - 1]!.cursor
    }
    assert.deepEqual(ids, f.chunks.map(chunk => chunk.id))
    assert.deepEqual(f.store.listChunkPage('unknown'), [])
    const db = getDb(f.path)
    const kbPlan = db.prepare("EXPLAIN QUERY PLAN SELECT rowid,data FROM docs WHERE domain='rag.chunk' AND json_extract(data,'$.kbId')=? AND rowid>? ORDER BY rowid LIMIT ?").all('kb', 0, 64)
    const docPlan = db.prepare("EXPLAIN QUERY PLAN SELECT data FROM docs WHERE domain='rag.chunk' AND json_extract(data,'$.docId')=? ORDER BY sort_order,rowid").all('doc')
    assert.match(JSON.stringify(kbPlan), /idx_rag_chunk_kb/)
    assert.match(JSON.stringify(docPlan), /idx_rag_chunk_doc/)
  } finally { f.cleanup() }
})

test('冷启动并发检索共用一次分页重建，不再逐文档/逐向量查询，过程中放行 I/O', async () => {
  const f = fixture()
  let pageCalls = 0
  let vectorBatches = 0
  let ioRan = false
  const original = f.store.listChunkPage.bind(f.store)
  const vectors = f.store.getVectors.bind(f.store)
  f.store.listChunkPage = (...args) => { pageCalls++; return original(...args) }
  f.store.getVectors = (...args) => { vectorBatches++; return vectors(...args) }
  f.store.listChunks = () => { throw new Error('不允许退回逐文档读取') }
  f.store.getVector = () => { throw new Error('不允许退回逐条向量读取') }
  try {
    const first = f.service.search({ query: '暂存实例', kbIds: ['kb'] })
    const second = f.service.search({ query: '隔离 HOME', kbIds: ['kb'] })
    setImmediate(() => { ioRan = true })
    const [a, b] = await Promise.all([first, second])
    assert.ok(ioRan, '重建结束前应执行其它宏任务，不能只 await 微任务')
    assert.ok(a.length > 0 && b.length > 0)
    assert.equal(pageCalls, 4, '192 块：3 个数据页 + 1 个结束页，两请求共用一次')
    assert.equal(vectorBatches, 3)
    await f.service.search({ query: '暂存实例' })
    assert.equal(pageCalls, 4, '热检索复用已完成索引')
  } finally { f.cleanup() }
})

test('重建中删除文档：旧任务明确失效，不能把已删除内容写回缓存', async () => {
  const f = fixture()
  const original = f.store.listChunkPage.bind(f.store)
  let deleted = false
  f.store.listChunkPage = (...args) => {
    const page = original(...args)
    if (!deleted && page.length > 0) {
      deleted = true
      setImmediate(() => { f.service.deleteDoc('doc') })
    }
    return page
  }
  try {
    await assert.rejects(f.service.search({ query: '暂存实例' }), /知识库内容已更新/)
    assert.deepEqual(await f.service.search({ query: '暂存实例' }), [])
  } finally { f.cleanup() }
})

test('重嵌逐篇覆写期间立即失效，不得因 rowid 抬升重复召回已读切块', async () => {
  const f = fixture(128)
  let releaseSecond!: () => void
  const secondDocument = new Promise<void>(resolve => { releaseSecond = resolve })
  let rewriteDone!: () => void
  const firstRewritten = new Promise<void>(resolve => { rewriteDone = resolve })
  const originalPage = f.store.listChunkPage.bind(f.store)
  const originalWrite = f.store.putChunks.bind(f.store)
  let started = false
  let reembedding: Promise<unknown> | undefined
  try {
    f.store.putDoc({ id: 'second', kbId: 'kb', fileName: '第二篇.md', contentHash: 'h2', status: 'ready', chunkCount: 1, createdAt: 1 })
    f.store.putChunks('second', [{ ...f.chunks[0]!, id: 'second', docId: 'second', text: '第二篇暂存实例隔离' }])
    const vector = Float32Array.from([0.1, 0.2, 0.3, 0.4])
    const service = new RagService(f.store, { zhipu: {
      async embedQuery() { return vector },
      async embed(texts: string[]) { if (texts[0] === '第二篇暂存实例隔离') await secondDocument; return texts.map(() => vector) },
    } })
    f.store.putChunks = (...args) => { originalWrite(...args); if (started && args[0] === 'doc') rewriteDone() }
    f.store.listChunkPage = (...args) => {
      const page = originalPage(...args)
      if (!started && page.length > 0) {
        started = true
        setImmediate(() => { reembedding = service.reembedAll(['kb']) })
      }
      return page
    }
    const searching = service.search({ query: '暂存实例', topK: 300 })
    // 提前安装 rejection handler，避免人为 deferred 引入 unhandledRejection。
    const rejected = assert.rejects(searching, /知识库内容已更新/)
    await firstRewritten
    await rejected
    releaseSecond()
    await reembedding
    const hits = await service.search({ query: '暂存实例', topK: 300 })
    assert.equal(hits.length, 129)
    assert.equal(new Set(hits.map(hit => hit.chunkId)).size, 129)
  } finally { releaseSecond(); await reembedding; f.cleanup() }
})

test('重建异常后允许重试，不保留永久失败的在途 Promise', async () => {
  const f = fixture()
  const original = f.store.listChunkPage.bind(f.store)
  let fail = true
  f.store.listChunkPage = (...args) => { if (fail) { fail = false; throw new Error('模拟读取失败') }; return original(...args) }
  try {
    await assert.rejects(f.service.search({ query: '暂存实例' }), /模拟读取失败/)
    assert.ok((await f.service.search({ query: '暂存实例' })).length > 0)
  } finally { f.cleanup() }
})

test('分页重建保留 ready 过滤及缺失向量跳过语义', async () => {
  const f = fixture(1)
  try {
    f.store.putDoc({ id: 'failed', kbId: 'kb', fileName: '失败.md', contentHash: 'h', status: 'failed', chunkCount: 1, createdAt: 1 })
    for (const docId of ['failed', 'orphan', 'missing']) {
      f.store.putChunks(docId, [{ ...f.chunks[0]!, id: docId, docId, vecHash: docId === 'missing' ? 'absent' : 'v1' }])
    }
    f.store.putDoc({ id: 'missing', kbId: 'kb', fileName: '缺向量.md', contentHash: 'h', status: 'ready', chunkCount: 1, createdAt: 1 })
    const hits = await f.service.search({ query: '暂存实例', topK: 10 })
    assert.deepEqual(hits.map(hit => hit.chunkId), ['c0'])
  } finally { f.cleanup() }
})

test('Orama 长批插入主动让出事件循环，不靠已完成 Promise 伪异步', async () => {
  const engine = new RagIndexEngine(4)
  const chunks: RagIndexChunk[] = Array.from({ length: 1800 }, (_, i) => ({
    chunkId: 'c' + i, docId: 'doc', kbId: 'kb', fileName: '测试.md', headingPath: '',
    text: ('暂存实例与生产会话必须相互隔离，长文本建索引时其它功能仍须响应。').repeat(8) + i,
    vector: [0.1, 0.2, 0.3, 0.4],
  }))
  let yielded = false
  const inserting = engine.addChunks(chunks)
  setImmediate(() => { yielded = true })
  await inserting
  assert.ok(yielded, '长批建索引期间应调度其它 I/O')
  assert.equal(engine.size, chunks.length)
  assert.ok((await engine.searchFulltext('暂存实例')).length > 0)
  await yieldToHost()
})
