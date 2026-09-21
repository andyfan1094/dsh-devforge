/** 插件更新能力单测：官网登录（sid 解析）、semver 比较、官网清单解析、sha256、检查编排、白名单升级、官网账号设置校验与 site 路由。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  PLUGIN_UPDATE_DEFAULT_SITE_API,
  PluginUpdateService,
  applySitePatch,
  buildDshPluginAddCommand,
  checkOne,
  compareSemver,
  downloadTgz,
  loginSite,
  parseSidFromSetCookie,
  parseSiteIndex,
  resolveLatest,
  sha256Hex,
  toSiteView,
  type LatestInfo,
  type PluginUpdateSiteConfig,
  type UpdateSource,
} from '../src/plugin-update.ts'
import { makeRoutes } from '../src/routes.ts'

test('buildDshPluginAddCommand：Windows 优先直启当前 DSH Node 入口，绕过 .cmd 与 PATH', () => {
  const entryPath = 'C:\\Program Files\\nodejs\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js'
  const nodePath = 'C:\\Program Files\\nodejs\\node.exe'
  const command = buildDshPluginAddCommand('win32', 'web', 'C:\\Temp dir\\x.tgz', {
    entryPath,
    nodePath,
    execArgv: ['--import', 'tsx/esm'],
  })
  assert.equal(command.file, nodePath)
  assert.deepEqual(command.args, ['--import', 'tsx/esm', entryPath, 'plugin', '--profile', 'web', 'add', 'C:\\Temp dir\\x.tgz'])
  assert.equal(command.verbatim, false)
})

test('buildDshPluginAddCommand：Windows 无标准入口时经 ComSpec 启动并完整引用参数', () => {
  const command = buildDshPluginAddCommand('win32', 'web', 'C:\\Temp dir\\x.tgz', { comSpec: 'C:\\Windows\\System32\\cmd.exe' })
  assert.equal(command.file, 'C:\\Windows\\System32\\cmd.exe')
  assert.deepEqual(command.args, ['/d', '/s', '/c', '"dsh plugin --profile web add "C:\\Temp dir\\x.tgz""'])
  assert.equal(command.verbatim, true)
})

test('buildDshPluginAddCommand：Windows 对 cmd 元字符统一加引号', () => {
  const command = buildDshPluginAddCommand('win32', 'web profile', 'C:\\Temp (safe)&drop\\x.tgz', { comSpec: 'cmd.exe' })
  assert.deepEqual(command.args, ['/d', '/s', '/c', '"dsh plugin --profile "web profile" add "C:\\Temp (safe)&drop\\x.tgz""'])
})

test('buildDshPluginAddCommand：Windows 无 Node 入口时拒绝变量展开字符', () => {
  assert.throws(() => buildDshPluginAddCommand('win32', 'web%profile', 'C:\\Temp\\x.tgz', { comSpec: 'cmd.exe' }), /变量展开字符/)
})

test('buildDshPluginAddCommand：POSIX 直接执行 dsh', () => {
  const command = buildDshPluginAddCommand('linux', 'web', '/tmp/x.tgz')
  assert.equal(command.file, 'dsh')
  assert.deepEqual(command.args, ['plugin', '--profile', 'web', 'add', '/tmp/x.tgz'])
  assert.equal(command.verbatim, false)
})

test('compareSemver：逐段比较', () => {
  assert.equal(compareSemver('0.13.0', '0.12.1'), 1)
  assert.equal(compareSemver('0.12.1', '0.13.0'), -1)
  assert.equal(compareSemver('1.0.0', '1.0.0'), 0)
  assert.equal(compareSemver('0.10.0', '0.9.9'), 1)
})

test('parseSiteIndex：合法清单解析，结构不合法返回 undefined', () => {
  const parsed = parseSiteIndex({
    latest: '0.13.1',
    latestUrl: 'https://modagentai.com/downloads/dsh-devforge-latest.tgz',
    versions: [{ version: '0.13.1', url: 'https://modagentai.com/downloads/dsh-devforge-0.13.1.tgz', sha256: 'abc123' }],
  })
  assert.ok(parsed)
  assert.equal(parsed?.latest, '0.13.1')
  assert.equal(parsed?.versions[0]?.sha256, 'abc123')
  assert.equal(parseSiteIndex({ latest: 'not-semver' }), undefined)
  assert.equal(parseSiteIndex({ latest: '0.13.1', latestUrl: 'http://insecure/x.tgz', versions: [] }), undefined)
  assert.equal(parseSiteIndex(null), undefined)
})

test('sha256Hex：已知向量', () => {
  assert.equal(sha256Hex(Buffer.from('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
})

const siteSource: UpdateSource = {
  packageName: 'dsh-devforge',
  indexUrl: 'https://modagentai.com/downloads/index.json',
  repo: 'andyfan1094/dsh-devforge',
}

/** 官网渠道固定解析结果。 */
function siteLatest(version: string): LatestInfo {
  return { version, tgzUrl: 'https://modagentai.com/downloads/dsh-devforge-' + version + '.tgz', via: 'site', sha256: 'fedcba' }
}

test('checkOne：官网渠道可更新 / 已最新 / 本地更高（内测）', async () => {
  const available = await checkOne(siteSource, '0.13.0', async () => siteLatest('0.13.1'))
  assert.equal(available.status, 'update-available')
  assert.equal(available.via, 'site')
  assert.equal(available.latest, '0.13.1')
  const same = await checkOne(siteSource, '0.13.1', async () => siteLatest('0.13.1'))
  assert.equal(same.status, 'up-to-date')
  const newer = await checkOne(siteSource, '0.14.0', async () => siteLatest('0.13.1'))
  assert.equal(newer.status, 'up-to-date')
  assert.ok(newer.reason.includes('内测'))
})

test('checkOne：解析失败 / 本机未装 / 双渠道都未登记', async () => {
  const boom = await checkOne(siteSource, '0.13.0', async () => { throw new Error('官网不可达') })
  assert.equal(boom.status, 'error')
  assert.ok(boom.reason.includes('官网不可达'))
  const notInstalled = await checkOne(siteSource, '', async () => siteLatest('0.13.1'))
  assert.equal(notInstalled.status, 'installed-unknown')
  const blind: UpdateSource = { packageName: 'x' }
  const none = await checkOne(blind, '1.0.0', async () => siteLatest('1.0.0'))
  assert.equal(none.status, 'error')
  assert.ok(none.reason.includes('未登记'))
})

/** 构造可注入的更新服务（官网渠道）。 */
function service(overrides?: { latest?: LatestInfo; installed?: { version?: string }; hashFail?: boolean }): PluginUpdateService {
  return new PluginUpdateService({
    getConfig: () => ({ enabled: true, profile: 'web', sources: [siteSource] }),
    readInstalled: () => overrides?.installed ?? { version: '0.13.0' },
    resolveLatestFn: async () => overrides?.latest !== undefined ? overrides.latest : siteLatest('0.13.1'),
    download: async (url, name, version, options) => {
      assert.ok(url.startsWith('https://modagentai.com/'))
      assert.equal(name, 'dsh-devforge')
      // 官网渠道必须把清单 sha256 传进来做完整性校验。
      assert.equal(options?.expectedSha256, 'fedcba')
      if (overrides?.hashFail) throw new Error('sha256 校验失败')
      return '/tmp/dsh-devforge-' + version + '.tgz'
    },
    runAdd: async (profile, tgzPath) => {
      assert.equal(profile, 'web')
      assert.ok(tgzPath.endsWith('.tgz'))
      return 'done'
    },
  })
}

test('PluginUpdateService.check：官网渠道返回检查项', async () => {
  const result = await service().check()
  assert.equal(result.enabled, true)
  assert.equal(result.items.length, 1)
  assert.equal(result.items[0]?.status, 'update-available')
  assert.equal(result.items[0]?.via, 'site')
})

test('PluginUpdateService.check：关闭时返回空表', async () => {
  const svc = new PluginUpdateService({
    getConfig: () => ({ enabled: false, profile: 'web', sources: [siteSource] }),
    readInstalled: () => ({ version: '0.13.0' }),
  })
  const result = await svc.check()
  assert.equal(result.enabled, false)
  assert.equal(result.items.length, 0)
})

test('PluginUpdateService.apply：白名单外拒绝，白名单内走完下载与安装', async () => {
  await assert.rejects(service().apply('some-random-pkg'), /登记表/)
  const result = await service().apply('dsh-devforge')
  assert.equal(result.ok, true)
  assert.equal(result.version, '0.13.1')
  assert.equal(result.via, 'site')
  assert.equal(result.needRestart, true)
})

test('PluginUpdateService.apply：sha256 校验失败时拒绝安装', async () => {
  await assert.rejects(service({ hashFail: true }).apply('dsh-devforge'), /sha256/)
})

// ---------------------------------------------------------------------------
// 官网登录墙（0.35.0）：loginSite / parseSidFromSetCookie
// ---------------------------------------------------------------------------

/** 构造最小 Response 替身（loginSite 只消费 status/ok/headers.getSetCookie）。 */
function siteResponse(status: number, setCookie?: string[]): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { getSetCookie: () => setCookie ?? [] },
  } as unknown as Response
}

test('parseSidFromSetCookie：数组条目里取第一个 sid；无 sid 返回空串', () => {
  assert.equal(parseSidFromSetCookie(['sid=abc; Path=/; HttpOnly', 'other=x']), 'sid=abc')
  assert.equal(parseSidFromSetCookie(['theme=dark', 'sid=xyz; Path=/']), 'sid=xyz')
  assert.equal(parseSidFromSetCookie(['session=not-a-sid']), '')
  assert.equal(parseSidFromSetCookie([]), '')
})

test('loginSite：成功解析 sid；默认官网地址 + JSON 凭据 body', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const sid = await loginSite({ apiUrl: '', username: 'u1', password: 'p1' }, {
    fetchImpl: (async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init })
      return siteResponse(200, ['sid=abc123; Path=/; HttpOnly'])
    }) as typeof fetch,
  })
  assert.equal(sid, 'sid=abc123')
  assert.equal(calls[0]?.url, PLUGIN_UPDATE_DEFAULT_SITE_API + '/api/auth/login')
  assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), { username: 'u1', password: 'p1' })
})

test('loginSite：自定义 apiUrl 去尾斜杠；401 → 中文报错', async () => {
  const calls: Array<{ url: string }> = []
  await assert.rejects(
    loginSite({ apiUrl: 'https://mod.example.com/', username: 'u1', password: 'bad' }, {
      fetchImpl: (async (url: string | URL) => {
        calls.push({ url: String(url) })
        return siteResponse(401)
      }) as typeof fetch,
    }),
    /官网账号或密码错误/,
  )
  assert.equal(calls[0]?.url, 'https://mod.example.com/api/auth/login')
})

test('loginSite：网络错误 → 带原始信息的中文报错', async () => {
  await assert.rejects(
    loginSite({ apiUrl: 'https://modagentai.com', username: 'u1', password: 'p1' }, {
      fetchImpl: (async () => { throw new Error('ECONNREFUSED') }) as typeof fetch,
    }),
    /官网登录请求失败.*ECONNREFUSED/s,
  )
})

test('loginSite：200 但缺会话 Cookie → 明确报错', async () => {
  await assert.rejects(
    loginSite({ apiUrl: 'https://modagentai.com', username: 'u1', password: 'p1' }, {
      fetchImpl: (async () => siteResponse(200, [])) as typeof fetch,
    }),
    /会话 Cookie/,
  )
})

// ---------------------------------------------------------------------------
// 下载与渠道：downloadTgz headers 透传 / resolveLatest 无 GitHub 兜底
// ---------------------------------------------------------------------------

test('downloadTgz：headers 透传（登录墙 Cookie 通道）；401 明确报错', async () => {
  const original = globalThis.fetch
  const calls: Array<{ url: string; init?: RequestInit }> = []
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init })
    return new Response('tgz-bytes', { status: 200 })
  }) as typeof fetch
  try {
    const target = await downloadTgz('https://modagentai.com/downloads/x.tgz', 'dsh-devforge', '0.13.1', { headers: { cookie: 'sid=abc' } })
    assert.equal(calls.length, 1)
    assert.equal(calls[0]?.url, 'https://modagentai.com/downloads/x.tgz')
    assert.deepEqual(calls[0]?.init?.headers, { cookie: 'sid=abc' })
    assert.ok(target.endsWith('dsh-devforge-0.13.1.tgz'))
    globalThis.fetch = (async () => new Response('no', { status: 401 })) as typeof fetch
    await assert.rejects(downloadTgz('https://modagentai.com/downloads/x.tgz', 'dsh-devforge', '0.13.1'), /HTTP 401/)
  } finally {
    globalThis.fetch = original
  }
})

test('downloadTgz：sha256 完整性校验（清单提供时强制）', async () => {
  const original = globalThis.fetch
  const content = 'tgz-bytes-for-hash'
  const good = sha256Hex(Buffer.from(content))
  globalThis.fetch = (async () => new Response(content, { status: 200 })) as typeof fetch
  try {
    await downloadTgz('https://modagentai.com/downloads/x.tgz', 'pkg', '1.0.0', { expectedSha256: good })
    await assert.rejects(downloadTgz('https://modagentai.com/downloads/x.tgz', 'pkg', '1.0.0', { expectedSha256: '0'.repeat(64) }), /sha256 校验失败/)
  } finally {
    globalThis.fetch = original
  }
})

test('resolveLatest：GitHub 兜底已移除——未登记清单地址直接报错', async () => {
  await assert.rejects(resolveLatest({ packageName: 'x' }), /GitHub 兜底渠道已移除/)
})

test('resolveLatest：官网清单失败直接抛错，不静默换渠道', async () => {
  const original = globalThis.fetch
  globalThis.fetch = (async () => new Response('boom', { status: 500 })) as typeof fetch
  try {
    await assert.rejects(resolveLatest(siteSource), /官网清单 HTTP 500/)
  } finally {
    globalThis.fetch = original
  }
})

// ---------------------------------------------------------------------------
// apply 与登录制联动：未配置账号 401 引导 / 已配置先登录换 Cookie
// ---------------------------------------------------------------------------

test('PluginUpdateService.apply：未配置官网账号且下载 401 → 面板配置引导文案', async () => {
  const svc = new PluginUpdateService({
    getConfig: () => ({ enabled: true, profile: 'web', sources: [siteSource] }),
    readInstalled: () => ({ version: '0.13.0' }),
    resolveLatestFn: async () => siteLatest('0.13.1'),
    download: async () => { throw new Error('下载失败 HTTP 401') },
    runAdd: async () => 'done',
  })
  await assert.rejects(svc.apply('dsh-devforge'), /官网下载已启用登录制：请到 天工造梦 → 插件更新 页签配置官网账号/)
})

test('PluginUpdateService.apply：未配置官网账号且下载 403 → 同样给出配置引导', async () => {
  const svc = new PluginUpdateService({
    getConfig: () => ({ enabled: true, profile: 'web', sources: [siteSource] }),
    readInstalled: () => ({ version: '0.13.0' }),
    resolveLatestFn: async () => siteLatest('0.13.1'),
    download: async () => { throw new Error('下载失败 HTTP 403') },
    runAdd: async () => 'done',
  })
  await assert.rejects(svc.apply('dsh-devforge'), /配置官网账号/)
})

test('PluginUpdateService.apply：已配置 site → 先登录换 sid，下载带 Cookie', async () => {
  let loginCalled = 0
  let seenHeaders: Record<string, string> | undefined
  const svc = new PluginUpdateService({
    getConfig: () => ({ enabled: true, profile: 'web', sources: [siteSource], site: { apiUrl: '', username: 'u1', password: 'p1' } }),
    readInstalled: () => ({ version: '0.13.0' }),
    resolveLatestFn: async () => siteLatest('0.13.1'),
    loginSite: async () => { loginCalled += 1; return 'sid=xyz' },
    download: async (_url, _name, _version, options) => { seenHeaders = options?.headers; return '/tmp/x.tgz' },
    runAdd: async () => 'done',
  })
  const result = await svc.apply('dsh-devforge')
  assert.equal(result.ok, true)
  assert.equal(loginCalled, 1)
  assert.equal(seenHeaders?.cookie, 'sid=xyz')
})

test('PluginUpdateService.apply：登录失败错误原样抛出（不静默降级为匿名下载）', async () => {
  const svc = new PluginUpdateService({
    getConfig: () => ({ enabled: true, profile: 'web', sources: [siteSource], site: { apiUrl: '', username: 'u1', password: 'wrong' } }),
    readInstalled: () => ({ version: '0.13.0' }),
    resolveLatestFn: async () => siteLatest('0.13.1'),
    loginSite: async () => { throw new Error('官网账号或密码错误') },
    download: async () => { throw new Error('不应走到下载') },
    runAdd: async () => 'done',
  })
  await assert.rejects(svc.apply('dsh-devforge'), /官网账号或密码错误/)
})

// ---------------------------------------------------------------------------
// 官网账号设置：applySitePatch 校验规则 / toSiteView 脱敏 / site 路由
// ---------------------------------------------------------------------------

test('applySitePatch：首设必须带合法用户名与 ≥8 位密码（中文报错）', () => {
  const empty: PluginUpdateSiteConfig = { apiUrl: '', username: '', password: '' }
  assert.throws(() => applySitePatch(empty, {}), /缺少用户名/)
  assert.throws(() => applySitePatch(empty, { username: 'user1' }), /首次设置必须填写密码/)
  assert.throws(() => applySitePatch(empty, { username: 'user1', password: 'short' }), /密码至少 8 位/)
  assert.throws(() => applySitePatch(empty, { username: 'ab!', password: 'longenough1' }), /用户名格式不正确/)
  assert.throws(() => applySitePatch(empty, { username: 'ok_name_01', password: 'x'.repeat(129) }), /密码过长/)
  const next = applySitePatch(empty, { username: 'ok_name_01', password: 'longenough1' })
  assert.deepEqual(next, { apiUrl: PLUGIN_UPDATE_DEFAULT_SITE_API, username: 'ok_name_01', password: 'longenough1' })
})

test('applySitePatch：空密码不覆盖已存密码；缺省字段保留；apiUrl 规则', () => {
  const existing: PluginUpdateSiteConfig = { apiUrl: 'https://mod.example.com/', username: 'user1', password: 'kept-pass-1' }
  // 只改用户名：密码必须原样保留。
  const kept = applySitePatch(existing, { username: 'user2' })
  assert.equal(kept.password, 'kept-pass-1')
  assert.equal(kept.username, 'user2')
  assert.equal(kept.apiUrl, 'https://mod.example.com')
  // password 空串 = 不修改。
  const touched = applySitePatch(existing, { username: 'user1', password: '' })
  assert.equal(touched.password, 'kept-pass-1')
  // apiUrl 空串 = 重置为默认官网；去尾斜杠；拒绝 http。
  assert.equal(applySitePatch(existing, { apiUrl: '' }).apiUrl, PLUGIN_UPDATE_DEFAULT_SITE_API)
  assert.equal(applySitePatch(existing, { apiUrl: 'https://a.example.com///' }).apiUrl, 'https://a.example.com')
  assert.throws(() => applySitePatch(existing, { apiUrl: 'http://insecure.example.com' }), /https:\/\//)
  // 首设场景下空密码报错（现有密码为空且未提供新密码）。
  assert.throws(() => applySitePatch({ apiUrl: '', username: 'user1', password: '' }, {}), /首次设置必须填写密码/)
})

test('toSiteView：脱敏视图不含明文密码；apiUrl 空归一默认', () => {
  const view = toSiteView({ apiUrl: '', username: 'u1', password: 'secret-pass-1' })
  assert.equal(view.apiUrl, PLUGIN_UPDATE_DEFAULT_SITE_API)
  assert.equal(view.username, 'u1')
  assert.equal(view.hasPassword, true)
  assert.equal(view.passwordMask, '••••••••')
  assert.ok(!('password' in view))
  assert.ok(!JSON.stringify(view).includes('secret-pass-1'))
  const unset = toSiteView({ apiUrl: PLUGIN_UPDATE_DEFAULT_SITE_API, username: 'u1', password: '' })
  assert.equal(unset.hasPassword, false)
  assert.equal(unset.passwordMask, '')
})

/** 构造 site 路由（真实 makeRoutes + 校验 stub），模拟 loopback 请求直调 handler。 */
async function callSiteRoute(method: 'GET' | 'PUT' | 'DELETE', body?: unknown, current?: PluginUpdateSiteConfig, remoteAddress = '127.0.0.1'): Promise<{ status: number; payload: Record<string, unknown> }> {
  const state: PluginUpdateSiteConfig = current ?? { apiUrl: '', username: '', password: '' }
  const pluginUpdateStub = {
    check: async () => ({ enabled: true, items: [] }),
    apply: async () => { throw new Error('unused') },
    harnessCheck: async () => { throw new Error('unused') },
    siteGet: () => toSiteView(state),
    sitePut: (patch: Parameters<typeof applySitePatch>[1]) => {
      const next = applySitePatch(state, patch)
      state.apiUrl = next.apiUrl
      state.username = next.username
      state.password = next.password
      return toSiteView(next)
    },
  }
  const routes = makeRoutes(
    {} as unknown as Parameters<typeof makeRoutes>[0],
    {} as unknown as Parameters<typeof makeRoutes>[1],
    {} as unknown as Parameters<typeof makeRoutes>[2],
    () => ({ enabled: false, text: '', diag: { loaderResolved: false, entryCount: 0, userCount: 0, error: '' } }),
    pluginUpdateStub as unknown as Parameters<typeof makeRoutes>[3],
  )
  const route = routes.find((item) => (item as { path?: string }).path === '/api/dsh-devforge/plugin-update/site')
  assert.ok(route, 'site 路由未注册')
  const req = {
    method,
    socket: { remoteAddress },
    headers: {},
    url: '/api/dsh-devforge/plugin-update/site',
    on(event: string, cb: (arg?: unknown) => void) {
      if (event === 'data' && body !== undefined) cb(Buffer.from(JSON.stringify(body)))
      if (event === 'end') cb()
    },
  } as unknown as import('node:http').IncomingMessage
  let status = 0
  let payload: Record<string, unknown> = {}
  const res = {
    writeHead(code: number) { status = code },
    end(raw: string) { payload = JSON.parse(raw) as Record<string, unknown> },
  } as unknown as import('node:http').ServerResponse
  await route.handler(req, res)
  return { status, payload }
}

test('site 路由：GET 返回脱敏视图（无密码字段；apiUrl 空时归一默认官网）', async () => {
  const { status, payload } = await callSiteRoute('GET')
  assert.equal(status, 200)
  assert.equal(payload.ok, true)
  const site = payload.site as Record<string, unknown>
  assert.equal(site.apiUrl, PLUGIN_UPDATE_DEFAULT_SITE_API)
  assert.equal(site.username, '')
  assert.equal(site.hasPassword, false)
  assert.ok(!('password' in site))
  assert.ok(!JSON.stringify(payload).includes('"password"'))
})

test('site 路由：PUT 合法保存 → 200 脱敏回包（hasPassword 布尔）', async () => {
  const { status, payload } = await callSiteRoute('PUT', { username: 'user1', password: 'longenough1' })
  assert.equal(status, 200)
  assert.equal(payload.ok, true)
  const site = payload.site as Record<string, unknown>
  assert.equal(site.username, 'user1')
  assert.equal(site.hasPassword, true)
  assert.ok(!('password' in site))
})

test('site 路由：PUT 非法用户名 / 首设缺密码 → 400 中文报错', async () => {
  const badName = await callSiteRoute('PUT', { username: 'ab!', password: 'longenough1' })
  assert.equal(badName.status, 400)
  assert.match(String(badName.payload.error), /用户名格式不正确/)
  const noPassword = await callSiteRoute('PUT', { username: 'user1' })
  assert.equal(noPassword.status, 400)
  assert.match(String(noPassword.payload.error), /首次设置必须填写密码/)
})

test('site 路由：PUT 空密码不覆盖已存密码（二次保存仅改用户名）', async () => {
  const state: PluginUpdateSiteConfig = { apiUrl: '', username: '', password: '' }
  await callSiteRoute('PUT', { username: 'user1', password: 'longenough1' }, state)
  const second = await callSiteRoute('PUT', { username: 'user2' }, state)
  assert.equal(second.status, 200)
  const site = second.payload.site as Record<string, unknown>
  assert.equal(site.username, 'user2')
  assert.equal(site.hasPassword, true)
})

test('site 路由：非 loopback 来源 403；不支持的方法 405', async () => {
  const remote = await callSiteRoute('GET', undefined, undefined, '10.0.0.8')
  assert.equal(remote.status, 403)
  const wrongMethod = await callSiteRoute('DELETE')
  assert.equal(wrongMethod.status, 405)
})
