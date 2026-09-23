/**
 * 数据管理路由族测试 —— dbadmin-routes。
 *
 * 覆盖：表清单/数据分页/凭据掩码与明文 reveal/库外配置白名单/loopback 围栏。
 * 隔离：DSH_HOME 指向临时目录（dshHome() 实时读 env），库用 closeAllDb 清理。
 */
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { closeAllDb, getDb } from '../src/store/db.ts'
import { DB_ADMIN_API } from '../src/store/dbadmin-protocol.ts'
import { makeDbAdminRoutes, maskSecret } from '../src/store/dbadmin-routes.ts'

/** 临时 HOME（每个测试文件一份；finally 恢复 env）。 */
const tempHome = mkdtempSync(join(tmpdir(), 'dsh-devforge-dbadmin-'))
const previousHome = process.env.DSH_HOME
process.env.DSH_HOME = tempHome

test.after(() => {
  closeAllDb()
  process.env.DSH_HOME = previousHome
  rmSync(tempHome, { recursive: true, force: true })
})

/** 造独立测试库数据（走 getDb() 默认路径 = 临时 HOME/devforge/store.db）。 */
function seedDb(): void {
  mkdirSync(join(tempHome, 'devforge'), { recursive: true })
  const db = getDb()
  db.prepare("INSERT OR REPLACE INTO meta(key, value) VALUES ('schema_version', '1')").run()
  const insertDoc = db.prepare('INSERT OR REPLACE INTO docs(domain, id, data, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
  insertDoc.run('cnb.account', 'main', JSON.stringify({ alias: 'main', token: 'cnb-token-abcdef123456' }), 0, 1, 1)
  insertDoc.run('ssh.host', 'my', JSON.stringify({ alias: 'my', host: '192.168.71.13' }), 0, 1, 1)
  const putSetting = db.prepare('INSERT OR REPLACE INTO settings(domain, data, updated_at) VALUES (?, ?, ?)')
  putSetting.run('rag.settings', JSON.stringify({ topK: 8 }), 1)
  db.prepare('INSERT OR REPLACE INTO credential(ref, value, updated_at) VALUES (?, ?, ?)').run('ZAI_CODING_CN_API_KEY', 'secret-zai-value-9876543210', 1)
}

/** 造临时库外配置文件。 */
function seedConfigFiles(): void {
  writeFileSync(join(tempHome, 'dsh-feishu.json'), JSON.stringify({ enabled: true, appId: 'cli_123', appSecret: 'feishu-secret-abcdef1234' }), 'utf8')
  mkdirSync(join(tempHome, 'devforge'), { recursive: true })
  writeFileSync(join(tempHome, 'devforge', 'backup-secret.json'), JSON.stringify({ password: '654321' }), 'utf8')
  writeFileSync(join(tempHome, '.credentials.yaml'), 'version: 1\nrefs:\n  ZAI_CODING_CN_API_KEY: secret-zai-value-9876543210\n  MINIMAX_CN_API_KEY: mm-key-value-123456\n', 'utf8')
}

/** 调用一条 dbadmin 路由（mock req/res，参照 plugin-update.test.ts 同款）。 */
async function callRoute(path: string, options: { method?: string; body?: unknown; remoteAddress?: string } = {}): Promise<{ status: number; payload: Record<string, unknown>; audits: string[] }> {
  const audits: string[] = []
  const routes = makeDbAdminRoutes({ info: (message: string) => { audits.push(message) } })
  // exact 匹配按路径（不含 query）；query 通过 req.url 传给 handler。
  const route = routes.find((item) => item.path === path.split('?')[0])
  assert.ok(route, '路由未注册：' + path)
  const method = options.method ?? 'GET'
  const req = {
    method,
    socket: { remoteAddress: options.remoteAddress ?? '127.0.0.1' },
    headers: {},
    url: path,
    on(event: string, cb: (arg?: unknown) => void) {
      if (event === 'data' && options.body !== undefined) cb(Buffer.from(JSON.stringify(options.body)))
      if (event === 'end') cb()
    },
  } as unknown as import('node:http').IncomingMessage
  let status = 0
  let payload: Record<string, unknown> = {}
  const res = {
    writeHead(code: number) { status = code },
    end(raw: string) { payload = JSON.parse(String(raw)) as Record<string, unknown> },
  } as unknown as import('node:http').ServerResponse
  await route.handler(req, res)
  return { status, payload, audits }
}

test('掩码函数：短值全掩码、长值只露尾 4 位', () => {
  assert.equal(maskSecret('654321'), '••••••')
  assert.equal(maskSecret('secret-zai-value-9876543210'), '••••3210')
  assert.ok(!maskSecret('secret-zai-value-9876543210').includes('secret'))
})

test('tables：返回四张业务表与 docs 域统计', async () => {
  seedDb()
  seedConfigFiles()
  const { status, payload } = await callRoute(DB_ADMIN_API.tables)
  assert.equal(status, 200)
  assert.equal(payload.ok, true)
  const tables = payload.tables as Array<{ name: string; rowCount: number }>
  const names = tables.map((table) => table.name)
  for (const expected of ['meta', 'docs', 'settings', 'credential']) assert.ok(names.includes(expected), '缺表：' + expected)
  const docs = tables.find((table) => table.name === 'docs')
  assert.equal(docs?.rowCount, 2)
  const docsDomains = payload.docsDomains as Array<{ domain: string; count: number }>
  assert.equal(docsDomains.find((item) => item.domain === 'cnb.account')?.count, 1)
})

test('rows：分页返回数据行；非法表名拒绝；sqlite_ 系统表不可见', async () => {
  const ok = await callRoute(DB_ADMIN_API.rows + '?table=docs&page=1&pageSize=1')
  assert.equal(ok.status, 200)
  const rows = ok.payload.rows as Array<Record<string, unknown>>
  assert.equal(rows.length, 1)
  assert.equal(ok.payload.total, 2)

  const bad = await callRoute(DB_ADMIN_API.rows + '?table=' + encodeURIComponent('docs" ; DROP TABLE docs--'))
  assert.equal(bad.status, 400)

  const system = await callRoute(DB_ADMIN_API.rows + '?table=sqlite_master')
  assert.equal(system.status, 400)
})

test('rows：关键字搜索命中 data 列', async () => {
  const hit = await callRoute(DB_ADMIN_API.rows + '?table=docs&search=' + encodeURIComponent('192.168.71.13'))
  assert.equal(hit.status, 200)
  assert.equal(hit.payload.total, 1)
})

test('credential-refs：只回掩码，响应体不含明文', async () => {
  const { status, payload } = await callRoute(DB_ADMIN_API.credentialRefs)
  assert.equal(status, 200)
  const refs = payload.refs as Array<{ ref: string; masked: string }>
  assert.equal(refs.length, 1)
  assert.equal(refs[0].ref, 'ZAI_CODING_CN_API_KEY')
  assert.ok(!JSON.stringify(payload).includes('secret-zai-value'), '掩码视图泄漏了明文')
})

test('credential-reveal：POST 返回明文并写审计日志；GET 拒绝', async () => {
  const revealed = await callRoute(DB_ADMIN_API.credentialReveal, { method: 'POST', body: { ref: 'ZAI_CODING_CN_API_KEY' } })
  assert.equal(revealed.status, 200)
  assert.equal(revealed.payload.value, 'secret-zai-value-9876543210')
  assert.ok(revealed.audits.some((line) => line.includes('ZAI_CODING_CN_API_KEY')), 'reveal 未写审计日志')
  assert.ok(revealed.audits.every((line) => !line.includes('secret-zai-value')), '审计日志泄漏了明文')

  const denied = await callRoute(DB_ADMIN_API.credentialReveal, { method: 'GET' })
  assert.equal(denied.status, 405)

  const missing = await callRoute(DB_ADMIN_API.credentialReveal, { method: 'POST', body: { ref: 'NO_SUCH_REF' } })
  assert.equal(missing.status, 404)
})

test('config-files：白名单三项掩码预览；config-reveal 返回明文', async () => {
  const list = await callRoute(DB_ADMIN_API.configFiles)
  assert.equal(list.status, 200)
  const files = list.payload.files as Array<{ name: string; exists: boolean; maskedPreview?: string; keys: string[] }>
  const feishu = files.find((file) => file.name === 'feishu')
  assert.ok(feishu?.exists)
  assert.ok(feishu?.keys.includes('appSecret'))
  assert.ok(!JSON.stringify(list.payload).includes('feishu-secret'), '配置清单泄漏了 appSecret 明文')
  const backup = files.find((file) => file.name === 'backup-secret')
  assert.equal(backup?.maskedPreview, '••••••')
  const yaml = files.find((file) => file.name === 'credentials-yaml')
  assert.ok(yaml?.keys.includes('ZAI_CODING_CN_API_KEY'))

  const revealed = await callRoute(DB_ADMIN_API.configReveal, { method: 'POST', body: { name: 'feishu' } })
  assert.equal(revealed.status, 200)
  assert.ok(String(revealed.payload.value).includes('feishu-secret-abcdef1234'))
  assert.ok(revealed.audits.every((line) => !line.includes('feishu-secret')), '审计日志泄漏了配置明文')

  const outside = await callRoute(DB_ADMIN_API.configReveal, { method: 'POST', body: { name: 'package.json' } })
  assert.equal(outside.status, 400)
})

test('非 loopback 请求直接 403', async () => {
  const denied = await callRoute(DB_ADMIN_API.tables, { remoteAddress: '203.0.113.9' })
  assert.equal(denied.status, 403)
})
