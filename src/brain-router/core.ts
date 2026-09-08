/**
 * 主脑路由核心判定 —— 纯函数，无 Cordis/宿主依赖，便于单元测试。
 *
 * 判定语义：仅当「开关开启 + 工人模型已配置 + 委派入口不在排除清单 +
 * 主模型当前路由命中匹配正则 + （未显式指定子模型，或允许强制覆盖）」时，
 * 才把子代理改道工人模型；其余情况一律返回 undefined（保持内核默认行为）。
 */

import { BRAIN_ROUTER_DEFAULTS, type BrainRouterSettings } from './protocol.ts'

/** 改道决策：写入子代理 agentOptions 的目标路由。 */
export interface BrainRouteDecision {
  /** 工人模型 provider id。 */
  provider: string
  /** 工人模型 model id。 */
  model: string
  /** 工人模型推理档位；未配置时缺省（由内核按「换路由清档位」约定交给模型默认）。 */
  reasoningEffort?: string
}

/** 一次委派的路由判定输入。 */
export interface DelegationRouteInput {
  /** 委派使用的子代理 provider 名（spawn / fork / ...，用于排除清单）。 */
  providerName: string
  /** 主模型（父代理）当前路由；缺失时不改道。 */
  parentRoute?: { provider: string; model: string }
  /** 本次委派已解析的子代理 agentOptions（可能为空；含显式 provider/model 时视为显式选择）。 */
  requestedAgentOptions?: { provider?: unknown; model?: unknown; reasoningEffort?: unknown }
}

/** 正则缓存：按最近一次使用的 pattern 串缓存编译结果（委派调用频繁，避免重复编译）。 */
let cachedPattern: string | undefined
let cachedRegex: RegExp | undefined

/**
 * 编译主模型匹配正则（不区分大小写）。
 * @param pattern - 用户配置的正则串；空白串视为未配置。
 * @returns 编译成功的正则；空白或非法正则返回 undefined（调用方按「不命中」处理）。
 */
export function compileMainModelPattern(pattern: string): RegExp | undefined {
  const trimmed = pattern.trim()
  if (trimmed === '') return undefined
  if (cachedPattern === trimmed && cachedRegex !== undefined) return cachedRegex
  let compiled: RegExp | undefined
  try {
    compiled = new RegExp(trimmed, 'i')
  } catch {
    compiled = undefined
  }
  cachedPattern = trimmed
  cachedRegex = compiled
  return compiled
}

/** 校验匹配正则是否可用（面板标红与设置写入校验共用）。 */
export function isMainModelPatternValid(pattern: string): boolean {
  const trimmed = pattern.trim()
  if (trimmed === '') return false
  try {
    new RegExp(trimmed, 'i')
    return true
  } catch {
    return false
  }
}

/**
 * 判定本次委派是否改道工人模型。
 * @param settings - 当前主脑路由设置。
 * @param input - 委派输入（子代理 provider、主模型路由、已解析子代理选项）。
 * @returns 改道决策；返回 undefined 表示保持内核默认行为。
 */
export function resolveBrainRoute(settings: BrainRouterSettings, input: DelegationRouteInput): BrainRouteDecision | undefined {
  // 开关未开或工人模型未配置：功能未武装，直接放行。
  if (!settings.enabled) return undefined
  const workerProvider = settings.workerProvider.trim()
  const workerModel = settings.workerModel.trim()
  if (workerProvider === '' || workerModel === '') return undefined
  // 排除清单：fork 复用主模型会话前缀（KV 缓存语义），改道会破坏复用，必须保持排除。
  const excluded = settings.excludeProviders.some((name) => name.trim() !== '' && name.trim() === input.providerName)
  if (excluded) return undefined
  // 主模型路由缺失（理论上不会发生）：无从匹配，放行。
  const parentRoute = input.parentRoute
  if (parentRoute === undefined) return undefined
  // 匹配 "provider/model"（不区分大小写）；正则非法视为永不命中。
  const matcher = compileMainModelPattern(settings.mainModelPattern)
  if (matcher === undefined || !matcher.test(`${parentRoute.provider}/${parentRoute.model}`)) return undefined
  // 主模型显式为子代理指定了模型（provider/model 成对出现）时默认尊重其选择。
  const explicit = input.requestedAgentOptions
  const hasExplicitRoute = typeof explicit?.provider === 'string' && explicit.provider !== '' && typeof explicit?.model === 'string' && explicit.model !== ''
  if (hasExplicitRoute && !settings.overrideExplicit) return undefined
  const effort = settings.workerReasoningEffort.trim()
  return {
    provider: workerProvider,
    model: workerModel,
    ...(effort !== '' ? { reasoningEffort: effort } : {}),
  }
}

/**
 * 把改道决策合并进本次委派的 agentOptions。
 *
 * 改道即换模型：旧路由的推理档位可能不被工人模型支持（例如 GPT 的档位名
 * 在 GLM 上不存在），所以这里清掉旧档位；工人模型配置了专属档位才写入。
 * 其余字段（如 maxTokens）保持内核继承语义不动。
 * @param current - 本次委派已解析的 agentOptions（可为空）。
 * @param decision - 改道决策。
 * @returns 合并后的 agentOptions（调用方整体替换 request.agentOptions）。
 */
export function mergeRoutedAgentOptions(current: { provider?: unknown; model?: unknown; reasoningEffort?: unknown } | undefined, decision: BrainRouteDecision): Record<string, unknown> {
  const rest: Record<string, unknown> = {}
  if (current !== undefined && typeof current === 'object') {
    for (const [key, value] of Object.entries(current)) {
      // 档位属于旧路由，换路由必须丢弃；工人模型专属档位在下方按需写入。
      if (key === 'reasoningEffort') continue
      rest[key] = value
    }
  }
  rest.provider = decision.provider
  rest.model = decision.model
  if (decision.reasoningEffort !== undefined) rest.reasoningEffort = decision.reasoningEffort
  return rest
}

/**
 * 读取主模型（父代理）当前路由 —— 镜像内核 parentAgentOptionsForDelegation
 * 的取值顺序（最近一次请求头优先，创建 options 兜底），但全程防御式访问，
 * 不 import 宿主内核类型，避免内核重构时连带损坏。
 * @param parent - 委派请求携带的父代理对象（结构未知，逐层探测）。
 * @returns 主模型路由；无法可靠读取时返回 undefined（不改道）。
 */
export function readParentRoute(parent: unknown): { provider: string; model: string } | undefined {
  if (parent === null || typeof parent !== 'object') return undefined
  const candidate = parent as {
    session?: { requestHeader?: () => { config?: { provider?: unknown; model?: unknown } } }
    options?: { provider?: unknown; model?: unknown }
  }
  // 顺序一：最近一次请求头的 config（会话中途切换模型后这里反映最新选择）。
  try {
    const config = candidate.session?.requestHeader?.()?.config
    if (isNonEmptyString(config?.provider) && isNonEmptyString(config?.model)) {
      return { provider: config.provider, model: config.model }
    }
  } catch {
    // 会话尚未发起过请求等情况：忽略异常，走创建 options 兜底。
  }
  // 顺序二：代理创建 options（首个请求前的兜底来源，与内核语义一致）。
  if (isNonEmptyString(candidate.options?.provider) && isNonEmptyString(candidate.options?.model)) {
    return { provider: candidate.options.provider, model: candidate.options.model }
  }
  return undefined
}

/** 非空字符串判定（路由字段必须是可用的 provider/model id）。 */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value !== ''
}

/**
 * 把面板 PUT 的任意 JSON 输入规整成合法设置（逐字段白名单校验，全量替换语义）。
 * @param raw - 请求体中的 settings 字段（结构不可信）。
 * @returns 规整成功返回设置；失败返回面向面板的可读错误。
 */
export function sanitizeBrainRouterInput(raw: unknown): { ok: true; value: BrainRouterSettings } | { ok: false; error: string } {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: '设置必须是 JSON 对象' }
  const input = raw as Record<string, unknown>
  // 布尔字段：必须是布尔值（undefined 时回落默认，缺字段允许全量替换的局部省略）。
  const enabled = input.enabled === undefined ? BRAIN_ROUTER_DEFAULTS.enabled : input.enabled
  if (typeof enabled !== 'boolean') return { ok: false, error: 'enabled 必须是布尔值' }
  const overrideExplicit = input.overrideExplicit === undefined ? BRAIN_ROUTER_DEFAULTS.overrideExplicit : input.overrideExplicit
  if (typeof overrideExplicit !== 'boolean') return { ok: false, error: 'overrideExplicit 必须是布尔值' }
  // 字符串字段：undefined 回落默认；其余必须是字符串。
  const stringFields = ['mainModelPattern', 'workerProvider', 'workerModel', 'workerReasoningEffort'] as const
  const strings: Record<(typeof stringFields)[number], string> = {
    mainModelPattern: BRAIN_ROUTER_DEFAULTS.mainModelPattern,
    workerProvider: BRAIN_ROUTER_DEFAULTS.workerProvider,
    workerModel: BRAIN_ROUTER_DEFAULTS.workerModel,
    workerReasoningEffort: BRAIN_ROUTER_DEFAULTS.workerReasoningEffort,
  }
  for (const field of stringFields) {
    const value = input[field] === undefined ? BRAIN_ROUTER_DEFAULTS[field] : input[field]
    if (typeof value !== 'string') return { ok: false, error: `${field} 必须是字符串` }
    strings[field] = value
  }
  // 排除清单：字符串数组；空白项剔除，保底排除 fork（fork 改道会破坏会话缓存复用）。
  const rawExclude = input.excludeProviders === undefined ? BRAIN_ROUTER_DEFAULTS.excludeProviders : input.excludeProviders
  if (!Array.isArray(rawExclude)) return { ok: false, error: 'excludeProviders 必须是字符串数组' }
  const excludeProviders = rawExclude.filter((item): item is string => typeof item === 'string' && item.trim() !== '').map((item) => item.trim())
  if (!excludeProviders.includes('fork')) excludeProviders.push('fork')
  const value: BrainRouterSettings = {
    enabled,
    mainModelPattern: strings.mainModelPattern,
    workerProvider: strings.workerProvider.trim(),
    workerModel: strings.workerModel.trim(),
    workerReasoningEffort: strings.workerReasoningEffort.trim(),
    excludeProviders,
    overrideExplicit,
  }
  // 跨字段约束：开启时必须已配置工人模型；正则必须可编译。
  if (value.enabled && (value.workerProvider === '' || value.workerModel === '')) {
    return { ok: false, error: '启用主脑路由前必须先选择工人模型' }
  }
  if (!isMainModelPatternValid(value.mainModelPattern)) {
    return { ok: false, error: '主模型匹配正则非法（需为可编译的正则表达式）' }
  }
  return { ok: true, value }
}
