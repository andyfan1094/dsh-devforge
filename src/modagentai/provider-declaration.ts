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
 * 判断已注册的 tiangong provider 声明是否落后于插件内置声明：
 * GLM-Flash 档位落后，或缺少 DeepSeek V4.1 Flash 模型条目（旧安装升级后需启动自愈补齐）。
 * 未注册或结构异常返回 false（交给迁移/注册流程处理）。
 */
export function tiangongDeclarationOutdated(provider: unknown): boolean {
  if (provider === undefined || provider === null || typeof provider !== 'object') return false
  const models = (provider as { models?: unknown }).models
  if (!Array.isArray(models)) return false
  if (tiangongEffortsOutdated(provider)) return true
  return !models.some((m) => m !== null && typeof m === 'object' && (m as { id?: unknown }).id === TIANGONG_DEEPSEEK_MODEL_ID)
}
