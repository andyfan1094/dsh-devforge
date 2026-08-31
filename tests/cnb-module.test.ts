/** CNB 代码托管模块单测：存储脱敏、地址规整、OpenAPI 客户端、Git 脱敏与引擎安全默认。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { CnbStore } from '../src/cnb/store.ts'
import { CnbApi } from '../src/cnb/cnb-api.ts'
import { GitRunner } from '../src/cnb/git.ts'
import { CnbEngine, toCloneUrl } from '../src/cnb/engine.ts'

/** 极简 JSON 应答器：记录最近请求并回放预设响应。 */
function startMock(respond: (url: string) => { status?: number; payload: unknown }) {
  const calls: { auth: string; path: string }[] = []
  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    calls.push({ auth: String(req.headers.authorization ?? ''), path: req.url ?? '' })
    const outcome = respond(req.url ?? '')
    res.statusCode = outcome.status ?? 200
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(outcome.payload))
  })
  return {
    calls,
    url: new Promise<string>((resolvePromise) => {
      server.listen(0, '127.0.0.1', () => resolvePromise('http://127.0.0.1:' + (server.address() as { port: number }).port))
    }),
    close: (): Promise<void> => new Promise((resolvePromise) => server.close(() => resolvePromise())),
  }
}

test('CNB store：写入账号并脱敏返回，默认账号可省略别名', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cnb-store-'))
  try {
    const store = new CnbStore(join(dir, 'dsh-cnb.json'))
    const summary = store.upsertAccount({ alias: 'main', token: 'tok_abc123' })
    assert.equal(summary.alias, 'main')
    assert.equal(summary.tokenConfigured, true)
    assert.ok(!JSON.stringify(summary).includes('tok_abc123'), '摘要绝不回显令牌')
    assert.equal(store.findAccount().token, 'tok_abc123')
    assert.equal(store.findAccount('main').alias, 'main')
    assert.equal(store.listAccounts()[0].username, undefined)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('CNB store：findOptionalAccount 无账号返回 undefined、别名给错抛错', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cnb-store-'))
  try {
    const store = new CnbStore(join(dir, 'dsh-cnb.json'))
    assert.equal(store.findOptionalAccount(), undefined)
    assert.throws(() => store.findOptionalAccount('ghost'), /ghost/)
    store.upsertAccount({ alias: 'a', token: 't1' })
    assert.throws(() => store.findOptionalAccount('ghost'), /ghost/)
    assert.equal(store.findOptionalAccount('a')?.alias, 'a')
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('toCloneUrl：slug（含多段嵌套）/ cnb.cool 前缀 / 完整 URL', () => {
  assert.equal(toCloneUrl('andyfan1094/dsh-devforge'), 'https://cnb.cool/andyfan1094/dsh-devforge')
  assert.equal(toCloneUrl('cnb/skills/cnb-skill'), 'https://cnb.cool/cnb/skills/cnb-skill')
  assert.equal(toCloneUrl('cnb.cool/andyfan1094/dsh-devforge.git'), 'https://cnb.cool/andyfan1094/dsh-devforge')
  assert.equal(toCloneUrl('https://cnb.cool/g/r'), 'https://cnb.cool/g/r')
  assert.throws(() => toCloneUrl('not a url'))
})

test('CnbApi：请求携带 Bearer 令牌，test 回填用户名', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cnb-api-'))
  const mock = startMock((url) => {
    if (url === '/user') return { payload: { path: 'cnb.bcUlfu4jhLA', name: '关山万里' } }
    return { status: 404, payload: { message: 'not found' } }
  })
  try {
    const store = new CnbStore(join(dir, 'dsh-cnb.json'))
    store.upsertAccount({ alias: 'main', token: 'tok_xyz', apiUrl: await mock.url })
    const api = new CnbApi(store)
    const result = await api.test()
    assert.equal(result.ok, true)
    assert.equal(result.username, 'cnb.bcUlfu4jhLA')
    assert.equal(mock.calls[0].auth, 'Bearer tok_xyz')
    assert.equal(store.listAccounts()[0].username, 'cnb.bcUlfu4jhLA')
  } finally { await mock.close(); await rm(dir, { recursive: true, force: true }) }
})

test('CnbApi：listRepos 分页聚合、私有判定与 query 过滤', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cnb-api-'))
  const pageOf = (url: string): number => Number(new URL(url, 'http://x').searchParams.get('page') ?? '1')
  const mock = startMock((url) => {
    if (pageOf(url) === 1) return { payload: [
      { id: '1', name: 'dsh-devforge', path: 'andyfan1094/dsh-devforge', description: '服务工厂', web_url: 'https://cnb.cool/andyfan1094/dsh-devforge', visibility_level: 'Public', updated_at: '2026-08-31T00:00:00Z' },
      { id: '2', name: 'secret-repo', path: 'andyfan1094/secret-repo', visibility_level: 'Private' },
    ] }
    return { payload: [] }
  })
  try {
    const store = new CnbStore(join(dir, 'dsh-cnb.json'))
    store.upsertAccount({ alias: 'main', token: 'tok', apiUrl: await mock.url })
    const api = new CnbApi(store)
    const repos = await api.listRepos()
    assert.equal(repos.length, 2)
    assert.equal(repos[0].fullName, 'andyfan1094/dsh-devforge')
    assert.equal(repos[0].cloneUrl, 'https://cnb.cool/andyfan1094/dsh-devforge')
    assert.equal(repos[0].private, false)
    assert.equal(repos[1].private, true)
    const filtered = await api.listRepos(undefined, '服务工厂')
    assert.equal(filtered.length, 1)
    assert.equal(filtered[0].name, 'dsh-devforge')
  } finally { await mock.close(); await rm(dir, { recursive: true, force: true }) }
})

test('CnbApi：错误响应抛出可读消息（含状态码）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cnb-api-'))
  const mock = startMock(() => ({ status: 401, payload: { message: 'invalid token' } }))
  try {
    const store = new CnbStore(join(dir, 'dsh-cnb.json'))
    store.upsertAccount({ alias: 'main', token: 'bad', apiUrl: await mock.url })
    const api = new CnbApi(store)
    const result = await api.test()
    assert.equal(result.ok, false)
    assert.match(result.error ?? '', /invalid token \(401\)/)
  } finally { await mock.close(); await rm(dir, { recursive: true, force: true }) }
})

test('GitRunner：stdout/command 中的令牌与 Basic 凭据均被脱敏', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cnb-git-'))
  try {
    execFileSync('git', ['init', '-q'], { cwd: dir })
    const store = new CnbStore(join(dir, 'dsh-cnb.json'))
    const token = 'sup3rsecret'
    store.upsertAccount({ alias: 'a', token })
    const runner = new GitRunner(store)
    const basic = Buffer.from('cnb:' + token).toString('base64')
    const result = await runner.run(['-c', 'alias.zz=!echo ' + token + '-' + basic, 'zz'], dir, store.findAccount('a'))
    assert.equal(result.ok, true)
    assert.ok(!result.stdout.includes(token), 'stdout 不含令牌明文')
    assert.ok(!result.stdout.includes(basic), 'stdout 不含 Basic 凭据')
    assert.ok(!result.command.includes(token), 'command 不含令牌明文')
    assert.ok(result.stdout.includes('[redacted-token]'))
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('CnbEngine：push 默认关闭、commit 必须有说明、clone 目标已存在报错', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cnb-engine-'))
  try {
    execFileSync('git', ['init', '-q', 'repo'], { cwd: dir })
    const store = new CnbStore(join(dir, 'dsh-cnb.json'))
    store.upsertAccount({ alias: 'a', token: 't' })
    const engine = new CnbEngine(store)
    const repoPath = join(dir, 'repo')
    await assert.rejects(() => engine.action({ action: 'push', repoPath }), /推送默认关闭/)
    await assert.rejects(() => engine.action({ action: 'commit', repoPath }), /提交说明不能为空/)
    await assert.rejects(() => engine.action({ action: 'clone', remoteUrl: 'g/r', destination: repoPath }), /已存在/)
    // 打开推送开关后 push 进入真实执行（无远端失败），不再是安全默认拦截。
    store.updateSettings({ allowPush: true })
    const pushResult = await engine.action({ action: 'push', repoPath })
    assert.equal(pushResult.ok, false)
    assert.ok(!/推送默认关闭/.test((pushResult.error ?? '') + pushResult.stderr))
  } finally { await rm(dir, { recursive: true, force: true }) }
})
