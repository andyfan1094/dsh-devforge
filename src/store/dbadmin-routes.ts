/**
 * 数据管理面板路由族 —— /api/dsh-devforge/dbadmin/*。
 *
 * 安全模型（辉哥 2026-09-23 定稿「数据透明化 + 密钥不打明文」）：
 * - 全部 loopback-only（isLoopbackRequest 围栏，与 MCP 路由同款）；
 * - 库表结构与数据行全量可看（透明化），分页 + 关键字过滤 + 超长单元格截断防渲染爆炸；
 * - 凭据/密钥类值只回掩码；明文仅经 reveal 端点按需返回（浏览器复制进剪贴板，
 *   不落页面 DOM），每次 reveal 记审计日志（只记目标名，绝不记值）；
 * - 表名/列名一律先查 sqlite_master/PRAGMA 白名单再拼 SQL（标识符无法参数化），
 *   搜索值全部走参数绑定。
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { isLoopbackRequest } from '../loopback.ts'
import { dshHome } from '../remote/shared/dsh-home.ts'
import { getDb } from './db.ts'
import {
  DB_ADMIN_API,
  type DbAdminConfigFilesResult,
  type DbAdminConfigName,
  type DbAdminCredentialRefsResult,
  type DbAdminRevealResult,
  type DbAdminRowsResult,
  type DbAdminTablesResult,
} from './dbadmin-protocol.ts'

/** 数据行单元格默认截断长度（面板渲染友好；full=1 时放宽到该值的 4 倍）。 */
const CELL_LIMIT = 2000
/** 分页尺寸上限。 */
const MAX_PAGE_SIZE = 200
/** JSON 请求体上限（reveal 请求体极小，1MB 富余）。 */
const MAX_BODY = 1024 * 1024

/** 敏感值掩码：长度 ≤8 全掩码；否则 •••• + 尾 4 位（与面板约定一致）。 */
export function maskSecret(value: string): string {
  if (value.length <= 8) return '•'.repeat(Math.max(value.length, 4))
  return '••••' + value.slice(-4)
}

/** 单元格截断：超长加省略标记。 */
function truncateCell(value: unknown, limit: number): { value: unknown; truncated: boolean } {
  if (typeof value !== 'string' || value.length <= limit) return { value, truncated: false }
  return { value: value.slice(0, limit) + '…[截断]', truncated: true }
}

/** 标识符转义（表名/列名，SQLite 双引号风格）。 */
function quoteIdent(name: string): string {
  return '"' + name.replaceAll('"', '""') + '"'
}

/** 极简 JSON 响应。 */
function writeJson(res: import('node:http').ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

/** 围栏：非 loopback 直接 403。 */
function guard(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse): boolean {
  if (isLoopbackRequest(req)) return true
  writeJson(res, 403, { ok: false, error: 'forbidden: loopback-only' })
  return false
}

/** 审计日志出口（index.ts 挂载时注入 ctx.logger；只允许记目标名，绝不记值）。 */
export interface DbAdminAuditLog {
  info(message: string, ...args: unknown[]): void
}

/**
 * 组装数据管理路由族。
 * @param audit 审计日志出口（reveal 端点必须记录目标名）
 */
export function makeDbAdminRoutes(audit?: DbAdminAuditLog): WebRoute[] {
  /** 统一审计前缀。 */
  const auditInfo = (message: string, ...args: unknown[]): void => {
    try { audit?.info('[dsh-devforge][数据管理] ' + message, ...args) } catch { /* 日志失败不影响业务 */ }
  }

  return [
    // ---- 表清单：结构 + 行数 + 域统计（全透明） ----
    {
      kind: 'exact',
      path: DB_ADMIN_API.tables,
      handler: async (_req, res) => {
        if (!guard(_req, res)) return
        try {
          const db = getDb()
          const tableRows = db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as Array<{ name: string; sql: string | null }>
          const tables: DbAdminTablesResult['tables'] = []
          for (const row of tableRows) {
            const name = String(row.name)
            let rowCount = 0
            try { rowCount = Number((db.prepare('SELECT COUNT(*) AS c FROM ' + quoteIdent(name)).get() as { c: number }).c) } catch { /* 个别虚拟表计数失败按 0 展示 */ }
            tables.push({ name, ddl: String(row.sql ?? ''), rowCount })
          }
          const docsDomains = (db.prepare('SELECT domain, COUNT(*) AS count FROM docs GROUP BY domain ORDER BY count DESC').all() as Array<{ domain: string; count: number }>)
            .map((row) => ({ domain: String(row.domain), count: Number(row.count) }))
          const settingsDomains = (db.prepare('SELECT domain FROM settings ORDER BY domain').all() as Array<{ domain: string }>)
            .map((row) => ({ domain: String(row.domain), count: 1 }))
          const credentialCount = (db.prepare('SELECT COUNT(*) AS c FROM credential').get() as { c: number }).c
          const payload: DbAdminTablesResult = { tables, docsDomains, settingsDomains, credentialCount: Number(credentialCount) }
          writeJson(res, 200, { ok: true, ...payload })
        } catch (error) {
          writeJson(res, 500, { ok: false, error: '读取表清单失败：' + (error instanceof Error ? error.message : String(error)) })
        }
      },
    },

    // ---- 表数据分页（白名单表名 + 参数绑定搜索） ----
    {
      kind: 'exact',
      path: DB_ADMIN_API.rows,
      handler: async (req, res) => {
        if (!guard(req, res)) return
        try {
          const url = new URL(req.url ?? '/', 'http://localhost')
          const tableName = url.searchParams.get('table') ?? ''
          const page = Math.max(1, Number(url.searchParams.get('page') ?? '1') || 1)
          const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(url.searchParams.get('pageSize') ?? '50') || 50))
          const search = (url.searchParams.get('search') ?? '').trim()
          const full = url.searchParams.get('full') === '1'
          if (tableName === '') { writeJson(res, 400, { ok: false, error: '缺少 table 参数。' }); return }

          const db = getDb()
          // 表名白名单：必须是 sqlite_master 里真实存在的用户表（防注入，标识符无法参数化）。
          const known = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as Array<{ name: string }>).map((row) => String(row.name))
          if (!known.includes(tableName)) { writeJson(res, 400, { ok: false, error: '表不存在：' + tableName }); return }

          // 列结构来自 PRAGMA（列名可信后再拼进 SQL）。
          const columnRows = db.prepare('PRAGMA table_info(' + quoteIdent(tableName) + ')').all() as Array<{ name: string; type: string }>
          const columns = columnRows.map((row) => ({ name: String(row.name), type: String(row.type ?? '') }))

          // 搜索条件：对全部 TEXT 列做参数绑定 LIKE（无文本列时忽略搜索词）。
          const textColumns = columns.filter((column) => /text|char|json|data/i.test(column.type) || column.type === '').map((column) => column.name)
          const whereClause = search !== '' && textColumns.length > 0
            ? ' WHERE ' + textColumns.map((name) => quoteIdent(name) + " LIKE '%' || ? || '%'").join(' OR ')
            : ''
          const searchArgs = search !== '' && textColumns.length > 0 ? textColumns.map(() => search) : []

          const countRow = db.prepare('SELECT COUNT(*) AS c FROM ' + quoteIdent(tableName) + whereClause).get(...searchArgs) as { c: number }
          const total = Number(countRow.c)
          const dataRows = db.prepare('SELECT * FROM ' + quoteIdent(tableName) + whereClause + ' ORDER BY rowid LIMIT ? OFFSET ?')
            .all(...searchArgs, pageSize, (page - 1) * pageSize) as Array<Record<string, unknown>>

          const cellLimit = full ? CELL_LIMIT * 4 : CELL_LIMIT
          let truncated = false
          const rows = dataRows.map((row) => {
            const out: Record<string, unknown> = {}
            for (const [key, value] of Object.entries(row)) {
              const cell = truncateCell(value, cellLimit)
              if (cell.truncated) truncated = true
              out[key] = cell.value
            }
            return out
          })

          const payload: DbAdminRowsResult = { table: tableName, columns, rows, total, page, pageSize, truncated }
          writeJson(res, 200, { ok: true, ...payload })
        } catch (error) {
          writeJson(res, 500, { ok: false, error: '读取表数据失败：' + (error instanceof Error ? error.message : String(error)) })
        }
      },
    },

    // ---- 凭据镜像清单（值只回掩码） ----
    {
      kind: 'exact',
      path: DB_ADMIN_API.credentialRefs,
      handler: async (req, res) => {
        if (!guard(req, res)) return
        try {
          const db = getDb()
          const rows = db.prepare('SELECT ref, value, updated_at FROM credential ORDER BY ref').all() as Array<{ ref: string; value: string; updated_at: number }>
          const payload: DbAdminCredentialRefsResult = {
            refs: rows.map((row) => ({ ref: String(row.ref), masked: maskSecret(String(row.value)), updatedAt: Number(row.updated_at) })),
          }
          writeJson(res, 200, { ok: true, ...payload })
        } catch (error) {
          writeJson(res, 500, { ok: false, error: '读取凭据清单失败：' + (error instanceof Error ? error.message : String(error)) })
        }
      },
    },

    // ---- 凭据明文（复制按钮专用；审计只记 ref 名） ----
    {
      kind: 'exact',
      path: DB_ADMIN_API.credentialReveal,
      handler: async (req, res) => {
        if (!guard(req, res)) return
        if (req.method !== 'POST') { writeJson(res, 405, { ok: false, error: 'POST only' }); return }
        try {
          const body = await readBody(req)
          const ref = typeof body?.ref === 'string' ? body.ref : ''
          if (ref === '') { writeJson(res, 400, { ok: false, error: '缺少 ref。' }); return }
          const row = getDb().prepare('SELECT value FROM credential WHERE ref = ?').get(ref) as { value: string } | undefined
          if (row === undefined) { writeJson(res, 404, { ok: false, error: '凭据不存在：' + ref }); return }
          auditInfo('凭据明文被取用（ref=' + ref + '，值不入日志）')
          const payload: DbAdminRevealResult = { ok: true, target: ref, value: String(row.value) }
          writeJson(res, 200, payload)
        } catch (error) {
          writeJson(res, 500, { ok: false, error: '读取凭据失败：' + (error instanceof Error ? error.message : String(error)) })
        }
      },
    },

    // ---- 库外配置清单（白名单三项，掩码预览） ----
    {
      kind: 'exact',
      path: DB_ADMIN_API.configFiles,
      handler: async (req, res) => {
        if (!guard(req, res)) return
        try {
          const payload: DbAdminConfigFilesResult = { files: listConfigFiles() }
          writeJson(res, 200, { ok: true, ...payload })
        } catch (error) {
          writeJson(res, 500, { ok: false, error: '读取配置清单失败：' + (error instanceof Error ? error.message : String(error)) })
        }
      },
    },

    // ---- 配置明文（复制按钮专用；审计只记配置名） ----
    {
      kind: 'exact',
      path: DB_ADMIN_API.configReveal,
      handler: async (req, res) => {
        if (!guard(req, res)) return
        if (req.method !== 'POST') { writeJson(res, 405, { ok: false, error: 'POST only' }); return }
        try {
          const body = await readBody(req)
          const name = typeof body?.name === 'string' ? body.name : ''
          if (!isConfigName(name)) { writeJson(res, 400, { ok: false, error: '不支持的配置名（白名单外）：' + name }); return }
          const value = readConfigPlainText(name)
          if (value === undefined) { writeJson(res, 404, { ok: false, error: '配置文件不存在：' + name }); return }
          auditInfo('配置明文被取用（name=' + name + '，值不入日志）')
          const payload: DbAdminRevealResult = { ok: true, target: name, value }
          writeJson(res, 200, payload)
        } catch (error) {
          writeJson(res, 500, { ok: false, error: '读取配置失败：' + (error instanceof Error ? error.message : String(error)) })
        }
      },
    },
  ]
}

/** 读取 JSON 请求体（超限/解析失败返回 null）。 */
function readBody(req: import('node:http').IncomingMessage): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    let size = 0
    const parts: Buffer[] = []
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY) { resolve(null); req.destroy(); return }
      parts.push(chunk)
    })
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(parts).toString('utf8')) as Record<string, unknown>) }
      catch { resolve(null) }
    })
    req.on('error', () => resolve(null))
  })
}

/** 配置白名单收窄。 */
function isConfigName(name: string): name is DbAdminConfigName {
  return name === 'feishu' || name === 'backup-secret' || name === 'credentials-yaml'
}

/** 配置文件绝对路径（与各域主存路径保持单一事实）。 */
function configPath(name: DbAdminConfigName): string {
  const home = dshHome()
  if (name === 'feishu') return join(home, 'dsh-feishu.json')
  if (name === 'backup-secret') return join(home, 'devforge', 'backup-secret.json')
  return join(home, '.credentials.yaml')
}

/** 配置展示名。 */
function configLabel(name: DbAdminConfigName): string {
  if (name === 'feishu') return '飞书桥配置（dsh-feishu.json）'
  if (name === 'backup-secret') return '备份密码（backup-secret.json）'
  return '受管凭据主存（.credentials.yaml）'
}

/** 库外配置清单（掩码预览，不回明文）。 */
function listConfigFiles(): DbAdminConfigFilesResult['files'] {
  const names: DbAdminConfigName[] = ['feishu', 'backup-secret', 'credentials-yaml']
  return names.map((name) => {
    const path = configPath(name)
    const exists = existsSync(path)
    const item: DbAdminConfigFilesResult['files'][number] = { name, label: configLabel(name), exists, keys: [] }
    if (!exists) return item
    try {
      const raw = readFileSync(path, 'utf8')
      if (name === 'feishu') {
        const parsed = JSON.parse(raw) as Record<string, unknown>
        item.keys = Object.keys(parsed)
        const secret = typeof parsed['appSecret'] === 'string' ? parsed['appSecret'] : ''
        if (secret !== '') item.maskedPreview = maskSecret(secret)
      }
      if (name === 'backup-secret') {
        const parsed = JSON.parse(raw) as { password?: unknown }
        const password = typeof parsed.password === 'string' ? parsed.password : ''
        item.maskedPreview = password === '' ? '（空）' : maskSecret(password)
      }
      if (name === 'credentials-yaml') {
        // 只统计 ref 数；ref 名非敏感可直接展示。
        item.keys = raw.split('\n')
          .map((line) => /^\s+([A-Za-z_][A-Za-z0-9_]*):\s/.exec(line)?.[1])
          .filter((ref): ref is string => typeof ref === 'string')
      }
    } catch { /* 文件损坏按空键清单展示，reveal 时再报错 */ }
    return item
  })
}

/** 配置明文（reveal 专用）。 */
function readConfigPlainText(name: DbAdminConfigName): string | undefined {
  const path = configPath(name)
  if (!existsSync(path)) return undefined
  return readFileSync(path, 'utf8')
}
