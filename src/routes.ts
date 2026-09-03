/**
 * /api/dsh-devforge 路由族 —— 面板数据通道。
 *
 * 入口说明：makeRoutes 返回 WebRoute 数组（dsh-host-webserver 契约），
 * index.ts 里 ctx.webServer.register 逐条挂载。
 * 安全边界：全部路由 loopback-only（isLoopbackRequest 围栏，仿 dsh-winrm
 * / dsh-codebase-memory 实证模式），公网部署不暴露本插件任何接口。
 */

import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import type { PluginUpdateApplyResult, UpdateCheckItem } from './plugin-update.ts'
import type { HarnessUpdateCheckItem } from './harness-update.ts'
import type { ForgeEngine } from './forge.ts'
import { isLoopbackRequest } from './loopback.ts'
import type { DshWebRestartManager } from './restart.ts'
import { detectProjectGit, listProjects, removeProject, saveProject, validateProjectPayload } from './projects/store.ts'
import { collectTokenUsageShared } from './usage/tokens.ts'
import { createRequire } from 'node:module'

/** 插件版本号（供面板标题展示）。 */
const PLUGIN_VERSION: string = (createRequire(import.meta.url)('../package.json') as { version?: string }).version ?? '0.0.0'

/** JSON 请求体上限。 */
const MAX_BODY = 256 * 1024

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

/** 重启是破坏性操作，除 loopback 外还必须由当前 GUI 同源页面发起。 */
function guardRestart(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse): boolean {
  if (!guard(req, res)) return false
  const host = req.headers.host
  const origin = req.headers.origin
  const referer = req.headers.referer
  if (!host || (typeof origin !== 'string' && typeof referer !== 'string')) {
    writeJson(res, 403, { ok: false, error: 'forbidden: same-origin request required' })
    return false
  }
  const requestOrigin = 'http://' + host
  try {
    const sourceOrigin = typeof origin === 'string' ? origin : new URL(referer as string).origin
    if (sourceOrigin === requestOrigin) return true
  } catch {
    // 非法来源按拒绝处理，不能让异常穿透到 Host。
  }
  writeJson(res, 403, { ok: false, error: 'forbidden: same-origin request required' })
  return false
}

/** 组装路由族。 */
export function makeRoutes(
  engine: ForgeEngine,
  standards: import('./standards.ts').StandardsStore,
  restartManager: DshWebRestartManager,
  pluginBrief: () => { enabled: boolean; text: string; diag: { loaderResolved: boolean; entryCount: number; userCount: number; error: string } },
  pluginUpdate: {
    check: () => Promise<{ enabled: boolean; items: UpdateCheckItem[] }>
    apply: (packageName: string) => Promise<PluginUpdateApplyResult>
    /** DSH 本体检查（官方 GitHub Tags，含预发布版本比较与升级命令引导）。 */
    harnessCheck: () => Promise<HarnessUpdateCheckItem>
  },
): WebRoute[] {
  return [
    {
      kind: 'exact',
      path: '/api/dsh-devforge/meta',
      handler: async (req, res) => {
        if (!guard(req, res)) return
        if (req.method !== 'GET') { writeJson(res, 405, { ok: false, error: 'GET only' }); return }
        writeJson(res, 200, { ok: true, version: PLUGIN_VERSION })
      },
    },
    {
      kind: 'exact',
      path: '/api/dsh-devforge/plugin-brief',
      handler: async (req, res) => {
        if (!guard(req, res)) return
        if (req.method !== 'GET') { writeJson(res, 405, { ok: false, error: 'GET only' }); return }
        // 返回当前实际注入的总览文本与诊断，供暂存环境验收「所见即所注」。
        const brief = pluginBrief()
        writeJson(res, 200, { ok: true, enabled: brief.enabled, text: brief.text, diag: brief.diag })
      },
    },
    {
      kind: 'exact',
      path: '/api/dsh-devforge/plugin-update/check',
      handler: async (req, res) => {
        if (!guard(req, res)) return
        if (req.method !== 'GET') { writeJson(res, 405, { ok: false, error: 'GET only' }); return }
        const result = await pluginUpdate.check()
        writeJson(res, 200, { ok: true, enabled: result.enabled, items: result.items })
      },
    },
    {
      kind: 'exact',
      path: '/api/dsh-devforge/plugin-update/apply',
      handler: async (req, res) => {
        if (!guard(req, res)) return
        if (req.method !== 'POST') { writeJson(res, 405, { ok: false, error: 'POST only' }); return }
        const body = await readJsonBody(req)
        const packageName = typeof body?.packageName === 'string' ? body.packageName : ''
        if (packageName === '') { writeJson(res, 400, { ok: false, error: '缺少 packageName' }); return }
        try {
          const result = await pluginUpdate.apply(packageName)
          writeJson(res, 200, { ok: true, result })
        } catch (error) {
          writeJson(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
    {
      kind: 'exact',
      path: '/api/dsh-devforge/plugin-update/harness',
      handler: async (req, res) => {
        if (!guard(req, res)) return
        if (req.method !== 'GET') { writeJson(res, 405, { ok: false, error: 'GET only' }); return }
        try {
          const harness = await pluginUpdate.harnessCheck()
          writeJson(res, 200, { ok: true, harness })
        } catch (error) {
          writeJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
    {
      kind: 'exact',
      path: '/api/dsh-devforge/restart',
      handler: async (req, res) => {
        if (!guardRestart(req, res)) return
        if (req.method !== 'POST') { writeJson(res, 405, { ok: false, error: 'POST only' }); return }
        const result = restartManager.requestRestart()
        writeJson(res, 202, { ok: true, result })
      },
    },
    {
      kind: 'exact',
      path: '/api/dsh-devforge/usage/tokens',
      handler: async (req, res) => {
        if (!guard(req, res)) return
        if (req.method !== 'GET') { writeJson(res, 405, { ok: false, error: 'GET only' }); return }
        try {
          // 只读聚合，零凭据参与；首次全量扫描较大时由共享扫描去重并发。
          const report = await collectTokenUsageShared()
          writeJson(res, 200, { ok: true, report })
        } catch (error) {
          writeJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
    {
      kind: 'exact',
      path: '/api/dsh-devforge/standards',
      handler: async (req, res) => {
        if (!guard(req, res)) return
        if (req.method !== 'GET') { writeJson(res, 405, { ok: false, error: 'GET only' }); return }
        writeJson(res, 200, { ok: true, standards: standards.list() })
      },
    },
    {
      kind: 'exact',
      path: '/api/dsh-devforge/standards/item',
      handler: async (req, res) => {
        if (!guard(req, res)) return
        if (req.method !== 'GET') { writeJson(res, 405, { ok: false, error: 'GET only' }); return }
        const url = new URL(req.url ?? '/', 'http://localhost')
        const id = url.searchParams.get('id') ?? ''
        const detail = standards.get(id)
        if (!detail) { writeJson(res, 404, { ok: false, error: 'unknown id: ' + id }); return }
        writeJson(res, 200, { ok: true, standard: detail })
      },
    },
    {
      kind: 'exact',
      path: '/api/dsh-devforge/templates',
      handler: async (req, res) => {
        if (!guard(req, res)) return
        if (req.method !== 'GET') { writeJson(res, 405, { ok: false, error: 'GET only' }); return }
        writeJson(res, 200, { ok: true, templates: engine.templates() })
      },
    },
    {
      kind: 'exact',
      path: '/api/dsh-devforge/jobs',
      handler: async (req, res) => {
        if (!guard(req, res)) return
        if (req.method === 'GET') {
          writeJson(res, 200, { ok: true, jobs: engine.listJobs() })
          return
        }
        if (req.method !== 'POST') { writeJson(res, 405, { ok: false, error: 'GET/POST only' }); return }
        const body = await readJsonBody(req)
        if (!body) { writeJson(res, 400, { ok: false, error: 'invalid JSON body' }); return }
        try {
          const job = await engine.createJob(body as never)
          writeJson(res, 200, { ok: true, job })
        } catch (error) {
          writeJson(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
    {
      kind: 'exact',
      path: '/api/dsh-devforge/jobs/item',
      handler: async (req, res) => {
        if (!guard(req, res)) return
        if (req.method !== 'POST') { writeJson(res, 405, { ok: false, error: 'POST only' }); return }
        const body = await readJsonBody(req)
        const id = typeof body?.id === 'string' ? body.id : ''
        const action = typeof body?.action === 'string' ? body.action : ''
        if (id === '' || action !== 'cancel') { writeJson(res, 400, { ok: false, error: 'id 与 action=cancel 必填' }); return }
        const job = engine.cancelJob(id)
        if (!job) { writeJson(res, 404, { ok: false, error: 'unknown job: ' + id }); return }
        writeJson(res, 200, { ok: true, job })
      },
    },
    {
      kind: 'exact',
      path: '/api/dsh-devforge/projects',
      handler: async (req, res) => {
        if (!guard(req, res)) return
        if (req.method === 'GET') {
          writeJson(res, 200, { ok: true, projects: listProjects() })
          return
        }
        if (req.method !== 'POST') { writeJson(res, 405, { ok: false, error: 'GET/POST only' }); return }
        const body = await readJsonBody(req)
        if (!body) { writeJson(res, 400, { ok: false, error: 'invalid JSON body' }); return }
        const invalid = validateProjectPayload(body)
        if (invalid !== undefined) { writeJson(res, 400, { ok: false, error: invalid }); return }
        try {
          writeJson(res, 200, { ok: true, project: saveProject(body) })
        } catch (error) {
          writeJson(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
    {
      kind: 'exact',
      path: '/api/dsh-devforge/projects/item',
      handler: async (req, res) => {
        if (!guard(req, res)) return
        if (req.method !== 'DELETE') { writeJson(res, 405, { ok: false, error: 'DELETE only' }); return }
        const url = new URL(req.url ?? '/', 'http://localhost')
        const id = url.searchParams.get('id') ?? ''
        if (id === '') { writeJson(res, 400, { ok: false, error: 'id 必填' }); return }
        const removed = removeProject(id)
        if (!removed) { writeJson(res, 404, { ok: false, error: 'unknown project: ' + id }); return }
        writeJson(res, 200, { ok: true })
      },
    },
    {
      kind: 'exact',
      path: '/api/dsh-devforge/projects/detect',
      handler: async (req, res) => {
        if (!guard(req, res)) return
        if (req.method !== 'GET') { writeJson(res, 405, { ok: false, error: 'GET only' }); return }
        const url = new URL(req.url ?? '/', 'http://localhost')
        const result = detectProjectGit(url.searchParams.get('path') ?? '')
        writeJson(res, 200, { ok: true, detect: result })
      },
    },
  ]
}
