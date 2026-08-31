// Vendored from dsh-github 0.1.2 (Apache-2.0, andyfan1094/dsh-github).
// dsh-devforge consolidation modification: relative import paths adjusted to the
// devforge module layout; runtime behavior preserved. See THIRD_PARTY_NOTICES.md.
// dsh-devforge SQLite consolidation: storage switched from JSON file
// (dsh-github.json) to the plugin-wide SQLite store; read/write semantics
// unchanged, legacy file migrated once by store/migrate.ts.
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { AccountSummary, GitHubConfigPayload, GitHubSettings } from './protocol.ts'
import { getDb, getSettings, listDocs, putSettingsWithinTx, replaceDocsWithinTx, withTransaction } from '../store/db.ts'

export interface StoredAccount {
  alias: string
  token: string
  apiUrl: string
  username?: string
  createdAt: number
  updatedAt: number
}
interface StoreFile { version: 1; settings: GitHubSettings; accounts: StoredAccount[] }
const DEFAULT_SETTINGS: GitHubSettings = { apiUrl: 'https://api.github.com', gitExecutable: 'git', autoFetchOnOpen: false, allowPush: false, allowForcePush: false }
/** 兼容保留：旧 JSON 文件位置（仅迁移器与诊断用途；运行时数据已入 SQLite 库）。 */
export function storePath(): string { return join(homedir(), '.dsh', 'dsh-github.json') }

const DOCS_DOMAIN = 'github.account'
const SETTINGS_DOMAIN = 'github.settings'

export class GithubStore {
  private readonly db: ReturnType<typeof getDb>
  /** 兼容保留：库文件路径（原 JSON 文件路径语义已变更）。 */
  readonly path: string
  constructor(path?: string) {
    this.db = getDb(path)
    this.path = path ?? ''
  }
  settings(): GitHubSettings { return { ...DEFAULT_SETTINGS, ...this.load().settings } }
  updateSettings(patch: GitHubConfigPayload): GitHubSettings {
    const file = this.load()
    const current = this.settings()
    const next: GitHubSettings = {
      ...current,
      ...(patch.apiUrl !== undefined ? { apiUrl: normalizeApiUrl(patch.apiUrl) } : {}),
      ...(patch.gitExecutable !== undefined ? { gitExecutable: patch.gitExecutable.trim() || 'git' } : {}),
      ...(patch.defaultAccount !== undefined ? { defaultAccount: patch.defaultAccount.trim() || undefined } : {}),
      ...(patch.defaultRepoDir !== undefined ? { defaultRepoDir: patch.defaultRepoDir.trim() || undefined } : {}),
      ...(patch.autoFetchOnOpen !== undefined ? { autoFetchOnOpen: Boolean(patch.autoFetchOnOpen) } : {}),
      ...(patch.allowPush !== undefined ? { allowPush: Boolean(patch.allowPush) } : {}),
      ...(patch.allowForcePush !== undefined ? { allowForcePush: Boolean(patch.allowForcePush) } : {}),
    }
    file.settings = next; this.save(file); return next
  }
  listAccounts(): AccountSummary[] { return this.load().accounts.map(account => this.summarize(account)) }
  findAccount(alias?: string): StoredAccount {
    const file = this.load()
    const selected = alias?.trim() || this.settings().defaultAccount || file.accounts[0]?.alias
    const account = file.accounts.find(candidate => candidate.alias === selected)
    if (account === undefined) throw new Error(selected === undefined ? 'No GitHub account configured. Open the GitHub panel and add an account.' : 'GitHub account ' + selected + ' not found')
    return account
  }
  upsertAccount(payload: { alias: string; token?: string; apiUrl?: string }): AccountSummary {
    const alias = payload.alias.trim()
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(alias)) throw new Error('account alias must start with a letter or digit and use only letters, digits, dots, hyphens or underscores')
    const file = this.load()
    const existing = file.accounts.find(account => account.alias === alias)
    const token = payload.token?.trim() || existing?.token
    if (!token) throw new Error('GitHub token is required')
    const now = Date.now()
    const entry: StoredAccount = { alias, token, apiUrl: normalizeApiUrl(payload.apiUrl || existing?.apiUrl || file.settings.apiUrl), ...(existing?.username !== undefined ? { username: existing.username } : {}), createdAt: existing?.createdAt ?? now, updatedAt: now }
    if (existing === undefined) file.accounts.push(entry); else file.accounts[file.accounts.indexOf(existing)] = entry
    if (file.settings.defaultAccount === undefined) file.settings.defaultAccount = alias
    this.save(file); return this.summarize(entry)
  }
  setUsername(alias: string, username: string): void {
    const file = this.load(); const account = file.accounts.find(candidate => candidate.alias === alias)
    if (account === undefined) throw new Error('GitHub account ' + alias + ' not found')
    account.username = username; account.updatedAt = Date.now(); this.save(file)
  }
  deleteAccount(alias: string): void {
    const file = this.load(); const index = file.accounts.findIndex(account => account.alias === alias)
    if (index < 0) throw new Error('GitHub account ' + alias + ' not found')
    file.accounts.splice(index, 1); if (file.settings.defaultAccount === alias) file.settings.defaultAccount = file.accounts[0]?.alias; this.save(file)
  }
  summarize(account: StoredAccount): AccountSummary { return { alias: account.alias, apiUrl: account.apiUrl, ...(account.username !== undefined ? { username: account.username } : {}), tokenConfigured: account.token.length > 0, createdAt: account.createdAt, updatedAt: account.updatedAt } }
  /** 从库拼回原文件结构形状（业务方法无感知）。 */
  private load(): StoreFile {
    const accounts = listDocs(this.db, DOCS_DOMAIN)
      .map(row => JSON.parse(row.data) as StoredAccount)
      .filter(account => typeof account?.alias === 'string')
    const settings = getSettings<Partial<GitHubSettings>>(this.db, SETTINGS_DOMAIN) ?? {}
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
  if (!/^https?:\/\//i.test(url)) throw new Error('GitHub API URL must start with http:// or https://')
  return url
}
