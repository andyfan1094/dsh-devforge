/**
 * 记忆模型路由解析（0.43.0 ·「天工造梦一套」定稿）。
 *
 * 背景（2026-10-10 生产实况）：
 * memory.settings 的 dreamProvider/dreamModel 与 sedimentProvider/sedimentModel 是历史遗留的
 * 「专用裁决路由」手工覆盖字段（缺省空串 = 跟随宿主默认模型）。存量安装里这两个字段曾被指到
 * minimax-cn + MiniMax-M2.7-highspeed；当该 provider 在宿主侧没有注册 adapter 时，
 * generateText 会把请求的 provider 原样直传 llm.stream → 报
 * `no adapter registered for provider "minimax-cn"`：做梦整理整轮失败，面板只看到
 * 「裁决模型调用失败」，根因离现象很远（归档/合并长期为 0，记忆库只增不减）。
 *
 * 定稿（辉哥 2026-10-10）：「天工造梦一套」——用户装了插件、登录官网账号，
 * 模型路由一律缺省跟随宿主默认（登录官网即 tiangong 原生 provider），
 * 记忆提炼/裁决不该再要求用户单独配服务商。
 *
 * 因此把「请求路由 → 实际可用路由」收成一个纯函数，口径三条：
 * ① 请求为空 → 跟随宿主默认（正常路径，不算回退）；
 * ② 请求的 provider 不在宿主目录、或该 provider 下没有可用模型 → 回退宿主默认，
 *    并给出中文原因（写进审计与日志）——**回退必须可见，绝不静默**；
 * ③ 宿主默认也不可用 → 返回空路由，由调用方以明确原因落 failed（绝不假装成功）。
 */

/** 宿主默认模型未就绪时的统一原因（面板/审计直接展示）。 */
export const MEMORY_ROUTE_NO_DEFAULT = '宿主默认模型未就绪（请先在 DSH 设置中选择默认模型）'

/** 一次模型路由解析结果。 */
export interface MemoryModelRoute {
  /** 实际使用的服务商（空串 = 不可用）。 */
  provider: string
  /** 实际使用的模型（空串 = 不可用）。 */
  model: string
  /** true = 请求的路由不可用，已回退到宿主默认。 */
  fellBack: boolean
  /** 回退原因（中文，可直接落审计/日志）；未回退时为空串。 */
  reason: string
  /** 原始请求值（审计留痕用，便于看清「面板上填了什么」）。 */
  requestedProvider: string
  requestedModel: string
}

/** resolveMemoryModelRoute 入参。 */
export interface MemoryModelRouteInput {
  /** 面板请求的服务商（空串 = 跟随宿主默认）。 */
  requestedProvider: string
  /** 面板请求的模型（空串 = 跟随该服务商的可用模型）。 */
  requestedModel: string
  /** 宿主当前可用 provider 目录：服务商 id → 该服务商可用模型 id 列表。 */
  catalog: ReadonlyMap<string, readonly string[]>
  /** 宿主默认路由（agent-default-model 当前选择）。 */
  fallbackProvider: string
  fallbackModel: string
}

/** 拼 «provider:model» 展示串（任一为空给空串）。 */
export function formatMemoryRoute(provider: string, model: string): string {
  if (provider === '' || model === '') return ''
  return provider + ':' + model
}

/**
 * 解析记忆场景的实际模型路由。纯函数：不读全局、不抛错，全部判定显式。
 * 不可用时**一定**回退宿主默认并带上原因，让「配置出错」在审计里一眼可见。
 */
export function resolveMemoryModelRoute(input: MemoryModelRouteInput): MemoryModelRoute {
  const requestedProvider = input.requestedProvider.trim()
  const requestedModel = input.requestedModel.trim()
  const fallbackProvider = input.fallbackProvider.trim()
  const fallbackModel = input.fallbackModel.trim()
  const base = { requestedProvider, requestedModel }

  /** 回退到宿主默认，附原因。 */
  const fallback = (reason: string): MemoryModelRoute => ({
    ...base,
    provider: fallbackProvider,
    model: fallbackModel,
    fellBack: true,
    reason: fallbackProvider === '' || fallbackModel === ''
      ? reason + '；' + MEMORY_ROUTE_NO_DEFAULT
      : reason + '；已回退到宿主默认 ' + formatMemoryRoute(fallbackProvider, fallbackModel),
  })

  // ① 未指定服务商：正常跟随宿主默认（不算回退）。
  if (requestedProvider === '') {
    return { ...base, provider: fallbackProvider, model: fallbackModel, fellBack: false, reason: '' }
  }

  // ② 服务商不在宿主目录：典型「配了 minimax-cn 但 adapter 未注册」。
  const models = input.catalog.get(requestedProvider)
  if (models === undefined) {
    return fallback('记忆设置里的服务商「' + requestedProvider + '」当前不可用（不在宿主模型目录中）')
  }

  // ③ 服务商可用：模型缺省取该服务商首个可用模型。
  if (models.length === 0) {
    return fallback('记忆设置里的服务商「' + requestedProvider + '」下没有任何可用模型')
  }
  if (requestedModel === '') {
    return { ...base, provider: requestedProvider, model: models[0]!, fellBack: false, reason: '' }
  }

  // ④ 指定了模型但该服务商下没有：回退宿主默认（不猜「相近模型」）。
  if (!models.includes(requestedModel)) {
    return fallback('记忆设置里的模型「' + requestedProvider + ':' + requestedModel + '」不在该服务商的可用模型列表中')
  }

  return { ...base, provider: requestedProvider, model: requestedModel, fellBack: false, reason: '' }
}

/**
 * 从 llm-pi-ai 设置段解析可用 provider 目录（服务商 id → 模型 id 列表）。
 * 结构异常一律返回空表（调用方据此走「宿主默认」路径，不因脏结构炸掉记忆链路）。
 */
export function modelCatalogFromSection(section: unknown): Map<string, string[]> {
  const catalog = new Map<string, string[]>()
  if (section === null || typeof section !== 'object') return catalog
  const providers = (section as { providers?: unknown }).providers
  if (providers === null || typeof providers !== 'object') return catalog
  for (const [id, value] of Object.entries(providers as Record<string, unknown>)) {
    if (value === null || typeof value !== 'object') continue
    const models = (value as { models?: unknown }).models
    const ids: string[] = []
    if (Array.isArray(models)) {
      for (const model of models) {
        if (model === null || typeof model !== 'object') continue
        const modelId = (model as { id?: unknown }).id
        if (typeof modelId === 'string' && modelId.trim() !== '') ids.push(modelId.trim())
      }
    }
    catalog.set(id, ids)
  }
  return catalog
}
