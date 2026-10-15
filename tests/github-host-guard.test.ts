/**
 * Git 远端主机护栏测试。
 * 背景：dsh-devforge 仓库的 origin 指向 cnb.cool，github_push 默认 remote=origin，
 * 会把 GitHub 令牌发给 CNB 服务器。护栏保证 push/pull 只在 GitHub 主机上执行，
 * clone 遇到非 GitHub 主机则不注入令牌。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { GithubEngine } from '../src/github/engine.ts'
import { GithubStore } from '../src/github/store.ts'
import { assertGithubRemoteHost, githubGitHost, isGithubHost, parseGitRemoteHost } from '../src/github/host-guard.ts'
import { closeDb } from '../src/store/db.ts'

const API = 'https://api.github.com'

test('parseGitRemoteHost：识别 https / ssh / scp-like / 空值', () => {
  assert.equal(parseGitRemoteHost('https://github.com/andyfan1094/dsh-devforge.git'), 'github.com')
  assert.equal(parseGitRemoteHost('https://cnb.cool/andyfan1094/dsh-devforge'), 'cnb.cool')
  assert.equal(parseGitRemoteHost('ssh://git@github.com/andyfan1094/dsh-devforge.git'), 'github.com')
  assert.equal(parseGitRemoteHost('git@github.com:andyfan1094/dsh-devforge.git'), 'github.com')
  assert.equal(parseGitRemoteHost('  '), undefined)
  assert.equal(parseGitRemoteHost('not a url'), undefined)
})

test('githubGitHost：官方地址推导为 github.com，企业版保留其主机', () => {
  assert.equal(githubGitHost('https://api.github.com'), 'github.com')
  assert.equal(githubGitHost('https://github.com'), 'github.com')
  assert.equal(githubGitHost('https://api.ghe.internal.corp/api/v3'), 'ghe.internal.corp')
  assert.equal(githubGitHost('不是地址'), 'github.com')
})

test('isGithubHost：只认与 API 地址同源的 Git 主机', () => {
  assert.equal(isGithubHost('git@github.com:a/b.git', API), true)
  assert.equal(isGithubHost('https://cnb.cool/a/b', API), false)
  assert.equal(isGithubHost('', API), false)
})

test('assertGithubRemoteHost：非 GitHub 远端抛出可操作中文错误', () => {
  assert.doesNotThrow(() => assertGithubRemoteHost('https://github.com/a/b.git', API, 'github'))
  assert.throws(
    () => assertGithubRemoteHost('https://cnb.cool/andyfan1094/dsh-devforge', API, 'origin'),
    (error: Error) => error.message.includes('cnb.cool') && error.message.includes('不是 GitHub 主机') && error.message.includes('已中止'),
  )
})

/** 建一个只有 origin 的最小仓库（含一个可用账号），用于验证引擎级护栏。 */
async function fixtureRepo(origin: string): Promise<{ repo: string; dbPath: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'host-guard-'))
  spawnSync('git', ['init', '--quiet'], { cwd: dir })
  spawnSync('git', ['remote', 'add', 'origin', origin], { cwd: dir })
  const dbPath = join(dir, 'store.db')
  const store = new GithubStore(dbPath)
  store.upsertAccount({ alias: 'probe', token: 'ghp_probe_token_for_host_guard_test' })
  store.updateSettings({ allowPush: true })
  closeDb(dbPath)
  return { repo: dir, dbPath }
}

test('GithubEngine：origin 指向 cnb.cool 时 push 被护栏中止（令牌不外发）', async () => {
  const { repo, dbPath } = await fixtureRepo('https://cnb.cool/andyfan1094/dsh-devforge')
  try {
    const engine = new GithubEngine(new GithubStore(dbPath))
    await assert.rejects(
      () => engine.action({ action: 'push', repoPath: repo }),
      (error: Error) => error.message.includes('cnb.cool') && error.message.includes('不是 GitHub 主机'),
    )
  } finally {
    closeDb(dbPath)
    await rm(repo, { recursive: true, force: true })
  }
})

test('GithubEngine：origin 指向 cnb.cool 时 pull 同样被中止', async () => {
  const { repo, dbPath } = await fixtureRepo('https://cnb.cool/andyfan1094/dsh-devforge')
  try {
    const engine = new GithubEngine(new GithubStore(dbPath))
    await assert.rejects(
      () => engine.action({ action: 'pull', repoPath: repo }),
      (error: Error) => error.message.includes('不是 GitHub 主机'),
    )
  } finally {
    closeDb(dbPath)
    await rm(repo, { recursive: true, force: true })
  }
})

test('GithubEngine：远端不存在时给出可读提示（不误报为令牌问题）', async () => {
  const { repo, dbPath } = await fixtureRepo('https://cnb.cool/andyfan1094/dsh-devforge')
  try {
    const engine = new GithubEngine(new GithubStore(dbPath))
    await assert.rejects(
      () => engine.action({ action: 'push', repoPath: repo, remote: 'github' }),
      (error: Error) => error.message.includes('无法读取远端'),
    )
  } finally {
    closeDb(dbPath)
    await rm(repo, { recursive: true, force: true })
  }
})
