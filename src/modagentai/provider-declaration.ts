/**
 * 天工造梦原生 provider 声明常量与档位判定（独立成模块便于单测，
 * 避免 service.ts 的运行时依赖链进入测试环境）。
 */

/** 天工造梦 GLM-Flash 支持的推理档位（与方舟上游五档对齐；辉哥 2026-09-22 确认补 xhigh/max）。 */
export const TIANGONG_REASONING_EFFORTS = { low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' } as const

/** 天工造梦中转对外 DeepSeek 模型 id（辉哥 2026-09-27 定名；上游真实模型 deepseek-v4-1-flash-260910）。 */
export const TIANGONG_DEEPSEEK_MODEL_ID = 'DeepSeek V4.1 Flash'

/** DeepSeek V4.1 Flash 支持的思考档位（上游仅 low/high/max；官方 effort 映射 medium/xhigh→high）。 */
export const TIANGONG_DEEPSEEK_EFFORTS = { low: 'low', high: 'high', max: 'max' } as const

/**
 * 天工造梦中转对外 Kimi 模型 id（辉哥 2026-10-12 起对外提供）。
 * 站点侧 GATEWAY_MODEL_MAP 同名透传（Kimi-K3:Kimi-K3），再由 ark-gateway 的
 * workbuddy 池映射为上游真实模型 cn:kimi-k3-1。
 */
export const TIANGONG_KIMI_MODEL_ID = 'Kimi-K3'

/** Kimi-K3 支持的思考档位（上游同为 low/high/max，故与 DeepSeek 档位一致）。 */
export const TIANGONG_KIMI_EFFORTS = { low: 'low', high: 'high', max: 'max' } as const

/**
 * 登录官网后写入的三个模型（GLM-Flash、DeepSeek V4.1 Flash、Kimi-K3）的上下文窗口。
 * 辉哥 2026-10-19 定稿：由 200K 提到 300K。三个模型的上游容量实测均为 1M
 * （wb2api/CodeBuddy GET /v1/models：cn:deepseek-v4.1-flash、cn:kimi-k3-1、cn:glm-5.3-flash），
 * 并已用 30 万级真实请求端到端打通（上游直接认可 32 万~65 万 token 的输入）；
 * 故 300K 仍属刻意低报，只保留「够用且控消耗」的额度，不声明上游满额的 1M。
 * 历史：2026-10-10 由 256K 压到 200K（压消耗），2026-10-12 补 Kimi-K3 时同样按惯例低报。
 */
export const TIANGONG_CONTEXT_WINDOW = 300_000

/**
 * 历史版本声明过的上下文窗口：256K=262144（2026-09-22 起）、200K=200000（2026-10-10 起）。
 * 已安装插件升级后，声明里若仍留着这些旧值，启动自愈会自动改写为 TIANGONG_CONTEXT_WINDOW；
 * 只认列在这里的历史值，用户在设置里手动改成别的容量不会被启动流程覆盖。
 */
export const TIANGONG_LEGACY_CONTEXT_WINDOWS: readonly number[] = [262_144, 200_000]

/** 登录时写入的模型 id 清单（容量比对与落后判定按此逐条进行）。 */
export const TIANGONG_DECLARED_MODEL_IDS: readonly string[] = [
  'GLM-Flash',
  TIANGONG_DEEPSEEK_MODEL_ID,
  TIANGONG_KIMI_MODEL_ID,
]

/**
 * 天工造梦 provider 使用的聊天协议（辉哥 2026-10-18 定稿）：
 * 官网网关在既有 OpenAI 兼容端点之外新增 /api/gw/v1/messages，
 * 插件改为按 Anthropic Messages 调用；官网仍保留 OpenAI 端点作回退，两条协议互不影响。
 */
export const TIANGONG_PROTOCOL = 'anthropic-messages' as const

/**
 * 官网站点网关基址前缀。
 * Anthropic 适配器会自行拼 /v1/messages，故 provider 的 baseURL 用不带 /v1 的前缀；
 * 旧版注入的是 {前缀}/v1（OpenAI 兼容），启动自愈据此识别并改写。
 */
export const TIANGONG_GATEWAY_PREFIX = 'https://modagentai.com/api/gw'

/**
 * 判断已注册声明的聊天协议是否仍是旧版 OpenAI 兼容组合。
 * 只认「旧组合」（协议不是 anthropic-messages 且基址指向本站旧网关）——
 * 用户把端点改成第三方地址或自定义协议时，不会被启动自愈覆盖。
 * 未注册或结构异常返回 false（交给迁移/注册流程处理）。
 */
export function tiangongProtocolOutdated(provider: unknown): boolean {
  if (provider === undefined || provider === null || typeof provider !== 'object') return false
  const section = provider as { api?: unknown; baseURL?: unknown }
  const api = typeof section.api === 'string' ? section.api : ''
  if (api === TIANGONG_PROTOCOL) return false
  const baseURL = typeof section.baseURL === 'string' ? section.baseURL : ''
  return baseURL.startsWith(TIANGONG_GATEWAY_PREFIX)
}

/** 判断已注册的 tiangong provider 声明是否缺少新推理档位（xhigh/max）；未注册或结构异常返回 false。 */
export function tiangongEffortsOutdated(provider: unknown): boolean {
  if (provider === undefined || provider === null || typeof provider !== 'object') return false
  const models = (provider as { models?: unknown }).models
  if (!Array.isArray(models)) return false
  const flash = models.find((m) => m !== null && typeof m === 'object' && (m as { id?: unknown }).id === 'GLM-Flash')
  if (flash === undefined) return false
  const efforts = (flash as { reasoningEfforts?: unknown }).reasoningEfforts
  if (efforts === null || typeof efforts !== 'object') return true
  return !('xhigh' in efforts && 'max' in efforts)
}

/**
 * 判断已注册声明的上下文容量是否落后（仍是 256K / 200K 历史值）：
 * 登录时写入的模型逐条比对，provider 级 defaultContextWindow 也一并比对。
 * 未注册、结构异常返回 false（交给迁移/注册流程处理）；用户手动填写的其它容量不算落后。
 */
export function tiangongCapacityOutdated(provider: unknown): boolean {
  if (provider === undefined || provider === null || typeof provider !== 'object') return false
  const section = provider as { models?: unknown; defaultContextWindow?: unknown }
  const models = section.models
  if (!Array.isArray(models)) return false
  const legacy = (value: unknown): boolean => typeof value === 'number' && TIANGONG_LEGACY_CONTEXT_WINDOWS.includes(value)
  const named = models.filter((m) => m !== null && typeof m === 'object'
    && TIANGONG_DECLARED_MODEL_IDS.includes(String((m as { id?: unknown }).id)))
  if (named.some((m) => legacy((m as { contextWindow?: unknown }).contextWindow))) return true
  return legacy(section.defaultContextWindow)
}

/**
 * 判断已注册的 tiangong provider 声明是否落后于插件内置声明：
 * GLM-Flash 档位落后、任一内置模型条目缺失（DeepSeek/Kimi 于 2026-09-27、2026-10-12 先后补入）、
 * DeepSeek 条目缺 image 声明，或上下文容量仍是历史旧值（256K / 200K）
 * （旧安装升级后需启动自愈补齐；2026-09-27 实测上游支持图像输入，2026-10-19 上下文由 200K 提到 300K）。
 * 未注册或结构异常返回 false（交给迁移/注册流程处理）。
 */
export function tiangongDeclarationOutdated(provider: unknown, expectedIds: readonly string[] = TIANGONG_DECLARED_MODEL_IDS): boolean {
  if (provider === undefined || provider === null || typeof provider !== 'object') return false
  const models = (provider as { models?: unknown }).models
  if (!Array.isArray(models)) return false
  if (tiangongEffortsOutdated(provider)) return true
  if (tiangongCapacityOutdated(provider)) return true
  // 2026-10-18 起改按 Anthropic Messages 调用：旧 OpenAI 兼容声明需在升级后自愈改写
  if (tiangongProtocolOutdated(provider)) return true
  // 期望清单里的每个模型都要在已注册声明里出现；缺任一条（内置清单默认值，或站点目录）即触发自愈重写。
  const declared = new Set(models
    .filter((m) => m !== null && typeof m === 'object')
    .map((m) => String((m as { id?: unknown }).id)))
  if (expectedIds.some((id) => !declared.has(id))) return true
  const deepseek = models.find((m) => m !== null && typeof m === 'object' && (m as { id?: unknown }).id === TIANGONG_DEEPSEEK_MODEL_ID)
  // 旧声明只写 ['text'] 会令 DSH 发送前剥图，缺 image 视为落后并触发自愈刷新。
  if (deepseek !== undefined) {
    const input = (deepseek as { input?: unknown }).input
    if (!Array.isArray(input) || !input.includes('image')) return true
  }
  return false
}

// —— 站点模型目录（「已登录账号自动同步官方模型」，辉哥 2026-10-12 定稿） ——

/** 站点模型目录条目（GET /api/gw/model-catalog 的 data.models 元素，已规整）。 */
export interface TiangongCatalogEntry {
  id: string
  contextWindow: number
  input: string[]
  reasoningEfforts: string[]
}

/**
 * 思考档位数组 → DSH 声明用的 Record 形态（'low' → { low: 'low' }）。
 * 站点目录下发数组、DSH 声明用对象，这里是两者唯一的转换点。
 */
export function effortsRecordFromList(list: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const item of list) if (item !== '') out[item] = item
  return out
}

/**
 * 防御式解析站点下发的模型目录。
 * 任何结构异常一律返回空数组——调用方据此回退内置声明，绝不因站点改版而把模型清单写坏。
 * 单项兜底：窗口缺失/非正数回退 TIANGONG_CONTEXT_WINDOW（当前 300K）；input 缺失回退 text+image；档位缺失回退 low/high/max。
 */
export function parseTiangongCatalog(payload: unknown): TiangongCatalogEntry[] {
  const models = (payload as { data?: { models?: unknown } } | null | undefined)?.data?.models
  if (!Array.isArray(models)) return []
  const out: TiangongCatalogEntry[] = []
  for (const item of models) {
    if (item === null || typeof item !== 'object') continue
    const raw = item as Record<string, unknown>
    const id = typeof raw.id === 'string' ? raw.id.trim() : ''
    // 空 id 与重复 id 都丢弃：模型名是声明里的主键
    if (id === '' || out.some((entry) => entry.id === id)) continue
    const contextWindow = typeof raw.contextWindow === 'number' && Number.isFinite(raw.contextWindow) && raw.contextWindow > 0
      ? Math.trunc(raw.contextWindow)
      : TIANGONG_CONTEXT_WINDOW
    const input = Array.isArray(raw.input)
      ? raw.input.filter((value): value is string => typeof value === 'string' && value !== '')
      : []
    const efforts = Array.isArray(raw.reasoningEfforts)
      ? raw.reasoningEfforts.filter((value): value is string => typeof value === 'string' && value !== '')
      : []
    out.push({
      id,
      contextWindow,
      // 站点没给 input 就按「文本+图像」兜底（与内置声明一致），但不允许出现空输入集
      input: input.length > 0 ? input : ['text', 'image'],
      reasoningEfforts: efforts.length > 0 ? efforts : ['low', 'high', 'max'],
    })
  }
  return out
}

/**
 * 防御式解析站点下发的生图模型清单（GET /api/gw/model-catalog 的 data.images）。
 * 站点未下发该字段（旧版官网）或结构异常时返回空数组——调用方据此保留已配置的生图线路，
 * 绝不因站点改版把生图模型写空。
 */
export function parseTiangongCatalogImages(payload: unknown): string[] {
  const images = (payload as { data?: { images?: unknown } } | null | undefined)?.data?.images
  if (!Array.isArray(images)) return []
  const out: string[] = []
  for (const item of images) {
    if (typeof item !== 'string') continue
    const id = item.trim()
    if (id === '' || out.includes(id)) continue
    out.push(id)
  }
  return out
}

/**
 * 判断已注册声明是否落后于站点目录：站点目录里的模型缺条目，或能力
 * （上下文窗口 / 输入模态 / 思考档位）与站点下发不一致。
 * 目录为空（未登录或站点不可达）时返回 false，交给内置判定处理。
 */
export function tiangongCatalogOutdated(provider: unknown, catalog: readonly TiangongCatalogEntry[]): boolean {
  if (catalog.length === 0) return false
  if (provider === undefined || provider === null || typeof provider !== 'object') return false
  const models = (provider as { models?: unknown }).models
  if (!Array.isArray(models)) return false
  for (const entry of catalog) {
    const found = models.find((m) => m !== null && typeof m === 'object' && (m as { id?: unknown }).id === entry.id)
    if (found === undefined) return true
    const model = found as Record<string, unknown>
    if (model.contextWindow !== entry.contextWindow) return true
    const input = Array.isArray(model.input) ? model.input : []
    for (const kind of entry.input) if (!input.includes(kind)) return true
    const efforts = model.reasoningEfforts
    if (efforts === null || typeof efforts !== 'object' || Array.isArray(efforts)) return true
    const keys = Object.keys(efforts as Record<string, unknown>)
    if (entry.reasoningEfforts.some((key) => !keys.includes(key))) return true
  }
  return false
}

/**
 * 用站点目录重建模型清单：站点模型按站点下发的能力落地（档位数组转 Record），
 * 站点未下发的内置模型按内置条目补齐。目录为空时等价于纯内置清单。
 *
 * 说明：tiangong provider 由插件托管（登录时写入、登出时整体移除），
 * 因此这里以「站点目录 ∪ 内置兜底」为准，不保留用户在设置里手加的条目。
 */
export function buildTiangongModels(
  catalog: readonly TiangongCatalogEntry[],
  fallback: readonly Record<string, unknown>[],
): Record<string, unknown>[] {
  const fromCatalog = catalog.map((entry) => ({
    id: entry.id,
    name: entry.id,
    contextWindow: entry.contextWindow,
    input: [...entry.input],
    reasoningEfforts: effortsRecordFromList(entry.reasoningEfforts),
  }))
  const catalogIds = new Set(catalog.map((entry) => entry.id))
  const extras = fallback
    .filter((model) => !catalogIds.has(String(model.id)))
    .map((model) => ({ ...model }))
  return [...fromCatalog, ...extras]
}
