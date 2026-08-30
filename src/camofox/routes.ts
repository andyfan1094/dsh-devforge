/** 服务工厂面板专用的 Camofox 路由；所有请求必须来自本机 GUI。 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { isLoopbackRequest } from '../loopback.ts'
import { writeJson } from '../remote/shared/http.ts'
import { CAMOFOX_API } from './protocol.ts'
import type { CamofoxService } from './service.ts'

/** 浏览器面板只需要状态与一次性本地 noVNC 地址。 */
export function makeCamofoxRoutes(service: CamofoxService): WebRoute[] {
  const guard = (req: IncomingMessage, res: ServerResponse, method: string): boolean => {
    if (!isLoopbackRequest(req)) { writeJson(res, 403, { ok: false, error: 'forbidden: loopback-only' }); return false }
    if (req.method !== method) { writeJson(res, 405, { ok: false, error: 'method not allowed' }); return false }
    return true
  }
  return [
    { kind: 'exact', path: CAMOFOX_API.status, handler: async (req, res) => { if (!guard(req, res, 'GET')) return; writeJson(res, 200, { status: await service.status() }) } },
    { kind: 'exact', path: CAMOFOX_API.visual, handler: async (req, res) => {
      if (!guard(req, res, 'POST')) return
      try { writeJson(res, 200, { url: await service.visualUrl() }) }
      catch { writeJson(res, 502, { ok: false, error: '无法建立运营浏览器可视连接' }) }
    } },
  ]
}
