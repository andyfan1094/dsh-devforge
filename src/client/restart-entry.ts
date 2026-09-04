/**
 * 侧边栏「重启 DSH」入口 —— 注入到左下角「设置」按钮旁的紧凑重启按钮（纯 DOM）。
 *
 * 背景：壳不对外部插件提供侧边栏 Slot（sidebar-entry-core 同款约束），
 * 「重启 DSH」从操作台头部挪到「设置」按钮旁，归位到系统级操作区。
 * 实现策略：克隆壳的设置按钮节点——继承壳原样式，视觉完全一致、零自有样式成本；
 * 替换文案与图标后插入其旁（父容器横排落在右侧、竖排落在下方，两种布局都紧贴设置）。
 * 壳改版找不到设置按钮时，兜底把按钮插到侧边栏根部末尾（视觉在设置附近），
 * 保证重启入口始终可见。壳重渲染挤掉节点后由 MutationObserver 同帧自愈重插。
 */
import type { DevforgeApi } from './api.ts'
import css from './panel/panel.module.css'
import { restartDshAndWait } from './panel/restart-dsh.ts'

/** 注入按钮的幂等键与语义属性（semantic-attrs 契约：插件名 + 部件名）。 */
const ENTRY_ATTR = 'data-dsh-devforge-restart'
const ENTRY_SELECTOR = '[data-dsh-devforge-restart]'

/** 重启图标：循环箭头，线宽圆角与壳 16px 线性图标风格一致。 */
const RESTART_ICON = '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13.6 8a5.6 5.6 0 1 1-1.64-3.96"/><path d="M13.7 1.6v2.9h-2.9"/></svg>'

/** 按钮文案（与克隆来源设置按钮保持同等长度，紧凑不拥挤）。 */
const ENTRY_LABEL = '重启'
/** 悬停提示（含完整语义，与原按钮 title 区分）。 */
const ENTRY_TOOLTIP = '重启 DSH Web 服务'

/** 定位侧边栏根元素，与 sidebar-entry-core 同一定位契约（logoRow 归属者优先）。 */
function sidebarRoot(): HTMLElement | undefined {
  const column = document.querySelector<HTMLElement>('[data-pane="sidebar"], [class*="sidebarCol"]')
  if (column === null) return undefined
  const logoOwner = column.querySelector<HTMLElement>('[class*="logoRow"]')?.parentElement
  return logoOwner ?? (column.firstElementChild as HTMLElement | undefined)
}

/**
 * 在侧边栏根内查找壳的设置按钮：以可见文本或 aria-label 精确等于「设置」为准。
 * 只认精确匹配，避免把「视图选项」等含设置语义的相邻按钮误认成锚点。
 */
function settingsAnchor(root: HTMLElement): HTMLButtonElement | undefined {
  for (const button of root.querySelectorAll('button')) {
    const label = (button.getAttribute('aria-label') ?? '').trim()
    const text = (button.textContent ?? '').trim()
    if (label === '设置' || text === '设置') return button
  }
  return undefined
}

/**
 * 克隆壳按钮并改造为重启入口：保留壳 class（视觉一致），替换图标、文案与提示。
 * 克隆节点不带 React 事件绑定（React 通过 fiber 复用节点，克隆体无 fiber），
 * 壳的 reconcile 只会把它当陌生节点跳过，绝不会触发壳自身的设置逻辑。
 */
function createEntryFromModel(model: HTMLButtonElement): HTMLButtonElement {
  const entry = model.cloneNode(true) as HTMLButtonElement
  entry.type = 'button'
  entry.disabled = false
  entry.setAttribute(ENTRY_ATTR, '')
  entry.setAttribute('data-dsh-plugin', 'devforge')
  entry.setAttribute('data-dsh-part', 'restart-entry')
  entry.setAttribute('aria-label', ENTRY_TOOLTIP)
  entry.setAttribute('title', ENTRY_TOOLTIP)
  // 改造内部结构：icon 容器换成重启图标，文本容器换成「重启」；
  // 结构与预期不符时退化为纯文本按钮，保证入口语义不丢。
  const spans = Array.from(entry.querySelectorAll('span'))
  const labelSpan = spans.reverse().find((span) => (span.textContent ?? '').trim() !== '')
  const iconSpan = spans.find((span) => span !== labelSpan)
  if (labelSpan !== undefined) {
    labelSpan.textContent = ENTRY_LABEL
  } else {
    entry.textContent = ENTRY_LABEL
  }
  if (iconSpan !== undefined) iconSpan.innerHTML = RESTART_ICON
  return entry
}

/** 兜底自建按钮：壳改版找不到设置按钮时保证入口仍可见（朴素样式，不追求一致）。 */
function createFallbackEntry(): HTMLButtonElement {
  const entry = document.createElement('button')
  entry.type = 'button'
  entry.setAttribute(ENTRY_ATTR, '')
  entry.setAttribute('data-dsh-plugin', 'devforge')
  entry.setAttribute('data-dsh-part', 'restart-entry')
  entry.setAttribute('aria-label', ENTRY_TOOLTIP)
  entry.setAttribute('title', ENTRY_TOOLTIP)
  entry.innerHTML = RESTART_ICON + '<span>' + ENTRY_LABEL + '</span>'
  return entry
}

/**
 * 挂载重启入口，等待壳渲染并自愈；返回 disposer 移除节点与观察者。
 * @param api 天工造梦 HTTP API（重启走 devforge Host 服务）。
 */
export function mountRestartEntry(api: DevforgeApi): () => void {
  // DOM 级幂等：重复 apply / HMR 重注入时绝不挂第二颗按钮；整页刷新是最终复位。
  if (document.querySelector(ENTRY_SELECTOR) !== null) {
    return () => {}
  }

  let entry: HTMLButtonElement | undefined
  /** 重启进行中标记：期间按钮禁用、图标旋转，防重复触发。 */
  let busy = false

  /** 点击：发起重启；成功路径整页刷新收尾，失败时恢复按钮并以 title 提示原因。 */
  const onClick = (): void => {
    if (busy || entry === undefined) return
    busy = true
    entry.disabled = true
    entry.setAttribute('title', '正在重启 DSH…')
    const icon = entry.querySelector('svg')
    if (icon !== null) icon.classList.add(css['restartSpin'] ?? '')
    void restartDshAndWait(api, (message) => {
      busy = false
      if (entry !== undefined) {
        entry.disabled = false
        entry.setAttribute('title', '重启失败：' + message)
        icon?.classList.remove(css['restartSpin'] ?? '')
      }
    })
  }

  /** 定位锚点并落位；已挂载且仍在文档中时短路返回，不做无谓 DOM 操作。 */
  const tryPlace = (): void => {
    if (entry !== undefined && entry.isConnected) return
    const root = sidebarRoot()
    if (root === undefined) return
    // 重建节点：上一颗已被壳整树替换或未创建过。
    entry?.remove()
    const anchor = settingsAnchor(root)
    entry = anchor !== undefined ? createEntryFromModel(anchor) : createFallbackEntry()
    entry.addEventListener('click', onClick)
    if (anchor !== undefined) {
      // 紧贴设置按钮：父容器横排时落在其右侧（辉哥标注位置），竖排时落在其下方。
      anchor.parentElement?.insertBefore(entry, anchor.nextSibling)
    } else {
      // 兜底：根部末尾（视觉在设置按钮附近区域）。
      root.appendChild(entry)
    }
  }

  // body 级观察者：兜住壳整树重建；已落位时走 isConnected 短路，聊天流式输出等
  // 无关变更只花一次判断，不会反复搬运节点。
  const waitObserver = new MutationObserver(() => { tryPlace() })
  waitObserver.observe(document.body, { childList: true, subtree: true })

  tryPlace()

  return () => {
    waitObserver.disconnect()
    entry?.remove()
    entry = undefined
  }
}
