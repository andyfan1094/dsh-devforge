/** 智谱 Key 池单测：槽位命名、按序解析、失败切换（service 层与 MCP 客户端两层）。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http'
import { ZhipuKeyPool, firstSuccessful, isKeySwitchableStatus, normalizePoolKeys, poolReferenceOrder, poolSlotNames } from '../src/zhipu/key-pool.ts'
import { resolveZhipuPrimaryKeyName } from '../src/zhipu/service.ts'
import { ZhipuServiceError } from '../src/zhipu/errors.ts'
import { ZhipuMcpClient } from '../src/zhipu/mcp-client.ts'

/** 测试桩：内存凭据表（ref → value；缺失即未配置）。CredentialRef 本体就是引用名字符串。 */
function fakeCredentials(values: Record<string, string>) {
  return {
    async resolve(ref: string) {
      const value = values[String(ref)]
      return value !== undefined ? { value } : undefined
    },
    async describe(ref: string) {
      const value = values[String(ref)]?.trim()
      return { configured: value !== undefined && value !== '' }
    },
  }
}

test('槽位命名：主 Key 之后固定 _2…_6，主 Key 重名时去重', () => {
  assert.deepEqual(poolSlotNames('KEY'), ['KEY_2', 'KEY_3', 'KEY_4', 'KEY_5', 'KEY_6'])
  assert.deepEqual(poolReferenceOrder('KEY')[0], 'KEY')
  assert.equal(poolReferenceOrder('KEY').length, 6)
  // 主 Key 与槽位重名的防御场景：保持首次出现，不重复解析同一引用。
  assert.equal(new Set(poolReferenceOrder('KEY_2')).size, poolReferenceOrder('KEY_2').length)
})

test('池清单规整：主 Key 在前，configured 按描述结果标记', () => {
  const keys = normalizePoolKeys('KEY', { KEY: true, KEY_3: true })
  assert.deepEqual(keys.map((key) => key.env), ['KEY', 'KEY_2', 'KEY_3', 'KEY_4', 'KEY_5', 'KEY_6'])
  assert.deepEqual(keys.map((key) => key.configured), [true, false, true, false, false, false])
  assert.deepEqual(keys.map((key) => key.primary), [true, false, false, false, false, false])
})

test('可切换状态：401/403/429 允许换 Key，其他一律不切', () => {
  assert.equal(isKeySwitchableStatus(401), true)
  assert.equal(isKeySwitchableStatus(403), true)
  assert.equal(isKeySwitchableStatus(429), true)
  assert.equal(isKeySwitchableStatus(500), false)
  assert.equal(isKeySwitchableStatus(504), false)
  assert.equal(isKeySwitchableStatus(undefined), false)
})

test('按序失败切换：401/403/429 顺延下一把，其余错误直接抛出', async () => {
  const keyOf = (env: string): ZhipuServiceError => new ZhipuServiceError(env + ' 失效', 401)
  // 前两把 401/429，第三把成功。
  const attempts: string[] = []
  const result = await firstSuccessful(['a', 'b', 'c'], async (env) => {
    attempts.push(env)
    if (env === 'a') throw keyOf('a')
    if (env === 'b') throw new ZhipuServiceError('b 限流', 429)
    return env + '-ok'
  })
  assert.equal(result, 'c-ok')
  assert.deepEqual(attempts, ['a', 'b', 'c'])
  // 全部可切换失败：抛最后一把的错误。
  await assert.rejects(
    firstSuccessful(['a', 'b'], async (env) => { throw keyOf(env) }),
    (error: unknown) => error instanceof ZhipuServiceError && error.message === 'b 失效',
  )
  // 不可切换错误（如 504 超时）不切换，直接呈现。
  await assert.rejects(
    firstSuccessful(['a', 'b'], async () => { throw new ZhipuServiceError('超时', 504) }),
    (error: unknown) => error instanceof ZhipuServiceError && error.status === 504,
  )
})

test('Key 池解析：主 Key 优先，跳过空槽位；全空时 400', async () => {
  const pool = new ZhipuKeyPool(fakeCredentials({ KEY: ' key-a ', KEY_3: 'key-c' }), async () => 'KEY')
  const ordered = await pool.ordered()
  assert.deepEqual(ordered.map((key) => key.env), ['KEY', 'KEY_3'])
  // 值两端空白被裁剪；Key 明文只在此处出现，绝不能进日志或面板。
  assert.equal(ordered[0].value, 'key-a')
  assert.equal(await pool.usableCount(), 2)
  // 档位越界：报错带池内可用数量，不泄露 Key。
  await assert.rejects(pool.resolveByAttempt(2), (error: unknown) =>
    error instanceof ZhipuServiceError && error.status === 400 && error.message.includes('2 把'))
  // 全空池：明确报「尚未配置」。
  const emptyPool = new ZhipuKeyPool(fakeCredentials({}), async () => 'KEY')
  await assert.rejects(emptyPool.ordered(), (error: unknown) =>
    error instanceof ZhipuServiceError && error.status === 400 && error.message.includes('尚未配置'))
})

test('Key 池按引用名解析：不在池内或未配置均 400', async () => {
  const pool = new ZhipuKeyPool(fakeCredentials({ KEY: 'key-a' }), async () => 'KEY')
  assert.equal((await pool.resolveByEnv('KEY')).value, 'key-a')
  await assert.rejects(pool.resolveByEnv('OTHER_KEY'), (error: unknown) =>
    error instanceof ZhipuServiceError && error.status === 400 && error.message.includes('不在智谱 Key 池内'))
  await assert.rejects(pool.resolveByEnv('KEY_2'), (error: unknown) =>
    error instanceof ZhipuServiceError && error.status === 400 && error.message.includes('未配置'))
})

test('主 Key 引用名：聊天路由 provider.apiKeyEnv 优先，回落插件配置', () => {
  assert.equal(resolveZhipuPrimaryKeyName({ providers: { 'zai-coding-cn': { apiKeyEnv: 'KEY_3' } } }, 'KEY'), 'KEY_3')
  assert.equal(resolveZhipuPrimaryKeyName({ providers: { 'zai-coding-cn': {} } }, 'KEY'), 'KEY')
  assert.equal(resolveZhipuPrimaryKeyName(undefined, 'KEY'), 'KEY')
  // 非字符串值（配置损坏）按回落处理，不抛异常。
  assert.equal(resolveZhipuPrimaryKeyName({ providers: { 'zai-coding-cn': { apiKeyEnv: 123 } } }, 'KEY'), 'KEY')
})

/** 极简 MCP mock：按 Authorization 分派（key-a 401，key-b 成功），记录握手次数。 */
function startAuthMock() {
  const seen: string[] = []
  let handshakes = 0
  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let body = ''
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => {
      const message = JSON.parse(body)
      const reply = (payload: unknown): void => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(payload)) }
      if (message.method === 'initialize') {
        handshakes += 1
        res.setHeader('mcp-session-id', 'session-' + handshakes)
        return reply({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: '2025-03-26', capabilities: {}, serverInfo: { name: 'mock', version: '0' } } })
      }
      const auth = String(req.headers.authorization ?? '')
      if (auth === 'Bearer key-1') { res.statusCode = 401; return res.end('invalid key') }
      // 只统计业务调用；initialize 的 notifications 通知不参与断言。
      if (message.method !== 'tools/call') return reply({ jsonrpc: '2.0', id: message.id, result: {} })
      seen.push(auth)
      return reply({ jsonrpc: '2.0', id: message.id, result: { content: [{ type: 'text', text: 'ok-by-' + auth.slice(7) }] } })
    })
  })
  return new Promise<{ url: string; close: () => void; seen: () => string[]; handshakes: () => number }>((resolvePromise) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as { port: number }
      resolvePromise({
        url: `http://127.0.0.1:${address.port}/mcp`,
        close: () => server.close(),
        seen: () => seen,
        handshakes: () => handshakes,
      })
    })
  })
}

test('MCP 客户端：401 自动换下一把 Key 且重建会话；成功档位被记住', async () => {
  const mock = await startAuthMock()
  try {
    const client = new ZhipuMcpClient(mock.url, async (attempt) => 'key-' + (attempt + 1), 5000)
    // 第一次调用：key-1 401 → 换 key-2 成功。
    const result = await client.call('mock_tool', {})
    assert.equal(result.text, 'ok-by-key-2')
    // 第二次调用：从记住的档位直接用 key-2，不再撞 401。
    const second = await client.call('mock_tool', {})
    assert.equal(second.text, 'ok-by-key-2')
    assert.deepEqual(mock.seen(), ['Bearer key-2', 'Bearer key-2'])
    // 换 Key 后 initialize 重新握手：key-1 一次 + key-2 一次。
    assert.equal(mock.handshakes(), 2)
  } finally { mock.close() }
})
