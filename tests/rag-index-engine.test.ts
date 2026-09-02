/**
 * RAG 索引引擎测试：中文全文命中（阶段0冒烟问题端到端回归）、向量检索、hybrid 融合。
 * 使用 4 维假向量（测试不调 embedding API）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { RagIndexEngine, type RagIndexChunk } from '../src/rag/index-engine.ts'

/** 4 维假向量引擎。 */
function makeEngine(): RagIndexEngine { return new RagIndexEngine(4) }

function makeChunks(): RagIndexChunk[] {
  return [
    { chunkId: 'c1', docId: 'd1', kbId: 'kb1', fileName: '部署文档.md', headingPath: '部署 > 暂存实例', text: '天工造梦暂存实例需要隔离 HOME 启动，端口固定 3081。', vector: [0.1, 0.2, 0.3, 0.4] },
    { chunkId: 'c2', docId: 'd1', kbId: 'kb1', fileName: '部署文档.md', headingPath: '部署 > 生产', text: '生产实例运行在 3080 端口，承载真实凭据。', vector: [0.9, 0.8, 0.7, 0.6] },
    { chunkId: 'c3', docId: 'd2', kbId: 'kb1', fileName: '笔记.txt', headingPath: '', text: '今天天气不错，适合出去散步。', vector: [0.5, 0.5, 0.5, 0.5] },
  ]
}

test('中文全文检索命中（冒烟问题的最终验证）', async () => {
  const engine = makeEngine()
  await engine.addChunks(makeChunks())
  const hits = await engine.searchFulltext('暂存实例', { topK: 3 })
  assert.ok(hits.length >= 1, '应至少命中 1 条：' + JSON.stringify(hits.map(h => h.text)))
  assert.equal(hits[0].chunkId, 'c1')
  assert.ok(hits[0].score > 0)
})

test('向量检索：最接近的向量排第一', async () => {
  const engine = makeEngine()
  await engine.addChunks(makeChunks())
  const hits = await engine.searchVector([0.1, 0.2, 0.3, 0.4], { topK: 2 })
  assert.equal(hits[0].chunkId, 'c1')
  assert.ok(hits.length >= 2)
})

test('hybrid 检索：文本+向量双信号融合', async () => {
  const engine = makeEngine()
  await engine.addChunks(makeChunks())
  const hits = await engine.searchHybrid('暂存实例', [0.1, 0.2, 0.3, 0.4], { topK: 3, vectorWeight: 0.5 })
  assert.ok(hits.length >= 1)
  assert.equal(hits[0].chunkId, 'c1', '双信号都指向 c1 应排第一：' + JSON.stringify(hits.map(h => [h.chunkId, h.score])))
})

test('无命中查询返回空数组', async () => {
  const engine = makeEngine()
  await engine.addChunks(makeChunks())
  const hits = await engine.searchFulltext('量子纠缠薛定谔')
  assert.equal(hits.length, 0)
})
