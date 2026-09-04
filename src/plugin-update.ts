/**
 * 插件更新能力（0.13.1）—— 已装插件 vs 官网版本清单的检查与一键升级。
 *
 * 需求（辉哥定）：多台电脑装天工造梦插件后没有统一更新入口，且更新应该链接
 * 自有官网（modagentai.com 插件发布站），而不是把 GitHub 当第一渠道。
 *
 * 设计边界：
 *   - 更新源登记表：包名 → 官网清单地址（downloads/index.json，含 sha256）为主，
 *     GitHub Latest Release 为兜底。只对登记过的包提供更新，apply 白名单校验，
 *     绝不能被用来装任意包。
 *   - check：读已装版本（复用 plugin-brief 的包读取器）→ 官网清单 latest 与已装比较。
 *   - apply：下载 tgz → sha256 与清单比对（清单提供时强制校验，防下载被篡改）→
 *     spawn `dsh plugin --profile <profile> add <tgz>`（与手工升级同一条受验证路径）→
 *     返回 needRestart=true；重启仍走既有 devforge_restart（用户确认红线不变）。
 */

import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPackageReader, type PackageReader } from './plugin-brief.ts'

/** 更新源登记：一个可更新的自研插件包（官网清单为主，GitHub 兜底）。 */
export interface UpdateSource {
  /** npm 包名（profile 里的安装名）。 */
  packageName: string
  /** 官网版本清单地址（modagentai.com 的 downloads/index.json）。 */
  indexUrl?: string
  /** GitHub 仓库（owner/repo），官网清单不可用时的兜底渠道。 */
  repo?: string
}

/** 默认更新源：dsh-devforge 自己（官网清单为主，GitHub 兜底）。 */
export const PLUGIN_UPDATE_DEFAULT_SOURCES: UpdateSource[] = [
  {
    packageName: 'dsh-devforge',
    indexUrl: 'https://modagentai.com/downloads/index.json',
    repo: 'andyfan1094/dsh-devforge',
  },
]

/** 插件更新配置。 */
export interface PluginUpdateConfig {
  /** 总开关；false 时 check/apply 都返回明确提示。 */
  enabled: boolean
  /** 执行 dsh plugin add 的目标 profile 名。 */
  profile: string
  /** 更新源登记表。 */
  sources: UpdateSource[]
}

/** 官网版本清单（downloads/index.json）的最小投影。 */
export interface SiteReleaseIndex {
  /** 最新版本号。 */
  latest: string
  /** 最新版 tgz 固定地址。 */
  latestUrl: string
  /** 版本条目（含 sha256 完整性值）。 */
  versions: Array<{ version: string; url: string; sha256?: string }>
}

/** GitHub Release 的最小投影。 */
export interface LatestRelease {
  /** 发布 tag（如 v0.13.0）。 */
  tag: string
  /** 资产列表里的第一个 .tgz 直链。 */
  tgzUrl: string
  /** tgz 文件名。 */
  tgzName: string
}

/** 渠道归一后的「最新版」信息。 */
export interface LatestInfo {
  /** 最新版本号（纯 semver）。 */
  version: string
  /** tgz 下载直链。 */
  tgzUrl: string
  /** 来源渠道（官网清单 / GitHub 兜底）。 */
  via: 'site' | 'github'
  /** 清单提供的 sha256（仅官网渠道有）。 */
  sha256?: string
}

/** 单个插件的检查结果。 */
export interface UpdateCheckItem {
  packageName: string
  /** 命中的渠道：官网清单 / GitHub 兜底。 */
  via: 'site' | 'github' | 'none'
  installed: string
  latest: string
  assetUrl: string
  status: 'up-to-date' | 'update-available' | 'installed-unknown' | 'error'
  /** 补充说明（错误原因/内测提示），空串 = 无。 */
  reason: string
}

/** 一键升级结果。 */
export interface PluginUpdateApplyResult {
  ok: boolean
  packageName: string
  /** 升级到的版本（成功时有值）。 */
  version: string
  /** 命中渠道。 */
  via: 'site' | 'github'
  /** dsh plugin add 的输出摘要（截断）。 */
  output: string
  /** 恒为 true：升级后必须重启 Host 才生效。 */
  needRestart: boolean
}

/** 严格 semver（x.y.z）校验。 */
function isSemver(value: string): boolean {
  return /^\d+\.\d+\.\d+$/.test(value)
}

/** 从 Release tag 剥出版本号；不合法返回空串。 */
export function parseTagVersion(tag: string): string {
  const value = tag.trim().replace(/^v/i, '')
  return isSemver(value) ? value : ''
}

/** 比较 semver：a>b 返回 1，a<b 返回 -1，相等返回 0；非法段按 0 处理。 */
export function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map((n) => Number.parseInt(n, 10) || 0)
  const pb = b.split('.').map((n) => Number.parseInt(n, 10) || 0)
  for (let i = 0; i < 3; i += 1) {
    if ((pa[i] ?? 0) > (pb[i] ?? 0)) return 1
    if ((pa[i] ?? 0) < (pb[i] ?? 0)) return -1
  }
  return 0
}

/** 从 GitHub Release 资产里挑 tgz 直链与文件名。 */
export function pickTgzAsset(assets: ReadonlyArray<{ name?: unknown; browser_download_url?: unknown }>): { tgzUrl: string; tgzName: string } {
  for (const asset of assets) {
    if (typeof asset.name === 'string' && asset.name.endsWith('.tgz') && typeof asset.browser_download_url === 'string' && asset.browser_download_url.startsWith('https://')) {
      return { tgzUrl: asset.browser_download_url, tgzName: asset.name }
    }
  }
  return { tgzUrl: '', tgzName: '' }
}

/** 把官网清单规整成最新版信息；结构不合法返回 undefined。 */
export function parseSiteIndex(payload: unknown): SiteReleaseIndex | undefined {
  const record = payload as { latest?: unknown; latestUrl?: unknown; versions?: unknown } | null
  if (record === null || typeof record !== 'object') return undefined
  if (typeof record.latest !== 'string' || !isSemver(record.latest)) return undefined
  if (typeof record.latestUrl !== 'string' || !record.latestUrl.startsWith('https://')) return undefined
  if (!Array.isArray(record.versions)) return undefined
  const versions = []
  for (const entry of record.versions) {
    const item = entry as { version?: unknown; url?: unknown; sha256?: unknown }
    if (typeof item.version === 'string' && typeof item.url === 'string' && item.url.startsWith('https://')) {
      versions.push({ version: item.version, url: item.url, sha256: typeof item.sha256 === 'string' ? item.sha256 : undefined })
    }
  }
  return { latest: record.latest, latestUrl: record.latestUrl, versions }
}

/** 带超时的 GitHub Latest Release 拉取（兜底渠道；测试可注入）。 */
export async function fetchLatestRelease(repo: string, timeoutMs = 15000): Promise<LatestRelease | null> {
  const response = await fetch('https://api.github.com/repos/' + repo + '/releases/latest', {
    headers: { 'user-agent': 'dsh-devforge-plugin-update', accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(timeoutMs),
  })
  // 无任何 release 时 GitHub 返回 404：按「无新版」处理而不是报错。
  if (response.status === 404) return null
  if (!response.ok) throw new Error('GitHub API HTTP ' + String(response.status))
  const payload = await response.json() as { tag_name?: unknown; assets?: unknown }
  if (typeof payload.tag_name !== 'string') throw new Error('GitHub 响应缺少 tag_name')
  const assets = Array.isArray(payload.assets) ? payload.assets as Array<{ name?: unknown; browser_download_url?: unknown }> : []
  const picked = pickTgzAsset(assets)
  return { tag: payload.tag_name, tgzUrl: picked.tgzUrl, tgzName: picked.tgzName }
}

/** 带超时的官网清单拉取（主渠道；测试可注入）。 */
export async function fetchSiteIndex(indexUrl: string, timeoutMs = 15000): Promise<SiteReleaseIndex> {
  const response = await fetch(indexUrl, {
    headers: { 'user-agent': 'dsh-devforge-plugin-update' },
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!response.ok) throw new Error('官网清单 HTTP ' + String(response.status))
  const parsed = parseSiteIndex(await response.json())
  if (!parsed) throw new Error('官网清单结构不合法')
  return parsed
}

/** 按 URL 选渠道解析最新版：官网清单优先，GitHub 兜底。 */
export async function resolveLatest(source: UpdateSource): Promise<LatestInfo> {
  if (source.indexUrl) {
    const index = await fetchSiteIndex(source.indexUrl)
    // 版本条目里优先取与 latest 匹配的版本化地址（保留 sha256），否则退 latest 固定地址。
    const matched = index.versions.find((entry) => entry.version === index.latest)
    return { version: index.latest, tgzUrl: matched?.url ?? index.latestUrl, via: 'site', sha256: matched?.sha256 }
  }
  if (source.repo) {
    const release = await fetchLatestRelease(source.repo)
    if (release === null) throw new Error('GitHub 仓库尚无任何 Release')
    const version = parseTagVersion(release.tag)
    if (version === '' || release.tgzUrl === '') throw new Error('GitHub Release 缺少可用的 tgz 资产：' + release.tag)
    return { version, tgzUrl: release.tgzUrl, via: 'github' }
  }
  throw new Error('更新源既没有官网清单也没有 GitHub 仓库')
}

/** sha256 十六进制摘要（完整性校验用）。 */
export function sha256Hex(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

/** 下载 tgz 到临时目录；提供期望 sha256 时强制完整性校验。 */
export async function downloadTgz(url: string, packageName: string, version: string, options?: { timeoutMs?: number; maxBytes?: number; expectedSha256?: string }): Promise<string> {
  const timeoutMs = options?.timeoutMs ?? 60000
  const maxBytes = options?.maxBytes ?? 25 * 1024 * 1024
  if (!url.startsWith('https://')) throw new Error('非 https 下载地址，拒绝下载')
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
  if (!response.ok) throw new Error('下载失败 HTTP ' + String(response.status))
  const buffer = Buffer.from(await response.arrayBuffer())
  if (buffer.byteLength === 0) throw new Error('下载内容为空')
  if (buffer.byteLength > maxBytes) throw new Error('下载内容超过 ' + Math.round(maxBytes / 1024 / 1024) + 'MB 上限')
  const expected = options?.expectedSha256
  if (expected) {
    const actual = sha256Hex(buffer)
    if (actual.toLowerCase() !== expected.toLowerCase()) throw new Error('sha256 校验失败：期望 ' + expected.slice(0, 12) + '…，实际 ' + actual.slice(0, 12) + '…')
  }
  const target = join(tmpdir(), packageName + '-' + version + '.tgz')
  await writeFile(target, buffer)
  return target
}

/**
 * 构造 `dsh plugin add` 的启动命令。
 *
 * Windows 上 `dsh` 是 npm 生成的 .cmd 垫片：Node 出于安全限制不允许不经 shell
 * 直接执行 .cmd（裸 spawn/execFile 报 spawn dsh ENOENT），必须经 cmd.exe 启动，
 * 由 cmd 按 PATHEXT 自行解析 dsh.cmd；/d 忽略 AutoRun、/s 规整引号剥离，
 * 配合 windowsVerbatimArguments 把整行按原样交给 cmd（与 dshmarket 同款方案）。
 * POSIX 无垫片问题，保持直接 execFile。
 */
export function buildDshPluginAddCommand(platform: NodeJS.Platform, profile: string, tgzPath: string): { file: string; args: string[]; verbatim: boolean } {
  if (platform === 'win32') {
    // cmd.exe /s /c 之后整行按原样解析：参数含空格时手工加引号即可（本路径均为本机生成的临时 tgz 与 profile 名，不含引号字符）。
    const quote = (value: string): string => (value.includes(' ') ? '"' + value + '"' : value)
    return {
      file: 'cmd.exe',
      args: ['/d', '/s', '/c', ['dsh', 'plugin', '--profile', quote(profile), 'add', quote(tgzPath)].join(' ')],
      verbatim: true,
    }
  }
  return { file: 'dsh', args: ['plugin', '--profile', profile, 'add', tgzPath], verbatim: false }
}

/** 执行 dsh plugin add（默认实现；测试可注入）。 */
export function runPluginAdd(profile: string, tgzPath: string, timeoutMs = 180000): Promise<string> {
  return new Promise((resolve, reject) => {
    const command = buildDshPluginAddCommand(process.platform, profile, tgzPath)
    execFile(command.file, command.args, { timeout: timeoutMs, encoding: 'utf8', windowsVerbatimArguments: command.verbatim, windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        const detail = (stderr || stdout || error.message).toString().slice(-400)
        reject(new Error('dsh plugin add 失败：' + detail))
        return
      }
      resolve(((stdout || '') + (stderr || '')).slice(-400))
    })
  })
}

/** 更新服务依赖（全部可注入，测试零网络）。 */
export interface PluginUpdateServiceDeps {
  getConfig: () => PluginUpdateConfig
  /** 已装版本读取器（复用 plugin-brief 的包读取器）。 */
  readInstalled: PackageReader
  resolveLatestFn?: typeof resolveLatest
  download?: typeof downloadTgz
  runAdd?: typeof runPluginAdd
}

/** 单插件检查（纯编排，便于单测）。 */
export async function checkOne(source: UpdateSource, installedVersion: string, resolveLatestFn: typeof resolveLatest): Promise<UpdateCheckItem> {
  const via: UpdateCheckItem['via'] = source.indexUrl ? 'site' : source.repo ? 'github' : 'none'
  const base: UpdateCheckItem = { packageName: source.packageName, via, installed: installedVersion, latest: '', assetUrl: '', status: 'error', reason: '' }
  if (via === 'none') return { ...base, reason: '更新源未登记清单地址或仓库' }
  let latest: LatestInfo
  try {
    latest = await resolveLatestFn(source)
  } catch (error) {
    return { ...base, status: 'error', reason: error instanceof Error ? error.message : String(error) }
  }
  if (installedVersion === '') {
    return { ...base, latest: latest.version, assetUrl: latest.tgzUrl, status: 'installed-unknown', reason: '本机未安装该插件' }
  }
  const cmp = compareSemver(installedVersion, latest.version)
  if (cmp > 0) return { ...base, latest: latest.version, assetUrl: latest.tgzUrl, status: 'up-to-date', reason: '本地版本高于官网最新（内测/暂存环境）' }
  if (cmp === 0) return { ...base, latest: latest.version, assetUrl: latest.tgzUrl, status: 'up-to-date' }
  return { ...base, latest: latest.version, assetUrl: latest.tgzUrl, status: 'update-available', reason: '' }
}

/** 插件更新服务：check 面板数据源 + apply 一键升级。 */
export class PluginUpdateService {
  private readonly deps: PluginUpdateServiceDeps

  constructor(deps: PluginUpdateServiceDeps) {
    this.deps = deps
  }

  private resolveConfig(): PluginUpdateConfig {
    const config = this.deps.getConfig()
    return {
      enabled: config.enabled,
      profile: config.profile,
      sources: config.sources.length > 0 ? config.sources : PLUGIN_UPDATE_DEFAULT_SOURCES,
    }
  }

  /** 检查全部登记插件：并发拉取，单源失败不影响其他源。 */
  async check(): Promise<{ enabled: boolean; items: UpdateCheckItem[] }> {
    const config = this.resolveConfig()
    if (!config.enabled) return { enabled: false, items: [] }
    const resolveLatestFn = this.deps.resolveLatestFn ?? resolveLatest
    const items = await Promise.all(config.sources.map(async (source): Promise<UpdateCheckItem> => {
      const info = this.deps.readInstalled(source.packageName)
      const installed = info?.version ?? ''
      return await checkOne(source, installed, resolveLatestFn)
    }))
    return { enabled: true, items }
  }

  /** 一键升级：白名单校验 → 渠道解析最新 → 下载（官网带 sha256 校验）→ dsh plugin add。 */
  async apply(packageName: string): Promise<PluginUpdateApplyResult> {
    const config = this.resolveConfig()
    if (!config.enabled) throw new Error('插件更新能力已关闭')
    // 白名单：只允许升级登记表里的包，防止该接口被用来装任意 npm 包。
    const source = config.sources.find((item) => item.packageName === packageName)
    if (!source) throw new Error('包不在更新源登记表内，拒绝升级：' + packageName)
    const resolveLatestFn = this.deps.resolveLatestFn ?? resolveLatest
    const latest = await resolveLatestFn(source)
    const download = this.deps.download ?? downloadTgz
    const tgzPath = await download(latest.tgzUrl, source.packageName, latest.version, { expectedSha256: latest.sha256 })
    const runAdd = this.deps.runAdd ?? runPluginAdd
    const output = await runAdd(config.profile, tgzPath)
    return { ok: true, packageName: source.packageName, version: latest.version, via: latest.via, output, needRestart: true }
  }
}

/** 默认已装版本读取器（profile 兄弟插件 + 宿主入口双锚点）。 */
export function createDefaultInstalledReader(): PackageReader {
  return createPackageReader([import.meta.url, process.argv[1] ?? ''])
}
