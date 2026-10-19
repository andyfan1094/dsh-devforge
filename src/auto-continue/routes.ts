/**
 * 失败自动续跑（auto-continue）—— 面板数据通道。
 *
 * 与插件其它面板路由同口径：loopback-only（公网部署不暴露）、GET/PUT 幂等、
 * 错误一律 400 + 中文原因。统计随设置一起返回，面板一次请求即可显示「有没有真的补发过」。
 */

import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { isLoopbackRequest } from '../loopback.ts'
import { AUTO_CONTINUE_API, normalizeAutoContinueSettings, type AutoContinueSettings, type AutoContinueStats } from './protocol.ts'

/** JSON 请求体上限。 */
const MAX_BODY = 64 * 1024

function writeJson(res: import('node:http').ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

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

function guard(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse): boolean {
  if (isLoopbackRequest(req)) return true
  writeJson(res, 403, { ok: false, error: 'forbidden: loopback-only' })
  return false
}

/** 路由依赖（index.ts 闭包提供，读写都落在插件自己的 store.db settings 域）。 */
export interface AutoContinueRoutesDeps {
  getSettings(): AutoContinueSettings
  putSettings(next: AutoContinueSettings): void
  /** 运行统计（进程内计数，重启清零）。 */
  stats(): AutoContinueStats
}

/** 组装自动续跑路由。 */
export function makeAutoContinueRoutes(deps: AutoContinueRoutesDeps): WebRoute[] {
  return [
    {
      kind: 'exact',
      path: AUTO_CONTINUE_API.settings,
      handler: async (req, res) => {
        if (!guard(req, res)) return
        try {
          if (req.method === 'GET') {
            writeJson(res, 200, { ok: true, settings: deps.getSettings(), stats: deps.stats() })
            return
          }
          if (req.method === 'PUT') {
            const body = await readJsonBody(req)
            if (body === null) { writeJson(res, 400, { ok: false, error: '请求体不是合法 JSON' }); return }
            deps.putSettings(normalizeAutoContinueSettings(body, deps.getSettings()))
            writeJson(res, 200, { ok: true, settings: deps.getSettings(), stats: deps.stats() })
            return
          }
          writeJson(res, 405, { ok: false, error: 'GET/PUT only' })
        } catch (error) {
          writeJson(res, 400, { ok: false, error: (error instanceof Error ? error.message : String(error)).slice(0, 200) })
        }
      },
    },
  ]
}
