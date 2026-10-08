/**
 * 插件更新能力（0.13.1 引入；0.35.0 官网登录墙改造）—— 已装插件 vs 官网版本清单的检查与一键升级。
 *
 * 需求（辉哥定）：多台电脑装天工造梦插件后没有统一更新入口，且更新应该链接
 * 自有官网（modagentai.com 插件发布站），而不是把 GitHub 当第一渠道。
 *
 * 设计边界：
 *   - 更新源登记表：包名 → 官网清单地址（downloads/index.json，含 sha256）。
 *     GitHub 兜底渠道已移除（0.35.0）：官网清单失败直接抛错，不再静默换渠道。
 *   - 官网下载鉴权（0.41.11 修回归）：nginx 已把 /downloads/*.tgz 直连改成一律 404（历史版本
 *     对外隐藏），旧的「带 sid Cookie 直连 /downloads/...」必然 404。apply 时先用官网会话令牌
 *     （面板登录态优先，无登录态回退 site 账号 POST /api/auth/login 换 sid）调
 *     POST /api/download-token 换票，再把清单里的 /downloads/<file> 映射到 /dl/<file>?token=<票>；
 *     无登录态、换票 401 或下载 401/403 时给出个人中心登录引导。清单 downloads/index.json 保持公开。
 *   - check：读已装版本（复用 plugin-brief 的包读取器）→ 官网清单 latest 与已装比较。
 *   - apply：登录（可选）→ 下载 tgz → sha256 与清单比对（清单提供时强制校验，防下载被篡改）→
 *     spawn `dsh plugin --profile <profile> add <tgz>`（与手工升级同一条受验证路径）→
 *     返回 needRestart=true；重启仍走既有 devforge_restart（用户确认红线不变）。
 *   - 只对登记过的包提供更新，apply 白名单校验，绝不能被用来装任意包。
 */

import { execFile, type ExecFileOptionsWithBufferEncoding } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { upstreamRequestHeaders, upstreamResponseText } from './upstream-fetch.ts'
import { createPackageReader, type PackageReader } from './plugin-brief.ts'

/** 更新源登记：一个可更新的自研插件包（官网清单渠道）。 */
export interface UpdateSource {
  /** npm 包名（profile 里的安装名）。 */
  packageName: string
  /** 官网版本清单地址（modagentai.com 的 downloads/index.json）。 */
  indexUrl?: string
  /** （已废弃，0.35.0 起不再使用）历史 GitHub 兜底渠道字段，仅为旧配置兼容保留。 */
  repo?: string
}

/** 默认更新源：dsh-devforge 自己（官网清单渠道）。 */
export const PLUGIN_UPDATE_DEFAULT_SOURCES: UpdateSource[] = [
  {
    packageName: 'dsh-devforge',
    indexUrl: 'https://modagentai.com/downloads/index.json',
  },
]

/** 官网默认 API 根地址（site 配置缺省值）。 */
export const PLUGIN_UPDATE_DEFAULT_SITE_API = 'https://modagentai.com'

/** 官网站点凭据（登录墙用）。明文密码仅存本机 store.db settings（与既有凭据同级敏感度），接口对外一律脱敏。 */
export interface PluginUpdateSiteConfig {
  /** 官网 API 根地址（空串按缺省官网处理）。 */
  apiUrl: string
  /** 官网账号（管理员分配）。 */
  username: string
  /** 官网密码（明文本机存储；GET 接口只回 hasPassword + 掩码）。 */
  password: string
}

/** 官网账号设置视图（密码脱敏：明文不出 Host，浏览器只见 hasPassword 与掩码）。 */
export interface PluginUpdateSiteView {
  /** 官网 API 根地址（面板固定展示）。 */
  apiUrl: string
  /** 已保存的官网账号。 */
  username: string
  /** 是否已配置密码。 */
  hasPassword: boolean
  /** 密码掩码展示（未配置时为空串）。 */
  passwordMask: string
}

/** 官网用户名规则：3-32 位字母、数字或下划线（官网服务端同款约束）。 */
export const PLUGIN_UPDATE_SITE_USERNAME_RE = /^[a-zA-Z0-9_]{3,32}$/

/**
 * 官网账号设置脱敏视图：明文密码绝不出 Host，浏览器只见 hasPassword 与掩码。
 * apiUrl 空串按缺省官网（PLUGIN_UPDATE_DEFAULT_SITE_API）归一后返回。
 */
export function toSiteView(site: PluginUpdateSiteConfig): PluginUpdateSiteView {
  const apiUrl = site.apiUrl.trim() !== '' ? site.apiUrl.trim() : PLUGIN_UPDATE_DEFAULT_SITE_API
  return {
    apiUrl,
    username: site.username,
    hasPassword: site.password !== '',
    passwordMask: site.password === '' ? '' : '••••••••',
  }
}

/** 官网账号设置 PUT 请求体（字段全部可选；缺省 = 保留现有值）。 */
export interface PluginUpdateSitePatch {
  /** 官网 API 根地址；空串 = 重置为缺省官网。 */
  apiUrl?: unknown
  /** 官网账号（管理员分配）。 */
  username?: unknown
  /** 官网密码；空串/缺省 = 不修改已存密码。 */
  password?: unknown
}

/**
 * 官网账号设置补丁的校验与合并：返回落库用的完整 site 配置；非法输入抛中文错误（路由层转 400）。
 * 规则（辉哥定）：
 *   - apiUrl：缺省保留现有；空串重置为缺省官网；非空必须 https:// 开头（登录密码走明文 body，拒绝 http）。
 *   - username：缺省保留现有；现有为空且未提供 → 首设缺失报错；提供则 trim 后按 PLUGIN_UPDATE_SITE_USERNAME_RE 校验。
 *   - password：缺省/空串 = 不修改已存密码；首次设置（现有为空）必须提供非空且 ≥8 位；上限 128 位防滥用。
 */
export function applySitePatch(current: PluginUpdateSiteConfig, patch: PluginUpdateSitePatch): PluginUpdateSiteConfig {
  // apiUrl：缺省保留现有；空串归一为缺省官网；无论来自补丁还是存量，统一 https 校验 + 去尾斜杠（幂等归一）。
  let apiUrl = typeof patch.apiUrl === 'string' ? patch.apiUrl.trim() : current.apiUrl
  if (apiUrl === '') {
    apiUrl = PLUGIN_UPDATE_DEFAULT_SITE_API
  } else {
    if (!apiUrl.startsWith('https://')) throw new Error('官网地址必须以 https:// 开头')
    apiUrl = apiUrl.replace(/\/+$/, '')
  }

  // username：缺省保留现有；现有为空且未提供 = 首设缺失；提供则校验格式。
  let username = current.username
  if (typeof patch.username === 'string') {
    username = patch.username.trim()
    if (!PLUGIN_UPDATE_SITE_USERNAME_RE.test(username)) throw new Error('用户名格式不正确：3-32 位字母、数字或下划线')
  } else if (username === '') {
    throw new Error('缺少用户名：请填写官网账号（3-32 位字母、数字或下划线，账号由管理员分配）')
  }

  // password：缺省/空串 = 不修改；首次设置必须提供且 ≥8 位；上限 128 位。
  let password = current.password
  if (typeof patch.password === 'string' && patch.password !== '') {
    if (patch.password.length < 8) throw new Error('密码至少 8 位')
    if (patch.password.length > 128) throw new Error('密码过长（最多 128 位）')
    password = patch.password
  } else if (password === '') {
    throw new Error('首次设置必须填写密码（至少 8 位）')
  }

  return { apiUrl, username, password }
}

/** 插件更新配置。 */
export interface PluginUpdateConfig {
  /** 总开关；false 时 check/apply 都返回明确提示。 */
  enabled: boolean
  /** 执行 dsh plugin add 的目标 profile 名。 */
  profile: string
  /** 更新源登记表。 */
  sources: UpdateSource[]
  /** 官网站点凭据（可选；配置后 apply 先登录换 Cookie 再下载）。 */
  site?: PluginUpdateSiteConfig
}

/** 官网版本清单（downloads/index.json）的最小投影。 */
export interface SiteReleaseIndex {
  /** 最新版本号。 */
  latest: string
  /** 最新版 tgz 地址（相对路径已按清单地址补全为绝对 https）。 */
  latestUrl: string
  /** 版本条目（含 sha256 完整性值与更新日志）。 */
  versions: Array<{ version: string; url: string; sha256?: string; date?: string; notes?: string }>
}

/** 渠道归一后的「最新版」信息。 */
export interface LatestInfo {
  /** 最新版本号（semver，可带预发布段）。 */
  version: string
  /** tgz 下载直链。 */
  tgzUrl: string
  /** 来源渠道（官网清单；GitHub 兜底已移除）。 */
  via: 'site'
  /** 清单提供的 sha256。 */
  sha256?: string
  /** 发布日期（清单提供时）。 */
  date?: string
  /** 最新版更新日志（清单 notes）。 */
  notes?: string
  /** 最近几个版本的更新日志（面板展示用，含最新版，最多 3 条）。 */
  history?: Array<{ version: string; date?: string; notes?: string }>
}

/** tgz 地址绝对化：清单允许相对路径（/downloads/...），按清单地址的 origin 补全。 */
export function absolutizeTgzUrl(url: string, indexUrl: string): string {
  if (/^https:\/\//.test(url)) return url
  if (url.startsWith('/')) {
    const origin = new URL(indexUrl).origin
    return origin + url
  }
  return url
}

/**
 * 把官网清单规整成最新版信息；结构不合法返回 undefined。
 * 兼容相对路径（0.40.1 修复「官网清单结构不合法」：官网 index.json 的 latestUrl/url
 * 是 /downloads/... 相对路径，旧解析器强要求 https:// 导致整单被拒）；透出 date/notes 供面板显示更新日志。
 */
export function parseSiteIndex(payload: unknown, indexUrl?: string): SiteReleaseIndex | undefined {
  const record = payload as { latest?: unknown; latestUrl?: unknown; versions?: unknown } | null
  if (record === null || typeof record !== 'object') return undefined
  if (!isVersionLikeAny(record.latest)) return undefined
  if (!Array.isArray(record.versions)) return undefined
  const resolveUrl = (value: string): string => (indexUrl !== undefined ? absolutizeTgzUrl(value, indexUrl) : value)
  const versions: SiteReleaseIndex['versions'] = []
  for (const entry of record.versions) {
    const item = entry as { version?: unknown; url?: unknown; sha256?: unknown; date?: unknown; notes?: unknown }
    if (typeof item.version !== 'string' || typeof item.url !== 'string') continue
    if (!/^https:\/\//.test(item.url) && !item.url.startsWith('/')) continue
    versions.push({
      version: item.version,
      url: resolveUrl(item.url),
      sha256: typeof item.sha256 === 'string' ? item.sha256 : undefined,
      date: typeof item.date === 'string' ? item.date : undefined,
      notes: typeof item.notes === 'string' ? item.notes : undefined,
    })
  }
  if (versions.length === 0) return undefined
  const latest = typeof record.latest === 'string' ? record.latest : ''
  // latestUrl 允许缺失或相对：优先取与 latest 匹配的版本条目地址，再退 latestUrl 字段。
  const matched = versions.find((entry) => entry.version === latest)
  const latestUrlRaw = typeof record.latestUrl === 'string' && (record.latestUrl.startsWith('https://') || record.latestUrl.startsWith('/')) ? record.latestUrl : ''
  const latestUrl = matched?.url ?? (latestUrlRaw !== '' ? resolveUrl(latestUrlRaw) : '')
  if (latestUrl === '') return undefined
  return { latest, latestUrl, versions }
}

/** 宽松版本号（x.y.z 可带预发布段）：清单 latest 兼容内测版本。 */
function isVersionLikeAny(value: unknown): value is string {
  return typeof value === 'string' && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value)
}

/** 单个插件的检查结果。 */
export interface UpdateCheckItem {
  packageName: string
  /** 命中的渠道：官网清单 / 未登记。 */
  via: 'site' | 'none'
  installed: string
  latest: string
  assetUrl: string
  status: 'up-to-date' | 'update-available' | 'installed-unknown' | 'error'
  /** 补充说明（错误原因/内测提示），空串 = 无。 */
  reason: string
  /** 最新版发布日期（清单提供时）。 */
  latestDate?: string
  /** 最新版更新内容（清单 notes，0.40.1 辉哥需求「直接显示更新了什么」）。 */
  latestNotes?: string
  /** 最近几个版本的更新日志（含最新版，最多 3 条）。 */
  history?: Array<{ version: string; date?: string; notes?: string }>
}

/** 一键升级结果。 */
export interface PluginUpdateApplyResult {
  ok: boolean
  packageName: string
  /** 升级到的版本（成功时有值）。 */
  version: string
  /** 命中渠道（官网清单）。 */
  via: 'site'
  /** dsh plugin add 的输出摘要（截断）。 */
  output: string
  /** 恒为 true：升级后必须重启 Host 才生效。 */
  needRestart: boolean
}

/** 严格 semver（x.y.z）校验。 */
function isSemver(value: string): boolean {
  return /^\d+\.\d+\.\d+$/.test(value)
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

/**
 * 从 set-cookie 值列表里解析官网会话 Cookie（sid）。
 * set-cookie 头可能是数组（Node fetch 的 getSetCookie()）或合并串，登录成功响应
 * 形如 `sid=xxx; Path=/; HttpOnly`；取第一条 sid 条目的 `sid=xxx` 部分直接当 Cookie 头用。
 */
export function parseSidFromSetCookie(entries: readonly string[]): string {
  for (const entry of entries) {
    const pair = (entry.split(';')[0] ?? '').trim()
    if (pair.startsWith('sid=') && pair.length > 'sid='.length) return pair
  }
  return ''
}

/**
 * 官网登录：POST {apiUrl}/api/auth/login（body: username/password），
 * 200 时从 set-cookie 解析 sid 会话 Cookie 返回（形如 `sid=xxx`）。
 * 401 → 账号或密码错误；网络/超时 → 带原始信息的中文报错。fetch 可注入便于测试。
 */
export async function loginSite(site: PluginUpdateSiteConfig, options?: { fetchImpl?: typeof fetch; timeoutMs?: number }): Promise<string> {
  const apiUrl = ((site.apiUrl ?? '').trim() !== '' ? site.apiUrl.trim() : PLUGIN_UPDATE_DEFAULT_SITE_API).replace(/\/+$/, '')
  const doFetch = options?.fetchImpl ?? fetch
  let response: Response
  try {
    response = await doFetch(apiUrl + '/api/auth/login', {
      method: 'POST',
      headers: upstreamRequestHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({ username: site.username, password: site.password }),
      signal: AbortSignal.timeout(options?.timeoutMs ?? 15000),
    })
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error('官网登录请求失败（' + apiUrl + '）：' + detail)
  }
  if (response.status === 401) throw new Error('官网账号或密码错误')
  if (!response.ok) throw new Error('官网登录失败：HTTP ' + String(response.status))
  const setCookies = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : []
  const sid = parseSidFromSetCookie(setCookies)
  if (sid === '') throw new Error('官网登录成功但响应未携带会话 Cookie（sid），无法建立下载会话')
  return sid
}

/** 官网会话令牌端点：用会话令牌换下载票（返回值即显式令牌，也是中转 API Key）。 */
export const PLUGIN_UPDATE_DOWNLOAD_TOKEN_PATH = '/api/download-token'

/** 官网下载鉴权通道前缀：tgz 只能经 /dl/<file>?token=<票> 下载。 */
export const PLUGIN_UPDATE_GATED_DOWNLOAD_PREFIX = '/dl/'

/** 官网站点 API 根地址（site 配置缺省或留空 → 官方官网），去掉尾部斜杠。 */
export function siteApiRoot(site?: PluginUpdateSiteConfig): string {
  const raw = site?.apiUrl.trim() ?? ''
  return (raw === '' ? PLUGIN_UPDATE_DEFAULT_SITE_API : raw).replace(/\/+$/, '')
}

/** tgz 地址是否与官网同源（只有同源才需要走 /dl/ 登录鉴权通道）。 */
export function sameOrigin(url: string, apiRoot: string): boolean {
  try {
    return new URL(url).origin === new URL(apiRoot).origin
  } catch {
    return false
  }
}

/**
 * 归一化官网会话令牌。
 * loginSite 返回的是 `sid=xxx` 形态的 Cookie 值，而换票接口要的是裸令牌；
 * 面板登录态本身就是裸令牌，原样返回。
 */
export function normalizeSessionToken(value: string): string {
  const trimmed = value.trim()
  if (trimmed === '') return ''
  const match = /(?:^|;\s*)sid=([^;]+)/.exec(trimmed)
  return match?.[1]?.trim() ?? trimmed
}

/**
 * 用官网会话令牌换下载票（POST /api/download-token）。
 *
 * 0.41.11 修回归：nginx 把 /downloads/*.tgz 直连改成一律 404 后，插件的
 * 「带 sid Cookie 直连 /downloads/...」必然报「下载失败 HTTP 404」；下载凭据只能经本接口取得。
 * 401 说明会话已失效，转成个人中心登录引导。
 */
export async function fetchDownloadTicket(apiUrl: string, sessionToken: string, options?: { fetchImpl?: typeof fetch; timeoutMs?: number }): Promise<string> {
  const url = apiUrl.replace(/\/+$/, '') + PLUGIN_UPDATE_DOWNLOAD_TOKEN_PATH
  const token = normalizeSessionToken(sessionToken)
  if (token === '') throw new Error('官网会话令牌为空，无法换取下载票')
  let response: Response
  try {
    response = await (options?.fetchImpl ?? fetch)(url, {
      method: 'POST',
      headers: upstreamRequestHeaders({ 'content-type': 'application/json', authorization: 'Bearer ' + token }),
      body: '{}',
      signal: AbortSignal.timeout(options?.timeoutMs ?? 15000),
    })
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error('官网换取下载票失败（' + url + '）：' + detail)
  }
  if (response.status === 401) throw new Error('官网会话已失效：请到 天工造梦 → 个人中心 重新登录官网账号后重试')
  if (!response.ok) throw new Error('官网换取下载票失败：HTTP ' + String(response.status))
  let payload: { token?: unknown } | null = null
  try {
    payload = JSON.parse(await upstreamResponseText(response)) as { token?: unknown } | null
  } catch {
    payload = null
  }
  const ticket = typeof payload?.token === 'string' ? payload.token.trim() : ''
  if (ticket === '') throw new Error('官网未返回下载票，无法下载')
  return ticket
}

/**
 * 把清单里的 tgz 地址映射到官网登录鉴权通道 /dl/<file>?token=<票>。
 *
 * 清单的 latestUrl / versions[].url 是 /downloads/<file>（0.41.11 起直连一律 404）；
 * 同源地址统一重建为 /dl/<file> 再挂票；非同源地址原样返回，保留将来接入其他发布渠道的能力。
 */
export function buildGatedDownloadUrl(tgzUrl: string, ticket: string, apiUrl: string): string {
  let source: URL
  let origin: string
  try {
    source = new URL(tgzUrl)
    origin = new URL(apiUrl).origin
  } catch {
    return tgzUrl
  }
  if (source.origin !== origin) return tgzUrl
  // 只处理 .tgz 直链：目录地址或其他形态不猜，原样返回（避免把 /downloads/ 拼成 /dl/downloads）。
  if (!source.pathname.endsWith('.tgz')) return tgzUrl
  const file = source.pathname.split('/').pop() ?? ''
  if (file === '') return tgzUrl
  const gated = new URL(PLUGIN_UPDATE_GATED_DOWNLOAD_PREFIX + encodeURIComponent(file), origin)
  gated.searchParams.set('token', ticket)
  return gated.toString()
}

/** 带超时的官网清单拉取（主渠道；测试可注入）。 */
export async function fetchSiteIndex(indexUrl: string, timeoutMs = 15000): Promise<SiteReleaseIndex> {
  const response = await fetch(indexUrl, {
    headers: upstreamRequestHeaders({ 'user-agent': 'dsh-devforge-plugin-update' }),
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!response.ok) throw new Error('官网清单 HTTP ' + String(response.status))
  const parsed = parseSiteIndex(JSON.parse(await upstreamResponseText(response)), indexUrl)
  if (!parsed) throw new Error('官网清单结构不合法')
  return parsed
}

/** 按 URL 解析最新版：仅官网清单渠道（GitHub 兜底已移除；清单失败直接抛错，不再静默换渠道）。 */
export async function resolveLatest(source: UpdateSource): Promise<LatestInfo> {
  if (source.indexUrl) {
    const index = await fetchSiteIndex(source.indexUrl)
    // 版本条目里优先取与 latest 匹配的版本化地址（保留 sha256），否则退 latest 固定地址。
    const matched = index.versions.find((entry) => entry.version === index.latest)
    return {
      version: index.latest,
      tgzUrl: matched?.url ?? index.latestUrl,
      via: 'site',
      sha256: matched?.sha256,
      date: matched?.date,
      notes: matched?.notes,
      // 全量透出官网更新说明（0.40.1 辉哥定稿「能抓取也要抓取」）：官网清单全部版本的 notes
      // 都带回来（40 版约 8KB，不影响检查耗时），前端做展开收起。
      history: index.versions.map((entry) => ({ version: entry.version, date: entry.date, notes: entry.notes })),
    }
  }
  throw new Error('更新源未登记官网清单地址（GitHub 兜底渠道已移除）')
}

/** sha256 十六进制摘要（完整性校验用）。 */
export function sha256Hex(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

/** 下载 tgz 到临时目录；提供期望 sha256 时强制完整性校验；headers 透传（官网登录墙带 Cookie）。 */
export async function downloadTgz(url: string, packageName: string, version: string, options?: { timeoutMs?: number; maxBytes?: number; expectedSha256?: string; headers?: Record<string, string> }): Promise<string> {
  const timeoutMs = options?.timeoutMs ?? 60000
  const maxBytes = options?.maxBytes ?? 25 * 1024 * 1024
  if (!url.startsWith('https://')) throw new Error('非 https 下载地址，拒绝下载')
  const response = await fetch(url, { headers: options?.headers, signal: AbortSignal.timeout(timeoutMs) })
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
 * dsh plugin add 的启动参数；Windows 先尝试复用当前 DSH 的 Node 入口，避免依赖 PATH 中的 .cmd 垫片。
 */
export interface DshPluginAddCommandOptions {
  /** 当前 DSH CLI 的 Node 入口（通常是 lib/bin.js 或 bin.ts）。 */
  entryPath?: string
  /** 启动 DSH 的 Node 可执行文件；缺省使用当前进程 Node。 */
  nodePath?: string
  /** 当前 Node 进程的启动参数（例如 tsx/esm loader）。 */
  execArgv?: readonly string[]
  /** Windows 命令解释器路径；测试和特殊宿主可注入。 */
  comSpec?: string
}

/** 一条待执行的 dsh plugin add 命令。 */
export interface DshPluginAddCommand {
  /** 可执行文件（Node、桌面版 Electron 主程序或 ComSpec）。 */
  file: string
  /** 命令行参数。 */
  args: string[]
  /** 是否由 Windows 原样解析参数（cmd 兜底时为 true）。 */
  verbatim: boolean
  /** 需要额外注入的环境变量；桌面布局以 Electron 运行内置 CLI 时为 ELECTRON_RUN_AS_NODE=1。 */
  env?: Record<string, string>
}

/** 可安全直接复用的 DSH CLI 入口形态。 */
const DSH_ENTRY_RE = /[\\/](?:bin\.(?:js|ts)|dsh)$/

/** 桌面安装包内置 CLI 相对 `<安装根>/resources` 的路径（与官方 dsh.cmd 指向同一文件）。 */
const DESKTOP_CLI_TAIL = ['node_modules', '@deepseek-ai', 'dsh-desktop-host', 'lib', 'cli.js'] as const

/** 桌面宿主库目录：GUI 主进程 index.js 与官方 CLI cli.js 同目录。 */
const DESKTOP_HOST_LIB_RE = /^(.*[\\/]dsh-desktop-host[\\/]lib)[\\/](?:cli|index)\.js$/i

/** cmd 会在引号内展开的变量字符；没有 Node 入口时拒绝这类输入，避免语义被改写。 */
const CMD_EXPANSION_RE = /[%!]/

/**
 * 定位桌面安装包内的官方 CLI 入口，不依赖 PATH。
 *
 * 背景：桌面版宿主进程的 process.argv[1] 是 GUI 主进程 `dsh-desktop-host/lib/index.js`，
 * 既不是 `bin.js` 也不是 `dsh`，而官方 `dsh.cmd` 只存在于安装目录内、没有注册进 PATH，
 * 于是「一键升级」在 cmd 兜底里必然报「'dsh' 不是内部或外部命令」。
 *
 * 探测顺序：
 *   1. argv[1] 已是桌面宿主入口时，取同目录的 cli.js（天然覆盖 app.asar 与 unpacked 两种形态）；
 *   2. 从宿主可执行文件推导 `<安装根>/resources/app.asar/dsh/...` 与 unpacked 变体。
 * 非桌面布局（npm/pnpm 全局安装、源码开发态）返回 undefined，由调用方回落到原有路径。
 *
 * @param nodePath 宿主可执行文件（桌面版是 `DeepSeek Harness.exe`）。
 * @param entryPath 宿主进程入口（process.argv[1]）。
 */
export function resolveDesktopCliEntry(nodePath: string, entryPath = ''): string | undefined {
  const entry = entryPath.trim()
  const hostMatch = DESKTOP_HOST_LIB_RE.exec(entry)
  if (hostMatch?.[1] !== undefined) {
    const sibling = join(hostMatch[1], 'cli.js')
    if (existsSync(sibling)) return sibling
  }
  const executable = nodePath.trim()
  if (executable === '' || executable === '.') return undefined
  const resources = join(dirname(executable), 'resources')
  // app.asar 内的路径由 Electron 的 fs 支持解析；unpacked 变体用于原生模块被解包的安装形态。
  const candidates = [
    join(resources, 'app.asar', 'dsh', ...DESKTOP_CLI_TAIL),
    join(resources, 'app.asar.unpacked', 'dsh', ...DESKTOP_CLI_TAIL),
  ]
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  return undefined
}

/**
 * 构造 `dsh plugin add` 的启动命令。
 *
 * Windows 优先直接执行当前 DSH 的 Node 入口：运行中的宿主已经拥有真实入口与
 * Node 路径，复用它不会再经过 dsh.cmd/dsh.ps1，也不依赖 GUI 进程是否继承 npm PATH。
 * 桌面安装包再退一步复用包内官方 CLI（`--expose-internals` + ELECTRON_RUN_AS_NODE，
 * 与官方 dsh.cmd 完全同形态）。只有都不可用时才退回 ComSpec；退回路径逐 token 引用，
 * 并拒绝 cmd 的变量展开字符。POSIX 保持原有直接执行 dsh 的行为。
 */
export function buildDshPluginAddCommand(platform: NodeJS.Platform, profile: string, tgzPath: string, options: DshPluginAddCommandOptions = {}): DshPluginAddCommand {
  if (platform === 'win32') {
    const entryPath = options.entryPath?.trim() ?? ''
    const nodePath = options.nodePath?.trim() || process.execPath
    if (entryPath !== '' && DSH_ENTRY_RE.test(entryPath)) {
      return {
        file: nodePath,
        args: [...(options.execArgv ?? []), entryPath, 'plugin', '--profile', profile, 'add', tgzPath],
        verbatim: false,
      }
    }
    // 桌面安装包：PATH 里没有 dsh，按官方 dsh.cmd 的形态直启包内 CLI（Electron 以 Node 运行）。
    const desktopCli = resolveDesktopCliEntry(nodePath, entryPath)
    if (desktopCli !== undefined) {
      return {
        file: nodePath,
        args: ['--expose-internals', desktopCli, 'plugin', '--profile', profile, 'add', tgzPath],
        verbatim: false,
        env: { ELECTRON_RUN_AS_NODE: '1' },
      }
    }
    if (CMD_EXPANSION_RE.test(profile) || CMD_EXPANSION_RE.test(tgzPath)) {
      throw new Error('Windows 更新缺少可复用的 DSH 入口，且 profile 或临时包路径含 cmd 变量展开字符；请从终端启动 DSH 后重试')
    }
    // cmd.exe 会重新解析整行，不能只按空格补引号；括号、百分号和管道符等
    // 也会改变命令含义。这里沿用 dshmarket 的安全边界，逐个 token 转义后再交给
    // /d /s /c，并保持 windowsVerbatimArguments，避免 Node 再次改写反斜杠。
    const cmdMetaCharacters = /[\s"&|<>^()%!]/
    const quoteCmdArg = (value: string): string => {
      if (!cmdMetaCharacters.test(value)) return value
      return '"' + value.replace(/"/g, '""') + '"'
    }
    const commandLine = ['dsh', 'plugin', '--profile', profile, 'add', tgzPath].map(quoteCmdArg).join(' ')
    return {
      file: options.comSpec?.trim() || process.env.ComSpec || 'cmd.exe',
      // 兜底路径额外切 UTF-8 代码页（对按控制台代码页输出的外部命令有效）。实测：cmd 自身的
      // 本地化提示（「'dsh' 不是内部或外部命令…」）仍按 OEM 代码页输出，真正兜住乱码的是
      // runPluginAdd 里的 GBK 重解码，chcp 只是双保险。
      args: ['/d', '/s', '/c', '"chcp 65001>nul & ' + commandLine + '"'],
      verbatim: true,
    }
  }
  return { file: 'dsh', args: ['plugin', '--profile', profile, 'add', tgzPath], verbatim: false }
}

/**
 * 解码子进程输出。
 *
 * 中文 Windows 下 cmd/node 的报错按 GBK 输出，一律按 UTF-8 解码会在面板里变成
 * 「'dsh' 锟斤拷」这类乱码。这里先按 UTF-8 解，出现替换字符 U+FFFD 时用 GBK 重解；
 * 运行环境不支持 GBK 时回落 UTF-8 结果，保证永远有可读文本。
 */
export function decodeProcessOutput(input: Buffer | string | undefined): string {
  if (input === undefined) return ''
  if (typeof input === 'string') return input
  const utf8 = input.toString('utf8')
  if (!utf8.includes('\uFFFD')) return utf8
  try {
    return new TextDecoder('gbk').decode(input)
  } catch {
    return utf8
  }
}

/** 执行 dsh plugin add（默认实现；测试可注入）。 */
export function runPluginAdd(profile: string, tgzPath: string, timeoutMs = 180000): Promise<string> {
  return new Promise((resolve, reject) => {
    const command = buildDshPluginAddCommand(process.platform, profile, tgzPath, {
      entryPath: process.argv[1],
      nodePath: process.execPath,
      execArgv: process.execArgv,
    })
    const options: ExecFileOptionsWithBufferEncoding = {
      timeout: timeoutMs,
      // 收字节而不是字符串：中文 Windows 的报错是 GBK，交给 decodeProcessOutput 判定编码。
      encoding: 'buffer',
      windowsVerbatimArguments: command.verbatim,
      windowsHide: true,
      // 更新动作没有交互式终端；避免 pnpm 在无 TTY 时等待确认或直接中止。
      // 桌面安装包额外注入 ELECTRON_RUN_AS_NODE，让安装目录里的 GUI 主程序以 Node 形态运行包内 CLI。
      env: { ...process.env, CI: 'true', ...(command.env ?? {}) },
    }
    execFile(command.file, command.args, options, (error, stdout, stderr) => {
      const output = decodeProcessOutput(stdout)
      const errorText = decodeProcessOutput(stderr)
      if (error) {
        const detail = (errorText || output || error.message).slice(-400)
        reject(new Error('dsh plugin add 失败：' + detail))
        return
      }
      resolve((output + errorText).slice(-400))
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
  /** 官网登录（site 配置存在且 apply 走官网渠道时使用；测试可注入）。 */
  loginSite?: typeof loginSite
  /** 面板官网登录态（个人中心 session token，0.40.1 起下载优先复用，免重复配账号）。 */
  sessionToken?: () => Promise<string>
  /** 换下载票（0.41.11 起下载走 /dl/ 鉴权通道；测试可注入，默认零网络）。 */
  fetchTicket?: typeof fetchDownloadTicket
}

/** 单插件检查（纯编排，便于单测）。 */
export async function checkOne(source: UpdateSource, installedVersion: string, resolveLatestFn: typeof resolveLatest): Promise<UpdateCheckItem> {
  const via: UpdateCheckItem['via'] = source.indexUrl ? 'site' : 'none'
  const base: UpdateCheckItem = { packageName: source.packageName, via, installed: installedVersion, latest: '', assetUrl: '', status: 'error', reason: '' }
  if (via === 'none') return { ...base, reason: '更新源未登记官网清单地址' }
  let latest: LatestInfo
  try {
    latest = await resolveLatestFn(source)
  } catch (error) {
    return { ...base, status: 'error', reason: error instanceof Error ? error.message : String(error) }
  }
  if (installedVersion === '') {
    return { ...base, latest: latest.version, assetUrl: latest.tgzUrl, status: 'installed-unknown', reason: '本机未安装该插件', latestDate: latest.date, latestNotes: latest.notes, history: latest.history }
  }
  const cmp = compareSemver(installedVersion, latest.version)
  if (cmp > 0) return { ...base, latest: latest.version, assetUrl: latest.tgzUrl, status: 'up-to-date', reason: '本地版本高于官网最新（内测/暂存环境）', latestDate: latest.date, latestNotes: latest.notes, history: latest.history }
  if (cmp === 0) return { ...base, latest: latest.version, assetUrl: latest.tgzUrl, status: 'up-to-date', latestDate: latest.date, latestNotes: latest.notes, history: latest.history }
  return { ...base, latest: latest.version, assetUrl: latest.tgzUrl, status: 'update-available', reason: '', latestDate: latest.date, latestNotes: latest.notes, history: latest.history }
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
      site: config.site,
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

  /**
   * 一键升级：白名单校验 → 官网清单解析最新 → 下载（清单 sha256 强制校验）→ dsh plugin add。
   * 下载鉴权（0.40.1 辉哥定稿「插件已登录这页就该是登录的」）：优先复用面板官网登录态
   * （session token，Bearer），无登录态时回退 site 手动账号登录换 sid。
   */
  async apply(packageName: string): Promise<PluginUpdateApplyResult> {
    const config = this.resolveConfig()
    if (!config.enabled) throw new Error('插件更新能力已关闭')
    // 白名单：只允许升级登记表里的包，防止该接口被用来装任意 npm 包。
    const source = config.sources.find((item) => item.packageName === packageName)
    if (!source) throw new Error('包不在更新源登记表内，拒绝升级：' + packageName)
    const resolveLatestFn = this.deps.resolveLatestFn ?? resolveLatest
    const latest = await resolveLatestFn(source)
    const download = this.deps.download ?? downloadTgz
    // 下载鉴权（0.41.11 修回归）：/downloads/*.tgz 直连已被 nginx 改成一律 404，下载只能走
    // /dl/<file>?token=<票>。先取官网会话令牌（面板登录态优先，无登录态回退 site 手动账号），
    // 再用它换下载票，最后把清单地址映射到鉴权通道；非同源地址原样下载（保留扩展渠道）。
    const apiRoot = siteApiRoot(config.site)
    let tgzUrl = latest.tgzUrl
    if (latest.via === 'site' && sameOrigin(latest.tgzUrl, apiRoot)) {
      let sessionToken = ''
      if (this.deps.sessionToken !== undefined) {
        sessionToken = normalizeSessionToken(await this.deps.sessionToken().catch(() => ''))
      }
      if (sessionToken === '' && config.site !== undefined && config.site.username.trim() !== '' && config.site.password !== '') {
        const login = this.deps.loginSite ?? loginSite
        sessionToken = normalizeSessionToken(await login(config.site))
      }
      // 没有官网登录态时不发下载请求：直连必然 404，直接给可执行的登录引导。
      if (sessionToken === '') throw new Error('官网下载需要登录：请到 天工造梦 → 个人中心 登录官网账号后重试')
      const fetchTicket = this.deps.fetchTicket ?? fetchDownloadTicket
      tgzUrl = buildGatedDownloadUrl(latest.tgzUrl, await fetchTicket(apiRoot, sessionToken), apiRoot)
    }
    let tgzPath: string
    try {
      tgzPath = await download(tgzUrl, source.packageName, latest.version, { expectedSha256: latest.sha256 })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      // 登录墙拦截而非故障：转译成个人中心登录引导（0.40.1 辉哥定稿：页面不再提供手动账号入口）。
      if (/HTTP 40[13](\D|$)/.test(message)) {
        throw new Error('官网下载需要登录：请到 天工造梦 → 个人中心 登录官网账号后重试')
      }
      throw error
    }
    const runAdd = this.deps.runAdd ?? runPluginAdd
    const output = await runAdd(config.profile, tgzPath)
    return { ok: true, packageName: source.packageName, version: latest.version, via: latest.via, output, needRestart: true }
  }
}

/** 默认已装版本读取器（profile 兄弟插件 + 宿主入口双锚点）。 */
export function createDefaultInstalledReader(): PackageReader {
  return createPackageReader([import.meta.url, process.argv[1] ?? ''])
}
