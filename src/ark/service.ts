/** 火山方舟 Agent/Coding Plan 服务：数据面模型路由 + 管控面 AFP/模型同步。 */
import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { SettingsConflictError, settingsNamespace } from '@deepseek-ai/dsh-settings'
import { Service } from '@volcengine/openapi'
import type { ArkAfpLimit, ArkDashboard, ArkStatus } from './protocol.ts'

const LLM_PI_AI_NAMESPACE = settingsNamespace('llm-pi-ai')

/** 方舟 Coding Plan 的 OpenAI / Responses 官方 Base URL，不能换为普通 /api/v3。 */
export const ARK_PLAN_BASE_URL = 'https://ark.cn-beijing.volces.com/api/plan/v3'
export const ARK_PROVIDER_ID = 'volcengine-ark-plan'

/** Agent/Coding Plan 官方文档推荐的默认自动路由模型。 */
export const ARK_DEFAULT_MODELS = [
  { id: 'ark-code-latest', name: 'ark-code-latest', input: ['text'] },
] as const

/** 合并自定义方舟 provider，显式固定 Coding Plan 数据面，不覆盖用户已有模型字段。 */
export function mergeArkProvider(provider: Record<string, unknown> | undefined, fallbackApiKeyEnv: string): Record<string, unknown> {
  const existing = Array.isArray(provider?.models) ? provider.models as Array<Record<string, unknown>> : []
  const ids = new Set(existing.map((model) => model.id).filter((id): id is string => typeof id === 'string'))
  const additions = ARK_DEFAULT_MODELS.filter((model) => !ids.has(model.id)).map((model) => ({ ...model }))
  return {
    ...(provider ?? {}),
    displayName: typeof provider?.displayName === 'string' ? provider.displayName : '火山方舟 Agent/Coding Plan',
    apiKeyEnv: typeof provider?.apiKeyEnv === 'string' ? provider.apiKeyEnv : fallbackApiKeyEnv,
    api: typeof provider?.api === 'string' ? provider.api : 'openai-completions',
    baseURL: typeof provider?.baseURL === 'string' ? provider.baseURL : ARK_PLAN_BASE_URL,
    models: [...existing, ...additions],
  }
}

/** 方舟 capability 配置。 */
export interface ArkCapabilityConfig {
  enabled: boolean
  /** Agent/Coding Plan 数据面 Key。 */
  apiKeyEnv: string
  /** 火山云 AK，用于官方 OpenAPI 管控面。 */
  accessKeyEnv: string
  /** 火山云 SK，用于官方 OpenAPI 管控面。 */
  secretKeyEnv: string
  timeoutMs: number
}

/** 可直接呈现给面板的分类错误；内容不得包含 Key 或签名。 */
export class ArkServiceError extends Error {
  readonly status: number

  constructor(message: string, status = 502) {
    super(message)
    this.name = 'ArkServiceError'
    this.status = status
  }
}

/** 方舟 Agent/Coding Plan 服务。 */
export class ArkCodingPlanService {
  private readonly ctx: Context
  private readonly config: ArkCapabilityConfig

  constructor(ctx: Context, config: ArkCapabilityConfig) {
    this.ctx = ctx
    this.config = config
  }

  /** 返回数据面 Key、管控面 AK/SK 与模型路由的脱敏状态。 */
  async status(): Promise<ArkStatus> {
    const [apiCredential, accessCredential, secretCredential] = await Promise.all([
      this.ctx.credentials.describe(this.apiReference()),
      this.ctx.credentials.describe(this.accessReference()),
      this.ctx.credentials.describe(this.secretReference()),
    ])
    const section = this.ctx.settings.get(LLM_PI_AI_NAMESPACE) as { providers?: Record<string, { models?: Array<{ id?: string }> }> } | undefined
    const provider = section?.providers?.[ARK_PROVIDER_ID]
    const liveIds = (provider?.models ?? []).map((model) => model.id).filter((id): id is string => typeof id === 'string')
    const configuredIds = new Set(liveIds)
    const displayIds = liveIds.length > 0 ? liveIds : ARK_DEFAULT_MODELS.map((model) => model.id)
    const baseURL = typeof (provider as { baseURL?: unknown } | undefined)?.baseURL === 'string' ? (provider as { baseURL: string }).baseURL : ARK_PLAN_BASE_URL
    return {
      enabled: this.config.enabled,
      credentialConfigured: apiCredential.configured,
      credentialWritable: apiCredential.writable,
      managementCredentialsConfigured: accessCredential.configured && secretCredential.configured,
      providerConfigured: provider !== undefined,
      models: displayIds.map((id) => ({ id, configured: configuredIds.has(id) })),
      baseURL,
    }
  }

  /** 补齐默认 ark-code-latest 路由，不覆盖用户已有模型。 */
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

  /** 调官方 ListArkAgentPlanModel 拉取当前套餐可用模型，并合并进 provider。 */
  async fetchModelsFromOfficial(): Promise<{ status: ArkStatus; added: string[]; kept: string[]; total: number }> {
    const response = await this.callManagement<{ Datas?: unknown }>('ListArkAgentPlanModel', 'ark_stg')
    const rows = Array.isArray(response.Datas) ? response.Datas : []
    const models: Array<Record<string, unknown>> = []
    for (const row of rows) {
      if (row === null || typeof row !== 'object') continue
      const id = (row as { ModelID?: unknown }).ModelID
      if (typeof id !== 'string' || id === '') continue
      models.push({ id, name: id, input: ['text'] })
    }
    if (models.length === 0) throw new ArkServiceError('方舟官方模型列表为空。', 502)
    return await this.mergeFetchedModels(models)
  }

  /** 调官方 GetAFPUsage，返回五小时、日、周、月 AFP 使用量。 */
  async dashboard(): Promise<ArkDashboard> {
    const result = await this.callManagement<Record<string, unknown>>('GetAFPUsage', 'ark')
    const mapping: Array<{ key: string; period: ArkAfpLimit['period'] }> = [
      { key: 'AFPFiveHour', period: 'fiveHour' },
      { key: 'AFPDaily', period: 'daily' },
      { key: 'AFPWeekly', period: 'weekly' },
      { key: 'AFPMonthly', period: 'monthly' },
    ]
    const limits: ArkAfpLimit[] = []
    for (const item of mapping) {
      const raw = result[item.key]
      if (raw === null || typeof raw !== 'object') continue
      const row = raw as { Quota?: unknown; Used?: unknown; SubscribeTime?: unknown; ResetTime?: unknown }
      const quota = finiteNumber(row.Quota)
      const used = finiteNumber(row.Used)
      if (quota === undefined || used === undefined) continue
      const subscribeTime = finiteNumber(row.SubscribeTime)
      const resetTime = finiteNumber(row.ResetTime)
      limits.push({
        period: item.period,
        quota,
        used,
        ...(subscribeTime !== undefined && subscribeTime > 0 ? { subscribeTime } : {}),
        ...(resetTime !== undefined && resetTime > 0 ? { resetTime } : {}),
      })
    }
    return {
      planType: typeof result.PlanType === 'string' ? result.PlanType : undefined,
      limits,
      fetchedAt: Date.now(),
      warnings: limits.length === 0 ? ['方舟官方 AFP 接口未返回可用额度。'] : [],
    }
  }

  /** 按方舟官方 OpenAPI SDK 生成 HMAC 签名并调用管控面。 */
  private async callManagement<T extends Record<string, unknown>>(action: string, serviceName: string): Promise<T> {
    const [accessKeyId, secretKey] = await Promise.all([this.resolveAccessKey(), this.resolveSecretKey()])
    const service = new Service({
      region: 'cn-beijing',
      host: 'ark.cn-beijing.volces.com',
      protocol: 'https',
      serviceName,
      defaultVersion: '2024-01-01',
      accessKeyId,
      secretKey,
    })
    try {
      const invoke = service.createJSONAPI(action, { Version: '2024-01-01', method: 'POST', contentType: 'json' })
      const response = await invoke({}) as { ResponseMetadata?: { Error?: { Message?: unknown } }; Result?: T }
      const message = response.ResponseMetadata?.Error?.Message
      if (typeof message === 'string' && message !== '') throw new ArkServiceError('方舟官方 ' + action + ' 调用失败：' + message)
      if (response.Result === undefined || response.Result === null) throw new ArkServiceError('方舟官方 ' + action + ' 未返回结果。')
      return response.Result
    } catch (error) {
      if (error instanceof ArkServiceError) throw error
      const message = error instanceof Error ? error.message : String(error)
      throw new ArkServiceError('无法调用方舟官方 ' + action + '：' + message.replace(/(AK|SK|Credential|Signature)=[^,\s]+/gi, '$1=[redacted]').slice(0, 300))
    }
  }

  /** 把官方模型清单合并进 provider，保留用户自定义模型与配置。 */
  private async mergeFetchedModels(official: Array<Record<string, unknown>>): Promise<{ status: ArkStatus; added: string[]; kept: string[]; total: number }> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const descriptor = this.ctx.settings.describe().find((item) => item.ns === LLM_PI_AI_NAMESPACE)
      if (descriptor === undefined) throw new ArkServiceError('DSH 模型设置服务尚未注册 llm-pi-ai。', 409)
      const current = descriptor.value as { providers?: Record<string, Record<string, unknown>> } | undefined
      const provider = current?.providers?.[ARK_PROVIDER_ID]
      const base = mergeArkProvider(provider, this.config.apiKeyEnv)
      const existing = Array.isArray(base.models) ? base.models as Array<Record<string, unknown>> : []
      const existingIds = new Set(existing.map((model) => model.id).filter((id): id is string => typeof id === 'string'))
      const additions = official.filter((model) => typeof model.id === 'string' && !existingIds.has(model.id))
      const merged = { ...base, models: [...existing, ...additions] }
      const kept = [...existingIds]
      const added = additions.map((model) => model.id as string)
      try {
        await this.ctx.settings.mutate(LLM_PI_AI_NAMESPACE, [{
          op: 'set',
          path: ['providers', ARK_PROVIDER_ID],
          value: merged,
        }], descriptor.revision)
        return { status: await this.status(), added, kept, total: (merged.models as unknown[]).length }
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

  private apiReference(): ReturnType<typeof credentialRef> {
    return checkedReference(this.config.apiKeyEnv, '方舟 Agent/Coding Plan API Key')
  }

  private accessReference(): ReturnType<typeof credentialRef> {
    return checkedReference(this.config.accessKeyEnv, '方舟 Access Key')
  }

  private secretReference(): ReturnType<typeof credentialRef> {
    return checkedReference(this.config.secretKeyEnv, '方舟 Secret Key')
  }

  private async resolveAccessKey(): Promise<string> {
    return await this.resolveCredential(this.accessReference(), '方舟 Access Key ID')
  }

  private async resolveSecretKey(): Promise<string> {
    return await this.resolveCredential(this.secretReference(), '方舟 Secret Access Key')
  }

  private async resolveCredential(reference: ReturnType<typeof credentialRef>, name: string): Promise<string> {
    const resolved = await this.ctx.credentials.resolve(reference)
    const value = resolved?.value.trim()
    if (value === undefined || value === '') throw new ArkServiceError('尚未配置' + name + '，AFP 用量和官方模型列表需要火山云 AK/SK。', 400)
    return value
  }
}

function checkedReference(value: string, name: string): ReturnType<typeof credentialRef> {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) throw new ArkServiceError(name + '凭据引用格式无效。', 400)
  return credentialRef(value)
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}
