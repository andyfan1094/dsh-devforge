/** Coding Plan 侧栏套餐用量卡片的纯数据构建器（无 JSX，便于 node --test 直接单测）。
 * 原构建器（zhipuCard/minimaxCard/arkCard）随布局定稿从 UsageOverviewTab 迁入
 * CodingPlanAsideUsage.tsx，为让智谱多渠道构建器可被纯 node 单测覆盖，
 * 全部纯函数与展示模型再次沉淀到本模块；React 渲染仍留在 CodingPlanAsideUsage.tsx。
 * 数据由 CodingPlanTab 统一加载。 */
import type { ArkUsageDashboard } from '../../ark/protocol.ts'
import type { MiniMaxDashboard } from '../../minimax/protocol.ts'
import type { ZhipuDashboard, ZhipuKeyUsage } from '../../zhipu/protocol.ts'

export type OverviewProvider = 'zhipu' | 'minimax' | 'ark'

/** 统一的一行用量窗口。 */
export interface OverviewPeriod {
  label: string
  usedPercent: number
  detail: string
  resetAt?: number
}

/** 单家用量卡片状态：侧栏卡片共用的展示模型。 */
export interface OverviewCardState {
  phase: 'loading' | 'ready' | 'error'
  configured: boolean
  subscribed?: boolean
  badge: string
  planName?: string
  periods: OverviewPeriod[]
  warnings: string[]
  error?: string
}

/** 三家卡片状态集合。 */
export interface OverviewCards {
  zhipu: OverviewCardState
  minimax: OverviewCardState
  ark: OverviewCardState
}

/** 卡片初始态：加载中、未配置、无窗口数据。 */
export const INITIAL_CARD: OverviewCardState = { phase: 'loading', configured: false, badge: '', periods: [], warnings: [] }

function percentText(usedPercent: number): string {
  return usedPercent.toFixed(1) + '% 已用 · ' + Math.max(0, 100 - usedPercent).toFixed(1) + '% 剩余'
}

/** 由窗口 label 关键字推断窗口级别（用于重置倒计时 urgency 分档）。 */
function inferOverviewLevel(label: string): 'short-window' | 'weekly' | 'monthly' | 'unknown' {
  if (label.includes('5 小时')) return 'short-window'
  if (label.includes('本周')) return 'weekly'
  if (label.includes('本月')) return 'monthly'
  return 'unknown'
}

/** 智谱单张看板的窗口行；prefix 非空时行首加渠道名（多渠道下区分归属）。 */
function zhipuLimitPeriods(dashboard: ZhipuDashboard, prefix?: string): OverviewPeriod[] {
  const labelPrefix = prefix !== undefined && prefix !== '' ? prefix + ' · ' : ''
  return dashboard.limits
    .filter((limit) => limit.kind !== 'unknown')
    .map((limit) => {
      const usedPercent = Math.max(0, Math.min(100, limit.usedPercent ?? (limit.used !== undefined && limit.total !== undefined && limit.total > 0 ? limit.used / limit.total * 100 : 0)))
      const label = limit.kind === 'tokens-5h' ? '5 小时额度' : limit.kind === 'tokens-week' ? '本周额度' : '本月工具额度'
      const resetAt = typeof limit.nextResetTime === 'number' ? limit.nextResetTime : undefined
      return { label: labelPrefix + label, usedPercent, detail: percentText(usedPercent), resetAt }
    })
}

/** 智谱：limits 直接带 5h/周/月三类窗口（单 Key 主路径，行为与多渠道版一致）。 */
export function zhipuCard(status: { credentialConfigured: boolean } | null, dashboard: ZhipuDashboard): OverviewCardState {
  return {
    phase: 'ready',
    configured: status?.credentialConfigured ?? false,
    badge: dashboard.level ?? '',
    periods: zhipuLimitPeriods(dashboard),
    warnings: dashboard.warnings,
  }
}

/**
 * 智谱多渠道：按 Key 池逐渠道出窗口行（主 Key 在前，其余按池内顺序）。
 * - 单渠道：与 zhipuCard 完全同构，行首不加渠道名，老用户零感；
 * - 多渠道：每行带渠道名前缀（如「主力号 · 5 小时额度」），badge 追加渠道数；
 * - 单渠道失败不拖垮整卡：失败渠道降级为 warnings，其余渠道照常展示；
 * - 全部失败：整卡转错误态（侧栏出现重试按钮），错误信息含各渠道明细。
 */
export function zhipuCardFromUsages(status: { credentialConfigured: boolean } | null, usages: ZhipuKeyUsage[]): OverviewCardState {
  const configured = status?.credentialConfigured ?? false
  const warnings = usages
    .filter((usage) => !usage.ok)
    .map((usage) => usage.label + ' 用量读取失败：' + (usage.error ?? '未知错误'))
  if (usages.length === 0) {
    return { phase: 'ready', configured, badge: '', periods: [], warnings }
  }
  const failedAll = usages.every((usage) => !usage.ok)
  if (failedAll) {
    return { phase: 'error', configured, badge: '', periods: [], warnings, error: warnings.join('；') }
  }
  const multi = usages.length > 1
  const periods = usages.flatMap((usage) => usage.ok && usage.dashboard !== undefined ? zhipuLimitPeriods(usage.dashboard, multi ? usage.label : undefined) : [])
  const primary = usages.find((usage) => usage.primary && usage.ok && usage.dashboard !== undefined)
    ?? usages.find((usage) => usage.ok && usage.dashboard !== undefined)
  const baseBadge = primary?.dashboard?.level ?? ''
  const badge = multi && baseBadge !== '' ? baseBadge + ' · ' + usages.length + ' 渠道' : baseBadge
  return { phase: 'ready', configured, badge, periods, warnings }
}

/** MiniMax：官方给的是剩余百分比，换算成已用；每模型 5h/周两行。 */
export function minimaxCard(status: { credentialConfigured: boolean } | null, dashboard: MiniMaxDashboard): OverviewCardState {
  const periods: OverviewPeriod[] = []
  for (const model of dashboard.models.filter((entry) => entry.included).slice(0, 3)) {
    if (model.intervalRemainingPercent !== undefined) {
      const usedPercent = Math.max(0, Math.min(100, 100 - model.intervalRemainingPercent))
      periods.push({ label: model.name + ' · 5 小时', usedPercent, detail: percentText(usedPercent), resetAt: model.intervalEndAt })
    }
    if (model.weeklyRemainingPercent !== undefined) {
      const usedPercent = Math.max(0, Math.min(100, 100 - model.weeklyRemainingPercent))
      periods.push({ label: model.name + ' · 本周', usedPercent, detail: percentText(usedPercent), resetAt: model.weeklyEndAt })
    }
  }
  return {
    phase: 'ready',
    configured: status?.credentialConfigured ?? false,
    subscribed: dashboard.models.some((entry) => entry.included),
    planName: dashboard.planName,
    badge: dashboard.planName ?? '',
    periods,
    warnings: dashboard.warnings,
  }
}

/** 方舟：Agent Plan 的 5h/周/月三段；Coding Plan 未订阅时不占位。 */
export function arkCard(status: { credentialConfigured: boolean; usageAccessKeyConfigured: boolean; usageSecretKeyConfigured: boolean } | null, dashboard: ArkUsageDashboard): OverviewCardState {
  const usageConfigured = (status?.usageAccessKeyConfigured ?? false) && (status?.usageSecretKeyConfigured ?? false)
  const periods: OverviewPeriod[] = []
  for (const plan of dashboard.plans) {
    if (!plan.subscribed) continue
    const planLabel = plan.product === 'agent-plan' ? 'Agent Plan' : 'Coding Plan'
    for (const period of plan.periods) {
      const label = period.level === '5h' ? planLabel + ' · 5 小时' : period.level === 'weekly' ? planLabel + ' · 本周' : planLabel + ' · 本月'
      const usedPercent = Math.max(0, Math.min(100, period.usedPercent ?? 0))
      periods.push({ label, usedPercent, detail: percentText(usedPercent), resetAt: period.resetAt })
    }
  }
  return {
    phase: 'ready',
    configured: usageConfigured,
    subscribed: dashboard.plans.some((plan) => plan.subscribed),
    badge: usageConfigured ? 'AK/SK 已配置' : '待配置控制面 AK/SK',
    periods,
    warnings: dashboard.warnings,
  }
}
