/**
 * 记忆模型路由解析测试（0.43.0「天工造梦一套」）。
 *
 * 覆盖来自真实踩坑的红线：
 * - 面板配的服务商在宿主目录里不存在（生产实况 minimax-cn）时，必须回退宿主默认，
 *   而不是把无效 provider 直传宿主换来一句离根因很远的 "no adapter registered"。
 * - 回退必须可见（fellBack + 中文原因），绝不静默。
 * - 宿主默认也不可用时返回空路由，由调用方以明确原因落 failed（绝不假装成功）。
 * - 自愈防误清：目录为空（宿主未就绪）时不得清用户配置——由 modelCatalogFromSection 的空表表达。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RagStore } from '../src/rag/rag-store.ts'
import { NativeMemoryStore } from '../src/memory/native.ts'
import { MemoryDreamService } from '../src/memory/dream.ts'
import { DEFAULT_MEMORY_SETTINGS } from '../src/memory/routes.ts'
import { MEMORY_ROUTE_NO_DEFAULT, modelCatalogFromSection, resolveMemoryModelRoute } from '../src/memory/model-route.ts'
import type { MemorySettings } from '../src/memory/protocol.ts'

const catalog = new Map<string, readonly string[]>([
  ['tiangong', ['GLM-Flash', 'DeepSeek V4.1 Flash']],
  ['zhipu', ['glm-5.3']],
])

/** 每个用例独立临时库，互不污染。 */
function makeStore(): { store: NativeMemoryStore; ragStore: RagStore } {
  const ragStore = new RagStore(join(mkdtempSync(join(tmpdir(), 'dsh-memory-route-')), 'rag.db'))
  return { store: new NativeMemoryStore(ragStore), ragStore }
}

function settings(overrides: Partial<MemorySettings>): MemorySettings {
  return { ...DEFAULT_MEMORY_SETTINGS, ...overrides }
}

test('路由解析：未指定服务商时跟随宿主默认（不算回退）', () => {
  const route = resolveMemoryModelRoute({
    requestedProvider: '', requestedModel: '', catalog,
    fallbackProvider: 'tiangong', fallbackModel: 'GLM-Flash',
  })
  assert.equal(route.provider, 'tiangong')
  assert.equal(route.model, 'GLM-Flash')
  assert.equal(route.fellBack, false)
  assert.equal(route.reason, '')
})

test('路由解析：服务商不在宿主目录 → 回退宿主默认并给出中文原因', () => {
  const route = resolveMemoryModelRoute({
    requestedProvider: 'minimax-cn', requestedModel: 'MiniMax-M2.7-highspeed', catalog,
    fallbackProvider: 'tiangong', fallbackModel: 'GLM-Flash',
  })
  assert.equal(route.provider, 'tiangong')
  assert.equal(route.model, 'GLM-Flash')
  assert.equal(route.fellBack, true)
  assert.match(route.reason, /minimax-cn/)
  assert.match(route.reason, /tiangong:GLM-Flash/)
  // 原始请求留痕，便于在审计里看清「面板上填了什么」。
  assert.equal(route.requestedProvider, 'minimax-cn')
  assert.equal(route.requestedModel, 'MiniMax-M2.7-highspeed')
})

test('路由解析：服务商可用但模型不在其列表 → 回退（不猜相近模型）', () => {
  const route = resolveMemoryModelRoute({
    requestedProvider: 'zhipu', requestedModel: '不存在的模型', catalog,
    fallbackProvider: 'tiangong', fallbackModel: 'GLM-Flash',
  })
  assert.equal(route.fellBack, true)
  assert.equal(route.provider, 'tiangong')
  assert.match(route.reason, /不存在的模型/)
})

test('路由解析：服务商可用且模型留空 → 取该服务商首个可用模型', () => {
  const route = resolveMemoryModelRoute({
    requestedProvider: 'tiangong', requestedModel: '', catalog,
    fallbackProvider: 'zhipu', fallbackModel: 'glm-5.3',
  })
  assert.equal(route.provider, 'tiangong')
  assert.equal(route.model, 'GLM-Flash')
  assert.equal(route.fellBack, false)
})

test('路由解析：服务商可用且模型命中 → 原样使用', () => {
  const route = resolveMemoryModelRoute({
    requestedProvider: 'tiangong', requestedModel: 'DeepSeek V4.1 Flash', catalog,
    fallbackProvider: 'tiangong', fallbackModel: 'GLM-Flash',
  })
  assert.equal(route.provider, 'tiangong')
  assert.equal(route.model, 'DeepSeek V4.1 Flash')
  assert.equal(route.fellBack, false)
})

test('路由解析：服务商存在但无模型 → 回退；宿主默认不可用 → 空路由并明说未就绪', () => {
  const empty = new Map<string, readonly string[]>([['空服务商', []]])
  const route = resolveMemoryModelRoute({
    requestedProvider: '空服务商', requestedModel: '', catalog: empty,
    fallbackProvider: '', fallbackModel: '',
  })
  assert.equal(route.provider, '')
  assert.equal(route.model, '')
  assert.equal(route.fellBack, true)
  assert.match(route.reason, new RegExp(MEMORY_ROUTE_NO_DEFAULT))
})

test('modelCatalogFromSection：解析 providers→models，脏结构返回空表（自愈防误清的依据）', () => {
  const parsed = modelCatalogFromSection({
    providers: {
      tiangong: { models: [{ id: 'GLM-Flash' }, { id: 'DeepSeek V4.1 Flash' }, { name: '缺 id' }] },
      broken: { models: 'not-an-array' },
    },
  })
  assert.deepEqual(parsed.get('tiangong'), ['GLM-Flash', 'DeepSeek V4.1 Flash'])
  assert.deepEqual(parsed.get('broken'), [])
  assert.equal(modelCatalogFromSection(undefined).size, 0)
  assert.equal(modelCatalogFromSection({ providers: null }).size, 0)
})

test('做梦集成：不可用服务商回退后仍正常整理，run.model 记实际路由、routeFallback 留原因', async () => {
  const { store, ragStore } = makeStore()
  for (let index = 0; index < 10; index += 1) {
    store.create({ content: '记忆条目 ' + index, category: 'general', source: 'test', importance: 3 })
  }
  const seen: Array<{ provider?: string; model?: string }> = []
  const dream = new MemoryDreamService({
    native: store,
    generate: async (input) => { seen.push({ provider: input.provider, model: input.model }); return '[]' },
    config: () => settings({ dreamEnabled: true, dreamProvider: 'minimax-cn', dreamModel: 'MiniMax-M2.7-highspeed' }),
    listDomain: (domain) => ragStore.listDomainDocs(domain),
    putDomain: (domain, id, data) => ragStore.putDomainDoc(domain, id, data),
    deleteDomain: (domain, id) => ragStore.deleteDomainDoc(domain, id),
    resolveRoute: (input) => resolveMemoryModelRoute({
      requestedProvider: input.provider,
      requestedModel: input.model,
      catalog,
      fallbackProvider: 'tiangong',
      fallbackModel: 'GLM-Flash',
    }),
  })
  const run = await dream.run(true)
  // 模型调用收到的是回退后的路由，而不是无效的 minimax-cn。
  assert.equal(seen[0]?.provider, 'tiangong')
  assert.equal(seen[0]?.model, 'GLM-Flash')
  assert.equal(run.model, 'tiangong:GLM-Flash')
  assert.match(run.routeFallback ?? '', /minimax-cn/)
  assert.equal(run.status, 'ok')
})

test('做梦集成：宿主默认模型未就绪 → 明确落 failed，不做无路由的模型调用', async () => {
  const { store, ragStore } = makeStore()
  for (let index = 0; index < 10; index += 1) {
    store.create({ content: '记忆条目 ' + index, category: 'general', source: 'test', importance: 3 })
  }
  let called = 0
  const dream = new MemoryDreamService({
    native: store,
    generate: async () => { called += 1; return '[]' },
    config: () => settings({ dreamEnabled: true }),
    listDomain: (domain) => ragStore.listDomainDocs(domain),
    putDomain: (domain, id, data) => ragStore.putDomainDoc(domain, id, data),
    deleteDomain: (domain, id) => ragStore.deleteDomainDoc(domain, id),
    resolveRoute: () => resolveMemoryModelRoute({
      requestedProvider: '', requestedModel: '', catalog,
      fallbackProvider: '', fallbackModel: '',
    }),
  })
  const run = await dream.run(true)
  assert.equal(run.status, 'failed')
  assert.equal(run.error, MEMORY_ROUTE_NO_DEFAULT)
  assert.equal(called, 0)
})
