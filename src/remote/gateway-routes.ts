/**
 * 远程访问网关面板路由（0.41.0）：GET 读脱敏配置+运行状态，PUT 保存并热重建。
 *
 * 配置存储：plugin-wide store.db 的 'gateway.settings' 域（getSettings/putSettings）。
 * 存储一旦有值即优先于组合配置（patch/settings RAW）——「面板接管」语义：
 * 用面板改过一次之后，以面板保存的值为准，重启不丢。
 * 保存回调 onSave 由插件接线到 sync()：网关按新配置即刻重建，无需重启 DSH。
 * 密码原文只落本机 store.db，GET 永不回传，日志不打印。
 */
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { networkInterfaces } from 'node:os'
import { isLoopbackRequest } from '../loopback.ts'
import { GATEWAY_API, type GatewayRuntimeView, type GatewaySettingsInput, type GatewaySettingsPatch, type GatewaySettingsView } from './protocol.ts'

/**
 * 拼员工可用的完整访问链接（面板直接显示）。
 * 监听所有网卡（0.0.0.0/::）时枚举本机内网 IPv4（排除回环与 169.254 链路本地）；
 * 监听具体地址时只给那一个。
 */
export function gatewayAccessUrls(host: string, port: number): string[] {
  const normalized = host.trim() === '' ? '0.0.0.0' : host.trim()
  if (normalized === '0.0.0.0' || normalized === '::') {
    const urls: string[] = []
    const seen = new Set<string>()
    for (const list of Object.values(networkInterfaces())) {
      for (const net of list ?? []) {
        if (net.family !== 'IPv4' || net.internal) continue
        if (net.address.startsWith('169.254.')) continue
        if (seen.has(net.address)) continue
        seen.add(net.address)
        urls.push(`http://${net.address}:${port}`)
      }
    }
    return urls
  }
  return [`http://${normalized}:${port}`]
}

/** 写入无缓存 JSON 响应。 */
function writeJson(res: import('node:http').ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'content-length': Buffer.byteLength(body) })
  res.end(body)
}

/** 统一 loopback 围栏：网关配置只允许本机操作。 */
function guard(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse): boolean {
  if (isLoopbackRequest(req)) return true
  writeJson(res, 403, { ok: false, error: 'forbidden: loopback-only' })
  return false
}

/** 读取请求体为 JSON（上限 64 KiB，网关配置足够）。 */
async function readJsonBody(req: import('node:http').IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let total = 0
  const maxBytes = 64 * 1024
  for await (const chunk of req) {
    total += (chunk as Buffer).length
    if (total > maxBytes) throw new Error('请求体超过 64 KiB 上限。')
    chunks.push(chunk as Buffer)
  }
  if (chunks.length === 0) throw new Error('请求体为空。')
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if (typeof parsed !== 'object' || parsed === null) throw new Error('请求体必须是 JSON 对象。')
  return parsed as Record<string, unknown>
}

/** 合法端口范围。 */
const PORT_MIN = 1
const PORT_MAX = 65535
/** 会话时长上限（与网关 MAX_SESSION_HOURS 一致，7 天）。 */
const SESSION_HOURS_MAX = 168

/**
 * 把面板保存请求合并进当前生效配置（纯函数，可测）。
 * 规则：显式给出的字段覆盖；password 空串/缺省 = 保留旧密码；
 * 端口/时长做范围裁剪，越界直接报中文错误（面板提示，不静默纠正）。
 */
export function mergeGatewaySettings(
  current: GatewaySettingsInput,
  patch: GatewaySettingsPatch,
): GatewaySettingsInput {
  const next: GatewaySettingsInput = { ...current }
  if (patch.enabled !== undefined) next.enabled = patch.enabled === true
  if (patch.port !== undefined) {
    const port = Math.floor(patch.port)
    if (!Number.isSafeInteger(port) || port < PORT_MIN || port > PORT_MAX) throw new Error(`端口必须在 ${PORT_MIN}-${PORT_MAX} 之间`)
    next.port = port
  }
  if (patch.host !== undefined) {
    const host = String(patch.host).trim()
    if (host === '') throw new Error('监听地址不能为空（0.0.0.0 = 所有网卡，127.0.0.1 = 仅本机）')
    next.host = host
  }
  if (patch.upstreamPort !== undefined) {
    const port = Math.floor(patch.upstreamPort)
    if (!Number.isSafeInteger(port) || port < PORT_MIN || port > PORT_MAX) throw new Error(`上游端口必须在 ${PORT_MIN}-${PORT_MAX} 之间`)
    if (port === next.port) throw new Error('上游端口不能与网关端口相同')
    next.upstreamPort = port
  }
  if (patch.sessionHours !== undefined) {
    const hours = Math.floor(patch.sessionHours)
    if (!Number.isSafeInteger(hours) || hours < 1 || hours > SESSION_HOURS_MAX) throw new Error(`会话时长必须在 1-${SESSION_HOURS_MAX} 小时之间`)
    next.sessionHours = hours
  }
  if (typeof patch.password === 'string' && patch.password !== '') next.password = patch.password
  return next
}

/** 网关路由依赖（由插件接线）。 */
export interface GatewayRoutesDeps {
  /** 读当前生效配置（含密码原文；仅 Host 内存中使用）。 */
  readConfig: () => GatewaySettingsInput
  /** 读运行状态。 */
  readRuntime: () => GatewayRuntimeView
  /** 保存（落库）回调：内部持久化 + 触发 sync() 热重建。 */
  save: (next: GatewaySettingsInput) => void
}

/** 配置转浏览器视图（密码原文 → hasPassword 布尔）。 */
function toView(config: GatewaySettingsInput): GatewaySettingsView {
  const { password, ...rest } = config
  return { ...rest, hasPassword: password !== '' }
}

/** 天工造梦「远程访问」页的路由集合。 */
export function makeGatewayRoutes(deps: GatewayRoutesDeps): WebRoute[] {
  return [
    {
      kind: 'exact',
      path: GATEWAY_API.settings,
      handler: async (req, res) => {
        if (!guard(req, res)) return
        try {
          if (req.method === 'GET') {
            writeJson(res, 200, { ok: true, config: toView(deps.readConfig()), runtime: deps.readRuntime() })
            return
          }
          if (req.method === 'PUT') {
            const body = await readJsonBody(req)
            const next = mergeGatewaySettings(deps.readConfig(), body as GatewaySettingsPatch)
            if (next.enabled === true && next.password === '') throw new Error('开启网关前请先设置访问密码')
            deps.save(next)
            writeJson(res, 200, { ok: true, config: toView(next), runtime: deps.readRuntime() })
            return
          }
          writeJson(res, 405, { ok: false, error: '仅支持 GET/PUT' })
        } catch (error) {
          writeJson(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
  ]
}
