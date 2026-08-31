/**
 * 旧 JSON 数据文件 → SQLite 一次性迁移器（幂等）。
 *
 * 迁移对象（devforge 插件自有数据，位于 `${dshHome}` 根目录）：
 *   dsh-cnb.json    { version, settings, accounts[] }   → docs/cnb.account + settings/cnb.settings
 *   dsh-github.json { version, settings, accounts[] }   → docs/github.account + settings/github.settings
 *   dsh-ssh.json    { version, hosts[] }                → docs/ssh.host
 *   dsh-winrm.json  { version, hosts[] }                → docs/winrm.host
 *
 * 行为约定：
 * - 仅当「旧文件存在 且 库中对应域为空」时导入；导入成功后旧文件改名 *.migrated.bak 保留
 *   （可人工回滚，绝不删除）。域非空视为已迁移或已有新数据，跳过且不动旧文件。
 * - .credentials.yaml 是宿主主存，**只镜像不迁移**：把 devforge 专用的 coding plan refs
 *   值复制进 credential 镜像表（yaml 保留原样；宿主 ctx.credentials.resolve 行为零改动）。
 *   镜像的刷新时机：本函数（启动）+ 凭据面板写入时（credentials-routes）+ 备份上传前。
 * - 所有步骤幂等，重复执行无副作用。
 */

import { existsSync, readFileSync, renameSync, unlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { getSettings, listDocs, putCredentialMirror, putSettings, replaceDocs } from './db.ts'

/** devforge 专用、需要镜像进库的凭据 ref（coding plan 三家 + 方舟 AK/SK）。 */
export const DEVFORGE_CREDENTIAL_REFS = [
  'ZAI_CODING_CN_API_KEY',
  'MINIMAX_CN_API_KEY',
  'ARK_CODING_PLAN_API_KEY',
  'VOLC_ACCESS_KEY',
  'VOLC_SECRET_KEY',
] as const

/** 迁移结果摘要（供日志与测试断言）。 */
export interface MigrationResult {
  imported: string[]
  skipped: string[]
  mirroredRefs: string[]
}

/** 执行一次性迁移；dshDirOverride 供测试注入独立目录。 */
export function migrateFromLegacyFiles(db: DatabaseSync, dshDirOverride?: string): MigrationResult {
  const dshDir = dshDirOverride ?? ((process.env.DSH_HOME?.trim()) || join(homedir(), '.dsh'))
  const result: MigrationResult = { imported: [], skipped: [], mirroredRefs: [] }

  migrateAccountStore(db, dshDir, 'dsh-cnb.json', 'cnb.account', 'cnb.settings', result)
  migrateAccountStore(db, dshDir, 'dsh-github.json', 'github.account', 'github.settings', result)
  migrateHostStore(db, dshDir, 'dsh-ssh.json', 'ssh.host', result)
  migrateHostStore(db, dshDir, 'dsh-winrm.json', 'winrm.host', result)
  mirrorYamlCredentials(db, dshDir, result)
  return result
}

/** 账号型 store（cnb/github）：{ version, settings, accounts[] }。 */
function migrateAccountStore(
  db: DatabaseSync,
  dshDir: string,
  fileName: string,
  docsDomain: string,
  settingsDomain: string,
  result: MigrationResult,
): void {
  const path = join(dshDir, fileName)
  if (!existsSync(path)) return
  if (listDocs(db, docsDomain).length > 0 || getSettings(db, settingsDomain) !== undefined) {
    result.skipped.push(fileName); return
  }
  let parsed: { settings?: unknown; accounts?: unknown }
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    result.skipped.push(fileName); return // 损坏文件不 rename，保留供人工恢复
  }
  if (typeof parsed !== 'object' || parsed === null || !Array.isArray(parsed.accounts)) {
    result.skipped.push(fileName); return
  }
  const accounts = parsed.accounts as Array<Record<string, unknown>>
  replaceDocs(db, docsDomain, accounts
    .filter(account => typeof account?.['alias'] === 'string')
    .map(account => ({ id: String(account['alias']), data: account })))
  if (typeof parsed.settings === 'object' && parsed.settings !== null) {
    putSettings(db, settingsDomain, parsed.settings)
  }
  archiveLegacyFile(path)
  result.imported.push(fileName)
}

/** 主机型 store（ssh/winrm）：{ version, hosts[] }。 */
function migrateHostStore(
  db: DatabaseSync,
  dshDir: string,
  fileName: string,
  docsDomain: string,
  result: MigrationResult,
): void {
  const path = join(dshDir, fileName)
  if (!existsSync(path)) return
  if (listDocs(db, docsDomain).length > 0) { result.skipped.push(fileName); return }
  let parsed: { hosts?: unknown }
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    result.skipped.push(fileName); return
  }
  if (typeof parsed !== 'object' || parsed === null || !Array.isArray(parsed.hosts)) {
    result.skipped.push(fileName); return
  }
  const hosts = parsed.hosts as Array<Record<string, unknown>>
  replaceDocs(db, docsDomain, hosts
    .filter(host => typeof host?.['alias'] === 'string')
    .map(host => ({ id: String(host['alias']), data: host })))
  archiveLegacyFile(path)
  result.imported.push(fileName)
}

/** 旧文件改名归档：目标已存在（重复迁移）先清掉（Windows rename 覆盖语义差异兜底）。 */
function archiveLegacyFile(path: string): void {
  const target = path + '.migrated.bak'
  try { if (existsSync(target)) unlinkSync(target) } catch { /* best effort */ }
  try { renameSync(path, target) } catch { /* rename 失败保留原文件，不影响已入库数据 */ }
}

/**
 * coding plan refs：yaml → credential 镜像（覆盖式刷新，yaml 不动）。
 * yaml 主存、库镜像的设计见文件头注释。
 */
function mirrorYamlCredentials(db: DatabaseSync, dshDir: string, result: MigrationResult): void {
  const yamlPath = join(dshDir, '.credentials.yaml')
  if (!existsSync(yamlPath)) return
  let raw = ''
  try { raw = readFileSync(yamlPath, 'utf8') } catch { return }
  for (const ref of DEVFORGE_CREDENTIAL_REFS) {
    const value = readYamlRefValue(raw, ref)
    if (value === undefined) continue
    putCredentialMirror(db, ref, value)
    result.mirroredRefs.push(ref)
  }
}

/** 从 .credentials.yaml 原文读一个 ref 值（与 credentials-writer 的 refs 段格式对应）。 */
function readYamlRefValue(raw: string, ref: string): string | undefined {
  if (raw === '') return undefined
  const lines = raw.split('\n')
  const refsLine = lines.findIndex(line => /^\s*refs:\s*$/.test(line))
  if (refsLine === -1) return undefined
  for (let i = refsLine + 1; i < lines.length; i += 1) {
    const line = lines[i]
    if (/^\s*\w[^:]*:\s*$/.test(line)) break // 离开 refs 段
    const match = /^\s+([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/.exec(line)
    if (match === null) continue
    if (match[1] === ref) {
      const value = (match[2] ?? '').trim()
      return value === '' ? undefined : value
    }
  }
  return undefined
}
