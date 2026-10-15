/**
 * GitHub Git 认证注入单测。
 * 覆盖点：git-over-HTTPS 必须用 Basic（Bearer 会被 GitHub 判 invalid credentials）、
 * base64 形态的脱敏，以及认证失败时的可操作中文提示。
 * 做法：把 gitExecutable 指向 node 自身，用 `-e` 脚本扮演 git，从而在没有真实远端的情况下
 * 精确断言注入的环境变量与脱敏结果。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { GitRunner, githubGitAuthHeader } from '../src/github/git.ts'
import type { StoredAccount } from '../src/github/store.ts'
import { GithubStore } from '../src/github/store.ts'
import { closeDb } from '../src/store/db.ts'

const TOKEN = 'ghp_testtoken0000000000000000000000000000'
const ACCOUNT: StoredAccount = { alias: 'probe', token: TOKEN, apiUrl: 'https://api.github.com', createdAt: 0, updatedAt: 0 }

/** 用 node 自身扮演 git：把注入的认证头解码后回显，用于验证注入内容。 */
const ECHO_DECODED_HEADER = "const v=process.env.GIT_CONFIG_VALUE_0||'';const b64=v.split(' ').pop();process.stdout.write(Buffer.from(b64,'base64').toString('utf8'))"
/** 用 node 自身扮演 git：模拟 GitHub 拒绝令牌。 */
const REJECT_TOKEN = "process.stderr.write('remote: invalid credentials\\nfatal: Authentication failed for https://github.com/x/y\\n');process.exit(1)"

test('githubGitAuthHeader：输出 Basic 形态，解码后为 x-access-token:<token>', () => {
  const header = githubGitAuthHeader(TOKEN)
  assert.ok(header.startsWith('Authorization: Basic '), '必须是 Basic，Bearer 会被 GitHub 拒绝：' + header)
  const decoded = Buffer.from(header.slice('Authorization: Basic '.length), 'base64').toString('utf8')
  assert.equal(decoded, 'x-access-token:' + TOKEN)
  assert.ok(!header.includes(TOKEN), '头部不得出现明文令牌')
})

test('GitRunner：注入 Basic 头，且明文与 base64 形态都被脱敏', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'github-auth-'))
  const dbPath = join(dir, 'store.db')
  try {
    const store = new GithubStore(dbPath)
    store.updateSettings({ gitExecutable: process.execPath })
    const result = await new GitRunner(store).run(['-e', ECHO_DECODED_HEADER], dir, ACCOUNT)
    assert.equal(result.ok, true, result.stderr)
    // 回显内容经脱敏后只剩用户名前缀，明文令牌被替换。
    assert.equal(result.stdout, 'x-access-token:[redacted-token]')
    assert.ok(!JSON.stringify(result).includes(TOKEN), '结果中不得残留明文令牌')
  } finally {
    closeDb(dbPath)
    await rm(dir, { recursive: true, force: true })
  }
})

test('GitRunner：未指定账号时不注入认证头', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'github-auth-'))
  const dbPath = join(dir, 'store.db')
  try {
    const store = new GithubStore(dbPath)
    store.updateSettings({ gitExecutable: process.execPath })
    const result = await new GitRunner(store).run(['-e', ECHO_DECODED_HEADER], dir)
    assert.equal(result.ok, true, result.stderr)
    assert.equal(result.stdout, '', '无账号时不应注入任何认证头')
  } finally {
    closeDb(dbPath)
    await rm(dir, { recursive: true, force: true })
  }
})

test('GitRunner：令牌被拒时给出可操作的中文提示', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'github-auth-'))
  const dbPath = join(dir, 'store.db')
  try {
    const store = new GithubStore(dbPath)
    store.updateSettings({ gitExecutable: process.execPath })
    const result = await new GitRunner(store).run(['-e', REJECT_TOKEN], dir, ACCOUNT)
    assert.equal(result.ok, false)
    assert.ok((result.error ?? '').includes('令牌'), '需指明是令牌被拒：' + result.error)
    assert.ok((result.error ?? '').includes('账号'), '需给出可操作的账号处理入口')
  } finally {
    closeDb(dbPath)
    await rm(dir, { recursive: true, force: true })
  }
})
