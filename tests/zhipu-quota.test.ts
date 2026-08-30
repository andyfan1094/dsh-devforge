import assert from 'node:assert/strict'
import test from 'node:test'
import { classifyQuotaLimit, parseQuotaLimits } from '../src/zhipu/quota.ts'
import { mergeZhipuProvider } from '../src/zhipu/service.ts'

test('解析当前 CREDIT_LIMIT 的 5 小时和周额度', () => {
  const limits = parseQuotaLimits([
    { type: 'CREDIT_LIMIT', unit: 3, number: 5, percentage: 12.5, nextResetTime: '2026-08-30T12:00:00Z' },
    { type: 'CREDIT_LIMIT', unit: 6, number: 1, percentage: 44 },
  ])
  assert.deepEqual(limits.map((limit) => limit.kind), ['tokens-5h', 'tokens-week'])
  assert.equal(limits[0]?.usedPercent, 12.5)
})

test('兼容历史 TOKENS_LIMIT 和 MCP 额度', () => {
  const limits = parseQuotaLimits([
    { type: 'TIME_LIMIT', usageDetails: [{ modelCode: 'web-search', usage: 3 }] },
    { type: 'TOKENS_LIMIT', unit: 6, percentage: 20 },
    { type: 'TOKENS_LIMIT', unit: 3, percentage: 10 },
  ])
  assert.deepEqual(limits.map((limit) => limit.kind), ['tokens-5h', 'tokens-week', 'tools-month'])
  assert.deepEqual(limits[2]?.details, [{ name: 'web-search', used: 3 }])
})

test('模型完善只补缺失项并保留用户配置', () => {
  const merged = mergeZhipuProvider({
    apiKeyEnv: 'CUSTOM_ZHIPU_KEY',
    baseURL: 'https://gateway.example/v1',
    models: [{ id: 'glm-5.3', name: '自定义 GLM-5.3', maxTokens: 4096 }],
  }, 'ZAI_CODING_CN_API_KEY')
  assert.equal(merged.apiKeyEnv, 'CUSTOM_ZHIPU_KEY')
  assert.equal(merged.baseURL, 'https://gateway.example/v1')
  const models = merged.models as Array<Record<string, unknown>>
  assert.equal(models.length, 2)
  assert.equal(models[0]?.name, '自定义 GLM-5.3')
  assert.equal(models[0]?.maxTokens, 4096)
  assert.equal(models[1]?.id, 'glm-5.3-flash')
})

test('异常字段不会污染页面契约', () => {
  assert.equal(classifyQuotaLimit({ type: 'CREDIT_LIMIT', number: 5 }), 'tokens-5h')
  const limits = parseQuotaLimits([null, 'bad', { type: 'OTHER', percentage: Number.NaN }])
  assert.equal(limits.length, 1)
  assert.equal(limits[0]?.kind, 'unknown')
  assert.equal(limits[0]?.usedPercent, undefined)
})
