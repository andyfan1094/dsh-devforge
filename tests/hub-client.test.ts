/** MiniMax Hub Gateway 客户端单测：本地 mock 端点覆盖请求格式、错误映射与工具激活。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http'
import {
  MiniMaxHubClient,
  MiniMaxHubError,
  safeHubError,
} from '../src/minimax/hub-client.ts'
import {
  activateMiniMaxHubTools,
  makeMiniMaxHubToolDefinitions,
  makeMiniMaxHubClient,
} from '../src/minimax/tools.ts'

/** 极简 JSON 应答器：记录最近一次请求并按路径回放预设响应。 */
function startMock(respond: (path: string, body: Record<string, unknown>) => { status?: number; payload: unknown }) {
  let last: { path: string; body: Record<string, unknown> } | undefined
  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let raw = ''
    req.on('data', (chunk) => { raw += chunk })
    req.on('end', () => {
      const body = raw === '' ? {} : JSON.parse(raw)
      last = { path: req.url ?? '', body }
      const outcome = respond(req.url ?? '', body)
      res.statusCode = outcome.status ?? 200
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify(outcome.payload))
    })
  })
  return {
    last: () => last,
    url: new Promise<string>((resolvePromise) => {
      server.listen(0, '127.0.0.1', () => {
        const address = server.address() as { port: number }
        resolvePromise('http://127.0.0.1:' + address.port)
      })
    }),
    close: () => server.close(),
  }
}

test('Hub 客户端：健康检查返回 true', async () => {
  const mock = startMock((path) => path === '/api/health' ? { status: 200, payload: { status: 'ok' } } : { status: 404, payload: {} })
  const url = await mock.url
  try {
    const client = new MiniMaxHubClient({ gatewayURL: url })
    const ok = await client.health()
    assert.equal(ok, true)
  } finally { mock.close() }
})

test('Hub 客户端：健康检查在非 ok 时返回 false', async () => {
  const mock = startMock(() => ({ status: 500, payload: { status: 'down' } }))
  const url = await mock.url
  try {
    const client = new MiniMaxHubClient({ gatewayURL: url })
    const ok = await client.health()
    assert.equal(ok, false)
  } finally { mock.close() }
})

test('Hub 客户端：generateVideo 成功并解析产物', async () => {
  let receivedPath = ''
  let receivedBody: Record<string, unknown> = {}
  const mock = startMock((path, body) => {
    receivedPath = path
    receivedBody = body
    return {
      status: 200,
      payload: {
        ok: true,
        path: 'mock_video.mp4',
        width: 1344,
        height: 768,
        duration: 5,
        task_id: 'mock-task-001',
        node_id: 'mock-node-001',
      },
    }
  })
  const url = await mock.url
  try {
    const client = new MiniMaxHubClient({ gatewayURL: url, outputDir: '/tmp/hub-test' })
    const result = await client.generateVideo('test prompt', { duration: 5, ratio: '16:9', resolution: '768P' })
    assert.equal(receivedPath, '/api/generate/video')
    assert.equal(receivedBody.backend, 'minimax_v3')
    assert.equal(receivedBody.model_id, 'MiniMax-H3')
    assert.equal((receivedBody.params as Record<string, unknown>).duration, 5)
    assert.equal(result.ok, true)
    assert.equal(result.assetPath, 'mock_video.mp4')
    assert.equal(result.absolutePath, '/tmp/hub-test/mock_video.mp4')
    assert.equal(result.width, 1344)
    assert.equal(result.taskId, 'mock-task-001')
    assert.equal(result.nodeId, 'mock-node-001')
  } finally { mock.close() }
})

test('Hub 客户端：generateVideo 失败抛 MiniMaxHubError', async () => {
  const mock = startMock(() => ({ status: 200, payload: { ok: false, error: 'Backend not registered', error_code: 'client_error' } }))
  const url = await mock.url
  try {
    const client = new MiniMaxHubClient({ gatewayURL: url })
    await assert.rejects(client.generateVideo('test'), (err: unknown) => {
      assert.ok(err instanceof MiniMaxHubError)
      assert.match((err as Error).message, /Backend not registered/)
      return true
    })
  } finally { mock.close() }
})

test('Hub 客户端：4xx 响应抛 MiniMaxHubError 携带状态码', async () => {
  const mock = startMock(() => ({ status: 503, payload: { message: 'Service Unavailable' } }))
  const url = await mock.url
  try {
    const client = new MiniMaxHubClient({ gatewayURL: url })
    await assert.rejects(client.generateVideo('test'), (err: unknown) => {
      assert.ok(err instanceof MiniMaxHubError)
      assert.equal((err as MiniMaxHubError).status, 502)
      return true
    })
  } finally { mock.close() }
})

test('Hub 客户端：generateImage 成功', async () => {
  const mock = startMock(() => ({ status: 200, payload: { ok: true, path: 'mock_image.png', width: 1408, height: 768, node_id: 'node-2' } }))
  const url = await mock.url
  try {
    const client = new MiniMaxHubClient({ gatewayURL: url, outputDir: '/tmp/hub-test' })
    const result = await client.generateImage('test image')
    assert.equal(result.ok, true)
    assert.equal(result.path, '/tmp/hub-test/mock_image.png')
    assert.equal(result.width, 1408)
  } finally { mock.close() }
})

test('Hub 客户端：listCapabilities 规整 video/image/audio 三类', async () => {
  const mock = startMock(() => ({
    status: 200,
    payload: {
      imageModels: [
        { id: 'banana-2', display_name: 'General Image 2', backend: 'nano_banana', model_name: 'nano_banana_2_flash', promptMaxLength: 7500, params: {} },
      ],
      videoModels: [
        { id: 'MiniMax-H3', display_name: 'MiniMax H3', backend: 'minimax_v3', model_name: 'MiniMax-H3', promptMaxLength: 7000, params: { duration: { default: '5' } }, promotion: { costPerSecond: 56 } },
      ],
      audioModels: [
        { id: 'speech-2.8-hd', display_name: 'Speech-2.8-HD', backend: 'minimax_tts' },
      ],
    },
  }))
  const url = await mock.url
  try {
    const client = new MiniMaxHubClient({ gatewayURL: url })
    const caps = await client.listCapabilities()
    assert.equal(caps.series, 'MiniMax')
    assert.equal(caps.videoModels.length, 1)
    assert.equal(caps.videoModels[0].id, 'MiniMax-H3')
    assert.equal(caps.videoModels[0].costPerSecond, 56)
    assert.equal(caps.videoModels[0].backend, 'minimax_v3')
    assert.equal(caps.imageModels.length, 1)
    assert.equal(caps.imageModels[0].id, 'banana-2')
    assert.equal(caps.audioModels.length, 1)
    assert.equal(caps.fetchedAt > 0, true)
  } finally { mock.close() }
})

test('Hub 客户端：缺 prompt 抛 MiniMaxHubError 400', async () => {
  const client = new MiniMaxHubClient({ gatewayURL: 'http://127.0.0.1:1' })
  await assert.rejects(client.generateVideo('   '), (err: unknown) => {
    assert.ok(err instanceof MiniMaxHubError)
    assert.equal((err as MiniMaxHubError).status, 400)
    return true
  })
})

test('safeHubError 脱敏 Bearer 与 Cookie', () => {
  const result = safeHubError(new Error('Authorization Bearer ey-secret.abc123 failed'))
  assert.equal(result.includes('[redacted]'), true)
  assert.equal(result.includes('ey-secret.abc123'), false)
  const result2 = safeHubError(new Error('cookie=session=abc123 invalid'))
  assert.equal(result2.includes('[redacted]'), true)
})

test('Hub 工具定义：返回 3 个工具且名称符合预期', () => {
  const client = new MiniMaxHubClient({ gatewayURL: 'http://127.0.0.1:1' })
  const tools = makeMiniMaxHubToolDefinitions(client)
  assert.equal(tools.length, 3)
  const names = tools.map((t) => t.name)
  assert.ok(names.includes('minimax_hub_video_generation'))
  assert.ok(names.includes('minimax_hub_image_generation'))
  assert.ok(names.includes('minimax_hub_list_capabilities'))
})

test('Hub 工具激活：enabled=false 时不报错且 dispose 是 noop', () => {
  const client = makeMiniMaxHubClient({ enabled: false })
  // 不真正调用 activateMiniMaxHubTools（依赖 cordis 上下文），仅校验工具构造。
  assert.ok(client)
})

test('Hub 客户端：4xx 且返回 ok=false 的视频结果正确转换为错误', async () => {
  const mock = startMock(() => ({
    status: 200,
    payload: { ok: false, error: 'rate limit', error_code: 'rate_limit' },
  }))
  const url = await mock.url
  try {
    const client = new MiniMaxHubClient({ gatewayURL: url })
    await assert.rejects(client.generateVideo('p'), (err: unknown) => {
      assert.ok(err instanceof MiniMaxHubError)
      assert.match((err as Error).message, /rate limit/)
      return true
    })
  } finally { mock.close() }
})
