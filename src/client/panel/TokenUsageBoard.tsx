/** 控制面板「模型用量」看板：本机会话真实 token 计量，按模型聚合展示。
 * 视觉与套餐用量卡片同一语言（细进度条 + 行内数字），默认展开全部模型行；
 * 数据来自 /api/dsh-devforge/usage/tokens，一次请求同返今日/本周/全部三窗。 */
import { useCallback, useEffect, useState } from 'react'
import type { DevforgeApi } from '../api.ts'
import type { TokenUsageReport, TokenUsageRow } from '../../usage/tokens.ts'
import css from './panel.module.css'

export interface TokenUsageBoardProps {
  api: DevforgeApi
}

type Range = 'today' | 'week' | 'all'

/** token 数人类可读：B/M/K 自适应。 */
function formatTokens(value: number): string {
  if (value >= 1_000_000_000) return (value / 1_000_000_000).toFixed(2) + 'B'
  if (value >= 1_000_000) return (value / 1_000_000).toFixed(2) + 'M'
  if (value >= 1_000) return (value / 1_000).toFixed(1) + 'K'
  return String(value)
}

/** 单模型行：模型名 + 总量；进度条表达在窗口总量中的占比；次行输入/输出明细。 */
function TokenRowView({ row, totalAll }: { row: TokenUsageRow; totalAll: number }): JSX.Element {
  const total = row.inputTokens + row.outputTokens
  const sharePercent = totalAll > 0 ? total / totalAll * 100 : 0
  return (
    <div className={css['tokenBoardRow']}>
      <div className={css['tokenBoardTop']}>
        <strong title={row.provider + ' / ' + row.model}>{row.model}</strong>
        <span className={css['tokenBoardTotal']}>{formatTokens(total)} tokens</span>
      </div>
      <div className={css['progressTrack']} role="img" aria-label={'占比 ' + sharePercent.toFixed(1) + '%'}>
        <span className={css['progressFill']} style={{ width: Math.max(1, Math.min(100, sharePercent)) + '%' }} />
      </div>
      <span className={css['tokenBoardDetail']}>
        ↑{formatTokens(row.inputTokens)} · ↓{formatTokens(row.outputTokens)} · {row.requests} 次 · {row.provider} · 占比 {sharePercent.toFixed(1)}%
      </span>
    </div>
  )
}

/** 模型用量看板主体（控制面板页右区顶部）。 */
export function TokenUsageBoard({ api }: TokenUsageBoardProps): JSX.Element {
  const [report, setReport] = useState<TokenUsageReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  // 默认「全部」窗口：辉哥要求右侧全量展开，一眼看到完整历史用量。
  const [range, setRange] = useState<Range>('all')

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      const next = await api.getTokenUsage()
      setReport(next)
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoading(false)
    }
  }, [api])

  // 挂载即扫一次；本机增量扫描成本低，之后靠手动刷新。
  useEffect(() => { void load() }, [load])

  const activeWindow = report === null ? null : range === 'today' ? report.today : range === 'week' ? report.week : report.all
  const totalAll = activeWindow === null ? 0 : activeWindow.inputTokens + activeWindow.outputTokens

  return (
    <section className={css['overviewCard']} aria-label="模型用量">
      <div className={css['tokenBoardHeader']}>
        <div>
          <h3 className={css['sectionTitle']}>模型用量</h3>
          <p className={css['tokenBoardHint']}>来自本机会话记录的真实 token 计量</p>
        </div>
        <div className={css['tokenBoardActions']}>
          <div className={css['segmented']} role="tablist" aria-label="时间窗">
            <button type="button" role="tab" data-active={range === 'today' ? '' : undefined} aria-selected={range === 'today'} onClick={() => setRange('today')}>今日</button>
            <button type="button" role="tab" data-active={range === 'week' ? '' : undefined} aria-selected={range === 'week'} onClick={() => setRange('week')}>本周</button>
            <button type="button" role="tab" data-active={range === 'all' ? '' : undefined} aria-selected={range === 'all'} onClick={() => setRange('all')}>全部</button>
          </div>
          <button type="button" className={css['ghostButton']} disabled={loading} onClick={() => void load()}>{loading ? '扫描中…' : '刷新'}</button>
        </div>
      </div>
      {error !== null && (
        <p className={css['overviewError']} role="alert">
          {error} <button type="button" className={css['ghostButton']} disabled={loading} onClick={() => void load()}>重试</button>
        </p>
      )}
      {error === null && loading && report === null && <p className={css['overviewEmpty']}>正在扫描会话库…</p>}
      {error === null && activeWindow !== null && activeWindow.rows.length === 0 && (
        <p className={css['overviewEmpty']}>{range === 'today' ? '今天还没有模型调用' : range === 'week' ? '本周还没有模型调用' : '会话库中暂无用量记录'}</p>
      )}
      {error === null && activeWindow !== null && activeWindow.rows.map((row) => (
        <TokenRowView key={row.provider + ' / ' + row.model} row={row} totalAll={totalAll} />
      ))}
      {error === null && activeWindow !== null && activeWindow.rows.length > 0 && (
        <p className={css['tokenBoardSum']}>
          合计 ↑{formatTokens(activeWindow.inputTokens)} · ↓{formatTokens(activeWindow.outputTokens)} · {activeWindow.requests} 次请求
        </p>
      )}
      {report !== null && report.skipped.length > 0 && (
        <p className={css['overviewEmpty']} title={report.skipped.map((item) => item.file + ': ' + item.reason).join('\n')}>
          {report.skipped.length} 个会话文件正在写入，本次跳过
        </p>
      )}
    </section>
  )
}
