/** 插件更新能力单测：tag 解析、semver 比较、资产挑选、检查编排与白名单升级。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  checkOne,
  compareSemver,
  parseTagVersion,
  pickTgzAsset,
  PluginUpdateService,
  type LatestRelease,
  type UpdateSource,
} from '../src/plugin-update.ts'

test('parseTagVersion：剥 v 前缀并拒绝非语义化版本', () => {
  assert.equal(parseTagVersion('v0.13.0'), '0.13.0')
  assert.equal(parseTagVersion('0.13.0'), '0.13.0')
  assert.equal(parseTagVersion('V1.2.3'), '1.2.3')
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

/** 构造固定 Release。 */
function release(tag: string): LatestRelease {
  return { tag, tgzUrl: 'https://example.com/dsh-devforge-' + parseTagVersion(tag) + '.tgz', tgzName: 'dsh-devforge-' + parseTagVersion(tag) + '.tgz' }
}

const source: UpdateSource = { packageName: 'dsh-devforge', repo: 'andyfan1094/dsh-devforge' }

test('checkOne：可更新 / 已最新 / 本地更高（内测）', async () => {
  const available = await checkOne(source, '0.12.1', async () => release('v0.13.0'))
  assert.equal(available.status, 'update-available')
  assert.equal(available.latest, '0.13.0')
  assert.ok(available.assetUrl.includes('0.13.0'))
  const same = await checkOne(source, '0.13.0', async () => release('v0.13.0'))
  assert.equal(same.status, 'up-to-date')
  const newer = await checkOne(source, '0.14.0', async () => release('v0.13.0'))
  assert.equal(newer.status, 'up-to-date')
  assert.ok(newer.reason.includes('内测'))
})

test('checkOne：无 Release / 拉取失败 / 非法 tag / 本机未装', async () => {
  const none = await checkOne(source, '', async () => null)
  assert.equal(none.status, 'installed-unknown')
  assert.ok(none.reason.includes('尚无'))
  const boom = await checkOne(source, '0.12.1', async () => { throw new Error('限流') })
  assert.equal(boom.status, 'error')
  assert.ok(boom.reason.includes('限流'))
  const badTag = await checkOne(source, '0.12.1', async () => release('codename'))
  assert.equal(badTag.status, 'error')
  const notInstalled = await checkOne(source, '', async () => release('v0.13.0'))
  assert.equal(notInstalled.status, 'installed-unknown')
})

/** 构造可注入的更新服务。 */
function service(overrides?: { latest?: LatestRelease | null; installed?: { version?: string } }): PluginUpdateService {
  return new PluginUpdateService({
    getConfig: () => ({ enabled: true, profile: 'web', sources: [source] }),
    readInstalled: () => overrides?.installed ?? { version: '0.12.1' },
    fetchLatest: async () => overrides?.latest !== undefined ? overrides.latest : release('v0.13.0'),
    download: async (url, name, version) => {
      assert.ok(url.startsWith('https://'))
      assert.equal(name, 'dsh-devforge')
      return '/tmp/dsh-devforge-' + version + '.tgz'
    },
    runAdd: async (profile, tgzPath) => {
      assert.equal(profile, 'web')
      assert.ok(tgzPath.endsWith('.tgz'))
      return 'done'
    },
  })
}

test('PluginUpdateService.check：返回检查项', async () => {
  const result = await service().check()
  assert.equal(result.enabled, true)
  assert.equal(result.items.length, 1)
  assert.equal(result.items[0]?.status, 'update-available')
})

test('PluginUpdateService.check：关闭时返回空表', async () => {
  const svc = new PluginUpdateService({
    getConfig: () => ({ enabled: false, profile: 'web', sources: [source] }),
    readInstalled: () => ({ version: '0.12.1' }),
  })
  const result = await svc.check()
  assert.equal(result.enabled, false)
  assert.equal(result.items.length, 0)
})

test('PluginUpdateService.apply：白名单外拒绝，白名单内走完下载与安装', async () => {
  await assert.rejects(service().apply('some-random-pkg'), /登记表/)
  const result = await service().apply('dsh-devforge')
  assert.equal(result.ok, true)
  assert.equal(result.version, '0.13.0')
  assert.equal(result.needRestart, true)
})

test('PluginUpdateService.apply：仓库无 Release 时报错', async () => {
  await assert.rejects(service({ latest: null }).apply('dsh-devforge'), /尚无/)
})
