/**
 * 官网账号服务（业务层）：登录 modagentai.com、保存会话令牌、自动配置天工造梦原生模型路由。
 *
 * 安全模型：会话令牌只进受管凭据（.credentials.yaml，0600），面板与日志永不回显；
 * 登录成功即直接在 DSH 模型体系（llm-pi-ai 段）注册「天工造梦」原生 provider，
 * 不经过 OpenAI 中转端点体系。账号信息（用户名/角色）存 store.db settings 表。
 */
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { Context } from '@deepseek-ai/cordis'
import { SettingsConflictError } from '@deepseek-ai/dsh-settings'
import { settingsNamespace } from '../settings-compat.ts'
import { deepEqualJson } from '../provider-settings.ts'
import { getDb, getSettings, putSettings } from '../store/db.ts'
import { MODAGENTAI_ENDPOINT_ID, MODAGENTAI_GW_BASE, MODAGENTAI_GW_KEY_REF, MODAGENTAI_SESSION_REF, MODAGENTAI_SITE, type ModagentaiLoginResult, type ModagentaiPackages, type ModagentaiStatus } from './protocol.ts'
import { TIANGONG_REASONING_EFFORTS, tiangongEffortsOutdated } from './provider-declaration.ts'
import type { OpenAiGatewayService } from '../openai/service.ts'

/** llm-pi-ai 宿主段命名空间（DSH 模型路由体系）。 */
const LLM_PI_AI_NAMESPACE = settingsNamespace('llm-pi-ai')
/** 天工造梦原生 provider id（模型切换行显示 tiangong/GLM-Flash）。 */
const TIANGONG_PROVIDER_ID = 'tiangong'
/** 旧 OpenAI 中转体系生成的 provider id（迁移时清理）。 */
const LEGACY_GATEWAY_PROVIDER_ID = 'openai-gateway-modagentai'

/** 天工造梦原生 provider 声明（GLM-Flash，实测上下文贴 256K；openai-completions 协议走 /chat/completions）。 */
const TIANGONG_PROVIDER: Record<string, unknown> = {
  apiKeyEnv: MODAGENTAI_GW_KEY_REF,
  displayName: '天工造梦',
  api: 'openai-completions',
  baseURL: MODAGENTAI_GW_BASE,
  models: [{
    id: 'GLM-Flash',
    name: 'GLM-Flash',
    contextWindow: 262144,
    input: ['text', 'image'],
    reasoningEfforts: TIANGONG_REASONING_EFFORTS,
  }],
  defaultContextWindow: 262144,
  defaultMaxTokens: 32768,
  defaultInput: ['text', 'image'],
  retryPolicy: {
    mode: 'normal',
    maxRetries: 5,
    retryableCodes: ['RATE_LIMIT', 'SERVER', 'TIMEOUT', 'TRANSPORT', 'EMPTY_RESPONSE'],
    backoff: { initialDelayMs: 1000, maxDelayMs: 120000, jitterRatio: 0.2 },
  },
}

/** 设置段变更操作（与宿主 settings.mutate 对齐的最小类型）。 */
type SettingsMutation = { op: 'set'; path: string[]; value: unknown } | { op: 'unset'; path: string[] }

/** 官网账号业务错误（HTTP 语义状态码，面板直接展示文案）。 */
export class ModagentaiServiceError extends Error {
  /** HTTP 语义状态码（面板直接展示文案用）。 */
  status: number

  constructor(message: string, status = 400) {
    super(message)
    this.name = 'ModagentaiServiceError'
    this.status = status
  }
}

/** store.db settings 表里的账号会话信息（不含令牌本体）。 */
interface ModagentaiAccountSettings {
  username: string
  role: string
  autoApplied: boolean
  appliedModels: number
  appliedAt: number
}

const EMPTY_SETTINGS: ModagentaiAccountSettings = { username: '', role: '', autoApplied: false, appliedModels: 0, appliedAt: 0 }
const SETTINGS_KEY = 'modagentai.settings'
const SITE = 'https://modagentai.com'

/** 30 秒网络超时；AbortSignal.timeout 在 Node 22 可用。 */
const HTTP_TIMEOUT = 30_000

export class ModagentaiService {
  private ctx: Context
  private openai: OpenAiGatewayService

  constructor(ctx: Context, openai: OpenAiGatewayService) {
    this.ctx = ctx
    this.openai = openai
  }

  /** 读取账号会话信息（无则空对象）。 */
  private readSettings(): ModagentaiAccountSettings {
    const stored = getSettings(getDb(), SETTINGS_KEY)
    if (stored === undefined || stored === null || typeof stored !== 'object') return { ...EMPTY_SETTINGS }
    const raw = stored as Record<string, unknown>
    return {
      username: typeof raw.username === 'string' ? raw.username : '',
      role: raw.role === 'admin' || raw.role === 'user' ? raw.role : '',
      autoApplied: raw.autoApplied === true,
      appliedModels: typeof raw.appliedModels === 'number' && Number.isFinite(raw.appliedModels) ? raw.appliedModels : 0,
      appliedAt: typeof raw.appliedAt === 'number' && Number.isFinite(raw.appliedAt) ? raw.appliedAt : 0,
    }
  }

  /** 原子写回账号会话信息。 */
  private writeSettings(next: ModagentaiAccountSettings): void {
    putSettings(getDb(), SETTINGS_KEY, next)
  }

  /** 读取受管凭据里的会话令牌（未配置返回空串）。 */
  private async readToken(): Promise<string> {
    try {
      const resolved = await this.ctx.credentials.resolve(credentialRef(MODAGENTAI_SESSION_REF))
      return resolved?.value.trim() ?? ''
    } catch {
      return ''
    }
  }

  /**
   * 套餐用量视图（辉哥 2026-09-23 定稿）：插件采用用户登录后，侧栏看板显示「什么套餐/总量/剩余」。
   * 聚合官网 /api/gems/packs（套餐目录 + 我的实例 + 余额）与 /api/search/quota（搜索折算）；
   * 未登录直接短路径返回；401 标记会话失效。任一接口失败不让整体崩：字段尽量填充。
   */
  async packages(): Promise<ModagentaiPackages> {
    const settings = this.readSettings()
    const token = await this.readToken()
    if (settings.username === '' || token === '') return { loggedIn: false }
    const headers = { authorization: 'Bearer ' + token, 'user-agent': 'DeepSeek-Harness/1.0' }
    const out: ModagentaiPackages = { loggedIn: true, username: settings.username }
    // 套餐目录 + 我的实例 + 余额
    try {
      const res = await fetch(SITE + '/api/gems/packs', { headers, signal: AbortSignal.timeout(HTTP_TIMEOUT) })
      if (res.status === 401) return { loggedIn: true, expired: true, username: settings.username }
      if (res.ok) {
        const data = await res.json() as { ok?: boolean; packs?: unknown; mine?: unknown; balance?: unknown }
        if (data.ok === true) {
          out.balance = typeof data.balance === 'number' ? data.balance : undefined
          out.catalog = Array.isArray(data.packs)
            ? data.packs.map((raw) => raw as { key: string; name: string; ico: string; days: number }).filter((p) => p && typeof p.key === 'string')
            : []
          out.mine = Array.isArray(data.mine)
            ? data.mine.map((raw) => {
                const m = raw as Record<string, unknown>
                return {
                  packKey: typeof m.packKey === 'string' ? m.packKey : '',
                  gemsTotal: typeof m.gemsTotal === 'number' ? m.gemsTotal : 0,
                  gemsLeft: typeof m.gemsLeft === 'number' ? m.gemsLeft : 0,
                  active: m.active === true,
                  activatedAt: typeof m.activatedAt === 'string' ? m.activatedAt : undefined,
                  expiresAt: typeof m.expiresAt === 'string' ? m.expiresAt : undefined,
                }
              }).filter((m) => m.packKey !== '')
            : []
        }
      }
    } catch {
      // 网络失败：套餐字段留空，不标记会话失效（与 status 同语义）
    }
    // 搜索折算（独立容错：失败不影响套餐行）
    try {
      const res = await fetch(SITE + '/api/search/quota', { headers, signal: AbortSignal.timeout(HTTP_TIMEOUT) })
      if (res.ok) {
        const data = await res.json() as { ok?: boolean; costPerSearch?: unknown; searchesLeft?: unknown }
        if (data.ok === true) {
          out.costPerSearch = typeof data.costPerSearch === 'number' ? data.costPerSearch : undefined
          out.searchesLeft = typeof data.searchesLeft === 'number' ? data.searchesLeft : undefined
        }
      }
    } catch {
      // 静默：搜索次数行不渲染
    }
    return out
  }

  /** 组合状态视图（实时到官网校验令牌有效性）。 */
  async status(): Promise<ModagentaiStatus> {
    const settings = this.readSettings()
    const token = await this.readToken()
    const loggedIn = settings.username !== '' && token !== ''
    let expired = false
    if (loggedIn) {
      try {
        const res = await fetch(SITE + '/api/auth/me', {
          headers: { authorization: 'Bearer ' + token, 'user-agent': 'DeepSeek-Harness/1.0' },
          signal: AbortSignal.timeout(HTTP_TIMEOUT),
        })
        if (res.status === 401) expired = true
      } catch {
        // 网络不通不代表令牌失效，不标记过期
      }
    }
    return {
      loggedIn,
      username: settings.username,
      role: loggedIn ? (settings.role === 'admin' ? 'admin' : 'user') : '',
      expired,
      autoApplied: settings.autoApplied,
      appliedModels: settings.appliedModels,
    }
  }

  /**
   * 登录官网账号：用户名密码 → 会话 Cookie → 兑换显式令牌 → 存受管凭据 → 自动配置中转。
   * 登录成功但中转配置失败时不吞结果：返回 gatewayApplied=false 与原因，用户可手动重试。
   */
  async login(input: { username: unknown; password: unknown }): Promise<ModagentaiLoginResult> {
    const username = typeof input.username === 'string' ? input.username.trim() : ''
    const password = typeof input.password === 'string' ? input.password : ''
    if (username === '' || password === '') throw new ModagentaiServiceError('请输入用户名和密码。', 400)
    if (password.length > 512) throw new ModagentaiServiceError('密码长度异常。', 400)

    // ① 登录拿会话 Cookie（HttpOnly 的 sid）
    let sid = ''
    let siteUser: { username?: unknown; role?: unknown } | undefined
    try {
      const res = await fetch(SITE + '/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'user-agent': 'DeepSeek-Harness/1.0' },
        body: JSON.stringify({ username, password }),
        signal: AbortSignal.timeout(HTTP_TIMEOUT),
      })
      const payload = (await res.json().catch(() => null)) as { ok?: boolean; error?: unknown; user?: { username?: unknown; role?: unknown } } | null
      if (res.status === 429) throw new ModagentaiServiceError('尝试过于频繁，请稍后再试。', 429)
      if (res.status === 403 && payload !== null && typeof payload.error === 'string') throw new ModagentaiServiceError(payload.error, 403)
      if (!res.ok || payload?.ok !== true || payload.user === null || typeof payload.user !== 'object') {
        throw new ModagentaiServiceError('用户名或密码错误。', 401)
      }
      siteUser = payload.user
      const setCookie = res.headers.get('set-cookie') ?? ''
      const match = /(?:^|[,;]\s*)sid=([^;,\s]+)/.exec(setCookie)
      if (match === null) throw new ModagentaiServiceError('官网未返回会话，请稍后重试。', 502)
      sid = match[1]
    } catch (error) {
      if (error instanceof ModagentaiServiceError) throw error
      throw new ModagentaiServiceError('官网连接失败：' + (error instanceof Error ? error.message : String(error)), 502)
    }

    // ② 用会话 Cookie 兑换显式令牌（即中转 API Key）
    let token = ''
    try {
      const res = await fetch(SITE + '/api/download-token', {
        method: 'POST',
        headers: { cookie: 'sid=' + sid, 'user-agent': 'DeepSeek-Harness/1.0' },
        signal: AbortSignal.timeout(HTTP_TIMEOUT),
      })
      const payload = (await res.json().catch(() => null)) as { ok?: boolean; token?: unknown } | null
      if (!res.ok || payload?.ok !== true || typeof payload.token !== 'string' || payload.token.trim() === '') {
        throw new ModagentaiServiceError('会话令牌签发失败，请稍后重试。', 502)
      }
      token = payload.token.trim()
    } catch (error) {
      if (error instanceof ModagentaiServiceError) throw error
      throw new ModagentaiServiceError('会话令牌签发失败：' + (error instanceof Error ? error.message : String(error)), 502)
    }

    // ③ 令牌进受管凭据 + 账号信息进 store.db
    await this.ctx.credentials.set(credentialRef(MODAGENTAI_SESSION_REF), token)
    const role = siteUser?.role === 'admin' ? 'admin' : 'user'
    const displayName = typeof siteUser?.username === 'string' && siteUser.username !== '' ? siteUser.username : username
    const settings: ModagentaiAccountSettings = { username: displayName, role, autoApplied: false, appliedModels: 0, appliedAt: Date.now() }
    this.writeSettings(settings)

    // ④ 登录即自动配置中转（失败不回滚登录，用户可手动重试）
    let gatewayApplied = false
    let gatewayModels = 0
    let applyMessage = ''
    try {
      const applied = await this.applyGateway()
      gatewayApplied = true
      gatewayModels = applied.appliedModels
      applyMessage = '已自动配置中转（GLM-Flash）'
    } catch (error) {
      applyMessage = '中转自动配置失败：' + (error instanceof Error ? error.message : String(error)) + '（可在个人中心点「重新配置中转」重试）'
    }

    const status = await this.status()
    return { status, gatewayApplied, gatewayModels, message: applyMessage }
  }

  /** 退出登录：尽力通知官网吊销会话，清空本机令牌与账号信息。 */
  async logout(): Promise<ModagentaiStatus> {
    const token = await this.readToken()
    if (token !== '') {
      try {
        await fetch(SITE + '/api/auth/logout', {
          method: 'POST',
          headers: { authorization: 'Bearer ' + token, 'user-agent': 'DeepSeek-Harness/1.0' },
          signal: AbortSignal.timeout(HTTP_TIMEOUT),
        })
      } catch {
        // 官网不可达也照常本地登出
      }
    }
    await this.ctx.credentials.unset(credentialRef(MODAGENTAI_SESSION_REF))
    // 同步停用天工造梦模型路由与端点密钥（重新登录即自动恢复）
    try { await this.writeTiangongProvider(true) } catch { /* 宿主段未就绪也照常登出 */ }
    try { await this.ctx.credentials.unset(credentialRef(MODAGENTAI_GW_KEY_REF)) } catch { /* 密钥本就不存在 */ }
    this.writeSettings({ ...EMPTY_SETTINGS })
    return await this.status()
  }

  /**
   * 自动配置天工造梦模型路由：写端点密钥 → 直写 llm-pi-ai 段注册 tiangong 原生 provider
   * （openai-completions 协议，GLM-Flash）→ 清理旧 OpenAI 中转体系残留。
   */
  async applyGateway(): Promise<ModagentaiStatus> {
    const token = await this.readToken()
    if (token === '') throw new ModagentaiServiceError('尚未登录官网账号。', 401)
    await this.ctx.credentials.set(credentialRef(MODAGENTAI_GW_KEY_REF), token)
    await this.writeTiangongProvider(false)
    try {
      await this.openai.removeEndpoint(MODAGENTAI_ENDPOINT_ID)
    } catch (error) {
      // 旧体系清理失败不阻断主流程（provider 已由 tiangong 接管）
      this.ctx.logger?.warn?.('[dsh-devforge] 旧中转端点清理失败（不影响使用）：%s', error instanceof Error ? error.message : String(error))
    }
    const settings = this.readSettings()
    this.writeSettings({ ...settings, autoApplied: true, appliedModels: 1 })
    return await this.status()
  }

  /**
   * 启动自愈：检测到旧 OpenAI 中转体系残留（openai-gateway-modagentai）且用户已登录时，
   * 自动迁移到 tiangong 原生 provider。幂等：无残留或未登录时不做任何写入。
   * 供启动自动补齐调度调用（llm-pi-ai 未就绪时抛错，由调度重试）。
   */
  async migrateLegacyGateway(): Promise<void> {
    const descriptor = this.ctx.settings.describe().find((item) => item.ns === LLM_PI_AI_NAMESPACE)
    if (descriptor === undefined) throw new ModagentaiServiceError('DSH 模型设置服务尚未注册 llm-pi-ai。', 409)
    const section = descriptor.value as { providers?: Record<string, unknown> } | undefined
    const providers = section?.providers ?? {}
    // 旧中转残留需要迁移；已注册的 tiangong 声明若档位落后（缺 xhigh/max）同样要刷新。
    const hasLegacy = providers[LEGACY_GATEWAY_PROVIDER_ID] !== undefined
    if (!hasLegacy && !tiangongEffortsOutdated(providers[TIANGONG_PROVIDER_ID])) return
    const token = await this.readToken()
    if (token === '') return
    this.ctx.logger?.info?.(hasLegacy
      ? '[dsh-devforge] 检测到旧中转路由，自动迁移到天工造梦原生 provider'
      : '[dsh-devforge] 天工造梦模型声明档位落后，自动刷新为五档（含 xhigh/max）')
    await this.applyGateway()
  }

  /** 直写 llm-pi-ai 段：注册/移除 tiangong 原生 provider，并清理旧 openai-gateway- 前缀路由。 */
  private async writeTiangongProvider(remove: boolean): Promise<void> {    for (let attempt = 0; attempt < 2; attempt += 1) {
      const descriptor = this.ctx.settings.describe().find((item) => item.ns === LLM_PI_AI_NAMESPACE)
      if (descriptor === undefined) throw new ModagentaiServiceError('DSH 模型设置服务尚未注册 llm-pi-ai。', 409)
      const current = descriptor.value as { providers?: Record<string, unknown> } | undefined
      const providers = current?.providers ?? {}
      const mutations: SettingsMutation[] = []
      if (remove) {
        if (providers[TIANGONG_PROVIDER_ID] !== undefined) mutations.push({ op: 'unset', path: ['providers', TIANGONG_PROVIDER_ID] })
      } else if (!deepEqualJson(TIANGONG_PROVIDER, providers[TIANGONG_PROVIDER_ID])) {
        mutations.push({ op: 'set', path: ['providers', TIANGONG_PROVIDER_ID], value: TIANGONG_PROVIDER })
      }
      if (providers[LEGACY_GATEWAY_PROVIDER_ID] !== undefined) mutations.push({ op: 'unset', path: ['providers', LEGACY_GATEWAY_PROVIDER_ID] })
      if (mutations.length === 0) return
      try {
        await this.ctx.settings.mutate(LLM_PI_AI_NAMESPACE, mutations, descriptor.revision)
        return
      } catch (error) {
        if (error instanceof SettingsConflictError && attempt === 0) continue
        throw error
      }
    }
  }
}

