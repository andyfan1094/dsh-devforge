/**
 * 服务工厂中心视图挂载 —— 与 dsh-ssh 同一注入契约。
 *
 * 外部插件不能占用 conversation slot，因此仅在中心列追加一个独立 React root；
 * Controller 只控制 html active 属性，CSS 负责遮住会话。这样会话树保持挂载，
 * 而打开/关闭不会靠手工重复 root.render 造成状态漂移。
 */
import { createRoot, type Root } from 'react-dom/client'
import type { DevforgeApi } from './api.ts'
import { DevforgePanel } from './panel/DevforgePanel.tsx'
import type { PanelController } from './panel/controller.ts'
import css from './panel/panel.module.css'

/** 注入的中心视图容器。 */
export const PANEL_VIEW_SELECTOR = '[data-dsh-devforge-view]'

const CONVERSATION_COLUMN_SELECTOR = '[data-pane="conversation"], [class*="centerCol"]'
const ACTIVE_ATTR = 'data-dsh-devforge-active'
/** 当前 Web profile 内会占用中心列的已知兄弟面板。 */
const OTHER_ACTIVE_ATTRS = [
  'data-dsh-taskboard-active',
  'data-dsh-ssh-active',
  'data-dsh-mnemon-active',
  'data-dsh-skill-explorer-active',
  'data-dsh-winrm-active',
  'data-dsh-github-active',
  'data-dsh-feishu-active',
]
const SIBLING_PANEL_NAMES = new Set(['taskboard', 'ssh', 'mnemon', 'skill-explorer', 'winrm', 'github', 'feishu'])
const ACTIVATE_EVENT = 'dsh-panel-activate'
const PANEL_NAME = 'devforge'
const SIDEBAR_ROW_SELECTOR = '[class*="sessionRow"], [class*="projectRow"], [class*="searchResultRow"], [class*="searchResultWorkspace"], [class*="newSession"]'

/** 壳尚未完成渲染时返回 undefined，ensure 会由观察者重试。 */
function conversationColumn(): HTMLElement | undefined {
  return document.querySelector<HTMLElement>(CONVERSATION_COLUMN_SELECTOR) ?? undefined
}

/**
 * 挂载一次性 React root；容器被壳整树替换后才卸载重建。
 * @param controller 唯一开关状态源。
 * @param api 服务工厂 HTTP API。
 */
export function mountPanel(controller: PanelController, api: DevforgeApi): () => void {
  let root: Root | undefined
  let container: HTMLDivElement | undefined

  const ensure = (): void => {
    if (container !== undefined) {
      if (container.isConnected) return
      root?.unmount()
      root = undefined
      container.remove()
      container = undefined
    }

    const column = conversationColumn()
    if (column === undefined) return

    container = document.createElement('div')
    container.dataset.dshDevforgeView = ''
    container.dataset.dshPlugin = 'devforge'
    container.dataset.dshPart = 'center-view'
    container.className = css['view'] ?? ''
    column.appendChild(container)
    root = createRoot(container)
    root.render(<DevforgePanel controller={controller} api={api} />)
  }

  // 首次 apply 可能早于 AppFrame 挂载；同 SSH 一样等中栏出现再创建 view。
  const waitObserver = new MutationObserver(() => { ensure() })
  waitObserver.observe(document.body, { childList: true, subtree: true })

  /** Controller 是唯一开关来源，DOM 只同步 active 属性，不重建 React root。 */
  const applyActive = (): void => {
    if (controller.getSnapshot().panelOpen) {
      for (const attr of OTHER_ACTIVE_ATTRS) document.documentElement.removeAttribute(attr)
      document.documentElement.setAttribute(ACTIVE_ATTR, '')
      document.dispatchEvent(new CustomEvent(ACTIVATE_EVENT, { detail: PANEL_NAME }))
    } else {
      document.documentElement.removeAttribute(ACTIVE_ATTR)
    }
  }

  /** 其它中心面板激活时交还中心列，避免两个 active 规则争抢可见性。 */
  const onOtherActivate = (event: Event): void => {
    const name = (event as CustomEvent<string>).detail
    if (SIBLING_PANEL_NAMES.has(name) && controller.getSnapshot().panelOpen) controller.close()
  }

  /** 点击会话、项目或新会话行时立即退出操作台，和 SSH 行为一致。 */
  const onClickSidebarRow = (event: MouseEvent): void => {
    if (!controller.getSnapshot().panelOpen) return
    const target = event.target as HTMLElement | null
    if (target?.closest(SIDEBAR_ROW_SELECTOR) !== null) controller.close()
  }

  document.addEventListener('click', onClickSidebarRow, true)
  document.addEventListener(ACTIVATE_EVENT, onOtherActivate)
  const unsubscribe = controller.subscribe(applyActive)
  applyActive()
  ensure()

  return () => {
    document.removeEventListener('click', onClickSidebarRow, true)
    document.removeEventListener(ACTIVATE_EVENT, onOtherActivate)
    waitObserver.disconnect()
    unsubscribe()
    document.documentElement.removeAttribute(ACTIVE_ATTR)
    root?.unmount()
    root = undefined
    container?.remove()
    container = undefined
  }
}
