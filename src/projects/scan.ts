/**
 * 项目发现与建议 —— 目录扫描、跨机自动匹配、描述提取。
 *
 * - 扫描只做浅层目录遍历（根下一级 + 根下 projects 类目录再一级），
 *   只读 .git 元数据判断仓库身份，不执行 Git 命令、不读工作区文件内容；
 * - 自动匹配服务于「备份恢复到新电脑」场景：按目录名 / 仓库地址末段
 *   在本机常见代码根里找候选，再以归一化远端地址强校验；
 * - 描述提取从 package.json 与 README 取首个有意义段落，截断防膨胀。
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { detectProjectGit, listProjects, normalizeRepoUrlForMatch, resolveGitDir } from './store.ts'
import type { AutomatchSuggestion, ProjectDescribeResult, ProjectScanResult, ProjectEntry, ScannedProject } from './protocol.ts'

/** 扫描时跳过的目录名（隐藏目录、依赖与构建产物）。 */
const SKIP_DIR_NAMES = new Set(['node_modules', 'dist', 'build', 'target', '.git', '.svn', '.venv', 'venv', '__pycache__'])

/** 描述提取的最大长度（字符）。 */
const DESCRIBE_MAX_CHARS = 200

/**
 * 默认扫描根：本机常见代码目录里实际存在的那些。
 * 每项都做存在性过滤，不存在的根直接不出现（跨平台差异收敛在 existence 上）。
 */
export function defaultScanRoots(): string[] {
  const home = homedir()
  const candidates = [
    join(home, 'Documents'),
    join(home, 'Documents', 'ds'),
    join(home, 'Documents', 'projects'),
    join(home, 'projects'),
    join(home, 'code'),
    join(home, 'dev'),
    join(home, 'work'),
  ]
  return candidates.filter((candidate) => {
    try { return existsSync(candidate) && statSync(candidate).isDirectory() } catch { return false }
  })
}

/** 目录是否值得进入（存在、是目录、不在跳过名单、非隐藏）。 */
function isScannableDir(dirPath: string): boolean {
  const name = dirPath.split(/[\\/]/).pop() ?? ''
  if (name.startsWith('.') || SKIP_DIR_NAMES.has(name)) return false
  try { return statSync(dirPath).isDirectory() } catch { return false }
}

/**
 * 判断一个目录是否为 Git 仓库（.git 目录或 worktree 指针），是则返回检测结果。
 * 任何读取异常都收敛为 undefined，绝不中断整轮扫描。
 */
function detectIfGitRepo(dirPath: string): ReturnType<typeof detectProjectGit> | undefined {
  try {
    if (resolveGitDir(dirPath) === undefined) return undefined
    return detectProjectGit(dirPath)
  } catch { return undefined }
}

/** 收录一个候选：路径、名称与检测结果组装成 ScannedProject。 */
function toScannedProject(dirPath: string, registered: ProjectEntry[]): ScannedProject {
  const detect = detectIfGitRepo(dirPath)
  // 已登记判定：本机路径与登记表任一条目的 path 完全一致。
  const hit = registered.find((entry) => entry.path === dirPath)
  return {
    path: dirPath,
    name: detect?.name ?? (dirPath.split(/[\\/]/).pop() ?? dirPath),
    detect: detect ?? { ok: true, exists: true, isGitRepo: false, remotes: [] },
    registeredId: hit?.id,
  }
}

/**
 * 扫描给定根目录（缺省用 defaultScanRoots）发现 Git 项目：
 * 只下钻两层——根的一级子目录，以及名字含 project/code/work 的二级。
 * 结果按路径排序；对照登记表标出已登记条目。
 */
export function scanForProjects(roots?: string[]): ProjectScanResult {
  const registered = listProjects()
  const effectiveRoots = roots !== undefined && roots.length > 0
    ? roots.filter((root) => isAbsolute(root))
    : defaultScanRoots()
  const found = new Map<string, ScannedProject>()
  for (const root of effectiveRoots) {
    if (!isScannableDir(root)) continue
    let level1: string[]
    try {
      level1 = readdirSync(root).map((name) => join(root, name)).filter(isScannableDir)
    } catch { continue }
    for (const dir1 of level1) {
      if (detectIfGitRepo(dir1) !== undefined && !found.has(dir1)) {
        found.set(dir1, toScannedProject(dir1, registered))
        continue
      }
      // 一级子目录不是仓库时，若它像项目聚集目录（projects/code/work 字样）则再下钻一层。
      const lowerName = dir1.toLowerCase()
      if (!['project', 'projects', 'code', 'work', 'repos', 'workspace'].some((word) => lowerName.endsWith(word))) continue
      let level2: string[]
      try {
        level2 = readdirSync(dir1).map((name) => join(dir1, name)).filter(isScannableDir)
      } catch { continue }
      for (const dir2 of level2) {
        if (found.has(dir2)) continue
        if (detectIfGitRepo(dir2) !== undefined) found.set(dir2, toScannedProject(dir2, registered))
      }
    }
  }
  const sorted = [...found.values()].sort((a, b) => (a.path < b.path ? -1 : 1))
  return { roots: effectiveRoots, found: sorted }
}

/**
 * 为本机路径失效的登记项目找重定位候选：
 * 在扫描根（缺省用 defaultScanRoots）里发现 Git 仓库后，先按
 * 「目录名 = 项目名或仓库地址末段」粗配，再按归一化远端地址强校验，
 * 只返回强匹配项（宁缺毋滥，避免错误迁移路径）。roots 可注入便于测试与自定义。
 */
export function automatchProjects(roots?: string[]): AutomatchSuggestion[] {
  const stale = listProjects().filter((entry) => entry.path !== '' && entry.pathExists === false)
  if (stale.length === 0) return []
  const scan = scanForProjects(roots)
  const suggestions: AutomatchSuggestion[] = []
  for (const entry of stale) {
    const repoTail = entry.repoUrl.trim() !== '' ? entry.repoUrl.trim().replace(/\/+$/, '').split('/').pop() ?? '' : ''
    const nameKey = entry.name.trim()
    for (const candidate of scan.found) {
      if (candidate.detect.isGitRepo !== true) continue
      const dirName = candidate.name
      const nameMatches = (nameKey !== '' && dirName.toLowerCase() === nameKey.toLowerCase())
        || (repoTail !== '' && dirName.toLowerCase() === repoTail.toLowerCase())
      if (!nameMatches) continue
      // 远端强校验：双方都能取出 origin 且归一化后一致才算命中。
      const candidateOrigin = candidate.detect.remotes.find((remote) => remote.name === 'origin') ?? candidate.detect.remotes[0]
      if (candidateOrigin === undefined || entry.repoUrl.trim() === '') continue
      if (normalizeRepoUrlForMatch(candidateOrigin.url) !== normalizeRepoUrlForMatch(entry.repoUrl)) continue
      suggestions.push({ id: entry.id, name: entry.name, repoUrl: entry.repoUrl, candidatePath: candidate.path })
      break
    }
  }
  return suggestions
}

/** 从文本中提取首个有意义段落：跳过标题、徽标图片行、HTML 标记与空行。 */
function firstMeaningfulParagraph(markdown: string): string {
  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line === '') continue
    if (line.startsWith('#')) continue
    if (line.startsWith('<')) continue
    if (line.startsWith('![') || line.startsWith('[!')) continue
    if (/^[-*]\s*\[!/.test(line)) continue
    return line
  }
  return ''
}

/**
 * 提取项目描述建议：package.json 的 description 优先，
 * 其次 README（.md / .zh.md / .en.md）首个有意义段落；截断到 200 字。
 */
export function describeProject(inputPath: string): ProjectDescribeResult {
  const trimmed = typeof inputPath === 'string' ? inputPath.trim() : ''
  if (trimmed === '') return { ok: false, error: 'path 不能为空' }
  if (!existsSync(trimmed) || !statSync(trimmed).isDirectory()) return { ok: false, error: '路径不存在或不是目录' }
  // 1) package.json description。
  const pkgPath = join(trimmed, 'package.json')
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { description?: unknown }
      const description = typeof pkg.description === 'string' ? pkg.description.trim() : ''
      if (description !== '') return { ok: true, source: 'package.json', description: description.slice(0, DESCRIBE_MAX_CHARS) }
    } catch { /* 解析失败则继续尝试 README */ }
  }
  // 2) README 家族按优先级取首个有意义段落。
  for (const name of ['README.md', 'README.zh.md', 'README.zh-CN.md', 'README.en.md', 'readme.md']) {
    const readmePath = join(trimmed, name)
    if (!existsSync(readmePath)) continue
    try {
      const paragraph = firstMeaningfulParagraph(readFileSync(readmePath, 'utf8'))
      if (paragraph !== '') return { ok: true, source: name, description: paragraph.slice(0, DESCRIBE_MAX_CHARS) }
    } catch { /* 读取失败继续下一个候选 */ }
  }
  return { ok: false, error: '未找到 package.json description 或 README 段落' }
}
