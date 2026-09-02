/** Coding Plan 总览控制面板：一屏并排三家套餐用量。
 * 数据由 CodingPlanTab 统一加载（本组件只做展示），与侧栏「用量速览」共享同一份卡片状态。 */
import css from './panel.module.css'
import { ResetBadge } from './reset-badge.tsx'
import { resolveOverviewReset } from './reset-countdown.ts'
import type { ArkUsageDashboard } from '../../ark/protocol.ts'
import type { MiniMaxDashboard } from '../../minimax/protocol.ts'
import type { ZhipuDashboard } from '../../zhipu/protocol.ts'

export type OverviewProvider = 'zhipu' | 'minimax' | 'ark'

/** 统一的一行用量窗口。 */
export interface OverviewPeriod {
  label: string
  usedPercent: number
  detail: string
  resetAt?: number
}

/** 单家用量卡片状态：总览页与侧栏速览共用的展示模型。 */
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

export interface UsageOverviewTabProps {
  cards: OverviewCards
  /** 正在刷新的商家；'all' 表示侧栏发起的整体刷新。 */
  refreshing: OverviewProvider | 'all' | null
  /** 父级每分钟心跳的当前时间，驱动重置倒计时文案。 */
  now: number
  /** 刷新指定商家用量。 */
  onRefresh: (provider: OverviewProvider) => void
  /** 跳转到对应服务商的使用配置页。 */
  onNavigate: (provider: OverviewProvider) => void
}

function percentText(usedPercent: number): string {
  return usedPercent.toFixed(1) + '% 已用 · ' + Math.max(0, 100 - usedPercent).toFixed(1) + '% 剩余'
}

/** 由 Overview 的 label 后缀推断窗口级别（用于徽章 urgency 分档）。 */
function inferOverviewLevel(label: string): 'short-window' | 'weekly' | 'monthly' | 'unknown' {
  if (label.includes('5 小时')) return 'short-window'
  if (label.includes('本周')) return 'weekly'
  if (label.includes('本月')) return 'monthly'
  return 'unknown'
}

/** 智谱：limits 直接带 5h/周/月三类窗口。 */
export function zhipuCard(status: { credentialConfigured: boolean } | null, dashboard: ZhipuDashboard): OverviewCardState {
  const periods = dashboard.limits
    .filter((limit) => limit.kind !== 'unknown')
    .map((limit) => {
      const usedPercent = Math.max(0, Math.min(100, limit.usedPercent ?? (limit.used !== undefined && limit.total !== undefined && limit.total > 0 ? limit.used / limit.total * 100 : 0)))
      const label = limit.kind === 'tokens-5h' ? '5 小时额度' : limit.kind === 'tokens-week' ? '本周额度' : '本月工具额度'
      const resetAt = typeof limit.nextResetTime === 'number' ? limit.nextResetTime : undefined
      return { label, usedPercent, detail: percentText(usedPercent), resetAt }
    })
  return {
    phase: 'ready',
    configured: status?.credentialConfigured ?? false,
    badge: dashboard.level ?? '',
    periods,
    warnings: dashboard.warnings,
  }
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

/** 总览控制面板：三张卡片并排展示，数据与刷新动作都来自父级 CodingPlanTab。 */
export function UsageOverviewTab({ cards, refreshing, now, onRefresh, onNavigate }: UsageOverviewTabProps): JSX.Element {
  const renderCard = (provider: OverviewProvider, title: string, hint: string, card: OverviewCardState): JSX.Element => (
    <section className={css['overviewCard']} aria-label={title + ' 用量'}>
      <div className={css['overviewCardHeader']}>
        <h3 className={css['sectionTitle']}>{title}</h3>
        <div className={css['overviewBadges']}>
          {card.badge !== '' && <span className={css['overviewBadge']} data-state="ok">{card.badge}</span>}
          <span className={css['overviewBadge']} data-state={card.configured ? 'ok' : 'pending'}>{card.configured ? '已配置' : '待配置'}</span>
          {card.subscribed === false && <span className={css['overviewBadge']} data-state="pending">未订阅</span>}
        </div>
      </div>
      {card.phase === 'loading' && <p className={css['overviewEmpty']}>正在读取用量…</p>}
      {card.phase === 'error' && <p className={css['overviewError']} role="alert">{card.error}</p>}
      {card.phase === 'ready' && card.periods.length === 0 && <p className={css['overviewEmpty']}>{card.configured ? '暂无可用量数据' : hint}</p>}
      {card.periods.map((period) => (
        <div key={period.label} className={css['overviewQuota']}>
          <div className={css['quotaMeta']}>
            <div className={css['quotaTop']}>
              <strong>{period.label}</strong>
              <ResetBadge view={resolveOverviewReset(period.resetAt, now, inferOverviewLevel(period.label))} />
            </div>
            <span>{period.detail}</span>
          </div>
          <div className={css['progressTrack']} role="progressbar" aria-label={period.label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={period.usedPercent}>
            <span className={css['progressFill']} data-level={period.usedPercent >= 95 ? 'danger' : period.usedPercent >= 80 ? 'warning' : 'normal'} style={{ width: period.usedPercent + '%' }} />
          </div>
        </div>
      ))}
      {card.warnings.map((warning) => <p key={warning} className={css['overviewError']}>{warning}</p>)}
      <div className={css['overviewCardActions']}>
        <button type="button" className={css['ghostButton']} disabled={refreshing !== null} onClick={() => onRefresh(provider)}>{refreshing === provider ? '刷新中…' : '刷新'}</button>
        {!card.configured && <button type="button" className={css['ghostButton']} onClick={() => onNavigate(provider)}>去配置</button>}
      </div>
    </section>
  )

  return (
    <div className={css['overviewWorkspace']}>
      <div className={css['overviewGrid']}>
        {renderCard('zhipu', '智谱 GLM', '尚未配置 API Key，前往使用配置页填写', cards.zhipu)}
        {renderCard('minimax', 'MiniMax', '尚未配置 API Key，前往使用配置页填写', cards.minimax)}
        {renderCard('ark', '火山方舟', '需要控制面 AK/SK 查询套餐用量，前往使用配置页填写', cards.ark)}
      </div>
    </div>
  )
}
