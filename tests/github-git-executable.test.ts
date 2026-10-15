/**
 * GitHub Git 可执行文件解析单测。
 * 覆盖点：跨平台迁移坏值的自动回退、可操作的中文错误提示，以及真实 spawn 的端到端行为。
 * 背景：旧环境迁移来的 macOS 绝对路径会让 github_* 整族工具直接 ENOENT（2026-10-15 实测）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describeGitStartFailure, GitRunner, resolveGitExecutable } from '../src/github/git.ts'
import { GithubStore } from '../src/github/store.ts'
import { closeDb } from '../src/store/db.ts'

/** 旧 macOS 环境迁移到本机的典型坏值。 */
const MIGRATED_MAC_HELPER = '/Users/andyfan/.dsh/bin/dsh-github-git'

test('resolveGitExecutable：空值与 git 走系统 PATH，不产生告警', () => {
  assert.deepEqual(resolveGitExecutable(undefined), { command: 'git' })
  assert.deepEqual(resolveGitExecutable(''), { command: 'git' })
  assert.deepEqual(resolveGitExecutable('  git  '), { command: 'git' })
})

test('resolveGitExecutable：迁移来的 macOS 绝对路径回退为系统 git 并说明原因', () => {
  const resolution = resolveGitExecutable(MIGRATED_MAC_HELPER)
  assert.equal(resolution.command, 'git')
  assert.ok(resolution.warning !== undefined, '回退必须带告警')
  assert.ok(resolution.warning.includes(MIGRATED_MAC_HELPER), '告警需回显失效的配置值')
  assert.ok(resolution.warning.includes('自动回退'), '告警需说明已回退')
})

test('resolveGitExecutable：本机存在的绝对路径原样使用', () => {
  assert.deepEqual(resolveGitExecutable(process.execPath), { command: process.execPath })
})

test('resolveGitExecutable：不含路径分隔符的命令名交由 PATH 解析，不做存在性判断', () => {
  assert.deepEqual(resolveGitExecutable('git.exe'), { command: 'git.exe' })
  assert.deepEqual(resolveGitExecutable('git-custom'), { command: 'git-custom' })
})

test('describeGitStartFailure：ENOENT 追加可操作中文指引并保留原始错误', () => {
  const error = Object.assign(new Error('spawn /Users/andyfan/.dsh/bin/dsh-github-git ENOENT'), { code: 'ENOENT' })
  const message = describeGitStartFailure(MIGRATED_MAC_HELPER, error)
  assert.ok(message.startsWith('unable to start git: '), '保留原前缀便于排查')
  assert.ok(message.includes(MIGRATED_MAC_HELPER), '需指明是哪个可执行文件')
  assert.ok(message.includes('git.exe'), '需给出可操作修正方向')
})

test('describeGitStartFailure：非 ENOENT 只保留原始错误', () => {
  const error = Object.assign(new Error('spawn failed'), { code: 'UNKNOWN' })
  assert.equal(describeGitStartFailure('git', error), 'unable to start git: spawn failed')
})

test('GitRunner：设置里的跨平台坏路径被回退，真实 git 命令仍可执行并带告警', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'github-git-'))
  const dbPath = join(dir, 'store.db')
  try {
    const store = new GithubStore(dbPath)
    store.updateSettings({ gitExecutable: MIGRATED_MAC_HELPER })
    const result = await new GitRunner(store).run(['--version'], dir)
    assert.equal(result.ok, true, '回退后真实 git 必须成功执行：' + result.stderr)
    assert.match(result.stdout, /git version/)
    assert.ok(result.command.startsWith('git '), '实际命令应使用系统 git：' + result.command)
    assert.ok((result.warning ?? '').includes('自动回退'), '结果需回传回退告警')
  } finally {
    closeDb(dbPath)
    await rm(dir, { recursive: true, force: true })
  }
})

test('GitRunner：设置指向本机不存在的可执行文件且回退也不可用时，错误信息可读', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'github-git-'))
  const dbPath = join(dir, 'store.db')
  try {
    const store = new GithubStore(dbPath)
    // 命令名不含分隔符，不会被回退；交给 PATH 解析必然失败。
    store.updateSettings({ gitExecutable: 'git-does-not-exist-devforge' })
    await assert.rejects(
      () => new GitRunner(store).run(['--version'], dir),
      (error: Error) => error.message.includes('找不到 Git 可执行文件'),
    )
  } finally {
    closeDb(dbPath)
    await rm(dir, { recursive: true, force: true })
  }
})
