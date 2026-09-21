/**
 * 硅基流动路由 —— /api/dsh-devforge/siliconflow/*（loopback-only）。
 */
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { isLoopbackRequest } from '../loopback.ts'
import { SILICONFLOW_API } from './protocol.ts'
import { SiliconFlowService, SiliconFlowServiceError } from './service.ts'

function writeJson(res: import('node:http').ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'content-length': Buffer.byteLength(body) })
  res.end(body)
}

/** 读取请求体为 JSON（模型删除只传 id 清单，体积很小）。 */
async function readJsonBody(req: import('node:http').IncomingMessage): Promise<{ [key: string]: unknown }> {
  const chunks: Buffer[] = []
  let total = 0
  const maxBytes = 8 * 1024
  for await (const chunk of req) {
    total += (chunk as Buffer).length
    if (total > maxBytes) throw new SiliconFlowServiceError('请求体超过 8 KiB 上限。', 400)
    chunks.push(chunk as Buffer)
  }
  if (total === 0) throw new SiliconFlowServiceError('请求体为空。', 400)
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as { [key: string]: unknown } } catch {
    throw new SiliconFlowServiceError('请求体不是合法 JSON。', 400)
  }
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
        // 面板手动同步=全量恢复：restore=true 合并全部在线精选模型并清除对应墓碑（保持无 body 调用兼容）。
        try { writeJson(res, 200, { ok: true, status: await service.ensureModels(true) }) }
        catch (error) { writeJson(res, (error as { status?: number }).status ?? 400, { ok: false, error: (error as Error).message.slice(0, 200) }) }
      },
    },
    {
      kind: 'exact',
      path: SILICONFLOW_API.modelsDelete,
      handler: async (req, res) => {
        if (!guard(req, res)) return
        if (req.method !== 'POST') { writeJson(res, 405, { ok: false, error: 'POST only' }); return }
        try {
          const body = await readJsonBody(req)
          writeJson(res, 200, { ok: true, status: await service.deleteModels(body.ids) })
        }
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
