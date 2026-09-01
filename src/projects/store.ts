/**
 * 项目面板存储与路径检测。
 *
 * - 存储复用插件统一 SQLite（store.db docs 表，domain=project.registry），
 *   单条 upsert / 删除用精确 SQL，清单走 listDocs 稳定排序；数据量 KB 级。
 * - 路径检测只读 Git 元数据文件（.git/config、.git/HEAD），不执行任何
 *   Git 命令、不读取工作区文件内容；支持 worktree（.git 为指针文件）。
 * - 仓库托管类型按远端 URL 识别：cnb.cool → cnb、github.com → github、
 *   其余非空 → git；未配置远端 → none。
 */

import { existsSync, readFileSync, statSync } from 'node:fs'
import { isAbsolute, basename, dirname, join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { getDb, listDocs } from '../store/db.ts'
import type { DeployTarget, DetectedRemote, ProjectDetectResult, ProjectEntry, RepoKind } from './protocol.ts'

/** 库内域常量：项目登记列表。 */
const DOCS_DOMAIN = 'project.registry'

/** 将未知异常规整为消息文本。 */
function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** 按 URL 识别仓库托管类型。 */
export function classifyRepoKind(url: string): RepoKind {
  const lower = url.toLowerCase()
  if (lower.includes('cnb.cool')) return 'cnb'
  if (lower.includes('github.com')) return 'github'
  if (url.trim() !== '') return 'git'
  return 'none'
}

/** 校验发布服务器目标列表形状；返回错误消息或 undefined。 */
function validateDeployTargets(value: unknown): string | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) return 'deployTargets 必须是数组'
  for (const item of value) {
    if (typeof item !== 'object' || item === null) return 'deployTargets 元素必须是对象'
    const t = item as Record<string, unknown>
    if (t.transport !== 'ssh' && t.transport !== 'winrm') return 'deployTargets.transport 只能是 ssh 或 winrm'
    if (typeof t.alias !== 'string' || t.alias.trim() === '') return 'deployTargets.alias 必须是非空字符串'
  }
  return undefined
}

/** 校验项目保存载荷；返回错误消息或 undefined。 */
export function validateProjectPayload(payload: unknown): string | undefined {
  if (typeof payload !== 'object' || payload === null) return 'body must be a JSON object'
  const p = payload as Record<string, unknown>
  if (typeof p.name !== 'string' || p.name.trim() === '') return 'name 必须是非空字符串'
  if (typeof p.path !== 'string' || p.path.trim() === '') return 'path 必须是非空字符串'
  if (!isAbsolute(p.path.trim())) return 'path 必须是绝对路径'
  if (p.description !== undefined && typeof p.description !== 'string') return 'description 必须是字符串'
  const kind = p.repoKind ?? 'none'
  if (kind !== 'none' && kind !== 'cnb' && kind !== 'github' && kind !== 'git') return 'repoKind 必须是 none/cnb/github/git'
  if (p.repoUrl !== undefined && typeof p.repoUrl !== 'string') return 'repoUrl 必须是字符串'
  if (p.repoBranch !== undefined && typeof p.repoBranch !== 'string') return 'repoBranch 必须是字符串'
  return validateDeployTargets(p.deployTargets)
}

/** 读取全部项目（按 sort_order 稳定排序）。 */
export function listProjects(): ProjectEntry[] {
  const db = getDb()
  return listDocs(db, DOCS_DOMAIN).map((row) => {
    const parsed = JSON.parse(row.data) as Partial<ProjectEntry> & { id?: string }
    return {
      id: row.id,
      name: typeof parsed.name === 'string' ? parsed.name : '',
      path: typeof parsed.path === 'string' ? parsed.path : '',
      description: typeof parsed.description === 'string' ? parsed.description : '',
      repoKind: (parsed.repoKind ?? 'none') as RepoKind,
      repoUrl: typeof parsed.repoUrl === 'string' ? parsed.repoUrl : '',
      repoBranch: typeof parsed.repoBranch === 'string' ? parsed.repoBranch : '',
      deployTargets: Array.isArray(parsed.deployTargets) ? parsed.deployTargets as DeployTarget[] : [],
      createdAt: typeof parsed.createdAt === 'number' ? parsed.createdAt : 0,
      updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0,
    }
  })
}

/**
 * 保存（新增或更新）一个项目；载荷须先过 validateProjectPayload。
 * id 缺省时生成 UUID；已存在的 id 保留 created_at 并刷新 updated_at。
 */
export function saveProject(payload: Record<string, unknown>): ProjectEntry {
  const now = Date.now()
  const id = typeof payload.id === 'string' && payload.id.trim() !== '' ? payload.id.trim() : randomUUID()
  const existing = getProject(id)
  // 可选字段「未传即保留旧值」：部分更新（如只改名称）不会误清空其余登记。
  const entry: ProjectEntry = {
    id,
    name: String(payload.name).trim(),
    path: String(payload.path).trim(),
    description: typeof payload.description === 'string' ? payload.description : (existing?.description ?? ''),
    repoKind: (payload.repoKind ?? existing?.repoKind ?? 'none') as RepoKind,
    repoUrl: typeof payload.repoUrl === 'string' ? payload.repoUrl.trim() : (existing?.repoUrl ?? ''),
    repoBranch: typeof payload.repoBranch === 'string' ? payload.repoBranch.trim() : (existing?.repoBranch ?? ''),
    deployTargets: Array.isArray(payload.deployTargets) ? payload.deployTargets as DeployTarget[] : (existing?.deployTargets ?? []),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
  const db = getDb()
  db.prepare(
    'INSERT INTO docs(domain, id, data, sort_order, created_at, updated_at) '
    + 'VALUES (?, ?, ?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM docs WHERE domain = ?), ?, ?) '
    + 'ON CONFLICT(domain, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at',
  ).run(DOCS_DOMAIN, entry.id, JSON.stringify(entry), DOCS_DOMAIN, entry.createdAt, entry.updatedAt)
  return entry
}

/** 读取单个项目；不存在返回 undefined。 */
export function getProject(id: string): ProjectEntry | undefined {
  return listProjects().find((project) => project.id === id)
}

/** 删除单个项目；返回是否确实删除。 */
export function removeProject(id: string): boolean {
  const db = getDb()
  const result = db.prepare('DELETE FROM docs WHERE domain = ? AND id = ?').run(DOCS_DOMAIN, id)
  return Number(result.changes) > 0
}

/** 解析 .git 指针：目录直接返回；worktree 指针文件读 gitdir 行。 */
function resolveGitDir(projectPath: string): string | undefined {
  const dotGit = join(projectPath, '.git')
  if (!existsSync(dotGit)) return undefined
  const stat = statSync(dotGit)
  if (stat.isDirectory()) return dotGit
  if (!stat.isFile()) return undefined
  try {
    const content = readFileSync(dotGit, 'utf8').trim()
    const match = /^gitdir:\s*(.+)$/m.exec(content)
    if (!match) return undefined
    const gitdir = match[1].trim()
    // gitdir 可能是相对项目目录的路径，统一按项目路径解析。
    return resolve(projectPath, gitdir)
  } catch {
    return undefined
  }
}

/** 解析 .git/config 文本，按出现顺序收集远端；origin 提前排最前。 */
function parseRemotesFromConfig(configText: string): DetectedRemote[] {
  const remotes: DetectedRemote[] = []
  let current: string | undefined
  for (const rawLine of configText.split(/\r?\n/)) {
    const line = rawLine.trim()
    const section = /^\[remote\s+"([^"]+)"\]\s*$/.exec(line)
    if (section) {
      current = section[1]
      continue
    }
    // 离开 remote 段落（进入其他 section）后不再收集 url。
    if (/^\[/.test(line)) {
      current = undefined
      continue
    }
    if (current === undefined) continue
    const url = /^url\s*=\s*(.+)$/.exec(line)
    if (url) {
      const value = url[1].trim()
      remotes.push({ name: current, url: value, kind: classifyRepoKind(value) })
    }
  }
  // origin 排最前，其余保持 config 中的出现顺序。
  remotes.sort((a, b) => (a.name === 'origin' ? -1 : b.name === 'origin' ? 1 : 0))
  return remotes
}

/** 读取 .git/HEAD 的当前分支；分离 HEAD 返回短 commit。 */
function readBranch(gitDir: string): string | undefined {
  try {
    const head = readFileSync(join(gitDir, 'HEAD'), 'utf8').trim()
    const ref = /^ref:\s*refs\/heads\/(.+)$/.exec(head)
    if (ref) return ref[1].trim()
    return head.slice(0, 12)
  } catch {
    return undefined
  }
}

/**
 * 检测项目路径：存在性、Git 仓库、远端与分支。
 * 只读 .git 元数据；任何读取失败都收敛为结构化结果，绝不抛出。
 */
export function detectProjectGit(inputPath: string): ProjectDetectResult {
  const trimmed = typeof inputPath === 'string' ? inputPath.trim() : ''
  const base: ProjectDetectResult = { ok: true, exists: false, isGitRepo: false, remotes: [] }
  if (trimmed === '') return { ...base, error: 'path 不能为空' }
  try {
    if (!existsSync(trimmed)) return { ...base, error: '路径不存在：' + trimmed }
    const stat = statSync(trimmed)
    if (!stat.isDirectory()) return { ...base, error: '路径不是目录：' + trimmed }
    const gitDir = resolveGitDir(trimmed)
    const result: ProjectDetectResult = {
      ...base,
      exists: true,
      isGitRepo: gitDir !== undefined,
      name: basename(trimmed) || trimmed,
    }
    if (gitDir === undefined) return result
    try {
      const configText = readFileSync(join(gitDir, 'config'), 'utf8')
      result.remotes = parseRemotesFromConfig(configText)
    } catch (error) {
      result.error = '读取 .git/config 失败：' + toMessage(error)
    }
    result.branch = readBranch(gitDir)
    return result
  } catch (error) {
    return { ...base, error: '检测失败：' + toMessage(error) }
  }
}

/** 项目默认名（目录名），供前端「检测」后回填空名称。 */
export function defaultProjectName(inputPath: string): string {
  const trimmed = typeof inputPath === 'string' ? inputPath.trim() : ''
  if (trimmed === '') return ''
  try {
    return basename(trimmed) || dirname(trimmed)
  } catch {
    return ''
  }
}
