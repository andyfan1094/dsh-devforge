import type { ZhipuQuotaKind, ZhipuQuotaLimit } from './protocol.ts'

/** 智谱监控接口可能返回的新旧额度字段。 */
interface RawQuotaLimit {
  type?: unknown
  unit?: unknown
  number?: unknown
  percentage?: unknown
  currentValue?: unknown
  usage?: unknown
  remaining?: unknown
  nextResetTime?: unknown
  usageDetails?: unknown
}

/** 仅接纳有限数值，阻止异常响应把 NaN/Infinity 带到前端。 */
function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** 兼容历史 TOKENS_LIMIT 与当前 CREDIT_LIMIT。 */
export function classifyQuotaLimit(limit: RawQuotaLimit): ZhipuQuotaKind {
  const type = typeof limit.type === 'string' ? limit.type : ''
  const unit = finiteNumber(limit.unit)
  const number = finiteNumber(limit.number)
  if (type === 'TIME_LIMIT' || type === 'MCP_LIMIT') return 'tools-month'
  if (type === 'TOKENS_LIMIT' || type === 'CREDIT_LIMIT') {
    if (unit === 3 || number === 5) return 'tokens-5h'
    if (unit === 6 || number === 7) return 'tokens-week'
  }
  return 'unknown'
}

/** 把官方原始额度数组转换为稳定、脱敏的页面契约。 */
export function parseQuotaLimits(value: unknown): ZhipuQuotaLimit[] {
  if (!Array.isArray(value)) return []
  const order: ZhipuQuotaKind[] = ['tokens-5h', 'tokens-week', 'tools-month', 'unknown']
  const result: ZhipuQuotaLimit[] = []
  for (const entry of value) {
    if (entry === null || typeof entry !== 'object') continue
    const raw = entry as RawQuotaLimit
    const details: Array<{ name: string; used: number }> = []
    if (Array.isArray(raw.usageDetails)) {
      for (const item of raw.usageDetails) {
        if (item === null || typeof item !== 'object') continue
        const row = item as { modelCode?: unknown; usage?: unknown }
        const used = finiteNumber(row.usage)
        if (typeof row.modelCode === 'string' && row.modelCode !== '' && used !== undefined && used > 0) {
          details.push({ name: row.modelCode, used })
        }
      }
    }
    details.sort((left, right) => right.used - left.used)
    result.push({
      kind: classifyQuotaLimit(raw),
      usedPercent: finiteNumber(raw.percentage),
      used: finiteNumber(raw.currentValue),
      total: finiteNumber(raw.usage),
      remaining: finiteNumber(raw.remaining),
      nextResetTime: typeof raw.nextResetTime === 'string' || typeof raw.nextResetTime === 'number' ? raw.nextResetTime : undefined,
      details,
    })
  }
  result.sort((left, right) => order.indexOf(left.kind) - order.indexOf(right.kind))
  return result
}
