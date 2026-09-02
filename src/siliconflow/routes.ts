/**
 * 硅基流动路由 —— /api/dsh-devforge/siliconflow/*（loopback-only）。
 */
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { isLoopbackRequest } from '../loopback.ts'
import type { SiliconFlowService } from './service.ts'

function writeJson(res: import('node:http').ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'content-length': Buffer.byteLength(body) })
  res.end(body)
}

function guard(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse): boolean {
  if (isLoopbackRequest(req)) return true
  writeJson(res, 403, { ok: false, error: 'forbidden: loopback-only' })
  return false
}

export function makeSiliconFlowRoutes(service: SiliconFlowService): WebRoute[] {
  return [
    {
      kind: 'exact',
      path: '/api/dsh-devforge/siliconflow/status',
      handler: async (req, res) => {
        if (!guard(req, res)) return
        try { writeJson(res, 200, { ok: true, status: await service.status() }) }
        catch (error) { writeJson(res, (error as { status?: number }).status ?? 400, { ok: false, error: (error as Error).message.slice(0, 200) }) }
      },
    },
    {
      kind: 'exact',
      path: '/api/dsh-devforge/siliconflow/ensure',
      handler: async (req, res) => {
        if (!guard(req, res)) return
        if (req.method !== 'POST') { writeJson(res, 405, { ok: false, error: 'POST only' }); return }
        try { writeJson(res, 200, { ok: true, status: await service.ensureModels() }) }
        catch (error) { writeJson(res, (error as { status?: number }).status ?? 400, { ok: false, error: (error as Error).message.slice(0, 200) }) }
      },
    },
    {
      kind: 'exact',
      path: '/api/dsh-devforge/siliconflow/user',
      handler: async (req, res) => {
        if (!guard(req, res)) return
        try { writeJson(res, 200, { ok: true, user: await service.userInfo() }) }
        catch (error) { writeJson(res, (error as { status?: number }).status ?? 400, { ok: false, error: (error as Error).message.slice(0, 200) }) }
      },
    },
    {
      kind: 'exact',
      path: '/api/dsh-devforge/siliconflow/models',
      handler: async (req, res) => {
        if (!guard(req, res)) return
        try { writeJson(res, 200, { ok: true, models: await service.listOnlineModels() }) }
        catch (error) { writeJson(res, (error as { status?: number }).status ?? 400, { ok: false, error: (error as Error).message.slice(0, 200) }) }
      },
    },
  ]
}
