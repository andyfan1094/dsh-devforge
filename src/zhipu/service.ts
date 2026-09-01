import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { SettingsConflictError } from '@deepseek-ai/dsh-settings'
import { settingsNamespace } from '../settings-compat.ts'
import { deepEqualJson } from '../provider-settings.ts'
import { parseQuotaLimits } from './quota.ts'
import type { ZhipuDashboard, ZhipuModelUsage, ZhipuStatus, ZhipuToolUsage, ZhipuUsageWindow } from './protocol.ts'

const LLM_PI_AI_NAMESPACE = settingsNamespace('llm-pi-ai')
const PROVIDER_ID = 'zai-coding-cn'
const MODELS = [
  { id: 'glm-5.3', name: 'GLM-5.3', contextWindow: 1_000_000, maxTokens: 131_072, input: ['text'], reasoningEfforts: { low: 'low', high: 'high', max: 'max' } },
  { id: 'glm-5.3-flash', name: 'GLM-5.3-Flash', contextWindow: 1_000_000, maxTokens: 131_072, input: ['text', 'image'], reasoningEfforts: { low: 'low', high: 'high', max: 'max' } },
] as const

/** 合并 zai-coding-cn 配置：只补缺失模型和凭据引用，保留用户显式字段。 */
export function mergeZhipuProvider(provider: Record<string, unknown> | undefined, fallbackApiKeyEnv: string): Record<string, unknown> {
  const existing = Array.isArray(provider?.models) ? provider.models as Array<Record<string, unknown>> : []
  const ids = new Set(existing.map((model) => model.id).filter((id): id is string => typeof id === 'string'))
  const additions = MODELS.filter((model) => !ids.has(model.id)).map((model) => ({ ...model }))
  return {
    ...(provider ?? {}),
    apiKeyEnv: typeof provider?.apiKeyEnv === 'string' ? provider.apiKeyEnv : fallbackApiKeyEnv,
    models: [...existing, ...additions],
  }
}

/** 智谱 capability 配置。 */
export interface ZhipuCapabilityConfig {
  enabled: boolean
  apiKeyEnv: string
  timeoutMs: number
  /** 官方 MCP 工具开关。 */
  mcpTools: boolean
}

/** 可直接呈现给面板的分类错误；内容不得包含请求头或 Key。 */
export class ZhipuServiceError extends Error {
  readonly status: number

  constructor(message: string, status = 502) {
    super(message)
    this.name = 'ZhipuServiceError'
    this.status = status
  }
}

/** 智谱官方模型与监控接口服务。 */
export class ZhipuCodingPlanService {
  /** 上游固定为官方 HTTPS 域名，避免自定义地址带走 API Key。 */
  private readonly baseURL = 'https://open.bigmodel.cn'
  private readonly ctx: Context
  private readonly config: ZhipuCapabilityConfig

  constructor(ctx: Context, config: ZhipuCapabilityConfig) {
    this.ctx = ctx
    this.config = config
  }

  /** 返回凭据和模型路由的脱敏状态。 */
  async status(): Promise<ZhipuStatus> {
    const reference = this.reference()
    const credential = await this.ctx.credentials.describe(reference)
    const section = this.ctx.settings.get(LLM_PI_AI_NAMESPACE) as { providers?: Record<string, { models?: Array<{ id?: string }> }> } | undefined
    const provider = section?.providers?.[PROVIDER_ID]
    const liveIds = (provider?.models ?? []).map((model) => model.id).filter((id): id is string => typeof id === 'string')
    const configuredIds = new Set(liveIds)
    /** 优先展示 settings 中实际配置的模型，未配置任何模型时回退到内置常量。 */
    const displayIds = liveIds.length > 0 ? liveIds : MODELS.map((model) => model.id)
    return {
      enabled: this.config.enabled,
      credentialConfigured: credential.configured,
      credentialWritable: credential.writable,
      providerConfigured: provider !== undefined,
      models: displayIds.map((id) => ({ id, configured: configuredIds.has(id) })),
      mcpTools: this.config.mcpTools,
    }
  }

  /** 调官方 /api/paas/v4/models 拉取在售模型清单，合并进 provider，返回更新后状态。 */
  async fetchModelsFromOfficial(): Promise<{ status: ZhipuStatus; added: string[]; kept: string[]; total: number }> {
    const apiKey = await this.resolveApiKey()
    const controller = new AbortController()
    const timer = setTimeout(controller.abort.bind(controller), this.config.timeoutMs)
    let response: Response
    try {
      response = await fetch(this.baseURL + '/api/paas/v4/models', {
        headers: { Authorization: 'Bearer ' + apiKey, Accept: 'application/json' },
        signal: controller.signal,
      })
    } catch (error) {
      throw new ZhipuServiceError('智谱官方 models 接口不可达：' + (error instanceof Error ? error.message : String(error)))
    } finally {
      clearTimeout(timer)
    }
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new ZhipuServiceError('智谱官方 models 接口 HTTP ' + response.status + '：' + text.slice(0, 200), response.status === 401 ? 401 : 502)
    }
    const payload = await response.json().catch(() => null) as { data?: unknown } | null
    const official = parseZhipuModelList(payload)
    if (official.length === 0) throw new ZhipuServiceError('智谱官方 models 接口未返回有效数据。', 502)
    const next = await this.mergeFetchedModels(official)
    return next
  }

  /** 查询额度和选定时间窗内的模型、MCP 用量。 */
  async dashboard(window: ZhipuUsageWindow, signal?: AbortSignal): Promise<ZhipuDashboard> {
    const apiKey = await this.resolveApiKey()
    const end = new Date()
    const hours = window === 'day' ? 24 : 24 * 7
    const start = new Date(end.getTime() - hours * 60 * 60 * 1000)
    const quota = await this.get('/api/monitor/usage/quota/limit', apiKey, signal)
    const [modelResult, toolResult] = await Promise.allSettled([
      this.get('/api/monitor/usage/model-usage' + this.usageQuery(start, end), apiKey, signal),
      this.get('/api/monitor/usage/tool-usage' + this.usageQuery(start, end), apiKey, signal),
    ])
    const warnings: string[] = []
    if (modelResult.status === 'rejected') warnings.push('模型用量明细暂不可用。')
    if (toolResult.status === 'rejected') warnings.push('MCP 工具明细暂不可用。')
    const quotaData = this.objectData(quota)
    return {
      level: typeof quotaData.level === 'string' ? quotaData.level : undefined,
      limits: parseQuotaLimits(quotaData.limits),
      modelUsage: modelResult.status === 'fulfilled' ? this.parseModelUsage(this.objectData(modelResult.value)) : { totalCalls: 0, totalTokens: 0, models: [] },
      toolUsage: toolResult.status === 'fulfilled' ? this.parseToolUsage(this.objectData(toolResult.value)) : { networkSearch: 0, webRead: 0, zread: 0 },
      window,
      fetchedAt: Date.now(),
      warnings,
    }
  }

  /** 补齐官方 provider 路由和最新模型，不覆盖已有模型字段。 */
  async ensureModels(): Promise<ZhipuStatus> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const descriptor = this.ctx.settings.describe().find((item) => item.ns === LLM_PI_AI_NAMESPACE)
      if (descriptor === undefined) throw new ZhipuServiceError('DSH 模型设置服务尚未注册 llm-pi-ai。', 409)
      const current = descriptor.value as { providers?: Record<string, Record<string, unknown>> } | undefined
      const provider = current?.providers?.[PROVIDER_ID]
      const merged = mergeZhipuProvider(provider, this.config.apiKeyEnv)
      if (deepEqualJson(merged, provider)) return await this.status()
      try {
        await this.ctx.settings.mutate(LLM_PI_AI_NAMESPACE, [{
          op: 'set',
          path: ['providers', PROVIDER_ID],
          value: merged,
        }], descriptor.revision)
        return await this.status()
      } catch (error) {
        if (error instanceof SettingsConflictError) {
          if (attempt === 1) throw new ZhipuServiceError('模型设置并发更新，请重试。', 409)
          continue
        }
        throw error
      }
    }
    throw new ZhipuServiceError('模型设置并发更新，请重试。', 409)
  }

  /** 校验并构造凭据引用，避免错误配置以内部异常呈现。 */
  private reference(): ReturnType<typeof credentialRef> {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(this.config.apiKeyEnv)) throw new ZhipuServiceError('智谱凭据引用格式无效。', 400)
    return credentialRef(this.config.apiKeyEnv)
  }

  /** 把官方 models 合并进 provider；写 settings 复用并发重试。 */
  private async mergeFetchedModels(official: Array<Record<string, unknown>>): Promise<{ status: ZhipuStatus; added: string[]; kept: string[]; total: number }> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const descriptor = this.ctx.settings.describe().find((item) => item.ns === LLM_PI_AI_NAMESPACE)
      if (descriptor === undefined) throw new ZhipuServiceError('DSH 模型设置服务尚未注册 llm-pi-ai。', 409)
      const current = descriptor.value as { providers?: Record<string, Record<string, unknown>> } | undefined
      const provider = current?.providers?.[PROVIDER_ID]
      const existing = Array.isArray(provider?.models) ? provider.models as Array<Record<string, unknown>> : []
      const existingIds = new Set(existing.map((model) => model.id).filter((id): id is string => typeof id === 'string'))
      const additions = official.filter((model) => {
        const id = typeof model.id === 'string' ? model.id : ''
        return id !== '' && !existingIds.has(id)
      })
      const merged = [...existing, ...additions]
      const added = additions.map((model) => typeof model.id === 'string' ? model.id : '').filter((id) => id !== '')
      const kept = existing.map((model) => typeof model.id === 'string' ? model.id : '').filter((id) => id !== '')
      try {
        await this.ctx.settings.mutate(LLM_PI_AI_NAMESPACE, [{
          op: 'set',
          path: ['providers', PROVIDER_ID, 'models'],
          value: merged,
        }], descriptor.revision)
        return { status: await this.status(), added, kept, total: merged.length }
      } catch (error) {
        if (error instanceof SettingsConflictError) {
          if (attempt === 1) throw new ZhipuServiceError('模型设置并发更新，请重试。', 409)
          continue
        }
        throw error
      }
    }
    throw new ZhipuServiceError('模型设置并发更新，请重试。', 409)
  }

  /** 每次请求重新解析凭据，Key 更新无需重启。 */
  private async resolveApiKey(): Promise<string> {
    const resolved = await this.ctx.credentials.resolve(this.reference())
    const value = resolved?.value.trim()
    if (value === undefined || value === '') throw new ZhipuServiceError('尚未配置智谱 Coding Plan API Key。', 400)
    return value
  }


  /** 访问官方监控接口，限制响应大小并分类常见错误。 */
  private async get(path: string, apiKey: string, signal?: AbortSignal): Promise<unknown> {
    const controller = new AbortController()
    const abort = (): void => controller.abort()
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted === true) controller.abort()
    const timer = setTimeout(abort, this.config.timeoutMs)
    try {
      const response = await fetch(this.baseURL + path, {
        headers: { authorization: apiKey, accept: 'application/json', 'accept-language': 'zh-CN,zh' },
        signal: controller.signal,
      })
      const text = await this.readResponseText(response)
      if (response.status === 401 || response.status === 403) throw new ZhipuServiceError('智谱 API Key 无效或不属于 Coding Plan。', 401)
      if (response.status === 429) throw new ZhipuServiceError('智谱监控接口请求过于频繁，请稍后重试。', 429)
      if (!response.ok) throw new ZhipuServiceError('智谱监控接口暂不可用（HTTP ' + response.status + '）。')
      let payload: unknown
      try { payload = JSON.parse(text) } catch { throw new ZhipuServiceError('智谱监控接口返回了无法解析的数据。') }
      const envelope = payload as { success?: boolean; msg?: unknown; data?: unknown }
      if (envelope.success === false || envelope.data === undefined || envelope.data === null) {
        throw new ZhipuServiceError('智谱监控接口返回失败，请稍后重试。')
      }
      return envelope.data
    } catch (error) {
      if (error instanceof ZhipuServiceError) throw error
      if (error instanceof Error && error.name === 'AbortError') throw new ZhipuServiceError('智谱监控接口请求超时。', 504)
      throw new ZhipuServiceError('无法连接智谱监控接口。')
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
    }
  }

  /** 按字节流式读取响应，超过 4 MiB 立即取消，避免无界内存占用。 */
  private async readResponseText(response: Response): Promise<string> {
    const maxBytes = 4 * 1024 * 1024
    const declared = Number(response.headers.get('content-length'))
    if (Number.isFinite(declared) && declared > maxBytes) {
      await response.body?.cancel()
      throw new ZhipuServiceError('智谱监控接口响应超过安全上限。')
    }
    if (response.body === null) return ''
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let total = 0
    while (true) {
      const part = await reader.read()
      if (part.done) break
      total += part.value.byteLength
      if (total > maxBytes) {
        await reader.cancel()
        throw new ZhipuServiceError('智谱监控接口响应超过安全上限。')
      }
      chunks.push(part.value)
    }
    return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), total).toString('utf8')
  }

  /** 保证接口 data 是普通对象。 */
  private objectData(value: unknown): Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  }

  /** 生成官方接口要求的本地时间查询参数。 */
  private usageQuery(start: Date, end: Date): string {
    const format = (date: Date): string => {
      const pad = (value: number): string => String(value).padStart(2, '0')
      return [date.getFullYear(), '-', pad(date.getMonth() + 1), '-', pad(date.getDate()), ' ', pad(date.getHours()), ':', pad(date.getMinutes()), ':', pad(date.getSeconds())].join('')
    }
    return '?startTime=' + encodeURIComponent(format(start)) + '&endTime=' + encodeURIComponent(format(end))
  }

  /** 规整模型统计，忽略不完整的第三方字段。 */
  private parseModelUsage(data: Record<string, unknown>): ZhipuModelUsage {
    const total = this.objectData(data.totalUsage)
    const rows = Array.isArray(total.modelSummaryList) ? total.modelSummaryList : []
    const models: Array<{ name: string; tokens: number }> = []
    for (const entry of rows) {
      if (entry === null || typeof entry !== 'object') continue
      const row = entry as { modelName?: unknown; totalTokens?: unknown }
      if (typeof row.modelName === 'string' && typeof row.totalTokens === 'number' && Number.isFinite(row.totalTokens) && row.totalTokens > 0) {
        models.push({ name: row.modelName, tokens: row.totalTokens })
      }
    }
    models.sort((left, right) => right.tokens - left.tokens)
    return {
      totalCalls: typeof total.totalModelCallCount === 'number' ? total.totalModelCallCount : 0,
      totalTokens: typeof total.totalTokensUsage === 'number' ? total.totalTokensUsage : 0,
      models,
    }
  }

  /** 规整 MCP 工具统计。 */
  private parseToolUsage(data: Record<string, unknown>): ZhipuToolUsage {
    const total = this.objectData(data.totalUsage)
    return {
      networkSearch: typeof total.totalNetworkSearchCount === 'number' ? total.totalNetworkSearchCount : 0,
      webRead: typeof total.totalWebReadMcpCount === 'number' ? total.totalWebReadMcpCount : 0,
      zread: typeof total.totalZreadMcpCount === 'number' ? total.totalZreadMcpCount : 0,
    }
  }
}

/** 把智谱官方 /v4/models 响应规整为最小可用模型字典。 */
export function parseZhipuModelList(payload: unknown): Array<Record<string, unknown>> {
  if (payload === null || typeof payload !== 'object') return []
  const data = Array.isArray((payload as { data?: unknown }).data) ? (payload as { data: unknown[] }).data : []
  const result: Array<Record<string, unknown>> = []
  for (const entry of data) {
    if (entry === null || typeof entry !== 'object') continue
    const row = entry as { id?: unknown; name?: unknown; owned_by?: unknown }
    if (typeof row.id !== 'string' || row.id === '') continue
    const record: Record<string, unknown> = { id: row.id }
    if (typeof row.name === 'string' && row.name !== '') record.name = row.name
    if (typeof row.owned_by === 'string' && row.owned_by !== '') record.owned_by = row.owned_by
    result.push(record)
  }
  return result
}
