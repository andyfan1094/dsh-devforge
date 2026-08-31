/** 火山方舟 Agent Plan 服务：数据面模型路由与控制面套餐用量。 */
import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { SettingsConflictError, settingsNamespace } from '@deepseek-ai/dsh-settings'
import type { ArkStatus, ArkUsageCredentialsResult, ArkUsageDashboard } from './protocol.ts'
import { fetchArkPlanUsage } from './usage.ts'

const LLM_PI_AI_NAMESPACE = settingsNamespace('llm-pi-ai')
const ARK_USAGE_CACHE_TTL_MS = 5 * 60 * 1000
const ARK_REGION = 'cn-beijing'
const DEFAULT_USAGE_ACCESS_KEY_ENV = 'VOLC_ACCESS_KEY'
const DEFAULT_USAGE_SECRET_KEY_ENV = 'VOLC_SECRET_KEY'
const DEFAULT_USAGE_TIMEOUT_MS = 15_000

/** Agent Plan 的 OpenAI / Responses 官方 Base URL，不能换为普通 /api/v3。 */
export const ARK_PLAN_BASE_URL = 'https://ark.cn-beijing.volces.com/api/plan/v3'
export const ARK_PROVIDER_ID = 'volcengine-ark-plan'

/** 大多数方舟思考模型支持的五档推理强度。 */
const FIVE_TIER_REASONING = { low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' } as const
/** Kimi K3 的 Agent Plan 档位以网关实际支持的精简集合为准。 */
const KIMI_REASONING = { off: null, low: 'low', high: 'high', max: 'max' } as const
/** Kimi Code 在 completions 协议下只提供思考开关。 */
const KIMI_CODE_REASONING = { off: null, high: 'high' } as const

/**
 * Agent Plan 官方文本模型池。
 * 清单与长度限制来自火山方舟“Agent Plan 个人版 / 套餐概览”；推理档位来自方舟网关实测映射。
 */
export const ARK_DEFAULT_MODELS = [
  { id: 'auto', name: 'Auto', contextWindow: 1_000_000, maxTokens: 131_072, input: ['text', 'image'], reasoningEfforts: FIVE_TIER_REASONING },
  { id: 'doubao-seed-evolving', name: 'Doubao-Seed-Evolving', contextWindow: 1_000_000, maxTokens: 262_144, input: ['text'], reasoningEfforts: FIVE_TIER_REASONING },
  { id: 'doubao-seed-2.1-turbo', name: 'Doubao-Seed-2.1-turbo', contextWindow: 262_144, maxTokens: 262_144, input: ['text', 'image'], reasoningEfforts: FIVE_TIER_REASONING },
  { id: 'doubao-seed-2.0-lite', name: 'Doubao-Seed-2.0-lite', contextWindow: 262_144, maxTokens: 131_072, input: ['text'], reasoningEfforts: FIVE_TIER_REASONING },
  { id: 'doubao-seed-2.0-mini', name: 'Doubao-Seed-2.0-mini', contextWindow: 262_144, maxTokens: 131_072, input: ['text'], reasoningEfforts: FIVE_TIER_REASONING },
  { id: 'glm-5.3-flash', name: 'GLM-5.3-Flash', contextWindow: 1_000_000, maxTokens: 131_072, input: ['text', 'image'], reasoningEfforts: FIVE_TIER_REASONING },
  { id: 'glm-5.3', name: 'GLM-5.3', contextWindow: 1_000_000, maxTokens: 131_072, input: ['text'], reasoningEfforts: FIVE_TIER_REASONING },
  { id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro', contextWindow: 1_000_000, maxTokens: 393_216, input: ['text'], reasoningEfforts: FIVE_TIER_REASONING },
  { id: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash', contextWindow: 1_000_000, maxTokens: 393_216, input: ['text'], reasoningEfforts: FIVE_TIER_REASONING },
  { id: 'kimi-k3', name: 'Kimi-K3', contextWindow: 1_000_000, maxTokens: 131_072, input: ['text', 'image'], reasoningEfforts: KIMI_REASONING },
  { id: 'minimax-m3', name: 'MiniMax-M3', contextWindow: 1_000_000, maxTokens: 131_072, input: ['text', 'image'], reasoningEfforts: FIVE_TIER_REASONING },
  { id: 'glm-5.2', name: 'GLM-5.2', contextWindow: 1_000_000, maxTokens: 131_072, input: ['text'], reasoningEfforts: FIVE_TIER_REASONING },
  {
    id: 'kimi-k2.7-code',
    name: 'Kimi-K2.7-Code',
    contextWindow: 262_144,
    maxTokens: 32_768,
    input: ['text', 'image'],
    reasoningEfforts: KIMI_CODE_REASONING,
    compat: { thinkingFormat: 'qwen', supportsReasoningEffort: false },
  },
  { id: 'ark-code-latest', name: 'Ark Code Latest', contextWindow: 1_000_000, maxTokens: 131_072, input: ['text', 'image'], reasoningEfforts: FIVE_TIER_REASONING },
] as const

/** 把默认模型的新能力字段补进旧记录，同时保留用户显式覆盖。 */
function mergeExistingModel(model: Record<string, unknown>, defaults: Record<string, unknown> | undefined): Record<string, unknown> {
  if (defaults === undefined) return model
  const merged = { ...model }
  if (!Object.prototype.hasOwnProperty.call(model, 'reasoningEfforts') && Object.prototype.hasOwnProperty.call(defaults, 'reasoningEfforts')) {
    merged.reasoningEfforts = defaults.reasoningEfforts
  }
  if (Object.prototype.hasOwnProperty.call(defaults, 'compat')) {
    const defaultCompat = defaults.compat
    const existingCompat = model.compat
    if (defaultCompat !== null && typeof defaultCompat === 'object' && existingCompat !== null && typeof existingCompat === 'object') {
      merged.compat = { ...defaultCompat as Record<string, unknown>, ...existingCompat as Record<string, unknown> }
    } else if (!Object.prototype.hasOwnProperty.call(model, 'compat')) {
      merged.compat = defaultCompat
    }
  }
  return merged
}

/** 合并自定义方舟 provider，固定 Plan 数据面并补齐模型与推理档位。 */
export function mergeArkProvider(provider: Record<string, unknown> | undefined, fallbackApiKeyEnv: string): Record<string, unknown> {
  const existing = Array.isArray(provider?.models) ? provider.models as Array<Record<string, unknown>> : []
  const defaultsById = new Map<string, Record<string, unknown>>()
  for (const model of ARK_DEFAULT_MODELS) defaultsById.set(model.id, model as unknown as Record<string, unknown>)
  const mergedExisting = existing.map((model) => {
    const id = typeof model.id === 'string' ? model.id : ''
    return mergeExistingModel(model, defaultsById.get(id))
  })
  const ids = new Set(mergedExisting.map((model) => model.id).filter((id): id is string => typeof id === 'string'))
  const additions = ARK_DEFAULT_MODELS.filter((model) => !ids.has(model.id)).map((model) => ({ ...model }))
  return {
    ...(provider ?? {}),
    displayName: typeof provider?.displayName === 'string' ? provider.displayName : '火山方舟 Agent Plan',
    apiKeyEnv: typeof provider?.apiKeyEnv === 'string' ? provider.apiKeyEnv : fallbackApiKeyEnv,
    api: typeof provider?.api === 'string' ? provider.api : 'openai-completions',
    baseURL: ARK_PLAN_BASE_URL,
    models: [...mergedExisting, ...additions],
  }
}

/** 方舟 capability 配置。 */
export interface ArkCapabilityConfig {
  enabled: boolean
  /** Agent Plan 数据面 Key。 */
  apiKeyEnv: string
  /** 控制面 Access Key 的受管凭据引用。 */
  usageAccessKeyEnv?: string
  /** 控制面 Secret Key 的受管凭据引用。 */
  usageSecretKeyEnv?: string
  /** 控制面 OpenAPI 请求超时。 */
  usageTimeoutMs?: number
}

/** 可直接呈现给面板的分类错误；内容不得包含 Key。 */
export class ArkServiceError extends Error {
  readonly status: number

  constructor(message: string, status = 502) {
    super(message)
    this.name = 'ArkServiceError'
    this.status = status
  }
}

interface ResolvedUsageCredentials {
  accessKey: string
  secretKey: string
}

/** 方舟 Agent Plan 服务。 */
export class ArkCodingPlanService {
  private readonly ctx: Context
  private readonly config: ArkCapabilityConfig
  private usageCache: ArkUsageDashboard | undefined
  private usageInflight: Promise<ArkUsageDashboard> | undefined

  constructor(ctx: Context, config: ArkCapabilityConfig) {
    this.ctx = ctx
    this.config = config
  }

  /** 返回数据面 Key、控制面 AK/SK 与模型路由的脱敏状态。 */
  async status(): Promise<ArkStatus> {
    const [apiCredential, accessCredential, secretCredential] = await Promise.all([
      this.ctx.credentials.describe(this.apiReference()),
      this.ctx.credentials.describe(this.usageAccessReference()),
      this.ctx.credentials.describe(this.usageSecretReference()),
    ])
    const section = this.ctx.settings.get(LLM_PI_AI_NAMESPACE) as { providers?: Record<string, { models?: Array<{ id?: string }>; baseURL?: unknown }> } | undefined
    const provider = section?.providers?.[ARK_PROVIDER_ID]
    const liveIds = (provider?.models ?? []).map((model) => model.id).filter((id): id is string => typeof id === 'string')
    const configuredIds = new Set(liveIds)
    const displayIds = liveIds.length > 0 ? liveIds : ARK_DEFAULT_MODELS.map((model) => model.id)
    const baseURL = typeof provider?.baseURL === 'string' ? provider.baseURL : ARK_PLAN_BASE_URL
    return {
      enabled: this.config.enabled,
      credentialConfigured: apiCredential.configured,
      credentialWritable: apiCredential.writable,
      providerConfigured: provider !== undefined,
      models: displayIds.map((id) => ({ id, configured: configuredIds.has(id) })),
      baseURL,
      usageAccessKeyEnv: this.usageAccessKeyEnv(),
      usageAccessKeyConfigured: accessCredential.configured,
      usageSecretKeyEnv: this.usageSecretKeyEnv(),
      usageSecretKeyConfigured: secretCredential.configured,
      usageCredentialsWritable: accessCredential.writable && secretCredential.writable,
    }
  }

  /** 补齐 Agent Plan 官方文本模型池和缺失的推理档位，不覆盖用户显式字段。 */
  async ensureModels(): Promise<ArkStatus> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const descriptor = this.ctx.settings.describe().find((item) => item.ns === LLM_PI_AI_NAMESPACE)
      if (descriptor === undefined) throw new ArkServiceError('DSH 模型设置服务尚未注册 llm-pi-ai。', 409)
      const current = descriptor.value as { providers?: Record<string, Record<string, unknown>> } | undefined
      const provider = current?.providers?.[ARK_PROVIDER_ID]
      try {
        await this.ctx.settings.mutate(LLM_PI_AI_NAMESPACE, [{
          op: 'set',
          path: ['providers', ARK_PROVIDER_ID],
          value: mergeArkProvider(provider, this.config.apiKeyEnv),
        }], descriptor.revision)
        return await this.status()
      } catch (error) {
        if (error instanceof SettingsConflictError) {
          if (attempt === 1) throw new ArkServiceError('模型设置并发更新，请重试。', 409)
          continue
        }
        throw error
      }
    }
    throw new ArkServiceError('模型设置并发更新，请重试。', 409)
  }

  /** 读取套餐用量；默认复用五分钟缓存。 */
  async dashboard(signal?: AbortSignal): Promise<ArkUsageDashboard> {
    const credentials = await this.resolveUsageCredentials()
    if (credentials === undefined) return this.missingUsageDashboard()
    const now = Date.now()
    if (this.usageCache !== undefined && now - this.usageCache.fetchedAt < ARK_USAGE_CACHE_TTL_MS) return this.usageCache
    if (this.usageInflight !== undefined) return await this.usageInflight
    return await this.startUsageFetch(credentials, signal)
  }

  /**
   * 强制向火山 OpenAPI 刷新用量。
   *
   * 若旧凭据请求仍在进行，先等它结算，再重新解析最新 AK/SK 并发起新请求，防止换 Key 后复用旧结果。
   */
  async refreshUsage(signal?: AbortSignal): Promise<ArkUsageDashboard> {
    const previousInflight = this.usageInflight
    if (previousInflight !== undefined) {
      try { await previousInflight } catch { /* 旧请求失败不阻塞新凭据重试。 */ }
    }
    if (this.usageInflight !== undefined && this.usageInflight !== previousInflight) return await this.usageInflight
    const credentials = await this.resolveUsageCredentials()
    if (credentials === undefined) return this.missingUsageDashboard()
    return await this.startUsageFetch(credentials, signal)
  }

  /**
   * 先验证控制面 AK/SK，再成对写入 DSH credentials 服务。
   *
   * 验证失败不落盘；第二项写入失败会恢复第一项原值，避免页面出现半配置状态。
   */
  async saveUsageCredentials(accessKeyValue: string, secretKeyValue: string, signal?: AbortSignal): Promise<ArkUsageCredentialsResult> {
    const accessKey = accessKeyValue.trim()
    const secretKey = secretKeyValue.trim()
    if (accessKey === '' || secretKey === '') throw new ArkServiceError('Access Key 与 Secret Key 必须同时填写。', 400)
    if (accessKey.length > 4096 || secretKey.length > 4096) throw new ArkServiceError('AK/SK 长度超过安全上限。', 400)

    const previousInflight = this.usageInflight
    if (previousInflight !== undefined) {
      try { await previousInflight } catch { /* 旧请求不影响新凭据验证。 */ }
    }
    const previousCache = this.usageCache
    const accessReference = this.usageAccessReference()
    const secretReference = this.usageSecretReference()
    const previousAccess = await this.ctx.credentials.resolve(accessReference)
    const dashboard = await this.fetchUsage({ accessKey, secretKey }, signal, false)

    let accessChanged = false
    try {
      await this.ctx.credentials.set(accessReference, accessKey)
      accessChanged = true
      await this.ctx.credentials.set(secretReference, secretKey)
    } catch {
      this.usageCache = previousCache
      if (accessChanged) {
        try {
          await this.restoreCredential(accessReference, previousAccess?.value)
        } catch {
          throw new ArkServiceError('AK/SK 保存失败且 Access Key 回滚失败，请在 DSH 凭据管理中检查。', 500)
        }
      }
      throw new ArkServiceError('火山控制面 AK/SK 保存失败，原凭据已保留。', 500)
    }

    return { status: await this.status(), dashboard }
  }

  /** 恢复单项旧凭据，用于成对写入的失败回滚。 */
  private async restoreCredential(reference: ReturnType<typeof credentialRef>, previousValue: string | undefined): Promise<void> {
    if (previousValue === undefined) await this.ctx.credentials.unset(reference)
    else await this.ctx.credentials.set(reference, previousValue)
  }

  /** 建立唯一的在途请求，并在结算后释放去重句柄。 */
  private async startUsageFetch(credentials: ResolvedUsageCredentials, signal?: AbortSignal): Promise<ArkUsageDashboard> {
    const inFlight = this.fetchUsage(credentials, signal).finally(() => {
      if (this.usageInflight === inFlight) this.usageInflight = undefined
    })
    this.usageInflight = inFlight
    return await inFlight
  }

  /** AK/SK 不完整时返回可直接呈现的配置状态。 */
  private missingUsageDashboard(): ArkUsageDashboard {
    return {
      region: ARK_REGION,
      plans: [],
      fetchedAt: 0,
      stale: false,
      warnings: ['尚未同时配置火山控制面 Access Key 与 Secret Key。'],
    }
  }

  /** 执行一次控制面调用并把单套餐错误规整为页面警告。 */
  private async fetchUsage(credentials: ResolvedUsageCredentials, signal?: AbortSignal, allowStaleFallback = true): Promise<ArkUsageDashboard> {
    try {
      const plans = await fetchArkPlanUsage({
        accessKey: credentials.accessKey,
        secretKey: credentials.secretKey,
        region: ARK_REGION,
        timeoutMs: this.config.usageTimeoutMs ?? DEFAULT_USAGE_TIMEOUT_MS,
        signal,
      })
      const successful = plans.filter((plan) => plan.error === undefined)
      if (successful.length === 0) {
        const reason = plans.map((plan) => plan.error).filter((value): value is string => value !== undefined).join('；')
        throw new Error(reason === '' ? '两个套餐接口均未返回可用数据。' : reason)
      }
      const warnings = plans
        .filter((plan) => plan.error !== undefined)
        .map((plan) => (plan.product === 'agent-plan' ? 'Agent Plan' : 'Coding Plan') + '：' + plan.error)
      const dashboard: ArkUsageDashboard = {
        region: ARK_REGION,
        plans,
        fetchedAt: Date.now(),
        stale: false,
        warnings,
      }
      this.usageCache = dashboard
      return dashboard
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 320) : '未知错误'
      if (allowStaleFallback && this.usageCache !== undefined) {
        return {
          ...this.usageCache,
          stale: true,
          warnings: [...this.usageCache.warnings, '实时刷新失败，当前展示最近一次成功快照：' + message],
        }
      }
      throw new ArkServiceError('火山方舟用量查询失败：' + message, 502)
    }
  }

  /** 解析 AK/SK；任一缺失时由页面进入配置引导，不发起外部请求。 */
  private async resolveUsageCredentials(): Promise<ResolvedUsageCredentials | undefined> {
    const [accessCredential, secretCredential] = await Promise.all([
      this.ctx.credentials.resolve(this.usageAccessReference()),
      this.ctx.credentials.resolve(this.usageSecretReference()),
    ])
    const accessKey = accessCredential?.value.trim() ?? ''
    const secretKey = secretCredential?.value.trim() ?? ''
    if (accessKey === '' || secretKey === '') return undefined
    return { accessKey, secretKey }
  }

  private apiReference(): ReturnType<typeof credentialRef> {
    return checkedReference(this.config.apiKeyEnv, '方舟 Agent Plan API Key')
  }

  private usageAccessReference(): ReturnType<typeof credentialRef> {
    return checkedReference(this.usageAccessKeyEnv(), '火山 Access Key')
  }

  private usageSecretReference(): ReturnType<typeof credentialRef> {
    return checkedReference(this.usageSecretKeyEnv(), '火山 Secret Key')
  }

  private usageAccessKeyEnv(): string {
    return this.config.usageAccessKeyEnv ?? DEFAULT_USAGE_ACCESS_KEY_ENV
  }

  private usageSecretKeyEnv(): string {
    return this.config.usageSecretKeyEnv ?? DEFAULT_USAGE_SECRET_KEY_ENV
  }
}

function checkedReference(value: string, name: string): ReturnType<typeof credentialRef> {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) throw new ArkServiceError(name + '凭据引用格式无效。', 400)
  return credentialRef(value)
}
