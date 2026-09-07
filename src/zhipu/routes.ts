import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { isLoopbackRequest } from '../loopback.ts'
import { ZHIPU_API, type ZhipuUsageWindow } from './protocol.ts'
import { ZhipuCodingPlanService } from './service.ts'
import { ZhipuServiceError } from './errors.ts'

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

/** 所有智谱面板接口只允许本机 GUI 调用。 */
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
  if (error instanceof ZhipuServiceError) {
    writeJson(res, error.status, { ok: false, error: error.message })
    return
  }
  writeJson(res, 500, { ok: false, error: '智谱 Coding Plan 服务发生内部错误。' })
}

/** 智谱 Coding Plan 路由族。 */
export function makeZhipuRoutes(service: ZhipuCodingPlanService): WebRoute[] {
  return [
    {
      kind: 'exact',
      path: ZHIPU_API.status,
      handler: async (req, res) => {
        if (!guard(req, res)) return
        if (req.method !== 'GET') { writeJson(res, 405, { ok: false, error: 'GET only' }); return }
        try { writeJson(res, 200, { ok: true, status: await service.status() }) } catch (error) { writeError(res, error) }
      },
    },
    {
      kind: 'exact',
      path: ZHIPU_API.dashboard,
      handler: async (req, res) => {
        if (!guard(req, res)) return
        if (req.method !== 'GET') { writeJson(res, 405, { ok: false, error: 'GET only' }); return }
        const url = new URL(req.url ?? '/', 'http://localhost')
        const window: ZhipuUsageWindow = url.searchParams.get('window') === 'week' ? 'week' : 'day'
        // key 参数：按指定 Key 查看用量；省略时由服务按池序自动切换。
        const keyParam = url.searchParams.get('key') ?? ''
        const controller = new AbortController()
        const abort = (): void => controller.abort()
        req.once('aborted', abort)
        res.once('close', abort)
        try { writeJson(res, 200, { ok: true, dashboard: await service.dashboard(window, controller.signal, keyParam === '' ? undefined : keyParam) }) } catch (error) {
          if (!controller.signal.aborted && !res.writableEnded) writeError(res, error)
        } finally {
          req.off('aborted', abort)
          res.off('close', abort)
        }
      },
    },
    {
      kind: 'exact',
      path: ZHIPU_API.setup,
      handler: async (req, res) => {
        if (!guardWrite(req, res)) return
        if (req.method !== 'POST') { writeJson(res, 405, { ok: false, error: 'POST only' }); return }
        try { writeJson(res, 200, { ok: true, status: await service.ensureModels() }) } catch (error) { writeError(res, error) }
      },
    },
    {
      kind: 'exact',
      path: ZHIPU_API.fetchModels,
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
      path: ZHIPU_API.dashboards,
      handler: async (req, res) => {
        if (!guard(req, res)) return
        if (req.method !== 'GET') { writeJson(res, 405, { ok: false, error: 'GET only' }); return }
        const url = new URL(req.url ?? '/', 'http://localhost')
        const window: ZhipuUsageWindow = url.searchParams.get('window') === 'week' ? 'week' : 'day'
        const controller = new AbortController()
        const abort = (): void => controller.abort()
        req.once('aborted', abort)
        res.once('close', abort)
        try { writeJson(res, 200, { ok: true, usages: await service.dashboards(window, controller.signal) }) } catch (error) {
          if (!controller.signal.aborted && !res.writableEnded) writeError(res, error)
        } finally {
          req.off('aborted', abort)
          res.off('close', abort)
        }
      },
    },
    {
      kind: 'exact',
      path: ZHIPU_API.keysAdd,
      handler: async (req, res) => {
        if (!guardWrite(req, res)) return
        if (req.method !== 'POST') { writeJson(res, 405, { ok: false, error: 'POST only' }); return }
        try {
          const body = await readJsonBody(req)
          const label = typeof body.label === 'string' ? body.label : ''
          const value = typeof body.value === 'string' ? body.value : ''
          const ref = typeof body.ref === 'string' ? body.ref : undefined
          writeJson(res, 200, { ok: true, status: await service.addKey({ label, value, ref }) })
        } catch (error) { writeError(res, error) }
      },
    },
    {
      kind: 'exact',
      path: ZHIPU_API.keysRemove,
      handler: async (req, res) => {
        if (!guardWrite(req, res)) return
        if (req.method !== 'POST') { writeJson(res, 405, { ok: false, error: 'POST only' }); return }
        try {
          const body = await readJsonBody(req)
          const id = typeof body.id === 'string' ? body.id.trim() : ''
          if (id === '') { writeJson(res, 400, { ok: false, error: 'id 不能为空。' }); return }
          writeJson(res, 200, { ok: true, status: await service.removeKey(id) })
        } catch (error) { writeError(res, error) }
      },
    },
    {
      kind: 'exact',
      path: ZHIPU_API.keysRename,
      handler: async (req, res) => {
        if (!guardWrite(req, res)) return
        if (req.method !== 'POST') { writeJson(res, 405, { ok: false, error: 'POST only' }); return }
        try {
          const body = await readJsonBody(req)
          const id = typeof body.id === 'string' ? body.id.trim() : ''
          const label = typeof body.label === 'string' ? body.label : ''
          if (id === '') { writeJson(res, 400, { ok: false, error: 'id 不能为空。' }); return }
          writeJson(res, 200, { ok: true, status: await service.renameKey(id, label) })
        } catch (error) { writeError(res, error) }
      },
    },
    {
      kind: 'exact',
      path: ZHIPU_API.setPrimary,
      handler: async (req, res) => {
        if (!guardWrite(req, res)) return
        if (req.method !== 'POST') { writeJson(res, 405, { ok: false, error: 'POST only' }); return }
        try {
          const body = await readJsonBody(req)
          const env = typeof body.env === 'string' ? body.env.trim() : ''
          if (env === '') { writeJson(res, 400, { ok: false, error: 'env 不能为空。' }); return }
          writeJson(res, 200, { ok: true, status: await service.setPrimaryKey(env) })
        } catch (error) { writeError(res, error) }
      },
    },
    {
      kind: 'exact',
      path: ZHIPU_API.officialSetup,
      handler: async (req, res) => {
        if (!guardWrite(req, res)) return
        if (req.method !== 'POST') { writeJson(res, 405, { ok: false, error: 'POST only' }); return }
        try { writeJson(res, 200, { ok: true, status: await service.ensureOfficialModels() }) } catch (error) { writeError(res, error) }
      },
    },
    {
      kind: 'exact',
      path: ZHIPU_API.officialKeySave,
      handler: async (req, res) => {
        if (!guardWrite(req, res)) return
        if (req.method !== 'POST') { writeJson(res, 405, { ok: false, error: 'POST only' }); return }
        try {
          const body = await readJsonBody(req)
          writeJson(res, 200, { ok: true, status: await service.saveOfficialKey({ value: typeof body.value === 'string' ? body.value : '' }) })
        } catch (error) { writeError(res, error) }
      },
    },
    {
      kind: 'exact',
      path: ZHIPU_API.officialFetchModels,
      handler: async (req, res) => {
        if (!guardWrite(req, res)) return
        if (req.method !== 'POST') { writeJson(res, 405, { ok: false, error: 'POST only' }); return }
        try {
          const result = await service.fetchOfficialModels()
          writeJson(res, 200, { ok: true, status: result.status, added: result.added, kept: result.kept, total: result.total })
        } catch (error) { writeError(res, error) }
      },
    },
  ]
}

/** 读取请求体为 JSON（Key 管理只传名称/引用/明文 Key，体积很小）。 */
async function readJsonBody(req: import('node:http').IncomingMessage): Promise<{ [key: string]: unknown }> {
  const chunks: Buffer[] = []
  let total = 0
  const maxBytes = 8 * 1024
  for await (const chunk of req) {
    total += (chunk as Buffer).length
    if (total > maxBytes) throw new ZhipuServiceError('请求体超过 8 KiB 上限。', 400)
    chunks.push(chunk as Buffer)
  }
  if (total === 0) throw new ZhipuServiceError('请求体为空。', 400)
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as { [key: string]: unknown } } catch {
    throw new ZhipuServiceError('请求体不是合法 JSON。', 400)
  }
}
