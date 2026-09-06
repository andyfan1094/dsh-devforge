/**
 * 项目按路径登记单测（register 工具动作的 store 层实现）：
 * Git 元数据自动检测、幂等更新、路径校验。使用独立临时目录（DSH_HOME 覆盖），
 * 不触碰生产 ~/.dsh。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SAVED_HOME = process.env.DSH_HOME
const home = mkdtempSync(join(tmpdir(), 'projects-register-'))
process.env.DSH_HOME = home

const { closeDb } = await import('../src/store/db.ts')
const { listProjects, registerProjectFromPath } = await import('../src/projects/store.ts')

// 造一个假 Git 项目目录：detectProjectGit 只读 .git/config 与 .git/HEAD，无需真实 git 仓库。
const projectDir = join(home, 'wukong-game')
mkdirSync(join(projectDir, '.git'), { recursive: true })
writeFileSync(join(projectDir, '.git', 'HEAD'), 'ref: refs/heads/main\n')
writeFileSync(join(projectDir, '.git', 'config'), '[remote "origin"]\n\turl = https://github.com/andyfan1094/wukong-game.git\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n')

test.after(() => {
  closeDb()
  if (SAVED_HOME === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = SAVED_HOME
  rmSync(home, { recursive: true, force: true })
})

test('按路径登记：自动检测 Git 远端与分支', () => {
  const result = registerProjectFromPath({ path: projectDir, description: '悟空游戏（Godot 4）' })
  assert.ok(result.ok, result.message)
  assert.ok(result.message.includes('已登记项目'))
  assert.ok(result.message.includes('wukong-game'))
  assert.ok(result.message.includes('github'))
  const entries = listProjects()
  assert.equal(entries.length, 1)
  assert.equal(entries[0]?.repoKind, 'github')
  assert.equal(entries[0]?.repoBranch, 'main')
  assert.equal(entries[0]?.description, '悟空游戏（Godot 4）')
})

test('按路径登记：同路径幂等更新，不产生重复登记', () => {
  const second = registerProjectFromPath({ path: projectDir, name: '悟空' })
  assert.ok(second.ok, second.message)
  assert.ok(second.message.includes('已更新登记'))
  const entries = listProjects()
  assert.equal(entries.length, 1, '同路径重复登记必须复用原条目')
  assert.equal(entries[0]?.name, '悟空')
})

test('按路径登记：空路径、相对路径与不存在的路径被拒绝', () => {
  assert.equal(registerProjectFromPath({ path: '' }).ok, false)
  assert.equal(registerProjectFromPath({ path: 'relative/path' }).ok, false)
  const missing = registerProjectFromPath({ path: join(home, 'not-exist') })
  assert.equal(missing.ok, false)
  assert.ok(missing.message.includes('不存在'))
})
