/** OpenAI 中转站单测：地址校验、模型发现、provider 合并与图片生成。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { OpenAiGatewayClient, OpenAiGatewayError, extractGeneratedImage, normalizeOpenAiBaseURL, openAiApiRoot, parseOpenAiModelList } from '../src/openai/api-client.ts'
import { buildOpenAiProvider, mergeOpenAiModels, type OpenAiCapabilityConfig } from '../src/openai/service.ts'

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

test('模型合并：保留旧模型完整元数据，只追加新模型', () => {
  const existing = [{ id: 'gpt-5.6-sol', contextWindow: 1_050_000, reasoningEfforts: { max: 'max' } }]
  const merged = mergeOpenAiModels(existing, [{ id: 'gpt-5.6-sol' }, { id: 'gpt-image-2', name: 'GPT Image 2' }])
  assert.equal(merged.length, 2)
  assert.equal(merged[0]?.contextWindow, 1_050_000)
  assert.deepEqual(merged[0]?.reasoningEfforts, { max: 'max' })
  assert.equal(merged[1]?.reasoningEfforts, false)
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
    'llm-sub2api': {
      baseURL: 'https://legacy.example.com',
      tools: { generate: { provider: 'openai', model: 'gpt-image-2' } },
      providers: { openai: { apiKeyEnv: 'SUB2API_OPENAI_API_KEY' } },
    },
    'llm-pi-ai': {
      providers: {
        'sub2api-openai': { apiKeyEnv: 'SUB2API_OPENAI_API_KEY', models: [{ id: 'gpt-5.6-sol', contextWindow: 1_050_000 }] },
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
  const status = await service.ensureProvider()
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
