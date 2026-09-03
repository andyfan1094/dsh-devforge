/** DSH 本体更新检查单测：预发布比较、无序 tag 取最高、本机版本读取、检查编排与升级命令引导。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  checkHarnessUpdate,
  compareVersionWithPrerelease,
  createDefaultHarnessVersionReader,
  isVersionLike,
  parseHarnessTagVersion,
  pickLatestHarnessTag,
  planHarnessUpgrade,
  resolveHarnessPackageRoot,
  HARNESS_UPDATE_DEFAULT_SOURCE,
} from '../src/harness-update.ts'

test('isVersionLike：接受带预发布段的语义化版本，拒绝残缺版本', () => {
  assert.equal(isVersionLike('0.1.2-alpha.3'), true)
  assert.equal(isVersionLike('0.1.2-rc.1'), true)
  assert.equal(isVersionLike('0.1.2'), true)
  assert.equal(isVersionLike('0.1.2-alpha.3-beta'), true)
  assert.equal(isVersionLike('v0.1.2'), false)
  assert.equal(isVersionLike('0.1'), false)
  assert.equal(isVersionLike('abc'), false)
  assert.equal(isVersionLike(''), false)
})

test('compareVersionWithPrerelease：alpha < rc < 正式版，数字段按数值比较', () => {
  assert.equal(compareVersionWithPrerelease('0.1.2-alpha.3', '0.1.2-alpha.5'), -1)
  assert.equal(compareVersionWithPrerelease('0.1.2-alpha.5', '0.1.2-beta.1'), -1)
  assert.equal(compareVersionWithPrerelease('0.1.2-beta.1', '0.1.2-rc.1'), -1)
  assert.equal(compareVersionWithPrerelease('0.1.2-rc.1', '0.1.2'), -1) // 正式版 > 预发布
  assert.equal(compareVersionWithPrerelease('0.1.2-alpha.10', '0.1.2-alpha.9'), 1) // 数值而非字典序
  assert.equal(compareVersionWithPrerelease('0.1.10', '0.1.9'), 1)
  assert.equal(compareVersionWithPrerelease('0.1.2-alpha.2', '0.1.2-alpha.2'), 0)
  assert.equal(compareVersionWithPrerelease('0.1.2-alpha', '0.1.2-alpha.1'), -1) // 标识更少优先级更低
})

test('compareVersionWithPrerelease：超大数字段不经 Number 也能正确比较', () => {
  const big = '0.1.2-alpha.99999999999999999999'
  const bigger = '0.1.2-alpha.100000000000000000001'
  assert.equal(compareVersionWithPrerelease(big, bigger), -1)
  assert.equal(compareVersionWithPrerelease(bigger, big), 1)
})

test('compareVersionWithPrerelease：任一输入非法返回 0（不抛错）', () => {
  assert.equal(compareVersionWithPrerelease('garbage', '0.1.2'), 0)
  assert.equal(compareVersionWithPrerelease('0.1.2', 'garbage'), 0)
})

test('parseHarnessTagVersion：剥 dsh-v 前缀，前缀不符或版本非法返回空串', () => {
  assert.equal(parseHarnessTagVersion('dsh-v0.1.2-alpha.5', 'dsh-v'), '0.1.2-alpha.5')
  assert.equal(parseHarnessTagVersion('dsh-v0.1.2-rc.1', 'dsh-v'), '0.1.2-rc.1')
  assert.equal(parseHarnessTagVersion('v0.1.2-alpha.5', 'dsh-v'), '')
  assert.equal(parseHarnessTagVersion('dsh-vX.Y.Z', 'dsh-v'), '')
})

test('pickLatestHarnessTag：Tags 乱序返回也能取到最高版本', () => {
  const picked = pickLatestHarnessTag([
    { name: 'dsh-v0.1.2-rc.1' },
    { name: 'dsh-v0.1.2-alpha.3' },
    { name: 'not-a-tag' },
    { name: 'dsh-v0.1.2-alpha.5' },
    { name: 'dsh-v0.1.1-rc.2' },
  ], 'dsh-v')
  assert.deepEqual(picked, { version: '0.1.2-rc.1', tag: 'dsh-v0.1.2-rc.1' })
  assert.equal(pickLatestHarnessTag([{ name: 'main' }], 'dsh-v'), undefined)
})

/** 构造一个假的 DSH 本体包目录（package.json name 命中 + lib/bin.js 入口）。 */
function makeFakeHarnessDir(version: string): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-harness-test-'))
  const pkgDir = join(root, 'node_modules', '@deepseek-ai', 'dsh')
  mkdirSync(join(pkgDir, 'lib'), { recursive: true })
  writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version }))
  writeFileSync(join(pkgDir, 'lib', 'bin.js'), '// fake entry')
  return pkgDir
}

test('resolveHarnessPackageRoot：从入口向上命中 @deepseek-ai/dsh；异常输入收敛 undefined', () => {
  const pkgDir = makeFakeHarnessDir('0.1.2-alpha.3')
  try {
    const entry = join(pkgDir, 'lib', 'bin.js')
    // macOS 下 /var/folders 的真实路径是 /private/var/folders，断言须用 realpath 对齐。
    assert.equal(resolveHarnessPackageRoot(entry), realpathSync(pkgDir))
    assert.equal(resolveHarnessPackageRoot(''), undefined)
    assert.equal(resolveHarnessPackageRoot('/definitely/not/exist/bin.js'), undefined)
    const reader = createDefaultHarnessVersionReader(entry)
    assert.equal(reader(), '0.1.2-alpha.3')
    // 读取失败的锚点：返回空串且缓存，不抛错。
    const badReader = createDefaultHarnessVersionReader('')
    assert.equal(badReader(), '')
  } finally {
    rmSync(join(pkgDir, '..', '..'), { recursive: true, force: true })
  }
})

test('planHarnessUpgrade：按入口路径特征推测 npm / pnpm 并生成含版本号的命令', () => {
  const npmPlan = planHarnessUpgrade('/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/lib/bin.js', '0.1.2-rc.1')
  assert.equal(npmPlan.manager, 'npm')
  assert.equal(npmPlan.command, 'npm install -g @deepseek-ai/dsh@0.1.2-rc.1')
  const pnpmPlan = planHarnessUpgrade('/home/u/.local/share/pnpm/global/5/node_modules/.pnpm/@deepseek-ai+dsh@0.1.2/node_modules/@deepseek-ai/dsh/lib/bin.js', '0.1.2-rc.1')
  assert.equal(pnpmPlan.manager, 'pnpm')
  assert.equal(pnpmPlan.command, 'pnpm add -g @deepseek-ai/dsh@0.1.2-rc.1')
  const unknownPlan = planHarnessUpgrade('/opt/dsh-custom/bin.js', '0.1.2-rc.1')
  assert.equal(unknownPlan.manager, 'unknown')
  assert.equal(unknownPlan.command, 'npm install -g @deepseek-ai/dsh@0.1.2-rc.1')
})

/** 构造可注入的本体检查依赖。 */
function deps(overrides?: { installed?: string; tags?: Array<{ name: string }>; fail?: boolean }) {
  return {
    readInstalled: () => overrides?.installed ?? '0.1.2-alpha.3',
    fetchLatest: async () => {
      if (overrides?.fail) throw new Error('网络不可达')
      return pickLatestHarnessTag(overrides?.tags ?? [{ name: 'dsh-v0.1.2-rc.1' }, { name: 'dsh-v0.1.2-alpha.5' }], HARNESS_UPDATE_DEFAULT_SOURCE.tagPrefix)
    },
    entryPath: '/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/lib/bin.js',
  }
}

test('checkHarnessUpdate：alpha.3 → rc.1 判定可更新，附官方标签页与升级命令', async () => {
  const item = await checkHarnessUpdate(deps())
  assert.equal(item.status, 'update-available')
  assert.equal(item.installed, '0.1.2-alpha.3')
  assert.equal(item.latest, '0.1.2-rc.1')
  assert.equal(item.latestTag, 'dsh-v0.1.2-rc.1')
  assert.equal(item.repo, 'deepseek-ai/deepseek-harness')
  assert.equal(item.tagUrl, 'https://github.com/deepseek-ai/deepseek-harness/tags')
  assert.equal(item.upgrade?.manager, 'npm')
  assert.ok(item.upgrade?.command.includes('@deepseek-ai/dsh@0.1.2-rc.1'))
})

test('checkHarnessUpdate：已最新 / 本地更高（内测）/ 检查失败', async () => {
  const same = await checkHarnessUpdate(deps({ installed: '0.1.2-rc.1' }))
  assert.equal(same.status, 'up-to-date')
  const newer = await checkHarnessUpdate(deps({ installed: '0.1.2-rc.2' }))
  assert.equal(newer.status, 'up-to-date')
  assert.ok(newer.reason.includes('内测'))
  const failed = await checkHarnessUpdate(deps({ fail: true }))
  assert.equal(failed.status, 'error')
  assert.ok(failed.reason.includes('网络不可达'))
})

test('checkHarnessUpdate：未识别与非法本机版本都收敛为 installed-unknown，不误判已最新', async () => {
  const blank = await checkHarnessUpdate(deps({ installed: '' }))
  assert.equal(blank.status, 'installed-unknown')
  const garbage = await checkHarnessUpdate(deps({ installed: 'not-a-version' }))
  assert.equal(garbage.status, 'installed-unknown')
  assert.ok(garbage.reason.includes('无法识别'))
  // 红点只认 update-available：以上两种都必须不是可更新。
  assert.notEqual(blank.status, 'update-available')
  assert.notEqual(garbage.status, 'update-available')
})
