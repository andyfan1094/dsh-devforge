/**
 * devforge_db 工具组测试 —— agent-tools。
 *
 * 覆盖：schema/query（只读校验与截断）/credential（明文）/config（白名单）/backup_read（加密容器往返）。
 * 隔离：DSH_HOME 指向临时目录，库用 closeAllDb 清理。
 */
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { closeAllDb, getDb } from '../src/store/db.ts'
import { devforgeDbTools, closeReadOnlyDb } from '../src/store/agent-tools.ts'
import { buildBackupContainer } from '../src/backup/snapshot.ts'
import { encryptBackupContainer } from '../src/backup/crypto.ts'

/** 临时 HOME。 */
const tempHome = mkdtempSync(join(tmpdir(), 'dsh-devforge-agent-tools-'))
const previousHome = process.env.DSH_HOME
process.env.DSH_HOME = tempHome

test.after(() => {
  closeReadOnlyDb()
  closeAllDb()
  process.env.DSH_HOME = previousHome
  rmSync(tempHome, { recursive: true, force: true })
})

/** 按名字取工具并直接调用 execute。 */
async function callTool(name: string, args: Record<string, unknown> = {}): Promise<any> {
  const tool = devforgeDbTools().find((item) => item.name === name)
  assert.ok(tool, '工具未注册：' + name)
  return await (tool as unknown as { execute: (args: Record<string, unknown>) => Promise<unknown> }).execute(args)
}

/** 造库数据与库外配置文件。 */
function seed(): void {
  mkdirSync(join(tempHome, 'devforge'), { recursive: true })
  const db = getDb()
  const insertDoc = db.prepare('INSERT OR REPLACE INTO docs(domain, id, data, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
  for (let index = 0; index < 3; index += 1) {
    insertDoc.run('cnb.account', 'account-' + index, JSON.stringify({ alias: 'a' + index, token: 'tk-' + index }), index, 1, 1)
  }
  db.prepare('INSERT OR REPLACE INTO credential(ref, value, updated_at) VALUES (?, ?, ?)').run('ZAI_CODING_CN_API_KEY', 'zai-key-abcdef123456', 1)
  writeFileSync(join(tempHome, 'dsh-feishu.json'), JSON.stringify({ appId: 'cli_1', appSecret: 'fs-secret-1234' }), 'utf8')
  writeFileSync(join(tempHome, 'devforge', 'backup-secret.json'), JSON.stringify({ password: '123456' }), 'utf8')
  writeFileSync(join(tempHome, '.credentials.yaml'), 'version: 1\nrefs:\n  ZAI_CODING_CN_API_KEY: zai-key-abcdef123456\n', 'utf8')
}

test('devforge_db_schema：返回业务表与域统计', async () => {
  seed()
  const result = await callTool('devforge_db_schema')
  assert.equal(result.ok, true)
  const names = (result.tables as Array<{ name: string }>).map((table) => table.name)
  for (const expected of ['meta', 'docs', 'settings', 'credential']) assert.ok(names.includes(expected))
  assert.equal(result.docsDomains[0].domain, 'cnb.account')
  assert.equal(result.credentialCount, 1)
})

test('devforge_db_query：SELECT 放行 + 行数与单元格截断 + 参数绑定', async () => {
  const ok = await callTool('devforge_db_query', { sql: 'SELECT id, data FROM docs WHERE domain = ? ORDER BY id', args: ['cnb.account'] })
  assert.equal(ok.ok, true)
  assert.equal(ok.rowCount, 3)
  assert.equal(ok.readonlyGuard, 'connection')

  const limited = await callTool('devforge_db_query', { sql: 'SELECT id FROM docs', limit: 2 })
  assert.equal(limited.rowCount, 2)

  // 单元格截断：造一个超长值再查。
  const db = getDb()
  db.prepare("INSERT OR REPLACE INTO settings(domain, data, updated_at) VALUES ('big', ?, 1)").run('x'.repeat(6000))
  const big = await callTool('devforge_db_query', { sql: "SELECT data FROM settings WHERE domain = 'big'" })
  assert.ok(String(big.rows[0].data).endsWith('…[截断]'))
  db.prepare("DELETE FROM settings WHERE domain = 'big'").run()
})

test('devforge_db_query：写语句全部拒绝（含 WITH-INSERT 与多语句）', async () => {
  for (const sql of [
    "INSERT INTO docs(domain, id, data) VALUES ('x', 'y', 'z')",
    'UPDATE docs SET data = data',
    'DELETE FROM docs',
    'ATTACH DATABASE ? AS evil',
    'PRAGMA journal_mode = DELETE',
    'WITH t AS (SELECT 1) INSERT INTO docs(domain, id, data) SELECT 1, 2, 3',
    'DROP TABLE docs',
    "SELECT 1; DROP TABLE docs",
  ]) {
    const result = await callTool('devforge_db_query', { sql })
    assert.equal(result.ok, false, '写语句未被拒绝：' + sql)
    assert.ok(typeof result.error === 'string' && result.error !== '')
  }
})

test('devforge_db_credential：列名与明文', async () => {
  const list = await callTool('devforge_db_credential')
  assert.deepEqual(list.refs, ['ZAI_CODING_CN_API_KEY'])
  const revealed = await callTool('devforge_db_credential', { ref: 'ZAI_CODING_CN_API_KEY' })
  assert.equal(revealed.value, 'zai-key-abcdef123456')
  const missing = await callTool('devforge_db_credential', { ref: 'NOPE' })
  assert.equal(missing.ok, false)
})

test('devforge_db_config：三个白名单与明文返回', async () => {
  const feishu = await callTool('devforge_db_config', { name: 'feishu' })
  assert.equal(feishu.config.appSecret, 'fs-secret-1234')
  const secret = await callTool('devforge_db_config', { name: 'backup-secret' })
  assert.equal(secret.password, '123456')
  const yamlRefs = await callTool('devforge_db_config', { name: 'credentials-yaml' })
  assert.deepEqual(yamlRefs.refs, ['ZAI_CODING_CN_API_KEY'])
  const yamlFull = await callTool('devforge_db_config', { name: 'credentials-yaml', values: true })
  assert.ok(String(yamlFull.content).includes('zai-key-abcdef123456'))
})

test('devforge_db_backup_read：本地加密容器往返（清单 + 飞书配置 + 快照 SQL）', async () => {
  const { plaintext } = buildBackupContainer()
  const containerPath = join(tempHome, 'devforge', 'test-container.bin')
  const encrypted = await encryptBackupContainer(plaintext, '654321')
  writeFileSync(containerPath, encrypted)

  const overview = await callTool('devforge_db_backup_read', { source: 'local', path: containerPath, password: '654321' })
  assert.equal(overview.ok, true)
  assert.ok((overview.files as string[]).includes('store.db'))
  assert.equal(overview.feishuConfig.appSecret, 'fs-secret-1234')

  const queried = await callTool('devforge_db_backup_read', { source: 'local', path: containerPath, password: '654321', sql: 'SELECT ref FROM credential ORDER BY ref' })
  assert.equal(queried.snapshotQuery.ok, true)
  assert.deepEqual(queried.snapshotQuery.rows, [{ ref: 'ZAI_CODING_CN_API_KEY' }])

  const wrongPassword = await callTool('devforge_db_backup_read', { source: 'local', path: containerPath, password: '000000' })
  assert.equal(wrongPassword.ok, false)
})
