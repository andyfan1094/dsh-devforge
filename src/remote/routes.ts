/**
 * 服务工厂远程运维路由（第一阶段只读）。
 * 安全边界：仅 loopback 可访问，响应只含 LegacyRemoteRegistry 的无密摘要。
 */
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { isLoopbackRequest } from '../loopback.ts'
import { DEVFORGE_API } from '../protocol.ts'
import type { LegacyRemoteRegistry } from './legacy-registry.ts'

/** 写入无缓存 JSON 响应。 */
function writeJson(res: import('node:http').ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'content-length': Buffer.byteLength(body) })
  res.end(body)
}

/** 统一 loopback 围栏，公网 Host 不暴露任何远程主机元数据。 */
function guard(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse): boolean {
  if (isLoopbackRequest(req)) return true
  writeJson(res, 403, { ok: false, error: 'forbidden: loopback-only' })
  return false
}

/** 远程运维第一阶段的路由集合。 */
export function makeRemoteRoutes(registry: LegacyRemoteRegistry): WebRoute[] {
  return [{
    kind: 'exact',
    path: DEVFORGE_API.remoteHosts,
    handler: async (req, res) => {
      if (!guard(req, res)) return
      if (req.method !== 'GET') { writeJson(res, 405, { ok: false, error: 'GET only' }); return }
      writeJson(res, 200, { ok: true, hosts: registry.list() })
    },
  }]
}
