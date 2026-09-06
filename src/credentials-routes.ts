/** 天工造梦通用受管凭据写入路由（loopback 围栏 + 同源校验，仅天工造梦面板可用）。 */
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { isLoopbackRequest } from './loopback.ts'
import { deleteCredential, setCredential } from './credentials-writer.ts'
import { getDb, putCredentialMirror, removeCredentialMirror } from './store/db.ts'

/** 天工造梦内的凭据写入 API 路径。 */
export const CREDENTIALS_API = {
  set: '/api/dsh-devforge/credentials/set',
  remove: '/api/dsh-devforge/credentials/remove',
} as const

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

/** 所有天工造梦面板接口只允许本机 GUI 调用。 */
function guard(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse): boolean {
  if (isLoopbackRequest(req)) return true
  writeJson(res, 403, { ok: false, error: 'forbidden: loopback-only' })
  return false
}

/** 写操作额外校验来源 Host（同源策略，避免本机任意进程跨页面调用）。 */
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
    /* 非法来源按拒绝处理 */
  }
  writeJson(res, 403, { ok: false, error: 'forbidden: same-origin request required' })
  return false
}

/** 读取请求体为 JSON；尺寸上限 64 KiB（凭据引用名 + 一段 API Key 足够）。 */
async function readJsonBody(req: import('node:http').IncomingMessage): Promise<{ ref: string; value: string }> {
  const chunks: Buffer[] = []
  let total = 0
  const maxBytes = 64 * 1024
  for await (const chunk of req) {
    total += (chunk as Buffer).length
    if (total > maxBytes) throw new Error('请求体超过 64 KiB 上限。')
    chunks.push(chunk as Buffer)
  }
  if (total === 0) throw new Error('请求体为空。')
  const text = Buffer.concat(chunks).toString('utf8')
  let payload: unknown
  try { payload = JSON.parse(text) } catch { throw new Error('请求体不是合法 JSON。') }
  if (payload === null || typeof payload !== 'object') throw new Error('请求体必须是 JSON 对象。')
  const obj = payload as { ref?: unknown; value?: unknown }
  if (typeof obj.ref !== 'string' || obj.ref === '') throw new Error('ref 不能为空。')
  if (typeof obj.value !== 'string') throw new Error('value 必须是字符串。')
  return { ref: obj.ref, value: obj.value }
}

/** 受管凭据写入路由族。 */
export function makeCredentialsRoutes(): WebRoute[] {
  return [
    {
      kind: 'exact',
      path: CREDENTIALS_API.set,
      handler: async (req, res) => {
        if (!guardWrite(req, res)) return
        if (req.method !== 'POST') { writeJson(res, 405, { ok: false, error: 'POST only' }); return }
        try {
          const body = await readJsonBody(req)
          const result = await setCredential(body.ref, body.value)
          // 双写镜像：yaml 仍是主存（宿主 ctx.credentials.resolve 零改动），
          // 库里留一份副本供整体备份（.credentials.yaml 不在备份范围）。
          try { putCredentialMirror(getDb(), body.ref, body.value) } catch { /* 镜像失败不影响主写入 */ }
          writeJson(res, 200, { ok: true, ...result })
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          writeJson(res, 400, { ok: false, error: message })
        }
      },
    },
    {
      kind: 'exact',
      path: CREDENTIALS_API.remove,
      handler: async (req, res) => {
        if (!guardWrite(req, res)) return
        if (req.method !== 'POST') { writeJson(res, 405, { ok: false, error: 'POST only' }); return }
        try {
          const body = await readJsonBody(req)
          const result = await deleteCredential(body.ref)
          // 镜像同步删除；镜像清理失败不阻塞主删除。
          try { removeCredentialMirror(getDb(), body.ref) } catch { /* 镜像清理失败不阻塞 */ }
          writeJson(res, 200, { ok: true, ...result })
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          writeJson(res, 400, { ok: false, error: message })
        }
      },
    },
  ]
}
