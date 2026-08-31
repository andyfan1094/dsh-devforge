/**
 * 天工造梦远程运维首页路由：统一主机清单 + 主机增删（配置面）。
 *
 * 数据来源（dsh-devforge SQLite 收敛后）：
 *   - 主清单 = SSH HostStore + WinRM HostStore（plugin-wide store.db），脱敏摘要；
 *   - LegacyRemoteRegistry（旧 JSON 文件投影）保留为补充来源并按 transport:alias 去重，
 *     迁移完成后为空，仅服务未迁移的旧环境。
 * 执行、传输和终端仍在 adapter 迁入阶段，挂在 config.remote.enabled 总闸下；
 * 主机配置管理（列表/新增/删除）常驻可用，loopback 围栏 + 同源策略不放松。
 */
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { isLoopbackRequest } from '../loopback.ts'
import { DEVFORGE_API } from '../protocol.ts'
import type { LegacyRemoteRegistry } from './legacy-registry.ts'
import type { HostStore as SshHostStore } from './ssh/store.ts'
import type { HostStore as WinrmHostStore } from './winrm/store.ts'
import type { RemoteHostSummary, RemoteTransport } from '../protocol.ts'

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

/** 读取请求体为 JSON（上限 256 KiB，主机条目足够）。 */
async function readJsonBody(req: import('node:http').IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let total = 0
  const maxBytes = 256 * 1024
  for await (const chunk of req) {
    total += (chunk as Buffer).length
    if (total > maxBytes) throw new Error('请求体超过 256 KiB 上限。')
    chunks.push(chunk as Buffer)
  }
  if (chunks.length === 0) throw new Error('请求体为空。')
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if (typeof parsed !== 'object' || parsed === null) throw new Error('请求体必须是 JSON 对象。')
  return parsed as Record<string, unknown>
}

/** 天工造梦远程运维首页的路由集合。 */
export function makeRemoteRoutes(
  registry: LegacyRemoteRegistry,
  sshStore: SshHostStore,
  winrmStore: WinrmHostStore,
): WebRoute[] {
  /** 统一清单：库内 SSH/WinRM 为主，legacy 投影按 transport:alias 去重补充。 */
  const listHosts = (): RemoteHostSummary[] => {
    const merged = new Map<string, RemoteHostSummary>()
    for (const legacy of registry.list()) {
      merged.set(legacy.transport + ':' + legacy.alias, legacy)
    }
    for (const entry of sshStore.list()) {
      const summary = sshStore.summarize(entry)
      merged.set('ssh:' + summary.alias, {
        id: 'ssh:' + summary.alias,
        transport: 'ssh',
        alias: summary.alias,
        host: summary.host,
        port: summary.port,
        user: summary.user,
        auth: summary.auth,
        ...(summary.description !== undefined ? { description: summary.description } : {}),
        ...(summary.environment !== undefined ? { environment: summary.environment } : {}),
        tags: [...summary.tags],
        ...(summary.location !== undefined ? { location: summary.location } : {}),
        createdAt: summary.createdAt,
        updatedAt: summary.updatedAt,
        capabilities: { terminal: true, transfer: true, tunnel: true, services: false, processes: false, cluster: true },
      })
    }
    for (const entry of winrmStore.list()) {
      const summary = winrmStore.summarize(entry)
      merged.set('winrm:' + summary.alias, {
        id: 'winrm:' + summary.alias,
        transport: 'winrm',
        alias: summary.alias,
        host: summary.host,
        port: summary.port,
        user: summary.user,
        auth: summary.auth,
        ...(summary.description !== undefined ? { description: summary.description } : {}),
        ...(summary.environment !== undefined ? { environment: summary.environment } : {}),
        tags: [...summary.tags],
        ...(summary.location !== undefined ? { location: summary.location } : {}),
        createdAt: summary.createdAt,
        updatedAt: summary.updatedAt,
        capabilities: { terminal: true, transfer: true, tunnel: false, services: true, processes: true, cluster: true },
      })
    }
    return [...merged.values()]
  }

  return [
    {
      kind: 'exact',
      path: DEVFORGE_API.remoteHosts,
      handler: async (req, res) => {
        if (!guard(req, res)) return
        if (req.method === 'GET') {
          writeJson(res, 200, { ok: true, hosts: listHosts() })
          return
        }
        if (req.method === 'POST') {
          try {
            const body = await readJsonBody(req)
            const transport = body['transport']
            if (transport !== 'ssh' && transport !== 'winrm') {
              writeJson(res, 400, { ok: false, error: 'transport 必须是 ssh 或 winrm。' }); return
            }
            delete body['transport']
            const entry = transport === 'ssh'
              ? sshStore.create(body as never)
              : winrmStore.create(body as never)
            writeJson(res, 200, { ok: true, alias: entry.alias, transport })
          } catch (error) {
            writeJson(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) })
          }
          return
        }
        if (req.method === 'DELETE') {
          try {
            const url = new URL(req.url ?? '/', 'http://localhost')
            const transport = url.searchParams.get('transport')
            const alias = url.searchParams.get('alias')?.trim() ?? ''
            if ((transport !== 'ssh' && transport !== 'winrm') || alias === '') {
              writeJson(res, 400, { ok: false, error: '需要 transport（ssh|winrm）与 alias 查询参数。' }); return
            }
            if (transport === 'ssh') sshStore.delete(alias); else winrmStore.delete(alias)
            writeJson(res, 200, { ok: true })
          } catch (error) {
            writeJson(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) })
          }
          return
        }
        writeJson(res, 405, { ok: false, error: 'GET/POST/DELETE only' })
      },
    },
  ]
}

/** transport 类型守卫的本地引用（避免未使用告警）。 */
export type { RemoteTransport }
