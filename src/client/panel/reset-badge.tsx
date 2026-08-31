/** 重置时间徽章 React 组件，与纯函数 reset-countdown.ts 分离，方便 strip-types 单测。 */
import { useEffect, useState } from 'react'
import type { ResetView } from './reset-countdown.ts'
import css from './panel.module.css'

/** 24 小时表盘 SVG 图标，避免 emoji 在不同平台表现不一致。 */
function ResetIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M8 4.4 V8 L10.4 9.6" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

/** 重置时间徽章组件。60s 精度，依赖父级 now ticker。
 * 重置时间缺失时返回 null，让父级 grid 第三列自动收缩，避免空胶囊占位。 */
export function ResetBadge({ view }: { view: ResetView }): JSX.Element | null {
  if (view.text === '重置时间未知') return null
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), 60_000)
    return () => window.clearInterval(id)
  }, [])
  const label = view.remainingMs <= 0 ? '即将重置' : '重置倒计时 ' + view.text
  return (
    <span className={css['resetBadge']} data-urgency={view.urgency} title={view.text} aria-label={label}>
      <ResetIcon />
      <span>{view.text}</span>
    </span>
  )
}
