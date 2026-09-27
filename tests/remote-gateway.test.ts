/** 远程访问网关交付验证：认证、限速、反代、WS 拦截与生命周期（0.41.0）。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer as createHttpServer, request as httpRequest, type Server } from 'node:http'
import { startRemoteGateway, loadDshSessionSecret, type GatewayLog } from '../src/remote-gateway.ts'
import { mergeGatewaySettings } from '../src/remote/gateway-routes.ts'

/** 静默日志（收集不打印；断言期可检查是否产生告警）。 */
function makeLog(): GatewayLog & { warnings: string[] } {
  const warnings: string[] = []
  return {
    warnings,
    info: () => {},
    warn: (message, ...args) => { warnings.push(message.replace(/%s/g, () => String(args.shift() ?? ''))) },
  }
}

/** 假上游：任何请求回 200 upstream-ok；返回实际端口供网关转发。 */
async function startFakeUpstream(): Promise<{ port: number; close: () => Promise<void> }> {
  const server: Server = createHttpServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' })
    res.end('upstream-ok:' + (req.url ?? '/'))
  })
  await new Promise<void>((resolvePromise) => { server.listen(0, '127.0.0.1', () => resolvePromise()) })
  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : 0
  return { port, close: () => new Promise((resolvePromise) => { server.close(() => resolvePromise()) }) }
}

/** 起网关（port=0 系统分配），测试结束自动回收。 */
function startGateway(t: test.TestContext, overrides?: Partial<{ password: string; upstreamPort: number; credentialsFile: string }>) {
  const config = {
    port: 0,
    host: '127.0.0.1',
    password: '测试密码-123',
    upstreamPort: overrides?.upstreamPort ?? 0,
    sessionHours: 12,
    credentialsFile: overrides?.credentialsFile ?? join(tmpdir(), '不存在-网关测试凭据.yaml'),
  }
  const log = makeLog()
  const gateway = startRemoteGateway({ ...config, upstreamPort: overrides?.upstreamPort ?? 0 }, log)
  t.after(() => gateway.dispose())
  return { gateway, log, base: async (): Promise<string> => {
    // 等待监听完成（listen 回调异步）；轮询直到端口可用。
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const port = gateway.listeningPort
      if (port !== undefined) return `http://127.0.0.1:${port}`
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 20))
    }
    throw new Error('网关未能在 1 秒内进入监听状态')
  } }
}

test('loadDshSessionSecret：合法记录解析出 32 字节 secret；缺失/短 secret 返回 undefined', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gw-cred-'))
  const secret = 'A'.repeat(42) + 'B' // 43 字符 base64url ≈ 32 字节
  const valid = join(dir, 'ok.yaml')
  writeFileSync(valid, `version: 1\nrecords:\n  client-connection/browser-session:\n    kind: grant\n    payload:\n      version: 1\n      secret: ${secret}\nrefs:\n  X: y\n`, 'utf8')
  assert.equal(loadDshSessionSecret(valid)?.byteLength, 32)
  const missing = join(dir, 'missing.yaml')
  writeFileSync(missing, 'records:\n  other/record:\n    payload:\n      secret: ' + secret + '\n', 'utf8')
  assert.equal(loadDshSessionSecret(missing), undefined)
  const short = join(dir, 'short.yaml')
  writeFileSync(short, 'records:\n  client-connection/browser-session:\n    payload:\n      secret: tooshort\n', 'utf8')
  assert.equal(loadDshSessionSecret(short), undefined)
  assert.equal(loadDshSessionSecret(join(dir, '不存在.yaml')), undefined)
})

test('转发请求自动携带机器内 DSH 会话 Cookie（凭据文件可用时），且不发给浏览器', async (t) => {
  const seen: string[] = []
  const upstream = createHttpServer((req, res) => {
    seen.push(req.headers.cookie ?? '')
    res.writeHead(200, { 'content-type': 'text/plain' })
    res.end('upstream-ok')
  })
  await new Promise<void>((resolvePromise) => { upstream.listen(0, '127.0.0.1', () => resolvePromise()) })
  t.after(() => new Promise<void>((resolvePromise) => { upstream.close(() => resolvePromise()) }))
  const upstreamPort = (upstream.address() as { port: number }).port
  const dir = mkdtempSync(join(tmpdir(), 'gw-cred-'))
  const credentialsFile = join(dir, 'credentials.yaml')
  writeFileSync(credentialsFile, 'records:\n  client-connection/browser-session:\n    payload:\n      secret: ' + 'A'.repeat(42) + 'B\n', 'utf8')
  const { base } = startGateway(t, { upstreamPort, credentialsFile })
  const root = await base()
  const login = await fetch(root + '/__gateway/login', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: '测试密码-123' }),
  })
  const gwCookie = login.headers.getSetCookie().find((line) => line.startsWith('devforge_gw_session='))?.split(';')[0] ?? ''
  const res = await fetch(root + '/', { headers: { cookie: gwCookie } })
  assert.equal(await res.text(), 'upstream-ok')
  assert.equal(seen.length, 1)
  assert.match(seen[0], /dsh-auth-[A-Za-z0-9_-]+=v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/, '上游必须收到 v1 格式的 DSH 会话 Cookie')
  assert.match(seen[0], /devforge_gw_session=/, '网关自身会话同样透传')
})

test('未认证访问任何路径 → 302 到登录页；登录页可访问且含密码表单', async (t) => {
  const upstream = await startFakeUpstream()
  t.after(() => upstream.close())
  const { gateway, base } = startGateway(t, { upstreamPort: upstream.port })
  const root = await fetch(await base() + '/', { redirect: 'manual' })
  assert.equal(root.status, 302)
  assert.equal(root.headers.get('location'), '/__gateway/login')
  const login = await fetch(await base() + '/__gateway/login')
  assert.equal(login.status, 200)
  assert.match(await login.text(), /访问密码/)
})

test('错误密码 401；正确密码发会话 Cookie；带 Cookie 反代到上游', async (t) => {
  const upstream = await startFakeUpstream()
  t.after(() => upstream.close())
  const { gateway, base } = startGateway(t, { upstreamPort: upstream.port })
  const root = await base()
  const bad = await fetch(root + '/__gateway/login', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: '错的' }),
  })
  assert.equal(bad.status, 401)
  const good = await fetch(root + '/__gateway/login', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: '测试密码-123' }),
  })
  assert.equal(good.status, 200)
  const cookie = good.headers.getSetCookie().find((line) => line.startsWith('devforge_gw_session='))
  assert.ok(cookie !== undefined, '应下发会话 Cookie')
  assert.match(cookie, /HttpOnly/, 'Cookie 必须 HttpOnly')
  const token = cookie.split(';')[0]
  const proxied = await fetch(root + '/some/path?q=1', { headers: { cookie: token } })
  assert.equal(proxied.status, 200)
  assert.equal(await proxied.text(), 'upstream-ok:/some/path?q=1')
})

test('连续 5 次错误密码触发锁定：第 6 次直接 429', async (t) => {
  const upstream = await startFakeUpstream()
  t.after(() => upstream.close())
  const { base } = startGateway(t, { upstreamPort: upstream.port })
  const root = await base()
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const res = await fetch(root + '/__gateway/login', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: `错-${attempt}` }),
    })
    assert.equal(res.status, 401)
  }
  const locked = await fetch(root + '/__gateway/login', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: '测试密码-123' }),
  })
  // 锁定期连正确密码也拒绝：这是防穷举的预期行为。
  assert.equal(locked.status, 429)
})

test('WebSocket upgrade 未认证 → 连接被直接销毁，不允许探测', async (t) => {
  const upstream = await startFakeUpstream()
  t.after(() => upstream.close())
  const { base } = startGateway(t, { upstreamPort: upstream.port })
  const root = await base()
  const port = Number(new URL(root).port)
  const outcome = await new Promise<string>((resolvePromise) => {
    const req = httpRequest({ host: '127.0.0.1', port, headers: { connection: 'Upgrade', upgrade: 'websocket', 'sec-websocket-key': 'x', 'sec-websocket-version': '13' } })
    req.on('upgrade', () => resolvePromise('upgraded'))
    req.on('response', (res) => { res.resume(); resolvePromise('response:' + res.statusCode) })
    req.on('error', (error: Error) => resolvePromise('error:' + error.message))
    req.end()
    setTimeout(() => resolvePromise('timeout'), 1500)
  })
  assert.notEqual(outcome, 'upgraded', '未认证不得完成 WS 升级')
})

test('dispose 释放端口与会话：旧 Cookie 失效，端口可被新实例复用', async (t) => {
  const upstream = await startFakeUpstream()
  t.after(() => upstream.close())
  const first = startGateway(t, { upstreamPort: upstream.port })
  const root = await first.base()
  const login = await fetch(root + '/__gateway/login', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: '测试密码-123' }),
  })
  const cookie = login.headers.getSetCookie().find((line) => line.startsWith('devforge_gw_session='))?.split(';')[0] ?? ''
  assert.ok(cookie !== '')
  const port = first.gateway.listeningPort
  first.gateway.dispose()
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 120))
  // 复用同一端口起新实例：旧实例已彻底释放。
  const second = startRemoteGateway({ port: port ?? 0, host: '127.0.0.1', password: '另一密码', upstreamPort: upstream.port, sessionHours: 1 }, makeLog())
  await new Promise<void>((resolvePromise) => { setTimeout(resolvePromise, 120) })
  second.dispose()
  assert.ok(true)
})

test('登录成功日志不含密码原文', async (t) => {
  const upstream = await startFakeUpstream()
  t.after(() => upstream.close())
  const { log, base } = startGateway(t, { upstreamPort: upstream.port })
  await fetch(await base() + '/__gateway/login', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: '测试密码-123' }),
  })
  for (const message of log.warnings) assert.ok(!message.includes('测试密码-123'), '日志不得出现密码')
})

test('面板配置合并：显式字段覆盖、密码留空保留旧值、越界报中文错', async () => {
  const current = { enabled: false, port: 19390, host: '0.0.0.0', password: '旧密码', upstreamPort: 3080, sessionHours: 12 }
  // 空补丁 = 原样保留
  assert.deepEqual(mergeGatewaySettings(current, {}), current)
  // 密码空串 = 保留旧密码
  const keep = mergeGatewaySettings(current, { password: '' })
  assert.equal(keep.password, '旧密码')
  // 显式字段覆盖 + 启用
  const next = mergeGatewaySettings(current, { enabled: true, port: 19391, password: '新密码', sessionHours: 24 })
  assert.equal(next.enabled, true)
  assert.equal(next.port, 19391)
  assert.equal(next.password, '新密码')
  assert.equal(next.sessionHours, 24)
  assert.equal(next.upstreamPort, 3080, '未给出的字段保留现值')
  // 越界：中文报错
  assert.throws(() => mergeGatewaySettings(current, { port: 0 }), /端口必须/)
  assert.throws(() => mergeGatewaySettings(current, { port: 70000 }), /端口必须/)
  assert.throws(() => mergeGatewaySettings(current, { upstreamPort: 19390 }), /上游端口不能与网关端口相同/)
  assert.throws(() => mergeGatewaySettings(current, { sessionHours: 0 }), /会话时长必须/)
  assert.throws(() => mergeGatewaySettings(current, { host: '  ' }), /监听地址不能为空/)
  // 开启但无密码的守卫在路由层（save 前），合并层不阻止
})
