/** 上游兼容层：identity 请求头与压缩正文兜底解压（宿主全局 dispatcher 跨 undici 版本缺陷的回归防线）。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { gzipSync, deflateSync } from 'node:zlib'
import { decodeUpstreamBody, upstreamRequestHeaders, upstreamResponseText } from '../src/upstream-fetch.ts'
import { fetchArkPlanUsage } from '../src/ark/usage.ts'

test('upstreamRequestHeaders：默认要求未压缩正文，调用方显式头优先', () => {
  assert.deepEqual(upstreamRequestHeaders(), { 'accept-encoding': 'identity' })
  assert.equal(upstreamRequestHeaders({ authorization: 'Bearer k', accept: 'application/json' })['accept-encoding'], 'identity')
  assert.equal(upstreamRequestHeaders({ authorization: 'Bearer k' }).authorization, 'Bearer k')
  assert.equal(upstreamRequestHeaders({ 'accept-encoding': 'gzip' })['accept-encoding'], 'gzip')
})

test('decodeUpstreamBody：gzip/deflate 魔数兜底解压，普通文本原样返回', () => {
  const json = '{"ok":true,"msg":"智谱监控接口数据"}'
  assert.equal(decodeUpstreamBody(gzipSync(json, { level: 6 })), json)
  assert.equal(decodeUpstreamBody(deflateSync(json)), json)
  assert.equal(decodeUpstreamBody(Buffer.from(json, 'utf8')), json)
  // 魔数命中但内容损坏：回退原文，由上层按 JSON 解析报错
  assert.equal(decodeUpstreamBody(Buffer.from([0x1f, 0x8b, 0x00, 0x01])), Buffer.from([0x1f, 0x8b, 0x00, 0x01]).toString('utf8'))
  assert.equal(decodeUpstreamBody(Buffer.alloc(0)), '')
})

test('upstreamResponseText：等价 text()，但能解开未解压的 gzip 正文', async () => {
  const json = '{"ResponseMetadata":{},"Result":{"AFPFiveHour":{"Quota":10000,"Used":1000}}}'
  const compressed = new Response(gzipSync(json), { status: 200 })
  assert.equal(await upstreamResponseText(compressed), json)
  const plain = new Response(json, { status: 200 })
  assert.equal(await upstreamResponseText(plain), json)
})

test('回归 0.29.5：上游返回未解压 gzip 正文时方舟用量仍可解析（跨 undici 版本互操作缺陷）', async () => {
  const afpPayload = JSON.stringify({
    ResponseMetadata: { RequestId: 'x', Error: null },
    Result: { PlanType: 'medium', AFPFiveHour: { Quota: 10000, Used: 2500, ResetTime: 1789031565000 } },
  })
  const calls: Array<Record<string, string>> = []
  const fakeFetch = (async (url: string | URL, init?: { headers?: Record<string, string> }) => {
    calls.push(init?.headers ?? {})
    const body = url.toString().includes('GetAFPUsage') ? gzipSync(afpPayload) : gzipSync('{"ResponseMetadata":{},"Result":{"Status":"Reclaimed"}}')
    return new Response(body, { status: 200 })
  }) as unknown as typeof fetch
  const plans = await fetchArkPlanUsage({ accessKey: 'a', secretKey: 's', region: 'cn-beijing', timeoutMs: 1000, fetcher: fakeFetch })
  assert.equal(calls.length, 2)
  for (const headers of calls) assert.equal(headers['accept-encoding'], 'identity')
  const agent = plans.find((plan) => plan.product === 'agent-plan')
  assert.equal(agent?.error, undefined)
  assert.equal(agent?.periods[0]?.usedPercent, 25)
  assert.equal(plans.find((plan) => plan.product === 'coding-plan')?.subscribed, false)
})
