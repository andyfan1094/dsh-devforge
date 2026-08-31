/**
 * CNB 账号与设置存储 —— devforge 统一 SQLite 库（`${dshHome}/devforge/store.db`）。
 * 与 vendored GitHub store 同构，便于运维心智复用；库路径经 dshHome() 解析，
 * 天然跟随 $HOME / $DSH_HOME（暂存实例隔离生效）。
 * 存储层从 JSON 文件（dsh-cnb.json）切换为 SQLite：读写语义不变，旧文件由
 * store/migrate.ts 一次性迁入并归档为 *.migrated.bak。
 */
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { AccountSummary, CnbConfigPayload, CnbSettings } from './protocol.ts'
import { CNB_API_DEFAULT } from './protocol.ts'
import { getDb, getSettings, listDocs, putSettingsWithinTx, replaceDocsWithinTx, withTransaction } from '../store/db.ts'

export interface StoredAccount {
  alias: string
  token: string
  apiUrl: string
  username?: string
  createdAt: number
  updatedAt: number
}
interface StoreFile { version: 1; settings: CnbSettings; accounts: StoredAccount[] }
const DEFAULT_SETTINGS: CnbSettings = { apiUrl: CNB_API_DEFAULT, gitExecutable: 'git', autoFetchOnOpen: false, allowPush: false, allowForcePush: false }

/** 库内域常量（账号列表 + 单例设置）。 */
const DOCS_DOMAIN = 'cnb.account'
const SETTINGS_DOMAIN = 'cnb.settings'

/** 兼容保留：旧 JSON 文件位置（仅迁移器与诊断用途；运行时数据已入 SQLite 库）。 */
export function storePath(): string {
  return join(homedir(), '.dsh', 'dsh-cnb.json')
}

export class CnbStore {
  /** SQLite 库连接（单例；path 参数仅供测试注入独立库）。 */
  private readonly db: ReturnType<typeof getDb>
  /** 兼容保留：库文件路径（原 JSON 文件路径语义已变更）。 */
  readonly path: string
  constructor(path?: string) {
    this.db = getDb(path)
    this.path = path ?? ''
  }
  settings(): CnbSettings { return { ...DEFAULT_SETTINGS, ...this.load().settings } }
  updateSettings(patch: CnbConfigPayload): CnbSettings {
    const file = this.load()
    const current = this.settings()
    const next: CnbSettings = {
      ...current,
      ...(patch.apiUrl !== undefined ? { apiUrl: normalizeApiUrl(patch.apiUrl) } : {}),
      ...(patch.gitExecutable !== undefined ? { gitExecutable: patch.gitExecutable.trim() || 'git' } : {}),
      ...(patch.defaultAccount !== undefined ? { defaultAccount: patch.defaultAccount.trim() || undefined } : {}),
      ...(patch.defaultRepoDir !== undefined ? { defaultRepoDir: patch.defaultRepoDir.trim() || undefined } : {}),
      ...(patch.defaultBranch !== undefined ? { defaultBranch: patch.defaultBranch.trim() || undefined } : {}),
      ...(patch.autoFetchOnOpen !== undefined ? { autoFetchOnOpen: Boolean(patch.autoFetchOnOpen) } : {}),
      ...(patch.allowPush !== undefined ? { allowPush: Boolean(patch.allowPush) } : {}),
      ...(patch.allowForcePush !== undefined ? { allowForcePush: Boolean(patch.allowForcePush) } : {}),
    }
    file.settings = next; this.save(file); return next
  }
  listAccounts(): AccountSummary[] { return this.load().accounts.map(account => this.summarize(account)) }
  /** 找账号：没有可用账号时返回 undefined（公开仓库匿名操作），别名显式给错则抛错。 */
  findOptionalAccount(alias?: string): StoredAccount | undefined {
    const file = this.load()
    const selected = alias?.trim() || this.settings().defaultAccount || file.accounts[0]?.alias
    if (selected === undefined) return undefined
    const account = file.accounts.find(candidate => candidate.alias === selected)
    if (account === undefined) {
      if (alias?.trim()) throw new Error('CNB 账号 ' + selected + ' 不存在')
      return undefined
    }
    return account
  }
  findAccount(alias?: string): StoredAccount {
    const account = this.findOptionalAccount(alias)
    if (account === undefined) throw new Error('尚未配置 CNB 账号：请用 cnb_auth_add 添加（令牌在 cnb.cool 个人设置 → 访问令牌 创建）')
    return account
  }
  upsertAccount(payload: { alias: string; token?: string; apiUrl?: string }): AccountSummary {
    const alias = payload.alias.trim()
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(alias)) throw new Error('账号别名必须以字母或数字开头，且只含字母、数字、点、连字符或下划线')
    const file = this.load()
    const existing = file.accounts.find(account => account.alias === alias)
    const token = payload.token?.trim() || existing?.token
    if (!token) throw new Error('CNB 访问令牌不能为空')
    const now = Date.now()
    const entry: StoredAccount = { alias, token, apiUrl: normalizeApiUrl(payload.apiUrl || existing?.apiUrl || file.settings.apiUrl), ...(existing?.username !== undefined ? { username: existing.username } : {}), createdAt: existing?.createdAt ?? now, updatedAt: now }
    if (existing === undefined) file.accounts.push(entry); else file.accounts[file.accounts.indexOf(existing)] = entry
    if (file.settings.defaultAccount === undefined) file.settings.defaultAccount = alias
    this.save(file); return this.summarize(entry)
  }
  setUsername(alias: string, username: string): void {
    const file = this.load(); const account = file.accounts.find(candidate => candidate.alias === alias)
    if (account === undefined) throw new Error('CNB 账号 ' + alias + ' 不存在')
    account.username = username; account.updatedAt = Date.now(); this.save(file)
  }
  deleteAccount(alias: string): void {
    const file = this.load(); const index = file.accounts.findIndex(account => account.alias === alias)
    if (index < 0) throw new Error('CNB 账号 ' + alias + ' 不存在')
    file.accounts.splice(index, 1); if (file.settings.defaultAccount === alias) file.settings.defaultAccount = file.accounts[0]?.alias; this.save(file)
  }
  summarize(account: StoredAccount): AccountSummary { return { alias: account.alias, apiUrl: account.apiUrl, ...(account.username !== undefined ? { username: account.username } : {}), tokenConfigured: account.token.length > 0, createdAt: account.createdAt, updatedAt: account.updatedAt } }
  /** 从库拼回原文件结构形状（业务方法无感知）。 */
  private load(): StoreFile {
    const accounts = listDocs(this.db, DOCS_DOMAIN)
      .map(row => JSON.parse(row.data) as StoredAccount)
      .filter(account => typeof account?.alias === 'string')
    const settings = getSettings<Partial<CnbSettings>>(this.db, SETTINGS_DOMAIN) ?? {}
    return { version: 1, settings: { ...DEFAULT_SETTINGS, ...settings }, accounts }
  }
  /** 事务内原子写：设置 + 账号整域替换。 */
  private save(file: StoreFile): void {
    withTransaction(this.db, () => {
      putSettingsWithinTx(this.db, SETTINGS_DOMAIN, file.settings)
      replaceDocsWithinTx(this.db, DOCS_DOMAIN, file.accounts.map(account => ({ id: account.alias, data: account })))
    })
  }
}
export function normalizeApiUrl(value: string): string {
  const url = value.trim().replace(/\/+$/, '')
  if (!/^https?:\/\//i.test(url)) throw new Error('CNB API 地址必须以 http:// 或 https:// 开头')
  return url
}
