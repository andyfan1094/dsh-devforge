/**
 * 项目面板测试：登记 CRUD（SQLite docs 域）、载荷校验、路径检测
 * （.git 目录 / worktree 指针 / 非仓库 / 路径不存在）。
 * 使用独立临时目录（DSH_HOME 覆盖），不触碰生产 ~/.dsh。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SAVED_HOME = process.env.DSH_HOME
const home = mkdtempSync(join(tmpdir(), 'projects-e2e-'))
process.env.DSH_HOME = home

const { closeDb, getDb } = await import('../src/store/db.ts')
const { classifyRepoKind, detectProjectGit, listProjects, removeProject, saveProject, validateProjectPayload } = await import('../src/projects/store.ts')

test.after(() => {
  closeDb()
  if (SAVED_HOME === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = SAVED_HOME
  rmSync(home, { recursive: true, force: true })
})

test('载荷校验：必填项、绝对路径、repoKind 枚举与发布服务器形状', () => {
  assert.equal(validateProjectPayload(null), 'body must be a JSON object')
  assert.equal(validateProjectPayload({ name: '', path: '/a' }), 'name 必须是非空字符串')
  assert.equal(validateProjectPayload({ name: 'x', path: '' }), 'path 必须是非空字符串')
  assert.equal(validateProjectPayload({ name: 'x', path: 'relative/path' }), 'path 必须是绝对路径')
  assert.equal(validateProjectPayload({ name: 'x', path: '/a', repoKind: 'svn' }), 'repoKind 必须是 none/cnb/github/git')
  assert.equal(validateProjectPayload({ name: 'x', path: '/a', deployTargets: [{ transport: 'ftp', alias: 'a' }] }), 'deployTargets.transport 只能是 ssh 或 winrm')
  assert.equal(validateProjectPayload({ name: 'x', path: '/a', deployTargets: [{ transport: 'ssh', alias: 'my' }] }), undefined)
  assert.equal(validateProjectPayload({ name: 'x', path: '/a' }), undefined)
})

test('登记 CRUD：新增、更新保留 createdAt、删除', () => {
  getDb() // 初始化库
  const saved = saveProject({
    name: '天工造梦插件',
    path: '/Users/andyfan/Documents/ds/dsh-devforge',
    description: '规范驱动服务生成',
    repoKind: 'github',
    repoUrl: 'https://github.com/andyfan1094/dsh-devforge',
    repoBranch: 'main',
    deployTargets: [{ transport: 'ssh', alias: 'my' }],
  })
  assert.ok(saved.id !== '')
  assert.equal(saved.createdAt, saved.updatedAt)

  const updated = saveProject({ id: saved.id, name: '天工造梦插件（改）', path: '/Users/andyfan/Documents/ds/dsh-devforge' })
  assert.equal(updated.createdAt, saved.createdAt)
  assert.ok(updated.updatedAt >= saved.updatedAt)
  // 部分更新：未传字段一律保留旧值，不会误清空登记。
  assert.equal(updated.name, '天工造梦插件（改）')
  assert.equal(updated.description, '规范驱动服务生成')
  assert.equal(updated.repoKind, 'github')
  assert.equal(updated.repoUrl, 'https://github.com/andyfan1094/dsh-devforge')
  assert.equal(updated.repoBranch, 'main')
  assert.deepEqual(updated.deployTargets, [{ transport: 'ssh', alias: 'my' }])

  const list = listProjects()
  assert.equal(list.length, 1)
  assert.equal(list[0].name, '天工造梦插件（改）')
  assert.equal(list[0].repoKind, 'github')

  assert.equal(removeProject(saved.id), true)
  assert.equal(removeProject(saved.id), false)
  assert.equal(listProjects().length, 0)
})

test('托管类型识别：cnb.cool、github.com、其他、空', () => {
  assert.equal(classifyRepoKind('https://cnb.cool/owner/repo.git'), 'cnb')
  assert.equal(classifyRepoKind('git@github.com:owner/repo.git'), 'github')
  assert.equal(classifyRepoKind('https://gitlab.com/owner/repo.git'), 'git')
  assert.equal(classifyRepoKind(''), 'none')
})

test('路径检测：普通 Git 仓库（CNB origin + GitHub 备远端）与分支回读', () => {
  const repo = mkdtempSync(join(tmpdir(), 'projects-repo-'))
  const gitDir = join(repo, '.git')
  mkdirSync(gitDir)
  writeFileSync(join(gitDir, 'config'), [
    '[core]',
    'repositoryformatversion = 0',
    '[remote "upstream"]',
    'url = https://github.com/other/upstream.git',
    'fetch = +refs/heads/*:refs/remotes/upstream/*',
    '[remote "origin"]',
    'url = https://cnb.cool/owner/repo.git',
    'fetch = +refs/heads/*:refs/remotes/origin/*',
    '[branch "main"]',
    'remote = origin',
    'merge = refs/heads/main',
  ].join('\n'))
  writeFileSync(join(gitDir, 'HEAD'), 'ref: refs/heads/main\n')

  const result = detectProjectGit(repo)
  assert.equal(result.ok, true)
  assert.equal(result.exists, true)
  assert.equal(result.isGitRepo, true)
  assert.equal(result.name, repo.split('/').pop())
  assert.equal(result.branch, 'main')
  // origin 排最前，且类型按 URL 识别。
  assert.equal(result.remotes[0]?.name, 'origin')
  assert.equal(result.remotes[0]?.kind, 'cnb')
  assert.equal(result.remotes[1]?.name, 'upstream')
  assert.equal(result.remotes[1]?.kind, 'github')

  rmSync(repo, { recursive: true, force: true })
})

test('路径检测：worktree 指针文件可解析真实 gitdir', () => {
  const repo = mkdtempSync(join(tmpdir(), 'projects-wt-'))
  const realGit = mkdtempSync(join(tmpdir(), 'projects-realgit-'))
  writeFileSync(join(repo, '.git'), 'gitdir: ' + realGit + '\n')
  writeFileSync(join(realGit, 'config'), '[remote "origin"]\nurl = git@github.com:owner/wt.git\n')
  writeFileSync(join(realGit, 'HEAD'), 'ref: refs/heads/feature/x\n')

  const result = detectProjectGit(repo)
  assert.equal(result.isGitRepo, true)
  assert.equal(result.branch, 'feature/x')
  assert.equal(result.remotes[0]?.kind, 'github')

  rmSync(repo, { recursive: true, force: true })
  rmSync(realGit, { recursive: true, force: true })
})

test('路径检测：非仓库目录、不存在路径、空路径均结构化返回', () => {
  const plain = mkdtempSync(join(tmpdir(), 'projects-plain-'))
  const noRepo = detectProjectGit(plain)
  assert.equal(noRepo.exists, true)
  assert.equal(noRepo.isGitRepo, false)

  const missing = detectProjectGit('/definitely/not/exist-xyz')
  assert.equal(missing.exists, false)
  assert.ok((missing.error ?? '').includes('路径不存在'))

  const empty = detectProjectGit('')
  assert.equal(empty.exists, false)
  assert.equal(empty.error, 'path 不能为空')

  rmSync(plain, { recursive: true, force: true })
})
