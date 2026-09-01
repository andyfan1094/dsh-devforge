/**
 * CNB 备份核心编排：配置、密码、上传（git 通道）、恢复。
 *
 * 备份通道：CNB OpenAPI 无文件写入端点（swagger 仅 GET contents），采用 git CLI
 * （复用 cnb/git.ts GitRunner：token 经临时 http.extraheader 注入，绝不进 URL/日志，
 * 跨平台 spawn）。工作副本 `${dshHome}/devforge/backup-work/`，备份仓库由用户在
 * cnb.cool 手动创建为【私密】仓库后填入面板。
 *
 * 密码模型：6 位密码存本机 `${dshHome}/devforge/backup-secret.json`（0600，
 * 定时自动同步必需无人值守），CNB 侧只有密文（密码密钥分离）；恢复端输入密码解密。
 *
 * 恢复流程（本进程内闭环）：closeDb 释放连接 → 替换 store.db（原文件先备份）→
 * 重开连接 → dsh-feishu.json 回写（原文件先备份）→ coding plan 凭据镜像回写 yaml。
 * 恢复完成后必须重启 Host（UI 明确提示），其他进程打开的旧库连接才会收敛。
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { chmodSync, statSync } from 'node:fs'
import { hostname, homedir } from 'node:os'
import { join } from 'node:path'
import { GitRunner } from '../cnb/git.ts'
import { CnbStore, type StoredAccount } from '../cnb/store.ts'
import { CnbApi } from '../cnb/cnb-api.ts'
import { setCredential } from '../credentials-writer.ts'
import { closeDb, getDb, getSettings, putSettings } from '../store/db.ts'
import { buildBackupContainer, parseBackupContainer, feishuStorePath } from './snapshot.ts'
import { decryptBackupContainer, encryptBackupContainer } from './crypto.ts'

/** 备份配置（settings 域持久化）。 */
export interface BackupSettings {
  enabled: boolean
  /** CNB 账号别名（store 库 cnb.account 域）。 */
  accountAlias: string
  /** 备份仓库，格式 owner/name（须为 CNB 私密仓库）。 */
  repo: string
  /** 同步间隔。 */
  interval: '15m' | '1h' | '6h' | '24h'
}

const DEFAULT_SETTINGS: BackupSettings = { enabled: false, accountAlias: '', repo: '', interval: '1h' }

/** 备份运行状态（settings 域；hash 用于内容无变化跳过）。 */
export interface BackupState {
  lastPushAt?: number
  lastContentHash?: string
  lastSize?: number
  lastError?: string
  consecutiveFailures?: number
}

const SETTINGS_DOMAIN = 'backup.settings'

/**
 * 备份运行状态存【库外文件】（dshHome/devforge/backup-state.json，0600）：
 * 若存库内，每次推送写状态都会改变库内容 → 下次快照 hash 变化 → 「内容无变化跳过」永久失效。
 * 状态仅为本机运行信息，不进备份容器。
 */
function statePath(): string {
  return join(homedir(), '.dsh', 'devforge', 'backup-state.json')
}

/** 间隔 → 毫秒。 */
export function intervalToMs(interval: BackupSettings['interval']): number {
  const table: Record<BackupSettings['interval'], number> = {
    '15m': 15 * 60_000,
    '1h': 60 * 60_000,
    '6h': 6 * 60 * 60_000,
    '24h': 24 * 60 * 60_000,
  }
  return table[interval]
}

// ------------------------------------------------ 配置与密码

export function readBackupSettings(): BackupSettings {
  const stored = getSettings<Partial<BackupSettings>>(getDb(), SETTINGS_DOMAIN) ?? {}
  return { ...DEFAULT_SETTINGS, ...stored }
}

export function writeBackupSettings(patch: Partial<BackupSettings>): BackupSettings {
  const next = { ...readBackupSettings(), ...patch }
  putSettings(getDb(), SETTINGS_DOMAIN, next)
  return next
}

export function readBackupState(): BackupState {
  const path = statePath()
  if (!existsSync(path)) return {}
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as BackupState
  } catch {
    return {}
  }
}

function writeBackupState(patch: Partial<BackupState>): BackupState {
  const next = { ...readBackupState(), ...patch }
  const path = statePath()
  mkdirSync(join(path, '..'), { recursive: true, mode: 0o700 })
  const tmp = path + '.tmp'
  writeFileSync(tmp, JSON.stringify(next) + '\n', { encoding: 'utf8', mode: 0o600 })
  try { chmodSync(tmp, 0o600) } catch { /* Windows ACL 继承 */ }
  rmSync(path, { force: true })
  renameSync(tmp, path)
  return next
}

/** 密码文件路径（0600；仅本机，供无人值守定时同步）。 */
function secretPath(): string {
  return join(homedir(), '.dsh', 'devforge', 'backup-secret.json')
}

/** 读取备份密码（未设置返回 undefined）。 */
export function readBackupPassword(): string | undefined {
  const path = secretPath()
  if (!existsSync(path)) return undefined
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as { password?: unknown }
    return typeof parsed.password === 'string' && parsed.password !== '' ? parsed.password : undefined
  } catch {
    return undefined
  }
}

/** 设置备份密码（0600 原子写；Windows 忽略 chmod，ACL 继承）。 */
export function writeBackupPassword(password: string): void {
  if (password === '') throw new Error('备份密码不能为空。')
  const path = secretPath()
  const tmp = path + '.tmp'
  mkdirSync(join(path, '..'), { recursive: true, mode: 0o700 })
  writeFileSync(tmp, JSON.stringify({ password }) + '\n', { encoding: 'utf8', mode: 0o600 })
  try { chmodSync(tmp, 0o600) } catch { /* Windows ACL 继承 */ }
  rmSync(path, { force: true })
  renameSync(tmp, path)
}

/** 清除备份密码（关闭备份或重置时）。 */
export function clearBackupPassword(): void {
  rmSync(secretPath(), { force: true })
}

// ------------------------------------------------ 备份仓库（自动创建）

/**
 * 确保备份仓库就绪：不存在 → 用 CNB OpenAPI 自动创建【私密】仓库
 * （POST /{owner}/-/repos，实测 201；需要令牌含 group-resource:rw 权限）；
 * 已存在 → 校验为私密（公开仓库拒绝承载密文备份）。
 */
export async function ensurePrivateRepo(account: StoredAccount, repo: string): Promise<{ created: boolean; visibility: string }> {
  const api = new CnbApi(new CnbStore())
  const info = await api.request<{ visibility_level?: string; private?: boolean }>(account, '/' + repo).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    if (/\(404\)/.test(message)) return undefined // 仓库不存在 → 走创建
    throw new Error('备份仓库校验失败：' + message)
  })
  if (info === undefined) {
    const [owner, name] = repo.split('/')
    if (owner === undefined || name === undefined) throw new Error('仓库格式必须为 owner/name：' + repo)
    const created = await api.writeRequest<unknown>(account, '/' + owner + '/-/repos', {
      name,
      description: '天工造梦配置加密备份仓库（自动同步，密文存储）',
      visibility: 'private',
    })
    if (created.status !== 201 && created.status !== 200) {
      throw new Error('自动创建备份仓库失败（HTTP ' + created.status + '）。令牌可能缺少 group-resource:rw 权限，请在 cnb.cool 网页手动创建私密仓库。')
    }
    return { created: true, visibility: 'Private' }
  }
  const visibility = info.visibility_level ?? (info.private === true ? 'Private' : 'Public')
  if (visibility !== 'Private' && visibility !== 'Secret') {
    throw new Error('备份仓库必须是【私密】仓库（当前 ' + visibility + '），公开仓库拒绝承载密文备份。请在 cnb.cool 仓库设置中改为私密。')
  }
  return { created: false, visibility }
}

// ------------------------------------------------ git 通道

/** 工作副本目录。 */
function workDir(): string {
  return join(homedir(), '.dsh', 'devforge', 'backup-work')
}

const REPO_HTTPS_PREFIX = 'https://cnb.cool/'

/** 确保工作副本就绪：不存在则 clone；存在则 pull --rebase（失败重 clone 重建）。 */
async function ensureWorkDir(runner: GitRunner, account: StoredAccount, repo: string): Promise<void> {
  const dir = workDir()
  const gitDir = join(dir, '.git')
  if (!existsSync(gitDir)) {
    rmSync(dir, { recursive: true, force: true })
    mkdirSync(join(dir, '..'), { recursive: true, mode: 0o700 })
    const cloned = await runner.run(['clone', '--depth', '1', REPO_HTTPS_PREFIX + repo + '.git', dir], undefined, account)
    if (!cloned.ok) throw new Error('克隆备份仓库失败：' + (cloned.stderr || cloned.stdout || '未知错误'))
    return
  }
  const pulled = await runner.run(['pull', '--rebase', '--autostash'], dir, account)
  if (!pulled.ok) {
    // 工作副本损坏（冲突/远端重置等）→ 重建比教用户修 git 划算
    rmSync(dir, { recursive: true, force: true })
    await ensureWorkDir(runner, account, repo)
  }
}

// ------------------------------------------------ 上传

/** 立即执行一次备份；返回摘要（供路由与工具展示）。 */
export async function backupNow(options?: { force?: boolean }): Promise<{ ok: boolean; skipped?: string; size?: number; commitMessage?: string; error?: string }> {
  const settings = readBackupSettings()
  if (!settings.enabled) return { ok: false, skipped: '备份未启用' }
  if (settings.accountAlias === '' || settings.repo === '') return { ok: false, skipped: '备份仓库或 CNB 账号未配置' }
  const password = readBackupPassword()
  if (password === undefined) return { ok: false, skipped: '备份密码未设置' }

  try {
    const store = new CnbStore()
    const account = store.findAccount(settings.accountAlias)
    const runner = new GitRunner(store)

    // 组装 + 加密（组装时顺带刷新凭据镜像，备份永远是 yaml 当前值）
    const { plaintext, fileCount, contentHash } = buildBackupContainer()
    const container = await encryptBackupContainer(plaintext, password)
    const hash = contentHash // 排除时间戳的内容 hash：数据不变则跳过推送
    const state = readBackupState()
    if (options?.force !== true && state.lastContentHash === hash) {
      writeBackupState({ lastPushAt: Date.now(), lastContentHash: hash, lastSize: container.length, lastError: undefined })
      return { ok: true, skipped: '内容无变化', size: container.length }
    }

    // 工作副本 + 密文落盘（latest + 按天历史）
    await ensureWorkDir(runner, account, settings.repo)
    const dir = workDir()
    const backupsDir = join(dir, 'backups')
    mkdirSync(join(backupsDir, 'history'), { recursive: true, mode: 0o700 })
    const dateTag = new Date().toISOString().slice(0, 10)
    writeFileSync(join(backupsDir, 'latest.json'), container, { mode: 0o600 })
    writeFileSync(join(backupsDir, 'history', dateTag + '.json'), container, { mode: 0o600 })

    // 提交 + 推送（push 失败：pull --rebase 后重试一次）
    const machine = hostname()
    await runner.run(['add', 'backups'], dir, account)
    const committed = await runner.run(
      ['commit', '-m', '备份：' + dateTag + ' ' + machine + '（' + fileCount + ' 文件，' + container.length + ' 字节）'],
      dir, account,
    )
    if (committed.ok) {
      let pushed = await runner.run(['push', 'origin', 'HEAD'], dir, account)
      if (!pushed.ok) {
        await runner.run(['pull', '--rebase', '--autostash'], dir, account)
        pushed = await runner.run(['push', 'origin', 'HEAD'], dir, account)
      }
      if (!pushed.ok) throw new Error('推送备份仓库失败：' + (pushed.stderr || pushed.stdout || '未知错误'))
    } else if (!/nothing to commit/.test(committed.stdout + committed.stderr)) {
      throw new Error('提交备份失败：' + (committed.stderr || committed.stdout || '未知错误'))
    }

    writeBackupState({ lastPushAt: Date.now(), lastContentHash: hash, lastSize: container.length, lastError: undefined, consecutiveFailures: 0 })
    return { ok: true, size: container.length, commitMessage: '备份：' + dateTag }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const failures = (readBackupState().consecutiveFailures ?? 0) + 1
    writeBackupState({ lastError: message, consecutiveFailures: failures })
    return { ok: false, error: message }
  }
}

// ------------------------------------------------ 恢复

/** 远端备份摘要（列表用，不含密文内容）。 */
export interface RemoteBackupInfo {
  path: string
  size: number
  modifiedAt?: number
}

/** 列远端备份历史（git pull 后读工作副本目录）。 */
export async function listRemoteBackups(): Promise<RemoteBackupInfo[]> {
  const settings = readBackupSettings()
  if (settings.accountAlias === '' || settings.repo === '') throw new Error('备份仓库或 CNB 账号未配置。')
  const store = new CnbStore()
  const account = store.findAccount(settings.accountAlias)
  const runner = new GitRunner(store)
  await ensureWorkDir(runner, account, settings.repo)
  const backupsDir = join(workDir(), 'backups')
  const result: RemoteBackupInfo[] = []
  if (existsSync(backupsDir)) {
    for (const name of ['latest.json', ...listHistoryNames(backupsDir)]) {
      const path = join(backupsDir, name)
      if (!existsSync(path)) continue
      const stats = statSync(path)
      result.push({ path: 'backups/' + name, size: stats.size, modifiedAt: stats.mtimeMs })
    }
  }
  return result
}

function listHistoryNames(backupsDir: string): string[] {
  const historyDir = join(backupsDir, 'history')
  if (!existsSync(historyDir)) return []
  try {
    return readdirSync(historyDir).filter(name => name.endsWith('.json')).sort().reverse()
  } catch {
    return []
  }
}

/** 下载远端最新备份并解密，返回容器内容（不落盘）。 */
export async function fetchAndDecryptLatest(password: string): Promise<ReturnType<typeof parseBackupContainer>> {
  const settings = readBackupSettings()
  if (settings.accountAlias === '' || settings.repo === '') throw new Error('备份仓库或 CNB 账号未配置。')
  const store = new CnbStore()
  const account = store.findAccount(settings.accountAlias)
  const runner = new GitRunner(store)
  await ensureWorkDir(runner, account, settings.repo)
  const latestPath = join(workDir(), 'backups', 'latest.json')
  if (!existsSync(latestPath)) throw new Error('远端没有备份文件（backups/latest.json 不存在）。')
  const container = readFileSync(latestPath)
  return parseBackupContainer(await decryptBackupContainer(container, password))
}

/** 用解密后的容器恢复本机数据（本进程内闭环；完成后必须重启 Host）。 */
export async function restoreFromContainer(container: ReturnType<typeof parseBackupContainer>): Promise<{ restoredFiles: string[]; restarted: false }> {
  const restoredFiles: string[] = []
  // 1) store.db：现有文件先备份 → closeDb 释放本进程连接 → 替换（含 WAL/SHM 清理）→ 重开
  const storeDbPath = defaultStoreDbPath()
  if (existsSync(storeDbPath)) {
    writeFileSync(storeDbPath + '.pre-restore.bak', readFileSync(storeDbPath), { mode: 0o600 })
  }
  if (container.files['store.db'] !== undefined) {
    closeDb()
    writeFileSync(storeDbPath, Buffer.from(container.files['store.db'], 'base64'), { mode: 0o600 })
    rmSync(storeDbPath + '-wal', { force: true })
    rmSync(storeDbPath + '-shm', { force: true })
    getDb() // 重开连接（新数据）
    restoredFiles.push('store.db')
  }
  // 2) 飞书配置（原文件先备份）
  if (container.files['dsh-feishu.json'] !== undefined) {
    const feishuPath = feishuStorePath()
    if (existsSync(feishuPath)) {
      writeFileSync(feishuPath + '.pre-restore.bak', readFileSync(feishuPath), { mode: 0o600 })
    }
    writeFileSync(feishuPath, Buffer.from(container.files['dsh-feishu.json'], 'base64'), { mode: 0o600 })
    restoredFiles.push('dsh-feishu.json')
  }
  // 3) coding plan 凭据镜像 → 回写 yaml 主存（恢复端 yaml 可能还没有这些 ref）
  const refs = readCredentialMirrors(getDb())
  if (refs.length > 0) {
    // setCredential 逐条 upsert；yaml 其他 ref 原样保留
    for (const { ref, value } of refs) {
      await setCredential(ref, value)
      restoredFiles.push('credentials:' + ref)
    }
  }
  return { restoredFiles, restarted: false }
}

function defaultStoreDbPath(): string {
  return join(homedir(), '.dsh', 'devforge', 'store.db')
}

/** 读取 credential 镜像表（ref + value；供恢复回写 yaml）。 */
function readCredentialMirrors(db: ReturnType<typeof getDb>): Array<{ ref: string; value: string }> {
  const rows = db.prepare('SELECT ref, value FROM credential ORDER BY ref').all()
  return rows.map(row => ({ ref: String(row['ref']), value: String(row['value']) }))
}