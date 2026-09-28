/** 天工造梦面板专用的本地浏览器路由；所有请求必须来自本机 GUI。 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { isLoopbackRequest } from '../loopback.ts'
import { writeJson } from '../remote/shared/http.ts'
import { BROWSER_API, isSafeHttpUrl, type BrowserSettingsPatch, type BrowserSettingsView } from './protocol.ts'
import type { BrowserRoutesService } from './service.ts'

/** 面板路由依赖的服务面（能力未启用时由宿主注入占位实现）。 */
export type { BrowserRoutesService }

/** 解析 JSON 请求体；非法体返回 null。 */
async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown> } catch { return {} }
}

/** 浏览器面板路由：状态、导航、快照、截图与停止。 */
export function makeBrowserRoutes(service: BrowserRoutesService): WebRoute[] {
  const guard = (req: IncomingMessage, res: ServerResponse, method: string): boolean => {
    if (!isLoopbackRequest(req)) { writeJson(res, 403, { ok: false, error: 'forbidden: loopback-only' }); return false }
    if (req.method !== method) { writeJson(res, 405, { ok: false, error: 'method not allowed' }); return false }
    return true
  }
  return [
    { kind: 'exact', path: BROWSER_API.status, handler: async (req, res) => { if (!guard(req, res, 'GET')) return; writeJson(res, 200, { status: await service.status() }) } },
    { kind: 'exact', path: BROWSER_API.navigate, handler: async (req, res) => {
      if (!guard(req, res, 'POST')) return
      const body = await readBody(req)
      if (!isSafeHttpUrl(body.url)) { writeJson(res, 400, { ok: false, error: '只允许打开 http(s) 地址' }); return }
      try { writeJson(res, 200, { ok: true, snapshot: await service.navigate(String(body.url)) }) }
      catch (error) { writeJson(res, 502, { ok: false, error: error instanceof Error ? error.message : '浏览器操作失败' }) }
    } },
    { kind: 'exact', path: BROWSER_API.snapshot, handler: async (req, res) => {
      if (!guard(req, res, 'GET')) return
      try { writeJson(res, 200, { ok: true, snapshot: await service.snapshot() }) }
      catch (error) { writeJson(res, 502, { ok: false, error: error instanceof Error ? error.message : '浏览器操作失败' }) }
    } },
    { kind: 'exact', path: BROWSER_API.screenshot, handler: async (req, res) => {
      if (!guard(req, res, 'POST')) return
      try { writeJson(res, 200, { ok: true, image: await service.screenshot() }) }
      catch (error) { writeJson(res, 502, { ok: false, error: error instanceof Error ? error.message : '浏览器操作失败' }) }
    } },
    { kind: 'exact', path: BROWSER_API.stop, handler: async (req, res) => {
      if (!guard(req, res, 'POST')) return
      try { await service.stop(); writeJson(res, 200, { ok: true }) }
      catch (error) { writeJson(res, 502, { ok: false, error: error instanceof Error ? error.message : '浏览器操作失败' }) }
    } },
  ]
}

/** 面板开关路由依赖（由插件接线：读生效值、落库并触发 sync 热重建）。 */
export interface BrowserSettingsDeps {
  /** 读当前生效的开关（resolve() 结果，含面板保存过的覆盖值）。 */
  read: () => BrowserSettingsView
  /** 保存开关：内部落 store.db settings 域并触发 sync()，工具注册立即跟随。 */
  save: (next: BrowserSettingsView) => void
}

/**
 * 合并面板补丁（纯函数，可测）：只接受布尔字段，缺省保持原值。
 * 明确忽略未知字段，防止面板误传把配置写坏。
 */
export function mergeBrowserSettings(current: BrowserSettingsView, patch: BrowserSettingsPatch): BrowserSettingsView {
  const next: BrowserSettingsView = { ...current }
  if (typeof patch.enabled === 'boolean') next.enabled = patch.enabled
  if (typeof patch.publish === 'boolean') next.publish = patch.publish
  return next
}

/** 「本地浏览器」页的开关路由：GET 读、PUT 保存并热重建工具注册（无需重启 DSH）。 */
export function makeBrowserSettingsRoutes(deps: BrowserSettingsDeps): WebRoute[] {
  return [
    {
      kind: 'exact',
      path: BROWSER_API.settings,
      handler: async (req, res) => {
        if (!isLoopbackRequest(req)) { writeJson(res, 403, { ok: false, error: 'forbidden: loopback-only' }); return }
        if (req.method === 'GET') { writeJson(res, 200, { ok: true, settings: deps.read() }); return }
        if (req.method === 'PUT') {
          const next = mergeBrowserSettings(deps.read(), await readBody(req) as BrowserSettingsPatch)
          deps.save(next)
          writeJson(res, 200, { ok: true, settings: next })
          return
        }
        writeJson(res, 405, { ok: false, error: 'method not allowed' })
      },
    },
  ]
}
