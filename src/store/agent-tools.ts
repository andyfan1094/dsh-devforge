/**
 * devforge_db 只读查询工具组（辉哥 2026-09-23 定稿「模型可轻易获取库内一切数据」）。
 *
 * 职责边界：把 store.db 与库外敏感配置以只读方式暴露给会话内模型：
 * - schema/query：库结构与数据全透明（query 走独立只读连接 + SELECT 语法白名单双重防线）；
 * - credential：凭据镜像按需取明文（辉哥明确要求模型可轻易获取）；
 * - config：库外配置文件（飞书 JSON/备份密码/凭据主存 yaml）白名单读取；
 * - backup_read：CNB 加密备份容器解密，可对内部 store.db 快照执行只读 SQL。
 * 安全红线：密钥只进模型上下文，绝不写日志；所有路径只读，不带任何写能力。
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { defaultDbPath, getDb, getCredentialMirror, listCredentialMirrorRefs } from './db.ts'
import { decryptBackupContainer } from '../backup/crypto.ts'
import { fetchAndDecryptLatest, readBackupPassword } from '../backup/backup.ts'
import { dshHome } from '../remote/shared/dsh-home.ts'
import { listCredentialRefs } from '../credentials-writer.ts'

type ContentBlock = { type: 'text'; text: string }
function text(value: string): ContentBlock[] { return [{ type: 'text', text: value }] }
function render(value: unknown): string { return JSON.stringify(value, null, 2) }
function jsonValue(value: unknown): any { return JSON.parse(JSON.stringify(value)) }
const schema = { type: 'json' } as const

/** query 结果（工具 2 与工具 5 共用）。 */
interface DbQueryResult {
  ok: boolean
  columns?: string[]
  rows?: Array<Record<string, unknown>>
  rowCount?: number
  error?: string
  /** 只读防线降级标记：readOnly 连接不可用时仅靠语法校验。 */
  readonlyGuard?: 'connection' | 'regex-only'
}

/** 默认行数上限与单元格截断阈值。 */
const DEFAULT_ROW_LIMIT = 200
const MAX_ROW_LIMIT = 1000
const CELL_LIMIT = 4000

/**
 * SELECT 语法白名单校验（友好报错层；硬防线是只读连接）：
 * - 每条语句（按分号切分，允许不带尾分号）必须以 SELECT 或 WITH 开头；
 * - 写关键词黑名单（词边界），REPLACE 仅拦 REPLACE INTO / REPLACE OR 语句形式，
 *   不误伤 SELECT 内的 REPLACE() 纯函数。
 * 安全性：`SELECT 1; DROP TABLE x` 这类混写会被第二段的 DROP 开头校验拒绝。
 */
function validateReadOnlySql(sql: string): string | undefined {
  const trimmed = sql.trim()
  if (trimmed === '') return 'SQL 不能为空。'
  const statements = trimmed.split(';').map((part) => part.trim()).filter((part) => part !== '')
  for (const body of statements) {
    if (!/^(select|with)\b/i.test(body)) return '只允许只读查询（SELECT/WITH 开头），已拒绝：' + body.slice(0, 60)
  }
  const writePattern = /\b(insert|update|delete|drop|alter|create|attach|detach|pragma|vacuum|reindex|begin|commit|rollback)\b|\breplace\s+(into|or)\b/i
  if (writePattern.test(trimmed)) return 'SQL 含写操作关键词，已拒绝（只读接口）。'
  return undefined
}

/** 只读连接（进程级缓存；WAL 下读不阻塞宿主写）。 */
let readonlyDb: DatabaseSync | undefined
let readonlyDbFailed = false

/** 取只读连接；node:sqlite readOnly 不可用时返回 undefined（降级 regex-only）。 */
function getReadOnlyDb(path: string): DatabaseSync | undefined {
  if (readonlyDbFailed) return undefined
  try {
    readonlyDb ??= new DatabaseSync(path, { readOnly: true })
    return readonlyDb
  } catch {
    readonlyDbFailed = true
    return undefined
  }
}

/** 关闭只读连接（测试清理用；Windows 下句柄不释放删不了库所在目录）。 */
export function closeReadOnlyDb(): void {
  if (readonlyDb === undefined) return
  try { readonlyDb.close() } catch { /* 已关闭则忽略 */ }
  readonlyDb = undefined
}

/** 单元格截断：超长字符串加标记。 */
function truncateCell(value: unknown, limit: number): { value: unknown; truncated: boolean } {
  if (typeof value !== 'string' || value.length <= limit) return { value, truncated: false }
  return { value: value.slice(0, limit) + '…[截断]', truncated: true }
}

/** 在指定库连接上执行校验后的只读 SQL（工具 2/5 共用执行核）。 */
function runReadOnlyQuery(db: DatabaseSync, sql: string, limit: number, args: unknown[], guard: 'connection' | 'regex-only'): DbQueryResult {
  const rejected = validateReadOnlySql(sql)
  if (rejected !== undefined) return { ok: false, error: rejected }
  try {
    const statement = db.prepare(sql)
    const rawRows = (args.length > 0 ? statement.all(...args as never[]) : statement.all()) as Array<Record<string, unknown>>
    const columns = rawRows.length > 0 ? Object.keys(rawRows[0]) : []
    let truncated = false
    const rows = rawRows.slice(0, limit).map((row) => {
      const out: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(row)) {
        const cell = truncateCell(value, CELL_LIMIT)
        if (cell.truncated) truncated = true
        out[key] = cell.value
      }
      return out
    })
    return {
      ok: true,
      columns,
      rows,
      rowCount: rows.length,
      ...(rawRows.length > limit ? { rowCountNote: '共 ' + rawRows.length + ' 行，仅返回前 ' + limit + ' 行' } : {}),
      ...(truncated ? { cellTruncated: true } : {}),
      readonlyGuard: guard,
    }
  } catch (error) {
    return { ok: false, error: '查询失败：' + (error instanceof Error ? error.message : String(error)).slice(0, 200) }
  }
}

/** devforge_db 五把工具。 */
export function devforgeDbTools(): Array<ReturnType<typeof defineTool>> {
  return [
    // ---- 1. 库结构：表清单 + 建表 SQL + 行数 + 域统计 ----
    defineTool({
      name: 'devforge_db_schema',
      description: '查看天工造梦数据库（store.db）结构：全部表、建表 SQL、行数、docs/settings 域统计与凭据数量。只读。',
      parameters: {},
      output: { schema, render: (_args, value) => text(render(value)) },
      async execute() {
        try {
          const db = getDb()
          const tableRows = db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as Array<{ name: string; sql: string | null }>
          const tables = tableRows.map((row) => {
            const name = String(row.name)
            let rowCount = 0
            try { rowCount = Number((db.prepare('SELECT COUNT(*) AS c FROM "' + name.replaceAll('"', '""') + '"').get() as { c: number }).c) } catch { /* 虚拟表计数失败按 0 */ }
            return { name, ddl: String(row.sql ?? ''), rowCount }
          })
          const docsDomains = (db.prepare('SELECT domain, COUNT(*) AS count FROM docs GROUP BY domain ORDER BY count DESC').all() as Array<{ domain: string; count: number }>)
            .map((row) => ({ domain: String(row.domain), count: Number(row.count) }))
          const settingsDomains = (db.prepare('SELECT domain FROM settings ORDER BY domain').all() as Array<{ domain: string }>).map((row) => String(row.domain))
          const credentialCount = Number((db.prepare('SELECT COUNT(*) AS c FROM credential').get() as { c: number }).c)
          return jsonValue({ ok: true, tables, docsDomains, settingsDomains, credentialCount })
        } catch (error) {
          return jsonValue({ ok: false, error: '读取库结构失败：' + (error instanceof Error ? error.message : String(error)).slice(0, 200) })
        }
      },
    }),

    // ---- 2. 只读 SQL 查询（独立只读连接 + 语法白名单双重防线） ----
    defineTool({
      name: 'devforge_db_query',
      description: '对天工造梦数据库（store.db）执行只读 SQL 查询（SELECT/WITH；行数上限、超长单元格截断）。表结构先用 devforge_db_schema 查看。只读，写语句会被拒绝。',
      parameters: {
        sql: { type: 'string', description: '只读 SQL（SELECT/WITH 开头；多语句用分号分隔）。' },
        limit: { type: 'integer', description: '返回行数上限，默认 200，最大 1000。' },
        args: { type: 'array', description: 'SQL 参数（? 占位符绑定值）。' },
      },
      output: { schema, render: (_args, value) => text(render(value)) },
      async execute(args: { sql?: string; limit?: number; args?: unknown[] }) {
        if (typeof args.sql !== 'string' || args.sql.trim() === '') return jsonValue({ ok: false, error: '缺少 sql 参数' })
        const limit = Math.min(MAX_ROW_LIMIT, Math.max(1, args.limit ?? DEFAULT_ROW_LIMIT))
        const connection = getReadOnlyDb(defaultDbPath())
        const result = connection !== undefined
          ? runReadOnlyQuery(connection, args.sql, limit, args.args ?? [], 'connection')
          : runReadOnlyQuery(getDb(), args.sql, limit, args.args ?? [], 'regex-only')
        return jsonValue(result)
      },
    }),

    // ---- 3. 凭据镜像：按 ref 取明文（辉哥要求模型可轻易获取） ----
    defineTool({
      name: 'devforge_db_credential',
      description: '读取天工造梦凭据镜像（store.db credential 表）：不带 ref 列出全部凭据名；带 ref 返回明文值（API Key/令牌等）。明文仅限本机会话使用，绝不写日志。',
      parameters: {
        ref: { type: 'string', description: '凭据 ref 名（如 ZAI_CODING_CN_API_KEY）；缺省列出全部 ref 名。' },
      },
      output: { schema, render: (_args, value) => text(render(value)) },
      async execute(args: { ref?: string }) {
        try {
          const db = getDb()
          if (args.ref === undefined || args.ref === '') {
            return jsonValue({ ok: true, refs: listCredentialMirrorRefs(db), hint: '传 ref 参数取对应明文值' })
          }
          const value = getCredentialMirror(db, args.ref)
          if (value === undefined) return jsonValue({ ok: false, error: '凭据不存在：' + args.ref })
          return jsonValue({ ok: true, ref: args.ref, value })
        } catch (error) {
          return jsonValue({ ok: false, error: '读取凭据失败：' + (error instanceof Error ? error.message : String(error)).slice(0, 200) })
        }
      },
    }),

    // ---- 4. 库外配置白名单读取 ----
    defineTool({
      name: 'devforge_db_config',
      description: '读取天工造梦库外配置文件（白名单）：feishu=飞书桥配置（含 appSecret）；backup-secret=备份密码；credentials-yaml=受管凭据主存（values=true 给全文，否则只列 ref 名）。只读。',
      parameters: {
        name: { type: 'string', enum: ['feishu', 'backup-secret', 'credentials-yaml'], description: '配置名。' },
        values: { type: 'boolean', description: 'credentials-yaml 时是否返回全文（含全部 Key）；默认 false 只列 ref 名。' },
      },
      output: { schema, render: (_args, value) => text(render(value)) },
      async execute(args: { name: 'feishu' | 'backup-secret' | 'credentials-yaml'; values?: boolean }) {
        try {
          const home = dshHome()
          if (args.name === 'feishu') {
            const path = join(home, 'dsh-feishu.json')
            if (!existsSync(path)) return jsonValue({ ok: false, error: '飞书配置不存在：' + path })
            return jsonValue({ ok: true, name: 'feishu', path, config: JSON.parse(readFileSync(path, 'utf8')) })
          }
          if (args.name === 'backup-secret') {
            const path = join(home, 'devforge', 'backup-secret.json')
            if (!existsSync(path)) return jsonValue({ ok: false, error: '备份密码未设置（面板备份页可设置）' })
            const parsed = JSON.parse(readFileSync(path, 'utf8')) as { password?: unknown }
            return jsonValue({ ok: true, name: 'backup-secret', password: typeof parsed.password === 'string' ? parsed.password : '' })
          }
          const path = join(home, '.credentials.yaml')
          if (!existsSync(path)) return jsonValue({ ok: false, error: '受管凭据主存不存在：' + path })
          if (args.values === true) return jsonValue({ ok: true, name: 'credentials-yaml', path, content: readFileSync(path, 'utf8') })
          return jsonValue({ ok: true, name: 'credentials-yaml', path, refs: await listCredentialRefs(path), hint: 'values=true 取全文' })
        } catch (error) {
          return jsonValue({ ok: false, error: '读取配置失败：' + (error instanceof Error ? error.message : String(error)).slice(0, 200) })
        }
      },
    }),

    // ---- 5. 加密备份容器解密（可对内部快照执行只读 SQL） ----
    defineTool({
      name: 'devforge_db_backup_read',
      description: '解密天工造梦 CNB 加密备份容器：缺省解远端最新（需本机已设备份密码或显式传 password），或解本地容器文件（source=local + path）。可对容器内 store.db 快照执行只读 SQL（sql 参数）；缺省返回容器文件清单与飞书配置。',
      parameters: {
        source: { type: 'string', enum: ['remote', 'local'], description: 'remote=CNB 远端最新（默认）；local=本地容器文件。' },
        path: { type: 'string', description: 'local 模式的容器文件路径。' },
        password: { type: 'string', description: '备份密码（缺省用本机已存密码）。' },
        sql: { type: 'string', description: '对容器内 store.db 快照执行的只读 SQL（SELECT/WITH）。' },
        limit: { type: 'integer', description: 'SQL 返回行数上限，默认 200。' },
      },
      output: { schema, render: (_args, value) => text(render(value)) },
      async execute(args: { source?: 'remote' | 'local'; path?: string; password?: string; sql?: string; limit?: number }) {
        let container: { files: Record<string, string>; created_at: number; machine: string }
        try {
          if (args.source === 'local') {
            if (args.path === undefined || args.path.trim() === '' || !existsSync(args.path)) {
              return jsonValue({ ok: false, error: 'local 模式需要有效的容器文件路径（path 参数）' })
            }
            container = JSON.parse(Buffer.from(await decryptBackupContainer(readFileSync(args.path), (args.password ?? readBackupPassword()) ?? '')).toString('utf8'))
          } else {
            const password = args.password ?? readBackupPassword()
            if (password === undefined) return jsonValue({ ok: false, error: '缺少备份密码：请传 password 参数，或先在面板备份页设置本机密码' })
            container = await fetchAndDecryptLatest(password)
          }
        } catch (error) {
          return jsonValue({ ok: false, error: '备份解密失败（密码错误或容器损坏）：' + (error instanceof Error ? error.message : String(error)).slice(0, 200) })
        }

        const fileNames = Object.keys(container.files)
        const meta = { ok: true, createdAt: container.created_at, machine: container.machine, files: fileNames }
        const feishuRaw = container.files['dsh-feishu.json']
        const feishuConfig = feishuRaw !== undefined ? JSON.parse(Buffer.from(feishuRaw, 'base64').toString('utf8')) : undefined

        if (args.sql === undefined || args.sql.trim() === '') {
          return jsonValue({ ...meta, feishuConfig, hint: '传 sql 参数可对容器内 store.db 快照执行只读查询' })
        }

        // 快照 SQL：临时文件落地 → 只读查询 → 必清理（close + 删文件）。
        const storeDbRaw = container.files['store.db']
        if (storeDbRaw === undefined) return jsonValue({ ok: false, error: '容器内没有 store.db 快照' })
        const tempDir = mkdtempSync(join(tmpdir(), 'dsh-devforge-backup-read-'))
        const tempDbPath = join(tempDir, 'snapshot.db')
        try {
          writeFileSync(tempDbPath, Buffer.from(storeDbRaw, 'base64'), { mode: 0o600 })
          const snapshotDb = new DatabaseSync(tempDbPath)
          try {
            const result = runReadOnlyQuery(snapshotDb, args.sql, Math.min(MAX_ROW_LIMIT, Math.max(1, args.limit ?? DEFAULT_ROW_LIMIT)), [], 'regex-only')
            return jsonValue({ ...meta, snapshotQuery: result })
          } finally {
            try { snapshotDb.close() } catch { /* 已关闭则忽略 */ }
          }
        } catch (error) {
          return jsonValue({ ok: false, error: '读取快照失败：' + (error instanceof Error ? error.message : String(error)).slice(0, 200) })
        } finally {
          rmSync(tempDir, { recursive: true, force: true })
        }
      },
    }),
  ]
}
