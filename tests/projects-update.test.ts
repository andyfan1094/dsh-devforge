/**
 * 项目资料维护测试（0.65.0）：结构化字段回填（update）、缺失字段分级、
 * testUrl 读回修复、探测回填落库，以及 devforge_project 工具的 update/list/detail 行为。
 *
 * 为什么必须有这组断言：0.64.x 之前 listProjects 不读回 testUrl、工具也没有写
 * 结构化字段的动作，导致「探测/手填过的测试地址永远显示未绑定」、模型只能把地址
 * 塞进 fact —— 项目资料因此长期不更新。这些用例锁死上述两种回归。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SAVED_HOME = process.env.DSH_HOME
const home = mkdtempSync(join(tmpdir(), 'projects-update-'))
process.env.DSH_HOME = home

const { closeDb, getDb } = await import('../src/store/db.ts')
const store = await import('../src/projects/store.ts')
const { runProjectProbe } = await import('../src/projects/probe.ts')
const { devforgeProjectTool } = await import('../src/projects/tools.ts')

test.after(() => {
  closeDb()
  if (SAVED_HOME === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = SAVED_HOME
  rmSync(home, { recursive: true, force: true })
})

/** 造一条最小登记（不经 register，避免依赖磁盘路径存在）。 */
function seed(name: string): ReturnType<typeof store.saveProject> {
  getDb()
  return store.saveProject({ name, path: 'D:/projects/' + name, repoKind: 'none', repoUrl: '' })
}

/** 读回一条项目。 */
function read(id: string): NonNullable<ReturnType<typeof store.listProjects>[number]> {
  const found = store.listProjects().find((entry) => entry.id === id)
  assert.ok(found !== undefined, '项目应存在：' + id)
  return found
}

test('update 回填结构化资料：地址归一化、发布服务器简写、testUrl 能被读回', () => {
  const saved = seed('资料补全甲')
  const result = store.updateProjectFields(saved.id, {
    siteUrl: 'https://fill.example.com/',
    testUrl: 'http://test.fill.example.com',
    deployTargets: ['ssh:my', 'winrm:13@D:\\WWW\\Fill'],
    deployCommand: 'pnpm run deploy',
  })
  assert.equal(result.ok, true, result.message)
  assert.deepEqual(result.changed, ['线上地址', '测试地址', '发布服务器', '发布命令'])

  const entry = read(saved.id)
  assert.equal(entry.siteUrl, 'https://fill.example.com', '末尾斜杠应归一')
  // 0.64.x 的 bug：listProjects 漏读 testUrl，写入后读回恒为 undefined。
  assert.equal(entry.testUrl, 'http://test.fill.example.com', 'testUrl 必须能读回，否则界面永远显示未绑定')
  assert.deepEqual(entry.deployTargets, [
    { transport: 'ssh', alias: 'my' },
    { transport: 'winrm', alias: '13', remotePath: 'D:\\WWW\\Fill' },
  ])
  assert.equal(entry.deployCommand, 'pnpm run deploy')
})

test('update 校验：非法地址被拒、空串清空字段、无变化不谎报更新', () => {
  const saved = seed('资料补全乙')
  const bad = store.updateProjectFields(saved.id, { siteUrl: 'fill.example.com' })
  assert.equal(bad.ok, false)
  assert.match(bad.message, /http\(s\)/u)

  assert.equal(store.updateProjectFields(saved.id, { siteUrl: 'https://b.example.com' }).ok, true)
  const same = store.updateProjectFields(saved.id, { siteUrl: 'https://b.example.com' })
  assert.equal(same.ok, true)
  assert.deepEqual(same.changed, [], '重复提交同一值不应报告为更新')
  assert.match(same.message, /无变化/u)

  const cleared = store.updateProjectFields(saved.id, { siteUrl: '', testUrl: '' })
  assert.equal(cleared.ok, true)
  const entry = read(saved.id)
  assert.equal(entry.siteUrl, '')
  assert.equal(entry.testUrl, '')
})

test('发布服务器归一化：去重、拒绝非法 transport、对象与简写等价', () => {
  assert.deepEqual(store.normalizeDeployTargetInput(['ssh:my', 'SSH:my', 'winrm:13@/opt/x']), {
    ok: true,
    targets: [
      { transport: 'ssh', alias: 'my' },
      { transport: 'winrm', alias: '13', remotePath: '/opt/x' },
    ],
  })
  assert.deepEqual(store.normalizeDeployTargetInput([{ transport: 'ssh', alias: 'my', remotePath: '' }]), {
    ok: true,
    targets: [{ transport: 'ssh', alias: 'my' }],
  })
  assert.equal(store.normalizeDeployTargetInput(['ftp:my']).ok, false)
  assert.equal(store.normalizeDeployTargetInput('ssh:my' as unknown as string[]).ok, false)
})

test('缺失字段分级：仓库/线上/发布为交付必需，测试地址与描述为可选项', () => {
  const saved = seed('资料缺口丙')
  const missing = store.projectMissingFields(read(saved.id))
  assert.deepEqual(missing.map((field) => [field.key, field.level]), [
    ['repoUrl', 'core'],
    ['siteUrl', 'core'],
    ['deployTargets', 'core'],
    ['testUrl', 'optional'],
    ['description', 'optional'],
  ])

  store.updateProjectFields(saved.id, {
    siteUrl: 'https://c.example.com',
    testUrl: 'https://test.c.example.com',
    deployTargets: ['ssh:my'],
    repoUrl: 'https://cnb.cool/owner/c.git',
    description: '缺口用例',
  })
  assert.deepEqual(store.projectMissingFields(read(saved.id)), [], '补全后不应再报缺口')
})

test('探测回填的 testUrl 落库后可读回（端到端：probe → 登记表 → 列表）', async () => {
  const saved = seed('probe-fill')
  const engines = {
    winrm: {
      exec: async () => ({
        success: true,
        exitCode: 0,
        stdout: 'probe-fill-test|Started|D:\\WWW\\probe-fill-test|*:3505:',
      }),
    },
  }
  const entry = read(saved.id)
  const result = await runProjectProbe(entry, engines as never, [{ transport: 'winrm', alias: '13', host: '10.0.0.13' }])
  assert.equal(result.ok, true, result.error)
  assert.ok(result.applied.some((item) => item.includes('测试地址')), '应回填测试地址：' + result.applied.join('；'))

  const after = read(saved.id)
  assert.equal(after.testUrl, 'http://10.0.0.13:3505')
  assert.deepEqual(after.deployTargets, [{ transport: 'winrm', alias: '13', remotePath: 'D:\\WWW\\probe-fill-test' }])
})

test('工具层：list 标出待补字段与 id 短码，update 用短码定位并回填，detail 给出可执行建议', async () => {
  const saved = seed('工具丁')
  const short = saved.id.slice(0, 8)
  const tool = devforgeProjectTool() as any

  const listed = await tool.execute({ action: 'list' })
  assert.equal(listed.ok, true)
  assert.match(listed.message, new RegExp('id:' + short, 'u'), '清单必须带 id 短码，模型才知道拿什么去 update')
  assert.match(listed.message, /待补:★仓库地址/u, '清单必须标出交付必需缺口')
  assert.match(listed.message, /action=probe/u, '清单必须给出补法')

  const updated = await tool.execute({ action: 'update', id: short, siteUrl: 'https://tool.example.com' })
  assert.equal(updated.ok, true, updated.message)
  assert.match(updated.message, /已更新项目「工具丁」：线上地址/u)
  assert.match(updated.message, /仍需补齐/u)
  assert.equal(read(saved.id).siteUrl, 'https://tool.example.com')

  const detail = await tool.execute({ action: 'detail', id: short })
  assert.equal(detail.ok, true)
  assert.match(detail.message, /资料缺口/u)
  assert.match(detail.message, /action=probe/u)
  assert.match(detail.message, /禁止编造/u)
})
