/** 首页左侧栏底部的「天工造梦套餐」小卡片（原 dsh-zhipu-quota 并入后演进）。
 * 辉哥 2026-09-23 定稿：插件已采用用户登录（官网账号走中转），看板只显示官网套餐视角——
 * 「什么套餐/总量/剩余」+ 总余额 + 可搜次数；渠道平台配额行（智谱/方舟）全部移除。
 * 数据源：本插件 /api/dsh-devforge/modagentai/packages（受管凭据会话令牌，服务端聚合官网）。
 * 数据 2 分钟自动拉取，点击立即刷新；未登录/全空不占行，失败保持旧值。 */
import { createElement, useCallback, useEffect, useState } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { extractPackageRows, type PackageRow } from './zhipu-quota-core.ts'

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
  '.dzq-row + .dzq-row{margin-top:6px;padding-top:6px;border-top:1px solid var(--dsw-alias-border-l2,#d0d5dd)}',
  '.dzq-pkg-head{font-size:11px;font-weight:600;color:var(--dsw-alias-text-primary,#101828);margin-bottom:2px}',
  '.dzq-pkg-pending{font-size:10px;color:var(--dsw-alias-border-warning,#dc6803);border:1px solid currentColor;border-radius:999px;padding:0 6px;line-height:1.4}',
  '.dzq-pkg-hint{font-size:10px;color:var(--dsw-alias-label-secondary,#667085)}',
  '.dzq-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.dzq-pct{flex:none;margin-left:auto;font-variant-numeric:tabular-nums}',
  '.dzq-track{display:block;height:5px;border-radius:999px;background:var(--dsw-alias-fill-secondary,#e4e7ec);overflow:hidden}',
  '.dzq-fill{display:block;height:100%;border-radius:999px;background:var(--dsw-alias-state-business-primary,#2563eb)}',
  '.dzq-fill[data-level="warning"]{background:var(--dsw-alias-border-warning,#dc6803)}',
  '.dzq-fill[data-level="danger"]{background:var(--dsw-alias-border-danger,#d92d20)}',
]

/** 自动刷新间隔：2 分钟。 */
const REFRESH_MS = 120_000

function ZhipuQuotaCard({ timer }: { timer: TimerFace }): React.ReactNode {
  const [state, setState] = useState({
    pkgRows: null as ReturnType<typeof extractPackageRows> | null,
    pkgBalance: null as number | null,
    pkgUsername: '',
    pkgExpired: false,
    stale: false,
  })
  const load = useCallback(async () => {
    try {
      const pkgResponse = await fetch('/api/dsh-devforge/modagentai/packages')
      if (!pkgResponse.ok) throw new Error('HTTP ' + pkgResponse.status)
      const pkgPayload = await pkgResponse.json() as { packages?: unknown }
      const view = pkgPayload !== null && typeof pkgPayload === 'object' ? (pkgPayload as { packages?: Record<string, unknown> }).packages : undefined
      setState({
        pkgRows: extractPackageRows(pkgPayload),
        pkgBalance: view !== undefined && typeof view.balance === 'number' ? view.balance : null,
        pkgUsername: view !== undefined && typeof view.username === 'string' ? view.username : '',
        pkgExpired: view !== undefined && view.expired === true,
        stale: false,
      })
    } catch {
      // 刷新失败保留已有数据；从未成功过则维持 null（不渲染卡片）。
      setState((prev) => ({ ...prev, stale: true }))
    }
  }, [])
  useEffect(() => {
    void load()
    return timer.interval(() => { void load() }, REFRESH_MS)
  }, [load, timer])

  const pkgRows = state.pkgRows ?? []
  // 未登录或从未拉到数据时不占行（过期但曾有数据则保留卡片提示重新登录）。
  if (state.pkgRows === null) return null
  if (pkgRows.length === 0 && state.pkgBalance === null && !state.pkgExpired) return null

  // 套餐行：剩余占比进度条（剩得少才危险：≤15% 红 / ≤40% 琥珀）+ 未激活徽章。
  const renderPackageRow = (row: PackageRow, key: string): React.ReactNode => {
    const level = row.percent <= 15 ? 'danger' : row.percent <= 40 ? 'warning' : 'normal'
    return createElement('span', { className: 'dzq-row', key: 'pkg-' + key },
      createElement('span', { className: 'dzq-top' },
        createElement('span', { className: 'dzq-label', title: row.title }, row.label),
        !row.activated && createElement('span', { className: 'dzq-pkg-pending' }, '未激活'),
        createElement('span', { className: 'dzq-pct' }, Math.round(row.percent) + '%'),
      ),
      createElement('span', {
        className: 'dzq-track',
        role: 'progressbar',
        'aria-label': row.label + ' 剩余额度',
        'aria-valuemin': 0,
        'aria-valuemax': 100,
        'aria-valuenow': Math.round(row.percent),
      },
        createElement('span', { className: 'dzq-fill', 'data-level': level, style: { width: Math.max(1, row.percent) + '%' } }),
      ),
      row.pendingHint !== '' && createElement('span', { className: 'dzq-pkg-hint' }, row.pendingHint),
    )
  }

  const head = state.pkgExpired
    ? '天工造梦 · 会话已过期，请到个人中心重新登录'
    : '天工造梦 · ' + (state.pkgUsername !== '' ? state.pkgUsername : '未登录') + (state.pkgBalance !== null ? ' · 💎 ' + state.pkgBalance.toFixed(2) : '')
  const tip = state.stale
    ? '天工造梦套餐（最近一次自动刷新失败，稍后重试或点击立即刷新）'
    : '天工造梦套餐 · 点击立即刷新'

  return createElement('div', { style: { width: '100%' } },
    createElement('style', null, CARD_CSS),
    createElement('button', { type: 'button', className: 'dzq-card', onClick: () => { void load() }, title: tip },
      createElement('span', { className: 'dzq-pkg-head' }, head),
      pkgRows.map((row) => renderPackageRow(row, row.key)),
      pkgRows.length === 0 && createElement('span', { className: 'dzq-pkg-hint' }, state.pkgExpired ? '重新登录后显示套餐' : '暂无套餐，赞助后开始使用'),
    ),
  )
}

/**
 * 把「天工造梦套餐」卡片挂进外壳 sidebar.footer.action 槽位。槽位或 timer 缺席时静默退出（返回空清理函数），绝不影响 GUI 其余部分。
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