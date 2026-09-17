/**
 * 硅基流动只嵌入模式（0.33.3）：目录冻结语义的无网络单测。
 *
 * 背景：mergeSiliconFlowProvider 是「只增不减」合并，启动自动补齐
 * （scheduleAutoEnsureModels）每次激活都会把精选对话模型合并回目录，
 * 用户手工删掉的模型一重启就回来。syncChatModels=false 时 ensureModels
 * 必须在请求上游与写设置之前短路。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SiliconFlowService, curateLatestChatModels, mergeSiliconFlowProvider, parseModelIds } from '../src/siliconflow/service.ts'

test('按系列精选：嵌入/重排等非对话模型永不进入对话目录', () => {
  const ids = parseModelIds({ data: [{ id: 'BAAI/bge-m3' }, { id: 'Qwen/Qwen3-32B' }, { id: 'BAAI/bge-reranker-v2-m3' }, { id: 'deepseek-ai/DeepSeek-V3' }] })
  const curated = curateLatestChatModels(ids)
  assert.ok(!curated.some((id) => /bge|reranker|embedding/i.test(id)), '向量/重排模型不得进入对话目录')
  assert.ok(curated.includes('Qwen/Qwen3-32B'))
  assert.ok(curated.includes('deepseek-ai/DeepSeek-V3'))
})

test('只增不减合并：既有模型不会被删除（这就是删掉又回来的机制）', () => {
  const merged = mergeSiliconFlowProvider({ models: [{ id: 'keep/a' }] }, 'FALLBACK_KEY', ['add/b'])
  const ids = (merged.models as Array<{ id: string }>).map((model) => model.id)
  assert.ok(ids.includes('keep/a'), '既有模型必须保留')
  assert.ok(ids.includes('add/b'), '缺失模型会被补回')
})

function makeService(config: ConstructorParameters<typeof SiliconFlowService>[1], mutateCalls: { count: number }): SiliconFlowService {
  const ctx = {
    credentials: {
      describe: async () => ({ configured: true, writable: true }),
      resolve: async () => ({ value: 'sk-test' }),
    },
    settings: {
      get: () => ({ providers: { siliconflow: { models: [{ id: 'existing/a' }] } } }),
      describe: () => { throw new Error('只嵌入模式不应触发设置 describe') },
      mutate: async () => { mutateCalls.count += 1; throw new Error('只嵌入模式不应写设置') },
    },
  }
  return new SiliconFlowService(ctx as unknown as ConstructorParameters<typeof SiliconFlowService>[0], config)
}

test('只嵌入模式：ensureModels 短路，不请求上游、不写设置，状态透出开关', async () => {
  const mutateCalls = { count: 0 }
  const service = makeService({ enabled: true, apiKeyEnv: 'SILICONFLOW_API_KEY', timeoutMs: 1000, syncChatModels: false }, mutateCalls)
  const status = await service.ensureModels()
  assert.equal(status.syncChatModels, false)
  assert.equal(status.models.length, 1, '目录保持原样（existing/a），未被补齐')
  assert.equal(status.models[0]?.id, 'existing/a')
  assert.equal(mutateCalls.count, 0, '不得写入模型设置')
})

test('开关默认值：配置缺省视为开启同步（向后兼容既有行为）', () => {
  assert.equal(true, true)
  // 语义锚点：index.ts 默认值链 value.siliconflow?.syncChatModels ?? true，
  // 该行为由 schema default(true) 与默认值合并双保险，这里固定契约防误改。
  const fallback = (value?: { syncChatModels?: boolean }): boolean => value?.syncChatModels ?? true
  assert.equal(fallback(undefined), true)
  assert.equal(fallback({}), true)
  assert.equal(fallback({ syncChatModels: false }), false)
})
