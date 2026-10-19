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
import { MODAGENTAI_ENDPOINT_ID, MODAGENTAI_GW_ANTHROPIC_BASE, MODAGENTAI_GW_KEY_REF, MODAGENTAI_SESSION_REF, MODAGENTAI_SITE, type ModagentaiLoginResult, type ModagentaiPackages, type ModagentaiProfile, type ModagentaiSearchResult, type ModagentaiStatus } from './protocol.ts'
import { buildTiangongModels, parseTiangongCatalog, parseTiangongCatalogImages, tiangongCatalogOutdated, tiangongDeclarationOutdated, TIANGONG_CONTEXT_WINDOW, TIANGONG_DEEPSEEK_EFFORTS, TIANGONG_DEEPSEEK_MODEL_ID, TIANGONG_KIMI_EFFORTS, TIANGONG_KIMI_MODEL_ID, TIANGONG_PROTOCOL, TIANGONG_REASONING_EFFORTS, type TiangongCatalogEntry } from './provider-declaration.ts'
import type { OpenAiGatewayService } from '../openai/service.ts'

/** llm-pi-ai 宿主段命名空间（DSH 模型路由体系）。 */
const LLM_PI_AI_NAMESPACE = settingsNamespace('llm-pi-ai')
/** 天工造梦原生 provider id（模型切换行显示 tiangong/GLM-Flash）。 */
const TIANGONG_PROVIDER_ID = 'tiangong'
/** 旧 OpenAI 中转体系生成的 provider id（迁移时清理）。 */
const LEGACY_GATEWAY_PROVIDER_ID = 'openai-gateway-modagentai'

/**
 * 内置兜底模型清单（GLM-Flash + DeepSeek V4.1 Flash + Kimi-K3）。
 * 站点目录（GET /api/gw/model-catalog）可用时以站点为准，不可用（未登录/断网/改版）时用本清单，
 * 保证任何情况下三个官方模型都声明得出来。
 */
const TIANGONG_BUILTIN_MODELS: Record<string, unknown>[] = [{
  id: 'GLM-Flash',
  name: 'GLM-Flash',
  contextWindow: TIANGONG_CONTEXT_WINDOW,
  input: ['text', 'image'],
  reasoningEfforts: TIANGONG_REASONING_EFFORTS,
}, {
  // DeepSeek V4.1 Flash：上游 deepseek-v4-1-flash-260910；上下文按辉哥 2026-10-19 定稿声明 300K（上游实为 1M，仍不满额声明以防长上下文高消耗）。
  // 2026-09-27 实测上游支持图像输入（发图识别颜色正常），input 必须带 image，否则 DSH 发送前剥图。
  id: TIANGONG_DEEPSEEK_MODEL_ID,
  name: TIANGONG_DEEPSEEK_MODEL_ID,
  contextWindow: TIANGONG_CONTEXT_WINDOW,
  input: ['text', 'image'],
  reasoningEfforts: TIANGONG_DEEPSEEK_EFFORTS,
}, {
  // Kimi-K3（2026-10-12 辉哥要求对外提供）：站点 GATEWAY_MODEL_MAP 同名透传，
  // 再由 ark-gateway 的 workbuddy 池映射为上游 cn:kimi-k3-1。
  // 官方原生 1M 上下文，声明侧按惯例低报 300K；图像与思考档位按「与 DeepSeek 同档」处理。
  id: TIANGONG_KIMI_MODEL_ID,
  name: TIANGONG_KIMI_MODEL_ID,
  contextWindow: TIANGONG_CONTEXT_WINDOW,
  input: ['text', 'image'],
  reasoningEfforts: TIANGONG_KIMI_EFFORTS,
}]

/**
 * 天工造梦原生 provider 声明模板（models 由 buildTiangongProvider 注入）。
 * 2026-10-18 起改为 Anthropic Messages 协议（官网 /api/gw/v1/messages）：
 * 与 OpenAI 端点相比，anthropic 适配器支持 adaptive thinking 与更长的流空闲超时，
 * 长推理任务更稳；官网 OpenAI 端点保留作回退，两条协议共用同一套白名单与计费。
 * 上下文窗口取 provider-declaration 的 TIANGONG_CONTEXT_WINDOW（辉哥 2026-10-19 定稿 300K）；
 * 插件升级或官网调整模型后，由 migrateLegacyGateway 的启动自愈自动改写声明。
 */
const TIANGONG_PROVIDER_SHELL: Record<string, unknown> = {
  apiKeyEnv: MODAGENTAI_GW_KEY_REF,
  displayName: '天工造梦',
  api: TIANGONG_PROTOCOL,
  baseURL: MODAGENTAI_GW_ANTHROPIC_BASE,
  defaultContextWindow: TIANGONG_CONTEXT_WINDOW,
  defaultMaxTokens: 32768,
  defaultInput: ['text', 'image'],
  // Anthropic 通道首字节可能较慢，空闲超时比 OpenAI 端点放宽，避免长推理被误判超时后循环重试
  streamIdleTimeoutMs: 600_000,
  retryPolicy: {
    mode: 'normal',
    maxRetries: 5,
    retryableCodes: ['RATE_LIMIT', 'SERVER', 'TIMEOUT', 'TRANSPORT', 'EMPTY_RESPONSE'],
    backoff: { initialDelayMs: 1000, maxDelayMs: 120000, jitterRatio: 0.2 },
  },
}

/**
 * 组装 tiangong provider 声明：站点目录里的模型按站点下发的能力落地，
 * 站点未下发的内置模型由内置条目补齐。
 * @param catalog 站点下发的模型目录；为空数组表示未登录或站点不可达（退化为纯内置清单）
 */
function buildTiangongProvider(catalog: readonly TiangongCatalogEntry[]): Record<string, unknown> {
  return { ...TIANGONG_PROVIDER_SHELL, models: buildTiangongModels(catalog, TIANGONG_BUILTIN_MODELS) }
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
  /** 官网搜索工具启停（辉哥定稿：扣钻石工具可一键停用；缺省启用，旧数据无字段视为开）。 */
  webSearchEnabled: boolean
}

const EMPTY_SETTINGS: ModagentaiAccountSettings = { username: '', role: '', autoApplied: false, appliedModels: 0, appliedAt: 0, webSearchEnabled: true }
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
      webSearchEnabled: raw.webSearchEnabled !== false,
    }
  }

  /** 原子写回账号会话信息。 */
  private writeSettings(next: ModagentaiAccountSettings): void {
    putSettings(getDb(), SETTINGS_KEY, next)
  }

  /** 官网搜索工具是否启用（工具注册与执行双重检查的数据源；缺省启用）。 */
  isWebSearchEnabled(): boolean {
    return this.readSettings().webSearchEnabled
  }

  /** 设置官网搜索工具启停（面板开关；保存即时生效，无需重启）。 */
  setWebSearchEnabled(next: boolean): void {
    this.writeSettings({ ...this.readSettings(), webSearchEnabled: next })
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

  /** 面板官网登录态出口（0.40.1）：插件更新等能力复用同一份会话令牌，免重复配账号。 */
  async readSessionToken(): Promise<string> {
    return await this.readToken()
  }

  /**
   * 拉取站点模型目录（GET /api/gw/model-catalog）：官网当前开放的模型及其能力元数据。
   *
   * 这是「已登录账号自动同步官方模型」的数据源（辉哥 2026-10-12 定稿）：以后官网新增或调整模型
   * 只改站点配置，插件在启动与登录时拉一次即可自动跟上，不必再走「改插件 → 升版本 → 用户升级」。
   *
   * 令牌为空、网络失败、HTTP 非 2xx 或结构不符，一律返回空数组，由内置清单兜底——
   * 同步失败绝不允许阻断登录或启动流程。
   * @param token 会话令牌；省略时读本机受管凭据
   * @returns 规整后的模型目录（失败为空数组）
   */
  async fetchOfficialCatalog(token?: string): Promise<TiangongCatalogEntry[]> {
    const value = token ?? await this.readToken()
    if (value === '') return []
    try {
      const res = await fetch(SITE + '/api/gw/model-catalog', {
        headers: { authorization: 'Bearer ' + value, 'user-agent': 'DeepSeek-Harness/1.0' },
        signal: AbortSignal.timeout(HTTP_TIMEOUT),
      })
      if (!res.ok) return []
      return parseTiangongCatalog(await res.json().catch(() => null))
    } catch {
      return []
    }
  }

  /**
   * 拉取官网站点目录里的生图模型清单（GET /api/gw/model-catalog 的 data.images）。
   * 与 fetchOfficialCatalog 同规矩：令牌为空、网络失败、HTTP 非 2xx 或结构不符一律返回空数组，
   * 由调用方保留已有生图线路配置，绝不让同步失败影响登录或启动。
   */
  async fetchOfficialImageModels(token?: string): Promise<string[]> {
    const value = token ?? await this.readToken()
    if (value === '') return []
    try {
      const res = await fetch(SITE + '/api/gw/model-catalog', {
        headers: { authorization: 'Bearer ' + value, 'user-agent': 'DeepSeek-Harness/1.0' },
        signal: AbortSignal.timeout(HTTP_TIMEOUT),
      })
      if (!res.ok) return []
      return parseTiangongCatalogImages(await res.json().catch(() => null))
    } catch {
      return []
    }
  }

  /**
   * 把官网生图线路接入 generate_image（辉哥 2026-10-14 定稿）。
   *
   * 官网生图不占用 OpenAI 中转端点列表，也不写 llm-pi-ai provider 路由：只在 openai 能力配置里
   * 记「启用 + 站点下发的生图模型」，由 generateImage 直连官网网关 /v1/images/generations 按张扣钻石。
   * 未登录抛 401；目录拉不到模型名时保留原模型，绝不把配置写空。
   */
  async applySiteImage(): Promise<{ enabled: boolean; model: string }> {
    const token = await this.readToken()
    if (token === '') throw new ModagentaiServiceError('尚未登录官网账号。', 401)
    const images = await this.fetchOfficialImageModels(token)
    const status = await this.openai.setSiteImage({ enabled: true, ...(images.length > 0 ? { model: images[0] } : {}) })
    return status.siteImage ?? { enabled: true, model: '' }
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
                // expires_at 未激活/永不过期时官网是 timestamptz 'infinity'，别当日期透传给面板。
                const expires = typeof m.expiresAt === 'string' && m.expiresAt !== '' && m.expiresAt !== 'infinity' ? m.expiresAt : undefined
                // id 是 PG bigint：官网实测返回字符串（'17'），数值形态也一并接住，统一转字符串。
                const packId = typeof m.id === 'number' || typeof m.id === 'string' ? String(m.id) : ''
                return {
                  ...(packId === '' ? {} : { id: packId }),
                  packKey: typeof m.packKey === 'string' ? m.packKey : '',
                  gemsTotal: typeof m.gemsTotal === 'number' ? m.gemsTotal : 0,
                  gemsLeft: typeof m.gemsLeft === 'number' ? m.gemsLeft : 0,
                  active: m.active === true,
                  activatedAt: typeof m.activatedAt === 'string' ? m.activatedAt : undefined,
                  ...(expires === undefined ? {} : { expiresAt: expires }),
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

  /**
   * 官网联网搜索（辉哥 2026-09-23 定稿：开放给会话模型当搜索工具）。
   * 服务端多渠道自动切换（Tavily 主力/智谱备用/方舟兜底），按次扣钻石，
   * 搜索成功才扣费；未登录/会话失效 401，余额不足 402，限频 429。
   */
  async webSearch(query: string): Promise<ModagentaiSearchResult> {
    const settings = this.readSettings()
    const token = await this.readToken()
    if (settings.username === '' || token === '') throw new ModagentaiServiceError('未登录官网账号，请先在个人中心登录', 401)
    const res = await fetch(SITE + '/api/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token, 'user-agent': 'DeepSeek-Harness/1.0' },
      body: JSON.stringify({ query: query.trim().slice(0, 400) }),
      signal: AbortSignal.timeout(HTTP_TIMEOUT),
    }).catch((error: unknown) => {
      throw new ModagentaiServiceError('官网搜索网络失败：' + (error instanceof Error ? error.message : String(error)), 504)
    })
    if (res.status === 401) throw new ModagentaiServiceError('官网会话已失效，请在个人中心重新登录', 401)
    const data = await res.json().catch(() => ({}) as Record<string, unknown>)
    const body = (data ?? {}) as Record<string, unknown>
    if (!res.ok || body.ok !== true) {
      const nested = body.error as { message?: unknown } | undefined
      const message = typeof nested?.message === 'string' && nested.message !== '' ? nested.message
        : typeof body.message === 'string' && body.message !== '' ? body.message
        : 'HTTP ' + res.status
      throw new ModagentaiServiceError('官网搜索失败：' + message, res.status)
    }
    const hits = Array.isArray(body.results) ? body.results : []
    return {
      answer: typeof body.answer === 'string' ? body.answer : '',
      results: hits.map((raw) => {
        const hit = raw as Record<string, unknown>
        return { title: String(hit.title ?? ''), url: String(hit.url ?? ''), content: String(hit.content ?? '') }
      }).filter((hit) => hit.url !== ''),
      ...(typeof body.balance === 'number' ? { balance: body.balance } : {}),
      ...(typeof body.searchesLeft === 'number' ? { searchesLeft: body.searchesLeft } : {}),
      ...(typeof body.took === 'number' ? { took: body.took } : {}),
    }
  }

  /**
   * 搜索余量（辉哥定稿：GET /api/search/quota，余额折算剩余次数；不扣费）。
   * 未登录/会话失效 401；官网返回字段防御式规整。
   */
  async searchQuota(): Promise<{ balance: number | null; costPerSearch: number | null; searchesLeft: number | null }> {
    const settings = this.readSettings()
    const token = await this.readToken()
    if (settings.username === '' || token === '') throw new ModagentaiServiceError('未登录官网账号，请先在个人中心登录', 401)
    const res = await fetch(SITE + '/api/search/quota', {
      headers: { authorization: 'Bearer ' + token, 'user-agent': 'DeepSeek-Harness/1.0' },
      signal: AbortSignal.timeout(HTTP_TIMEOUT),
    }).catch((error: unknown) => {
      throw new ModagentaiServiceError('搜索余量查询网络失败：' + (error instanceof Error ? error.message : String(error)), 504)
    })
    if (res.status === 401) throw new ModagentaiServiceError('官网会话已失效，请在个人中心重新登录', 401)
    const data = (await res.json().catch(() => ({}) as Record<string, unknown>)) as Record<string, unknown>
    if (!res.ok || data.ok !== true) throw new ModagentaiServiceError('搜索余量查询失败：HTTP ' + res.status, res.status)
    return {
      balance: typeof data.balance === 'number' ? data.balance : null,
      costPerSearch: typeof data.costPerSearch === 'number' ? data.costPerSearch : null,
      searchesLeft: typeof data.searchesLeft === 'number' ? data.searchesLeft : null,
    }
  }

  /**
   * 官网用户资料（辉哥 2026-09-23 定稿）：个人中心身份卡数据源。
   * 未登录短路径返回；401 标记会话失效；网络异常返回基础形态不标 expired（对齐 packages() 容错语义）。
   */
  async profile(): Promise<ModagentaiProfile> {
    const settings = this.readSettings()
    const token = await this.readToken()
    if (settings.username === '' || token === '') return { loggedIn: false, username: '', role: '' }
    try {
      const res = await fetch(SITE + '/api/auth/profile', {
        headers: { authorization: 'Bearer ' + token, 'user-agent': 'DeepSeek-Harness/1.0' },
        signal: AbortSignal.timeout(HTTP_TIMEOUT),
      })
      if (res.status === 401) return { loggedIn: true, expired: true, username: settings.username, role: settings.role }
      if (res.ok) {
        const data = (await res.json().catch(() => null)) as { ok?: boolean; profile?: Record<string, unknown> } | null
        if (data?.ok === true && data.profile !== null && typeof data.profile === 'object') {
          const raw = data.profile
          return {
            loggedIn: true,
            username: settings.username,
            role: settings.role,
            avatar: typeof raw.avatar === 'string' ? raw.avatar : undefined,
            gender: typeof raw.gender === 'string' ? raw.gender : undefined,
            birthday: typeof raw.birthday === 'string' ? raw.birthday : undefined,
          }
        }
      }
    } catch {
      // 网络失败：返回基础形态，不标记会话失效（与 packages()/status() 同语义）
    }
    return { loggedIn: true, username: settings.username, role: settings.role }
  }

  /**
   * 保存官网用户资料（头像/性别/生日，辉哥 2026-09-23 定稿）。
   * patch 只收 string 字段（avatar 为 dataURL，官网限 150KB，客户端预检 base64 长度上限；
   * 空串表示清空对应字段）。401 抛会话失效，其余失败按 HTTP 语义抛 ModagentaiServiceError。
   */
  async updateProfile(patch: { avatar?: unknown; gender?: unknown; birthday?: unknown }): Promise<ModagentaiProfile> {
    const token = await this.readToken()
    if (token === '') throw new ModagentaiServiceError('尚未登录官网账号。', 401)
    const body: Record<string, string> = {}
    for (const key of ['avatar', 'gender', 'birthday'] as const) {
      const value = patch[key]
      if (typeof value === 'string') body[key] = value
    }
    // 150KB base64 ≈ 210000 字符，超限直接拒绝，不打官网
    if (typeof body.avatar === 'string' && body.avatar.length > 210_000) {
      throw new ModagentaiServiceError('头像过大，请更换图片后重试。', 400)
    }
    const settings = this.readSettings()
    let res: Response
    try {
      res = await fetch(SITE + '/api/auth/profile', {
        method: 'POST',
        headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json', 'user-agent': 'DeepSeek-Harness/1.0' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(HTTP_TIMEOUT),
      })
    } catch (error) {
      throw new ModagentaiServiceError('官网连接失败：' + (error instanceof Error ? error.message : String(error)), 502)
    }
    if (res.status === 401) throw new ModagentaiServiceError('官网会话已失效，请重新登录。', 401)
    const payload = (await res.json().catch(() => null)) as { ok?: boolean; error?: unknown; profile?: Record<string, unknown> } | null
    if (!res.ok || payload?.ok !== true) {
      const status = res.ok ? 502 : (res.status >= 400 ? res.status : 400)
      throw new ModagentaiServiceError(typeof payload?.error === 'string' && payload.error !== '' ? payload.error : '资料保存失败，请稍后重试。', status)
    }
    const raw = payload.profile !== null && typeof payload.profile === 'object' ? payload.profile : {}
    return {
      loggedIn: true,
      username: settings.username,
      role: settings.role,
      avatar: typeof raw.avatar === 'string' ? raw.avatar : undefined,
      gender: typeof raw.gender === 'string' ? raw.gender : undefined,
      birthday: typeof raw.birthday === 'string' ? raw.birthday : undefined,
    }
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
    const settings: ModagentaiAccountSettings = { username: displayName, role, autoApplied: false, appliedModels: 0, appliedAt: Date.now(), webSearchEnabled: this.isWebSearchEnabled() }
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
    // 停用官网生图线路（保留模型名，重新登录 applyGateway 即自动恢复）
    try { await this.openai.setSiteImage({ enabled: false }) } catch { /* 宿主段未就绪也照常登出 */ }
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
    // 官网生图线路：登录即接入 generate_image（拉目录拿最新生图模型；失败不阻断中转配置）
    try {
      const images = await this.fetchOfficialImageModels(token)
      await this.openai.setSiteImage({ enabled: true, ...(images.length > 0 ? { model: images[0] } : {}) })
    } catch (error) {
      this.ctx.logger?.warn?.('[dsh-devforge] 官网生图线路接入失败（不影响中转）：%s', error instanceof Error ? error.message : String(error))
    }
    const settings = this.readSettings()
    this.writeSettings({ ...settings, autoApplied: true, appliedModels: 1 })
    return await this.status()
  }

  /**
   * 启动自愈：检测到旧 OpenAI 中转体系残留（openai-gateway-modagentai）且用户已登录时，
   * 自动迁移到 tiangong 原生 provider；已注册的 tiangong 声明落后于官网目录
   * （缺模型条目 / 档位缺 xhigh·max / 缺看图声明 / 上下文容量不符）时自动改写为新版声明——
   * 已安装插件升级、或官网新增与调整模型后，都无需手动重登或重配，重启 DSH 即自动校正。
   * 幂等：无残留、声明无变化或未登录时不做任何写入。
   * 供启动自动补齐调度调用（llm-pi-ai 未就绪时抛错，由调度重试）。
   */
  async migrateLegacyGateway(): Promise<void> {
    const descriptor = this.ctx.settings.describe().find((item) => item.ns === LLM_PI_AI_NAMESPACE)
    if (descriptor === undefined) throw new ModagentaiServiceError('DSH 模型设置服务尚未注册 llm-pi-ai。', 409)
    const section = descriptor.value as { providers?: Record<string, unknown> } | undefined
    const providers = section?.providers ?? {}
    const token = await this.readToken()
    // 已登录才拉站点目录；未登录退化为内置清单判定（仍能校正历史遗留的旧声明）。
    // 有站点目录时以站点为准：官网新增模型、调整窗口或档位，重启即自动跟上（辉哥 2026-10-12 定稿）。
    const catalog = token === '' ? [] : await this.fetchOfficialCatalog(token)
    const provider = providers[TIANGONG_PROVIDER_ID]
    const outdated = (catalog.length > 0
      ? tiangongDeclarationOutdated(provider, catalog.map((entry) => entry.id))
      : tiangongDeclarationOutdated(provider))
      || tiangongCatalogOutdated(provider, catalog)
    // 旧中转残留需要迁移；声明落后同样要刷新。
    const hasLegacy = providers[LEGACY_GATEWAY_PROVIDER_ID] !== undefined
    if (!hasLegacy && !outdated) return
    if (token === '') return
    this.ctx.logger?.info?.(hasLegacy
      ? '[dsh-devforge] 检测到旧中转路由，自动迁移到天工造梦原生 provider'
      : '[dsh-devforge] 天工造梦模型声明落后于官网目录，自动刷新（补齐档位 / 新增模型 / 同步上下文）')
    await this.applyGateway()
  }

  /** 直写 llm-pi-ai 段：注册/移除 tiangong 原生 provider，并清理旧 openai-gateway- 前缀路由。 */
  private async writeTiangongProvider(remove: boolean): Promise<void> {
    // 站点目录只在「需要写入」时拉一次：登出（remove）不拉，避免用户已登出还打官网。
    // 拉取失败退化为内置清单，因此断网时写入的仍是可用的三模型声明。
    const catalog = remove ? [] : await this.fetchOfficialCatalog(await this.readToken())
    const desired = buildTiangongProvider(catalog)
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const descriptor = this.ctx.settings.describe().find((item) => item.ns === LLM_PI_AI_NAMESPACE)
      if (descriptor === undefined) throw new ModagentaiServiceError('DSH 模型设置服务尚未注册 llm-pi-ai。', 409)
      const current = descriptor.value as { providers?: Record<string, unknown> } | undefined
      const providers = current?.providers ?? {}
      const mutations: SettingsMutation[] = []
      if (remove) {
        if (providers[TIANGONG_PROVIDER_ID] !== undefined) mutations.push({ op: 'unset', path: ['providers', TIANGONG_PROVIDER_ID] })
      } else if (!deepEqualJson(desired, providers[TIANGONG_PROVIDER_ID])) {
        mutations.push({ op: 'set', path: ['providers', TIANGONG_PROVIDER_ID], value: desired })
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

