/** OpenAI 兼容中转站：配置迁移、模型发现与 llm-pi-ai 路由同步。 */
import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { SettingsConflictError, settingsNamespace } from '@deepseek-ai/dsh-settings'
import { deepEqualJson } from '../provider-settings.ts'
import { normalizeOpenAiBaseURL, openAiApiRoot, OpenAiGatewayClient, OpenAiGatewayError, type OpenAiDiscoveredModel, type OpenAiGeneratedImage } from './api-client.ts'
import type { OpenAiGatewayConfigPatch, OpenAiGatewayStatus } from './protocol.ts'

const LLM_PI_AI_NAMESPACE = settingsNamespace('llm-pi-ai')
const DEVFORGE_NAMESPACE = settingsNamespace('dsh-devforge')
const LEGACY_SUB2API_NAMESPACE = settingsNamespace('llm-sub2api')
export const OPENAI_PROVIDER_ID = 'openai-gateway'
const LEGACY_PROVIDER_IDS = ['sub2api-openai', 'sub2api-claude', 'sub2api-grok', 'sub2api-gemini'] as const
const DEFAULT_API_KEY_ENV = 'OPENAI_GATEWAY_API_KEY'

/** OpenAI 中转能力配置；仅保存凭据引用，不保存 Key 明文。 */
export interface OpenAiCapabilityConfig {
  enabled: boolean
  baseURL: string
  apiKeyEnv: string
  imageModel: string
  timeoutMs: number
}

/** 可直接呈现给面板的分类错误。 */
export class OpenAiServiceError extends Error {
  readonly status: number

  constructor(message: string, status = 502) {
    super(message)
    this.name = 'OpenAiServiceError'
    this.status = status
  }
}

/** 图片生成模型不应暴露推理档位；其余未知模型使用兼容性较高的默认档位。 */
function defaultModelProfile(model: OpenAiDiscoveredModel): Record<string, unknown> {
  const imageOnly = /(?:^|[-_/])(image|dall-e|imagen|flux|ideogram|seedream|sora)(?:[-_/]|$)/i.test(model.id) || /gpt-image/i.test(model.id)
  const multimodal = /^(gpt|o[1-9]|claude|gemini|grok|glm|qwen|kimi|moonshot|minimax|mistral|llama|phi|command|jamba|codex)/i.test(model.id)
  return {
    id: model.id,
    name: model.name ?? model.id,
    input: imageOnly || multimodal ? ['text', 'image'] : ['text'],
    reasoningEfforts: imageOnly ? false : { low: 'low', medium: 'medium', high: 'high' },
  }
}

/** 合并新发现模型：保留已有模型的上下文、模态和推理档位，只追加缺失 id。 */
export function mergeOpenAiModels(existing: Array<Record<string, unknown>>, discovered: OpenAiDiscoveredModel[]): Array<Record<string, unknown>> {
  const result = existing.map((model) => ({ ...model }))
  const ids = new Set(result.map((model) => model.id).filter((id): id is string => typeof id === 'string'))
  for (const model of discovered) {
    if (ids.has(model.id)) continue
    ids.add(model.id)
    result.push(defaultModelProfile(model))
  }
  return result
}

/** 构造 llm-pi-ai 的 OpenAI Responses 路由，复用 DSH 内置协议适配器。 */
export function buildOpenAiProvider(config: OpenAiCapabilityConfig, models: Array<Record<string, unknown>>, existing?: Record<string, unknown>): Record<string, unknown> {
  return {
    ...(existing ?? {}),
    apiKeyEnv: config.apiKeyEnv,
    displayName: 'OpenAI 中转',
    api: 'openai-responses',
    baseURL: openAiApiRoot(config.baseURL),
    models,
    defaultContextWindow: 128_000,
    defaultMaxTokens: 8_192,
    defaultInput: ['text'],
    retryPolicy: {
      mode: 'normal',
      maxRetries: 5,
      retryableCodes: ['RATE_LIMIT', 'SERVER', 'TIMEOUT', 'TRANSPORT', 'EMPTY_RESPONSE'],
      backoff: { initialDelayMs: 1_000, maxDelayMs: 120_000, jitterRatio: 0.2 },
    },
  }
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

/** OpenAI 中转站服务；配置对象由插件热更新流程原地刷新。 */
export class OpenAiGatewayService {
  private readonly ctx: Context
  private readonly config: OpenAiCapabilityConfig

  constructor(ctx: Context, config: OpenAiCapabilityConfig) {
    this.ctx = ctx
    this.config = config
  }

  /** 返回中转站配置、凭据和模型路由的脱敏状态。 */
  async status(): Promise<OpenAiGatewayStatus> {
    const credential = await this.ctx.credentials.describe(this.reference())
    const section = this.ctx.settings.get(LLM_PI_AI_NAMESPACE) as ProviderSection | undefined
    const provider = section?.providers?.[OPENAI_PROVIDER_ID]
    const models = Array.isArray(provider?.models) ? provider.models as Array<Record<string, unknown>> : []
    return {
      enabled: this.config.enabled,
      credentialConfigured: credential.configured,
      credentialWritable: credential.writable,
      providerConfigured: provider !== undefined,
      apiKeyEnv: this.config.apiKeyEnv,
      baseURL: this.config.baseURL,
      ...(this.config.imageModel !== '' ? { imageModel: this.config.imageModel } : {}),
      models: models
        .map((model) => ({
          id: typeof model.id === 'string' ? model.id : '',
          ...(typeof model.name === 'string' && model.name !== '' ? { name: model.name } : {}),
          configured: typeof model.id === 'string' && model.id !== '',
        }))
        .filter((model) => model.id !== ''),
    }
  }

  /** 保存中转站地址和生图模型；API Key 由通用受管凭据接口单独写入。 */
  async saveConfig(patch: OpenAiGatewayConfigPatch): Promise<OpenAiGatewayStatus> {
    const baseURL = normalizeOpenAiBaseURL(patch.baseURL)
    if (baseURL === '') throw new OpenAiServiceError('中转站地址不能为空。', 400)
    const imageModel = typeof patch.imageModel === 'string' ? patch.imageModel.trim() : this.config.imageModel
    await this.writeDevforgeConfig({ ...this.config, baseURL, imageModel })
    Object.assign(this.config, { baseURL, imageModel })
    return await this.ensureProvider()
  }

  /** 调 GET /v1/models，把模型合并进 OpenAI 中转聊天路由。 */
  async fetchModels(signal?: AbortSignal): Promise<{ status: OpenAiGatewayStatus; added: string[]; kept: string[]; total: number }> {
    if (this.config.baseURL.trim() === '') throw new OpenAiServiceError('请先保存 OpenAI 中转站地址。', 400)
    const client = this.client()
    let discovered: OpenAiDiscoveredModel[]
    try { discovered = await client.fetchModels(signal) } catch (error) { throw this.mapClientError(error) }
    const section = this.ctx.settings.get(LLM_PI_AI_NAMESPACE) as ProviderSection | undefined
    const provider = section?.providers?.[OPENAI_PROVIDER_ID]
    const existing = Array.isArray(provider?.models) ? provider.models as Array<Record<string, unknown>> : []
    const beforeIds = new Set(existing.map((model) => model.id).filter((id): id is string => typeof id === 'string'))
    const models = mergeOpenAiModels(existing, discovered)
    await this.writeProvider(models, true)
    const added = models.map((model) => model.id).filter((id): id is string => typeof id === 'string' && !beforeIds.has(id))
    return { status: await this.status(), added, kept: [...beforeIds], total: models.length }
  }

  /** 启动时迁移旧 Sub2API OpenAI 配置并建立新路由；只迁移凭据引用。 */
  async ensureProvider(): Promise<OpenAiGatewayStatus> {
    const legacyProvider = await this.importLegacyConfig()
    const section = this.ctx.settings.get(LLM_PI_AI_NAMESPACE) as ProviderSection | undefined
    const current = section?.providers?.[OPENAI_PROVIDER_ID]
    const currentModels = Array.isArray(current?.models) ? current.models as Array<Record<string, unknown>> : []
    const legacyModels = Array.isArray(legacyProvider?.models) ? legacyProvider.models as Array<Record<string, unknown>> : []
    const models = currentModels.length > 0 ? currentModels : legacyModels
    if (this.config.baseURL.trim() !== '' && models.length > 0) await this.writeProvider(models, true)
    return await this.status()
  }

  /** 供 generate_image 调用；模型来自面板选择，不接受工具参数覆盖。 */
  async generateImage(args: { prompt: string; size?: string; quality?: string }, signal?: AbortSignal, maxBytes?: number): Promise<OpenAiGeneratedImage> {
    const model = this.config.imageModel.trim()
    if (model === '') throw new OpenAiServiceError('尚未选择 OpenAI 中转站生图模型。', 400)
    try { return await this.client().generateImage({ ...args, model }, signal, maxBytes) } catch (error) { throw this.mapClientError(error) }
  }

  /** 构造凭据引用并校验格式。 */
  private reference(): ReturnType<typeof credentialRef> {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(this.config.apiKeyEnv)) throw new OpenAiServiceError('OpenAI 中转凭据引用格式无效。', 400)
    return credentialRef(this.config.apiKeyEnv)
  }

  /** 每次请求重新解析凭据，Key 覆盖后无需重启。 */
  private async resolveApiKey(): Promise<string> {
    const resolved = await this.ctx.credentials.resolve(this.reference())
    const value = resolved?.value.trim() ?? ''
    if (value === '') throw new OpenAiServiceError('尚未配置 OpenAI 中转站 API Key。', 400)
    return value
  }

  /** 创建无状态 HTTP 客户端。 */
  private client(): OpenAiGatewayClient {
    return new OpenAiGatewayClient(this.config.baseURL, () => this.resolveApiKey(), this.config.timeoutMs)
  }

  /** 把旧 llm-sub2api 配置映射到天工造梦；不读取或复制 Key 明文。 */
  private async importLegacyConfig(): Promise<Record<string, unknown> | undefined> {
    const legacy = this.ctx.settings.get(LEGACY_SUB2API_NAMESPACE) as LegacySub2ApiSection | undefined
    const llm = this.ctx.settings.get(LLM_PI_AI_NAMESPACE) as ProviderSection | undefined
    const legacyProvider = llm?.providers?.['sub2api-openai']
    if (legacy === undefined && legacyProvider === undefined) return undefined
    const baseURL = this.config.baseURL !== ''
      ? this.config.baseURL
      : typeof legacy?.baseURL === 'string' ? normalizeOpenAiBaseURL(legacy.baseURL) : ''
    const legacyApiKeyEnv = legacy?.providers?.openai?.apiKeyEnv
    const apiKeyEnv = this.config.apiKeyEnv !== DEFAULT_API_KEY_ENV
      ? this.config.apiKeyEnv
      : typeof legacyApiKeyEnv === 'string' && legacyApiKeyEnv !== '' ? legacyApiKeyEnv : this.config.apiKeyEnv
    const legacyImageModel = legacy?.tools?.generate?.model
    const imageModel = this.config.imageModel !== ''
      ? this.config.imageModel
      : typeof legacyImageModel === 'string' ? legacyImageModel : ''
    const next = { ...this.config, baseURL, apiKeyEnv, imageModel }
    if (!deepEqualJson(next, this.config)) {
      await this.writeDevforgeConfig(next)
      Object.assign(this.config, next)
    }
    return legacyProvider
  }

  /** 写 dsh-devforge.openai 配置；并发冲突时按最新 revision 重试一次。 */
  private async writeDevforgeConfig(next: OpenAiCapabilityConfig): Promise<void> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const descriptor = this.ctx.settings.describe().find((item) => item.ns === DEVFORGE_NAMESPACE)
      if (descriptor === undefined) throw new OpenAiServiceError('天工造梦设置服务尚未就绪。', 409)
      const current = descriptor.value as { openai?: Record<string, unknown> } | undefined
      const value = { ...(current?.openai ?? {}), ...next }
      if (deepEqualJson(value, current?.openai)) return
      try {
        await this.ctx.settings.mutate(DEVFORGE_NAMESPACE, [{ op: 'set', path: ['openai'], value }], descriptor.revision)
        return
      } catch (error) {
        if (error instanceof SettingsConflictError) {
          if (attempt === 1) throw new OpenAiServiceError('中转站配置并发更新，请重试。', 409)
          continue
        }
        throw error
      }
    }
  }

  /** 原子写新 provider，并清理旧插件遗留的四条 sub2api 路由。 */
  private async writeProvider(models: Array<Record<string, unknown>>, cleanLegacy: boolean): Promise<void> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const descriptor = this.ctx.settings.describe().find((item) => item.ns === LLM_PI_AI_NAMESPACE)
      if (descriptor === undefined) throw new OpenAiServiceError('DSH 模型设置服务尚未注册 llm-pi-ai。', 409)
      const current = descriptor.value as ProviderSection | undefined
      const existing = current?.providers?.[OPENAI_PROVIDER_ID]
      const provider = buildOpenAiProvider(this.config, models, existing)
      const mutations: SettingsMutation[] = []
      if (!deepEqualJson(provider, existing)) mutations.push({ op: 'set', path: ['providers', OPENAI_PROVIDER_ID], value: provider })
      if (cleanLegacy) {
        for (const id of LEGACY_PROVIDER_IDS) {
          if (current?.providers?.[id] !== undefined) mutations.push({ op: 'unset', path: ['providers', id] })
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
