/**
 * DSH 本体（harness，@deepseek-ai/dsh）更新检查（0.17.3）。
 *
 * 需求（辉哥定）：「插件更新」页目前只对比 dsh-devforge 自己，DSH 本体也要能
 * 和官方 GitHub 仓库对比，看是否有新版本；有更新时在导航上给红点提示。
 *
 * 设计边界：
 *   - 只做「检查 + 提示」，不做一键升级——本体是承载当前进程的运行时本身，
 *     原地替换风险远高于普通插件包，交给辉哥自行按官方渠道升级。
 *   - 官方仓库 deepseek-ai/deepseek-harness 未发布 GitHub Release（releases/latest
 *     恒 404），只能读 tags；tag 形如 `dsh-v0.1.2-alpha.5`，版本号带预发布段，
 *     不能用严格三段 semver 比较，需要专门的比较器（含预发布优先级）。
 *   - 已装版本读取：不能假设本体装在固定路径（brew/nvm/自定义前缀都可能），
 *     用「当前宿主进程入口（process.argv[1]）真实路径逐级向上找 package.json，
 *     名字命中 @deepseek-ai/dsh 为止」，与安装位置无关。
 */

import { readFileSync, realpathSync } from 'node:fs'
import { dirname, join } from 'node:path'

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

/** 本体检查结果（面板展示 + 红点判定共用）。 */
export interface HarnessUpdateCheckItem {
  /** 已装本体版本；解析失败为空串。 */
  installed: string
  /** 官方最新 tag 剥出的版本号；解析失败为空串。 */
  latest: string
  /** 官方最新 tag 原始名（如 dsh-v0.1.2-alpha.5）。 */
  latestTag: string
  /** 官方仓库（owner/repo），面板据此拼跳转链接。 */
  repo: string
  status: 'up-to-date' | 'update-available' | 'installed-unknown' | 'error'
  /** 补充说明（错误原因/内测提示），空串 = 无。 */
  reason: string
}

/** 严格版本号：x.y.z，允许可选 -预发布段（点号分隔的字母数字标识）。 */
const VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/

/** 是否形如 x.y.z(-预发布) 的合法版本号。 */
export function isVersionLike(value: string): boolean {
  return VERSION_RE.test(value)
}

/** 拆分版本号为核心三段 + 预发布标识数组（无预发布则为 undefined）。 */
function splitVersion(value: string): { core: [number, number, number]; prerelease?: string[] } {
  const [corePart, ...rest] = value.split('-')
  const core = corePart.split('.').map((n) => Number.parseInt(n, 10) || 0) as [number, number, number]
  if (rest.length === 0) return { core }
  return { core, prerelease: rest.join('-').split('.') }
}

/** 比较单个预发布标识（semver 规则：数字比数字，数字恒小于字母数字，其余按字典序）。 */
function comparePrereleaseIdentifier(a: string, b: string): number {
  const na = /^\d+$/.test(a)
  const nb = /^\d+$/.test(b)
  if (na && nb) return Number.parseInt(a, 10) - Number.parseInt(b, 10)
  if (na !== nb) return na ? -1 : 1
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * 完整版本比较（含预发布优先级，语义遵循 semver.org）：
 * 核心段不等直接定胜负；核心段相等时，正式版恒大于预发布版；
 * 两者都是预发布时逐段比较标识，前缀相同则标识更多的一方更大。
 * a>b 返回 1，a<b 返回 -1，相等返回 0；非法输入按 0 处理不抛错。
 */
export function compareVersionWithPrerelease(a: string, b: string): number {
  if (!isVersionLike(a) || !isVersionLike(b)) return 0
  const va = splitVersion(a)
  const vb = splitVersion(b)
  for (let i = 0; i < 3; i += 1) {
    if (va.core[i] !== vb.core[i]) return va.core[i] > vb.core[i] ? 1 : -1
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
    headers: { 'user-agent': 'dsh-devforge-harness-update', accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!response.ok) throw new Error('GitHub tags API HTTP ' + String(response.status))
  const payload = await response.json()
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
 * @deepseek-ai/dsh 包目录内部（如 <root>/lib/bin.js），与具体安装前缀（brew/nvm/自定义）无关。
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

/** 本体检查依赖（全部可注入，测试零网络）。 */
export interface HarnessUpdateDeps {
  readInstalled: HarnessVersionReader
  fetchLatest?: typeof fetchLatestHarnessTag
  source?: HarnessUpdateSource
}

/** 检查 DSH 本体是否有新版本（纯编排，便于单测）。 */
export async function checkHarnessUpdate(deps: HarnessUpdateDeps): Promise<HarnessUpdateCheckItem> {
  const source = deps.source ?? HARNESS_UPDATE_DEFAULT_SOURCE
  const installed = deps.readInstalled()
  const base: HarnessUpdateCheckItem = { installed, latest: '', latestTag: '', repo: source.repo, status: 'error', reason: '' }
  const fetchLatest = deps.fetchLatest ?? fetchLatestHarnessTag
  let latest: { version: string; tag: string } | undefined
  try {
    latest = await fetchLatest(source)
  } catch (error) {
    return { ...base, reason: error instanceof Error ? error.message : String(error) }
  }
  if (latest === undefined) return { ...base, reason: '官方仓库暂无可识别的版本 tag' }
  if (installed === '') return { ...base, latest: latest.version, latestTag: latest.tag, status: 'installed-unknown', reason: '未能识别本机 DSH 本体版本' }
  const cmp = compareVersionWithPrerelease(installed, latest.version)
  if (cmp > 0) return { ...base, latest: latest.version, latestTag: latest.tag, status: 'up-to-date', reason: '本地版本高于官方最新（预发布/内测）' }
  if (cmp === 0) return { ...base, latest: latest.version, latestTag: latest.tag, status: 'up-to-date' }
  return { ...base, latest: latest.version, latestTag: latest.tag, status: 'update-available' }
}
