/**
 * RAG 服务编排层测试：入库、缓存防重复计费、幂等、检索、删除级联。
 * 使用 FakeEmbedder（确定性伪向量），不调真实 API。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDb } from '../src/store/db.ts'
import { RagStore } from '../src/rag/rag-store.ts'
import { RagService, type RagEmbedder } from '../src/rag/service.ts'

/** 伪向量化器：同文本同向量，调用计数器验证防重复计费。 */
class FakeEmbedder implements RagEmbedder {
  calls = 0
  async embed(texts: string[], _model?: string): Promise<Float32Array[]> {
    this.calls++
    return texts.map(t => this.vectorOf(t))
  }
  async embedQuery(text: string, _model?: string): Promise<Float32Array> {
    this.calls++
    return this.vectorOf(text)
  }
  private vectorOf(text: string): Float32Array {
    const code = text.codePointAt(0) ?? 0
    return Float32Array.from([((code % 97) + 1) / 98, 0.2, 0.3, 0.4])
  }
}

function makeService(): { service: RagService; fake: FakeEmbedder; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'rag-service-'))
  const store = new RagStore(join(dir, 'main.db'), join(dir, 'vec.db'))
  const fake = new FakeEmbedder()
  return { service: new RagService(store, { zhipu: fake, ark: fake, 'openai-gateway': fake }), fake, dir }
}

const DOC_TEXT = '# 部署\n天工造梦暂存实例需要隔离 HOME 启动，端口 3081。\n\n# 生产\n生产实例运行在 3080 端口。'

test('入库管线：切块落库、文档就绪', async () => {
  const { service, dir } = makeService()
  const kb = service.createKb('部署知识')
  const doc = await service.ingestText(kb.id, '部署.md', DOC_TEXT)
  assert.equal(doc.status, 'ready')
  assert.ok(doc.chunkCount >= 2)
  assert.equal(service.listDocs(kb.id).length, 1)
  closeDb(join(dir, 'main.db'))
})

test('检索管线：hybrid 命中正确切块并带出处信息', async () => {
  const { service, dir } = makeService()
  const kb = service.createKb('部署知识')
  await service.ingestText(kb.id, '部署.md', DOC_TEXT)
  const hits = await service.search({ query: '暂存实例怎么启动' })
  assert.ok(hits.length >= 1)
  assert.ok(hits[0].text.includes('暂存实例'))
  assert.equal(hits[0].fileName, '部署.md')
  closeDb(join(dir, 'main.db'))
})

test('幂等 + 缓存防重复计费：重复入库零嵌入调用', async () => {
  const { service, fake, dir } = makeService()
  const kb = service.createKb('幂等测试')
  await service.ingestText(kb.id, '文档.md', DOC_TEXT)
  const callsAfterFirst = fake.calls
  await service.ingestText(kb.id, '文档.md', DOC_TEXT)
  assert.equal(fake.calls, callsAfterFirst, '同文档重复入库不应再调嵌入')
  await service.ingestText(kb.id, '文档副本.md', DOC_TEXT)
  assert.equal(fake.calls, callsAfterFirst, '向量缓存命中时不应再调嵌入')
  assert.equal(service.listDocs(kb.id).length, 2)
  closeDb(join(dir, 'main.db'))
})

test('删除文档：级联清 chunk 且索引失效（搜不到）', async () => {
  const { service, dir } = makeService()
  const kb = service.createKb('删除测试')
  const doc = await service.ingestText(kb.id, '删除.md', DOC_TEXT)
  let hits = await service.search({ query: '暂存实例' })
  assert.ok(hits.length >= 1)
  service.deleteDoc(doc.id)
  hits = await service.search({ query: '暂存实例' })
  assert.equal(hits.length, 0, '删除后应检索不到')
  closeDb(join(dir, 'main.db'))
})

test('删除知识库：级联清空一切', async () => {
  const { service, dir } = makeService()
  const kb = service.createKb('待删库')
  await service.ingestText(kb.id, '任意.md', DOC_TEXT)
  service.deleteKb(kb.id)
  assert.equal(service.listKbs().length, 0)
  assert.equal(service.listDocs().length, 0)
  const hits = await service.search({ query: '暂存实例' })
  assert.equal(hits.length, 0)
  closeDb(join(dir, 'main.db'))
})

test('切块预览：不入库不嵌入', async () => {
  const { service, fake, dir } = makeService()
  const chunks = service.previewChunks(DOC_TEXT, { maxSize: 100, overlap: 0 })
  assert.ok(chunks.length >= 2)
  assert.equal(service.listDocs().length, 0)
  assert.equal(fake.calls, 0)
  closeDb(join(dir, 'main.db'))
})

test('维度守卫：异维度库降级纯关键词，检索不再抛错', async () => {
  const { service, dir } = makeService()
  // 库 A：正常 4 维向量（FakeEmbedder 产出）
  const kbA = service.createKb('正常库')
  await service.ingestText(kbA.id, '部署.md', DOC_TEXT)
  // 库 B：手工塞 8 维向量（模拟切过向量模型的旧库）
  const kbB = service.createKb('旧维度库')
  const oldKey = 'old-8dim-hash'
  const vec8 = Float32Array.from([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8])
  // 直接走底层 store 写入（绕过 ingestText 的嵌入管线）
  const store = (service as unknown as { store: RagStore }).store
  store.putVector(oldKey, vec8)
  store.putDoc({ id: 'doc-b1', kbId: kbB.id, fileName: '旧模型.md', contentHash: 'h1', status: 'ready', chunkCount: 1, createdAt: 1 })
  store.putChunks('doc-b1', [{ id: 'doc-b1:c0', docId: 'doc-b1', kbId: kbB.id, seq: 0, headingPath: '', text: '暂存实例必须隔离 HOME 启动。', startLine: 1, endLine: 1, vecHash: oldKey }])
  // 混库检索：修复前会因 Orama 2048/1024 类维度校验直接抛错；现在旧维度库降级关键词仍可命中
  const hits = await service.search({ query: '暂存实例' })
  assert.ok(hits.length >= 1, '维度不匹配不应炸掉检索')
  assert.ok(hits.some(hit => hit.text.includes('暂存实例')))
  closeDb(join(dir, 'main.db'))
})

test('全库重嵌：模型切换后 vecHash 迁移且缓存命中不重复计费', async () => {
  const { service, fake, dir } = makeService()
  const kb = service.createKb('重嵌库')
  await service.ingestText(kb.id, '部署.md', DOC_TEXT)
  const beforeCalls = fake.calls
  // 切到"新模型"（同 embedder、不同缓存键空间）
  service.putSettings({ ...service.getSettings(), embedding: { provider: 'zhipu', model: 'embedding-new' } })
  const reports = await service.reembedAll([kb.id])
  assert.equal(reports.length, 1)
  assert.ok(reports[0]!.chunks >= 2)
  assert.equal(reports[0]!.embedded, reports[0]!.chunks, '新键空间应全部实嵌')
  assert.equal(reports[0]!.errors.length, 0)
  assert.ok(fake.calls > beforeCalls, '重嵌应产生新嵌入调用')
  // 再跑一次：全部命中缓存，零新增调用、零重复计费
  const afterCalls = fake.calls
  const again = await service.reembedAll([kb.id])
  assert.equal(again[0]!.cached, again[0]!.chunks)
  assert.equal(fake.calls, afterCalls, '同文本同模型重复重嵌不应再调嵌入')
  // 重嵌后检索恢复正常
  const hits = await service.search({ query: '暂存实例' })
  assert.ok(hits.length >= 1)
  closeDb(join(dir, 'main.db'))
})