/** OpenAI 中转站单测：地址校验、模型发现、provider 合并与图片生成。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { OpenAiGatewayClient, OpenAiGatewayError, extractGeneratedImage, normalizeOpenAiBaseURL, openAiApiRoot, parseOpenAiModelList } from '../src/openai/api-client.ts'
import { buildOpenAiEndpointProvider, buildOpenAiProvider, migrateOpenAiModelProfile, normalizeOpenAiEndpoints, OpenAiServiceError, openAiProviderId, syncOpenAiModels, type OpenAiCapabilityConfig } from '../src/openai/service.ts'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// store.db 兜底写入会打开真实默认路径，测试一律隔离到临时 HOME。
process.env.DSH_HOME = join(tmpdir(), 'dsh-devforge-test-' + String(process.pid))

/** 启动极简 OpenAI 兼容 mock；记录路径、鉴权和请求体。 */
function startMock(handler: (req: IncomingMessage, body: Record<string, unknown>) => { status?: number; payload: unknown }) {
  let last: { path: string; auth: string; body: Record<string, unknown> } | undefined
  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let raw = ''
    req.on('data', (chunk) => { raw += chunk })
    req.on('end', () => {
      const body = raw === '' ? {} : JSON.parse(raw) as Record<string, unknown>
      last = { path: req.url ?? '', auth: String(req.headers.authorization ?? ''), body }
      const result = handler(req, body)
      res.statusCode = result.status ?? 200
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify(result.payload))
    })
  })
  return {
    last: () => last,
    url: new Promise<string>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve('http://127.0.0.1:' + (server.address() as { port: number }).port))
    }),
    close: () => server.close(),
  }
}

const config: OpenAiCapabilityConfig = {
  enabled: true,
  baseURL: 'https://gateway.example.com',
  apiKeyEnv: 'OPENAI_GATEWAY_API_KEY',
  imageModel: 'gpt-image-2',
  timeoutMs: 300000,
}

test('中转站地址：支持裸主机和 /v1，拒绝凭据、查询参数与非 HTTP 协议', () => {
  assert.equal(normalizeOpenAiBaseURL(' https://gateway.example.com/ '), 'https://gateway.example.com')
  assert.equal(openAiApiRoot('https://gateway.example.com'), 'https://gateway.example.com/v1')
  assert.equal(openAiApiRoot('https://gateway.example.com/v1/'), 'https://gateway.example.com/v1')
  assert.throws(() => normalizeOpenAiBaseURL('ftp://gateway.example.com'), OpenAiGatewayError)
  assert.throws(() => normalizeOpenAiBaseURL('https://user:pass@gateway.example.com'), OpenAiGatewayError)
  assert.throws(() => normalizeOpenAiBaseURL('https://gateway.example.com?token=x'), OpenAiGatewayError)
})

test('模型目录：忽略空 id 与重复项', () => {
  const models = parseOpenAiModelList({ data: [{ id: 'gpt-5.6-sol' }, { id: 'gpt-5.6-sol' }, { id: 'gpt-image-2', name: 'GPT Image 2' }, { id: '' }, null] })
  assert.deepEqual(models, [{ id: 'gpt-5.6-sol' }, { id: 'gpt-image-2', name: 'GPT Image 2' }])
})

test('模型同步：保留旧模型完整元数据，移除中转站已下线模型', () => {
  const existing = [
    { id: 'gpt-5.6-sol', contextWindow: 1_050_000, reasoningEfforts: { max: 'max' } },
    { id: 'glm-5.3', contextWindow: 1_000_000 },
  ]
  const synced = syncOpenAiModels(existing, [{ id: 'gpt-5.6-sol' }, { id: 'gpt-image-2', name: 'GPT Image 2' }])
  assert.equal(synced.models.length, 2)
  assert.equal(synced.models[0]?.contextWindow, 1_050_000)
  assert.deepEqual(synced.models[0]?.reasoningEfforts, { max: 'max' })
  assert.equal(synced.models[1]?.reasoningEfforts, false)
  assert.deepEqual(synced.removedIds, ['glm-5.3'])
})

test('模型同步：忽略重复 id，遵循中转站返回顺序', () => {
  const synced = syncOpenAiModels([{ id: 'z-old' }], [{ id: 'a' }, { id: 'a' }, { id: 'b' }])
  assert.deepEqual(synced.models.map((model) => model.id), ['a', 'b'])
  assert.deepEqual(synced.removedIds, ['z-old'])
})

test('多端点配置：规范化地址、去重 id，首端点保持旧 provider id', () => {
  const endpoints = normalizeOpenAiEndpoints({ ...config, endpoints: [
    { id: 'Primary', name: '主站', baseURL: 'https://one.example.com/v1/', apiKeyEnv: 'ONE_KEY' },
    { id: 'second', name: '第二站', baseURL: 'https://two.example.com', apiKeyEnv: 'TWO_KEY' },
    { id: 'SECOND', name: '重复站', baseURL: 'https://three.example.com', apiKeyEnv: 'THREE_KEY' },
  ] })
  assert.deepEqual(endpoints.map((endpoint) => endpoint.baseURL), ['https://one.example.com/v1', 'https://two.example.com', 'https://three.example.com'])
  assert.deepEqual(endpoints.map((endpoint) => endpoint.id), ['Primary', 'second', 'SECOND-2'])
  assert.equal(openAiProviderId(endpoints[0]!, 0), 'openai-gateway')
  assert.equal(openAiProviderId(endpoints[1]!, 1), 'openai-gateway-second')
  assert.equal(openAiProviderId(endpoints[2]!, 2), 'openai-gateway-second-2')
})

test('多端点 ensureProvider：分别保留模型路由并清理删除端点与旧 Sub2API 路由', async () => {
  const sections: Record<string, Record<string, unknown>> = {
    'llm-pi-ai': {
      providers: {
        'openai-gateway': { models: [{ id: 'primary-model' }], userField: 'keep' },
        'openai-gateway-second': { models: [{ id: 'second-model' }] },
        'openai-gateway-stale': { models: [{ id: 'stale-model' }] },
        'sub2api-openai': { models: [{ id: 'legacy-model' }] },
      },
    },
  }
  const getAt = (root: Record<string, unknown>, path: string[]): { parent: Record<string, unknown>; key: string } => {
    let parent = root
    for (const part of path.slice(0, -1)) {
      const next = parent[part]
      if (next === null || typeof next !== 'object' || Array.isArray(next)) parent[part] = {}
      parent = parent[part] as Record<string, unknown>
    }
    return { parent, key: path[path.length - 1] ?? '' }
  }
  const ctx = {
    settings: {
      get: (ns: string) => sections[String(ns)],
      describe: () => Object.entries(sections).map(([ns, value]) => ({ ns, value, revision: 1 })),
      mutate: async (ns: string, operations: Array<{ op: 'set' | 'unset'; path: string[]; value?: unknown }>) => {
        const section = sections[String(ns)] ?? (sections[String(ns)] = {})
        for (const operation of operations) {
          const { parent, key } = getAt(section, operation.path)
          if (operation.op === 'set') parent[key] = operation.value
          else delete parent[key]
        }
      },
    },
    credentials: {
      describe: async () => ({ configured: true, writable: true }),
      resolve: async () => ({ value: 'test-key' }),
    },
    logger: { warn: () => {} },
  }
  const endpoints = [
    { id: 'primary', name: '主站', baseURL: 'https://one.example.com', apiKeyEnv: 'ONE_KEY', imageModel: 'image-one' },
    { id: 'second', name: '第二站', baseURL: 'https://two.example.com', apiKeyEnv: 'TWO_KEY', imageModel: 'image-two' },
  ]
  const liveConfig: OpenAiCapabilityConfig = { ...config, baseURL: 'https://one.example.com', apiKeyEnv: 'ONE_KEY', imageModel: 'image-one', endpoints }
  const service = new (await import('../src/openai/service.ts')).OpenAiGatewayService(ctx as never, liveConfig)
  const status = await service.ensureProvider()
  const providers = sections['llm-pi-ai']?.providers as Record<string, Record<string, unknown>>
  assert.equal(status.endpoints.length, 2)
  assert.equal(status.endpoints[1]?.providerId, 'openai-gateway-second')
  assert.equal((providers['openai-gateway']?.userField), 'keep')
  assert.equal(providers['openai-gateway-second']?.models?.[0]?.id, 'second-model')
  assert.equal(providers['openai-gateway-stale'], undefined)
  assert.equal(providers['sub2api-openai'], undefined)

  await service.saveConfig({ endpoints: [endpoints[0]!] })
  assert.equal(providers['openai-gateway-second'], undefined)
  assert.equal(providers['openai-gateway']?.models?.[0]?.id, 'primary-model')
})

test('openai 配置降级：宿主设置段缺失时读写 store.db 且不报错', async () => {
  const ctx = {
    settings: { describe: () => [], mutate: async () => {}, get: () => undefined },
    credentials: { describe: async () => ({ configured: true, writable: true }), resolve: async () => ({ value: 'k' }) },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  }
  const { OpenAiGatewayService } = await import('../src/openai/service.ts')
  const { getDb, getSettings } = await import('../src/store/db.ts')
  const service = new OpenAiGatewayService(ctx as never, { enabled: true, baseURL: '', apiKeyEnv: 'OPENAI_GATEWAY_API_KEY', imageModel: '', timeoutMs: 300000 })
  const status = await service.saveConfig({ baseURL: 'https://gw.example.com', imageModel: 'gpt-image-2' })
  assert.equal(status.baseURL, 'https://gw.example.com')
  const stored = getSettings(getDb(), 'openai.settings') as Record<string, unknown> | undefined
  assert.equal(stored?.baseURL, 'https://gw.example.com')
  assert.equal(stored?.imageModel, 'gpt-image-2')
})

test('provider：写入 Responses 路由、受管凭据和重试策略', () => {
  const provider = buildOpenAiProvider(config, [{ id: 'gpt-5.6-sol' }])
  assert.equal(provider.apiKeyEnv, 'OPENAI_GATEWAY_API_KEY')
  assert.equal(provider.api, 'openai-responses')
  assert.equal(provider.baseURL, 'https://gateway.example.com/v1')
  assert.equal((provider.retryPolicy as { maxRetries: number }).maxRetries, 5)
})

test('旧 Sub2API 配置：迁移地址、凭据引用、生图模型和聊天路由并清理旧路由', async () => {
  const sections: Record<string, Record<string, unknown>> = {
    'dsh-devforge': { openai: { ...config, baseURL: '', apiKeyEnv: 'OPENAI_GATEWAY_API_KEY', imageModel: '' } },
    // 独立插件卸载后 llm-sub2api 命名空间不会再注册，迁移必须只依赖遗留 Provider。
    'llm-pi-ai': {
      providers: {
        'sub2api-openai': { apiKeyEnv: 'SUB2API_OPENAI_API_KEY', baseURL: 'https://legacy.example.com/v1', models: [{ id: 'gpt-5.6-sol', contextWindow: 1_050_000 }, { id: 'gpt-image-2', reasoningEfforts: false }] },
        'sub2api-claude': { models: [{ id: 'claude-test' }] },
        'zai-coding-cn': { models: [{ id: 'glm-5.3' }] },
      },
    },
  }
  const getAt = (root: Record<string, unknown>, path: string[]): { parent: Record<string, unknown>; key: string } => {
    let parent = root
    for (const part of path.slice(0, -1)) {
      const next = parent[part]
      if (next === null || typeof next !== 'object' || Array.isArray(next)) parent[part] = {}
      parent = parent[part] as Record<string, unknown>
    }
    return { parent, key: path[path.length - 1] ?? '' }
  }
  const ctx = {
    settings: {
      get: (ns: string) => sections[String(ns)],
      describe: () => Object.entries(sections).map(([ns, value]) => ({ ns, value, revision: 1 })),
      mutate: async (ns: string, operations: Array<{ op: 'set' | 'unset'; path: string[]; value?: unknown }>) => {
        const section = sections[String(ns)] ?? (sections[String(ns)] = {})
        for (const operation of operations) {
          const { parent, key } = getAt(section, operation.path)
          if (operation.op === 'set') parent[key] = operation.value
          else delete parent[key]
        }
      },
    },
    credentials: {
      describe: async () => ({ configured: true, writable: true }),
      resolve: async () => ({ value: 'not-read-during-migration' }),
    },
  }
  const liveConfig: OpenAiCapabilityConfig = { ...config, baseURL: '', apiKeyEnv: 'OPENAI_GATEWAY_API_KEY', imageModel: '' }
  const service = new (await import('../src/openai/service.ts')).OpenAiGatewayService(ctx as never, liveConfig)
  const status = await service.status()
  assert.equal(liveConfig.baseURL, 'https://legacy.example.com')
  assert.equal(liveConfig.apiKeyEnv, 'SUB2API_OPENAI_API_KEY')
  assert.equal(liveConfig.imageModel, 'gpt-image-2')
  assert.equal(status.providerConfigured, true)
  const providers = sections['llm-pi-ai']?.providers as Record<string, Record<string, unknown>>
  assert.equal((providers['openai-gateway']?.models as Array<Record<string, unknown>>)[0]?.contextWindow, 1_050_000)
  assert.equal(providers['sub2api-openai'], undefined)
  assert.equal(providers['sub2api-claude'], undefined)
  assert.ok(providers['zai-coding-cn'])
})

test('HTTP 客户端：GET /v1/models 携带 Bearer 并规整模型', async () => {
  const mock = startMock(() => ({ payload: { data: [{ id: 'gpt-5.6-sol' }, { id: 'gpt-image-2' }] } }))
  try {
    const client = new OpenAiGatewayClient(await mock.url, async () => 'test-key', 5000)
    const models = await client.fetchModels()
    assert.equal(mock.last()?.path, '/v1/models')
    assert.equal(mock.last()?.auth, 'Bearer test-key')
    assert.deepEqual(models.map((model) => model.id), ['gpt-5.6-sol', 'gpt-image-2'])
  } finally { mock.close() }
})

test('HTTP 客户端：images/generations 解析 base64 图片和请求参数', async () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
  const mock = startMock(() => ({ payload: { data: [{ b64_json: png.toString('base64'), revised_prompt: '优化后的提示词' }] } }))
  try {
    const client = new OpenAiGatewayClient(await mock.url, async () => 'test-key', 5000)
    const image = await client.generateImage({ prompt: '一张测试图', model: 'gpt-image-2', size: '1024x1536', quality: 'high' })
    assert.equal(mock.last()?.path, '/v1/images/generations')
    assert.equal(mock.last()?.body.model, 'gpt-image-2')
    assert.equal(mock.last()?.body.size, '1024x1536')
    assert.equal(mock.last()?.body.quality, 'high')
    assert.equal(image.mediaType, 'image/png')
    assert.equal(image.data.byteLength, png.byteLength)
    assert.equal(image.revisedPrompt, '优化后的提示词')
  } finally { mock.close() }
})

test('HTTP 客户端：401 不泄露 Key 并映射为凭据错误', async () => {
  const mock = startMock(() => ({ status: 401, payload: { error: { message: 'Bearer test-secret invalid' } } }))
  try {
    const client = new OpenAiGatewayClient(await mock.url, async () => 'test-secret', 5000)
    await assert.rejects(client.fetchModels(), (error: unknown) => error instanceof OpenAiGatewayError && error.status === 401 && !error.message.includes('test-secret'))
  } finally { mock.close() }
})

test('图片响应解析：支持 URL 并保留 revised_prompt', () => {
  const image = extractGeneratedImage({ data: [{ url: 'https://cdn.example.com/a.png', revised_prompt: 'rp' }] })
  assert.equal(image?.url, 'https://cdn.example.com/a.png')
  assert.equal(image?.revisedPrompt, 'rp')
})

test('模型默认档案：新模型 1M 上下文与五档推理，旧档案迁移不覆盖自定义元数据', () => {
  const fresh = syncOpenAiModels([], [{ id: 'glm-5.3' }]).models[0] as Record<string, unknown>
  assert.equal(fresh.contextWindow, 1_000_000)
  assert.deepEqual(fresh.reasoningEfforts, { low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' })
  const migrated = syncOpenAiModels([{ id: 'm1', reasoningEfforts: { low: 'low', medium: 'medium', high: 'high' } }], [{ id: 'm1' }]).models[0] as Record<string, unknown>
  assert.equal(migrated.contextWindow, 1_000_000)
  assert.deepEqual(migrated.reasoningEfforts, { low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' })
  const custom = syncOpenAiModels([{ id: 'm2', contextWindow: 200_000, reasoningEfforts: { max: 'max' } }], [{ id: 'm2' }]).models[0] as Record<string, unknown>
  assert.equal(custom.contextWindow, 200_000)
  assert.deepEqual(custom.reasoningEfforts, { max: 'max' })
  const provider = buildOpenAiProvider(config, [])
  assert.equal(provider.defaultContextWindow, 1_000_000)
  assert.equal(provider.defaultMaxTokens, 128_000)
})

test('单端点获取：按原始下标写入正确 provider 且不清理其它端点路由', async () => {
  const mockPrimary = startMock(() => ({ payload: { data: [{ id: 'primary-model' }] } }))
  const mockSecond = startMock(() => ({ payload: { data: [{ id: 'second-model' }] } }))
  const sections: Record<string, Record<string, unknown>> = {
    'llm-pi-ai': { providers: { 'openai-gateway': { models: [{ id: 'primary-model' }] } } },
  }
  const getAt = (root: Record<string, unknown>, path: string[]): { parent: Record<string, unknown>; key: string } => {
    let parent = root
    for (const part of path.slice(0, -1)) {
      const next = parent[part]
      if (next === null || typeof next !== 'object' || Array.isArray(next)) parent[part] = {}
      parent = parent[part] as Record<string, unknown>
    }
    return { parent, key: path[path.length - 1] ?? '' }
  }
  const ctx = {
    settings: {
      get: (ns: string) => sections[String(ns)],
      describe: () => Object.entries(sections).map(([ns, value]) => ({ ns, value, revision: 1 })),
      mutate: async (ns: string, operations: Array<{ op: 'set' | 'unset'; path: string[]; value?: unknown }>) => {
        const section = sections[String(ns)] ?? (sections[String(ns)] = {})
        for (const operation of operations) {
          const { parent, key } = getAt(section, operation.path)
          if (operation.op === 'set') parent[key] = operation.value
          else delete parent[key]
        }
      },
    },
    credentials: { describe: async () => ({ configured: true, writable: true }), resolve: async () => ({ value: 'test-key' }) },
    logger: { warn: () => {} },
  }
  const endpoints = [
    { id: 'primary', name: '主端点', baseURL: await mockPrimary.url, apiKeyEnv: 'ONE_KEY' },
    { id: 'second', name: '第二站', baseURL: await mockSecond.url, apiKeyEnv: 'TWO_KEY' },
  ]
  const liveConfig: OpenAiCapabilityConfig = { ...config, baseURL: endpoints[0]!.baseURL, apiKeyEnv: 'ONE_KEY', imageModel: '', endpoints }
  try {
    const service = new (await import('../src/openai/service.ts')).OpenAiGatewayService(ctx as never, liveConfig)
    const result = await service.fetchModels(undefined, 'second')
    assert.equal(result.results.length, 1)
    assert.equal(result.results[0]?.ok, true)
    const providers = sections['llm-pi-ai']?.providers as Record<string, Record<string, unknown>>
    assert.equal((providers['openai-gateway-second']?.models as Array<Record<string, unknown>>)[0]?.id, 'second-model')
    assert.equal((providers['openai-gateway']?.models as Array<Record<string, unknown>>)[0]?.id, 'primary-model')
  } finally { mockPrimary.close(); mockSecond.close() }
})

test('批量获取部分失败：失败端点保留既有 provider 路由不被清理', async () => {
  const mock = startMock(() => ({ payload: { data: [{ id: 'second-model' }] } }))
  const sections: Record<string, Record<string, unknown>> = {
    'llm-pi-ai': { providers: { 'openai-gateway': { models: [{ id: 'keep-me' }] } } },
  }
  const getAt = (root: Record<string, unknown>, path: string[]): { parent: Record<string, unknown>; key: string } => {
    let parent = root
    for (const part of path.slice(0, -1)) {
      const next = parent[part]
      if (next === null || typeof next !== 'object' || Array.isArray(next)) parent[part] = {}
      parent = parent[part] as Record<string, unknown>
    }
    return { parent, key: path[path.length - 1] ?? '' }
  }
  const ctx = {
    settings: {
      get: (ns: string) => sections[String(ns)],
      describe: () => Object.entries(sections).map(([ns, value]) => ({ ns, value, revision: 1 })),
      mutate: async (ns: string, operations: Array<{ op: 'set' | 'unset'; path: string[]; value?: unknown }>) => {
        const section = sections[String(ns)] ?? (sections[String(ns)] = {})
        for (const operation of operations) {
          const { parent, key } = getAt(section, operation.path)
          if (operation.op === 'set') parent[key] = operation.value
          else delete parent[key]
        }
      },
    },
    credentials: { describe: async () => ({ configured: true, writable: true }), resolve: async () => ({ value: 'test-key' }) },
    logger: { warn: () => {} },
  }
  const endpoints = [
    { id: 'primary', name: '主端点', baseURL: 'http://127.0.0.1:9', apiKeyEnv: 'ONE_KEY' },
    { id: 'second', name: '第二站', baseURL: await mock.url, apiKeyEnv: 'TWO_KEY' },
  ]
  const liveConfig: OpenAiCapabilityConfig = { ...config, baseURL: endpoints[0]!.baseURL, apiKeyEnv: 'ONE_KEY', imageModel: '', endpoints }
  try {
    const service = new (await import('../src/openai/service.ts')).OpenAiGatewayService(ctx as never, liveConfig)
    const result = await service.fetchModels()
    assert.equal(result.succeeded, 1)
    assert.equal(result.failed, 1)
    assert.equal(result.results[0]?.ok, false)
    assert.equal(result.results[0]?.retained, true)
    assert.equal(result.results[1]?.ok, true)
    const providers = sections['llm-pi-ai']?.providers as Record<string, Record<string, unknown>>
    assert.equal((providers['openai-gateway']?.models as Array<Record<string, unknown>>)[0]?.id, 'keep-me')
    assert.equal((providers['openai-gateway-second']?.models as Array<Record<string, unknown>>)[0]?.id, 'second-model')
  } finally { mock.close() }
})

test('模型目录解析：兼容 Anthropic 风格 display_name 字段', () => {
  const models = parseOpenAiModelList({ data: [{ id: 'claude-opus-5', type: 'model', display_name: 'Claude Opus 5' }, { id: 'claude-sonnet-5', display_name: ' ' }, { id: 'claude-haiku-4-5-20251001' }] })
  assert.deepEqual(models, [{ id: 'claude-opus-5', name: 'Claude Opus 5' }, { id: 'claude-sonnet-5' }, { id: 'claude-haiku-4-5-20251001' }])
})

test('端点协议字段：合法值保留、缺省不写、非法值拒绝', () => {
  const endpoints = normalizeOpenAiEndpoints({ ...config, endpoints: [
    { id: 'main', name: '主站', baseURL: 'https://one.example.com', apiKeyEnv: 'ONE_KEY' },
    { id: 'claude', name: 'Claude 端点', baseURL: 'https://two.example.com/v1', apiKeyEnv: 'TWO_KEY', api: 'anthropic-messages' },
    { id: 'explicit', name: '显式默认', baseURL: 'https://three.example.com', apiKeyEnv: 'THREE_KEY', api: 'openai-responses' },
    { id: 'zhipu', name: '智谱 Coding Plan', baseURL: 'https://relay.example.com/api/coding/paas/v4', apiKeyEnv: 'ZHIPU_KEY', api: 'openai-completions' },
  ] })
  assert.equal(endpoints[0]?.api, undefined)
  assert.equal(endpoints[1]?.api, 'anthropic-messages')
  assert.equal(endpoints[2]?.api, 'openai-responses')
  assert.equal(endpoints[3]?.api, 'openai-completions')
  assert.throws(() => normalizeOpenAiEndpoints({ ...config, endpoints: [{ id: 'bad', name: '坏协议', baseURL: 'https://four.example.com', apiKeyEnv: 'FOUR_KEY', api: 'chat-completions' as never }] }), OpenAiServiceError)
})

test('OpenAI Chat Completions 端点 provider：保留智谱 Coding Plan 的 API 根路径', () => {
  const provider = buildOpenAiEndpointProvider({ id: 'zhipu', name: '智谱 Coding Plan', baseURL: 'https://gw.example.com/api/coding/paas/v4', apiKeyEnv: 'ZHIPU_KEY', api: 'openai-completions' }, [{ id: 'glm-5.3-flash' }])
  assert.equal(provider.api, 'openai-completions')
  assert.equal(provider.baseURL, 'https://gw.example.com/api/coding/paas/v4')
})

test('Anthropic 端点 provider：anthropic-messages 协议、裸主机 baseURL、200K 窗口与 32K 输出', () => {
  const provider = buildOpenAiEndpointProvider({ id: 'claude', name: 'Claude 端点', baseURL: 'https://gw.example.com/v1', apiKeyEnv: 'CLAUDE_KEY', api: 'anthropic-messages' }, [{ id: 'claude-opus-5' }])
  assert.equal(provider.api, 'anthropic-messages')
  assert.equal(provider.baseURL, 'https://gw.example.com')
  assert.equal(provider.apiKeyEnv, 'CLAUDE_KEY')
  assert.equal(provider.defaultContextWindow, 200_000)
  assert.equal(provider.defaultMaxTokens, 32_000)
  const responses = buildOpenAiEndpointProvider({ id: 'main', name: '主站', baseURL: 'https://gw.example.com', apiKeyEnv: 'MAIN_KEY' }, [])
  assert.equal(responses.api, 'openai-responses')
  assert.equal(responses.baseURL, 'https://gw.example.com/v1')
  assert.equal(responses.defaultContextWindow, 1_000_000)
  assert.equal(responses.defaultMaxTokens, 128_000)
})

test('Anthropic 端点模型同步：按官方规格分型号定容量，adaptive 型号补 forceAdaptiveThinking，旧档位形态升级五档', () => {
  const fresh = syncOpenAiModels([], [{ id: 'claude-opus-5', name: 'Claude Opus 5' }], 'anthropic-messages').models[0] as Record<string, unknown>
  assert.equal(fresh.contextWindow, 1_000_000)
  assert.equal(fresh.maxTokens, 128_000)
  assert.equal((fresh.compat as Record<string, unknown> | undefined)?.forceAdaptiveThinking, true)
  assert.deepEqual(fresh.reasoningEfforts, { low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' })
  assert.deepEqual(fresh.input, ['text', 'image'])
  const sonnet = syncOpenAiModels([], [{ id: 'claude-sonnet-4-5-20250929' }], 'anthropic-messages').models[0] as Record<string, unknown>
  assert.equal(sonnet.contextWindow, 1_000_000)
  assert.equal(sonnet.maxTokens, 64_000)
  assert.equal(sonnet.compat, undefined)
  const opus45 = syncOpenAiModels([], [{ id: 'claude-opus-4-5-20251101' }], 'anthropic-messages').models[0] as Record<string, unknown>
  assert.equal(opus45.contextWindow, 200_000)
  assert.equal(opus45.maxTokens, 64_000)
  assert.equal(opus45.compat, undefined)
  const migrated = syncOpenAiModels([{ id: 'm1', reasoningEfforts: { low: 'low', medium: 'medium', high: 'high' } }], [{ id: 'm1' }], 'anthropic-messages').models[0] as Record<string, unknown>
  assert.equal(migrated.contextWindow, 200_000)
  assert.deepEqual(migrated.reasoningEfforts, { low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' })
  const legacyOff = syncOpenAiModels([{ id: 'm3', contextWindow: 200_000, reasoningEfforts: false }], [{ id: 'm3' }], 'anthropic-messages').models[0] as Record<string, unknown>
  assert.equal(legacyOff.maxTokens, 32_000)
  assert.deepEqual(legacyOff.reasoningEfforts, { low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' })
  const custom = syncOpenAiModels([{ id: 'm2', contextWindow: 500_000, reasoningEfforts: { max: 'max' } }], [{ id: 'm2' }], 'anthropic-messages').models[0] as Record<string, unknown>
  assert.equal(custom.contextWindow, 500_000)
  assert.deepEqual(custom.reasoningEfforts, { max: 'max' })
})

test('模型档案迁移：Anthropic 旧默认容量按官方规格升级并补 adaptive 开关，OpenAI 端点不动不暴露档位的模型', () => {
  const anthropic = migrateOpenAiModelProfile({ id: 'claude-opus-5', contextWindow: 200_000, reasoningEfforts: false }, 'anthropic-messages')
  assert.equal(anthropic.contextWindow, 1_000_000)
  assert.equal(anthropic.maxTokens, 128_000)
  assert.equal((anthropic.compat as Record<string, unknown> | undefined)?.forceAdaptiveThinking, true)
  assert.deepEqual(anthropic.reasoningEfforts, { low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' })
  const anthropicFresh = migrateOpenAiModelProfile({ id: 'claude-sonnet-5' }, 'anthropic-messages')
  assert.equal(anthropicFresh.contextWindow, 1_000_000)
  assert.equal(anthropicFresh.maxTokens, 128_000)
  const customWindow = migrateOpenAiModelProfile({ id: 'claude-fable-5-1', contextWindow: 300_000, maxTokens: 10_000 }, 'anthropic-messages')
  assert.equal(customWindow.contextWindow, 300_000)
  assert.equal(customWindow.maxTokens, 10_000)
  assert.equal((customWindow.compat as Record<string, unknown> | undefined)?.forceAdaptiveThinking, true)
  const userCompat = migrateOpenAiModelProfile({ id: 'claude-opus-5', compat: { forceAdaptiveThinking: false } }, 'anthropic-messages')
  assert.equal((userCompat.compat as Record<string, unknown> | undefined)?.forceAdaptiveThinking, false)
  const responses = migrateOpenAiModelProfile({ id: 'm4', reasoningEfforts: false }, 'openai-responses')
  assert.equal(responses.contextWindow, 1_000_000)
  assert.equal(responses.maxTokens, undefined)
  assert.equal(responses.reasoningEfforts, false)
})

/** 构造带 settings 内存实现的最小 ctx；sections 由用例直接断言。 */
function makeSettingsCtx(sections: Record<string, Record<string, unknown>>) {
  const getAt = (root: Record<string, unknown>, path: string[]): { parent: Record<string, unknown>; key: string } => {
    let parent = root
    for (const part of path.slice(0, -1)) {
      const next = parent[part]
      if (next === null || typeof next !== 'object' || Array.isArray(next)) parent[part] = {}
      parent = parent[part] as Record<string, unknown>
    }
    return { parent, key: path[path.length - 1] ?? '' }
  }
  return {
    settings: {
      get: (ns: string) => sections[String(ns)],
      describe: () => Object.entries(sections).map(([ns, value]) => ({ ns, value, revision: 1 })),
      mutate: async (ns: string, operations: Array<{ op: 'set' | 'unset'; path: string[]; value?: unknown }>) => {
        const section = sections[String(ns)] ?? (sections[String(ns)] = {})
        for (const operation of operations) {
          const { parent, key } = getAt(section, operation.path)
          if (operation.op === 'set') parent[key] = operation.value
          else delete parent[key]
        }
      },
    },
    credentials: { describe: async () => ({ configured: true, writable: true }), resolve: async () => ({ value: 'test-key' }) },
    logger: { warn: () => {} },
  }
}

test('模型容量修改：按模型写上下文与输出上限，状态回传容量且迁移不重置显式覆盖值', async () => {
  const sections: Record<string, Record<string, unknown>> = {
    'llm-pi-ai': {
      providers: {
        'openai-gateway': { models: [{ id: 'gpt-5.6-sol', contextWindow: 1_000_000 }] },
        'openai-gateway-claude': { models: [{ id: 'gpt-5.5', contextWindow: 200_000, maxTokens: 32_000 }, { id: 'claude-sonnet-4-5', contextWindow: 1_000_000, maxTokens: 64_000 }] },
      },
    },
  }
  const { OpenAiGatewayService } = await import('../src/openai/service.ts')
  const endpoints = [
    { id: 'main', name: '主站', baseURL: 'https://one.example.com', apiKeyEnv: 'ONE_KEY' },
    { id: 'claude', name: 'Claude 端点', baseURL: 'https://two.example.com', apiKeyEnv: 'TWO_KEY', api: 'anthropic-messages' as const },
  ]
  const liveConfig: OpenAiCapabilityConfig = { ...config, baseURL: endpoints[0]!.baseURL, apiKeyEnv: 'ONE_KEY', imageModel: '', endpoints }
  const service = new OpenAiGatewayService(makeSettingsCtx(sections) as never, liveConfig)
  const readModels = (providerId: string): Array<Record<string, unknown>> => ((sections['llm-pi-ai']?.providers as Record<string, Record<string, unknown>>)[providerId]?.models ?? []) as Array<Record<string, unknown>>

  const status = await service.saveModelProfile({ endpointId: 'claude', modelId: 'gpt-5.5', contextWindow: 400_000, maxTokens: 64_000 })
  assert.equal(readModels('openai-gateway-claude')[0]?.contextWindow, 400_000)
  assert.equal(readModels('openai-gateway-claude')[0]?.maxTokens, 64_000)
  assert.equal(readModels('openai-gateway-claude')[1]?.contextWindow, 1_000_000)
  assert.equal(readModels('openai-gateway')[0]?.contextWindow, 1_000_000)
  const presented = status.endpoints.find((endpoint) => endpoint.id === 'claude')?.models.find((model) => model.id === 'gpt-5.5')
  assert.equal(presented?.contextWindow, 400_000)
  assert.equal(presented?.maxTokens, 64_000)

  // 再次拉取模型与启动迁移都不得重置显式覆盖值。
  const resynced = syncOpenAiModels(readModels('openai-gateway-claude'), [{ id: 'gpt-5.5' }, { id: 'claude-sonnet-4-5' }], 'anthropic-messages')
  assert.equal((resynced.models[0] as Record<string, unknown>).contextWindow, 400_000)
  assert.equal((resynced.models[0] as Record<string, unknown>).maxTokens, 64_000)
  await service.ensureProvider()
  assert.equal(readModels('openai-gateway-claude')[0]?.contextWindow, 400_000)
  assert.equal(readModels('openai-gateway-claude')[0]?.maxTokens, 64_000)

  // 输出上限省略时保持不变。
  await service.saveModelProfile({ endpointId: 'claude', modelId: 'gpt-5.5', contextWindow: 500_000 })
  assert.equal(readModels('openai-gateway-claude')[0]?.contextWindow, 500_000)
  assert.equal(readModels('openai-gateway-claude')[0]?.maxTokens, 64_000)
})

test('模型容量修改：非法值与未知目标拒绝且不落库', async () => {
  const sections: Record<string, Record<string, unknown>> = {
    'llm-pi-ai': {
      providers: {
        'openai-gateway': { models: [{ id: 'gpt-5.6-sol', contextWindow: 1_000_000 }] },
        'openai-gateway-claude': { models: [{ id: 'gpt-5.5', contextWindow: 200_000, maxTokens: 32_000 }] },
      },
    },
  }
  const { OpenAiGatewayService } = await import('../src/openai/service.ts')
  const endpoints = [
    { id: 'main', name: '主站', baseURL: 'https://one.example.com', apiKeyEnv: 'ONE_KEY' },
    { id: 'claude', name: 'Claude 端点', baseURL: 'https://two.example.com', apiKeyEnv: 'TWO_KEY', api: 'anthropic-messages' as const },
  ]
  const liveConfig: OpenAiCapabilityConfig = { ...config, baseURL: endpoints[0]!.baseURL, apiKeyEnv: 'ONE_KEY', imageModel: '', endpoints }
  const service = new OpenAiGatewayService(makeSettingsCtx(sections) as never, liveConfig)
  const rejected = async (patch: Parameters<OpenAiGatewayService['saveModelProfile']>[0], status: number): Promise<void> => {
    await assert.rejects(service.saveModelProfile(patch), (error: unknown) => error instanceof OpenAiServiceError && error.status === status)
  }
  await rejected({ endpointId: 'claude', modelId: 'gpt-5.5', contextWindow: 0 }, 400)
  await rejected({ endpointId: 'claude', modelId: 'gpt-5.5', contextWindow: 1.5 }, 400)
  await rejected({ endpointId: 'claude', modelId: 'gpt-5.5', contextWindow: 5_000_000 }, 400)
  await rejected({ endpointId: 'claude', modelId: 'gpt-5.5', contextWindow: 400_000, maxTokens: 500_000 }, 400)
  await rejected({ endpointId: 'claude', modelId: 'gpt-5.5', contextWindow: 400_000, maxTokens: 100 }, 400)
  await rejected({ endpointId: 'main', modelId: 'gpt-5.6-sol', contextWindow: 400_000, maxTokens: 64_000 }, 400)
  await rejected({ endpointId: 'missing', modelId: 'gpt-5.5', contextWindow: 400_000 }, 404)
  await rejected({ endpointId: 'claude', modelId: 'no-such-model', contextWindow: 400_000 }, 404)
  const readModels = (providerId: string): Array<Record<string, unknown>> => ((sections['llm-pi-ai']?.providers as Record<string, Record<string, unknown>>)[providerId]?.models ?? []) as Array<Record<string, unknown>>
  assert.equal(readModels('openai-gateway-claude')[0]?.contextWindow, 200_000)
  assert.equal(readModels('openai-gateway-claude')[0]?.maxTokens, 32_000)
})
