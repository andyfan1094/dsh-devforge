/**
 * 产出公约 —— 智能体文件秩序的单一事实源（0.19.0）。
 *
 * 需求（辉哥定）：智能体产出不得在根目录乱丢，文件一律按类别归位。
 * - 目录分类学可配置（kind 为稳定键，dirname/label/purpose 可改）；
 * - 存储复用插件统一 SQLite settings 表（domain=workspace.convention，单行 JSON）；
 * - locate：原子返回类别目录（不存在即创建），供 devforge_workspace 工具调用；
 * - audit：只扫描工作区根的散落「文件」并给归类建议（目录一律不碰，防误判；
 *   audit 只建议不动手，移动文件必须用户确认）。
 */
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { getDb, getSettings, putSettings } from '../store/db.ts'

/** settings 表域常量：产出公约单例。 */
const CONVENTION_DOMAIN = 'workspace.convention'

/** /api/dsh-devforge 产出公约路由族。 */
export const WORKSPACE_API = {
  /** 公约读取（GET）与保存（PUT）。 */
  convention: '/api/dsh-devforge/workspace/convention',
} as const

/** 单个目录类别约定。 */
export interface ConventionDir {
  /** 稳定类别键（locate 的参数；projects 为一等类别不可删除）。 */
  kind: string
  /** 目录名（工作区根下）。 */
  dirname: string
  /** 中文展示名。 */
  label: string
  /** 用途说明（注入与 UI 展示）。 */
  purpose: string
}

/** 产出公约配置。 */
export interface WorkspaceConvention {
  /** 总开关；false 时摘要不注入、工具仍可用（显式询问时给出目录）。 */
  enabled: boolean
  /** 目录分类清单（顺序即展示顺序）。 */
  dirs: ConventionDir[]
}

/** 默认公约（辉哥确认的分类学；projects 为一等类别贯穿项目管理）。 */
export const DEFAULT_CONVENTION: WorkspaceConvention = {
  enabled: true,
  dirs: [
    { kind: 'projects', dirname: 'projects', label: '项目目录', purpose: '正经项目仓库，一项目一子目录' },
    { kind: 'tmp', dirname: 'tmp', label: '临时目录', purpose: '会话内临时文件，可随时清理' },
    { kind: 'scripts', dirname: 'scripts', label: '脚本目录', purpose: '一次性脚本与批处理脚本' },
    { kind: 'downloads', dirname: 'downloads', label: '下载目录', purpose: '网络下载的文件' },
    { kind: 'backups', dirname: 'backups', label: '备份目录', purpose: '备份产物' },
    { kind: 'outputs', dirname: 'outputs', label: '产出目录', purpose: '交付物：图、文档、报告' },
    { kind: 'notes', dirname: 'notes', label: '笔记目录', purpose: '文档与笔记' },
  ],
}

/** 校验公约载荷；返回错误消息或 undefined。 */
export function validateConvention(payload: unknown): string | undefined {
  if (typeof payload !== 'object' || payload === null) return 'body must be a JSON object'
  const p = payload as Record<string, unknown>
  if (p.enabled !== undefined && typeof p.enabled !== 'boolean') return 'enabled 必须是布尔值'
  if (p.dirs !== undefined) {
    if (!Array.isArray(p.dirs)) return 'dirs 必须是数组'
    const kinds = new Set<string>()
    for (const item of p.dirs) {
      if (typeof item !== 'object' || item === null) return 'dirs 元素必须是对象'
      const dir = item as Record<string, unknown>
      if (typeof dir.kind !== 'string' || dir.kind.trim() === '') return 'kind 必须是非空字符串'
      if (typeof dir.dirname !== 'string' || dir.dirname.trim() === '') return 'dirname 必须是非空字符串'
      if (/[\\/]/.test(dir.dirname)) return 'dirname 不能含路径分隔符'
      if (dir.dirname.startsWith('.')) return 'dirname 不能是隐藏目录'
      if (typeof dir.label !== 'string' || dir.label.trim() === '') return 'label 必须是非空字符串'
      if (typeof dir.purpose !== 'string') return 'purpose 必须是字符串'
      if (kinds.has(dir.kind)) return 'kind 重复：' + dir.kind
      kinds.add(dir.kind)
    }
    if (!kinds.has('projects')) return 'projects 为一等类别，不可删除'
  }
  return undefined
}

/** 读取公约（无配置或形状异常时回退默认值）。 */
export function getConvention(): WorkspaceConvention {
  try {
    const db = getDb()
    const saved = getSettings<WorkspaceConvention>(db, CONVENTION_DOMAIN)
    if (saved !== undefined && Array.isArray(saved.dirs) && saved.dirs.length > 0) return saved
  } catch { /* 库不可用时回退默认 */ }
  return DEFAULT_CONVENTION
}

/** 保存公约（载荷须先过 validateConvention）。 */
export function saveConvention(payload: WorkspaceConvention): WorkspaceConvention {
  const normalized: WorkspaceConvention = {
    enabled: payload.enabled ?? true,
    dirs: payload.dirs.map((dir) => ({
      kind: dir.kind.trim(),
      dirname: dir.dirname.trim(),
      label: dir.label.trim(),
      purpose: typeof dir.purpose === 'string' ? dir.purpose.trim() : '',
    })),
  }
  putSettings(getDb(), CONVENTION_DOMAIN, normalized)
  return normalized
}

/** 渲染公约注入摘要（enabled=false 或无目录时返回空串）。 */
export function renderConventionSummary(convention: WorkspaceConvention): string {
  if (!convention.enabled || convention.dirs.length === 0) return ''
  const lines = [
    '【产出公约（dsh-devforge 注入，文件一律按类归位，禁止根目录散落）】',
    ...convention.dirs.map((dir) => '- ' + dir.dirname + '/ ' + dir.label + '：' + dir.purpose),
    '写文件前先判断类别落位；可用 devforge_workspace 工具 locate(\'scripts\') 直接取规范路径，audit 扫描根目录散落文件。',
  ]
  return lines.join('\n')
}

/**
 * 返回类别目录的绝对路径（不存在则递归创建）；kind 未登记返回 undefined。
 * 工作区根由调用方给定（工具侧默认会话 cwd）。
 */
export function resolveConventionDir(workspaceRoot: string, kind: string, convention?: WorkspaceConvention): string | undefined {
  const effective = convention ?? getConvention()
  const dir = effective.dirs.find((item) => item.kind === kind)
  if (dir === undefined) return undefined
  const target = join(workspaceRoot, dir.dirname)
  if (!existsSync(target)) {
    try { mkdirSync(target, { recursive: true }) } catch { /* 创建失败交由调用方容错 */ }
  }
  return target
}

/** audit 的单个建议条目。 */
export interface AuditSuggestion {
  /** 散落文件名。 */
  name: string
  /** 建议类别 kind（未匹配到类别时为空串）。 */
  suggestedKind: string
  /** 建议目标目录绝对路径（suggestedKind 为空时省略）。 */
  targetPath?: string
}

/** 按扩展名初判类别的启发式表（audit 只做建议，不搬文件）。 */
const EXT_KIND_HINTS: Array<{ test: RegExp; kind: string }> = [
  { test: /\.(sh|bash|zsh|py|ps1|mjs|cjs|cmd|bat)$/i, kind: 'scripts' },
  { test: /\.(png|jpe?g|gif|webp|svg|mp4|mov|mp3|wav)$/i, kind: 'outputs' },
  { test: /\.(md|txt|pdf|docx?|xlsx?|pptx?)$/i, kind: 'notes' },
  { test: /\.(zip|tar|gz|tgz|7z|rar|bak|backup)$/i, kind: 'backups' },
]

/**
 * 扫描工作区根：只对「散落文件」给归类建议。
 * - 公约目录本身、隐藏文件、登记项目目录一律跳过；
 * - 只列文件不递归；audit 不做任何移动，移动必须用户确认。
 */
export function auditWorkspace(workspaceRoot: string, convention?: WorkspaceConvention): AuditSuggestion[] {
  const effective = convention ?? getConvention()
  const conventionDirnames = new Set(effective.dirs.map((dir) => dir.dirname.toLowerCase()))
  if (!existsSync(workspaceRoot)) return []
  let entries: string[]
  try {
    entries = readdirSync(workspaceRoot)
  } catch {
    return []
  }
  const suggestions: AuditSuggestion[] = []
  for (const name of entries) {
    if (name.startsWith('.')) continue
    const full = join(workspaceRoot, name)
    let isFile = false
    try {
      isFile = statSync(full).isFile()
    } catch { continue }
    // 目录（含公约目录与项目目录）一律不进建议，防误判误搬。
    if (!isFile) continue
    const hit = EXT_KIND_HINTS.find((hint) => hint.test.test(name))
    if (hit === undefined) continue
    const dir = effective.dirs.find((item) => item.kind === hit.kind)
    if (dir === undefined) continue
    suggestions.push({
      name,
      suggestedKind: hit.kind,
      targetPath: join(workspaceRoot, dir.dirname),
    })
  }
  // conventionDirnames 保留给未来「目录误放公约名」场景；当前仅文件维度。
  void conventionDirnames
  return suggestions
}
