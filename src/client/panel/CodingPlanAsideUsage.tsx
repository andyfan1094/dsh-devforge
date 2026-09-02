/** Coding Plan 侧栏用量速览：填充「套餐信息」下方的空白区，紧凑展示三家用量。
 * 展示策略：默认每家只展示已用比例最高的一条（最紧窗口优先），可展开全部窗口；
 * 数据与控制面板总览同源（CodingPlanTab 统一加载），本组件只做展示、展开与刷新触发。 */
import { useState } from 'react'
import type { OverviewCardState, OverviewCards, OverviewPeriod, OverviewProvider } from './UsageOverviewTab.tsx'
import { resolveOverviewReset } from './reset-countdown.ts'
import css from './panel.module.css'

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

/** 由 Overview 窗口行换算侧栏紧凑行：整数百分比 + 简短倒计时。 */
function toAsideRows(periods: OverviewPeriod[], now: number, inferLevel: (label: string) => string): AsideUsageRow[] {
  return periods.map((period) => {
    const view = resolveOverviewReset(period.resetAt, now, inferLevel(period.label))
    return { label: period.label, usedPercent: period.usedPercent, resetText: view.text, urgency: view.urgency }
  })
}

/** 侧栏窗口级别推断：与总览页同规则（label 关键字分档）。 */
function inferAsideLevel(label: string): string {
  if (label.includes('5 小时')) return 'short-window'
  if (label.includes('本周')) return 'weekly'
  if (label.includes('本月')) return 'monthly'
  return 'unknown'
}

/** 挑出已用比例最高的一行作为默认展示（最紧窗口优先）。 */
function pickTightest(rows: AsideUsageRow[]): AsideUsageRow | null {
  let tightest: AsideUsageRow | null = null
  for (const row of rows) {
    if (tightest === null || row.usedPercent > tightest.usedPercent) tightest = row
  }
  return tightest
}

/** 单家用量块：加载/错误/待配置/正常四态，正常态默认只显示最紧窗口。 */
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
  // 未展开时只渲染最紧的一条（先算一次再过滤），避免侧栏被多模型多窗口撑成长页。
  const tightest = !expanded && rows.length > 1 ? pickTightest(rows) : null
  const visibleRows = tightest === null ? rows : rows.filter((row) => row === tightest)
  const progressLevel = (percent: number): string => (percent >= 95 ? 'danger' : percent >= 80 ? 'warning' : 'normal')

  return (
    <div className={css['asideUsageGroup']}>
      <div className={css['asideUsageName']}>
        <strong>{title}</strong>
        {rows.length > 1 && (
          <button type="button" className={css['asideUsageExpand']} aria-expanded={expanded} onClick={onToggleExpand}>
            {expanded ? '收起' : '全部 ' + rows.length + ' 项'}
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
      {card.phase === 'ready' && rows.length > 0 && visibleRows.map((row) => (
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

/** 侧栏用量速览面板：套餐信息列表下方的常驻紧凑看板。 */
export function CodingPlanAsideUsage({ cards, refreshing, now, onRefresh, onNavigate }: CodingPlanAsideUsageProps): JSX.Element {
  // 展开状态按商家记忆：切页签不重置，回到侧栏仍是用户上次选择的粒度。
  const [expanded, setExpanded] = useState<{ zhipu: boolean; minimax: boolean; ark: boolean }>({ zhipu: false, minimax: false, ark: false })
  const toggleExpand = (key: 'zhipu' | 'minimax' | 'ark'): void => setExpanded((prev) => ({ ...prev, [key]: !prev[key] }))

  return (
    <section className={css['asideUsage']} aria-label="用量速览">
      <div className={css['asideUsageHeader']}>
        <h4 className={css['asideUsageTitle']}>用量速览</h4>
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
