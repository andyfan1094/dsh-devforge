/** 首页左侧栏底部的「智谱 5 小时」用量小卡片（原独立插件 dsh-zhipu-quota 0.3.0 原样并入）。
 * 数据源：本插件 /api/dsh-devforge/zhipu/dashboards?window=day（同源 fetch，Key 池全部渠道）。
 * 辉哥定稿：只显示池序第一把 Key（当前主 Key），单行「名称 + 还有多久重置倒计时 + 百分比」
 * + 细进度条；倒计时 30 秒走字，数据 2 分钟自动拉取，点击立即刷新；
 * 槽位容器默认横排，这里加 wrap 规则让卡片独占一行、摞在费用块下面。 */
import { createElement, useCallback, useEffect, useState } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { extractZhipuRows, formatResetCountdown } from './zhipu-quota-core.ts'

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
 * 卡片组件：只显示池序第一把 Key（当前主 Key）的 5 小时额度。
 * 加载中或无数据返回 null 保持侧栏干净；刷新失败保留旧数据，悬停标题会注明。
 */
function ZhipuQuotaCard({ timer }: { timer: TimerFace }): React.ReactNode {
  const [state, setState] = useState({ rows: null as ReturnType<typeof extractZhipuRows> | null, stale: false })
  // 30 秒心跳：驱动「还有多久重置」倒计时走字（数据本身仍每 2 分钟拉取一次）。
  const [now, setNow] = useState(() => Date.now())
  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/dsh-devforge/zhipu/dashboards?window=day')
      if (!response.ok) throw new Error('HTTP ' + response.status)
      const payload = await response.json() as unknown
      // 辉哥定稿：只取第一把 Key（maxRows = 1），其余渠道不占侧栏空间。
      setState({ rows: extractZhipuRows(payload, 1), stale: false })
    } catch {
      // 刷新失败保留已有数据；从未成功过则维持 null（不渲染）。
      setState((prev) => ({ rows: prev.rows, stale: true }))
    }
  }, [])
  useEffect(() => {
    void load()
    setNow(Date.now())
    return timer.interval(() => { void load(); setNow(Date.now()) }, REFRESH_MS)
  }, [load, timer])
  useEffect(() => timer.interval(() => setNow(Date.now()), TICK_MS), [timer])

  // 收起窄栏（56px rail）暂不渲染，避免挤压图标列；数据为空/加载中同样不渲染。
  if (state.rows === null || state.rows.length === 0) return null
  const row = state.rows[0]
  const resetText = formatResetCountdown(row.resetAt, now)
  const tip = state.stale
    ? row.title + '（最近一次自动刷新失败，稍后重试或点击立即刷新）'
    : '智谱 Coding Plan 5 小时额度 · 点击立即刷新'

  return createElement('div', { style: { width: '100%' } },
    createElement('style', null, CARD_CSS),
    createElement('button', { type: 'button', className: 'dzq-card', onClick: () => { void load() }, title: tip },
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
    ),
  )
}

/**
 * 把「智谱 5 小时」用量卡片挂进外壳 sidebar.footer.action 槽位。
 * 槽位或 timer 缺席时静默退出（返回空清理函数），绝不影响 GUI 其余部分。
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
