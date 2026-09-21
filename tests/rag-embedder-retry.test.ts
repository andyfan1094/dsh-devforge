/**
 * RAG 嵌入器重试行为单测 —— 429/5xx 退避重试、4xx 直接失败（mock fetch，零真实网络）。
 * 背景（0.34.5）：方舟账号级频控在批量嵌入时必撞 429，硬跑只会一片失败。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { ZhipuEmbedder } from '../src/rag/embedder.ts'

/** 用受控响应序列替换全局 fetch 的样板已内联在各用例中。 */
const okBody = JSON.stringify({ data: [{ embedding: [0.1, 0.2, 0.3], index: 0 }] })

test('embedBatch：429 退避后重试成功，fetch 共调用 2 次', async () => {
  const embedder = new ZhipuEmbedder(async () => 'test-key', { baseURL: 'http://mock', path: '/embeddings' })
  let calls = 0
  const original = globalThis.fetch
  globalThis.fetch = (async (): Promise<Response> => {
    calls += 1
    if (calls === 1) return new Response('{"error":{"code":"AccountRateLimitExceeded","message":"too frequent"}}', { status: 429 })
    return new Response(okBody, { status: 200 })
  }) as typeof fetch
  try {
    const vectors = await embedder.embed(['文本'])
    assert.equal(vectors.length, 1)
    assert.equal(calls, 2, '429 后应重试一次')
  } finally {
    globalThis.fetch = original
  }
})

test('embedBatch：400 参数错误不重试，fetch 只调用 1 次', async () => {
  const embedder = new ZhipuEmbedder(async () => 'test-key', { baseURL: 'http://mock', path: '/embeddings' })
  let calls = 0
  const original = globalThis.fetch
  globalThis.fetch = (async (): Promise<Response> => {
    calls += 1
    return new Response('{"error":{"code":"InvalidParameter","message":"bad input"}}', { status: 400 })
  }) as typeof fetch
  try {
    await assert.rejects(() => embedder.embed(['文本']), /HTTP 400/)
    assert.equal(calls, 1, '4xx 不重试')
  } finally {
    globalThis.fetch = original
  }
})

test('embedBatch：连续 429 耗尽重试额度后失败，fetch 共调用 4 次（1+3 重试）', async () => {
  const embedder = new ZhipuEmbedder(async () => 'test-key', { baseURL: 'http://mock', path: '/embeddings' })
  let calls = 0
  const original = globalThis.fetch
  globalThis.fetch = (async (): Promise<Response> => {
    calls += 1
    return new Response('{"error":{"message":"rate limited"}}', { status: 429, headers: { 'retry-after': '0' } })
  }) as typeof fetch
  try {
    await assert.rejects(() => embedder.embed(['文本']), /HTTP 429/)
    assert.equal(calls, 4, '首次 + 3 次重试')
  } finally {
    globalThis.fetch = original
  }
})

test('embedBatch：5xx 同样触发退避重试', async () => {
  const embedder = new ZhipuEmbedder(async () => 'test-key', { baseURL: 'http://mock', path: '/embeddings' })
  let calls = 0
  const original = globalThis.fetch
  globalThis.fetch = (async (): Promise<Response> => {
    calls += 1
    if (calls === 1) return new Response('upstream boom', { status: 502 })
    return new Response(okBody, { status: 200 })
  }) as typeof fetch
  try {
    await embedder.embed(['文本'])
    assert.equal(calls, 2)
  } finally {
    globalThis.fetch = original
  }
})
