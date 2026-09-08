/**
 * 主脑路由路由族 —— /api/dsh-devforge/brain-router*。
 *
 * 安全边界：全部 loopback-only（isLoopbackRequest 围栏，与 routes.ts 同款）。
 * GET 下发设置与运行时诊断；PUT 全量替换设置（服务端逐字段白名单校验）；
 * catalog 下发模型目录供工人模型下拉选择。绝不回显任何密钥。
 */

import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { isLoopbackRequest } from '../loopback.ts'
import { sanitizeBrainRouterInput } from './core.ts'
import { BRAIN_ROUTER_API, type BrainRouterCatalogProvider, type BrainRouterSettings, type BrainRouterStatus } from './protocol.ts'

/** JSON 请求体上限（设置数据 KB 级，1MB 富余）。 */
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

/** 路由族的宿主处理器集合（index.ts 装配时注入闭包）。 */
export interface BrainRouterHandlers {
  /** 读取当前生效设置。 */
  read: () => BrainRouterSettings
  /** 全量保存设置（校验失败抛错）。 */
  write: (value: BrainRouterSettings) => Promise<void>
  /** 读取模型目录。 */
  catalog: () => Promise<BrainRouterCatalogProvider[]>
  /** 委派拦截器是否已挂载。 */
  wrapperInstalled: () => boolean
}

/** 组装主脑路由状态负载（GET 与 PUT 成功响应共用）。 */
function buildStatus(handlers: BrainRouterHandlers): BrainRouterStatus {
  const settings = handlers.read()
  const workerReady = settings.workerProvider.trim() !== '' && settings.workerModel.trim() !== ''
  return {
    settings,
    active: settings.enabled && workerReady && handlers.wrapperInstalled(),
    patternValid: settings.mainModelPattern.trim() !== '' && isPatternUsable(settings.mainModelPattern),
    wrapperInstalled: handlers.wrapperInstalled(),
  }
}

/** 正则可用性（避免路由层直接依赖 core 编译缓存的内部状态，独立校验）。 */
function isPatternUsable(pattern: string): boolean {
  try {
    new RegExp(pattern.trim(), 'i')
    return true
  } catch {
    return false
  }
}

/** 组装主脑路由族。 */
export function makeBrainRouterRoutes(handlers: BrainRouterHandlers): WebRoute[] {
  return [
    {
      kind: 'exact',
      path: BRAIN_ROUTER_API.status,
      handler: async (req, res) => {
        if (!guard(req, res)) return
        if (req.method === 'GET') {
          writeJson(res, 200, { ok: true, ...buildStatus(handlers) })
          return
        }
        if (req.method !== 'PUT') { writeJson(res, 405, { ok: false, error: 'GET/PUT only' }); return }
        const body = await readJsonBody(req)
        if (body === null) { writeJson(res, 400, { ok: false, error: '请求体必须是 JSON 对象' }); return }
        const sanitized = sanitizeBrainRouterInput(body.settings ?? body)
        if (!sanitized.ok) { writeJson(res, 400, { ok: false, error: sanitized.error }); return }
        try {
          await handlers.write(sanitized.value)
        } catch (error) {
          writeJson(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) })
          return
        }
        writeJson(res, 200, { ok: true, ...buildStatus(handlers) })
      },
    },
    {
      kind: 'exact',
      path: BRAIN_ROUTER_API.catalog,
      handler: async (req, res) => {
        if (!guard(req, res)) return
        if (req.method !== 'GET') { writeJson(res, 405, { ok: false, error: 'GET only' }); return }
        try {
          const providers = await handlers.catalog()
          writeJson(res, 200, { ok: true, providers })
        } catch (error) {
          writeJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
  ]
}
