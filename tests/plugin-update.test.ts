/** 插件更新能力单测：tag 解析、semver 比较、官网清单解析、sha256、检查编排与白名单升级。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildDshPluginAddCommand,
  checkOne,
  compareSemver,
  parseSiteIndex,
  parseTagVersion,
  pickTgzAsset,
  PluginUpdateService,
  sha256Hex,
  type LatestInfo,
  type UpdateSource,
} from '../src/plugin-update.ts'

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

test('parseTagVersion：剥 v 前缀并拒绝非语义化版本', () => {
  assert.equal(parseTagVersion('v0.13.0'), '0.13.0')
  assert.equal(parseTagVersion('0.13.0'), '0.13.0')
  assert.equal(parseTagVersion('v1.2'), '')
  assert.equal(parseTagVersion('release-codename'), '')
})

test('compareSemver：逐段比较', () => {
  assert.equal(compareSemver('0.13.0', '0.12.1'), 1)
  assert.equal(compareSemver('0.12.1', '0.13.0'), -1)
  assert.equal(compareSemver('1.0.0', '1.0.0'), 0)
  assert.equal(compareSemver('0.10.0', '0.9.9'), 1)
})

test('pickTgzAsset：挑出 tgz 直链；没有则空串', () => {
  const picked = pickTgzAsset([
    { name: 'source.zip', browser_download_url: 'https://example.com/a.zip' },
    { name: 'dsh-devforge-0.13.0.tgz', browser_download_url: 'https://example.com/a.tgz' },
  ])
  assert.deepEqual(picked, { tgzUrl: 'https://example.com/a.tgz', tgzName: 'dsh-devforge-0.13.0.tgz' })
  assert.deepEqual(pickTgzAsset([{ name: 'x.zip', browser_download_url: 'https://example.com/x.zip' }]), { tgzUrl: '', tgzName: '' })
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
