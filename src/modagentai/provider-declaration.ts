/**
 * 天工造梦原生 provider 声明常量与档位判定（独立成模块便于单测，
 * 避免 service.ts 的运行时依赖链进入测试环境）。
 */

/** 天工造梦 GLM-Flash 支持的推理档位（与方舟上游五档对齐；辉哥 2026-09-22 确认补 xhigh/max）。 */
export const TIANGONG_REASONING_EFFORTS = { low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' } as const

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
