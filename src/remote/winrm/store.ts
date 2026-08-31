// Vendored from dsh-winrm 0.1.5 (Apache-2.0, andyfan1094/dsh-winrm).
// dsh-devforge consolidation modification: relative import paths adjusted to the
// devforge module layout; runtime behavior preserved. See THIRD_PARTY_NOTICES.md.
/**
 * Host config store: one JSON file (~/.dsh/dsh-winrm.json) holding every
 * Windows host entry, written atomically (tmp + rename). Secrets (passwords)
 * live in this user-owned file in plaintext — the same trust model as
 * dsh-ssh; document it, never log it.
 */

import { homedir } from 'node:os'
import { join } from 'node:path'
import type { WinHostEntry, WinHostPayload, WinHostSummary } from './protocol.ts'
import { getDb, listDocs, replaceDocs } from '../../store/db.ts'

/** File format version. */
const FORMAT_VERSION = 1

/** Store file location: <home>/.dsh/dsh-winrm.json. */
export function storePath(): string {
  return join(homedir(), '.dsh', 'dsh-winrm.json')
}

/** SQLite 库文件位置（~/.dsh/devforge/store.db；与 homedir 模式一致，$HOME 隔离生效）。 */
function dbPath(): string {
  return join(homedir(), '.dsh', 'devforge', 'store.db')
}

/** 库内域常量：WinRM 主机列表。 */
const DOCS_DOMAIN = 'winrm.host'

interface StoreFile {
  version: number
  hosts: WinHostEntry[]
}

/** Validate the wire shape of a host payload; returns a message or undefined. */
export function validateHostPayload(payload: unknown): string | undefined {
  if (typeof payload !== 'object' || payload === null) return 'body must be a JSON object'
  const p = payload as Record<string, unknown>
  if (typeof p.host !== 'string' || p.host.trim() === '') return 'host is required'
  if (typeof p.user !== 'string' || p.user.trim() === '') return 'user is required'
  const auth = p.auth as Record<string, unknown> | undefined
  if (auth !== undefined) {
    if (typeof auth !== 'object' || auth === null) return 'auth must be an object'
    if (auth.kind !== 'password') return 'auth.kind must be password'
    if (auth.password !== undefined && typeof auth.password !== 'string') {
      return 'auth.password must be a string when provided'
    }
  }
  if (p.port !== undefined && (typeof p.port !== 'number' || !Number.isInteger(p.port) || p.port < 1 || p.port > 65535)) {
    return 'port must be an integer in 1..65535'
  }
  if (p.transport !== undefined && p.transport !== 'http' && p.transport !== 'https') {
    return 'transport must be http or https'
  }
  if (p.rejectUnauthorized !== undefined && typeof p.rejectUnauthorized !== 'boolean') {
    return 'rejectUnauthorized must be a boolean'
  }
  if (p.tags !== undefined && (!Array.isArray(p.tags) || p.tags.some(x => typeof x !== 'string'))) {
    return 'tags must be an array of strings'
  }
  return undefined
}

/** Alias grammar: letters/digits plus dots, hyphens, underscores (IP/domain aliases included). */
const ALIAS_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/

/** Validate an alias for creation. */
export function validateAlias(alias: string): string | undefined {
  if (!ALIAS_RE.test(alias)) return 'alias must be letters, digits, dots, hyphens or underscores'
  return undefined
}

/**
 * The host store. SQLite-backed (plugin-wide store.db) — no cordis dependency,
 * unit-testable. Legacy JSON file (dsh-winrm.json) is migrated once by
 * store/migrate.ts; read/write semantics unchanged.
 */
export class HostStore {
  /** The SQLite database file path. */
  readonly path: string
  /** SQLite 连接（单例；dbPath 仅供测试注入独立库）。 */
  private readonly db: ReturnType<typeof getDb>

  /**
   * @param path - store database path (defaults to the standard location).
   */
  constructor(path?: string) {
    this.db = getDb(path)
    this.path = join(path ?? dbPath())
  }

  /** Load all entries (empty store when the file is absent). */
  list(): WinHostEntry[] {
    return this.load().hosts
  }

  /** Find one entry by alias. */
  find(alias: string): WinHostEntry | undefined {
    return this.list().find(entry => entry.alias === alias)
  }

  /** Secret-free projection for the browser and agent surfaces. */
  summarize(entry: WinHostEntry): WinHostSummary {
    return {
      alias: entry.alias,
      host: entry.host,
      port: entry.port,
      user: entry.user,
      auth: entry.auth.kind,
      transport: entry.transport,
      ...(entry.rejectUnauthorized !== undefined ? { rejectUnauthorized: entry.rejectUnauthorized } : {}),
      ...(entry.description !== undefined ? { description: entry.description } : {}),
      ...(entry.environment !== undefined ? { environment: entry.environment } : {}),
      tags: [...entry.tags],
      ...(entry.location !== undefined ? { location: entry.location } : {}),
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
    }
  }

  /** Create one entry. Throws on alias collision or invalid payload. */
  create(payload: WinHostPayload): WinHostEntry {
    const alias = payload.alias?.trim()
    if (!alias) throw new Error('alias is required')
    const aliasError = validateAlias(alias)
    if (aliasError !== undefined) throw new Error(aliasError)
    const bodyError = validateHostPayload(payload)
    if (bodyError !== undefined) throw new Error(bodyError)
    if (payload.auth === undefined) throw new Error('auth is required')
    const file = this.load()
    if (file.hosts.some(entry => entry.alias === alias)) throw new Error(`alias '${alias}' already exists`)
    const now = Date.now()
    const entry: WinHostEntry = {
      alias,
      host: payload.host.trim(),
      port: payload.port ?? 5985,
      user: payload.user.trim(),
      auth: { kind: 'password', password: payload.auth.password },
      transport: payload.transport ?? 'http',
      ...(payload.rejectUnauthorized !== undefined ? { rejectUnauthorized: payload.rejectUnauthorized } : {}),
      description: payload.description?.trim() || undefined,
      environment: payload.environment?.trim() || undefined,
      tags: [...(payload.tags ?? [])].map(tag => tag.trim()).filter(tag => tag !== ''),
      location: payload.location?.trim() || undefined,
      createdAt: now,
      updatedAt: now,
    }
    file.hosts.push(entry)
    this.save(file)
    return entry
  }

  /** Update the fields present in `patch`; unknown aliases throw. */
  update(alias: string, patch: Partial<WinHostPayload>): WinHostEntry {
    const file = this.load()
    const entry = file.hosts.find(candidate => candidate.alias === alias)
    if (entry === undefined) throw new Error(`alias '${alias}' not found`)
    if (patch.host !== undefined && (typeof patch.host !== 'string' || patch.host.trim() === '')) {
      throw new Error('host is required')
    }
    if (patch.user !== undefined && (typeof patch.user !== 'string' || patch.user.trim() === '')) {
      throw new Error('user is required')
    }
    if (patch.port !== undefined && (typeof patch.port !== 'number' || !Number.isInteger(patch.port) || patch.port < 1 || patch.port > 65535)) {
      throw new Error('port must be an integer in 1..65535')
    }
    if (patch.transport !== undefined && patch.transport !== 'http' && patch.transport !== 'https') {
      throw new Error('transport must be http or https')
    }
    if (patch.tags !== undefined && (!Array.isArray(patch.tags) || patch.tags.some(x => typeof x !== 'string'))) {
      throw new Error('tags must be an array of strings')
    }
    if (patch.host !== undefined) entry.host = patch.host.trim()
    if (patch.port !== undefined) entry.port = patch.port
    if (patch.user !== undefined) entry.user = patch.user.trim()
    if (patch.auth !== undefined) {
      const auth = patch.auth
      if (auth.kind !== 'password') throw new Error('auth.kind must be password')
      entry.auth = { kind: 'password', password: auth.password }
    }
    if (patch.transport !== undefined) entry.transport = patch.transport
    if (patch.rejectUnauthorized !== undefined) entry.rejectUnauthorized = patch.rejectUnauthorized
    if (patch.description !== undefined) entry.description = patch.description.trim() || undefined
    if (patch.environment !== undefined) entry.environment = patch.environment.trim() || undefined
    if (patch.tags !== undefined) entry.tags = [...patch.tags].map(tag => tag.trim()).filter(tag => tag !== '')
    if (patch.location !== undefined) entry.location = patch.location.trim() || undefined
    entry.updatedAt = Date.now()
    this.save(file)
    return entry
  }

  /** Remove one entry. */
  delete(alias: string): void {
    const file = this.load()
    const index = file.hosts.findIndex(candidate => candidate.alias === alias)
    if (index < 0) throw new Error(`alias '${alias}' not found`)
    file.hosts.splice(index, 1)
    this.save(file)
  }

  /** 从库拼回原文件结构形状（业务方法无感知）。 */
  private load(): StoreFile {
    const hosts = listDocs(this.db, DOCS_DOMAIN)
      .map(row => JSON.parse(row.data) as WinHostEntry)
      .filter(entry => typeof entry?.alias === 'string')
    return { version: FORMAT_VERSION, hosts }
  }

  /** 事务内整域替换写（SQLite 保证原子与属主隔离）。 */
  private save(file: StoreFile): void {
    replaceDocs(this.db, DOCS_DOMAIN, file.hosts.map(entry => ({ id: entry.alias, data: entry })))
  }
}
