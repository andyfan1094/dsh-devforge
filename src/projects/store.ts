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
import type { DeployTarget, DetectedRemote, ProjectDetectResult, ProjectEntry, ProjectFact, ProjectRelocateResult, RepoKind } from './protocol.ts'

/** 库内域常量：项目登记列表。 */
const DOCS_DOMAIN = 'project.registry'

/** meta 表键：本机机器标识（多端同步后区分「这条路径是哪台电脑的」）。 */
const META_MACHINE_ID = 'project.machine_id'

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
    if (t.remotePath !== undefined && typeof t.remotePath !== 'string') return 'deployTargets.remotePath 必须是字符串'
  }
  return undefined
}

/** 校验项目保存载荷；返回错误消息或 undefined。 */
export function validateProjectPayload(payload: unknown): string | undefined {
  if (typeof payload !== 'object' || payload === null) return 'body must be a JSON object'
  const p = payload as Record<string, unknown>
  // 部分更新（带 id）时 name/path 可省略（未传即保留旧值）；新增（无 id）必须必填。
  const isUpdate = typeof p.id === 'string' && p.id.trim() !== ''
  if (!isUpdate) {
    if (typeof p.name !== 'string' || p.name.trim() === '') return 'name 必须是非空字符串'
    if (typeof p.path !== 'string' || p.path.trim() === '') return 'path 必须是非空字符串'
  } else {
    if (p.name !== undefined && (typeof p.name !== 'string' || p.name.trim() === '')) return 'name 必须是非空字符串'
    if (p.path !== undefined && (typeof p.path !== 'string' || p.path.trim() === '')) return 'path 必须是非空字符串'
  }
  if (p.path !== undefined && typeof p.path === 'string' && !isAbsolute(p.path.trim())) return 'path 必须是绝对路径'
  if (p.description !== undefined && typeof p.description !== 'string') return 'description 必须是字符串'
  const kind = p.repoKind ?? 'none'
  if (kind !== 'none' && kind !== 'cnb' && kind !== 'github' && kind !== 'git') return 'repoKind 必须是 none/cnb/github/git'
  if (p.repoUrl !== undefined && typeof p.repoUrl !== 'string') return 'repoUrl 必须是字符串'
  if (p.repoBranch !== undefined && typeof p.repoBranch !== 'string') return 'repoBranch 必须是字符串'
  if (p.siteUrl !== undefined && typeof p.siteUrl !== 'string') return 'siteUrl 必须是字符串'
  if (p.deployCommand !== undefined && typeof p.deployCommand !== 'string') return 'deployCommand 必须是字符串'
  const factsError = validateProjectFacts(p.facts)
  if (factsError !== undefined) return factsError
  return validateDeployTargets(p.deployTargets)
}

/** 项目事实条数上限（超出裁掉最旧的）。 */
export const PROJECT_FACTS_LIMIT = 100

/** 校验项目事实数组形状；返回错误消息或 undefined。 */
export function validateProjectFacts(value: unknown): string | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) return 'facts 必须是数组'
  for (const item of value) {
    if (typeof item !== 'object' || item === null) return 'facts 元素必须是对象'
    const f = item as Record<string, unknown>
    if (typeof f.text !== 'string' || f.text.trim() === '') return 'facts.text 必须是非空字符串'
    if (typeof f.at !== 'number' || !Number.isFinite(f.at)) return 'facts.at 必须是数字时间戳'
    if (f.source !== 'agent' && f.source !== 'user') return 'facts.source 只能是 agent 或 user'
  }
  return undefined
}

/** 读取 meta 表单个值；不存在返回 undefined。 */
function getMetaValue(db: ReturnType<typeof getDb>, key: string): string | undefined {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key)
  return row === undefined ? undefined : String(row['value'])
}

/** 写 meta 表单个值（幂等）。 */
function setMetaValue(db: ReturnType<typeof getDb>, key: string, value: string): void {
  db.prepare(
    'INSERT INTO meta(key, value) VALUES (?, ?) '
    + 'ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(key, value)
}

/**
 * 读取本机机器标识；首次调用生成 UUID 并持久化到 meta 表。
 * 该 id 随 store.db 备份同步到其他电脑后，各机的 id 互不相同，
 * 据此区分 project.machinePaths 里「哪条路径属于哪台机器」。
 */
export function getMachineId(): string {
  const db = getDb()
  const existing = getMetaValue(db, META_MACHINE_ID)
  if (existing !== undefined && existing.trim() !== '') return existing
  const generated = randomUUID()
  setMetaValue(db, META_MACHINE_ID, generated)
  return generated
}

/**
 * 读取全部项目（按 sort_order 稳定排序）。
 * 多端语义：path 一律替换为本机 machineId 在 machinePaths 里的映射
 * （无映射时保留原值——首台机器或旧数据）；pathExists 为动态 stat，不落库。
 */
export function listProjects(): ProjectEntry[] {
  const machineId = getMachineId()
  const db = getDb()
  return listDocs(db, DOCS_DOMAIN).map((row) => {
    const parsed = JSON.parse(row.data) as Partial<ProjectEntry> & { id?: string }
    const machinePaths = (parsed.machinePaths !== undefined && typeof parsed.machinePaths === 'object' && !Array.isArray(parsed.machinePaths)
      ? parsed.machinePaths
      : {}) as Record<string, string>
    const localPath = typeof machinePaths[machineId] === 'string' && machinePaths[machineId].trim() !== ''
      ? machinePaths[machineId]
      : (typeof parsed.path === 'string' ? parsed.path : '')
    return {
      id: row.id,
      name: typeof parsed.name === 'string' ? parsed.name : '',
      path: localPath,
      machinePaths,
      description: typeof parsed.description === 'string' ? parsed.description : '',
      facts: validateProjectFacts(parsed.facts) === undefined ? parsed.facts as ProjectFact[] : undefined,
      repoKind: (parsed.repoKind ?? 'none') as RepoKind,
      repoUrl: typeof parsed.repoUrl === 'string' ? parsed.repoUrl : '',
      repoBranch: typeof parsed.repoBranch === 'string' ? parsed.repoBranch : '',
      siteUrl: typeof parsed.siteUrl === 'string' ? parsed.siteUrl : '',
      // testUrl 曾被漏读：探测/面板写入库后读回恒为 undefined，界面永远显示「测试地址：未绑定」。
      testUrl: typeof parsed.testUrl === 'string' ? parsed.testUrl : '',
      deployTargets: Array.isArray(parsed.deployTargets) ? parsed.deployTargets as DeployTarget[] : [],
      deployCommand: typeof parsed.deployCommand === 'string' ? parsed.deployCommand : undefined,
      lastCommitAt: typeof parsed.lastCommitAt === 'number' ? parsed.lastCommitAt : undefined,
      createdAt: typeof parsed.createdAt === 'number' ? parsed.createdAt : 0,
      updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0,
      pathExists: localPath !== '' ? existsSync(localPath) : undefined,
    }
  })
}

/**
 * 保存（新增或更新）一个项目；载荷须先过 validateProjectPayload。
 * id 缺省时生成 UUID；已存在的 id 保留 created_at 并刷新 updated_at。
 * 每次保存都把当前路径登记进 machinePaths[本机 machineId]（多端映射随写随更）。
 */
export function saveProject(payload: Record<string, unknown>): ProjectEntry {
  const now = Date.now()
  const id = typeof payload.id === 'string' && payload.id.trim() !== '' ? payload.id.trim() : randomUUID()
  const machineId = getMachineId()
  const existing = getProject(id)
  // 部分更新时 path/name 可省略（未传即保留旧值）；新增场景校验层已保证必填。
  const path = typeof payload.path === 'string' && payload.path.trim() !== ''
    ? payload.path.trim()
    : (existing?.path ?? '')
  // 本机映射与既有映射合并：既有映射保留其他机器的登记，本机键覆盖为最新值。
  const machinePaths: Record<string, string> = { ...(existing?.machinePaths ?? {}) }
  if (path !== '') machinePaths[machineId] = path
  // 可选字段「未传即保留旧值」：部分更新（如只改名称）不会误清空其余登记。
  const entry: ProjectEntry = {
    id,
    name: typeof payload.name === 'string' && payload.name.trim() !== ''
      ? payload.name.trim()
      : (existing?.name ?? ''),
    path,
    machinePaths,
    description: typeof payload.description === 'string' ? payload.description : (existing?.description ?? ''),
    facts: validateProjectFacts(payload.facts) === undefined
      ? (payload.facts as ProjectFact[] | undefined ?? existing?.facts)
      : existing?.facts,
    repoKind: (payload.repoKind ?? existing?.repoKind ?? 'none') as RepoKind,
    repoUrl: typeof payload.repoUrl === 'string' ? payload.repoUrl.trim() : (existing?.repoUrl ?? ''),
    repoBranch: typeof payload.repoBranch === 'string' ? payload.repoBranch.trim() : (existing?.repoBranch ?? ''),
    siteUrl: typeof payload.siteUrl === 'string' ? payload.siteUrl.trim() : (existing?.siteUrl ?? ''),
    testUrl: typeof payload.testUrl === 'string' ? payload.testUrl.trim() : (existing?.testUrl ?? ''),
    deployTargets: Array.isArray(payload.deployTargets)
      ? (payload.deployTargets as DeployTarget[]).map((target) => ({
          transport: target.transport,
          alias: target.alias,
          ...(typeof target.remotePath === 'string' && target.remotePath.trim() !== '' ? { remotePath: target.remotePath.trim() } : {}),
        }))
      : (existing?.deployTargets ?? []),
    deployCommand: typeof payload.deployCommand === 'string' ? payload.deployCommand.trim() : existing?.deployCommand,
    lastCommitAt: existing?.lastCommitAt,
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

/**
 * 追加一条项目事实（模型 note 动作 / 面板手动共用）：
 * 归一化空白后与既有事实去重；超出上限裁掉最旧的；返回结果消息。
 */
export function appendProjectFact(id: string, text: string, source: 'agent' | 'user'): { ok: boolean; message: string } {
  const trimmed = typeof text === 'string' ? text.replace(/\s+/gu, ' ').trim() : ''
  if (trimmed === '') return { ok: false, message: 'text 不能为空' }
  if (trimmed.length > 300) return { ok: false, message: 'text 过长（最多 300 字）' }
  const existing = getProject(id)
  if (existing === undefined) return { ok: false, message: '项目不存在：' + id }
  const facts = existing.facts ?? []
  if (facts.some((fact) => fact.text === trimmed)) {
    return { ok: true, message: '事实已存在，未重复记录：' + trimmed }
  }
  const next = [...facts, { text: trimmed, at: Date.now(), source }].slice(-PROJECT_FACTS_LIMIT)
  saveProject({ id, facts: next })
  return { ok: true, message: '已记录项目事实（' + existing.name + '，共 ' + next.length + ' 条）：' + trimmed }
}

/** 可被工具/面板更新的结构化字段（update 动作的载荷形状）。 */
export interface ProjectFieldPatch {
  name?: string
  description?: string
  repoUrl?: string
  repoBranch?: string
  siteUrl?: string
  testUrl?: string
  deployTargets?: Array<DeployTarget | string>
  deployCommand?: string
}

/** 字段中文名（工具消息、项目卡与缺失清单共用一份，避免各处措辞漂移）。 */
export const PROJECT_FIELD_LABELS = {
  name: '项目名',
  description: '项目描述',
  repoUrl: '仓库地址',
  repoBranch: '分支',
  siteUrl: '线上地址',
  testUrl: '测试地址',
  deployTargets: '发布服务器',
  deployCommand: '发布命令',
} as const

export type ProjectFieldKey = keyof typeof PROJECT_FIELD_LABELS

/** 项目资料缺口（core=交付必需，optional=有则更好）。 */
export interface ProjectMissingField {
  key: ProjectFieldKey
  label: string
  level: 'core' | 'optional'
}

/**
 * 列出项目仍有空白的结构化字段。
 * 目的：让项目卡与工具输出能明确指出「还缺什么、用什么动作补」，
 * 而不是只渲染已有字段、让模型以为资料已完整（0.65.0 前正是这个断点）。
 */
export function projectMissingFields(entry: ProjectEntry): ProjectMissingField[] {
  const missing: ProjectMissingField[] = []
  if (entry.repoUrl.trim() === '') missing.push({ key: 'repoUrl', label: PROJECT_FIELD_LABELS.repoUrl, level: 'core' })
  if (entry.siteUrl.trim() === '') missing.push({ key: 'siteUrl', label: PROJECT_FIELD_LABELS.siteUrl, level: 'core' })
  if (entry.deployTargets.length === 0) missing.push({ key: 'deployTargets', label: PROJECT_FIELD_LABELS.deployTargets, level: 'core' })
  if ((entry.testUrl ?? '').trim() === '') missing.push({ key: 'testUrl', label: PROJECT_FIELD_LABELS.testUrl, level: 'optional' })
  if (entry.description.trim() === '') missing.push({ key: 'description', label: PROJECT_FIELD_LABELS.description, level: 'optional' })
  return missing
}

/** 地址字段归一化：空串=清空，非空必须是 http(s) 完整地址（去掉末尾斜杠）。 */
function normalizeHttpUrl(value: string): { ok: true; value: string } | { ok: false; error: string } {
  const trimmed = value.trim()
  if (trimmed === '') return { ok: true, value: '' }
  if (!/^https?:\/\/[^\s/]+/iu.test(trimmed)) {
    return { ok: false, error: '必须是 http(s):// 开头的完整地址；要清空该字段请传空字符串' }
  }
  return { ok: true, value: trimmed.replace(/\/+$/u, '') }
}

/** 发布服务器入参归一化：支持 "ssh:my"、"winrm:13@D:\\WWW\\x" 简写与 {transport,alias,remotePath} 对象。 */
export function normalizeDeployTargetInput(value: unknown): { ok: true; targets: DeployTarget[] } | { ok: false; error: string } {
  if (!Array.isArray(value)) return { ok: false, error: 'deployTargets 必须是数组，元素形如 "ssh:my" 或 {transport:"ssh",alias:"my",remotePath:"/opt/x"}' }
  const targets: DeployTarget[] = []
  for (const item of value) {
    if (typeof item === 'string') {
      const match = item.trim().match(/^(ssh|winrm)\s*[:：]\s*([^\s@]+)(?:@(\S+))?$/iu)
      if (match === null) {
        return { ok: false, error: '发布服务器字符串必须是 "ssh:别名" / "winrm:别名"（可加 @远程路径），收到：' + item }
      }
      const target: DeployTarget = { transport: match[1].toLowerCase() as 'ssh' | 'winrm', alias: match[2] }
      const remotePath = match[3]?.trim() ?? ''
      if (remotePath !== '') target.remotePath = remotePath
      targets.push(target)
      continue
    }
    if (typeof item === 'object' && item !== null) {
      const record = item as Record<string, unknown>
      if (record.transport !== 'ssh' && record.transport !== 'winrm') return { ok: false, error: '发布服务器 transport 只能是 ssh 或 winrm' }
      if (typeof record.alias !== 'string' || record.alias.trim() === '') return { ok: false, error: '发布服务器 alias 必须是非空字符串' }
      const target: DeployTarget = { transport: record.transport, alias: record.alias.trim() }
      if (typeof record.remotePath === 'string' && record.remotePath.trim() !== '') target.remotePath = record.remotePath.trim()
      targets.push(target)
      continue
    }
    return { ok: false, error: '发布服务器元素必须是字符串或对象' }
  }
  const seen = new Set<string>()
  return {
    ok: true,
    targets: targets.filter((target) => {
      const key = target.transport + ':' + target.alias
      if (seen.has(key)) return false
      seen.add(key)
      return true
    }),
  }
}

/** 更新结果（changed 为实际发生变化的字段中文名）。 */
export interface ProjectUpdateResult {
  ok: boolean
  message: string
  changed?: string[]
}

/**
 * 部分更新项目的结构化字段（devforge_project 的 update 动作）：
 * - 传了才改，未传一律保留旧值；空字符串表示清空该字段（地址/命令/分支）；
 * - 只记录真正发生变化的字段，未变化的重复写入不产生噪音；
 * - 地址必须 http(s) 完整地址；发布服务器支持 "ssh:my" 简写。
 */
export function updateProjectFields(id: string, patch: ProjectFieldPatch): ProjectUpdateResult {
  const existing = getProject(id)
  if (existing === undefined) return { ok: false, message: '项目不存在：' + id }
  const next: Record<string, unknown> = { id }
  const changed: string[] = []

  if (patch.name !== undefined) {
    const name = patch.name.trim()
    if (name === '') return { ok: false, message: 'name 不能为空字符串（项目名不允许清空）' }
    if (name !== existing.name) { next.name = name; changed.push(PROJECT_FIELD_LABELS.name) }
  }
  if (patch.description !== undefined) {
    const description = patch.description.trim()
    if (description !== existing.description) { next.description = description; changed.push(PROJECT_FIELD_LABELS.description) }
  }
  if (patch.repoBranch !== undefined) {
    const repoBranch = patch.repoBranch.trim()
    if (repoBranch !== existing.repoBranch) { next.repoBranch = repoBranch; changed.push(PROJECT_FIELD_LABELS.repoBranch) }
  }
  if (patch.repoUrl !== undefined) {
    const repoUrl = patch.repoUrl.trim()
    if (repoUrl !== existing.repoUrl) {
      next.repoUrl = repoUrl
      next.repoKind = repoUrl === '' ? 'none' : classifyRepoKind(repoUrl)
      changed.push(PROJECT_FIELD_LABELS.repoUrl)
    }
  }
  for (const key of ['siteUrl', 'testUrl'] as const) {
    const raw = patch[key]
    if (raw === undefined) continue
    const normalized = normalizeHttpUrl(raw)
    if (!normalized.ok) return { ok: false, message: PROJECT_FIELD_LABELS[key] + ' 不合法：' + normalized.error }
    if (normalized.value !== (existing[key] ?? '')) { next[key] = normalized.value; changed.push(PROJECT_FIELD_LABELS[key]) }
  }
  if (patch.deployTargets !== undefined) {
    const normalized = normalizeDeployTargetInput(patch.deployTargets)
    if (!normalized.ok) return { ok: false, message: normalized.error }
    const before = JSON.stringify(existing.deployTargets)
    const after = JSON.stringify(normalized.targets)
    if (before !== after) { next.deployTargets = normalized.targets; changed.push(PROJECT_FIELD_LABELS.deployTargets) }
  }
  if (patch.deployCommand !== undefined) {
    const deployCommand = patch.deployCommand.trim()
    if (deployCommand !== (existing.deployCommand ?? '')) { next.deployCommand = deployCommand; changed.push(PROJECT_FIELD_LABELS.deployCommand) }
  }

  if (changed.length === 0) {
    return { ok: true, message: '项目「' + existing.name + '」资料无变化（提交的值与现值一致）。', changed: [] }
  }
  saveProject(next)
  return { ok: true, message: '已更新项目「' + existing.name + '」：' + changed.join('、') + '。', changed }
}

/** 删除一条项目事实（按文本匹配；面板维护用）。 */
export function removeProjectFact(id: string, text: string): { ok: boolean; message: string } {
  const trimmed = typeof text === 'string' ? text.trim() : ''
  const existing = getProject(id)
  if (existing === undefined) return { ok: false, message: '项目不存在：' + id }
  const facts = existing.facts ?? []
  const next = facts.filter((fact) => fact.text !== trimmed)
  if (next.length === facts.length) return { ok: false, message: '未找到该事实' }
  saveProject({ id, facts: next })
  return { ok: true, message: '已删除项目事实（剩 ' + next.length + ' 条）' }
}

/**
 * 重定位一个项目的本机路径（跨机恢复备份后的核心操作）：
 * 校验新路径存在，把 machinePaths[本机 machineId] 更新为新路径并同步 path 字段。
 * 新路径若能检出 Git 远端且与登记 repoUrl 不一致，返回 warn 提示（不阻塞，交用户决断）。
 */
export function relocateProject(id: string, newPath: string): ProjectRelocateResult {
  const trimmed = typeof newPath === 'string' ? newPath.trim() : ''
  if (trimmed === '') return { ok: false, error: 'path 不能为空' }
  if (!isAbsolute(trimmed)) return { ok: false, error: 'path 必须是绝对路径' }
  if (!existsSync(trimmed)) return { ok: false, error: '路径不存在：' + trimmed }
  if (!statSync(trimmed).isDirectory()) return { ok: false, error: '路径不是目录：' + trimmed }
  const existing = getProject(id)
  if (existing === undefined) return { ok: false, error: '项目不存在：' + id }
  const machineId = getMachineId()
  const entry: ProjectEntry = {
    ...existing,
    path: trimmed,
    machinePaths: { ...existing.machinePaths, [machineId]: trimmed },
    updatedAt: Date.now(),
  }
  const db = getDb()
  db.prepare('UPDATE docs SET data = ?, updated_at = ? WHERE domain = ? AND id = ?')
    .run(JSON.stringify(entry), entry.updatedAt, DOCS_DOMAIN, id)
  // 仓库一致性检查：新路径是 Git 仓库且 origin 可识别时，与登记 repoUrl 比对。
  const detect = detectProjectGit(trimmed)
  const originUrl = detect.remotes[0]?.url
  if (detect.isGitRepo && originUrl !== undefined && existing.repoUrl.trim() !== ''
    && normalizeRepoUrlForMatch(originUrl) !== normalizeRepoUrlForMatch(existing.repoUrl)) {
    return { ok: true, warn: '新路径的 origin 远端（' + originUrl + '）与登记仓库（' + existing.repoUrl + '）不一致，请确认是否为同一项目。' }
  }
  return { ok: true }
}

/**
 * 归一化仓库地址用于比对：小写、去协议差异（https/git/ssh 前缀）、去 .git 后缀与末尾斜杠。
 * 只用于「像不像同一个仓库」的宽松判断，不做 URL 合法性校验；导出供扫描模块复用。
 */
export function normalizeRepoUrlForMatch(url: string): string {
  return url.trim().toLowerCase()
    .replace(/^(https?:\/\/|git@|ssh:\/\/git@?)/, '')
    .replace(/:/, '/')
    .replace(/\.git$/, '')
    .replace(/\/+$/, '')
}

/**
 * 刷新全部登记项目的仓库元数据：对本机存在的路径重跑检测，
 * 回填分支、远端与托管类型（检测不到远端时保留旧值，不误清空）。
 * 返回刷新后的完整清单（复用 listProjects 的多端语义）。
 */
export function refreshAllProjectGitMeta(): ProjectEntry[] {
  const machineId = getMachineId()
  const db = getDb()
  for (const project of listProjects()) {
    if (project.path === '' || !existsSync(project.path)) continue
    const detect = detectProjectGit(project.path)
    if (!detect.isGitRepo) continue
    const origin = detect.remotes[0]
    const updated: ProjectEntry = {
      ...project,
      repoKind: origin !== undefined ? origin.kind : project.repoKind,
      repoUrl: origin !== undefined ? origin.url : project.repoUrl,
      repoBranch: detect.branch ?? project.repoBranch,
      lastCommitAt: detect.lastCommitAt ?? project.lastCommitAt,
      machinePaths: { ...project.machinePaths, [machineId]: project.path },
      updatedAt: Date.now(),
    }
    db.prepare('UPDATE docs SET data = ?, updated_at = ? WHERE domain = ? AND id = ?')
      .run(JSON.stringify(updated), updated.updatedAt, DOCS_DOMAIN, project.id)
  }
  return listProjects()
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
export function resolveGitDir(projectPath: string): string | undefined {
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
 * 从 .git/logs/HEAD 末行解析最近一次提交时间（毫秒）。
 * reflog 行的作者名可含空格，字段数不定，故以「unix 秒时间戳 + 4 位时区 + 制表符」
 * 模式锚定（如 1788054798 +0800<TAB>）；文件缺失或解析失败返回 undefined，不影响检测主流程。
 */
function readLastCommitAt(gitDir: string): number | undefined {
  try {
    const logPath = join(gitDir, 'logs', 'HEAD')
    if (!existsSync(logPath)) return undefined
    const text = readFileSync(logPath, 'utf8').trim()
    if (text === '') return undefined
    const lastLine = text.split(/\r?\n/).pop() ?? ''
    const match = /(\d{9,})\s+[+-]\d{4}\t/.exec(lastLine)
    if (match === null) return undefined
    const seconds = Number(match[1])
    return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : undefined
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
    result.lastCommitAt = readLastCommitAt(gitDir)
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

/** 智能体按路径登记项目的入参（devforge_project 的 register 动作）。 */
export interface RegisterProjectInput { path: string; name?: string; description?: string }

/**
 * 按本机路径登记（或幂等更新）项目：
 * - 自动检测 Git 元数据（远端、分支、托管类型）回填仓库登记；
 * - 同路径已登记时更新原条目，绝不产生重复登记（重复触发无重复副作用）；
 * - 返回 ok 与人读消息，供工具与面板直接展示。
 */
export function registerProjectFromPath(input: RegisterProjectInput): { ok: boolean; message: string } {
  const projectPath = typeof input.path === 'string' ? input.path.trim() : ''
  if (projectPath === '') return { ok: false, message: 'path 不能为空' }
  if (!isAbsolute(projectPath)) return { ok: false, message: 'path 必须是绝对路径' }
  const detect = detectProjectGit(projectPath)
  if (!detect.exists) return { ok: false, message: detect.error ?? '路径不存在或不是目录：' + projectPath }
  const existing = listProjects().find((entry) => entry.path === projectPath)
  const origin = detect.remotes[0]
  const payload = {
    ...(existing !== undefined ? { id: existing.id } : {}),
    name: typeof input.name === 'string' && input.name.trim() !== '' ? input.name.trim() : defaultProjectName(projectPath),
    path: projectPath,
    description: typeof input.description === 'string' ? input.description : (existing?.description ?? ''),
    repoKind: origin !== undefined ? origin.kind : ('none' as const),
    repoUrl: origin?.url ?? '',
    repoBranch: detect.branch ?? '',
  }
  const invalid = validateProjectPayload(payload)
  if (invalid !== undefined) return { ok: false, message: invalid }
  const entry = saveProject(payload)
  const repo = entry.repoUrl !== ''
    ? '，仓库：' + entry.repoKind + ' ' + entry.repoUrl + (entry.repoBranch !== '' ? ' @ ' + entry.repoBranch : '')
    : '，未关联 Git 仓库'
  return { ok: true, message: (existing !== undefined ? '已更新登记：' : '已登记项目：') + entry.name + '（' + entry.path + '）' + repo }
}
