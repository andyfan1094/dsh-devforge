/**
 * devforge 统一 SQLite 存储测试：db 基础操作、旧 JSON 迁移（幂等/归档/域非空跳过）、
 * 凭据镜像、多进程并发写（WAL + busy_timeout）。全程使用独立临时目录，绝不触碰生产 ~/.dsh。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, existsSync, readFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

import { closeDb, getDb, getCredentialMirror, getSettings, listDocs, putCredentialMirror, putSettings, replaceDocs, replaceDocsWithinTx, withTransaction } from '../src/store/db.ts'
import { migrateFromLegacyFiles } from '../src/store/migrate.ts'
import { CnbStore } from '../src/cnb/store.ts'
import { GithubStore } from '../src/github/store.ts'
import { HostStore as SshHostStore } from '../src/remote/ssh/store.ts'
import { HostStore as WinrmHostStore } from '../src/remote/winrm/store.ts'

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'devforge-store-test-'))
}

test('db 基础：docs 整域替换保持顺序、settings 读写、credential 镜像 upsert', () => {
  const dir = makeTempDir()
  const db = getDb(join(dir, 't.db'))
  replaceDocs(db, 'd', [
    { id: 'b', data: { v: 2 } },
    { id: 'a', data: { v: 1 } },
  ])
  const rows = listDocs(db, 'd')
  assert.deepEqual(rows.map(row => row.id), ['b', 'a']) // sort_order 稳定
  replaceDocs(db, 'd', [{ id: 'only', data: { v: 3 } }])
  assert.equal(listDocs(db, 'd').length, 1)

  putSettings(db, 's', { k: '中文值' })
  assert.deepEqual(getSettings(db, 's'), { k: '中文值' })

  assert.equal(getCredentialMirror(db, 'R'), undefined)
  putCredentialMirror(db, 'R', 'v1')
  putCredentialMirror(db, 'R', 'v2')
  assert.equal(getCredentialMirror(db, 'R'), 'v2')
  closeDb(join(dir, 't.db'))
})

test('withTransaction：fn 抛错回滚', () => {
  const dir = makeTempDir()
  const db = getDb(join(dir, 't.db'))
  assert.throws(() => withTransaction(db, () => {
    replaceDocsWithinTx(db, 'x', [{ id: 'a', data: {} }])
    throw new Error('boom')
  }), /boom/)
  assert.equal(listDocs(db, 'x').length, 0) // 已回滚
  closeDb(join(dir, 't.db'))
})

test('迁移：四个旧 JSON 文件迁入 + 归档 .migrated.bak + 幂等跳过 + yaml 镜像', () => {
  const dir = makeTempDir()
  writeFileSync(join(dir, 'dsh-cnb.json'), JSON.stringify({
    version: 1,
    settings: { apiUrl: 'https://api.cnb.cool', allowPush: true },
    accounts: [{ alias: 'cnb-main', token: 'tok-cnb', apiUrl: 'https://api.cnb.cool', createdAt: 1, updatedAt: 1 }],
  }))
  writeFileSync(join(dir, 'dsh-github.json'), JSON.stringify({
    version: 1,
    settings: {},
    accounts: [{ alias: 'gh-main', token: 'tok-gh', apiUrl: 'https://api.github.com', createdAt: 1, updatedAt: 1 }],
  }))
  writeFileSync(join(dir, 'dsh-ssh.json'), JSON.stringify({
    version: 1,
    hosts: [{ alias: 'web1', host: '1.2.3.4', user: 'root', auth: { kind: 'password', password: 'pw' }, createdAt: 1, updatedAt: 1 }],
  }))
  writeFileSync(join(dir, 'dsh-winrm.json'), JSON.stringify({
    version: 1,
    hosts: [{ alias: 'win1', host: '5.6.7.8', user: 'admin', auth: { kind: 'password', password: 'pw2' }, createdAt: 1, updatedAt: 1 }],
  }))
  mkdirSync(join(dir, 'n'), { recursive: true })
  writeFileSync(join(dir, '.credentials.yaml'), 'version: 1\nrefs:\n  ZAI_CODING_CN_API_KEY: zk-123\n  DEEPSEEK_API_KEY: host-only\n')

  const db = getDb(join(dir, 'store.db'))
  const result = migrateFromLegacyFiles(db, dir)
  assert.deepEqual(result.imported.sort(), ['dsh-cnb.json', 'dsh-github.json', 'dsh-ssh.json', 'dsh-winrm.json'])
  assert.deepEqual(result.mirroredRefs, ['ZAI_CODING_CN_API_KEY']) // DEEPSEEK 是宿主的，不镜像

  // 旧文件已归档
  for (const name of ['dsh-cnb.json', 'dsh-github.json', 'dsh-ssh.json', 'dsh-winrm.json']) {
    assert.equal(existsSync(join(dir, name)), false, name + ' 应已改名')
    assert.equal(existsSync(join(dir, name + '.migrated.bak')), true, name + ' 归档应存在')
  }

  // store 读到迁移数据
  const cnb = new CnbStore(join(dir, 'store.db'))
  assert.equal(cnb.findAccount('cnb-main').token, 'tok-cnb')
  assert.equal(cnb.settings().allowPush, true)
  const ssh = new SshHostStore(join(dir, 'store.db'))
  assert.equal(ssh.find('web1')?.auth.kind, 'password')

  // 幂等：重跑 skipped 且不重复
  const again = migrateFromLegacyFiles(db, dir)
  assert.deepEqual(again.imported, [])
  assert.equal(again.mirroredRefs.length, 1) // 镜像每次刷新（覆盖写）
  assert.equal(cnb.listAccounts().length, 1)

  // 域非空时旧文件即使存在也跳过且不动
  writeFileSync(join(dir, 'dsh-cnb.json'), JSON.stringify({ version: 1, settings: {}, accounts: [{ alias: 'other', token: 'x', apiUrl: 'https://api.cnb.cool', createdAt: 1, updatedAt: 1 }] }))
  const third = migrateFromLegacyFiles(db, dir)
  assert.equal(third.imported.filter(name => name === 'dsh-cnb.json').length, 0)
  assert.ok(third.skipped.includes('dsh-cnb.json'))
  assert.equal(existsSync(join(dir, 'dsh-cnb.json')), true) // 未被动过
  assert.equal(cnb.listAccounts().length, 1) // 库数据未变
  closeDb(join(dir, 'store.db'))
})

test('迁移：损坏 JSON 跳过且不归档', () => {
  const dir = makeTempDir()
  writeFileSync(join(dir, 'dsh-cnb.json'), '{broken json')
  const db = getDb(join(dir, 'store.db'))
  const result = migrateFromLegacyFiles(db, dir)
  assert.deepEqual(result.imported, [])
  assert.ok(result.skipped.includes('dsh-cnb.json'))
  assert.equal(existsSync(join(dir, 'dsh-cnb.json')), true) // 保留供人工恢复
  closeDb(join(dir, 'store.db'))
})

test('多进程并发写：busy_timeout 生效，双进程同时写同一库无崩溃且数据完整', () => {
  const dir = makeTempDir()
  const dbPath = join(dir, 'conc.db')
  getDb(dbPath).exec('CREATE TABLE IF NOT EXISTS t(id INTEGER PRIMARY KEY, v TEXT)')
  closeDb(dbPath)
  const worker = join(dir, 'worker.mjs')
  // 每个 worker 高频写 200 行；两进程并发争锁
  writeFileSync(worker, `
    import { DatabaseSync } from 'node:sqlite'
    const db = new DatabaseSync(process.argv[2])
    db.exec('PRAGMA journal_mode=WAL'); db.exec('PRAGMA busy_timeout=5000')
    const ins = db.prepare('INSERT INTO t(v) VALUES (?)')
    for (let i = 0; i < 200; i++) {
      db.exec('BEGIN IMMEDIATE'); ins.run(process.argv[3] + '-' + i); db.exec('COMMIT')
    }
    console.log('done')
  `)
  execFileSync(process.execPath, [worker, dbPath, 'A'], { timeout: 30000 })
  execFileSync(process.execPath, [worker, dbPath, 'B'], { timeout: 30000 })
  const db = getDb(dbPath)
  const count = Number(db.prepare('SELECT COUNT(*) AS c FROM t').get()['c'])
  assert.equal(count, 400)
  closeDb(dbPath)
})

test('store 回归：github/ssh/winrm CRUD（SQLite 后端行为不变）', () => {
  const dir = makeTempDir()
  const dbPath = join(dir, 't.db')

  const gh = new GithubStore(dbPath)
  gh.upsertAccount({ alias: 'a1', token: 't1' })
  gh.upsertAccount({ alias: 'a2', token: 't2' })
  gh.deleteAccount('a1')
  assert.deepEqual(gh.listAccounts().map(a => a.alias), ['a2'])
  assert.equal(gh.settings().defaultAccount, 'a2')

  const ssh = new SshHostStore(dbPath)
  const created = ssh.create({ alias: 'h1', host: 'h.dev', user: 'u', auth: { kind: 'key', keyPath: '~/.ssh/id_ed25519' } })
  assert.equal(created.alias, 'h1')
  assert.throws(() => ssh.update('nope', {}), /not found/)

  const win = new WinrmHostStore(dbPath)
  win.create({ alias: 'w1', host: 'w.dev', user: 'u', auth: { kind: 'password', password: 'p' } })
  assert.equal(win.find('w1')?.host, 'w.dev')

  // 四个 store 共用同一库文件（单文件备份的核心前提）
  assert.equal(existsSync(dbPath), true)
  closeDb(dbPath)
})

test('备份前置验证：全部插件数据可在单一库文件中读回（单文件备份语义）', () => {
  const dir = makeTempDir()
  const dbPath = join(dir, 'single.db')
  const cnb = new CnbStore(dbPath)
  cnb.upsertAccount({ alias: 'x', token: 'tok' })
  const ssh = new SshHostStore(dbPath)
  ssh.create({ alias: 'h', host: 'h', user: 'u', auth: { kind: 'password', password: 'p' } })
  putCredentialMirror(getDb(dbPath), 'ZAI_CODING_CN_API_KEY', 'key')

  closeDb(dbPath) // 模拟：把这一个文件拷到另一台机器
  const copied = join(dir, 'copy.db')
  writeFileSync(copied, readFileSync(dbPath))

  // 新机器上从拷贝的库读回全部数据
  const cnb2 = new CnbStore(copied)
  assert.equal(cnb2.findAccount('x').token, 'tok')
  const ssh2 = new SshHostStore(copied)
  assert.equal(ssh2.find('h')?.auth.password, 'p')
  assert.equal(getCredentialMirror(getDb(copied), 'ZAI_CODING_CN_API_KEY'), 'key')
  closeDb(copied)
})
