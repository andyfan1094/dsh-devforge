/**
 * 截图小工具能力装配：把配置、视觉通道、原生进程与面板路由接到一起。
 *
 * 装配时机由插件接线决定；这里不做任何"默认拉起"以外的策略判断，
 * 未启用时也不注册进程（面板仍可读状态并开启）。
 */
import type { Context } from '@deepseek-ai/cordis'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { WinSnipAssistant } from './assistant.ts'
import { makeWinSnipRoutes } from './routes.ts'
import { WinSnipVision } from './vision.ts'
import { readWinSnipSettings, resolveSaveDir, writeWinSnipSettings } from './store.ts'
import type { WinSnipSettings } from './protocol.ts'

/** 激活配置（来自插件配置与其它能力的生效值）。 */
export interface WinSnipActivationConfig {
  /** 是否启用截图小工具能力。 */
  enabled: boolean
  /** MiniMax 订阅 Key 的受管引用名。 */
  minimaxApiKeyEnv: string
  /** OpenAI 中转站地址与 Key 引用名（用于走中转站做识别/翻译）。 */
  openAi: { baseURL: string; apiKeyEnv: string }
}

/** 一次激活的产物。 */
export interface WinSnipActivation {
  /** 面板路由。 */
  routes: WebRoute[]
  /** 停止常驻助手（插件卸载时调用）。 */
  dispose: () => void
}

/**
 * 装配截图小工具。
 *
 * @param ctx 插件上下文（用其受管凭据与日志）。
 * @param config 激活配置。
 */
export function activateWinSnip(ctx: Context, config: WinSnipActivationConfig): WinSnipActivation {
  const log = (message: string, ...args: unknown[]): void => {
    try { ctx.logger.info(message, ...args) } catch { /* 日志失败不影响能力 */ }
  }
  const vision = new WinSnipVision(ctx, {
    settings: () => readWinSnipSettings(),
    minimaxApiKeyEnv: () => config.minimaxApiKeyEnv,
    openAi: () => config.openAi,
  })
  const assistant = new WinSnipAssistant({
    settings: () => readWinSnipSettings(),
    vision,
    log,
  })
  const routes = makeWinSnipRoutes({
    readSettings: () => readWinSnipSettings(),
    saveSettings: (next: WinSnipSettings) => {
      writeWinSnipSettings(next)
      if (!config.enabled) return
      // 开关、热键、保存目录变化都要求重启助手才生效；其余字段由识别时实时读取。
      if (next.enabled) assistant.restart()
      else assistant.stop()
    },
    status: () => assistant.status(),
    start: () => {
      // 面板「启动」按钮等价于把开关打开后再拉起，避免开关与进程状态脱节。
      const current = readWinSnipSettings()
      if (!current.enabled) writeWinSnipSettings({ ...current, enabled: true })
      assistant.start()
    },
    stop: () => {
      const current = readWinSnipSettings()
      if (current.enabled) writeWinSnipSettings({ ...current, enabled: false })
      assistant.stop()
    },
    capture: () => assistant.requestCapture(),
  })
  if (config.enabled && readWinSnipSettings().enabled) {
    log('[dsh-devforge] win-snip: 按配置启动常驻助手（保存目录 %s）', resolveSaveDir(readWinSnipSettings()))
    assistant.start()
  }
  return {
    routes,
    dispose: () => assistant.dispose(),
  }
}
