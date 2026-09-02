/** OpenAI 兼容中转站面板路由（loopback + 同源写入围栏）。 */
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { isLoopbackRequest } from '../loopback.ts'
import { OPENAI_GATEWAY_API, type OpenAiGatewayConfigPatch, type OpenAiGatewayEndpointConfig } from './protocol.ts'
import { OpenAiGatewayService, OpenAiServiceError } from './service.ts'

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
    if (total > 64 * 1024) throw new OpenAiServiceError('请求体超过 64 KiB 上限。', 413)
    chunks.push(chunk as Buffer)
  }
  if (total === 0) return {}
  let payload: unknown
  try { payload = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { throw new OpenAiServiceError('请求体不是合法 JSON。', 400) }
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) throw new OpenAiServiceError('请求体必须是 JSON 对象。', 400)
  return payload as Record<string, unknown>
}

/** 只允许本机 GUI 访问。 */
function guard(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse): boolean {
  if (isLoopbackRequest(req)) return true
  writeJson(res, 403, { ok: false, error: 'forbidden: loopback-only' })
  return false
}

/** 写操作必须同源，避免其它本机页面借浏览器身份修改中转站配置。 */
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

/** 内部错误映射成稳定且不含 Key 的响应。 */
function writeError(res: import('node:http').ServerResponse, error: unknown): void {
  if (error instanceof OpenAiServiceError) {
    writeJson(res, error.status, { ok: false, error: error.message })
    return
  }
  writeJson(res, 500, { ok: false, error: 'OpenAI 中转站服务发生内部错误。' })
}

/** OpenAI 中转站路由族。 */
export function makeOpenAiRoutes(service: OpenAiGatewayService): WebRoute[] {
  return [
    {
      kind: 'exact',
      path: OPENAI_GATEWAY_API.status,
      handler: async (req, res) => {
        if (!guard(req, res)) return
        if (req.method !== 'GET') { writeJson(res, 405, { ok: false, error: 'GET only' }); return }
        try { writeJson(res, 200, { ok: true, status: await service.status() }) } catch (error) { writeError(res, error) }
      },
    },
    {
      kind: 'exact',
      path: OPENAI_GATEWAY_API.config,
      handler: async (req, res) => {
        if (!guardWrite(req, res)) return
        if (req.method !== 'POST') { writeJson(res, 405, { ok: false, error: 'POST only' }); return }
        try {
          const body = await readBody(req)
          let patch: OpenAiGatewayConfigPatch
          if (body.endpoints !== undefined) {
            if (!Array.isArray(body.endpoints)) throw new OpenAiServiceError('endpoints 必须是数组。', 400)
            const endpoints: OpenAiGatewayEndpointConfig[] = []
            for (const item of body.endpoints) {
              if (item === null || typeof item !== 'object' || Array.isArray(item)) throw new OpenAiServiceError('端点配置必须是对象。', 400)
              const value = item as Record<string, unknown>
              if (typeof value.id !== 'string' || typeof value.name !== 'string' || typeof value.baseURL !== 'string' || typeof value.apiKeyEnv !== 'string') throw new OpenAiServiceError('端点必须包含 id、name、baseURL 和 apiKeyEnv 字符串。', 400)
              const endpoint: OpenAiGatewayEndpointConfig = { id: value.id, name: value.name, baseURL: value.baseURL, apiKeyEnv: value.apiKeyEnv }
              if (value.imageModel !== undefined) {
                if (typeof value.imageModel !== 'string') throw new OpenAiServiceError('imageModel 必须是字符串。', 400)
                endpoint.imageModel = value.imageModel
              }
              endpoints.push(endpoint)
            }
            patch = { endpoints }
          } else {
            if (typeof body.baseURL !== 'string') throw new OpenAiServiceError('baseURL 必须是字符串。', 400)
            patch = { baseURL: body.baseURL }
            if (typeof body.apiKeyEnv === 'string') patch.apiKeyEnv = body.apiKeyEnv
            if (typeof body.imageModel === 'string') patch.imageModel = body.imageModel
          }
          writeJson(res, 200, { ok: true, status: await service.saveConfig(patch) })
        } catch (error) { writeError(res, error) }
      },
    },
    {
      kind: 'exact',
      path: OPENAI_GATEWAY_API.fetchModels,
      handler: async (req, res) => {
        if (!guardWrite(req, res)) return
        if (req.method !== 'POST') { writeJson(res, 405, { ok: false, error: 'POST only' }); return }
        const controller = new AbortController()
        const abort = (): void => controller.abort()
        req.once('aborted', abort)
        res.once('close', abort)
        try {
          const result = await service.fetchModels(controller.signal)
          if (!res.writableEnded) writeJson(res, 200, { ok: true, ...result })
        } catch (error) {
          if (!controller.signal.aborted && !res.writableEnded) writeError(res, error)
        } finally {
          req.off('aborted', abort)
          res.off('close', abort)
        }
      },
    },
  ]
}
