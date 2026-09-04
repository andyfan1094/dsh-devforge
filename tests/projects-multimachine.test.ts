/**
 * 项目多端路径测试：machineId 稳定性、machinePaths 映射、跨机换机语义、
 * 重定位（含仓库不一致警告）与分支批量刷新。
 * 使用独立临时目录（DSH_HOME 覆盖），不触碰生产 ~/.dsh。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SAVED_HOME = process.env.DSH_HOME
const home = mkdtempSync(join(tmpdir(), 'projects-multi-'))
process.env.DSH_HOME = home

const { closeDb, getDb } = await import('../src/store/db.ts')
const { getMachineId, listProjects, refreshAllProjectGitMeta, relocateProject, saveProject } = await import('../src/projects/store.ts')

test.after(() => {
  closeDb()
  if (SAVED_HOME === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = SAVED_HOME
  rmSync(home, { recursive: true, force: true })
})

/** 构造一个最小可检测的假 Git 仓库（.git 目录 + HEAD + 可选 config）。 */
function makeGitRepo(dir: string, options?: { remoteUrl?: string; branch?: string }): void {
  mkdirSync(join(dir, '.git'), { recursive: true })
  writeFileSync(join(dir, '.git', 'HEAD'), 'ref: refs/heads/' + (options?.branch ?? 'main') + '\n')
  if (options?.remoteUrl !== undefined) {
    writeFileSync(join(dir, '.git', 'config'), '[remote "origin"]\n\turl = ' + options.remoteUrl + '\n')
  }
}

test('machineId：同库多次读取稳定，且为非空 UUID 形态', () => {
  const first = getMachineId()
  const second = getMachineId()
  assert.equal(first, second)
  assert.ok(first.length >= 32)
})

test('保存即登记本机映射：listProjects 的 path 等于本机 machinePaths 映射', () => {
  const repo = mkdtempSync(join(tmpdir(), 'projects-mp-'))
  const machineId = getMachineId()
  const saved = saveProject({ name: '甲项目', path: repo, repoKind: 'cnb', repoUrl: 'https://cnb.cool/o/r' })
  assert.equal(saved.machinePaths[machineId], repo)
  const listed = listProjects().find((entry) => entry.id === saved.id)
  assert.equal(listed?.path, repo)
  assert.equal(listed?.machinePaths[machineId], repo)
  // 目录真实存在 → pathExists 为 true。
  assert.equal(listed?.pathExists, true)
  rmSync(repo, { recursive: true, force: true })
})

test('跨机语义：换 machineId 后 path 回退原值且失效可见，重定位后写入新映射', () => {
  const oldRepo = mkdtempSync(join(tmpdir(), 'projects-old-'))
  const saved = saveProject({ name: '乙项目', path: oldRepo, repoUrl: 'https://cnb.cool/o/switch' })
  const oldMachineId = getMachineId()
  rmSync(oldRepo, { recursive: true, force: true })

  // 模拟备份恢复到新电脑：库里的 machine_id 变成新机的 id。
  const db = getDb()
  const newMachineId = 'machine-new-uuid'
  db.prepare('INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run('project.machine_id', newMachineId)

  // 新机没有自己的映射 → path 回退为库里存的旧机路径；目录已删 → pathExists=false。
  const stale = listProjects().find((entry) => entry.id === saved.id)
  assert.equal(stale?.path, oldRepo)
  assert.equal(stale?.pathExists, false)
  assert.equal(stale?.machinePaths[oldMachineId], oldRepo)

  // 重定位到新机真实目录：写入新机映射，旧机映射保留（换回旧电脑仍有效）。
  const newRepo = mkdtempSync(join(tmpdir(), 'projects-new-'))
  const relocated = relocateProject(saved.id, newRepo)
  assert.equal(relocated.ok, true)
  assert.equal(relocated.warn, undefined)
  const fresh = listProjects().find((entry) => entry.id === saved.id)
  assert.equal(fresh?.path, newRepo)
  assert.equal(fresh?.machinePaths[newMachineId], newRepo)
  assert.equal(fresh?.machinePaths[oldMachineId], oldRepo)
  assert.equal(fresh?.pathExists, true)
  rmSync(newRepo, { recursive: true, force: true })
})

test('重定位校验：空路径、相对路径、不存在路径与未知项目都被拒绝', () => {
  assert.equal(relocateProject('x', '').ok, false)
  assert.equal(relocateProject('x', 'relative/path').ok, false)
  assert.equal(relocateProject('x', '/definitely/not/exist-xyz').ok, false)
  assert.equal(relocateProject('no-such-id', tmpdir()).ok, false)
})

test('重定位警告：新路径 origin 与登记 repoUrl 归一化不一致时提示但成功', () => {
  const saved = saveProject({ name: '丙项目', path: tmpdir(), repoUrl: 'https://github.com/o/wrong' })
  const repo = mkdtempSync(join(tmpdir(), 'projects-warn-'))
  makeGitRepo(repo, { remoteUrl: 'https://cnb.cool/o/right.git' })
  const result = relocateProject(saved.id, repo)
  assert.equal(result.ok, true)
  assert.ok((result.warn ?? '').includes('不一致'))
  rmSync(repo, { recursive: true, force: true })
})

test('分支刷新：HEAD 变更后 refreshAllProjectGitMeta 回填新分支，失效路径跳过', () => {
  const repo = mkdtempSync(join(tmpdir(), 'projects-br-'))
  makeGitRepo(repo, { branch: 'dev' })
  const missingRepo = mkdtempSync(join(tmpdir(), 'projects-gone-'))
  saveProject({ name: '丁项目', path: repo })
  const gone = saveProject({ name: '戊项目', path: missingRepo })
  rmSync(missingRepo, { recursive: true, force: true })

  // 换分支后刷新：dev → release。
  writeFileSync(join(repo, '.git', 'HEAD'), 'ref: refs/heads/release\n')
  const list = refreshAllProjectGitMeta()
  const refreshed = list.find((entry) => entry.name === '丁项目')
  assert.equal(refreshed?.repoBranch, 'release')
  // 失效项目不抛错、路径原样保留。
  const still = list.find((entry) => entry.id === gone.id)
  assert.equal(still?.path, missingRepo)
  assert.equal(still?.pathExists, false)
  rmSync(repo, { recursive: true, force: true })
})
