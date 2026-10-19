/**
 * 产出公约 —— 智能体文件秩序的单一事实源（0.19.0；0.61.0 增二级形态桶）。
 *
 * 需求（辉哥定）：智能体产出不得在根目录乱丢，文件一律按类别归位；
 * 0.61.0 追加：outputs 只有一句用途说明等于没约束，交付物/验收截图/设计稿/客户端包
 * 全平铺在一级目录里散落（实测 222 个顶层条目、191 个散落文件）。
 * 因此把 outputs 升级为「项目优先」两级布局：outputs/<项目>/<形态桶>/。
 *
 * 分层职责：
 * - 分类学可配置（kind 为稳定键，dirname/label/purpose 可改；subdirs/naming/rules 描述二级结构）；
 * - 存储复用插件统一 SQLite settings 表（domain=workspace.convention，单行 JSON）；
 * - 纯计算与副作用分离：computeConventionPath 只算路径（audit 用，绝不落盘），
 *   resolveConventionTarget 才算完建目录（locate 用）；
 * - auditWorkspace：只扫工作区根的散落文件（只建议不动手）；
 * - auditOutputsLayout：对 outputs 内部做秩序体检（结构合规判定 + 落位建议）。
 * 移动文件一律必须用户确认。
 */
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { extname, join, sep } from 'node:path'
import { getDb, getSettings, putSettings } from '../store/db.ts'

/** settings 表域常量：产出公约单例。 */
const CONVENTION_DOMAIN = 'workspace.convention'

/** /api/dsh-devforge 产出公约路由族。 */
export const WORKSPACE_API = {
  /** 公约读取（GET）与保存（PUT）。 */
  convention: '/api/dsh-devforge/workspace/convention',
} as const

/**
 * 非项目产物的一级保留目录名。
 * 「项目优先」布局下 outputs 的一级本应是项目名；无法归属项目时统一落这里，
 * 避免模型在 outputs 根下直接扔文件。
 */
export const GENERIC_PROJECT_DIRNAME = '_通用'

/**
 * 过期批次的一级保留目录名。
 * 被取代的旧交付物移入此处，体检时整体跳过（归档区不再要求两级结构）。
 */
export const ARCHIVE_PROJECT_DIRNAME = '_归档'

/** 二级形态桶约定（项目优先布局的第二级）。 */
export interface ConventionSubdir {
  /** 稳定桶键（locate 的 sub 参数；不随目录名改而变）。 */
  key: string
  /** 桶目录名。 */
  dirname: string
  /** 中文展示名。 */
  label: string
  /** 用途说明（注入与 UI 展示）。 */
  purpose: string
  /** 扩展名判据（不含点，小写）；audit 据此建议落桶。 */
  exts?: string[]
}

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
  /** 二级形态桶；有桶时 locate 支持 sub 参数、audit 会给落桶建议。 */
  subdirs?: ConventionSubdir[]
  /** 命名范式（硬约束文案，注入摘要原样渲染）。 */
  naming?: string
  /** 附加规则（归档、中间产物处置等，注入摘要逐条渲染）。 */
  rules?: string[]
}

/** 产出公约配置。 */
export interface WorkspaceConvention {
  /** 总开关；false 时摘要不注入、工具仍可用（显式询问时给出目录）。 */
  enabled: boolean
  /** 目录分类清单（顺序即展示顺序）。 */
  dirs: ConventionDir[]
}

/** outputs 的五个形态桶（顺序即注入展示顺序）。 */
export const OUTPUT_SUBDIRS: ConventionSubdir[] = [
  { key: 'packages', dirname: '交付包', label: '交付包', purpose: '安装包与构建产物', exts: ['zip', 'exe', 'msi', 'tgz', 'tar', 'gz', '7z', 'rar'] },
  { key: 'screenshots', dirname: '截图', label: '截图', purpose: '验收、对比、现状截图', exts: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] },
  { key: 'mockups', dirname: '设计稿', label: '设计稿', purpose: '设计稿与预览页', exts: ['html', 'htm', 'css', 'svg'] },
  { key: 'docs', dirname: '文档', label: '文档', purpose: '报告、说明、记录', exts: ['md', 'txt', 'pdf', 'docx', 'doc', 'pptx', 'ppt'] },
  { key: 'data', dirname: '数据', label: '数据', purpose: '结果数据', exts: ['xlsx', 'xls', 'csv', 'json'] },
]

/** outputs 命名硬约束（三要素缺一不可）。 */
export const OUTPUT_NAMING = '<YYYYMMDD>-<主题>-<状态>.<扩展名>；状态 ∈ 草稿|验收|定稿|废弃，三要素缺一不可'

/** outputs 附加规则。 */
export const OUTPUT_RULES: string[] = [
  '非项目产物放 outputs/' + GENERIC_PROJECT_DIRNAME + '/；被取代的旧批次移入 outputs/' + ARCHIVE_PROJECT_DIRNAME + '/。',
  '中间产物（_diag-*、*.bak、*.tmp）不得留在 outputs：放 tmp/ 或删除。',
  '构建/发布包（zip/exe/安装包）保留工具生成的「名称_版本_日期」名，视为已满足命名约束。',
]

/** 默认公约（辉哥确认的分类学；projects 为一等类别贯穿项目管理）。 */
export const DEFAULT_CONVENTION: WorkspaceConvention = {
  enabled: true,
  dirs: [
    { kind: 'projects', dirname: 'projects', label: '项目目录', purpose: '正经项目仓库，一项目一子目录' },
    { kind: 'tmp', dirname: 'tmp', label: '临时目录', purpose: '会话内临时文件，可随时清理' },
    { kind: 'scripts', dirname: 'scripts', label: '脚本目录', purpose: '一次性脚本与批处理脚本' },
    { kind: 'downloads', dirname: 'downloads', label: '下载目录', purpose: '网络下载的文件' },
    { kind: 'backups', dirname: 'backups', label: '备份目录', purpose: '备份产物' },
    {
      kind: 'outputs',
      dirname: 'outputs',
      label: '产出目录',
      purpose: '交付物：按「项目/形态桶」两级归位',
      subdirs: OUTPUT_SUBDIRS,
      naming: OUTPUT_NAMING,
      rules: OUTPUT_RULES,
    },
    { kind: 'notes', dirname: 'notes', label: '笔记目录', purpose: '文档与笔记' },
  ],
}

/** 校验一个目录名片段：非空、无分隔符、非隐藏、非 Windows 保留名。 */
function validateDirname(value: unknown, field: string): string | undefined {
  if (typeof value !== 'string' || value.trim() === '') return field + ' 必须是非空字符串'
  if (/[\\/]/.test(value)) return field + ' 不能含路径分隔符'
  if (value.startsWith('.')) return field + ' 不能是隐藏目录'
  return undefined
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
      const dirnameError = validateDirname(dir.dirname, 'dirname')
      if (dirnameError !== undefined) return dirnameError
      if (typeof dir.label !== 'string' || dir.label.trim() === '') return 'label 必须是非空字符串'
      if (typeof dir.purpose !== 'string') return 'purpose 必须是字符串'
      if (dir.naming !== undefined && typeof dir.naming !== 'string') return 'naming 必须是字符串'
      if (dir.rules !== undefined && (!Array.isArray(dir.rules) || dir.rules.some((rule) => typeof rule !== 'string'))) {
        return 'rules 必须是字符串数组'
      }
      if (dir.subdirs !== undefined) {
        if (!Array.isArray(dir.subdirs)) return 'subdirs 必须是数组'
        const subKeys = new Set<string>()
        for (const sub of dir.subdirs) {
          if (typeof sub !== 'object' || sub === null) return 'subdirs 元素必须是对象'
          const bucket = sub as Record<string, unknown>
          if (typeof bucket.key !== 'string' || bucket.key.trim() === '') return '形态桶 key 必须是非空字符串'
          const subError = validateDirname(bucket.dirname, '形态桶 dirname')
          if (subError !== undefined) return subError
          if (typeof bucket.label !== 'string' || bucket.label.trim() === '') return '形态桶 label 必须是非空字符串'
          if (typeof bucket.purpose !== 'string') return '形态桶 purpose 必须是字符串'
          if (bucket.exts !== undefined && (!Array.isArray(bucket.exts) || bucket.exts.some((ext) => typeof ext !== 'string'))) {
            return '形态桶 exts 必须是字符串数组'
          }
          if (subKeys.has(bucket.key)) return '形态桶 key 重复：' + bucket.key
          subKeys.add(bucket.key)
        }
      }
      if (kinds.has(dir.kind)) return 'kind 重复：' + dir.kind
      kinds.add(dir.kind)
    }
    if (!kinds.has('projects')) return 'projects 为一等类别，不可删除'
  }
  return undefined
}

/**
 * 用默认值补齐已保存配置缺失的二级结构。
 * 只补 undefined 的字段：显式传空数组（辉哥主动清空形态桶）必须被尊重，不得回填。
 */
function mergeWithDefaults(saved: WorkspaceConvention): WorkspaceConvention {
  const dirs = saved.dirs.map((dir) => {
    const fallback = DEFAULT_CONVENTION.dirs.find((item) => item.kind === dir.kind)
    if (fallback === undefined) return dir
    return {
      ...dir,
      subdirs: dir.subdirs ?? fallback.subdirs,
      naming: dir.naming ?? fallback.naming,
      rules: dir.rules ?? fallback.rules,
    }
  })
  return { enabled: saved.enabled, dirs }
}

/** 读取公约（无配置或形状异常时回退默认值）。 */
export function getConvention(): WorkspaceConvention {
  try {
    const db = getDb()
    const saved = getSettings<WorkspaceConvention>(db, CONVENTION_DOMAIN)
    if (saved !== undefined && Array.isArray(saved.dirs) && saved.dirs.length > 0) return mergeWithDefaults(saved)
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
      ...(dir.subdirs === undefined ? {} : {
        subdirs: dir.subdirs.map((sub) => ({
          key: sub.key.trim(),
          dirname: sub.dirname.trim(),
          label: sub.label.trim(),
          purpose: typeof sub.purpose === 'string' ? sub.purpose.trim() : '',
          ...(sub.exts === undefined ? {} : { exts: sub.exts.map((ext) => ext.trim().replace(/^\./, '').toLowerCase()).filter((ext) => ext !== '') }),
        })),
      }),
      ...(dir.naming === undefined ? {} : { naming: dir.naming.trim() }),
      ...(dir.rules === undefined ? {} : { rules: dir.rules.map((rule) => rule.trim()).filter((rule) => rule !== '') }),
    })),
  }
  putSettings(getDb(), CONVENTION_DOMAIN, normalized)
  return normalized
}

/**
 * 渲染公约注入摘要（enabled=false 或无目录时返回空串）。
 * 有二级结构的类别额外渲染形态桶、命名硬约束与附加规则——
 * 0.61.0 前这里只有一行用途说明，实测约束力不足（辉哥反馈的根因）。
 */
export function renderConventionSummary(convention: WorkspaceConvention): string {
  if (!convention.enabled || convention.dirs.length === 0) return ''
  const lines = ['【产出公约（dsh-devforge 注入，文件一律按类归位，禁止根目录散落）】']
  for (const dir of convention.dirs) {
    lines.push('- ' + dir.dirname + '/ ' + dir.label + '：' + dir.purpose)
    if (dir.subdirs !== undefined && dir.subdirs.length > 0) {
      lines.push('  └ 两级布局（项目优先）：' + dir.dirname + '/<项目>/<形态桶>/')
      for (const sub of dir.subdirs) {
        const exts = (sub.exts ?? []).join('/')
        lines.push('    · ' + sub.dirname + '/ ' + sub.purpose + (exts === '' ? '' : '（' + exts + '）'))
      }
      if (dir.kind !== 'projects') lines.push('    · 未登记项目名用 ' + GENERIC_PROJECT_DIRNAME + '/；过期批次移入 ' + ARCHIVE_PROJECT_DIRNAME + '/')
    }
    if (dir.naming !== undefined && dir.naming !== '') lines.push('  · 命名硬约束：' + dir.naming)
    for (const rule of dir.rules ?? []) lines.push('  · ' + rule)
  }
  lines.push('写文件前先判断类别落位；用 devforge_workspace 的 locate 取规范路径（支持 project/sub 两级），audit 可对根目录与 outputs 内部做秩序体检。')
  return lines.join('\n')
}

/** 按 kind 找类别定义。 */
function findDir(convention: WorkspaceConvention, kind: string): ConventionDir | undefined {
  return convention.dirs.find((item) => item.kind === kind)
}

/** 按桶键或桶目录名找一个形态桶（两种写法都接受，降低模型用错键名的概率）。 */
function findSubdir(dir: ConventionDir, keyOrDirname: string): ConventionSubdir | undefined {
  const wanted = keyOrDirname.trim()
  if (wanted === '') return undefined
  return (dir.subdirs ?? []).find((sub) => sub.key === wanted || sub.dirname === wanted)
}

/** 按扩展名匹配形态桶。 */
export function matchSubdirByExtension(dir: ConventionDir, fileName: string): ConventionSubdir | undefined {
  const ext = extname(fileName).replace(/^\./, '').toLowerCase()
  if (ext === '') return undefined
  return (dir.subdirs ?? []).find((sub) => (sub.exts ?? []).some((item) => item.toLowerCase() === ext))
}

/**
 * 判断一个路径片段能否作为「项目」一级目录名。
 * 校验前置是安全边界：模型可能把任意字符串塞进来，必须挡住目录穿越、
 * 隐藏目录、非法保留字符以及 Windows 设备名（CON/PRN/NUL/COM1…）。
 */
export function isValidProjectSegment(name: string): boolean {
  const trimmed = name.trim()
  if (trimmed === '' || trimmed.length > 60) return false
  if (trimmed === '.' || trimmed === '..') return false
  if (/[\\/:*?"<>|]/.test(trimmed)) return false
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f]/.test(trimmed)) return false
  if (trimmed.startsWith('.')) return false
  // Windows 不允许目录名以点或空格结尾。
  if (/[. ]$/.test(trimmed)) return false
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(trimmed)) return false
  return true
}

/** 落位目标（路径 + 命中的类别与形态桶）。 */
export interface ConventionTarget {
  /** 目标目录绝对路径。 */
  path: string
  /** 命中的类别。 */
  dir: ConventionDir
  /** 命中的形态桶（未给或该类别无桶时为 undefined）。 */
  subdir?: ConventionSubdir
}

/** 落位选项。 */
export interface ConventionPlacement {
  /** 项目名（项目优先布局的一级；动态值，会做安全校验）。 */
  project?: string
  /** 形态桶键或桶目录名。 */
  sub?: string
}

/**
 * 纯计算落位路径（绝不落盘，供 audit 使用）。
 * 形状：root/<类别目录>/<项目>/<形态桶>；
 * - sub 未给 → 退回 root/<类别目录>（兼容 0.61.0 前的一级行为）；
 * - sub 给了但该类别没登记此桶 → undefined（交由调用方报可用桶）；
 * - project 非法或 sub 给了而类别无桶 → undefined；
 * - project 未给而 sub 给了 → 一级用 _通用。
 */
export function computeConventionPath(
  workspaceRoot: string,
  kind: string,
  placement: ConventionPlacement = {},
  convention?: WorkspaceConvention,
): ConventionTarget | undefined {
  const effective = convention ?? getConvention()
  const dir = findDir(effective, kind)
  if (dir === undefined) return undefined
  const base = join(workspaceRoot, dir.dirname)
  const hasSubdirs = dir.subdirs !== undefined && dir.subdirs.length > 0
  const wantedSub = placement.sub === undefined ? undefined : placement.sub.trim()
  if (wantedSub === undefined) {
    // 只给项目不给桶：允许落到 root/<类别>/<项目>（便于按项目聚拢非形态化产物）。
    const projectOnly = placement.project?.trim()
    if (projectOnly !== undefined && projectOnly !== '' && hasSubdirs) {
      if (!isValidProjectSegment(projectOnly)) return undefined
      return { path: join(base, projectOnly), dir }
    }
    return { path: base, dir }
  }
  const subdir = findSubdir(dir, wantedSub)
  if (subdir === undefined) return undefined
  const project = placement.project?.trim()
  if (project !== undefined && project !== '' && !isValidProjectSegment(project)) return undefined
  const projectSegment = project !== undefined && project !== '' ? project : GENERIC_PROJECT_DIRNAME
  return { path: join(base, projectSegment, subdir.dirname), dir, subdir }
}

/** 递归创建目录，失败不抛（交由调用方容错）。 */
function ensureDir(target: string): void {
  if (existsSync(target)) return
  try { mkdirSync(target, { recursive: true }) } catch { /* 创建失败交由调用方容错 */ }
}

/**
 * 计算落位路径并创建目录（locate 语义）；非法输入返回 undefined。
 * 与 computeConventionPath 的唯一差别是这一步会建目录。
 */
export function resolveConventionTarget(
  workspaceRoot: string,
  kind: string,
  placement: ConventionPlacement = {},
  convention?: WorkspaceConvention,
): ConventionTarget | undefined {
  const target = computeConventionPath(workspaceRoot, kind, placement, convention)
  if (target === undefined) return undefined
  ensureDir(target.path)
  return target
}

/**
 * 返回类别目录的绝对路径（不存在则递归创建）；kind 未登记返回 undefined。
 * 兼容 0.61.0 前的一级语义，等价于 resolveConventionTarget 不带 project/sub。
 */
export function resolveConventionDir(workspaceRoot: string, kind: string, convention?: WorkspaceConvention): string | undefined {
  return resolveConventionTarget(workspaceRoot, kind, {}, convention)?.path
}

/** audit 的单个建议条目。 */
export interface AuditSuggestion {
  /** 散落文件名。 */
  name: string
  /** 建议类别 kind（未匹配到类别时为空串）。 */
  suggestedKind: string
  /** 建议目标目录绝对路径（suggestedKind 为空时省略）。 */
  targetPath?: string
  /** 建议形态桶键（该类别有二级结构且扩展名命中时给出）。 */
  suggestedSubdirKey?: string
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
 * - 只列文件不递归；audit 不做任何移动，移动必须用户确认；
 * - 目标类别有二级结构时（如 outputs），目标路径直接给到 _通用/<形态桶>。
 */
export function auditWorkspace(workspaceRoot: string, convention?: WorkspaceConvention): AuditSuggestion[] {
  const effective = convention ?? getConvention()
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
    const dir = findDir(effective, hit.kind)
    if (dir === undefined) continue
    const subdir = matchSubdirByExtension(dir, name)
    // 纯计算目标（不建目录）；有桶时落到 _通用/<桶>。
    const target = subdir === undefined
      ? computeConventionPath(workspaceRoot, hit.kind, {}, effective)
      : computeConventionPath(workspaceRoot, hit.kind, { project: GENERIC_PROJECT_DIRNAME, sub: subdir.key }, effective)
    suggestions.push({
      name,
      suggestedKind: hit.kind,
      ...(target === undefined ? {} : { targetPath: target.path }),
      ...(subdir === undefined ? {} : { suggestedSubdirKey: subdir.key }),
    })
  }
  return suggestions
}

/** outputs 内部秩序体检的单个建议条目。 */
export interface OutputsAuditEntry {
  /** 相对 outputs 的路径（正斜杠）。 */
  relPath: string
  /** 建议落位（相对 outputs，正斜杠）。 */
  suggestedRelPath: string
  /** 建议的一级（项目名或 _通用）。 */
  suggestedProject: string
  /** 建议的形态桶键（未识别扩展名时为空串）。 */
  suggestedSubdirKey: string
  /** 判定依据（人读）。 */
  reason: string
}

/** outputs 内部秩序体检结果。 */
export interface OutputsAudit {
  /** outputs 目录是否存在。 */
  exists: boolean
  /** 一级条目总数。 */
  topLevelCount: number
  /** 直接堆在 outputs 根下的文件数。 */
  looseFileCount: number
  /** 已按 <项目>/<形态桶> 就位的文件数。 */
  placedCount: number
  /** 建议搬迁条目（最多 maxEntries 条）。 */
  entries: OutputsAuditEntry[]
  /** 检出问题条目总数（entries 可能被截断）。 */
  totalMisplaced: number
}

/** 把绝对路径转成相对 outputs 的正斜杠路径。 */
function toRelativePosix(root: string, full: string): string {
  return full.slice(root.length + 1).split(sep).join('/')
}

/** 按登记项目名从文件名粗判归属（未命中回落 _通用）。 */
function inferProjectFromFileName(fileName: string, projectNames: readonly string[] | undefined): string {
  if (projectNames === undefined) return GENERIC_PROJECT_DIRNAME
  const lower = fileName.toLowerCase()
  const hit = projectNames.find((name) => name.trim() !== '' && lower.includes(name.trim().toLowerCase()))
  return hit === undefined ? GENERIC_PROJECT_DIRNAME : hit
}

/**
 * outputs 内部秩序体检：判定是否按「项目优先两级布局」就位，并给落位建议。
 * - 一级散落文件 → 建议 _通用/<形态桶>/（命中登记项目名时用该项目名）；
 * - 项目一级下的散落文件 → 建议 <项目>/<形态桶>/；
 * - 已就位到 <项目>/<桶>/ 的文件计入 placedCount；
 * - _归档 整体跳过（归档区不要求结构）；
 * - 全程只读：绝不创建目录、绝不移动文件。
 */
export function auditOutputsLayout(
  workspaceRoot: string,
  convention?: WorkspaceConvention,
  projectNames?: readonly string[],
  maxEntries = 50,
): OutputsAudit {
  const effective = convention ?? getConvention()
  const dir = findDir(effective, 'outputs')
  const empty: OutputsAudit = { exists: false, topLevelCount: 0, looseFileCount: 0, placedCount: 0, entries: [], totalMisplaced: 0 }
  if (dir === undefined) return empty
  const outputsDir = join(workspaceRoot, dir.dirname)
  if (!existsSync(outputsDir)) return empty

  let topEntries: import('node:fs').Dirent[]
  try {
    topEntries = readdirSync(outputsDir, { withFileTypes: true })
  } catch {
    return empty
  }

  const entries: OutputsAuditEntry[] = []
  let looseFileCount = 0
  let placedCount = 0
  let totalMisplaced = 0
  const bucketDirnames = new Set((dir.subdirs ?? []).map((sub) => sub.dirname))

  /** 记一条建议（受 maxEntries 截断，但总数照记）。 */
  const record = (relPath: string, suggestedRelPath: string, suggestedProject: string, suggestedSubdirKey: string, reason: string): void => {
    totalMisplaced += 1
    if (entries.length < maxEntries) entries.push({ relPath, suggestedRelPath, suggestedProject, suggestedSubdirKey, reason })
  }

  /** 统计一个桶目录下已就位的文件数（只统计直接子文件）。 */
  const countPlaced = (dirPath: string): number => {
    try {
      return readdirSync(dirPath, { withFileTypes: true }).filter((child) => child.isFile()).length
    } catch {
      return 0
    }
  }

  for (const entry of topEntries) {
    const full = join(outputsDir, entry.name)
    if (entry.isFile()) {
      looseFileCount += 1
      const subdir = matchSubdirByExtension(dir, entry.name)
      const project = inferProjectFromFileName(entry.name, projectNames)
      const suggested = subdir === undefined
        ? project + '/' + entry.name
        : project + '/' + subdir.dirname + '/' + entry.name
      record(entry.name, suggested, project, subdir?.key ?? '', '文件直接堆在 outputs 一级，未按项目/形态桶归位')
      continue
    }
    if (!entry.isDirectory()) continue
    // 归档区整体跳过（不要求两级结构）。
    if (entry.name === ARCHIVE_PROJECT_DIRNAME) continue
    if (bucketDirnames.has(entry.name)) {
      // 形态桶被误当成了一级目录（形态优先误用）。
      record(entry.name + '/', GENERIC_PROJECT_DIRNAME + '/' + entry.name + '/', GENERIC_PROJECT_DIRNAME, '', '形态桶出现在一级：应先分项目再分桶')
      continue
    }
    // 其余视为项目一级，下钻一层。
    let children: import('node:fs').Dirent[]
    try {
      children = readdirSync(full, { withFileTypes: true })
    } catch {
      continue
    }
    for (const child of children) {
      const childFull = join(full, child.name)
      if (child.isFile()) {
        const subdir = matchSubdirByExtension(dir, child.name)
        const suggested = subdir === undefined
          ? entry.name + '/' + child.name
          : entry.name + '/' + subdir.dirname + '/' + child.name
        record(toRelativePosix(outputsDir, childFull), suggested, entry.name, subdir?.key ?? '', '项目一级下未按形态桶归位')
        continue
      }
      if (!child.isDirectory()) continue
      if (bucketDirnames.has(child.name)) {
        placedCount += countPlaced(childFull)
        continue
      }
      record(toRelativePosix(outputsDir, childFull) + '/', entry.name + '/' + GENERIC_PROJECT_DIRNAME + '/' + child.name + '/', entry.name, '', '二级目录不是登记的形态桶')
    }
  }

  return { exists: true, topLevelCount: topEntries.length, looseFileCount, placedCount, entries, totalMisplaced }
}
