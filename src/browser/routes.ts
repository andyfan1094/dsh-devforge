/** 天工造梦面板专用的本地浏览器路由；所有请求必须来自本机 GUI。 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { isLoopbackRequest } from '../loopback.ts'
import { writeJson } from '../remote/shared/http.ts'
import { BROWSER_API, isSafeHttpUrl } from './protocol.ts'
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
