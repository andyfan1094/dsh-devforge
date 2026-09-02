/**
 * RAG 向量化客户端测试：分批、请求体协议、缓存键稳定性（不调真实 API）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildRequestBody, makeBatches, safeEmbeddingError, vectorKey } from '../src/rag/embedder.ts'

test('makeBatches：均匀分片、尾批收尾、空输入', () => {
  assert.deepEqual(makeBatches([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]])
  assert.deepEqual(makeBatches([], 16), [])
  assert.deepEqual(makeBatches([1], 16), [[1]])
  assert.throws(() => makeBatches([1], 0))
})

test('请求体协议形状：model + input 数组', () => {
  const body = JSON.parse(buildRequestBody('embedding-3', ['甲', '乙']))
  assert.deepEqual(body, { model: 'embedding-3', input: ['甲', '乙'] })
})

test('缓存键：同文本同模型稳定，任一变化即不同', () => {
  const a = vectorKey('embedding-3', '暂存实例需要隔离 HOME')
  const b = vectorKey('embedding-3', '暂存实例需要隔离 HOME')
  const c = vectorKey('embedding-3', '生产实例')
  const d = vectorKey('other-model', '暂存实例需要隔离 HOME')
  assert.equal(a, b)
  assert.notEqual(a, c)
  assert.notEqual(a, d)
  assert.equal(a.length, 64) // sha256 hex
})

test('错误脱敏：Bearer Key 绝不外泄', () => {
  const dirty = new Error('请求失败 header=Bearer sk-secret-12345 超时')
  const clean = safeEmbeddingError(dirty)
  assert.ok(!clean.includes('sk-secret-12345'))
  assert.ok(clean.includes('[redacted]'))
})
