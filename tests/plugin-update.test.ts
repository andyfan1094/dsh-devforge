/** 插件更新能力单测：官网登录（sid 解析）、semver 比较、官网清单解析、sha256、检查编排、白名单升级、官网账号设置校验与 site 路由。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DEFAULT_PROFILE,
  PLUGIN_UPDATE_DEFAULT_SITE_API,
  PluginUpdateService,
  applySitePatch,
  buildDshPluginAddCommand,
  buildGatedDownloadUrl,
  checkOne,
  compareSemver,
  decodeExitCode,
  decodeProcessOutput,
  downloadTgz,
  fetchDownloadTicket,
  loginSite,
  normalizeAllowBuildsPlaceholders,
  normalizeSessionToken,
  parseSidFromSetCookie,
  parseSiteIndex,
  prepareProfileForUpdate,
  prunePluginCache,
  repairDanglingTempDependencies,
  resolveActiveProfile,
  resolveDesktopCliEntry,
  resolveDshHome,
  resolveLatest,
  resolvePluginCacheDir,
  sameOrigin,
  sha256Hex,
  siteApiRoot,
  summarizePluginAddFailure,
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
  assert.deepEqual(command.args, ['/d', '/s', '/c', '"chcp 65001>nul & dsh plugin --profile web add "C:\\Temp dir\\x.tgz""'])
  assert.equal(command.verbatim, true)
})

test('buildDshPluginAddCommand：Windows 对 cmd 元字符统一加引号', () => {
  const command = buildDshPluginAddCommand('win32', 'web profile', 'C:\\Temp (safe)&drop\\x.tgz', { comSpec: 'cmd.exe' })
  assert.deepEqual(command.args, ['/d', '/s', '/c', '"chcp 65001>nul & dsh plugin --profile "web profile" add "C:\\Temp (safe)&drop\\x.tgz""'])
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

// ---------------------------------------------------------------------------
// 桌面安装包（0.41.20）：一键升级不再依赖 PATH —— 直启包内官方 CLI，GBK 报错解回中文
// ---------------------------------------------------------------------------

/** 构造桌面安装包目录：<根>/resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib。 */
function makeDesktopLayout(): { root: string; exe: string; cli: string; hostEntry: string } {
  const root = mkdtempSync(join(tmpdir(), 'dsh-desktop-layout-test-'))
  const hostLib = join(root, 'resources', 'app.asar', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-desktop-host', 'lib')
  mkdirSync(hostLib, { recursive: true })
  const cli = join(hostLib, 'cli.js')
  writeFileSync(cli, '// fake desktop cli')
  const hostEntry = join(hostLib, 'index.js')
  writeFileSync(hostEntry, '// fake desktop host')
  return { root, exe: join(root, 'DeepSeek Harness.exe'), cli, hostEntry }
}

test('buildDshPluginAddCommand：桌面安装包直启包内 CLI（与官方 dsh.cmd 同形态，不依赖 PATH）', () => {
  const layout = makeDesktopLayout()
  try {
    // 真机形态：桌面宿主进程的 argv[1] 是 GUI 主进程 dsh-desktop-host/lib/index.js。
    const command = buildDshPluginAddCommand('win32', 'desktop', 'C:\\Temp\\dsh-devforge-0.41.20.tgz', {
      entryPath: layout.hostEntry,
      nodePath: layout.exe,
    })
    assert.equal(command.file, layout.exe)
    assert.deepEqual(command.args, ['--expose-internals', layout.cli, 'plugin', '--profile', 'desktop', 'add', 'C:\\Temp\\dsh-devforge-0.41.20.tgz'])
    assert.equal(command.verbatim, false)
    assert.deepEqual(command.env, { ELECTRON_RUN_AS_NODE: '1' })
  } finally {
    rmSync(layout.root, { recursive: true, force: true })
  }
})

test('buildDshPluginAddCommand：宿主入口不像 CLI 时按安装根推导内置 CLI', () => {
  const layout = makeDesktopLayout()
  try {
    const command = buildDshPluginAddCommand('win32', 'desktop', 'C:\\Temp\\x.tgz', {
      entryPath: 'C:\\somewhere\\else\\main.js',
      nodePath: layout.exe,
    })
    assert.equal(command.file, layout.exe)
    assert.deepEqual(command.args, ['--expose-internals', layout.cli, 'plugin', '--profile', 'desktop', 'add', 'C:\\Temp\\x.tgz'])
    assert.deepEqual(command.env, { ELECTRON_RUN_AS_NODE: '1' })
  } finally {
    rmSync(layout.root, { recursive: true, force: true })
  }
})

test('resolveDesktopCliEntry：桌面布局命中；npm 全局布局返回 undefined（回落原有路径）', () => {
  const layout = makeDesktopLayout()
  try {
    assert.equal(resolveDesktopCliEntry(layout.exe, layout.hostEntry), layout.cli)
    assert.equal(resolveDesktopCliEntry(layout.exe, ''), layout.cli)
    assert.equal(resolveDesktopCliEntry('C:\\Program Files\\nodejs\\node.exe', 'C:\\Program Files\\nodejs\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js'), undefined)
    assert.equal(resolveDesktopCliEntry('', ''), undefined)
  } finally {
    rmSync(layout.root, { recursive: true, force: true })
  }
})

test('decodeProcessOutput：UTF-8 原样；中文 Windows 的 GBK 报错重解码为可读中文', () => {
  assert.equal(decodeProcessOutput(Buffer.from('安装成功', 'utf8')), '安装成功')
  assert.equal(decodeProcessOutput('已经是字符串'), '已经是字符串')
  assert.equal(decodeProcessOutput(undefined), '')
  // 0xB2 0xBB 是「不」的 GBK 字节：按 UTF-8 解会出现替换字符 U+FFFD。
  const gbk = Buffer.concat([Buffer.from("'dsh' ", 'utf8'), Buffer.from([0xb2, 0xbb])])
  let supportsGbk = true
  try {
    new TextDecoder('gbk')
  } catch {
    supportsGbk = false
  }
  if (supportsGbk) assert.equal(decodeProcessOutput(gbk), "'dsh' 不")
  else assert.ok(decodeProcessOutput(gbk).includes('\uFFFD'))
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

test('parseSiteIndex：相对路径按清单地址补全，notes/date 透出（0.40.1 修复「官网清单结构不合法」）', () => {
  const parsed = parseSiteIndex({
    latest: '0.40.0',
    latestUrl: '/downloads/dsh-devforge-latest.tgz',
    updated: '2026-09-24',
    versions: [{ version: '0.40.0', date: '2026-09-24', url: '/downloads/dsh-devforge-0.40.0.tgz', sha256: 'aa11', notes: '本次更新内容说明' }],
  }, 'https://modagentai.com/downloads/index.json')
  assert.ok(parsed)
  assert.equal(parsed?.latest, '0.40.0')
  // latestUrl 优先取与 latest 匹配的版本条目地址（版本化 tgz 可校验 sha256），而非可变的 latest 指针。
  assert.equal(parsed?.latestUrl, 'https://modagentai.com/downloads/dsh-devforge-0.40.0.tgz')
  assert.equal(parsed?.versions[0]?.url, 'https://modagentai.com/downloads/dsh-devforge-0.40.0.tgz')
  assert.equal(parsed?.versions[0]?.notes, '本次更新内容说明')
  assert.equal(parsed?.versions[0]?.date, '2026-09-24')
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

/**
 * 0.50.1 隔离桩：真实的 profile 探测/现场修复/旧包清理都会读写本机 `~/.dsh/profiles/<name>`，
 * 单测里必须换成不落盘的假实现，否则跑测试会改动辉哥真实安装的 profile。
 */
const profileStub = {
  resolveProfile: (configured: string) => ({
    name: configured !== '' ? configured : 'web',
    dir: join(tmpdir(), 'fake-profile'),
    via: 'config' as const,
    note: '测试固定',
  }),
  prepareProfile: async (): Promise<string[]> => [],
  pruneCache: async (): Promise<string[]> => [],
  resolveCacheDir: (): string => join(tmpdir(), 'fake-cache'),
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
    // 0.41.11 起下载必须走 /dl/ 鉴权通道：装置补齐登录态与换票，断言下载地址已映射到 /dl/。
    sessionToken: async () => 'sess-token-1',
    fetchTicket: async () => 'ticket-1',
    download: async (url, name, version, options) => {
      assert.ok(url.startsWith('https://modagentai.com/dl/'), '下载地址必须走 /dl/ 鉴权通道，不得直连 /downloads/')
      assert.ok(url.includes('token=ticket-1'))
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
    // 0.50.1：profile 探测与「升级前现场修复/旧包清理」全部注入假实现，绝不碰本机真实 profile。
    ...profileStub,
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

test('PluginUpdateService.apply：面板登录态换票后走 /dl/ 带票下载（未配 site 账号也可升级）', async () => {
  let seenUrl = ''
  let seenTicketArgs = ''
  const svc = new PluginUpdateService({
    getConfig: () => ({ enabled: true, profile: 'web', sources: [siteSource] }),
    readInstalled: () => ({ version: '0.13.0' }),
    resolveLatestFn: async () => siteLatest('0.13.1'),
    download: async (url, _name, version) => {
      seenUrl = url
      return '/tmp/dsh-devforge-' + version + '.tgz'
    },
    runAdd: async () => 'done',
    sessionToken: async () => 'sess-token-1',
    fetchTicket: async (apiUrl, sessionToken) => {
      seenTicketArgs = apiUrl + '|' + sessionToken
      return 'ticket-9'
    },
    ...profileStub,
  })
  const result = await svc.apply('dsh-devforge')
  assert.equal(result.ok, true)
  assert.equal(seenTicketArgs, 'https://modagentai.com|sess-token-1')
  assert.equal(seenUrl, 'https://modagentai.com/dl/dsh-devforge-0.13.1.tgz?token=ticket-9')
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

test('downloadTgz：按传入地址下载且 headers 透传；401 明确报错', async () => {
  const original = globalThis.fetch
  const calls: Array<{ url: string; init?: RequestInit }> = []
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init })
    return new Response('tgz-bytes', { status: 200 })
  }) as typeof fetch
  // 0.50.1：落点可注入；测试必须给临时目录，不能污染真实的 ~/.dsh/cache/plugins。
  const cacheDir = mkdtempSync(join(tmpdir(), 'dsh-pu-cache-'))
  try {
    const gated = buildGatedDownloadUrl('https://modagentai.com/downloads/dsh-devforge-0.13.1.tgz', 'tk', PLUGIN_UPDATE_DEFAULT_SITE_API)
    const target = await downloadTgz(gated, 'dsh-devforge', '0.13.1', { headers: { 'x-trace': '1' }, targetDir: cacheDir })
    assert.equal(calls.length, 1)
    assert.equal(calls[0]?.url, 'https://modagentai.com/dl/dsh-devforge-0.13.1.tgz?token=tk')
    assert.deepEqual(calls[0]?.init?.headers, { 'x-trace': '1' })
    assert.equal(target, join(cacheDir, 'dsh-devforge-0.13.1.tgz'), '下载包必须落在注入的持久目录')
    assert.equal(existsSync(target), true)
    globalThis.fetch = (async () => new Response('no', { status: 401 })) as typeof fetch
    await assert.rejects(downloadTgz(gated, 'dsh-devforge', '0.13.1', { targetDir: cacheDir }), /HTTP 401/)
  } finally {
    globalThis.fetch = original
    rmSync(cacheDir, { recursive: true, force: true })
  }
})

test('downloadTgz：sha256 完整性校验（清单提供时强制）', async () => {
  const original = globalThis.fetch
  const content = 'tgz-bytes-for-hash'
  const good = sha256Hex(Buffer.from(content))
  globalThis.fetch = (async () => new Response(content, { status: 200 })) as typeof fetch
  const cacheDir = mkdtempSync(join(tmpdir(), 'dsh-pu-cache-'))
  try {
    await downloadTgz('https://modagentai.com/downloads/x.tgz', 'pkg', '1.0.0', { expectedSha256: good, targetDir: cacheDir })
    await assert.rejects(downloadTgz('https://modagentai.com/downloads/x.tgz', 'pkg', '1.0.0', { expectedSha256: '0'.repeat(64), targetDir: cacheDir }), /sha256 校验失败/)
  } finally {
    globalThis.fetch = original
    rmSync(cacheDir, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// 0.50.1 修复回归：tgz 持久落点 / profile 自动探测 / 连续两次升级 / 错误透传
// ---------------------------------------------------------------------------

test('resolveDshHome / resolvePluginCacheDir：优先 DSH_HOME，绝不落到系统临时目录', () => {
  assert.equal(resolveDshHome({ DSH_HOME: 'D:\\dsh-home' } as NodeJS.ProcessEnv), 'D:\\dsh-home')
  const home = resolveDshHome({} as NodeJS.ProcessEnv)
  assert.ok(home.endsWith('.dsh'), '缺省必须是 ~/.dsh')
  const cache = resolvePluginCacheDir({ DSH_HOME: 'D:\\dsh-home' } as NodeJS.ProcessEnv)
  assert.equal(cache, join('D:\\dsh-home', 'cache', 'plugins'))
  assert.equal(cache.toLowerCase().includes(tmpdir().toLowerCase()), false, '缓存目录不得位于系统临时目录下')
})

test('resolveActiveProfile：显式配置 > 环境变量 > 命令行 > 依赖反查 > 兜底', () => {
  const home = join(tmpdir(), 'dsh-home-fixed')
  const profilesRoot = join(home, 'profiles')
  // 1) 显式配置最高优先
  const byConfig = resolveActiveProfile({ configured: 'desktop', env: { DSH_HOME: home, DSH_PROFILE: 'web' } as NodeJS.ProcessEnv, dshHome: home })
  assert.equal(byConfig.name, 'desktop')
  assert.equal(byConfig.via, 'config')

  // 2) 环境变量（桌面/CLI 每次启动都会带）
  const byEnv = resolveActiveProfile({ configured: '', env: { DSH_HOME: home, DSH_PROFILE: 'desktop' } as NodeJS.ProcessEnv, dshHome: home, argv: ['node', 'cli.js'] })
  assert.equal(byEnv.name, 'desktop')
  assert.equal(byEnv.via, 'env')
  assert.equal(byEnv.dir, join(profilesRoot, 'desktop'))

  // 2b) 只有 DSH_PROFILE_DIR 时也能认出来
  const byDir = resolveActiveProfile({ configured: '', env: { DSH_PROFILE_DIR: join(profilesRoot, 'desktop') } as NodeJS.ProcessEnv, dshHome: home, argv: ['node'] })
  assert.equal(byDir.name, 'desktop')

  // 3) 命令行：桌面版实测 argv[2] 就是 profile 目录；也支持 --profile 形式
  const byArgvDir = resolveActiveProfile({ configured: '', env: {} as NodeJS.ProcessEnv, dshHome: home, argv: ['electron.exe', 'resources\\app.asar\\dsh\\cli.js', join(profilesRoot, 'desktop')] })
  assert.equal(byArgvDir.name, 'desktop')
  assert.equal(byArgvDir.via, 'argv')
  const byProfileFlag = resolveActiveProfile({ configured: '', env: {} as NodeJS.ProcessEnv, dshHome: home, argv: ['node', 'cli.js', '--profile', 'desktop'] })
  assert.equal(byProfileFlag.name, 'desktop')
  // 裸单词不算 profile（argv 里到处是 node、cli.js 这类词）
  const notFooled = resolveActiveProfile({ configured: '', env: {} as NodeJS.ProcessEnv, dshHome: home, argv: ['node', 'cli.js'] })
  assert.equal(notFooled.via, 'default')
  assert.equal(notFooled.name, DEFAULT_PROFILE)

  // 4) 依赖反查：profile 的 dependencies 指向当前运行的插件代码
  const root = mkdtempSync(join(tmpdir(), 'dsh-home-'))
  try {
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'dsh-devforge' }))
    mkdirSync(join(root, 'lib'), { recursive: true })
    writeFileSync(join(root, 'lib', 'index.js'), '')
    mkdirSync(join(root, 'profiles', 'desktop'), { recursive: true })
    writeFileSync(join(root, 'profiles', 'desktop', 'package.json'), JSON.stringify({ dependencies: { 'dsh-devforge': 'link:' + root } }))
    const byPackage = resolveActiveProfile({ configured: '', env: {} as NodeJS.ProcessEnv, dshHome: root, argv: ['node'], moduleUrl: 'file:///' + join(root, 'lib', 'index.js').replace(/\\/g, '/') })
    assert.equal(byPackage.name, 'desktop')
    assert.equal(byPackage.via, 'package')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('resolveActiveProfile：拒绝非法 profile 名（防路径穿越与 cmd 变量展开）', () => {
  const home = join(tmpdir(), 'dsh-home-fixed')
  const evil = resolveActiveProfile({ configured: '../evil&calc', env: {} as NodeJS.ProcessEnv, dshHome: home, argv: ['node'] })
  assert.equal(evil.via, 'default', '非法名字必须被忽略并回到兜底')
  assert.equal(evil.name, DEFAULT_PROFILE)
})

/**
 * 模拟 pnpm add 的真实行为：安装前先校验已有的 `file:` 依赖是否还在。
 * 这正是 0.49.3 事故的机制——旧 tgz 被系统清理后，后续每次 add 都先撞 ENOENT。
 */
function fakePnpmAdd(profileDir: string, tgzPath: string): string {
  const pkgPath = join(profileDir, 'package.json')
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { dependencies?: Record<string, string> }
  for (const spec of Object.values(pkg.dependencies ?? {})) {
    if (!/^file:/i.test(spec)) continue
    const target = spec.slice('file:'.length)
    if (!existsSync(target)) {
      throw new Error('dsh plugin add 失败：退出码 4294963238（即 -4058） · ENOENT 文件或目录不存在\n关键输出：\n  ENOENT: no such file or directory, open \'' + target + '\'')
    }
  }
  pkg.dependencies = { ...(pkg.dependencies ?? {}), 'dsh-devforge': 'file:' + tgzPath }
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
  return 'added dsh-devforge'
}

test('连续两次升级：包落在持久缓存，清空 %TEMP% 后第二次升级仍然成功', async () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-home-'))
  const profileDir = join(home, 'profiles', 'desktop')
  const cacheDir = join(home, 'cache', 'plugins')
  mkdirSync(profileDir, { recursive: true })
  writeFileSync(join(profileDir, 'package.json'), JSON.stringify({ name: 'desktop-profile', dependencies: {} }, null, 2) + '\n')

  let latestVersion = '0.50.0'
  const svc = new PluginUpdateService({
    // 生产默认值就是空串 = 自动探测；这里显式给 DSH_PROFILE 模拟桌面宿主环境。
    getConfig: () => ({ enabled: true, profile: '', sources: [siteSource] }),
    readInstalled: () => ({ version: '0.49.3' }),
    resolveLatestFn: async () => siteLatest(latestVersion),
    resolveProfile: (configured) => resolveActiveProfile({ configured, env: { DSH_HOME: home, DSH_PROFILE: 'desktop' } as NodeJS.ProcessEnv, dshHome: home }),
    sessionToken: async () => 'sess-token-1',
    fetchTicket: async () => 'ticket-1',
    // 真实下载器按注入的 targetDir 落盘；这里复刻同样的落点规则。
    download: async (_url, name, version, options) => {
      const dir = options?.targetDir ?? ''
      assert.equal(dir, cacheDir, 'apply 必须把持久缓存目录传给下载器')
      mkdirSync(dir, { recursive: true })
      const target = join(dir, name + '-' + version + '.tgz')
      writeFileSync(target, 'bytes-' + version)
      return target
    },
    runAdd: async (profile, tgzPath) => {
      assert.equal(profile, 'desktop', '必须写进桌面实际加载的 profile，而不是固定 web')
      return fakePnpmAdd(profileDir, tgzPath)
    },
    prepareProfile: (target, name, dir) => prepareProfileForUpdate(target, name, dir),
    pruneCache: prunePluginCache,
    resolveCacheDir: () => cacheDir,
  })

  const first = await svc.apply('dsh-devforge')
  assert.equal(first.profile, 'desktop')
  assert.equal(first.profileVia, 'env')
  const firstDep = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8') as string).dependencies['dsh-devforge'] as string
  assert.equal(firstDep, 'file:' + join(cacheDir, 'dsh-devforge-0.50.0.tgz'))
  // 落点必须是「apply 指定的持久缓存目录」，而不是旧实现那种临时下载路径
  // （默认落点不得在系统临时目录，这条策略由 resolvePluginCacheDir 用例单独覆盖）。
  assert.equal(existsSync(join(cacheDir, 'dsh-devforge-0.50.0.tgz')), true)

  // 模拟系统清理 %TEMP%：旧实现这里会把第一次的 tgz 删掉，导致第二次 add 必然 ENOENT。
  // 清空的是一个独立临时目录；持久缓存里的包必须活下来。
  const doomedTemp = mkdtempSync(join(tmpdir(), 'dsh-doomed-temp-'))
  writeFileSync(join(doomedTemp, 'dsh-devforge-0.50.0.tgz'), 'stale')
  rmSync(doomedTemp, { recursive: true, force: true })

  latestVersion = '0.50.1'
  const second = await svc.apply('dsh-devforge')
  assert.equal(second.version, '0.50.1')
  const secondDep = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8') as string).dependencies['dsh-devforge'] as string
  assert.equal(secondDep, 'file:' + join(cacheDir, 'dsh-devforge-0.50.1.tgz'))
  assert.equal(existsSync(join(cacheDir, 'dsh-devforge-0.50.1.tgz')), true)
  // 旧版本包已无任何 profile 引用 → 清理掉，避免缓存无限膨胀。
  assert.equal(existsSync(join(cacheDir, 'dsh-devforge-0.50.0.tgz')), false)

  rmSync(home, { recursive: true, force: true })
})

test('repairDanglingTempDependencies：清理指向已消失临时包的悬空依赖', async () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-home-'))
  const profileDir = join(home, 'profiles', 'web')
  const cacheDir = join(home, 'cache', 'plugins')
  mkdirSync(profileDir, { recursive: true })
  mkdirSync(cacheDir, { recursive: true })
  const staleTemp = join(home, 'temp', 'dsh-devforge-0.49.3.tgz')
  writeFileSync(join(profileDir, 'package.json'), JSON.stringify({
    dependencies: {
      'dsh-devforge': 'file:' + staleTemp,
      'other-plugin': 'file:' + join(home, 'temp', 'other-plugin-1.0.0.tgz'),
    },
  }, null, 2) + '\n')

  const notices = await repairDanglingTempDependencies(profileDir, 'dsh-devforge', { cacheDir })
  const deps = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8') as string).dependencies as Record<string, string>
  assert.equal('dsh-devforge' in deps, false, '本次要升级的包：移除条目，随后 add 会写入新路径')
  assert.equal('other-plugin' in deps, false, '缓存里没有该包且目标不存在：移除并如实提示')
  assert.equal(notices.length, 2)
  assert.ok(notices.some((line) => line.includes('已移除悬空依赖 dsh-devforge')))
  rmSync(home, { recursive: true, force: true })
})

test('repairDanglingTempDependencies：缓存里有同名包时改指持久路径；健康依赖不动', async () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-home-'))
  const profileDir = join(home, 'profiles', 'web')
  const cacheDir = join(home, 'cache', 'plugins')
  mkdirSync(profileDir, { recursive: true })
  mkdirSync(cacheDir, { recursive: true })
  const healthy = join(home, 'src', 'local-plugin')
  mkdirSync(healthy, { recursive: true })
  const cached = join(cacheDir, 'other-plugin-1.2.0.tgz')
  writeFileSync(cached, 'bytes')
  writeFileSync(join(profileDir, 'package.json'), JSON.stringify({
    dependencies: {
      'other-plugin': 'file:' + join(home, 'temp', 'other-plugin-1.0.0.tgz'),
      'local-plugin': 'link:' + healthy,
    },
  }, null, 2) + '\n')

  const notices = await repairDanglingTempDependencies(profileDir, 'dsh-devforge', { cacheDir })
  const deps = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8') as string).dependencies as Record<string, string>
  assert.equal(deps['other-plugin'], 'file:' + cached)
  assert.equal(deps['local-plugin'], 'link:' + healthy, '指向存在的本地开发目录不得改动')
  assert.ok(notices.some((line) => line.includes('已改指')))
  rmSync(home, { recursive: true, force: true })
})

test('normalizeAllowBuildsPlaceholders：把 pnpm 占位串改成布尔值，保留缩进与其余配置', async () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-home-'))
  const profileDir = join(home, 'profiles', 'web')
  mkdirSync(profileDir, { recursive: true })
  writeFileSync(join(profileDir, 'pnpm-workspace.yaml'), [
    'allowBuilds:',
    '    esbuild: set this to true or false',
    '    sharp: true',
    '',
    'overrides:',
    '  foo: link:../foo',
    '',
  ].join('\n'))
  const changed = await normalizeAllowBuildsPlaceholders(profileDir)
  assert.deepEqual(changed, ['esbuild'])
  const text = readFileSync(join(profileDir, 'pnpm-workspace.yaml'), 'utf8')
  assert.ok(text.includes('    esbuild: false'))
  assert.ok(text.includes('    sharp: true'), '已是布尔值的行不得改动')
  assert.ok(text.includes('  foo: link:../foo'))
  // 幂等：再跑一次不应报告改动。
  assert.deepEqual(await normalizeAllowBuildsPlaceholders(profileDir), [])
  rmSync(home, { recursive: true, force: true })
})

test('prunePluginCache：只删同包名旧版本，被任何 profile 引用的包一律保留', async () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-home-'))
  const cacheDir = join(home, 'cache', 'plugins')
  const profilesRoot = join(home, 'profiles')
  mkdirSync(cacheDir, { recursive: true })
  mkdirSync(join(profilesRoot, 'web'), { recursive: true })
  const keep = join(cacheDir, 'dsh-devforge-0.50.1.tgz')
  const stale = join(cacheDir, 'dsh-devforge-0.50.0.tgz')
  const referenced = join(cacheDir, 'dsh-devforge-0.49.6.tgz')
  const foreign = join(cacheDir, 'someone-else-1.0.0.tgz')
  for (const file of [keep, stale, referenced, foreign]) writeFileSync(file, 'x')
  // 老 profile 仍引用 0.49.6：删了就会重演悬空依赖事故。
  writeFileSync(join(profilesRoot, 'web', 'package.json'), JSON.stringify({ dependencies: { 'dsh-devforge': 'file:' + referenced } }))

  const removed = await prunePluginCache(keep, { cacheDir, profilesRoot, packageName: 'dsh-devforge' })
  assert.deepEqual(removed, ['dsh-devforge-0.50.0.tgz'])
  assert.equal(existsSync(keep), true)
  assert.equal(existsSync(referenced), true, '仍被 profile 引用的包绝不能删')
  assert.equal(existsSync(foreign), true, '其他包的缓存不受影响')
  rmSync(home, { recursive: true, force: true })
})

test('decodeExitCode / summarizePluginAddFailure：还原无符号退出码并透出 pnpm 真实原因', () => {
  const info = decodeExitCode(4294963238)
  assert.equal(info.signed, -4058)
  assert.ok(info.meaning.includes('ENOENT'))
  assert.equal(decodeExitCode(1).signed, 1)
  assert.equal(decodeExitCode(null).signed, null)

  const text = summarizePluginAddFailure({
    command: 'node cli.js plugin --profile desktop add C:\\x.tgz',
    exitCode: 4294963238,
    stdout: '',
    stderr: ' ERR_PNPM_IGNORED_BUILDS  Ignored build scripts: esbuild\n ENOENT: no such file or directory, open C:\\Temp\\dsh-devforge-0.49.3.tgz',
  })
  assert.ok(text.includes('4294963238'), '保留原始退出码便于对照日志')
  assert.ok(text.includes('-4058'), '还原成有符号退出码')
  assert.ok(text.includes('ENOENT'), '透出 pnpm 真实原因')
  assert.ok(text.includes('ERR_PNPM_IGNORED_BUILDS'))
  assert.ok(text.includes('对策：'), '已知故障要给出可执行对策')
  // 完全没有输出时也要给出可诊断指引，而不是空白。
  assert.ok(summarizePluginAddFailure({ exitCode: 1 }).includes('手动执行'))
})

test('buildGatedDownloadUrl：清单的 /downloads/ 地址映射到 /dl/ 带票通道（本次 404 回归的修法）', () => {
  assert.equal(
    buildGatedDownloadUrl('https://modagentai.com/downloads/dsh-devforge-0.41.10.tgz', 'tk', 'https://modagentai.com'),
    'https://modagentai.com/dl/dsh-devforge-0.41.10.tgz?token=tk',
  )
  // 清单若本来就是 /dl/ 形态，同样重建并补票（旧票不叠加）
  assert.equal(
    buildGatedDownloadUrl('https://modagentai.com/dl/dsh-devforge-0.41.10.tgz?token=old', 'tk', 'https://modagentai.com'),
    'https://modagentai.com/dl/dsh-devforge-0.41.10.tgz?token=tk',
  )
  // 非同源地址原样返回：保留将来接入其他发布渠道的能力
  assert.equal(buildGatedDownloadUrl('https://cdn.example.com/x.tgz', 'tk', 'https://modagentai.com'), 'https://cdn.example.com/x.tgz')
  // 目录地址（无文件名）不猜，原样返回
  assert.equal(buildGatedDownloadUrl('https://modagentai.com/downloads/', 'tk', 'https://modagentai.com'), 'https://modagentai.com/downloads/')
})

test('normalizeSessionToken：Cookie 形态取裸令牌，裸令牌原样返回', () => {
  assert.equal(normalizeSessionToken('sid=xyz'), 'xyz')
  assert.equal(normalizeSessionToken('sid=xyz; Path=/'), 'xyz')
  assert.equal(normalizeSessionToken('  bare-token-1  '), 'bare-token-1')
  assert.equal(normalizeSessionToken('other=1; sid=tk; a=b'), 'tk')
  assert.equal(normalizeSessionToken(''), '')
})

test('siteApiRoot / sameOrigin：缺省官网根地址、去尾斜杠、同源判定', () => {
  assert.equal(siteApiRoot(), 'https://modagentai.com')
  assert.equal(siteApiRoot({ apiUrl: '', username: '', password: '' }), 'https://modagentai.com')
  assert.equal(siteApiRoot({ apiUrl: 'https://mod.example.com///', username: '', password: '' }), 'https://mod.example.com')
  assert.equal(sameOrigin('https://modagentai.com/downloads/x.tgz', 'https://modagentai.com'), true)
  assert.equal(sameOrigin('https://cdn.example.com/x.tgz', 'https://modagentai.com'), false)
  assert.equal(sameOrigin('not-a-url', 'https://modagentai.com'), false)
})

test('fetchDownloadTicket：POST /api/download-token 用 Bearer 换票；401 转登录引导', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const fakeFetch = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init })
    return new Response(JSON.stringify({ ok: true, token: 'tk-1' }), { status: 200 })
  }) as typeof fetch
  const ticket = await fetchDownloadTicket('https://modagentai.com', 'sid=abc', { fetchImpl: fakeFetch })
  assert.equal(ticket, 'tk-1')
  assert.equal(calls[0]?.url, 'https://modagentai.com/api/download-token')
  assert.equal(calls[0]?.init?.method, 'POST')
  assert.equal((calls[0]?.init?.headers as Record<string, string> | undefined)?.authorization, 'Bearer abc')

  const unauthorized = (async () => new Response('{}', { status: 401 })) as typeof fetch
  await assert.rejects(fetchDownloadTicket('https://modagentai.com', 'abc', { fetchImpl: unauthorized }), /个人中心/)

  const noToken = (async () => new Response(JSON.stringify({ ok: true }), { status: 200 })) as typeof fetch
  await assert.rejects(fetchDownloadTicket('https://modagentai.com', 'abc', { fetchImpl: noToken }), /未返回下载票/)

  await assert.rejects(fetchDownloadTicket('https://modagentai.com', '   ', { fetchImpl: fakeFetch }), /令牌为空/)
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

test('PluginUpdateService.apply：无官网登录态 → 直接给个人中心登录引导，且不发下载请求', async () => {
  let downloadCalled = 0
  const svc = new PluginUpdateService({
    getConfig: () => ({ enabled: true, profile: 'web', sources: [siteSource] }),
    readInstalled: () => ({ version: '0.13.0' }),
    resolveLatestFn: async () => siteLatest('0.13.1'),
    download: async () => { downloadCalled += 1; return '/tmp/x.tgz' },
    runAdd: async () => 'done',
    ...profileStub,
  })
  await assert.rejects(svc.apply('dsh-devforge'), /官网下载需要登录：请到 天工造梦 → 个人中心 登录官网账号后重试/)
  assert.equal(downloadCalled, 0, '无登录态时直连必然 404，不应再发下载请求')
})

test('PluginUpdateService.apply：下载 401 → 个人中心登录引导（会话中途失效）', async () => {
  const svc = new PluginUpdateService({
    getConfig: () => ({ enabled: true, profile: 'web', sources: [siteSource] }),
    readInstalled: () => ({ version: '0.13.0' }),
    resolveLatestFn: async () => siteLatest('0.13.1'),
    sessionToken: async () => 'sess-token-1',
    fetchTicket: async () => 'ticket-1',
    download: async () => { throw new Error('下载失败 HTTP 401') },
    runAdd: async () => 'done',
    ...profileStub,
  })
  await assert.rejects(svc.apply('dsh-devforge'), /官网下载需要登录：请到 天工造梦 → 个人中心 登录官网账号后重试/)
})

test('PluginUpdateService.apply：下载 403 → 同样给出登录引导', async () => {
  const svc = new PluginUpdateService({
    getConfig: () => ({ enabled: true, profile: 'web', sources: [siteSource] }),
    readInstalled: () => ({ version: '0.13.0' }),
    resolveLatestFn: async () => siteLatest('0.13.1'),
    sessionToken: async () => 'sess-token-1',
    fetchTicket: async () => 'ticket-1',
    download: async () => { throw new Error('下载失败 HTTP 403') },
    runAdd: async () => 'done',
    ...profileStub,
  })
  await assert.rejects(svc.apply('dsh-devforge'), /个人中心/)
})

test('PluginUpdateService.apply：无面板登录态时回退 site 账号登录，sid 归一化后换票下载', async () => {
  let loginCalled = 0
  let seenTokenArg = ''
  let seenUrl = ''
  const svc = new PluginUpdateService({
    getConfig: () => ({ enabled: true, profile: 'web', sources: [siteSource], site: { apiUrl: '', username: 'u1', password: 'p1' } }),
    readInstalled: () => ({ version: '0.13.0' }),
    resolveLatestFn: async () => siteLatest('0.13.1'),
    loginSite: async () => { loginCalled += 1; return 'sid=xyz' },
    fetchTicket: async (_apiUrl, sessionToken) => { seenTokenArg = sessionToken; return 'ticket-2' },
    download: async (url) => { seenUrl = url; return '/tmp/x.tgz' },
    runAdd: async () => 'done',
    ...profileStub,
  })
  const result = await svc.apply('dsh-devforge')
  assert.equal(result.ok, true)
  assert.equal(loginCalled, 1)
  assert.equal(seenTokenArg, 'xyz', 'loginSite 返回 Cookie 形态 sid=xyz，换票必须用裸令牌')
  assert.equal(seenUrl, 'https://modagentai.com/dl/dsh-devforge-0.13.1.tgz?token=ticket-2')
})

test('PluginUpdateService.apply：登录失败错误原样抛出（不静默降级为匿名下载）', async () => {
  const svc = new PluginUpdateService({
    getConfig: () => ({ enabled: true, profile: 'web', sources: [siteSource], site: { apiUrl: '', username: 'u1', password: 'wrong' } }),
    readInstalled: () => ({ version: '0.13.0' }),
    resolveLatestFn: async () => siteLatest('0.13.1'),
    loginSite: async () => { throw new Error('官网账号或密码错误') },
    download: async () => { throw new Error('不应走到下载') },
    runAdd: async () => 'done',
    ...profileStub,
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
