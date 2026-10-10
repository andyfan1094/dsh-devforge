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
 * 登录官网后写入的两个模型（GLM-Flash、DeepSeek V4.1 Flash）的上下文窗口。
 * 辉哥 2026-10-10 定稿：由 256K 压到 200K——上游实测虽可贴 256K，但长上下文会同时推高
 * 请求包体积与用量消耗，声明侧刻意低报，让宿主在 200K 就触发压缩。
 */
export const TIANGONG_CONTEXT_WINDOW = 200_000

/**
 * 历史版本声明过的上下文窗口（2026-09-22 起为 256K=262144）。
 * 已安装插件升级后，声明里若仍留着这些旧值，启动自愈会自动改写为 TIANGONG_CONTEXT_WINDOW；
 * 只认列在这里的历史值，用户在设置里手动改成别的容量不会被启动流程覆盖。
 */
export const TIANGONG_LEGACY_CONTEXT_WINDOWS: readonly number[] = [262_144]

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
 * 判断已注册声明的上下文容量是否落后（仍是 256K 历史值）：
 * 登录时写入的两个模型逐条比对，provider 级 defaultContextWindow 也一并比对。
 * 未注册、结构异常返回 false（交给迁移/注册流程处理）；用户手动填写的其它容量不算落后。
 */
export function tiangongCapacityOutdated(provider: unknown): boolean {
  if (provider === undefined || provider === null || typeof provider !== 'object') return false
  const section = provider as { models?: unknown; defaultContextWindow?: unknown }
  const models = section.models
  if (!Array.isArray(models)) return false
  const legacy = (value: unknown): boolean => typeof value === 'number' && TIANGONG_LEGACY_CONTEXT_WINDOWS.includes(value)
  const named = models.filter((m) => m !== null && typeof m === 'object'
    && ((m as { id?: unknown }).id === 'GLM-Flash' || (m as { id?: unknown }).id === TIANGONG_DEEPSEEK_MODEL_ID))
  if (named.some((m) => legacy((m as { contextWindow?: unknown }).contextWindow))) return true
  return legacy(section.defaultContextWindow)
}

/**
 * 判断已注册的 tiangong provider 声明是否落后于插件内置声明：
 * GLM-Flash 档位落后、DeepSeek V4.1 Flash 条目缺失/看图声明缺失，或上下文容量仍是 256K 旧值
 * （旧安装升级后需启动自愈补齐；2026-09-27 实测上游支持图像输入，2026-10-10 上下文压到 200K）。
 * 未注册或结构异常返回 false（交给迁移/注册流程处理）。
 */
export function tiangongDeclarationOutdated(provider: unknown): boolean {
  if (provider === undefined || provider === null || typeof provider !== 'object') return false
  const models = (provider as { models?: unknown }).models
  if (!Array.isArray(models)) return false
  if (tiangongEffortsOutdated(provider)) return true
  if (tiangongCapacityOutdated(provider)) return true
  const deepseek = models.find((m) => m !== null && typeof m === 'object' && (m as { id?: unknown }).id === TIANGONG_DEEPSEEK_MODEL_ID)
  if (deepseek === undefined) return true
  // 旧声明只写 ['text'] 会令 DSH 发送前剥图，缺 image 视为落后并触发自愈刷新。
  const input = (deepseek as { input?: unknown }).input
  if (!Array.isArray(input) || !input.includes('image')) return true
  return false
}
