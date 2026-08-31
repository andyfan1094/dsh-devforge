/**
 * 天工造梦侧边栏入口 —— SSH 同款薄包装。
 * 自愈、幂等、壳重渲染定位均在 sidebar-entry-core.ts；本文件仅声明本插件图标、
 * 文案、家族顺序和 Controller toggle，避免再维护一套易漂移的 DOM 注入逻辑。
 */
import type { PanelController } from './panel/controller.ts'
import { tt } from './panel/helpers.ts'
import css from './panel/panel.module.css'
import { mountSidebarEntry as mountSharedSidebarEntry } from './sidebar-entry-core.ts'

/** 稳定入口选择器（供家族排序和视觉测试使用）。 */
export const ENTRY_SELECTOR = '[data-dsh-devforge-entry]'

/** 天工造梦图标：齿轮（天工/工艺）内嵌四角星（造梦/灵感），尺寸由 SSH 同款 entryIcon CSS 统一约束。 */
const ICON = '<svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="8" r="5.2"/><path d="M8 1.2v1.6M8 13.2v1.6M1.2 8h1.6M13.2 8h1.6M3.2 3.2l1.1 1.1M11.7 11.7l1.1 1.1M12.8 3.2l-1.1 1.1M4.3 11.7l-1.1 1.1"/><path d="M8 5.1c.35 1.55.9 2.1 2.9 2.9-2 .8-2.55 1.35-2.9 2.9-.35-1.55-.9-2.1-2.9-2.9 2-.8 2.55-1.35 2.9-2.9z" fill="currentColor" stroke="none"/></svg>'

/**
 * 使用 shared core 挂载入口。position=after 让天工造梦落在已装操作类插件之后，
 * 家族数组包含自身，壳重渲染时相对顺序不会因 observer 触发先后交换。
 */
export function mountSidebarEntry(controller: PanelController): () => void {
  return mountSharedSidebarEntry({
    rowAttribute: 'data-dsh-devforge-entry',
    rowSelector: ENTRY_SELECTOR,
    plugin: 'devforge',
    icon: ICON,
    css,
    label: () => tt('entry.label'),
    tooltip: () => tt('entry.tooltip'),
    onToggle: () => { controller.toggle() },
    position: 'after',
    familySelectors: [
      '[data-dsh-taskboard-entry]',
      '[data-dsh-ssh-entry]',
      '[data-dsh-mnemon-entry]',
      '[data-dsh-skill-explorer-entry]',
      '[data-dsh-winrm-entry]',
      '[data-dsh-github-entry]',
      '[data-dsh-feishu-entry]',
      ENTRY_SELECTOR,
    ],
    active: {
      subscribe: (listener) => controller.subscribe(listener),
      isOpen: () => controller.getSnapshot().panelOpen,
    },
  })
}
