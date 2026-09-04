/**
 * dsh-devforge —— 浏览器半边入口（跑在 dsh Web GUI 内）。
 *
 * 入口说明：注册双语字典 → 建控制器/API → 挂侧边栏入口与中栏面板。
 * 关键边界：DOM 挂载失败只降级面板，绝不影响 GUI 主进程（warn 不 throw）。
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'
import { DevforgeApi } from './api.ts'
import { en, zh, type DevforgeKey } from './locales.ts'
import { mountPanel } from './mount.tsx'
import { PanelController } from './panel/controller.ts'
import { mountRestartEntry } from './restart-entry.ts'
import { mountSidebarEntry } from './sidebar-entry.ts'
import { createSkinRuntime } from './theme/skin-runtime.ts'

/** locale 命名空间。 */
const NS = 'dsh-devforge'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** dsh-devforge 面板文案。 */
    'dsh-devforge': DevforgeKey
  }
}

/** 前置服务（runtime 就绪后再挂 UI）。 */
export const inject = ['slots', 'locale', 'settingsScope', 'theme']

/** 类型面（导出纪律：client 面只出类型与插件契约）。 */
export type { PanelControllerSnapshot } from './panel/controller.ts'
export type { DevforgeKey }

/**
 * 挂载面板与侧边栏入口。
 * @param ctx 客户端根上下文。
 */
export function apply(ctx: ClientContext): void {
  // SSH 同款保护：locale 注入异常只降级本插件文案，不能中断整个 Web shell 启动。
  ctx.effect(() => {
    try {
      return ctx.locale.register(NS, { zh, en })
    } catch {
      return () => {}
    }
  }, 'dsh-devforge: dictionaries')

  const controller = new PanelController()
  const api = new DevforgeApi()
  // 皮肤引导恢复须早于面板首次打开；自身降级不影响其它挂载。
  let skin: ReturnType<typeof createSkinRuntime> | undefined
  try {
    skin = createSkinRuntime(ctx)
  } catch (error) {
    console.warn('[dsh-devforge] skin runtime init failed:', error)
  }

  const disposers: Array<() => void> = []
  try {
    disposers.push(mountSidebarEntry(controller))
    disposers.push(mountRestartEntry(api))
    disposers.push(mountPanel(controller, api, skin))
  } catch (error) {
    // 挂载失败降级：面板不可用但 GUI 无恙
    console.warn('[dsh-devforge] mount failed:', error)
  }
  ctx.effect(() => () => {
    for (const dispose of disposers.splice(0)) dispose()
    skin?.dispose()
  }, 'dsh-devforge: ui mounts')
}
