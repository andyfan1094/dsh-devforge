/**
 * MCP 服务器接入路由族 —— /api/dsh-devforge/mcp/*。
 *
 * 安全边界：全部 loopback-only（isLoopbackRequest 围栏，与 routes.ts 同款）；
 * env/headers 明文绝不出 Host——GET 只回「键 + 是否已配置」，POST 空值 = 保留已存值。
 */

import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { isLoopbackRequest } from '../loopback.ts'
import { getDb } from '../store/db.ts'
import { deleteMcpServer, listMcpServers, saveMcpServer, summarizeServer, McpConfigError } from './store.ts'
import { MCP_API, type McpServerSaveRequest, type McpTestResult } from './protocol.ts'
import type { McpService } from './service.ts'

/** JSON 请求体上限（配置数据 KB 级，1MB 富余）。 */
const MAX_BODY = 1024 * 1024

/** 极简 JSON 响应。 */
function writeJson(res: import('node:http').ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

/** 读取 JSON 请求体（超限/解析失败返回 null）。 */
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

/** 围栏：非 loopback 直接 403。 */
function guard(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse): boolean {
  if (isLoopbackRequest(req)) return true
  writeJson(res, 403, { ok: false, error: 'forbidden: loopback-only' })
  return false
}

/** 组装 MCP 路由族。 */
export function makeMcpRoutes(service: McpService): WebRoute[] {
  return [
    {
      kind: 'exact',
      path: MCP_API.servers,
      handler: async (req, res) => {
        if (!guard(req, res)) return
        if (req.method === 'GET') {
          try {
            const servers = listMcpServers(getDb()).map(summarizeServer)
            writeJson(res, 200, { ok: true, servers })
          } catch (error) {
            writeJson(res, 500, { ok: false, error: '读取 MCP 配置失败：' + (error instanceof Error ? error.message : String(error)) })
          }
          return
        }
        if (req.method === 'POST') {
          const body = await readJsonBody(req)
          if (body === null) { writeJson(res, 400, { ok: false, error: '请求体不是合法 JSON 或超出大小限制。' }); return }
          try {
            const record = saveMcpServer(getDb(), body as McpServerSaveRequest)
            service.reconcile() // 保存即生效：新增/变更/启停立刻反映到 fiber 集
            writeJson(res, 200, { ok: true, server: summarizeServer(record) })
          } catch (error) {
            const message = error instanceof McpConfigError ? error.message : '保存 MCP 配置失败：' + (error instanceof Error ? error.message : String(error))
            writeJson(res, 400, { ok: false, error: message })
          }
          return
        }
        if (req.method === 'DELETE') {
          const url = new URL(req.url ?? '/', 'http://localhost')
          const id = url.searchParams.get('id') ?? ''
          if (id === '') { writeJson(res, 400, { ok: false, error: '缺少 id 查询参数。' }); return }
          const removed = deleteMcpServer(getDb(), id)
          service.reconcile() // 删除即卸载
          writeJson(res, 200, { ok: removed, error: removed ? undefined : '服务器不存在（可能已被删除）。' })
          return
        }
        writeJson(res, 405, { ok: false, error: '仅支持 GET/POST/DELETE。' })
      },
    },
    {
      kind: 'exact',
      path: MCP_API.test,
      handler: async (req, res) => {
        if (!guard(req, res)) return
        if (req.method !== 'POST') { writeJson(res, 405, { ok: false, error: 'POST only' }); return }
        const body = await readJsonBody(req)
        if (body === null) { writeJson(res, 400, { ok: false, error: '请求体不是合法 JSON 或超出大小限制。' }); return }
        try {
          const result = await service.test({ id: typeof body.id === 'string' ? body.id : undefined, server: body.server as McpServerSaveRequest | undefined })
          const payload: { ok: boolean; result: McpTestResult } = { ok: true, result }
          writeJson(res, 200, payload)
        } catch (error) {
          writeJson(res, 500, { ok: false, error: '连接测试执行失败：' + (error instanceof Error ? error.message : String(error)) })
        }
      },
    },
    {
      kind: 'exact',
      path: MCP_API.status,
      handler: async (req, res) => {
        if (!guard(req, res)) return
        if (req.method !== 'GET') { writeJson(res, 405, { ok: false, error: 'GET only' }); return }
        writeJson(res, 200, { ok: true, status: service.status() })
      },
    },
    {
      kind: 'exact',
      path: MCP_API.reload,
      handler: async (req, res) => {
        if (!guard(req, res)) return
        if (req.method !== 'POST') { writeJson(res, 405, { ok: false, error: 'POST only' }); return }
        service.reloadAll()
        writeJson(res, 200, { ok: true, status: service.status() })
      },
    },
  ]
}
