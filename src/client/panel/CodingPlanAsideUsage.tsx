/** Coding Plan 侧栏套餐用量卡片：三家用量在左侧栏紧凑展示，默认展开全部窗口。
 * 辉哥定稿布局：套餐用量卡片在左（侧栏），模型 token 计量看板在右（控制面板顶部）。
 * 卡片状态类型与构建器（zhipuCard/minimaxCard/arkCard）原属 UsageOverviewTab，
 * 随布局定稿迁入本文件统一维护；数据仍由 CodingPlanTab 统一加载。 */
import { useState } from 'react'
import type { ArkUsageDashboard } from '../../ark/protocol.ts'
import type { MiniMaxDashboard } from '../../minimax/protocol.ts'
import type { ZhipuDashboard } from '../../zhipu/protocol.ts'
import { resolveOverviewReset } from './reset-countdown.ts'
import css from './panel.module.css'

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

export interface CodingPlanAsideUsageProps {
  cards: OverviewCards
  /** 正在刷新的商家；'all' 表示头部按钮触发的整体刷新。 */
  refreshing: OverviewProvider | 'all' | null
  /** 父级每分钟心跳的当前时间，驱动重置倒计时文案。 */
  now: number
  /** 刷新用量：传商家名刷新单家，传 'all' 刷新三家。 */
  onRefresh: (provider: OverviewProvider | 'all') => void
  /** 未配置时跳转对应服务商的使用配置页。 */
  onNavigate: (provider: OverviewProvider) => void
}

/** 侧栏一行用量窗口的展示数据。 */
interface AsideUsageRow {
  label: string
  usedPercent: number
  resetText: string
  urgency: 'normal' | 'warning' | 'danger'
}

/** 由 Overview 窗口行换算侧栏紧凑行：整数百分比 + 带紧急度的倒计时。 */
function toAsideRows(periods: OverviewPeriod[], now: number, inferLevel: (label: string) => string): AsideUsageRow[] {
  return periods.map((period) => {
    const view = resolveOverviewReset(period.resetAt, now, inferLevel(period.label))
    return { label: period.label, usedPercent: period.usedPercent, resetText: view.text, urgency: view.urgency }
  })
}

/** 侧栏窗口级别推断：与卡片同规则（label 关键字分档）。 */
function inferAsideLevel(label: string): string {
  if (label.includes('5 小时')) return 'short-window'
  if (label.includes('本周')) return 'weekly'
  if (label.includes('本月')) return 'monthly'
  return 'unknown'
}

/** 单家用量块：加载/错误/待配置/正常四态；默认展开全部窗口（辉哥要求）。 */
function AsideUsageGroup({ provider, title, card, now, expanded, onToggleExpand, refreshing, onRefresh, onNavigate }: {
  provider: OverviewProvider
  title: string
  card: OverviewCardState
  now: number
  expanded: boolean
  onToggleExpand: () => void
  refreshing: OverviewProvider | 'all' | null
  onRefresh: (provider: OverviewProvider | 'all') => void
  onNavigate: (provider: OverviewProvider) => void
}): JSX.Element {
  const rows = toAsideRows(card.periods, now, inferAsideLevel)
  const progressLevel = (percent: number): string => (percent >= 95 ? 'danger' : percent >= 80 ? 'warning' : 'normal')

  return (
    <div className={css['asideUsageGroup']}>
      <div className={css['asideUsageName']}>
        <strong>{title}</strong>
        {rows.length > 1 && (
          <button type="button" className={css['asideUsageExpand']} aria-expanded={expanded} onClick={onToggleExpand}>
            {expanded ? '收起' : '展开'}
          </button>
        )}
      </div>
      {card.phase === 'loading' && <p className={css['asideUsageEmpty']}>正在读取用量…</p>}
      {card.phase === 'error' && (
        <p className={css['asideUsageError']} role="alert" title={card.error}>
          {card.error}{' '}
          <button type="button" className={css['asideUsageGo']} disabled={refreshing !== null} onClick={() => onRefresh(provider)}>重试</button>
        </p>
      )}
      {card.phase === 'ready' && !card.configured && (
        <p className={css['asideUsageEmpty']}>
          待配置{' '}
          <button type="button" className={css['asideUsageGo']} onClick={() => onNavigate(provider)}>去配置</button>
        </p>
      )}
      {card.phase === 'ready' && card.configured && rows.length === 0 && <p className={css['asideUsageEmpty']}>暂无用量数据</p>}
      {(expanded || rows.length <= 1) && rows.map((row) => (
        <div key={row.label} className={css['asideUsageRow']}>
          <div className={css['asideUsageTop']}>
            <span className={css['asideUsageLabel']} title={row.label}>{row.label}</span>
            <span className={css['asideUsageValue']}>{Math.round(row.usedPercent)}% 已用</span>
          </div>
          <div className={css['asideUsageLine']}>
            <div className={css['asideUsageTrack']} role="progressbar" aria-label={title + ' ' + row.label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={row.usedPercent}>
              <span className={css['asideUsageFill']} data-level={progressLevel(row.usedPercent)} style={{ width: row.usedPercent + '%' }} />
            </div>
            <span className={css['asideUsageReset']} data-urgency={row.urgency} title={row.resetText}>{row.resetText}</span>
          </div>
        </div>
      ))}
    </div>
  )
}

/** 侧栏套餐用量卡片：套餐信息列表下方的常驻看板，默认全部展开。 */
export function CodingPlanAsideUsage({ cards, refreshing, now, onRefresh, onNavigate }: CodingPlanAsideUsageProps): JSX.Element {
  // 展开状态按商家记忆，默认全部展开（收起是用户主动行为）。
  const [expanded, setExpanded] = useState<{ zhipu: boolean; minimax: boolean; ark: boolean }>({ zhipu: true, minimax: true, ark: true })
  const toggleExpand = (key: 'zhipu' | 'minimax' | 'ark'): void => setExpanded((prev) => ({ ...prev, [key]: !prev[key] }))

  return (
    <section className={css['asideUsage']} aria-label="套餐用量">
      <div className={css['asideUsageHeader']}>
        <h4 className={css['asideUsageTitle']}>套餐用量</h4>
        <button
          type="button"
          className={css['asideUsageRefresh']}
          disabled={refreshing !== null}
          onClick={() => onRefresh('all')}
        >
          {refreshing === 'all' ? '刷新中…' : '刷新'}
        </button>
      </div>
      <AsideUsageGroup provider="zhipu" title="智谱 GLM" card={cards.zhipu} now={now} expanded={expanded.zhipu} onToggleExpand={() => toggleExpand('zhipu')} refreshing={refreshing} onRefresh={onRefresh} onNavigate={onNavigate} />
      <AsideUsageGroup provider="minimax" title="MiniMax" card={cards.minimax} now={now} expanded={expanded.minimax} onToggleExpand={() => toggleExpand('minimax')} refreshing={refreshing} onRefresh={onRefresh} onNavigate={onNavigate} />
      <AsideUsageGroup provider="ark" title="火山方舟" card={cards.ark} now={now} expanded={expanded.ark} onToggleExpand={() => toggleExpand('ark')} refreshing={refreshing} onRefresh={onRefresh} onNavigate={onNavigate} />
    </section>
  )
}
