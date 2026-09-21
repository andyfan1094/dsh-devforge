/** MiniMax Coding Plan 路由族（loopback 围栏，与智谱路由同构）。 */
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { isLoopbackRequest } from '../loopback.ts'
import { MINIMAX_API } from './protocol.ts'
import { MiniMaxService, MiniMaxServiceError } from './service.ts'

/** 输出不可缓存的 JSON。 */
function writeJson(res: import('node:http').ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

/** 所有 MiniMax 面板接口只允许本机 GUI 调用。 */
function guard(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse): boolean {
  if (isLoopbackRequest(req)) return true
  writeJson(res, 403, { ok: false, error: 'forbidden: loopback-only' })
  return false
}

/** 写模型设置时额外校验来源 Host，兼容 HTTP 和 HTTPS。 */
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
    // 非法来源按拒绝处理。
  }
  writeJson(res, 403, { ok: false, error: 'forbidden: same-origin request required' })
  return false
}

/** 把内部错误映射成稳定、无敏感信息的响应。 */
function writeError(res: import('node:http').ServerResponse, error: unknown): void {
  if (error instanceof MiniMaxServiceError) {
    writeJson(res, error.status, { ok: false, error: error.message })
    return
  }
  writeJson(res, 500, { ok: false, error: 'MiniMax Coding Plan 服务发生内部错误。' })
}

/** MiniMax Coding Plan 路由族。 */
export function makeMiniMaxRoutes(service: MiniMaxService): WebRoute[] {
  return [
    {
      kind: 'exact',
      path: MINIMAX_API.status,
      handler: async (req, res) => {
        if (!guard(req, res)) return
        if (req.method !== 'GET') { writeJson(res, 405, { ok: false, error: 'GET only' }); return }
        try { writeJson(res, 200, { ok: true, status: await service.status() }) } catch (error) { writeError(res, error) }
      },
    },
    {
      kind: 'exact',
      path: MINIMAX_API.setup,
      handler: async (req, res) => {
        if (!guardWrite(req, res)) return
        if (req.method !== 'POST') { writeJson(res, 405, { ok: false, error: 'POST only' }); return }
        // 用户手动点击=全量补齐：restore=true 合并全部默认模型并清除对应墓碑。
        try { writeJson(res, 200, { ok: true, status: await service.ensureModels(true) }) } catch (error) { writeError(res, error) }
      },
    },
    {
      kind: 'exact',
      path: MINIMAX_API.modelsDelete,
      handler: async (req, res) => {
        if (!guardWrite(req, res)) return
        if (req.method !== 'POST') { writeJson(res, 405, { ok: false, error: 'POST only' }); return }
        try {
          const body = await readJsonBody(req)
          writeJson(res, 200, { ok: true, status: await service.deleteModels(body.ids) })
        } catch (error) { writeError(res, error) }
      },
    },
    {
      kind: 'exact',
      path: MINIMAX_API.fetchModels,
      handler: async (req, res) => {
        if (!guardWrite(req, res)) return
        if (req.method !== 'POST') { writeJson(res, 405, { ok: false, error: 'POST only' }); return }
        try {
          const result = await service.fetchModelsFromOfficial()
          writeJson(res, 200, { ok: true, status: result.status, added: result.added, kept: result.kept, total: result.total })
        } catch (error) { writeError(res, error) }
      },
    },
    {
      kind: 'exact',
      path: MINIMAX_API.dashboard,
      handler: async (req, res) => {
        if (!guard(req, res)) return
        if (req.method !== 'GET') { writeJson(res, 405, { ok: false, error: 'GET only' }); return }
        const controller = new AbortController()
        const abort = (): void => controller.abort()
        req.once('aborted', abort)
        res.once('close', abort)
        try { writeJson(res, 200, { ok: true, dashboard: await service.dashboard(controller.signal) }) } catch (error) {
          if (!controller.signal.aborted && !res.writableEnded) writeError(res, error)
        } finally {
          req.off('aborted', abort)
          res.off('close', abort)
        }
      },
    },
  ]
}

/** 读取请求体为 JSON（模型删除只传 id 清单，体积很小）。 */
async function readJsonBody(req: import('node:http').IncomingMessage): Promise<{ [key: string]: unknown }> {
  const chunks: Buffer[] = []
  let total = 0
  const maxBytes = 8 * 1024
  for await (const chunk of req) {
    total += (chunk as Buffer).length
    if (total > maxBytes) throw new MiniMaxServiceError('请求体超过 8 KiB 上限。', 400)
    chunks.push(chunk as Buffer)
  }
  if (total === 0) throw new MiniMaxServiceError('请求体为空。', 400)
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as { [key: string]: unknown } } catch {
    throw new MiniMaxServiceError('请求体不是合法 JSON。', 400)
  }
}
