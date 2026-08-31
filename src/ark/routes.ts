/** 火山方舟 Agent/Coding Plan 路由族（loopback 围栏 + 同源写保护）。 */
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { isLoopbackRequest } from '../loopback.ts'
import { ARK_API } from './protocol.ts'
import { ArkCodingPlanService, ArkServiceError } from './service.ts'

function writeJson(res: import('node:http').ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

function guard(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse): boolean {
  if (isLoopbackRequest(req)) return true
  writeJson(res, 403, { ok: false, error: 'forbidden: loopback-only' })
  return false
}

function guardWrite(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse): boolean {
  if (!guard(req, res)) return false
  const host = req.headers.host
  const source = typeof req.headers.origin === 'string' ? req.headers.origin : req.headers.referer
  if (host === undefined || typeof source !== 'string') {
    writeJson(res, 403, { ok: false, error: 'forbidden: same-origin request required' })
    return false
  }
  try {
    if (new URL(source).host === host) return true
  } catch {
    /* 非法来源按拒绝处理。 */
  }
  writeJson(res, 403, { ok: false, error: 'forbidden: same-origin request required' })
  return false
}

function writeError(res: import('node:http').ServerResponse, error: unknown): void {
  if (error instanceof ArkServiceError) {
    writeJson(res, error.status, { ok: false, error: error.message })
    return
  }
  writeJson(res, 500, { ok: false, error: '火山方舟 Agent/Coding Plan 服务发生内部错误。' })
}

/** 方舟 Coding Plan 路由。 */
export function makeArkRoutes(service: ArkCodingPlanService): WebRoute[] {
  return [
    {
      kind: 'exact',
      path: ARK_API.status,
      handler: async (req, res) => {
        if (!guard(req, res)) return
        if (req.method !== 'GET') { writeJson(res, 405, { ok: false, error: 'GET only' }); return }
        try { writeJson(res, 200, { ok: true, status: await service.status() }) } catch (error) { writeError(res, error) }
      },
    },
    {
      kind: 'exact',
      path: ARK_API.setup,
      handler: async (req, res) => {
        if (!guardWrite(req, res)) return
        if (req.method !== 'POST') { writeJson(res, 405, { ok: false, error: 'POST only' }); return }
        try { writeJson(res, 200, { ok: true, status: await service.ensureModels() }) } catch (error) { writeError(res, error) }
      },
    },
  ]
}
