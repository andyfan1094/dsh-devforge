/**
 * DSH 本体（harness，@deepseek-ai/dsh）更新检查（0.17.7）。
 *
 * 需求（辉哥定）：「插件更新」页在 dsh-devforge 自身之外，同时检查 DeepSeek Harness
 * 本体是否有新版，并聚合驱动页签红点。
 *
 * 设计边界：
 *   - 只做「检查 + 安全引导」，不做一键升级——本体是承载当前进程的运行时本身，
 *     官方 README 只提供 npx 运行与源码 pnpm 两条路线，没有跨安装方式的一键升级
 *     协议；原地替换运行中的宿主风险不可控，面板只提供「查看官方版本 / 复制升级
 *     命令」，由辉哥在终端自行执行后重启。
 *   - 官方仓库 deepseek-ai/deepseek-harness 不发 GitHub Release（releases/latest
 *     恒 404），版本发布在 Tags；tag 形如 `dsh-v0.1.2-alpha.5`，必须用含预发布
 *     优先级的比较器（alpha < beta < rc < 正式版），不能用严格三段 x.y.z 比较。
 *   - Tags 接口返回顺序不代表版本顺序，必须全量扫描取最高版本。
 *   - 已装版本读取：不假设安装路径（npm/pnpm/brew/自定义前缀都可能），以当前宿主
 *     进程入口（process.argv[1]）真实路径逐级向上找 package.json，名字命中为止。
 *   - 预发布数字标识用「去前导零后按长度+字典序」比较，不转 Number，避免超大
 *     数字段在浮点下丢失精度导致误判。
 */

import { readFileSync, realpathSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { upstreamRequestHeaders, upstreamResponseText } from './upstream-fetch.ts'

/** 更新源登记：DSH 本体官方仓库（硬编码白名单，不接受外部配置改写）。 */
export interface HarnessUpdateSource {
  /** GitHub 仓库（owner/repo）。 */
  repo: string
  /** 版本 tag 前缀（本体 tag 形如 dsh-v0.1.2-alpha.5）。 */
  tagPrefix: string
}

/** 默认更新源：DSH 官方仓库。 */
export const HARNESS_UPDATE_DEFAULT_SOURCE: HarnessUpdateSource = {
  repo: 'deepseek-ai/deepseek-harness',
  tagPrefix: 'dsh-v',
}

/** 升级引导：按本机安装方式生成的可复制命令（本插件不代为执行）。 */
export interface HarnessUpgradePlan {
  /** 推测的包管理器：npm / pnpm / unknown。 */
  manager: 'npm' | 'pnpm' | 'unknown'
  /** 建议复制到终端执行的升级命令（含目标版本号）。 */
  command: string
  /** 判定依据（入口真实路径特征），供面板提示。 */
  evidence: string
}

/** 本体检查结果（面板展示 + 红点判定共用）。 */
export interface HarnessUpdateCheckItem {
  /** 已装本体版本；读取失败或无法识别为空串。 */
  installed: string
  /** 官方最新 tag 剥出的版本号；无合法 tag 时为空串。 */
  latest: string
  /** 官方最新 tag 原始名（如 dsh-v0.1.2-rc.1）。 */
  latestTag: string
  /** 官方仓库（owner/repo）。 */
  repo: string
  /** 官方版本标签页地址（仓库无 Release，指向 /tags）。 */
  tagUrl: string
  status: 'up-to-date' | 'update-available' | 'installed-unknown' | 'error'
  /** 补充说明（错误原因/内测提示），空串 = 无。 */
  reason: string
  /** 升级命令引导；official 最新版本未知时为 null。 */
  upgrade: HarnessUpgradePlan | null
}

/** 严格版本号：x.y.z，允许可选 -预发布段（点号分隔的字母数字标识）。 */
const VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/

/** 是否形如 x.y.z(-预发布) 的合法版本号。 */
export function isVersionLike(value: string): boolean {
  return VERSION_RE.test(value)
}

/** 拆分版本号为核心三段（数字文本）+ 预发布标识数组（无预发布则为 undefined）。 */
function splitVersion(value: string): { core: [string, string, string]; prerelease?: string[] } {
  const dash = value.indexOf('-')
  const corePart = dash === -1 ? value : value.slice(0, dash)
  const core = corePart.split('.') as [string, string, string]
  if (dash === -1) return { core }
  return { core, prerelease: value.slice(dash + 1).split('.') }
}

/**
 * 数字文本比较：去前导零后先比长度再比字典序。
 * 不经 Number 转换，超大数字段（如 1e21 级预发布序号）也不会丢精度。
 */
function compareNumericText(a: string, b: string): number {
  const ta = a.replace(/^0+(?=\d)/, '')
  const tb = b.replace(/^0+(?=\d)/, '')
  if (ta.length !== tb.length) return ta.length < tb.length ? -1 : 1
  return ta < tb ? -1 : ta > tb ? 1 : 0
}

/** 比较单个预发布标识（semver 规则：数字比数字，数字恒小于字母数字，其余按字典序）。 */
function comparePrereleaseIdentifier(a: string, b: string): number {
  const na = /^\d+$/.test(a)
  const nb = /^\d+$/.test(b)
  if (na && nb) return compareNumericText(a, b)
  if (na !== nb) return na ? -1 : 1
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * 完整版本比较（含预发布优先级，语义遵循 semver.org）：
 * 核心段不等直接定胜负；核心段相等时，正式版恒大于预发布版；
 * 两者都是预发布时逐段比较标识，前缀相同则标识更多的一方更大。
 * a>b 返回 1，a<b 返回 -1，相等返回 0；任一输入非法返回 0（调用方须先自行校验）。
 */
export function compareVersionWithPrerelease(a: string, b: string): number {
  if (!isVersionLike(a) || !isVersionLike(b)) return 0
  const va = splitVersion(a)
  const vb = splitVersion(b)
  for (let i = 0; i < 3; i += 1) {
    const cmp = compareNumericText(va.core[i], vb.core[i])
    if (cmp !== 0) return cmp
  }
  const pa = va.prerelease
  const pb = vb.prerelease
  if (pa === undefined && pb === undefined) return 0
  if (pa === undefined) return 1 // 正式版 > 预发布版
  if (pb === undefined) return -1
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i += 1) {
    if (i >= pa.length) return -1 // 标识更少的一方优先级更低
    if (i >= pb.length) return 1
    const cmp = comparePrereleaseIdentifier(pa[i], pb[i])
    if (cmp !== 0) return cmp
  }
  return 0
}

/** 单个 GitHub tag 的最小投影。 */
interface GithubTag {
  name?: unknown
}

/** 从 tag 名剥出版本号（前缀不符或版本不合法返回空串）。 */
export function parseHarnessTagVersion(tagName: string, tagPrefix: string): string {
  if (!tagName.startsWith(tagPrefix)) return ''
  const value = tagName.slice(tagPrefix.length)
  return isVersionLike(value) ? value : ''
}

/** 从一批 tag 里选出版本号最大的一个；没有合法 tag 返回 undefined。 */
export function pickLatestHarnessTag(tags: readonly GithubTag[], tagPrefix: string): { version: string; tag: string } | undefined {
  let best: { version: string; tag: string } | undefined
  for (const entry of tags) {
    if (typeof entry.name !== 'string') continue
    const version = parseHarnessTagVersion(entry.name, tagPrefix)
    if (version === '') continue
    if (best === undefined || compareVersionWithPrerelease(version, best.version) > 0) {
      best = { version, tag: entry.name }
    }
  }
  return best
}

/** 带超时的 GitHub tags 拉取（官方仓库不发 Release，只能读 tag；测试可注入）。 */
export async function fetchLatestHarnessTag(source: HarnessUpdateSource, timeoutMs = 15000): Promise<{ version: string; tag: string } | undefined> {
  const response = await fetch('https://api.github.com/repos/' + source.repo + '/tags?per_page=100', {
    headers: upstreamRequestHeaders({ 'user-agent': 'dsh-devforge-harness-update', accept: 'application/vnd.github+json' }),
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!response.ok) throw new Error('GitHub tags API HTTP ' + String(response.status))
  const payload = JSON.parse(await upstreamResponseText(response))
  if (!Array.isArray(payload)) throw new Error('GitHub tags 响应结构不合法')
  return pickLatestHarnessTag(payload as GithubTag[], source.tagPrefix)
}

/** package.json 的最小投影。 */
interface PackageJsonLite {
  name?: unknown
  version?: unknown
}

/** 防御式读一个 package.json；失败返回 undefined，绝不抛出。 */
function tryReadPackageJson(path: string): PackageJsonLite | undefined {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as PackageJsonLite
  } catch {
    return undefined
  }
}

/**
 * 从「宿主进程入口真实路径」逐级向上找 DSH 本体的 package.json（名字命中 targetName 为止）。
 * 原理：`dsh` 命令本身就是当前 Node 进程，process.argv[1] 解开软链后必然落在
 * @deepseek-ai/dsh 包目录内部（如 <root>/lib/bin.js），与具体安装前缀无关。
 * 找不到（异常安装布局）返回 undefined，不抛错、不影响面板其它数据。
 */
export function resolveHarnessPackageRoot(entryPath: string, targetName = '@deepseek-ai/dsh', maxLevels = 8): string | undefined {
  if (entryPath === '') return undefined
  let real: string
  try {
    real = realpathSync(entryPath)
  } catch {
    return undefined
  }
  let dir = dirname(real)
  for (let i = 0; i < maxLevels; i += 1) {
    const pkg = tryReadPackageJson(join(dir, 'package.json'))
    if (pkg !== undefined && pkg.name === targetName) return dir
    const parent = dirname(dir)
    if (parent === dir) break // 到达文件系统根，停止
    dir = parent
  }
  return undefined
}

/** 已装本体版本读取器（可注入测试）。 */
export type HarnessVersionReader = () => string

/** 默认已装本体版本读取器：以当前进程入口为锚点向上查找。 */
export function createDefaultHarnessVersionReader(entryPath: string): HarnessVersionReader {
  let cached: string | undefined
  return (): string => {
    if (cached !== undefined) return cached
    const root = resolveHarnessPackageRoot(entryPath)
    if (root === undefined) { cached = ''; return cached }
    const pkg = tryReadPackageJson(join(root, 'package.json'))
    cached = typeof pkg?.version === 'string' ? pkg.version : ''
    return cached
  }
}

/**
 * 按宿主入口真实路径推测安装方式并生成升级命令：
 * - 路径含 node_modules/.pnpm/ → pnpm 全局（pnpm 的全局包落在 .pnpm 虚拟_store 布局）；
 * - 其余含 node_modules/ → npm 全局（Homebrew/官方 npm 前缀布局）；
 * - 都不命中 → 未能识别，默认给 npm 官方渠道命令并在 evidence 说明。
 * 命令只作为可复制文本返回，绝不由插件代为执行。
 */
export function planHarnessUpgrade(entryPath: string, version: string): HarnessUpgradePlan {
  let real = entryPath
  try {
    real = realpathSync(entryPath)
  } catch {
    // 入口路径解析失败时按原样判断，不影响命令生成。
  }
  const pkg = '@deepseek-ai/dsh@' + version
  const normalized = real.replace(/\\/g, '/').toLowerCase()
  if (normalized.includes('node_modules/.pnpm/')) {
    return { manager: 'pnpm', command: 'pnpm add -g ' + pkg, evidence: '入口路径位于 pnpm 全局目录' }
  }
  if (normalized.includes('node_modules/')) {
    return { manager: 'npm', command: 'npm install -g ' + pkg, evidence: '入口路径位于 npm 全局目录' }
  }
  return { manager: 'unknown', command: 'npm install -g ' + pkg, evidence: '未能识别安装方式，默认按官方 npm 渠道给出命令' }
}

/** 本体检查依赖（全部可注入，测试零网络）。 */
export interface HarnessUpdateDeps {
  readInstalled: HarnessVersionReader
  fetchLatest?: typeof fetchLatestHarnessTag
  source?: HarnessUpdateSource
  /** 宿主进程入口路径，用于推测升级命令；缺省取 process.argv[1]。 */
  entryPath?: string
}

/** 检查 DSH 本体是否有新版本（纯编排，便于单测）。 */
export async function checkHarnessUpdate(deps: HarnessUpdateDeps): Promise<HarnessUpdateCheckItem> {
  const source = deps.source ?? HARNESS_UPDATE_DEFAULT_SOURCE
  const tagUrl = 'https://github.com/' + source.repo + '/tags'
  const installed = deps.readInstalled()
  const base: HarnessUpdateCheckItem = { installed, latest: '', latestTag: '', repo: source.repo, tagUrl, status: 'error', reason: '', upgrade: null }
  const fetchLatest = deps.fetchLatest ?? fetchLatestHarnessTag
  let latest: { version: string; tag: string } | undefined
  try {
    latest = await fetchLatest(source)
  } catch (error) {
    return { ...base, reason: error instanceof Error ? error.message : String(error) }
  }
  if (latest === undefined) return { ...base, reason: '官方仓库暂无可识别的版本 tag' }
  const upgrade = planHarnessUpgrade(deps.entryPath ?? process.argv[1] ?? '', latest.version)
  if (installed === '') return { ...base, latest: latest.version, latestTag: latest.tag, status: 'installed-unknown', reason: '未能识别本机 DSH 本体版本', upgrade }
  // 非法已装版本不能与官方版本做比较（比较器对非法输入恒返回 0），必须显式收敛为未识别，避免误判「已是最新」。
  if (!isVersionLike(installed)) return { ...base, latest: latest.version, latestTag: latest.tag, status: 'installed-unknown', reason: '本机版本号无法识别：' + installed, upgrade }
  const cmp = compareVersionWithPrerelease(installed, latest.version)
  if (cmp > 0) return { ...base, latest: latest.version, latestTag: latest.tag, status: 'up-to-date', reason: '本地版本高于官方最新（预发布/内测）', upgrade }
  if (cmp === 0) return { ...base, latest: latest.version, latestTag: latest.tag, status: 'up-to-date', upgrade }
  return { ...base, latest: latest.version, latestTag: latest.tag, status: 'update-available', upgrade }
}
