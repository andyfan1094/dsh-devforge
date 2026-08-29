/**
 * 面板状态控制器 —— 框架无关的开/关状态唯一持有者（dsh-winrm 同款）。
 * DOM 注入层与 React 视图共享这一份状态，避免两套真相。
 */

/** 控制器快照。 */
export interface PanelControllerSnapshot {
  /** 面板是否打开。 */
  panelOpen: boolean
}

/** 面板状态控制器。 */
export class PanelController {
  private panelOpen = false
  private listeners = new Set<() => void>()

  /** 当前快照（React useSyncExternalStore 用）。 */
  getSnapshot(): PanelControllerSnapshot {
    return { panelOpen: this.panelOpen }
  }

  /** 订阅状态变化；返回退订函数。 */
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => { this.listeners.delete(fn) }
  }

  open(): void {
    if (this.panelOpen) return
    this.panelOpen = true
    this.notify()
  }

  close(): void {
    if (!this.panelOpen) return
    this.panelOpen = false
    this.notify()
  }

  toggle(): void {
    if (this.panelOpen) this.close()
    else this.open()
  }

  private notify(): void {
    for (const fn of [...this.listeners]) fn()
  }
}
