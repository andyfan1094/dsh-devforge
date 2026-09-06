/** 智谱 Key 池单测：独立命名列表的播种迁移、增删守卫、按序解析与失败切换。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http'
import {
  ZHIPU_KEY_POOL_LIMIT,
  ZhipuKeyPool,
  firstSuccessful,
  isKeySwitchableStatus,
  newKeyId,
  nextKeyRef,
  normalizeKeyEntry,
  orderEntries,
  type ZhipuKeyEntry,
  type ZhipuPoolStoreLike,
} from '../src/zhipu/key-pool.ts'
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

/** 测试桩：内存池存储（可携带历史数据；记录保存次数供断言）。 */
function fakeStore(initial?: ZhipuKeyEntry[]): ZhipuPoolStoreLike & { data: () => ZhipuKeyEntry[] | undefined; saves: () => number } {
  let data = initial
  let saves = 0
  return {
    load: () => data,
    save: (entries) => { data = entries; saves += 1 },
    data: () => data,
    saves: () => saves,
  }
}

test('引用名生成：从 _2 起顺延，跳过已占用引用（含主 Key）', () => {
  assert.equal(nextKeyRef([]), 'ZAI_CODING_CN_API_KEY_2')
  assert.equal(nextKeyRef(['ZAI_CODING_CN_API_KEY', 'ZAI_CODING_CN_API_KEY_2']), 'ZAI_CODING_CN_API_KEY_3')
  assert.equal(nextKeyRef(['ZAI_CODING_CN_API_KEY_3']), 'ZAI_CODING_CN_API_KEY_2')
})

test('条目校验：名称非空、引用格式、池内唯一与容量上限', () => {
  assert.throws(() => normalizeKeyEntry({ id: 'a', label: '  ', ref: 'REF' }, []), /名称不能为空/)
  assert.throws(() => normalizeKeyEntry({ id: 'a', label: 'x'.repeat(41), ref: 'REF' }, []), /名称不能超过/)
  assert.throws(() => normalizeKeyEntry({ id: 'a', label: '主力', ref: '1bad' }, []), /格式无效/)
  assert.throws(() => normalizeKeyEntry({ id: 'a', label: '主力', ref: 'REF' }, [{ id: 'b', label: '备用', ref: 'REF' }]), /已在 Key 池内/)
  const full = Array.from({ length: ZHIPU_KEY_POOL_LIMIT }, (_, index) => ({ id: 'k' + index, label: 'k' + index, ref: 'R' + index }))
  assert.throws(() => normalizeKeyEntry({ id: 'new', label: '新', ref: 'RNEW' }, full), /已满/)
  assert.deepEqual(normalizeKeyEntry({ id: 'a', label: ' 主力 ', ref: 'REF' }, []), { id: 'a', label: '主力', ref: 'REF' })
})

test('失败切换顺序：主 Key 在前，其余按维护顺序', () => {
  const entries = [
    { id: '1', label: 'A', ref: 'A' },
    { id: '2', label: 'B', ref: 'B' },
    { id: '3', label: 'C', ref: 'C' },
  ]
  assert.deepEqual(orderEntries(entries, 'B').map((entry) => entry.ref), ['B', 'A', 'C'])
  // 主 Key 不在清单时按原顺序返回（防御路径，正常由播种保证存在）。
  assert.deepEqual(orderEntries(entries, 'Z').map((entry) => entry.ref), ['A', 'B', 'C'])
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

test('播种迁移：主 Key 打头，历史派生槽位中已配置的旧附加 Key 并入池', async () => {
  const credentials = fakeCredentials({ KEY: ' key-a ', KEY_3: 'key-c' })
  const store = fakeStore()
  const pool = new ZhipuKeyPool(credentials, async () => 'KEY', store, ['KEY'])
  const keys = await pool.list()
  // 主 Key + 已配置的 _3 槽位入库；未配置的 _2/_4/_5/_6 不产生条目。
  assert.deepEqual(keys.map((key) => key.ref), ['KEY', 'KEY_3'])
  assert.deepEqual(keys.map((key) => key.label), ['主 Key', '附加 Key 3'])
  assert.deepEqual(keys.map((key) => key.primary), [true, false])
  assert.deepEqual(keys.map((key) => key.configured), [true, true])
  // 播种结果落盘，二次访问不再重复播种。
  assert.equal(store.saves(), 1)
  assert.deepEqual(await pool.entriesView().then((entries) => entries.map((entry) => entry.ref)), ['KEY', 'KEY_3'])
})

test('加载既有清单：主 Key 引用缺失时防御性补到最前并落盘', async () => {
  const credentials = fakeCredentials({ KEY: 'key-a', CUSTOM_REF: 'key-b' })
  const store = fakeStore([
    { id: 'k1', label: '账号A', ref: 'KEY' },
    { id: 'k2', label: '账号B', ref: 'CUSTOM_REF' },
  ])
  // 场景：主 Key 已切换为 CUSTOM_REF；清单中它已存在，顺序仅在展示时主 Key 优先。
  const pool = new ZhipuKeyPool(credentials, async () => 'CUSTOM_REF', store)
  const keys = await pool.list()
  assert.deepEqual(keys.map((key) => key.ref), ['CUSTOM_REF', 'KEY'])
  assert.deepEqual(keys.map((key) => key.label), ['账号B', '账号A'])
  assert.deepEqual(keys.map((key) => key.primary), [true, false])
  // 损坏清单：主 Key 引用不在池内 → 自动补条目，保证聊天路由凭据可被管理。
  const brokenStore = fakeStore([{ id: 'k1', label: '账号A', ref: 'KEY' }])
  const brokenPool = new ZhipuKeyPool(credentials, async () => 'CUSTOM_REF', brokenStore)
  const repaired = await brokenPool.list()
  assert.deepEqual(repaired.map((key) => key.ref), ['CUSTOM_REF', 'KEY'])
  assert.equal(brokenStore.saves(), 1)
})

test('按序解析与按引用解析：跳过未配置；未知引用 400；换主 Key 不改变池成员', async () => {
  const credentials = fakeCredentials({ KEY: ' key-a ', KEY_2: 'key-b' })
  const store = fakeStore([
    { id: 'k1', label: '主 Key', ref: 'KEY' },
    { id: 'k2', label: '备用', ref: 'KEY_2' },
    { id: 'k3', label: '空槽', ref: 'KEY_9' },
  ])
  const pool = new ZhipuKeyPool(credentials, async () => 'KEY', store)
  const ordered = await pool.ordered()
  assert.deepEqual(ordered.map((key) => key.env), ['KEY', 'KEY_2'])
  // 值两端空白被裁剪；Key 明文只在此处出现，绝不能进日志或面板。
  assert.equal(ordered[0].value, 'key-a')
  assert.equal(await pool.usableCount(), 2)
  await assert.rejects(pool.resolveByAttempt(2), (error: unknown) =>
    error instanceof ZhipuServiceError && error.status === 400 && error.message.includes('2 把'))
  await assert.rejects(pool.resolveByEnv('OTHER_KEY'), /不在智谱 Key 池内/)
  await assert.rejects(pool.resolveByEnv('KEY_9'), /未配置/)
  // 关键回归：切换主 Key 到 KEY_2 后，原主 Key KEY 仍在池内（旧实现会整池漂移丢失）。
  const rotated = new ZhipuKeyPool(credentials, async () => 'KEY_2', store)
  const afterRotate = await rotated.list()
  assert.deepEqual(afterRotate.map((key) => key.ref), ['KEY_2', 'KEY', 'KEY_9'])
  assert.deepEqual(afterRotate.map((key) => key.primary), [true, false, false])
  assert.deepEqual(afterRotate.map((key) => key.configured), [true, true, false])
})

test('删除守卫：主 Key 不能删；附加 Key 删除后清单落盘', async () => {
  const credentials = fakeCredentials({ KEY: 'key-a', KEY_2: 'key-b' })
  const store = fakeStore([
    { id: 'k1', label: '主 Key', ref: 'KEY' },
    { id: 'k2', label: '备用', ref: 'KEY_2' },
  ])
  const pool = new ZhipuKeyPool(credentials, async () => 'KEY', store)
  await assert.rejects(pool.removeEntry('k1'), /主 Key 不能直接删除/)
  await pool.removeEntry('k2')
  assert.deepEqual((await pool.entriesView()).map((entry) => entry.id), ['k1'])
  await assert.rejects(pool.removeEntry('k2'), /不在池内/)
  await assert.rejects(pool.renameEntry('k2', 'x'), /不在池内/)
  await pool.renameEntry('k1', '主力号')
  assert.equal((await pool.entriesView())[0].label, '主力号')
})

test('主 Key 引用名：聊天路由 provider.apiKeyEnv 优先，回落插件配置', () => {
  assert.equal(resolveZhipuPrimaryKeyName({ providers: { 'zai-coding-cn': { apiKeyEnv: 'KEY_3' } } }, 'KEY'), 'KEY_3')
  assert.equal(resolveZhipuPrimaryKeyName({ providers: { 'zai-coding-cn': {} } }, 'KEY'), 'KEY')
  assert.equal(resolveZhipuPrimaryKeyName(undefined, 'KEY'), 'KEY')
  // 非字符串值（配置损坏）按回落处理，不抛异常。
  assert.equal(resolveZhipuPrimaryKeyName({ providers: { 'zai-coding-cn': { apiKeyEnv: 123 } } }, 'KEY'), 'KEY')
})

test('newKeyId：进程内唯一且非空', () => {
  const ids = new Set(Array.from({ length: 200 }, () => newKeyId()))
  assert.equal(ids.size, 200)
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
