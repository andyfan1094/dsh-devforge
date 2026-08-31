/** Coding Plan 总览控制面板：一屏并排三家套餐用量。 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { DevforgeApi } from '../api.ts'
import type { ArkUsageDashboard } from '../../ark/protocol.ts'
import type { MiniMaxDashboard } from '../../minimax/protocol.ts'
import type { ZhipuDashboard } from '../../zhipu/protocol.ts'
import css from './panel.module.css'

export type OverviewProvider = 'zhipu' | 'minimax' | 'ark'

export interface UsageOverviewTabProps {
  api: DevforgeApi
  /** 跳转到对应服务商的使用配置页。 */
  onNavigate: (provider: OverviewProvider) => void
}

/** 统一的一行用量窗口。 */
interface OverviewPeriod {
  label: string
  usedPercent: number
  detail: string
  resetAt?: number
}

interface OverviewCardState {
  phase: 'loading' | 'ready' | 'error'
  configured: boolean
  subscribed?: boolean
  badge: string
  planName?: string
  periods: OverviewPeriod[]
  warnings: string[]
  error?: string
}

const INITIAL_CARD: OverviewCardState = { phase: 'loading', configured: false, badge: '', periods: [], warnings: [] }

function formatCountdown(timestamp: number | undefined, now: number): string {
  if (timestamp === undefined || !Number.isFinite(timestamp)) return '重置时间未知'
  const remaining = timestamp - now
  if (remaining <= 0) return '即将重置'
  const minutes = Math.ceil(remaining / 60_000)
  if (minutes < 60) return minutes + ' 分钟后重置'
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return hours + ' 小时后重置'
  return Math.floor(hours / 24) + ' 天后重置'
}

function percentText(usedPercent: number): string {
  return usedPercent.toFixed(1) + '% 已用 · ' + Math.max(0, 100 - usedPercent).toFixed(1) + '% 剩余'
}

/** 智谱：limits 直接带 5h/周/月三类窗口。 */
function zhipuCard(status: { credentialConfigured: boolean } | null, dashboard: ZhipuDashboard): OverviewCardState {
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
function minimaxCard(status: { credentialConfigured: boolean } | null, dashboard: MiniMaxDashboard): OverviewCardState {
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
function arkCard(status: { credentialConfigured: boolean; usageAccessKeyConfigured: boolean; usageSecretKeyConfigured: boolean } | null, dashboard: ArkUsageDashboard): OverviewCardState {
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

/** 总览控制面板：三张卡片并行加载，单家失败互不影响。 */
export function UsageOverviewTab({ api, onNavigate }: UsageOverviewTabProps): JSX.Element {
  const [zhipu, setZhipu] = useState<OverviewCardState>(INITIAL_CARD)
  const [minimax, setMiniMax] = useState<OverviewCardState>(INITIAL_CARD)
  const [ark, setArk] = useState<OverviewCardState>(INITIAL_CARD)
  const [refreshing, setRefreshing] = useState<OverviewProvider | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const mounted = useRef(false)
  const generation = useRef(0)

  const loadZhipu = useCallback(async (): Promise<void> => {
    try {
      const [status, dashboard] = await Promise.all([api.getZhipuStatus(), api.getZhipuDashboard('day')])
      if (mounted.current) setZhipu(zhipuCard(status, dashboard))
    } catch (cause) {
      if (mounted.current) setZhipu({ ...INITIAL_CARD, phase: 'error', error: cause instanceof Error ? cause.message : String(cause) })
    }
  }, [api])
  const loadMiniMax = useCallback(async (): Promise<void> => {
    try {
      const [status, dashboard] = await Promise.all([api.getMiniMaxStatus(), api.getMiniMaxDashboard()])
      if (mounted.current) setMiniMax(minimaxCard(status, dashboard))
    } catch (cause) {
      if (mounted.current) setMiniMax({ ...INITIAL_CARD, phase: 'error', error: cause instanceof Error ? cause.message : String(cause) })
    }
  }, [api])
  const loadArk = useCallback(async (live: boolean): Promise<void> => {
    try {
      const status = await api.getArkStatus()
      const dashboard = live ? await api.refreshArkUsage() : await api.getArkDashboard()
      if (mounted.current) setArk(arkCard(status, dashboard))
    } catch (cause) {
      if (mounted.current) setArk({ ...INITIAL_CARD, phase: 'error', error: cause instanceof Error ? cause.message : String(cause) })
    }
  }, [api])

  const refresh = useCallback(async (provider: OverviewProvider): Promise<void> => {
    if (refreshing !== null) return
    generation.current += 1
    setRefreshing(provider)
    try {
      if (provider === 'zhipu') await loadZhipu()
      else if (provider === 'minimax') await loadMiniMax()
      else await loadArk(true)
    } finally {
      if (mounted.current) setRefreshing(null)
    }
  }, [refreshing, loadZhipu, loadMiniMax, loadArk])

  useEffect(() => {
    mounted.current = true
    void loadZhipu()
    void loadMiniMax()
    void loadArk(false)
    const timer = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => {
      mounted.current = false
      generation.current += 1
      window.clearInterval(timer)
    }
  }, [loadZhipu, loadMiniMax, loadArk])

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
            <strong>{period.label}</strong>
            <span>{period.detail} · {formatCountdown(period.resetAt, now)}</span>
          </div>
          <div className={css['progressTrack']} role="progressbar" aria-label={period.label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={period.usedPercent}>
            <span className={css['progressFill']} data-level={period.usedPercent >= 95 ? 'danger' : period.usedPercent >= 80 ? 'warning' : 'normal'} style={{ width: period.usedPercent + '%' }} />
          </div>
        </div>
      ))}
      {card.warnings.map((warning) => <p key={warning} className={css['overviewError']}>{warning}</p>)}
      <div className={css['overviewCardActions']}>
        <button type="button" className={css['ghostButton']} disabled={refreshing !== null} onClick={() => { void refresh(provider) }}>{refreshing === provider ? '刷新中…' : '刷新'}</button>
        {!card.configured && <button type="button" className={css['ghostButton']} onClick={() => onNavigate(provider)}>去配置</button>}
      </div>
    </section>
  )

  return (
    <div className={css['overviewWorkspace']}>
      <div className={css['overviewGrid']}>
        {renderCard('zhipu', '智谱 GLM', '尚未配置 API Key，前往使用配置页填写', zhipu)}
        {renderCard('minimax', 'MiniMax', '尚未配置 API Key，前往使用配置页填写', minimax)}
        {renderCard('ark', '火山方舟', '需要控制面 AK/SK 查询套餐用量，前往使用配置页填写', ark)}
      </div>
    </div>
  )
}
