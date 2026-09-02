/**
 * 插件更新能力（0.13.0）—— 已装插件 vs GitHub Latest Release 的检查与一键升级。
 *
 * 需求（辉哥定）：多台电脑装天工造梦插件后没有统一更新入口，插件里要安排更新功能。
 *
 * 设计边界：
 *   - 更新源登记表：包名 → GitHub 仓库（默认内置 dsh-devforge 自己）。
 *     只对登记过的包提供更新，apply 白名单校验，绝不能被用来装任意包。
 *   - check：读已装版本（复用 plugin-brief 的包读取器）+ GET repos/<repo>/releases/latest
 *     （公开仓库免凭据，匿名限额 60 次/小时/IP，手动检查足够），tag 剥版本、assets 挑 .tgz 直链。
 *   - apply：下载 tgz 到临时目录（https、25MB 上限、60 秒超时）→
 *     spawn `dsh plugin --profile <profile> add <tgz>`（与手工升级同一条受验证路径）→
 *     返回 needRestart=true；重启仍走既有 devforge_restart（用户确认红线不变）。
 */

import { execFile } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPackageReader, type PackageReader } from './plugin-brief.ts'

/** 更新源登记：一个可更新的自研插件包。 */
export interface UpdateSource {
  /** npm 包名（profile 里的安装名）。 */
  packageName: string
  /** GitHub 仓库（owner/repo），Latest Release 提供新版本。 */
  repo: string
}

/** 默认更新源：dsh-devforge 自己。 */
export const PLUGIN_UPDATE_DEFAULT_SOURCES: UpdateSource[] = [
  { packageName: 'dsh-devforge', repo: 'andyfan1094/dsh-devforge' },
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

/** GitHub Release 的最小投影。 */
export interface LatestRelease {
  /** 发布 tag（如 v0.13.0）。 */
  tag: string
  /** 资产列表里的第一个 .tgz 直链。 */
  tgzUrl: string
  /** tgz 文件名。 */
  tgzName: string
}

/** 单个插件的检查结果。 */
export interface UpdateCheckItem {
  packageName: string
  repo: string
  /** 已装版本；空串 = 未安装或读取失败。 */
  installed: string
  /** 最新发布版本；空串 = 获取失败。 */
  latest: string
  /** 最新版 tgz 直链（有更新时用于一键升级）。 */
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

/** 从 Release 资产里挑 tgz 直链与文件名。 */
export function pickTgzAsset(assets: ReadonlyArray<{ name?: unknown; browser_download_url?: unknown }>): { tgzUrl: string; tgzName: string } {
  for (const asset of assets) {
    if (typeof asset.name === 'string' && asset.name.endsWith('.tgz') && typeof asset.browser_download_url === 'string' && asset.browser_download_url.startsWith('https://')) {
      return { tgzUrl: asset.browser_download_url, tgzName: asset.name }
    }
  }
  return { tgzUrl: '', tgzName: '' }
}

/** 带超时的 GitHub Latest Release 拉取（默认实现；测试可注入）。 */
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

/** 下载 tgz 到临时目录；返回本地文件路径。 */
export async function downloadTgz(url: string, packageName: string, version: string, timeoutMs = 60000, maxBytes = 25 * 1024 * 1024): Promise<string> {
  if (!url.startsWith('https://')) throw new Error('非 https 下载地址，拒绝下载')
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
  if (!response.ok) throw new Error('下载失败 HTTP ' + String(response.status))
  const buffer = Buffer.from(await response.arrayBuffer())
  if (buffer.byteLength === 0) throw new Error('下载内容为空')
  if (buffer.byteLength > maxBytes) throw new Error('下载内容超过 ' + Math.round(maxBytes / 1024 / 1024) + 'MB 上限')
  const target = join(tmpdir(), packageName + '-' + version + '.tgz')
  await writeFile(target, buffer)
  return target
}

/** 执行 dsh plugin add（默认实现；测试可注入）。 */
export function runPluginAdd(profile: string, tgzPath: string, timeoutMs = 180000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('dsh', ['plugin', '--profile', profile, 'add', tgzPath], { timeout: timeoutMs, encoding: 'utf8' }, (error, stdout, stderr) => {
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
  fetchLatest?: typeof fetchLatestRelease
  download?: typeof downloadTgz
  runAdd?: typeof runPluginAdd
  /** 临时目录（默认 os.tmpdir()）。 */
  tmpDir?: string
}

/** 单插件检查（纯编排，便于单测）。 */
export async function checkOne(source: UpdateSource, installedVersion: string, fetchLatest: typeof fetchLatestRelease): Promise<UpdateCheckItem> {
  const base: UpdateCheckItem = { packageName: source.packageName, repo: source.repo, installed: installedVersion, latest: '', assetUrl: '', status: 'error', reason: '' }
  let release: LatestRelease | null
  try {
    release = await fetchLatest(source.repo)
  } catch (error) {
    return { ...base, status: 'error', reason: error instanceof Error ? error.message : String(error) }
  }
  if (release === null) {
    return { ...base, status: installedVersion === '' ? 'installed-unknown' : 'up-to-date', reason: '仓库尚无任何 Release' }
  }
  const latest = parseTagVersion(release.tag)
  if (latest === '') {
    return { ...base, status: 'error', reason: 'Release tag 不是语义化版本：' + release.tag }
  }
  if (installedVersion === '') {
    return { ...base, latest, assetUrl: release.tgzUrl, status: 'installed-unknown', reason: '本机未安装该插件' }
  }
  const cmp = compareSemver(installedVersion, latest)
  if (cmp > 0) return { ...base, latest, assetUrl: release.tgzUrl, status: 'up-to-date', reason: '本地版本高于最新发布（内测/暂存环境）' }
  if (cmp === 0) return { ...base, latest, assetUrl: release.tgzUrl, status: 'up-to-date' }
  return { ...base, latest, assetUrl: release.tgzUrl, status: 'update-available', reason: '' }
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
    const fetchLatest = this.deps.fetchLatest ?? fetchLatestRelease
    const items = await Promise.all(config.sources.map(async (source): Promise<UpdateCheckItem> => {
      const info = this.deps.readInstalled(source.packageName)
      const installed = info?.version ?? ''
      return await checkOne(source, installed, fetchLatest)
    }))
    return { enabled: true, items }
  }

  /** 一键升级：白名单校验 → 拉最新 → 下载 → dsh plugin add。 */
  async apply(packageName: string): Promise<PluginUpdateApplyResult> {
    const config = this.resolveConfig()
    if (!config.enabled) throw new Error('插件更新能力已关闭')
    // 白名单：只允许升级登记表里的包，防止该接口被用来装任意 npm 包。
    const source = config.sources.find((item) => item.packageName === packageName)
    if (!source) throw new Error('包不在更新源登记表内，拒绝升级：' + packageName)
    const fetchLatest = this.deps.fetchLatest ?? fetchLatestRelease
    const release = await fetchLatest(source.repo)
    if (release === null) throw new Error('仓库尚无任何 Release，无可升级版本')
    const version = parseTagVersion(release.tag)
    if (version === '') throw new Error('Release tag 不是语义化版本：' + release.tag)
    if (release.tgzUrl === '') throw new Error('Release 资产里没有 .tgz 安装包')
    const download = this.deps.download ?? downloadTgz
    const tgzPath = await download(release.tgzUrl, source.packageName, version)
    const runAdd = this.deps.runAdd ?? runPluginAdd
    const output = await runAdd(config.profile, tgzPath)
    return { ok: true, packageName: source.packageName, version, output, needRestart: true }
  }
}

/** 默认已装版本读取器（profile 兄弟插件 + 宿主入口双锚点）。 */
export function createDefaultInstalledReader(): PackageReader {
  return createPackageReader([import.meta.url, process.argv[1] ?? ''])
}
