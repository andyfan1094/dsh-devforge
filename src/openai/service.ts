/** OpenAI 兼容中转站：多端点配置迁移、模型发现与 llm-pi-ai 路由同步。 */
import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { SettingsConflictError } from '@deepseek-ai/dsh-settings'
import { settingsNamespace } from '../settings-compat.ts'
import { deepEqualJson } from '../provider-settings.ts'
import { getDb, getSettings, putSettings } from '../store/db.ts'
import { normalizeOpenAiBaseURL, openAiApiRoot, OpenAiGatewayClient, OpenAiGatewayError, type OpenAiDiscoveredModel, type OpenAiGeneratedImage } from './api-client.ts'
import type { OpenAiEndpointApi, OpenAiGatewayConfigPatch, OpenAiGatewayEndpointConfig, OpenAiGatewayEndpointFetchResult, OpenAiGatewayEndpointStatus, OpenAiGatewayFetchModelsResult, OpenAiGatewayModelInfo, OpenAiGatewayModelPatch, OpenAiGatewayStatus } from './protocol.ts'

const LLM_PI_AI_NAMESPACE = settingsNamespace('llm-pi-ai')
const DEVFORGE_NAMESPACE = settingsNamespace('dsh-devforge')
const LEGACY_SUB2API_NAMESPACE = settingsNamespace('llm-sub2api')
export const OPENAI_PROVIDER_ID = 'openai-gateway'
const LEGACY_PROVIDER_IDS = ['sub2api-openai', 'sub2api-claude', 'sub2api-grok', 'sub2api-gemini'] as const
const DEFAULT_API_KEY_ENV = 'OPENAI_GATEWAY_API_KEY'
const ENDPOINT_PROVIDER_PREFIX = 'openai-gateway-'

/** 可直接呈现给面板的分类错误。 */
export class OpenAiServiceError extends Error {
  readonly status: number

  constructor(message: string, status = 502) {
    super(message)
    this.name = 'OpenAiServiceError'
    this.status = status
  }
}

/** 规范化多端点配置；旧版本只有 baseURL 时自动生成主端点。 */
export function normalizeOpenAiEndpoints(config: OpenAiCapabilityConfig): OpenAiGatewayEndpointConfig[] {
  const raw = Array.isArray(config.endpoints) ? config.endpoints : []
  // 空数组且仍有旧 baseURL，说明这是未升级的单端点配置；显式清空时 baseURL 同时为空。
  if (raw.length === 0) {
    const baseURL = normalizeEndpointBaseURL(typeof config.baseURL === 'string' ? config.baseURL : '')
    if (baseURL === '') return []
    const apiKeyEnv = normalizeApiKeyEnv(config.apiKeyEnv)
    return [{ id: 'default', name: '主端点', baseURL, apiKeyEnv, ...(config.imageModel.trim() !== '' ? { imageModel: config.imageModel.trim() } : {}) }]
  }

  const ids = new Set<string>()
  const result: OpenAiGatewayEndpointConfig[] = []
  for (let index = 0; index < raw.length; index += 1) {
    const item = raw[index]
    if (item === undefined || item === null || typeof item !== 'object') throw new OpenAiServiceError('OpenAI 端点配置无效。', 400)
    const baseURL = normalizeEndpointBaseURL(item.baseURL)
    if (baseURL === '') throw new OpenAiServiceError('OpenAI 端点地址不能为空。', 400)
    let id = item.id.trim().replace(/[^A-Za-z0-9_-]+/gu, '-').replace(/^-+|-+$/gu, '')
    if (id === '') id = 'endpoint-' + (index + 1)
    let idKey = id.toLowerCase()
    let suffix = 2
    while (ids.has(idKey)) {
      id = id + '-' + suffix
      idKey = id.toLowerCase()
      suffix += 1
    }
    ids.add(idKey)
    const apiKeyEnv = normalizeApiKeyEnv(item.apiKeyEnv)
    const api = normalizeEndpointApi(item.api)
    result.push({
      id,
      name: item.name.trim() || '端点 ' + (index + 1),
      baseURL,
      apiKeyEnv,
      ...(api !== undefined ? { api } : {}),
      ...(typeof item.imageModel === 'string' && item.imageModel.trim() !== '' ? { imageModel: item.imageModel.trim() } : {}),
    })
  }
  return result
}

/** 把端点 id 映射为 DSH provider id；第一个端点保持旧 id。 */
export function openAiProviderId(endpoint: OpenAiGatewayEndpointConfig, index: number): string {
  if (index === 0) return OPENAI_PROVIDER_ID
  return ENDPOINT_PROVIDER_PREFIX + endpoint.id.toLowerCase()
}

function normalizeEndpointBaseURL(value: string): string {
  try { return normalizeOpenAiBaseURL(typeof value === 'string' ? value : '') } catch { throw new OpenAiServiceError('OpenAI 中转站地址无效：只能填写 HTTP(S) 主机或 /v1 API 根路径。', 400) }
}

function normalizeApiKeyEnv(value: string): string {
  const result = typeof value === 'string' ? value.trim() : ''
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(result)) throw new OpenAiServiceError('OpenAI 端点凭据引用格式无效。', 400)
  return result
}

/** 校验端点聊天协议；缺省返回 undefined 表示沿用 openai-responses。 */
function normalizeEndpointApi(value: unknown): OpenAiEndpointApi | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (value === 'openai-responses' || value === 'openai-completions' || value === 'anthropic-messages') return value
  throw new OpenAiServiceError('端点聊天协议只支持 openai-responses、openai-completions 或 anthropic-messages。', 400)
}

/** Anthropic provider 的 baseURL：裸主机根路径，剥掉误填的 /v1 尾缀避免 SDK 拼出 /v1/v1/messages。 */
function anthropicBaseURL(value: string): string {
  return normalizeOpenAiBaseURL(value).replace(/\/v1$/i, '')
}

/** Anthropic 端点未知型号的保底容量（200K / 32K）。 */
const ANTHROPIC_CONTEXT_WINDOW = 200_000
const ANTHROPIC_MAX_TOKENS = 32_000

/** 按 Claude 官方规格给 Anthropic 端点模型定容量与思考模式：Opus 4.6+/Fable/Sonnet 5 为 1M 上下文、128K 输出并启用官方 adaptive thinking（effort 档位），Sonnet 4.5+ 为 1M 与 64K，其余 Claude（含 Haiku）为 200K 与 64K。 */
function anthropicModelCapacity(id: string): { contextWindow: number; maxTokens: number; adaptive: boolean } {
  if (/claude-(opus-4-[6-9]|opus-[5-9]|fable|sonnet-5)/i.test(id)) return { contextWindow: 1_000_000, maxTokens: 128_000, adaptive: true }
  if (/claude-sonnet-4-[5-9]/i.test(id)) return { contextWindow: 1_000_000, maxTokens: 64_000, adaptive: false }
  if (/claude/i.test(id)) return { contextWindow: 200_000, maxTokens: 64_000, adaptive: false }
  return { contextWindow: ANTHROPIC_CONTEXT_WINDOW, maxTokens: ANTHROPIC_MAX_TOKENS, adaptive: false }
}

/** OpenAI 中转能力配置；仅保存凭据引用，不保存 Key 明文。 */
export interface OpenAiCapabilityConfig {
  enabled: boolean
  baseURL: string
  apiKeyEnv: string
  imageModel: string
  timeoutMs: number
  /** 多端点配置；缺省时由旧 baseURL/apiKeyEnv 自动生成主端点。 */
  endpoints?: OpenAiGatewayEndpointConfig[]
}

/** 聊天模型推理档位与方舟五档对齐（含 Max）。 */
const CHAT_REASONING_EFFORTS = { low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' } as const

/** 旧版默认档位（仅 low/medium/high）的序列化形态；同步时升级为五档。 */
const LEGACY_REASONING_EFFORTS = '{"low":"low","medium":"medium","high":"high"}'

/** 图片生成模型不应暴露推理档位；其余未知模型默认 1M 上下文和五档推理；Anthropic 端点按官方规格分型号定容量并暴露五档推理，adaptive 型号以 effort 档位直传（网关可落库真实档位）。 */
function defaultModelProfile(model: OpenAiDiscoveredModel, api?: OpenAiEndpointApi): Record<string, unknown> {
  const imageOnly = /(?:^|[-_/])(image|dall-e|imagen|flux|ideogram|seedream|sora)(?:[-_/]|$)/i.test(model.id) || /gpt-image/i.test(model.id)
  const multimodal = /^(gpt|o[1-9]|claude|gemini|grok|glm|qwen|kimi|moonshot|minimax|mistral|llama|phi|command|jamba|codex)/i.test(model.id)
  const anthropic = api === 'anthropic-messages'
  const capacity = anthropicModelCapacity(model.id)
  return {
    id: model.id,
    name: model.name ?? model.id,
    contextWindow: anthropic ? capacity.contextWindow : 1_000_000,
    ...(anthropic ? { maxTokens: capacity.maxTokens } : {}),
    input: imageOnly || multimodal ? ['text', 'image'] : ['text'],
    reasoningEfforts: imageOnly ? false : { ...CHAT_REASONING_EFFORTS },
    ...(anthropic && capacity.adaptive ? { compat: { forceAdaptiveThinking: true } } : {}),
  }
}

/** 按协议补齐/升级已有模型档案：Anthropic 容量缺省或仍是旧默认值（200K/32K）时按官方规格重算，adaptive 型号补 forceAdaptiveThinking 使档位以 effort 直传，旧版三档档位升级五档，Anthropic 旧默认「不暴露档位」升级五档推理；用户自定义元数据一律不动。 */
export function migrateOpenAiModelProfile(profile: Record<string, unknown>, api?: OpenAiEndpointApi): Record<string, unknown> {
  const next = { ...profile }
  const anthropic = api === 'anthropic-messages'
  const id = typeof next.id === 'string' ? next.id : ''
  const capacity = anthropicModelCapacity(id)
  if (anthropic && (next.contextWindow === undefined || next.contextWindow === ANTHROPIC_CONTEXT_WINDOW)) next.contextWindow = capacity.contextWindow
  if (anthropic && (next.maxTokens === undefined || next.maxTokens === ANTHROPIC_MAX_TOKENS)) next.maxTokens = capacity.maxTokens
  if (!anthropic && next.contextWindow === undefined) next.contextWindow = 1_000_000
  if (JSON.stringify(next.reasoningEfforts) === LEGACY_REASONING_EFFORTS) next.reasoningEfforts = { ...CHAT_REASONING_EFFORTS }
  if (anthropic && next.reasoningEfforts === false) next.reasoningEfforts = { ...CHAT_REASONING_EFFORTS }
  if (anthropic && capacity.adaptive) {
    const compat = (next.compat !== undefined && typeof next.compat === 'object' && !Array.isArray(next.compat) ? next.compat : {}) as Record<string, unknown>
    if (compat.forceAdaptiveThinking === undefined) next.compat = { ...compat, forceAdaptiveThinking: true }
  }
  return next
}

/** 同步一个端点的模型目录，保留已有模型元数据并移除已下线模型。 */
export function syncOpenAiModels(existing: Array<Record<string, unknown>>, discovered: OpenAiDiscoveredModel[], api?: OpenAiEndpointApi): { models: Array<Record<string, unknown>>; removedIds: string[] } {
  const byId = new Map<string, Record<string, unknown>>()
  for (const model of existing) {
    if (typeof model.id === 'string' && model.id !== '') byId.set(model.id, model)
  }
  const models: Array<Record<string, unknown>> = []
  const seen = new Set<string>()
  for (const model of discovered) {
    if (seen.has(model.id)) continue
    seen.add(model.id)
    const previous = byId.get(model.id)
    if (previous === undefined) { models.push(defaultModelProfile(model, api)); continue }
    models.push(migrateOpenAiModelProfile(previous, api))
  }
  const removedIds = [...byId.keys()].filter((id) => !seen.has(id))
  return { models, removedIds }
}

/** 构造端点 provider：三种协议分别交给 pi-ai 的原生适配器。 */
export function buildOpenAiEndpointProvider(endpoint: OpenAiGatewayEndpointConfig, models: Array<Record<string, unknown>>, existing?: Record<string, unknown>, displayName = 'OpenAI 中转'): Record<string, unknown> {
  const api = endpoint.api ?? 'openai-responses'
  const anthropic = api === 'anthropic-messages'
  const completions = api === 'openai-completions'
  return {
    ...(existing ?? {}),
    apiKeyEnv: endpoint.apiKeyEnv,
    displayName,
    api,
    baseURL: anthropic ? anthropicBaseURL(endpoint.baseURL) : api === 'openai-responses' ? openAiApiRoot(endpoint.baseURL) : normalizeOpenAiBaseURL(endpoint.baseURL),
    models,
    defaultContextWindow: anthropic ? ANTHROPIC_CONTEXT_WINDOW : 1_000_000,
    defaultMaxTokens: anthropic ? ANTHROPIC_MAX_TOKENS : 128_000,
    defaultInput: ['text'],
    // Anthropic OAuth 订阅通道对无缓存命中的大请求首字节可达 1~4 分钟，空闲超时放宽到 10 分钟避免 300s 误判超时后循环重试。
    ...(anthropic ? { streamIdleTimeoutMs: 600_000 } : {}),
    // 智谱 Coding Plan 使用 OpenAI Chat Completions；保留原生协议名让 pi-ai 发送 /chat/completions。
    ...(completions ? { compat: { ...(existing?.compat !== undefined && typeof existing.compat === 'object' && existing.compat !== null ? existing.compat : {}) } } : {}),
    retryPolicy: {
      mode: 'normal',
      maxRetries: 5,
      retryableCodes: ['RATE_LIMIT', 'SERVER', 'TIMEOUT', 'TRANSPORT', 'EMPTY_RESPONSE'],
      backoff: { initialDelayMs: 1_000, maxDelayMs: 120_000, jitterRatio: 0.2 },
    },
  }
}

/** 旧的单端点导出保持兼容，测试与外部调用可继续使用。 */
export function buildOpenAiProvider(config: OpenAiCapabilityConfig, models: Array<Record<string, unknown>>, existing?: Record<string, unknown>): Record<string, unknown> {
  return buildOpenAiEndpointProvider({ id: 'default', name: '主端点', baseURL: config.baseURL, apiKeyEnv: config.apiKeyEnv, ...(config.imageModel !== '' ? { imageModel: config.imageModel } : {}) }, models, existing)
}

interface ProviderSection { providers?: Record<string, Record<string, unknown>> }
interface LegacySub2ApiSection {
  baseURL?: unknown
  tools?: { generate?: { model?: unknown } }
  providers?: { openai?: { apiKeyEnv?: unknown } }
}
type SettingsMutation =
  | { op: 'set'; path: string[]; value: unknown }
  | { op: 'unset'; path: string[] }
type ProviderUpdate = { endpoint: OpenAiGatewayEndpointConfig; index: number; models: Array<Record<string, unknown>> }

/** OpenAI 中转站服务；配置对象由插件热更新流程原地刷新。 */
export class OpenAiGatewayService {
  private readonly ctx: Context
  private readonly config: OpenAiCapabilityConfig

  constructor(ctx: Context, config: OpenAiCapabilityConfig) {
    this.ctx = ctx
    this.config = config
  }

  /** 返回脱敏状态；发现遗留 Sub2API 路由时先执行一次幂等迁移。 */
  async status(): Promise<OpenAiGatewayStatus> {
    const section = this.ctx.settings.get(LLM_PI_AI_NAMESPACE) as ProviderSection | undefined
    const primary = this.endpointConfigs()[0]
    const primaryId = primary === undefined ? OPENAI_PROVIDER_ID : openAiProviderId(primary, 0)
    if (section?.providers?.[primaryId] === undefined && section?.providers?.['sub2api-openai'] !== undefined) return await this.ensureProvider()
    return await this.readStatus()
  }

  /** 只读取当前状态，不触发迁移；供 ensureProvider 避免递归调用。 */
  private async readStatus(): Promise<OpenAiGatewayStatus> {
    const endpoints = this.endpointConfigs()
    const section = this.ctx.settings.get(LLM_PI_AI_NAMESPACE) as ProviderSection | undefined
    const primary = endpoints[0]
    const primaryApiKeyEnv = primary?.apiKeyEnv ?? normalizeApiKeyEnv(this.config.apiKeyEnv)
    const credentialStatuses = await Promise.all(endpoints.map(async (endpoint) => await this.describeCredential(endpoint.apiKeyEnv)))
    const fallbackCredential = primary === undefined ? await this.describeCredential(primaryApiKeyEnv) : undefined
    const endpointStatuses: OpenAiGatewayEndpointStatus[] = endpoints.map((endpoint, index) => {
      const providerId = openAiProviderId(endpoint, index)
      const provider = section?.providers?.[providerId]
      const models = readProviderModels(provider)
      const credential = credentialStatuses[index]
      return {
        ...endpoint,
        providerId,
        credentialConfigured: credential?.configured === true,
        models: presentModels(models),
      }
    })
    const primaryProvider = primary === undefined ? undefined : section?.providers?.[openAiProviderId(primary, 0)]
    const primaryModels = readProviderModels(primaryProvider)
    const primaryCredential = fallbackCredential ?? credentialStatuses[0]
    const imageModel = primary?.imageModel ?? this.config.imageModel
    return {
      enabled: this.config.enabled,
      credentialConfigured: primaryCredential?.configured === true,
      credentialWritable: primaryCredential?.writable === true,
      providerConfigured: primaryProvider !== undefined,
      apiKeyEnv: primaryApiKeyEnv,
      baseURL: primary?.baseURL ?? this.config.baseURL,
      ...(primary?.api !== undefined ? { api: primary.api } : {}),
      ...(imageModel.trim() !== '' ? { imageModel: imageModel.trim() } : {}),
      models: presentModels(primaryModels),
      endpoints: endpointStatuses,
    }
  }

  /** 保存完整多端点列表；旧版 baseURL/apiKeyEnv/imageModel 请求仍受支持。 */
  async saveConfig(patch: OpenAiGatewayConfigPatch): Promise<OpenAiGatewayStatus> {
    const current = this.endpointConfigs()
    let endpoints: OpenAiGatewayEndpointConfig[]
    if (Array.isArray(patch.endpoints)) {
      endpoints = normalizeOpenAiEndpoints({ ...this.config, endpoints: patch.endpoints, baseURL: '', imageModel: '' })
    } else {
      const primary = current[0]
      const baseURL = patch.baseURL ?? primary?.baseURL ?? this.config.baseURL
      const apiKeyEnv = patch.apiKeyEnv ?? primary?.apiKeyEnv ?? this.config.apiKeyEnv
      const imageModel = patch.imageModel ?? primary?.imageModel ?? this.config.imageModel
      endpoints = normalizeOpenAiEndpoints({ ...this.config, endpoints: [{ id: primary?.id ?? 'default', name: primary?.name ?? '主端点', baseURL, apiKeyEnv, ...(imageModel.trim() !== '' ? { imageModel } : {}) }], baseURL, apiKeyEnv, imageModel })
    }
    const primary = endpoints[0]
    const next: OpenAiCapabilityConfig = {
      ...this.config,
      baseURL: primary?.baseURL ?? '',
      apiKeyEnv: primary?.apiKeyEnv ?? this.config.apiKeyEnv,
      imageModel: primary?.imageModel ?? '',
      endpoints,
    }
    await this.writeDevforgeConfig(next)
    Object.assign(this.config, next)
    return await this.ensureProvider()
  }

  /** 调各端点 GET /v1/models；单个端点失败时保留原路由并继续处理。 */
  async fetchModels(signal?: AbortSignal, endpointId?: string): Promise<OpenAiGatewayFetchModelsResult> {
    const configuredEndpoints = this.endpointConfigs()
    // 指定端点时必须保留其在端点列表中的原始下标：providerId 按下标映射，重排会把模型写错 provider（0.16.7 单端点获取事故）。
    const targets = configuredEndpoints.map((endpoint, index) => ({ endpoint, index }))
    const selected = endpointId === undefined ? targets : targets.filter((item) => item.endpoint.id === endpointId)
    if (endpointId !== undefined && selected.length === 0) throw new OpenAiServiceError('指定端点不存在。', 404)
    if (selected.length === 0) throw new OpenAiServiceError('请先保存至少一个 OpenAI 中转站端点。', 400)
    // 单端点获取时不得清理其它 provider：updates 只含当前端点，cleanLegacy 会把其余端点路由整个删除。
    const cleanLegacy = endpointId === undefined
    const updates: ProviderUpdate[] = []
    const results: OpenAiGatewayEndpointFetchResult[] = []
    const added: string[] = []; const removed: string[] = []; const kept: string[] = []; let total = 0
    const section = this.ctx.settings.get(LLM_PI_AI_NAMESPACE) as ProviderSection | undefined
    for (const { endpoint, index } of selected) {
      const providerId = openAiProviderId(endpoint, index)
      const existing = readProviderModels(section?.providers?.[providerId])
      try {
        const discovered = await this.client(endpoint).fetchModels(signal)
        if (discovered.length === 0) throw new OpenAiServiceError('返回 0 个模型，为防误清空已保留现有目录。', 502)
        const beforeIds = new Set(existing.map((model) => model.id).filter((id): id is string => typeof id === 'string'))
        const synced = syncOpenAiModels(existing, discovered, endpoint.api)
        const afterIds = new Set(synced.models.map((model) => model.id).filter((id): id is string => typeof id === 'string'))
        const endpointAdded = synced.models.map((model) => model.id).filter((id): id is string => typeof id === 'string' && !beforeIds.has(id))
        const endpointKept = [...beforeIds].filter((id) => afterIds.has(id))
        added.push(...endpointAdded); removed.push(...synced.removedIds); kept.push(...endpointKept); total += synced.models.length
        updates.push({ endpoint, index, models: synced.models })
        results.push({ endpointId: endpoint.id, providerId, ok: true, modelCount: synced.models.length, added: endpointAdded, removed: synced.removedIds, kept: endpointKept, retained: false })
      } catch (error) {
        const mapped = error instanceof OpenAiServiceError ? error : this.mapClientError(error)
        // 失败端点必须回写既有模型路由：否则 writeProviders 清理逻辑会把该 provider 整个删除（0.16.6 数据丢失教训）。
        if (existing.length > 0) updates.push({ endpoint, index, models: existing })
        results.push({ endpointId: endpoint.id, providerId, ok: false, modelCount: existing.length, added: [], removed: [], kept: existing.map((model) => model.id).filter((id): id is string => typeof id === 'string'), retained: true, error: endpoint.name + '：' + mapped.message })
      }
    }
    await this.writeProviders(updates, cleanLegacy)
    return { status: await this.readStatus(), results, added, removed, kept, total, succeeded: results.filter((result) => result.ok).length, failed: results.filter((result) => !result.ok).length }
  }

  /** 只替换一个端点，避免保存时覆盖其它端点配置。 */
  async saveEndpoint(endpoint: OpenAiGatewayEndpointConfig): Promise<OpenAiGatewayStatus> {
    const current = this.endpointConfigs()
    const index = current.findIndex((item) => item.id === endpoint.id)
    const endpoints = index < 0 ? [...current, endpoint] : current.map((item, itemIndex) => itemIndex === index ? endpoint : item)
    return await this.saveConfig({ endpoints })
  }

  /** 修改一个端点内单个模型的上下文窗口（及 Anthropic 端点的输出上限）；显式覆盖值优先于默认档案且同步时不会被迁移重置。 */
  async saveModelProfile(patch: OpenAiGatewayModelPatch): Promise<OpenAiGatewayStatus> {
    const endpoints = this.endpointConfigs()
    const index = endpoints.findIndex((item) => item.id === patch.endpointId)
    if (index < 0) throw new OpenAiServiceError('指定端点不存在。', 404)
    const endpoint = endpoints[index] as OpenAiGatewayEndpointConfig
    if (!Number.isInteger(patch.contextWindow) || patch.contextWindow < MIN_MODEL_CONTEXT_WINDOW || patch.contextWindow > MAX_MODEL_CAPACITY) {
      throw new OpenAiServiceError('上下文窗口必须是 ' + MIN_MODEL_CONTEXT_WINDOW + ' 到 ' + MAX_MODEL_CAPACITY + ' 之间的整数 tokens。', 400)
    }
    const anthropic = endpoint.api === 'anthropic-messages'
    if (patch.maxTokens !== undefined) {
      if (!anthropic) throw new OpenAiServiceError('只有 Anthropic Messages 端点支持按模型配置输出上限。', 400)
      if (!Number.isInteger(patch.maxTokens) || patch.maxTokens < MIN_MODEL_MAX_TOKENS || patch.maxTokens > MAX_MODEL_CAPACITY) {
        throw new OpenAiServiceError('输出上限必须是 ' + MIN_MODEL_MAX_TOKENS + ' 到 ' + MAX_MODEL_CAPACITY + ' 之间的整数 tokens。', 400)
      }
      if (patch.maxTokens > patch.contextWindow) throw new OpenAiServiceError('输出上限不能超过上下文窗口。', 400)
    }
    const section = this.ctx.settings.get(LLM_PI_AI_NAMESPACE) as ProviderSection | undefined
    const providerId = openAiProviderId(endpoint, index)
    const models = readProviderModels(section?.providers?.[providerId])
    if (!models.some((model) => model.id === patch.modelId)) throw new OpenAiServiceError('指定模型不在该端点的聊天路由里，请先获取模型。', 404)
    const nextModels = models.map((model) => model.id === patch.modelId
      ? { ...model, contextWindow: patch.contextWindow, ...(patch.maxTokens !== undefined ? { maxTokens: patch.maxTokens } : {}) }
      : model)
    // cleanLegacy=false：单模型容量修改不得牵动其它端点路由。
    await this.writeProviders([{ endpoint, index, models: nextModels }], false)
    return await this.readStatus()
  }

  /** 启动时迁移旧 Sub2API OpenAI 配置并建立所有端点路由。 */
  async ensureProvider(): Promise<OpenAiGatewayStatus> {
    const migration = this.readLegacyConfig()
    const endpoints = this.endpointConfigs()
    const section = this.ctx.settings.get(LLM_PI_AI_NAMESPACE) as ProviderSection | undefined
    const providers = section?.providers ?? {}
    const legacyProvider = providers['sub2api-openai']
    const legacyModels = readProviderModels(legacyProvider)
    const updates: ProviderUpdate[] = endpoints.map((endpoint, index) => {
      const existing = providers[openAiProviderId(endpoint, index)]
      const currentModels = readProviderModels(existing)
      // 启动即迁移存量模型档案（Anthropic 补输出上限并升级五档推理），升级插件后无需重新拉取模型。
      const models = (currentModels.length > 0 ? currentModels : index === 0 ? legacyModels : []).map((model) => migrateOpenAiModelProfile(model, endpoint.api))
      return { endpoint, index, models }
    })
    const managedPresent = Object.keys(providers).some((id) => id === OPENAI_PROVIDER_ID || id.startsWith(ENDPOINT_PROVIDER_PREFIX) || (LEGACY_PROVIDER_IDS as readonly string[]).includes(id))
    if (updates.some((item) => item.models.length > 0) || managedPresent) await this.writeProviders(updates, true)
    if (migration.changed) await this.writeDevforgeConfig(this.config)
    return await this.readStatus()
  }

  /** 供 generate_image 调用：优先选择配置了生图模型的端点，否则使用主端点。 */
  async generateImage(args: { prompt: string; size?: string; quality?: string }, signal?: AbortSignal, maxBytes?: number): Promise<OpenAiGeneratedImage> {
    const endpoints = this.endpointConfigs()
    const endpoint = endpoints.find((item) => typeof item.imageModel === 'string' && item.imageModel.trim() !== '') ?? endpoints[0]
    const model = endpoint?.imageModel?.trim() ?? ''
    if (endpoint === undefined || model === '') throw new OpenAiServiceError('尚未选择 OpenAI 中转站生图模型。', 400)
    try { return await this.client(endpoint).generateImage({ ...args, model }, signal, maxBytes) } catch (error) { throw this.mapClientError(error) }
  }

  /** 规范化当前配置，兼容旧的单端点字段。 */
  private endpointConfigs(): OpenAiGatewayEndpointConfig[] { return normalizeOpenAiEndpoints(this.config) }

  /** 构造凭据引用并校验格式。 */
  private reference(apiKeyEnv = this.config.apiKeyEnv): ReturnType<typeof credentialRef> { return credentialRef(normalizeApiKeyEnv(apiKeyEnv)) }

  private async describeCredential(apiKeyEnv: string): Promise<{ configured: boolean; writable: boolean }> {
    const result = await this.ctx.credentials.describe(this.reference(apiKeyEnv))
    return { configured: result.configured === true, writable: result.writable === true }
  }

  /** 每次请求重新解析指定端点的凭据，Key 覆盖后无需重启。 */
  private async resolveApiKey(apiKeyEnv: string): Promise<string> {
    const resolved = await this.ctx.credentials.resolve(this.reference(apiKeyEnv))
    const value = resolved?.value.trim() ?? ''
    if (value === '') throw new OpenAiServiceError('尚未配置 OpenAI 中转站 API Key。', 400)
    return value
  }

  /** 创建指定端点的无状态 HTTP 客户端；模型发现与生图只使用 OpenAI 兼容路径。 */
  private client(endpoint: OpenAiGatewayEndpointConfig): OpenAiGatewayClient {
    const api = endpoint.api === 'openai-completions' ? 'openai-completions' : 'openai-responses'
    return new OpenAiGatewayClient(endpoint.baseURL, () => this.resolveApiKey(endpoint.apiKeyEnv), this.config.timeoutMs, api)
  }

  /** 把旧 llm-sub2api 或其 llm-pi-ai Provider 映射到天工造梦；不读取或复制 Key 明文。 */
  private readLegacyConfig(): { provider?: Record<string, unknown>; changed: boolean } {
    const legacy = this.ctx.settings.get(LEGACY_SUB2API_NAMESPACE) as LegacySub2ApiSection | undefined
    const llm = this.ctx.settings.get(LLM_PI_AI_NAMESPACE) as ProviderSection | undefined
    const legacyProvider = llm?.providers?.['sub2api-openai']
    const hasLegacy = legacy !== undefined || legacyProvider !== undefined
    const currentBaseURL = typeof this.config.baseURL === 'string' ? this.config.baseURL.trim() : ''
    if (!hasLegacy) {
      if (this.config.endpoints === undefined && currentBaseURL !== '') {
        const endpoint = normalizeOpenAiEndpoints(this.config)[0]
        if (endpoint !== undefined) {
          const next = { ...this.config, baseURL: endpoint.baseURL, apiKeyEnv: endpoint.apiKeyEnv, imageModel: endpoint.imageModel ?? '', endpoints: [endpoint] }
          const changed = !deepEqualJson(next, this.config)
          if (changed) Object.assign(this.config, next)
          return { changed }
        }
      }
      return { changed: false }
    }
    const providerBaseURL = typeof legacyProvider?.baseURL === 'string' ? legacyProvider.baseURL.replace(/\/v1\/?$/i, '') : ''
    const baseURL = currentBaseURL !== '' ? normalizeEndpointBaseURL(currentBaseURL) : typeof legacy?.baseURL === 'string' ? normalizeEndpointBaseURL(legacy.baseURL) : normalizeEndpointBaseURL(providerBaseURL)
    const legacyApiKeyEnv = legacy?.providers?.openai?.apiKeyEnv
    const providerApiKeyEnv = legacyProvider?.apiKeyEnv
    const apiKeyEnv = this.config.apiKeyEnv !== DEFAULT_API_KEY_ENV
      ? this.config.apiKeyEnv
      : typeof legacyApiKeyEnv === 'string' && legacyApiKeyEnv !== ''
        ? legacyApiKeyEnv
        : typeof providerApiKeyEnv === 'string' && providerApiKeyEnv !== '' ? providerApiKeyEnv : this.config.apiKeyEnv
    const legacyImageModel = legacy?.tools?.generate?.model
    const providerModels = readProviderModels(legacyProvider)
    const inferredImageModel = providerModels.map((model) => typeof model.id === 'string' ? model.id : '').find((id) => /gpt-image|dall-e|imagen|flux|seedream/i.test(id)) ?? ''
    const imageModel = this.config.imageModel !== '' ? this.config.imageModel : typeof legacyImageModel === 'string' && legacyImageModel !== '' ? legacyImageModel : inferredImageModel
    const endpoint: OpenAiGatewayEndpointConfig = { id: 'default', name: '主端点', baseURL, apiKeyEnv: normalizeApiKeyEnv(apiKeyEnv), ...(imageModel !== '' ? { imageModel } : {}) }
    const next: OpenAiCapabilityConfig = { ...this.config, baseURL, apiKeyEnv: endpoint.apiKeyEnv, imageModel, endpoints: this.config.endpoints ?? [endpoint] }
    const changed = !deepEqualJson(next, this.config)
    if (changed) Object.assign(this.config, next)
    return { ...(legacyProvider !== undefined ? { provider: legacyProvider } : {}), changed }
  }

  /** 写 openai 配置：store.db 主写，宿主段可用时双写触发热更新。 */
  private async writeDevforgeConfig(next: OpenAiCapabilityConfig): Promise<void> {
    try { putSettings(getDb(), 'openai.settings', next) } catch (error) { this.ctx.logger?.warn?.('[dsh-devforge] openai 配置写入 store.db 失败：%s', error instanceof Error ? error.message : String(error)) }
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const descriptor = this.ctx.settings.describe().find((item) => item.ns === DEVFORGE_NAMESPACE)
      if (descriptor === undefined) {
        this.ctx.logger?.warn?.('[dsh-devforge] 宿主设置段未就绪，openai 配置仅存 store.db（面板与路由照常工作）')
        return
      }
      const current = descriptor.value as { openai?: Record<string, unknown> } | undefined
      const value = { ...(current?.openai ?? {}), ...next }
      if (deepEqualJson(value, current?.openai)) return
      try {
        await this.ctx.settings.mutate(DEVFORGE_NAMESPACE, [{ op: 'set', path: ['openai'], value }], descriptor.revision)
        return
      } catch (error) {
        if (error instanceof SettingsConflictError) {
          if (attempt === 1) { this.ctx.logger?.warn?.('[dsh-devforge] 中转站配置并发更新，已保留 store.db 结果'); return }
          continue
        }
        this.ctx.logger?.warn?.('[dsh-devforge] 宿主设置段写入失败，已保留 store.db 结果：%s', error instanceof Error ? error.message : String(error))
        return
      }
    }
  }

  /** 原子写所有新 provider，并清理已删除端点与旧 Sub2API 路由。 */
  private async writeProviders(updates: ProviderUpdate[], cleanLegacy: boolean): Promise<void> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const descriptor = this.ctx.settings.describe().find((item) => item.ns === LLM_PI_AI_NAMESPACE)
      if (descriptor === undefined) throw new OpenAiServiceError('DSH 模型设置服务尚未注册 llm-pi-ai。', 409)
      const current = descriptor.value as ProviderSection | undefined
      const providers = current?.providers ?? {}
      const mutations: SettingsMutation[] = []
      const desired = new Set<string>()
      for (const update of updates) {
        const providerId = openAiProviderId(update.endpoint, update.index)
        if (update.models.length === 0) {
          if (providers[providerId] !== undefined) mutations.push({ op: 'unset', path: ['providers', providerId] })
          continue
        }
        desired.add(providerId)
        const provider = buildOpenAiEndpointProvider(update.endpoint, update.models, providers[providerId], update.index === 0 ? 'OpenAI 中转' : 'OpenAI 中转 · ' + update.endpoint.name)
        if (!deepEqualJson(provider, providers[providerId])) mutations.push({ op: 'set', path: ['providers', providerId], value: provider })
      }
      if (cleanLegacy) {
        for (const id of Object.keys(providers)) {
          const isLegacy = (LEGACY_PROVIDER_IDS as readonly string[]).includes(id)
          const isManaged = id === OPENAI_PROVIDER_ID || id.startsWith(ENDPOINT_PROVIDER_PREFIX)
          if ((isLegacy || isManaged) && !desired.has(id) && !mutations.some((mutation) => mutation.op === 'unset' && mutation.path[1] === id)) mutations.push({ op: 'unset', path: ['providers', id] })
        }
      }
      if (mutations.length === 0) return
      try {
        await this.ctx.settings.mutate(LLM_PI_AI_NAMESPACE, mutations, descriptor.revision)
        return
      } catch (error) {
        if (error instanceof SettingsConflictError) {
          if (attempt === 1) throw new OpenAiServiceError('模型设置并发更新，请重试。', 409)
          continue
        }
        throw error
      }
    }
  }

  /** 统一映射客户端错误，避免把内部请求细节返回页面。 */
  private mapClientError(error: unknown): OpenAiServiceError {
    if (error instanceof OpenAiServiceError) return error
    if (error instanceof OpenAiGatewayError) return new OpenAiServiceError(error.message, error.status)
    return new OpenAiServiceError('OpenAI 中转站服务发生内部错误。')
  }
}

function readProviderModels(provider: Record<string, unknown> | undefined): Array<Record<string, unknown>> {
  return Array.isArray(provider?.models) ? provider.models as Array<Record<string, unknown>> : []
}

/** 模型容量的可保存区间（tokens）：下限防呆、上限防手滑多敲零。 */
const MIN_MODEL_CONTEXT_WINDOW = 1024
const MIN_MODEL_MAX_TOKENS = 256
const MAX_MODEL_CAPACITY = 4_000_000

function presentModels(models: Array<Record<string, unknown>>): OpenAiGatewayModelInfo[] {
  return models
    .map((model) => ({
      id: typeof model.id === 'string' ? model.id : '',
      ...(typeof model.name === 'string' && model.name !== '' ? { name: model.name } : {}),
      configured: typeof model.id === 'string' && model.id !== '',
      ...(Number.isInteger(model.contextWindow as number) ? { contextWindow: model.contextWindow as number } : {}),
      ...(Number.isInteger(model.maxTokens as number) ? { maxTokens: model.maxTokens as number } : {}),
    }))
    .filter((model) => model.id !== '')
}
