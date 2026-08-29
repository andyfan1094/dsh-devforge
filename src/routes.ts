/**
 * /api/dsh-devforge 路由族 —— 面板数据通道。
 *
 * 入口说明：makeRoutes 返回 WebRoute 数组（dsh-host-webserver 契约），
 * index.ts 里 ctx.webServer.register 逐条挂载。
 * 安全边界：全部路由 loopback-only（isLoopbackRequest 围栏，仿 dsh-winrm
 * / dsh-codebase-memory 实证模式），公网部署不暴露本插件任何接口。
 */

import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import type { ForgeEngine } from './forge.ts'
import { isLoopbackRequest } from './loopback.ts'

/** JSON 请求体上限。 */
const MAX_BODY = 256 * 1024

/** 极简 JSON 响应。 */
function writeJson(res: import('node:http').ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

/** 读取 JSON 请求体（超限/解析失败返回 null）。 */
function readJsonBody(req: import('node:http').IncomingMessage): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    let size = 0
    const parts: Buffer[] = []
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY) { resolve(null); req.destroy(); return }
      parts.push(chunk)
    })
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(parts).toString('utf8')) as Record<string, unknown>) }
      catch { resolve(null) }
    })
    req.on('error', () => resolve(null))
  })
}

/** 围栏：非 loopback 直接 403。 */
function guard(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse): boolean {
  if (isLoopbackRequest(req)) return true
  writeJson(res, 403, { ok: false, error: 'forbidden: loopback-only' })
  return false
}

/** 组装路由族。 */
export function makeRoutes(engine: ForgeEngine, standards: import('./standards.ts').StandardsStore): WebRoute[] {
  return [
    {
      kind: 'exact',
      path: '/api/dsh-devforge/standards',
      handler: async (req, res) => {
        if (!guard(req, res)) return
        if (req.method !== 'GET') { writeJson(res, 405, { ok: false, error: 'GET only' }); return }
        writeJson(res, 200, { ok: true, standards: standards.list() })
      },
    },
    {
      kind: 'exact',
      path: '/api/dsh-devforge/standards/item',
      handler: async (req, res) => {
        if (!guard(req, res)) return
        if (req.method !== 'GET') { writeJson(res, 405, { ok: false, error: 'GET only' }); return }
        const url = new URL(req.url ?? '/', 'http://localhost')
        const id = url.searchParams.get('id') ?? ''
        const detail = standards.get(id)
        if (!detail) { writeJson(res, 404, { ok: false, error: 'unknown id: ' + id }); return }
        writeJson(res, 200, { ok: true, standard: detail })
      },
    },
    {
      kind: 'exact',
      path: '/api/dsh-devforge/templates',
      handler: async (req, res) => {
        if (!guard(req, res)) return
        if (req.method !== 'GET') { writeJson(res, 405, { ok: false, error: 'GET only' }); return }
        writeJson(res, 200, { ok: true, templates: engine.templates() })
      },
    },
    {
      kind: 'exact',
      path: '/api/dsh-devforge/jobs',
      handler: async (req, res) => {
        if (!guard(req, res)) return
        if (req.method === 'GET') {
          writeJson(res, 200, { ok: true, jobs: engine.listJobs() })
          return
        }
        if (req.method !== 'POST') { writeJson(res, 405, { ok: false, error: 'GET/POST only' }); return }
        const body = await readJsonBody(req)
        if (!body) { writeJson(res, 400, { ok: false, error: 'invalid JSON body' }); return }
        try {
          const job = await engine.createJob(body as never)
          writeJson(res, 200, { ok: true, job })
        } catch (error) {
          writeJson(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
    {
      kind: 'exact',
      path: '/api/dsh-devforge/jobs/item',
      handler: async (req, res) => {
        if (!guard(req, res)) return
        if (req.method !== 'POST') { writeJson(res, 405, { ok: false, error: 'POST only' }); return }
        const body = await readJsonBody(req)
        const id = typeof body?.id === 'string' ? body.id : ''
        const action = typeof body?.action === 'string' ? body.action : ''
        if (id === '' || action !== 'cancel') { writeJson(res, 400, { ok: false, error: 'id 与 action=cancel 必填' }); return }
        const job = engine.cancelJob(id)
        if (!job) { writeJson(res, 404, { ok: false, error: 'unknown job: ' + id }); return }
        writeJson(res, 200, { ok: true, job })
      },
    },
  ]
}
