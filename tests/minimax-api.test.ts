/** MiniMax 官方 API 客户端与工具单测：本地 mock 端点覆盖请求、错误映射与输入规整。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http'
import { writeFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describeBaseResp, formatSearchResult, MiniMaxApiClient, MiniMaxApiError, parseRemainsPayload, parseSearchResult, safeApiError } from '../src/minimax/api-client.ts'
import { ImageInputError, sniffImageMime, toImageDataUrl } from '../src/minimax/image-input.ts'
import { makeMiniMaxToolDefinitions } from '../src/minimax/tools.ts'
import { mergeMiniMaxProvider, MINIMAX_MODELS } from '../src/minimax/service.ts'

/** 极简 JSON 应答器：记录最近一次请求并回放预设响应。 */
function startMock(respond: (req: IncomingMessage, body: Record<string, unknown>) => { status?: number; payload: unknown }) {
  let last: { auth: string; source: string; path: string; body: Record<string, unknown> } | undefined
  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let raw = ''
    req.on('data', (chunk) => { raw += chunk })
    req.on('end', () => {
      const body = raw === '' ? {} : JSON.parse(raw)
      last = { auth: String(req.headers.authorization ?? ''), source: String(req.headers['mm-api-source'] ?? ''), path: req.url ?? '', body }
      const outcome = respond(req, body)
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

const keyProvider = async () => 'test-key'

/** 官方成功应答模板。 */
const ok = (payload: Record<string, unknown>) => ({ status: 200, payload: { base_resp: { status_code: 0, status_msg: 'success' }, ...payload } })

test('MiniMax API 客户端：search 携带 Bearer 与来源头并规整结果', async () => {
  const mock = startMock(() => ok({
    organic: [
      { title: '结果一', link: 'https://a.example/1', snippet: '摘要一', date: '2025-11-01' },
      { title: '结果二', link: 'https://a.example/2' },
      { title: 42, link: 'https://a.example/3' },
    ],
    related_searches: [{ query: '相关一' }, { query: 7 }],
  }))
  try {
    const client = new MiniMaxApiClient(keyProvider, 5000, await mock.url)
    const result = await client.search('查询词')
    assert.equal(mock.last()?.auth, 'Bearer test-key')
    assert.equal(mock.last()?.source, 'Minimax-MCP')
    assert.equal(mock.last()?.body.q, '查询词')
    assert.deepEqual(result.items.slice(0, 2).map((item) => item.title), ['结果一', '结果二'])
    assert.equal(result.items.length, 2)
    assert.deepEqual(result.related, ['相关一'])
  } finally { mock.close() }
})

test('MiniMax API 客户端：understandImage 返回官方 content', async () => {
  const mock = startMock(() => ok({ content: '蓝色' }))
  try {
    const client = new MiniMaxApiClient(keyProvider, 5000, await mock.url)
    const content = await client.understandImage('什么颜色', 'data:image/png;base64,AAAA')
    assert.equal(content, '蓝色')
    assert.equal(mock.last()?.body.image_url, 'data:image/png;base64,AAAA')
  } finally { mock.close() }
})

test('MiniMax API 客户端：base_resp 错误码映射为分类错误', async () => {
  const cases: Array<{ code: number; status: number }> = [
    { code: 1004, status: 401 },
    { code: 2038, status: 403 },
    { code: 2013, status: 400 },
    { code: 1026, status: 400 },
    { code: 9999, status: 502 },
  ]
  for (const { code, status } of cases) {
    const error = describeBaseResp(code, '提示')
    assert.equal(error.status, status)
    assert.doesNotMatch(error.message, /test-key/)
  }
})

test('MiniMax API 客户端：HTTP 401 映射为凭据错误', async () => {
  const mock = startMock(() => ({ status: 401, payload: { base_resp: { status_code: 1004, status_msg: 'invalid api key' } } }))
  try {
    const client = new MiniMaxApiClient(keyProvider, 5000, await mock.url)
    await assert.rejects(client.search('x'), (error: unknown) => error instanceof MiniMaxApiError && error.status === 401)
  } finally { mock.close() }
})

test('MiniMax 工具：搜索与图像工具返回统一契约', async () => {
  const calls: string[] = []
  const client = {
    search: async (query: string) => { calls.push('search:' + query); return { items: [{ title: 'T', link: 'https://a/1', snippet: 'S' }], related: ['R'] } },
    understandImage: async (prompt: string, image: string) => { calls.push('vlm:' + prompt + '|' + image.slice(0, 15)); return '描述' },
  } as unknown as MiniMaxApiClient
  const [search, image] = makeMiniMaxToolDefinitions(client)
  // 必填参数缺失由 DSH 工具运行时的 schema 校验拦截。
  await assert.rejects(search.execute({}), /missing required property/)
  // 空白参数通过 schema 但被工具层拒绝。
  const blank = await search.execute({ query: '   ' })
  assert.equal(blank.ok, false)
  const good = await search.execute({ query: '词' })
  assert.equal(good.ok, true)
  assert.match(good.content ?? '', /https:\/\/a\/1/)
  assert.match(good.content ?? '', /相关搜索：R/)
  const emptyImage = await image.execute({ prompt: 'p', image_source: ' ' })
  assert.equal(emptyImage.ok, false)
})

test('图片输入：嗅探类型并拒绝未知格式', () => {
  assert.equal(sniffImageMime(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), 'image/jpeg')
  assert.equal(sniffImageMime(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), 'image/png')
  const webp = new Uint8Array(12)
  webp.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])
  assert.equal(sniffImageMime(webp), 'image/webp')
  assert.equal(sniffImageMime(new Uint8Array([1, 2, 3, 4])), undefined)
})

test('图片输入：data URL 校验与本地文件转换', async () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
  const direct = await toImageDataUrl('data:image/png;base64,' + png.toString('base64'))
  assert.match(direct, /^data:image\/png;base64,/)
  await assert.rejects(toImageDataUrl('data:image/gif;base64,AAAA'), ImageInputError)
  await assert.rejects(toImageDataUrl('data:图片;base64,AAAA'), ImageInputError)
  await assert.rejects(toImageDataUrl(''), ImageInputError)
  const dir = await mkdtemp(join(tmpdir(), 'minimax-test-'))
  try {
    const file = join(dir, 'pic.png')
    await writeFile(file, png)
    const converted = await toImageDataUrl(file)
    assert.match(converted, /^data:image\/png;base64,/)
    const txt = join(dir, 'note.txt')
    await writeFile(txt, 'not an image')
    await assert.rejects(toImageDataUrl(txt), ImageInputError)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('模型路由合并：只补缺失模型并保留用户字段', () => {
  const merged = mergeMiniMaxProvider({
    apiKeyEnv: 'MY_MINIMAX_KEY',
    models: [{ id: 'MiniMax-M3', name: '自定义 M3', contextWindow: 1 }],
  }, 'MINIMAX_CN_API_KEY')
  assert.equal(merged.apiKeyEnv, 'MY_MINIMAX_KEY')
  const models = merged.models as Array<Record<string, unknown>>
  const ids = models.map((model) => model.id)
  assert.equal(models.length, MINIMAX_MODELS.length)
  assert.equal(ids.filter((id) => id === 'MiniMax-M3').length, 1)
  const kept = models.find((model) => model.id === 'MiniMax-M3')
  assert.equal(kept?.name, '自定义 M3')
  assert.ok(ids.includes('MiniMax-M2.5'))
  assert.ok(ids.includes('MiniMax-M2'))
})

test('工具输出脱敏：错误消息不包含 Key', () => {
  const message = safeApiError(new Error('Authorization: Bearer sk-secret-token failed'))
  assert.doesNotMatch(message, /sk-secret-token/)
  assert.match(message, /Bearer \[redacted\]/)
})

test('用量规整：5h + 周双窗口与套餐名抽取', () => {
  const fixedNow = 1788100000000
  const dashboard = parseRemainsPayload({
    current_subscribe_title: 'Token Plan Plus',
    model_remains: [
      {
        model_name: 'general',
        current_interval_remaining_percent: 97,
        current_weekly_remaining_percent: 99,
        remains_time: 15370,
        weekly_remains_time: 602170,
        end_time: 1788123600000,
        weekly_end_time: 1788710400000,
        current_interval_quota: 5000,
        current_weekly_quota: 100000,
      },
      {
        model_name: 'video',
        current_interval_remaining_percent: 100,
        current_weekly_remaining_percent: 100,
        current_interval_status: 3,
        current_weekly_status: 3,
      },
    ],
    base_resp: { status_code: 0, status_msg: 'success' },
  }, fixedNow)
  assert.equal(dashboard.planName, 'Token Plan Plus')
  assert.equal(dashboard.fetchedAt, fixedNow)
  assert.deepEqual(dashboard.warnings, [])
  const general = dashboard.models.find((m) => m.name === 'general')
  assert.equal(general?.included, true)
  assert.equal(general?.intervalRemainingPercent, 97)
  assert.equal(general?.weeklyRemainingPercent, 99)
  assert.equal(general?.intervalEndAt, 1788123600000)
  assert.equal(general?.weeklyEndAt, 1788710400000)
  const video = dashboard.models.find((m) => m.name === 'video')
  assert.equal(video?.included, false)
})

test('用量规整：usage_count/total_count 推导百分比', () => {
  const dashboard = parseRemainsPayload({
    model_remains: [{
      model_name: 'general',
      current_interval_usage_count: 3,
      current_interval_total_count: 10,
      current_weekly_usage_count: 7,
      current_weekly_total_count: 100,
    }],
    base_resp: { status_code: 0 },
  }, 1788100000000)
  const m = dashboard.models[0]
  assert.equal(m.intervalRemainingPercent, 70)
  assert.equal(m.weeklyRemainingPercent, 93)
})

test('用量规整：base_resp 鉴权失败映射为 Key 类型错误', () => {
  assert.throws(
    () => parseRemainsPayload({ base_resp: { status_code: 1004, status_msg: 'login fail: please carry secret key' } }),
    (error: unknown) => error instanceof MiniMaxApiError && error.status === 401 && /订阅 Key/.test((error as Error).message),
  )
})
