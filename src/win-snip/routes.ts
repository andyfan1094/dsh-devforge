/** 天工造梦面板「截图小工具」路由；所有请求必须来自本机 GUI。 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { isLoopbackRequest } from '../loopback.ts'
import { writeJson } from '../remote/shared/http.ts'
import { WIN_SNIP_API, parseHotkey, type WinSnipSettings, type WinSnipSettingsPatch, type WinSnipStatus } from './protocol.ts'
import { mergeWinSnipSettings } from './store.ts'

/** 解析 JSON 请求体；非法体返回空对象。 */
async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown> } catch { return {} }
}

/** 路由依赖的能力面。 */
export interface WinSnipRoutesDeps {
  /** 读当前配置。 */
  readSettings: () => WinSnipSettings
  /** 保存配置（内部落库并按需重启助手）。 */
  saveSettings: (next: WinSnipSettings) => void
  /** 运行状态。 */
  status: () => WinSnipStatus
  /** 启动助手。 */
  start: () => void
  /** 停止助手。 */
  stop: () => void
  /** 立即截一张。 */
  capture: () => void
}

/** 截图小工具路由：状态、配置、启动、停止与立即截图。 */
export function makeWinSnipRoutes(deps: WinSnipRoutesDeps): WebRoute[] {
  const guard = (req: IncomingMessage, res: ServerResponse, method: string): boolean => {
    if (!isLoopbackRequest(req)) { writeJson(res, 403, { ok: false, error: 'forbidden: loopback-only' }); return false }
    if (req.method !== method) { writeJson(res, 405, { ok: false, error: 'method not allowed' }); return false }
    return true
  }
  return [
    {
      kind: 'exact',
      path: WIN_SNIP_API.status,
      handler: async (req, res) => {
        if (!guard(req, res, 'GET')) return
        writeJson(res, 200, { ok: true, status: deps.status() })
      },
    },
    {
      kind: 'exact',
      path: WIN_SNIP_API.settings,
      handler: async (req, res) => {
        if (!isLoopbackRequest(req)) { writeJson(res, 403, { ok: false, error: 'forbidden: loopback-only' }); return }
        if (req.method === 'GET') { writeJson(res, 200, { ok: true, settings: deps.readSettings() }); return }
        if (req.method !== 'PUT') { writeJson(res, 405, { ok: false, error: 'method not allowed' }); return }
        const current = deps.readSettings()
        const patch = await readBody(req) as WinSnipSettingsPatch
        // 热键是唯一的强校验字段：非法值必须显式报错，不能静默忽略（否则用户以为改成功了）。
        if (patch.hotkey !== undefined) {
          const parsed = parseHotkey(patch.hotkey)
          if (parsed === undefined) {
            writeJson(res, 400, { ok: false, error: '热键格式无效：需要至少一个修饰键加一个主键，例如 Alt+A、Ctrl+Shift+S。' })
            return
          }
        }
        const next = mergeWinSnipSettings(current, patch)
        if (next.visionProvider === 'openai' && next.visionModel === '') {
          writeJson(res, 400, { ok: false, error: '选择中转站通道时必须填写视觉模型名，例如 gpt-4o-mini。' })
          return
        }
        deps.saveSettings(next)
        writeJson(res, 200, { ok: true, settings: next, status: deps.status() })
      },
    },
    {
      kind: 'exact',
      path: WIN_SNIP_API.start,
      handler: async (req, res) => {
        if (!guard(req, res, 'POST')) return
        try {
          deps.start()
          writeJson(res, 200, { ok: true, status: deps.status() })
        } catch (error) {
          writeJson(res, 502, { ok: false, error: error instanceof Error ? error.message : '启动截图助手失败' })
        }
      },
    },
    {
      kind: 'exact',
      path: WIN_SNIP_API.stop,
      handler: async (req, res) => {
        if (!guard(req, res, 'POST')) return
        try {
          deps.stop()
          writeJson(res, 200, { ok: true, status: deps.status() })
        } catch (error) {
          writeJson(res, 502, { ok: false, error: error instanceof Error ? error.message : '停止截图助手失败' })
        }
      },
    },
    {
      kind: 'exact',
      path: WIN_SNIP_API.capture,
      handler: async (req, res) => {
        if (!guard(req, res, 'POST')) return
        try {
          deps.capture()
          writeJson(res, 200, { ok: true })
        } catch (error) {
          writeJson(res, 502, { ok: false, error: error instanceof Error ? error.message : '触发截图失败' })
        }
      },
    },
  ]
}
