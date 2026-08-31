/**
 * devforge 插件统一 SQLite 存储（node:sqlite，零第三方依赖）。
 *
 * 设计：
 * - 单文件库 `${dshHome}/devforge/store.db`，全部插件自有数据（账号、主机、设置、凭据镜像）入此库，
 *   便于后续整体加密备份到 CNB（第二阶段）。
 * - WAL 模式 + busy_timeout：多进程并发（生产 Host 与暂存实例并存）读写安全；
 *   进程内经 getDb() 单例共享一个连接，同步 API 天然串行，无应用级写竞争。
 * - 跨平台：路径统一 path.join + dshHome()（DSH_HOME 优先，暂存隔离生效）；
 *   POSIX 收紧 0600 权限，Windows 忽略 chmod（ACL 继承）；SQLite 库文件本身平台无关，
 *   macOS 备份 → Windows 恢复直接可用。
 * - 表结构（通用文档模式，数据量 KB 级，避免字段级迁移）：
 *     meta(key,value)                    —— schema 版本与迁移标志
 *     docs(domain,id,data,sort_order)    —— 列表型数据（账号/主机），id=域内唯一键
 *     settings(domain,data)              —— 单例设置（每域一行 JSON）
 *     credential(ref,value)              —— coding plan 等凭据的**镜像**（yaml 仍是主存，见 migrate.ts）
 */

import { chmodSync, existsSync, mkdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { dirname, join } from 'node:path'
import { dshHome } from '../remote/shared/dsh-home.ts'

/** 当前库 schema 版本（破坏性变更时递增并配升级逻辑）。 */
export const DB_SCHEMA_VERSION = 1

/** 库文件路径：`${dshHome}/devforge/store.db`。 */
export function defaultDbPath(): string {
  return join(dshHome(), 'devforge', 'store.db')
}

/** 进程级单例（按路径缓存；测试传独立路径即得独立库实例）。 */
const instances = new Map<string, DatabaseSync>()

/** 打开（或复用）库连接：WAL + busy_timeout + 建表；进程内同路径共享单连接。 */
export function getDb(path?: string): DatabaseSync {
  const target = path ?? defaultDbPath()
  const cached = instances.get(target)
  if (cached !== undefined) return cached
  const dir = dirname(target)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 })
  const db = new DatabaseSync(target)
  // WAL：读写不互斥、多进程并发安全；busy_timeout：写锁竞争时自动等待而非报错。
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA busy_timeout = 5000')
  db.exec('PRAGMA synchronous = NORMAL')
  if (process.platform !== 'win32') {
    // 库文件收紧为属主可读写（Windows 无 POSIX 权限位，ACL 继承，忽略）。
    try { chmodSync(target, 0o600) } catch { /* best effort */ }
  }
  ensureSchema(db)
  instances.set(target, db)
  return db
}

/** 关闭指定路径的库连接（主要供测试与显式资源释放）。 */
export function closeDb(path?: string): void {
  const target = path ?? defaultDbPath()
  const db = instances.get(target)
  if (db === undefined) return
  instances.delete(target)
  try { db.close() } catch { /* 已关闭则忽略 */ }
}

/** 建表（幂等）；旧版本库升级入口留在 ensureSchema 内按 schema_version 演进。 */
function ensureSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS docs (
      domain     TEXT    NOT NULL,
      id         TEXT    NOT NULL,
      data       TEXT    NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (domain, id)
    );
    CREATE TABLE IF NOT EXISTS settings (
      domain     TEXT PRIMARY KEY,
      data       TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS credential (
      ref        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `)
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get('schema_version')
  if (row === undefined) {
    db.prepare('INSERT INTO meta(key, value) VALUES (?, ?)').run('schema_version', String(DB_SCHEMA_VERSION))
  }
}

// ------------------------------------------------ 事务

/** 立即写事务封装：fn 内所有语句原子生效；fn 抛错自动回滚。 */
export function withTransaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE')
  try {
    const value = fn()
    db.exec('COMMIT')
    return value
  } catch (error) {
    try { db.exec('ROLLBACK') } catch { /* 已回滚则忽略 */ }
    throw error
  }
}

// ------------------------------------------------ docs（列表型数据）

/** 读取一个域的全部文档，按 sort_order 稳定排序。 */
export function listDocs(db: DatabaseSync, domain: string): Array<{ id: string; data: string; sortOrder: number }> {
  const rows = db.prepare('SELECT id, data, sort_order FROM docs WHERE domain = ? ORDER BY sort_order, id').all(domain)
  return rows.map(row => ({ id: String(row['id']), data: String(row['data']), sortOrder: Number(row['sort_order']) }))
}

/** 整域替换写（不含事务；供 withTransaction 内组合调用）。 */
export function replaceDocsWithinTx(
  db: DatabaseSync,
  domain: string,
  items: Array<{ id: string; data: unknown }>,
): void {
  const now = Date.now()
  const del = db.prepare('DELETE FROM docs WHERE domain = ?')
  const ins = db.prepare('INSERT INTO docs(domain, id, data, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
  del.run(domain)
  items.forEach((item, index) => {
    ins.run(domain, item.id, JSON.stringify(item.data), index, now, now)
  })
}

/** 事务内整域替换写（数据量小，清写比逐条 diff 简单可靠且原子）。 */
export function replaceDocs(
  db: DatabaseSync,
  domain: string,
  items: Array<{ id: string; data: unknown }>,
): void {
  withTransaction(db, () => replaceDocsWithinTx(db, domain, items))
}

// ------------------------------------------------ settings（单例设置）

/** 读一个域的设置（JSON 反序列化；无值返回 undefined）。 */
export function getSettings<T>(db: DatabaseSync, domain: string): T | undefined {
  const row = db.prepare('SELECT data FROM settings WHERE domain = ?').get(domain)
  if (row === undefined) return undefined
  return JSON.parse(String(row['data'])) as T
}

/** 写一个域的设置（不含事务；供 withTransaction 内组合调用）。 */
export function putSettingsWithinTx(db: DatabaseSync, domain: string, data: unknown): void {
  db.prepare(
    'INSERT INTO settings(domain, data, updated_at) VALUES (?, ?, ?) '
    + 'ON CONFLICT(domain) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at',
  ).run(domain, JSON.stringify(data), Date.now())
}

/** 写一个域的设置（整行覆盖，自含事务）。 */
export function putSettings(db: DatabaseSync, domain: string, data: unknown): void {
  withTransaction(db, () => putSettingsWithinTx(db, domain, data))
}

// ------------------------------------------------ credential（凭据镜像）

/** 读一个凭据镜像值；不存在返回 undefined。 */
export function getCredentialMirror(db: DatabaseSync, ref: string): string | undefined {
  const row = db.prepare('SELECT value FROM credential WHERE ref = ?').get(ref)
  return row === undefined ? undefined : String(row['value'])
}

/** 写/更新一个凭据镜像值（幂等）。 */
export function putCredentialMirror(db: DatabaseSync, ref: string, value: string): void {
  db.prepare(
    'INSERT INTO credential(ref, value, updated_at) VALUES (?, ?, ?) '
    + 'ON CONFLICT(ref) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
  ).run(ref, value, Date.now())
}

/** 列出全部凭据镜像 ref（只回 ref 名，不带值）。 */
export function listCredentialMirrorRefs(db: DatabaseSync): string[] {
  return db.prepare('SELECT ref FROM credential ORDER BY ref').all().map(row => String(row['ref']))
}
