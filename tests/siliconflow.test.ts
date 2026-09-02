/**
 * 硅基流动单测：provider 合并满足 llm-pi-ai 目录外路由校验（api/baseURL/容量兜底）。
 *
 * 背景（0.16.3 教训）：merge 只写 models 时，llm-pi-ai 校验器会以
 * "model \"…\" needs an api" 拒绝整条 provider 写入，导致模型目录永远停在兜底清单。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// store.db 兜底写入会打开真实默认路径，测试一律隔离到临时 HOME。
process.env.DSH_HOME = join(tmpdir(), 'dsh-devforge-test-' + String(process.pid))

const { mergeSiliconFlowProvider, parseModelIds, SILICONFLOW_PROVIDER_ID } = await import('../src/siliconflow/service.ts')

test('provider 合并：目录外路由必须带 api 与 baseURL，容量走 provider 兜底', () => {
  const merged = mergeSiliconFlowProvider(undefined, 'SILICONFLOW_API_KEY', ['deepseek-ai/DeepSeek-V4-Flash', 'BAAI/bge-m3'])
  assert.equal(merged.api, 'openai-completions')
  assert.equal(merged.baseURL, 'https://api.siliconflow.cn/v1')
  assert.equal(merged.apiKeyEnv, 'SILICONFLOW_API_KEY')
  assert.equal(merged.displayName, '硅基流动')
  assert.ok(Number(merged.defaultContextWindow) > 0)
  assert.ok(Number(merged.defaultMaxTokens) > 0)
  assert.deepEqual(merged.models, [
    { id: 'deepseek-ai/DeepSeek-V4-Flash', name: 'deepseek-ai/DeepSeek-V4-Flash' },
    { id: 'BAAI/bge-m3', name: 'BAAI/bge-m3' },
  ])
})

test('provider 合并：保留用户已有模型与字段，追加新模型不重复', () => {
  const existing = { apiKeyEnv: 'MY_KEY', displayName: '我的硅基', api: 'openai-completions', models: [{ id: 'Qwen/Qwen3-32B', contextWindow: 40_960, maxTokens: 16_384 }] }
  const merged = mergeSiliconFlowProvider(existing, 'SILICONFLOW_API_KEY', ['Qwen/Qwen3-32B', 'deepseek-ai/DeepSeek-V4-Flash'])
  assert.equal(merged.apiKeyEnv, 'MY_KEY')
  assert.equal(merged.displayName, '我的硅基')
  assert.equal(merged.api, 'openai-completions')
  const models = merged.models as Array<Record<string, unknown>>
  assert.equal(models.length, 2)
  assert.equal(models[0]?.contextWindow, 40_960)
  assert.deepEqual(models[1], { id: 'deepseek-ai/DeepSeek-V4-Flash', name: 'deepseek-ai/DeepSeek-V4-Flash' })
})

test('模型清单解析：兼容 data 数组、裸数组并去重空值', () => {
  assert.deepEqual(parseModelIds({ data: [{ id: 'a' }, { id: 'a' }, { id: '' }, null] }), ['a'])
  assert.deepEqual(parseModelIds(['b', 'b', '']), ['b'])
  assert.deepEqual(parseModelIds(null), [])
  assert.equal(SILICONFLOW_PROVIDER_ID, 'siliconflow')
})
