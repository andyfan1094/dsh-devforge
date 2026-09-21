/** 首页左侧栏底部的「Coding Plan 5 小时」用量小卡片（原独立插件 dsh-zhipu-quota 0.3.0 并入后扩展）。
 * 数据源：本插件 /api/dsh-devforge/zhipu/dashboards?window=day（智谱主 Key）
 * 与 /api/dsh-devforge/ark/dashboard（方舟 Agent/Coding Plan，辉哥 2026-09-21 定稿加入）。
 * 展示：每行「名称 + 还有多久重置倒计时 + 百分比」+ 细进度条；
 * 倒计时 30 秒走字，数据 2 分钟自动拉取，点击立即刷新；
 * 方舟未配置 AK/SK 或套餐未订阅时不占行，失败不影响智谱行。 */
import { createElement, useCallback, useEffect, useState } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { extractArkRows, extractZhipuRows, formatResetCountdown, type ArkQuotaRow } from './zhipu-quota-core.ts'

/** 本卡片消费的槽位面（窄化自 dsh-client-ui-slots，避免对槽位包强类型依赖）。 */
interface SlotsFace {
  inject(key: string, factory: () => () => void): () => void
  register(options: { name: string; id: string; order: number }, component: (props: { wide: boolean }) => React.ReactNode): () => void
}

/** 本卡片消费的 timer 面（客户端 timer 服务的 interval）。 */
interface TimerFace {
  interval(fn: () => void, ms: number): () => void
}

/** 卡片样式：紧凑密度；颜色全部引用主题 token，暗色模式自动适配。 */
const CARD_CSS = [
  // 槽位容器是横排 flex（外壳 .footerActions），允许换行后本卡 width:100% 即独占一行；
  // 类名走子串匹配，外壳升级改名时规则静默失效，不影响页面其余部分。
  '[class*="footerActions"]{flex-wrap:wrap}',
  '.dzq-card{display:flex;flex-direction:column;gap:4px;width:100%;box-sizing:border-box;margin:2px 0 6px;padding:6px 10px;border:1px solid var(--dsw-alias-border-l2,#d0d5dd);border-radius:8px;background:transparent;font:inherit;font-size:11px;line-height:1.5;color:var(--dsw-alias-label-secondary,#667085);text-align:left;cursor:pointer;transition:background-color .15s ease}',
  '.dzq-card:hover{background:var(--dsw-alias-interactive-bg-hover,#f3f4f6)}',
  '.dzq-card:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#2563eb);outline-offset:1px}',
  '.dzq-top{display:flex;align-items:baseline;gap:8px}',
  '.dzq-row{display:flex;flex-direction:column;gap:3px;width:100%}',
  '.dzq-row + .dzq-row{margin-top:6px;padding-top:6px;border-top:1px solid color-mix(in srgb,var(--dsw-alias-border-l2,#d0d5dd) 45%,transparent)}',
  '.dzq-label{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.dzq-reset{flex:none;font-weight:400;color:var(--dsw-alias-label-tertiary,#98a2b3);font-variant-numeric:tabular-nums}',
  '.dzq-pct{flex:none;font-weight:600;color:var(--dsw-alias-label-primary,#1f2329);font-variant-numeric:tabular-nums}',
  '.dzq-track{position:relative;height:4px;border-radius:2px;overflow:hidden;background:color-mix(in srgb,var(--dsw-alias-border-l2,#d0d5dd) 55%,transparent)}',
  '.dzq-fill{position:absolute;top:0;bottom:0;left:0;min-width:2px;border-radius:inherit;background:var(--dsw-alias-state-business-primary,#2563eb);transition:width .18s ease}',
  '.dzq-fill[data-level="warning"]{background:var(--dsw-alias-state-warning-primary,#ca8a04)}',
  '.dzq-fill[data-level="danger"]{background:var(--dsw-alias-state-error-primary,#dc2626)}',
].join('\n')

/** 数据刷新间隔：2 分钟（辉哥定稿）；卡片可随时点击立即刷新。 */
const REFRESH_MS = 2 * 60 * 1000

/** 倒计时走字间隔：30 秒，仅重算本地时间，不打接口。 */
const TICK_MS = 30_000

/**
 * 卡片组件：智谱主 Key + 方舟 Agent/Coding Plan 的 5 小时额度（每套餐一行）。
 * 加载中或完全无数据返回 null 保持侧栏干净；刷新失败保留旧数据，悬停标题会注明。
 */
function ZhipuQuotaCard({ timer }: { timer: TimerFace }): React.ReactNode {
  const [state, setState] = useState({
    rows: null as ReturnType<typeof extractZhipuRows> | null,
    arkRows: null as ReturnType<typeof extractArkRows> | null,
    stale: false,
  })
  // 30 秒心跳：驱动「还有多久重置」倒计时走字（数据本身仍每 2 分钟拉取一次）。
  const [now, setNow] = useState(() => Date.now())
  const load = useCallback(async () => {
    // 智谱主 Key（现状保留）。
    try {
      const response = await fetch('/api/dsh-devforge/zhipu/dashboards?window=day')
      if (!response.ok) throw new Error('HTTP ' + response.status)
      const payload = await response.json() as unknown
      // 辉哥定稿：只取第一把 Key（maxRows = 1），其余渠道不占侧栏空间。
      setState((prev) => ({ ...prev, rows: extractZhipuRows(payload, 1), stale: false }))
    } catch {
      // 刷新失败保留已有数据；从未成功过则维持 null（不渲染该行）。
      setState((prev) => ({ ...prev, stale: true }))
    }
    // 方舟 Agent/Coding Plan（独立容错：失败不影响智谱行）。
    try {
      const arkResponse = await fetch('/api/dsh-devforge/ark/dashboard')
      if (!arkResponse.ok) throw new Error('HTTP ' + arkResponse.status)
      const arkPayload = await arkResponse.json() as { dashboard?: unknown }
      setState((prev) => ({ ...prev, arkRows: extractArkRows(arkPayload.dashboard) }))
    } catch {
      // 方舟刷新失败保持旧值；从未成功过则维持 null（不渲染方舟行）。
    }
  }, [])
  useEffect(() => {
    void load()
    setNow(Date.now())
    return timer.interval(() => { void load(); setNow(Date.now()) }, REFRESH_MS)
  }, [load, timer])
  useEffect(() => timer.interval(() => setNow(Date.now()), TICK_MS), [timer])

  // 收起窄栏（56px rail）暂不渲染；两类数据都为空/未加载时同样不渲染。
  const zhipuRow = state.rows !== null && state.rows.length > 0 ? state.rows[0] : null
  const arkRows = state.arkRows ?? []
  if (zhipuRow === null && arkRows.length === 0) return null

  const renderRow = (row: { label: string; percent: number; level: 'normal' | 'warning' | 'danger'; resetAt?: number; title: string }, key: string): React.ReactNode => {
    const resetText = formatResetCountdown(row.resetAt, now)
    return createElement('span', { className: 'dzq-row', key },
      createElement('span', { className: 'dzq-top' },
        createElement('span', { className: 'dzq-label', title: row.title }, row.label),
        // 「还有多久重置」倒计时（辉哥定稿：放在渠道名后面），30 秒自动走字。
        resetText !== '' && createElement('span', { className: 'dzq-reset' }, resetText),
        createElement('span', { className: 'dzq-pct' }, Math.round(row.percent) + '%'),
      ),
      createElement('span', {
        className: 'dzq-track',
        role: 'progressbar',
        'aria-label': row.label + ' 5 小时额度',
        'aria-valuemin': 0,
        'aria-valuemax': 100,
        'aria-valuenow': row.percent,
      },
        createElement('span', { className: 'dzq-fill', 'data-level': row.level, style: { width: row.percent + '%' } }),
      ),
    )
  }

  const tip = state.stale
    ? 'Coding Plan 5 小时额度（智谱最近一次自动刷新失败，稍后重试或点击立即刷新）'
    : 'Coding Plan 5 小时额度 · 点击立即刷新'

  return createElement('div', { style: { width: '100%' } },
    createElement('style', null, CARD_CSS),
    createElement('button', { type: 'button', className: 'dzq-card', onClick: () => { void load() }, title: tip },
      zhipuRow !== null && renderRow(zhipuRow, 'zhipu'),
      arkRows.map((row) => renderRow(row, row.key)),
    ),
  )
}

/**
 * 把「Coding Plan 5 小时」用量卡片（智谱主 Key + 方舟 Agent/Coding Plan）挂进外壳
 * sidebar.footer.action 槽位。槽位或 timer 缺席时静默退出（返回空清理函数），绝不影响 GUI 其余部分。
 */
export function mountZhipuQuotaSidebar(ctx: ClientContext): () => void {
  const slots = ctx.get('slots') as unknown as SlotsFace | undefined
  if (slots === undefined) return () => {}
  let disposed = false
  let disposeEntry: (() => void) | undefined
  ctx.inject(['timer'], (scope) => {
    if (disposed) return
    const timer = scope as unknown as TimerFace
    // 槽位可能被外壳裁掉：register 失败时静默退出，不影响页面其余部分。
    disposeEntry = slots.inject('sidebar.footer.action', () => {
      try {
        return slots.register(
          { name: 'sidebar.footer.action', id: 'dsh-devforge:zhipu-quota', order: -1 },
          (props) => (props.wide === true ? createElement(ZhipuQuotaCard, { timer }) : null),
        )
      } catch {
        return () => {}
      }
    })
  })
  return () => {
    disposed = true
    disposeEntry?.()
  }
}
