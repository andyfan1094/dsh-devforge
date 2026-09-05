import type { IncomingMessage, ServerResponse } from 'node:http'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { isLoopbackRequest } from '../loopback.ts'
import { DOUYIN_LIVE_API } from './protocol.ts'
import { DouyinInputError } from './room.ts'
import type { DouyinLiveService } from './service.ts'

/** 本机路由额外校验 Host/Origin，阻止网页跨站操控本地直播连接。 */
function trusted(req: IncomingMessage): boolean {
  if (!isLoopbackRequest(req)) return false
  try {
    const host = new URL('http://' + req.headers.host)
    if (!['localhost', '127.0.0.1', '[::1]'].includes(host.hostname)) return false
    if (req.headers['sec-fetch-site'] === 'cross-site') return false
    const origin = req.headers.origin
    if (origin && new URL(origin).host !== host.host) return false
    return true
  } catch { return false }
}

/** 所有响应禁止缓存，直播文本不进入浏览器长期缓存。 */
function json(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(data))
}

/** 读取小型 JSON 对象；超限和慢速请求均有界。 */
async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  return await new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    const timer = setTimeout(() => finish(new DouyinInputError('请求读取超时。')), 5000)
    const finish = (error?: Error): void => {
      clearTimeout(timer)
      req.removeListener('data', onData)
      req.removeListener('end', onEnd)
      req.removeListener('error', onError)
      req.removeListener('aborted', onError)
      if (error) { req.resume(); reject(error); return }
      try {
        const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error()
        resolve(value as Record<string, unknown>)
      } catch { reject(new DouyinInputError('请求体必须是 JSON 对象。')) }
    }
    const onData = (chunk: Buffer): void => {
      size += chunk.length
      if (size > 8192) { finish(new DouyinInputError('请求体不能超过 8KB。')); return }
      chunks.push(chunk)
    }
    const onEnd = (): void => finish()
    const onError = (): void => finish(new DouyinInputError('请求读取中断。'))
    req.on('data', onData).on('end', onEnd).on('error', onError).on('aborted', onError)
  })
}

/** GET snapshot；POST connect/disconnect/clear/auto/speech；不提供发送消息接口。 */
export function makeDouyinLiveRoutes(service: DouyinLiveService): WebRoute[] {
  return ['snapshot', 'connect', 'disconnect', 'clear', 'auto', 'speech'].map(action => ({
    kind: 'exact', path: DOUYIN_LIVE_API + '/' + action,
    handler: async (req, res) => {
      if (!trusted(req)) { json(res, 403, { ok: false, error: '仅允许本机同源访问。', code: 'forbidden' }); return }
      const method = action === 'snapshot' ? 'GET' : 'POST'
      if (req.method !== method) { res.setHeader('Allow', method); json(res, 405, { ok: false, error: '不支持的请求方法。', code: 'method_not_allowed' }); return }
      try {
        if (action === 'connect') {
          if (!req.headers['content-type']?.toLowerCase().startsWith('application/json')) throw new DouyinInputError('连接请求必须使用 application/json。')
          await service.connect((await body(req)).roomInput)
        }
        if (action === 'auto') {
          if (!req.headers['content-type']?.toLowerCase().startsWith('application/json')) throw new DouyinInputError('自动跟随设置必须使用 application/json。')
          const value = (await body(req)).enabled
          if (typeof value !== 'boolean') throw new DouyinInputError('enabled 必须是布尔值。')
          service.setAutoMonitor(value)
        }
        if (action === 'speech') {
          if (!req.headers['content-type']?.toLowerCase().startsWith('application/json')) throw new DouyinInputError('语音播报设置必须使用 application/json。')
          const value = (await body(req)).enabled
          if (typeof value !== 'boolean') throw new DouyinInputError('enabled 必须是布尔值。')
          service.setWelcomeSpeech(value)
        }
        if (action === 'disconnect') service.disconnect()
        if (action === 'clear') service.clear()
        json(res, 200, { ok: true, snapshot: service.snapshot() })
      } catch (error) {
        const invalid = error instanceof DouyinInputError
        json(res, invalid ? 400 : 503, { ok: false, error: invalid ? error.message : '直播服务暂时不可用，请稍后重试。', code: invalid ? 'invalid_input' : 'unavailable' })
      }
    },
  }))
}
