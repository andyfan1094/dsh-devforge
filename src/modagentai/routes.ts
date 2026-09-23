/** 官网账号面板路由（loopback + 同源写入围栏，与 OpenAI 中转模块同规矩）。 */
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { isLoopbackRequest } from '../loopback.ts'
import { MODAGENTAI_API } from './protocol.ts'
import { ModagentaiService, ModagentaiServiceError } from './service.ts'

/** 输出不可缓存 JSON。 */
function writeJson(res: import('node:http').ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

/** 读取并限制 JSON 请求体。 */
async function readBody(req: import('node:http').IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    total += (chunk as Buffer).length
    if (total > 16 * 1024) throw new ModagentaiServiceError('请求体超过 16 KiB 上限。', 413)
    chunks.push(chunk as Buffer)
  }
  if (total === 0) return {}
  let payload: unknown
  try { payload = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { throw new ModagentaiServiceError('请求体不是合法 JSON。', 400) }
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) throw new ModagentaiServiceError('请求体必须是 JSON 对象。', 400)
  return payload as Record<string, unknown>
}

/** 只允许本机 GUI 访问。 */
function guard(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse): boolean {
  if (isLoopbackRequest(req)) return true
  writeJson(res, 403, { ok: false, error: 'forbidden: loopback-only' })
  return false
}

/** 写操作必须同源，避免其它本机页面借浏览器身份触发登录/登出。 */
function guardWrite(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse): boolean {
  if (!guard(req, res)) return false
  const host = req.headers.host
  const source = typeof req.headers.origin === 'string' ? req.headers.origin : req.headers.referer
  if (host === undefined || typeof source !== 'string') {
    writeJson(res, 403, { ok: false, error: 'forbidden: same-origin request required' })
    return false
  }
  try { if (new URL(source).host === host) return true } catch { /* 非法来源按拒绝处理。 */ }
  writeJson(res, 403, { ok: false, error: 'forbidden: same-origin request required' })
  return false
}

/** 内部错误映射成稳定且不含令牌的响应。 */
function writeError(res: import('node:http').ServerResponse, error: unknown): void {
  if (error instanceof ModagentaiServiceError) {
    writeJson(res, error.status, { ok: false, error: error.message })
    return
  }
  writeJson(res, 500, { ok: false, error: '官网账号服务内部错误。' })
}

/** 组装官网账号路由。 */
export function makeModagentaiRoutes(service: ModagentaiService): WebRoute[] {
  return [
    {
      kind: 'exact',
      path: MODAGENTAI_API.status,
      async handler(req, res) {
        if (!guard(req, res)) return
        try {
          writeJson(res, 200, { ok: true, status: await service.status() })
        } catch (error) {
          writeError(res, error)
        }
      },
    },
    {
      kind: 'exact',
      path: MODAGENTAI_API.packages,
      async handler(req, res) {
        if (!guard(req, res)) return
        try {
          writeJson(res, 200, { ok: true, packages: await service.packages() })
        } catch (error) {
          writeError(res, error)
        }
      },
    },
    {
      kind: 'exact',
      path: MODAGENTAI_API.login,
      async handler(req, res) {
        if (!guardWrite(req, res)) return
        if (req.method !== 'POST') { writeJson(res, 405, { ok: false, error: 'POST only' }); return }
        try {
          const body = await readBody(req)
          writeJson(res, 200, { ok: true, ...(await service.login({ username: body.username, password: body.password })) })
        } catch (error) {
          writeError(res, error)
        }
      },
    },
    {
      kind: 'exact',
      path: MODAGENTAI_API.logout,
      async handler(req, res) {
        if (!guardWrite(req, res)) return
        if (req.method !== 'POST') { writeJson(res, 405, { ok: false, error: 'POST only' }); return }
        try {
          writeJson(res, 200, { ok: true, status: await service.logout() })
        } catch (error) {
          writeError(res, error)
        }
      },
    },
    {
      kind: 'exact',
      path: MODAGENTAI_API.applyGateway,
      async handler(req, res) {
        if (!guardWrite(req, res)) return
        if (req.method !== 'POST') { writeJson(res, 405, { ok: false, error: 'POST only' }); return }
        try {
          writeJson(res, 200, { ok: true, status: await service.applyGateway() })
        } catch (error) {
          writeError(res, error)
        }
      },
    },
  ]
}
