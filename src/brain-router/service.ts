/**
 * 主脑路由宿主接线 —— 设置节注册 + 子代理运行时委派拦截。
 *
 * 拦截点选择：dsh-tool-subagent（subagent/subagent_fork）、workflow、ralph
 * 的子代理最终都经 SubagentRuntime 服务（ctx.subagents）的 start（一次性）
 * 或 startContinuable（后台可续聊）出口创建；在这两个方法外层包一层路由
 * 注入即可覆盖全部委派入口，且不改宿主内核文件（升级安全，卸载即还原）。
 */

import type { Context } from '@deepseek-ai/cordis'
import z from 'schemastery'
import { installSettingsSection, settingsNamespace } from '../settings-compat.ts'
import { BRAIN_ROUTER_DEFAULTS, type BrainRouterCatalogEffort, type BrainRouterCatalogProvider, type BrainRouterSettings } from './protocol.ts'
import { isMainModelPatternValid, mergeRoutedAgentOptions, readParentRoute, resolveBrainRoute } from './core.ts'

/** settings.yaml 命名空间：小写连字符标识，经 settings-compat 注册。 */
export const BRAIN_ROUTER_SETTINGS_NAMESPACE = settingsNamespace('brain-router')

/** 设置节 schema（schemastery；描述文本会出现在设置描述接口中）。 */
const BrainRouterSchema = z.object({
  enabled: z.boolean().default(false).description('启用主脑路由：主模型命中匹配时，其委派的子代理改道工人模型'),
  mainModelPattern: z.string().default(BRAIN_ROUTER_DEFAULTS.mainModelPattern).description('主模型匹配正则（不区分大小写，匹配 "provider/model"）'),
  workerProvider: z.string().default(BRAIN_ROUTER_DEFAULTS.workerProvider).description('工人模型 provider id'),
  workerModel: z.string().default(BRAIN_ROUTER_DEFAULTS.workerModel).description('工人模型 model id'),
  workerReasoningEffort: z.string().default('').description('工人模型推理档位（留空用模型默认）'),
  excludeProviders: z.array(z.string()).default(['fork']).description('不改道的子代理 provider（fork 必须保持排除）'),
  overrideExplicit: z.boolean().default(false).description('主模型显式指定子模型时仍强制改道'),
})

/** schemastery 解析结果可能出现 null 字段（宿主 alpha.3 实测），读取时统一规整。 */
function normalizeSettings(raw: Partial<BrainRouterSettings> | undefined): BrainRouterSettings {
  const value = raw ?? {}
  const exclude = Array.isArray(value.excludeProviders) ? value.excludeProviders.filter((item): item is string => typeof item === 'string') : BRAIN_ROUTER_DEFAULTS.excludeProviders
  return {
    enabled: value.enabled === true,
    mainModelPattern: typeof value.mainModelPattern === 'string' ? value.mainModelPattern : BRAIN_ROUTER_DEFAULTS.mainModelPattern,
    workerProvider: typeof value.workerProvider === 'string' ? value.workerProvider : BRAIN_ROUTER_DEFAULTS.workerProvider,
    workerModel: typeof value.workerModel === 'string' ? value.workerModel : BRAIN_ROUTER_DEFAULTS.workerModel,
    workerReasoningEffort: typeof value.workerReasoningEffort === 'string' ? value.workerReasoningEffort : '',
    excludeProviders: exclude.includes('fork') ? exclude : [...exclude, 'fork'],
    overrideExplicit: value.overrideExplicit === true,
  }
}

/**
 * 注册 brain-router 设置节（settings.yaml 热更新），返回实时读取闭包。
 * @param ctx - 插件宿主上下文（settings 服务缺失时静默降级为默认值）。
 * @returns 读取当前生效设置的闭包（每次委派调用，读的是最新值）。
 */
export function installBrainRouterSection(ctx: Context): () => BrainRouterSettings {
  let current: () => BrainRouterSettings = () => ({ ...BRAIN_ROUTER_DEFAULTS })
  ctx.inject(['settings'], (settingsCtx) => {
    installSettingsSection(ctx, BRAIN_ROUTER_SETTINGS_NAMESPACE, BrainRouterSchema, { ...BRAIN_ROUTER_DEFAULTS }, {
      // 收到权威配置源：委派拦截器每次调用时实时读取，改设置即时生效。
      setSource: (source) => {
        current = () => normalizeSettings(source() as Partial<BrainRouterSettings>)
      },
      // 跨字段写入校验：拒绝「开启但未配工人模型」与「非法正则」的保存。
      validate: (value) => {
        const candidate = normalizeSettings(value as Partial<BrainRouterSettings>)
        if (candidate.enabled && (candidate.workerProvider.trim() === '' || candidate.workerModel.trim() === '')) {
          throw new Error('启用主脑路由前必须先选择工人模型')
        }
        if (!isMainModelPatternValid(candidate.mainModelPattern)) {
          throw new Error('主模型匹配正则非法（需为可编译的正则表达式）')
        }
      },
      onChange: () => {},
    })
  })
  return () => current()
}

/** 委派请求的最小结构类型（仅声明拦截所需字段，避免依赖内核具体类型）。 */
interface DelegationRequestLike {
  parent?: unknown
  agentOptions?: Record<string, unknown>
  [key: string]: unknown
}

/** startContinuable 的委派规格：provider 与 request 平级。 */
interface DelegationSpecLike {
  provider?: unknown
  request?: DelegationRequestLike
  [key: string]: unknown
}

/** 子代理运行时的最小结构类型（SubagentRuntime 服务，恒由 dsh-base 挂载）。 */
interface SubagentRuntimeLike {
  start(name: string, request: DelegationRequestLike): Promise<unknown>
  startContinuable(spec: DelegationSpecLike): Promise<unknown>
}

/**
 * 在子代理运行时的两个委派出口外层包上主脑路由。
 *
 * 幂等与还原：以 Symbol 标记防重复包装（HMR/重载安全）；卸载时删除本插件
 * 挂上的自有属性，让运行时回落到原型方法（若包装前恰有同名自有属性，则
 * 原样恢复该属性），不做任何超出本次包装范围的改动。
 * @param ctx - 插件宿主上下文（subagents 缺失时告警降级，不影响插件其余能力）。
 * @param readSettings - 实时读取当前设置的闭包。
 */
export function installBrainRouterWrapper(ctx: Context, readSettings: () => BrainRouterSettings): boolean {
  const runtime = ctx.get('subagents') as SubagentRuntimeLike | undefined
  if (runtime === undefined || typeof runtime.start !== 'function' || typeof runtime.startContinuable !== 'function') {
    ctx.logger?.warn?.('[dsh-devforge] 主脑路由未安装：subagents 运行时不可用（委派保持内核默认行为）')
    return false
  }
  const marker = Symbol.for('dsh-devforge.brain-router.installed')
  const marked = runtime as unknown as Record<symbol, unknown>
  if (marked[marker] === true) return true

  // 记录包装前状态，卸载时精确还原（正常情况 start/startContinuable 都在原型上）。
  const hadOwnStart = Object.prototype.hasOwnProperty.call(runtime, 'start')
  const hadOwnContinuable = Object.prototype.hasOwnProperty.call(runtime, 'startContinuable')
  const ownStartBefore = (runtime as unknown as Record<string, unknown>).start
  const ownContinuableBefore = (runtime as unknown as Record<string, unknown>).startContinuable
  const startOriginal = runtime.start.bind(runtime)
  const startContinuableOriginal = runtime.startContinuable.bind(runtime)

  // 一次性委派（workflow、ralph、subagent 工具的前台调用都走这里）。
  ;(runtime as unknown as Record<string, unknown>).start = function routedStart(name: string, request: DelegationRequestLike): Promise<unknown> {
    const decision = resolveBrainRoute(readSettings(), {
      providerName: name,
      parentRoute: readParentRoute(request?.parent),
      requestedAgentOptions: request?.agentOptions,
    })
    if (decision === undefined) return startOriginal(name, request)
    const routed = { ...request, agentOptions: mergeRoutedAgentOptions(request?.agentOptions, decision) }
    ctx.logger?.info?.('[dsh-devforge] 主脑路由：子代理改道 %s/%s（委派入口 %s）', decision.provider, decision.model, name)
    return startOriginal(name, routed)
  }
  // 后台可续聊委派（subagent 工具默认路径）。
  ;(runtime as unknown as Record<string, unknown>).startContinuable = function routedStartContinuable(spec: DelegationSpecLike): Promise<unknown> {
    const request = spec?.request
    const decision = resolveBrainRoute(readSettings(), {
      providerName: typeof spec?.provider === 'string' ? spec.provider : '',
      parentRoute: readParentRoute(request?.parent),
      requestedAgentOptions: request?.agentOptions,
    })
    if (decision === undefined) return startContinuableOriginal(spec)
    const routed = { ...spec, request: { ...request, agentOptions: mergeRoutedAgentOptions(request?.agentOptions, decision) } }
    ctx.logger?.info?.('[dsh-devforge] 主脑路由：子代理改道 %s/%s（委派入口 %s）', decision.provider, decision.model, String(spec?.provider))
    return startContinuableOriginal(routed as DelegationSpecLike)
  }
  marked[marker] = true

  ctx.effect(() => () => {
    const writable = runtime as unknown as Record<string, unknown>
    if (hadOwnStart) writable.start = ownStartBefore
    else delete writable.start
    if (hadOwnContinuable) writable.startContinuable = ownContinuableBefore
    else delete writable.startContinuable
    delete marked[marker]
  }, 'dsh-devforge: brain-router wrapper')
  return true
}

/**
 * 保存主脑路由设置（全量替换 user 层；schema 与 validate 钩子把关）。
 * @throws 保存被拒（跨字段校验失败）或 settings 服务不可用时抛错，由路由层转 400。
 */
export async function writeBrainRouterSettings(ctx: Context, value: BrainRouterSettings): Promise<void> {
  const settings = ctx.get('settings') as { replace?: (ns: string, value: unknown) => Promise<void> } | undefined
  if (settings?.replace === undefined) throw new Error('settings 服务不可用，无法保存主脑路由设置')
  await settings.replace(BRAIN_ROUTER_SETTINGS_NAMESPACE, { ...value })
}

/** llm 服务的最小结构类型（模型目录读取所需，恒由 dsh-base 挂载）。 */
interface LlmServiceLike {
  listProviders?: () => Array<{ id: string; name?: string }>
  listModels?: (providerId: string) => Promise<Array<{ id: string; name?: string }>>
  resolveModelInfo?: (providerId: string, modelId: string) => Promise<{ reasoning?: { efforts?: Array<{ id: string; name?: string; description?: string }>; defaultEffort?: string } }>
}

/** 单模型档位解析的兜底结果（元数据不可读时不提供档位下拉）。 */
const EMPTY_EFFORTS: { efforts: BrainRouterCatalogEffort[]; defaultEffort?: string } = { efforts: [] }

/**
 * 读取单个模型的推理档位元数据。
 * @param llm - llm 服务（resolveModelInfo 缺失时直接回落空档位）。
 * @returns 档位清单与默认档位；任何失败（含 5 秒超时）都回落空档位，不拖垮目录。
 */
async function resolveModelEfforts(llm: LlmServiceLike, providerId: string, modelId: string): Promise<{ efforts: BrainRouterCatalogEffort[]; defaultEffort?: string }> {
  if (llm.resolveModelInfo === undefined) return EMPTY_EFFORTS
  try {
    const timeout = new Promise<never>((_, reject) => { setTimeout(() => { reject(new Error('模型元数据读取超时')) }, 5000) })
    const info = await Promise.race([llm.resolveModelInfo(providerId, modelId), timeout])
    const raw = info?.reasoning?.efforts
    if (!Array.isArray(raw)) return EMPTY_EFFORTS
    const efforts = raw
      .filter((effort) => typeof effort?.id === 'string' && effort.id !== '')
      .map((effort) => ({ id: effort.id, name: effort.name ?? effort.id }))
    return { efforts, ...(typeof info?.reasoning?.defaultEffort === 'string' ? { defaultEffort: info.reasoning.defaultEffort } : {}) }
  } catch {
    return EMPTY_EFFORTS
  }
}

/**
 * 读取模型目录（工人模型下拉数据源）：枚举全部已注册 provider 及其声明模型，
 * 并逐模型附带推理档位（档位下拉的数据源）。单个 provider 目录失败不拖垮
 * 整体（返回空模型列表）；llm 缺失时返回空目录。
 */
export async function listBrainRouterCatalog(ctx: Context): Promise<BrainRouterCatalogProvider[]> {
  const llm = ctx.get('llm') as LlmServiceLike | undefined
  if (llm?.listProviders === undefined || llm?.listModels === undefined) return []
  const providers = llm.listProviders()
  return Promise.all(providers.map(async (provider) => {
    try {
      const models = await llm.listModels!(provider.id)
      const entries = await Promise.all(models.map(async (model) => {
        const meta = await resolveModelEfforts(llm, provider.id, model.id)
        return { id: model.id, name: model.name ?? model.id, efforts: meta.efforts, ...(meta.defaultEffort !== undefined ? { defaultEffort: meta.defaultEffort } : {}) }
      }))
      return {
        id: provider.id,
        name: provider.name ?? provider.id,
        models: entries,
      }
    } catch {
      // 该提供方目录暂不可读（密钥/网络等）：面板仍可看到 provider，模型列表为空。
      return { id: provider.id, name: provider.name ?? provider.id, models: [] }
    }
  }))
}
