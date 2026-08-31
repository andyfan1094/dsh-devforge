/** 火山方舟 Agent/Coding Plan 路由族（loopback 围栏 + 同源写保护）。 */
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { isLoopbackRequest } from '../loopback.ts'
import { ARK_API } from './protocol.ts'
import { ArkCodingPlanService, ArkServiceError } from './service.ts'

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

/** 所有方舟面板接口仅允许本机 GUI 调用。 */
function guard(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse): boolean {
  if (isLoopbackRequest(req)) return true
  writeJson(res, 403, { ok: false, error: 'forbidden: loopback-only' })
  return false
}

/** 写配置或触发实时刷新时额外校验同源，避免本机其它网页借用用户凭据。 */
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

/** 把服务错误映射为稳定且不含凭据的页面响应。 */
function writeError(res: import('node:http').ServerResponse, error: unknown): void {
  if (error instanceof ArkServiceError) {
    writeJson(res, error.status, { ok: false, error: error.message })
    return
  }
  writeJson(res, 500, { ok: false, error: '火山方舟 Agent/Coding Plan 服务发生内部错误。' })
}

/** 读取 AK/SK 保存请求；限制体积且不把内容写入错误。 */
async function readUsageCredentials(req: import('node:http').IncomingMessage): Promise<{ accessKey: string; secretKey: string }> {
  const chunks: Buffer[] = []
  let total = 0
  const maxBytes = 16 * 1024
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += buffer.length
    if (total > maxBytes) throw new ArkServiceError('AK/SK 请求体超过 16 KiB 上限。', 400)
    chunks.push(buffer)
  }
  if (total === 0) throw new ArkServiceError('AK/SK 请求体为空。', 400)
  let payload: unknown
  try { payload = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { throw new ArkServiceError('AK/SK 请求体不是合法 JSON。', 400) }
  if (payload === null || typeof payload !== 'object') throw new ArkServiceError('AK/SK 请求体必须是 JSON 对象。', 400)
  const body = payload as { accessKey?: unknown; secretKey?: unknown }
  if (typeof body.accessKey !== 'string' || typeof body.secretKey !== 'string') throw new ArkServiceError('Access Key 与 Secret Key 必须是字符串。', 400)
  return { accessKey: body.accessKey, secretKey: body.secretKey }
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
    {
      kind: 'exact',
      path: ARK_API.dashboard,
      handler: async (req, res) => {
        if (!guard(req, res)) return
        if (req.method !== 'GET') { writeJson(res, 405, { ok: false, error: 'GET only' }); return }
        try { writeJson(res, 200, { ok: true, dashboard: await service.dashboard() }) } catch (error) { writeError(res, error) }
      },
    },
    {
      kind: 'exact',
      path: ARK_API.usageCredentials,
      handler: async (req, res) => {
        if (!guardWrite(req, res)) return
        if (req.method !== 'POST') { writeJson(res, 405, { ok: false, error: 'POST only' }); return }
        try {
          const body = await readUsageCredentials(req)
          const result = await service.saveUsageCredentials(body.accessKey, body.secretKey)
          writeJson(res, 200, { ok: true, ...result })
        } catch (error) { writeError(res, error) }
      },
    },
    {
      kind: 'exact',
      path: ARK_API.refreshUsage,
      handler: async (req, res) => {
        if (!guardWrite(req, res)) return
        if (req.method !== 'POST') { writeJson(res, 405, { ok: false, error: 'POST only' }); return }
        try { writeJson(res, 200, { ok: true, dashboard: await service.refreshUsage() }) } catch (error) { writeError(res, error) }
      },
    },
  ]
}
