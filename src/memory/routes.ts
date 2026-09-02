/**
 * 记忆工作台路由 —— /api/dsh-devforge/memory/* 与镜像/项目索引端点（loopback-only）。
 * 端点：状态、设置读写、记忆列表/删除、项目增量索引、Mnemon/Hindsight 镜像同步。
 */
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { isLoopbackRequest } from '../loopback.ts'
import type { RagService } from '../rag/service.ts'
import { ProjectIndexer } from '../rag/project-indexer.ts'
import { mnemonDataRoot, readHindsightConfig, resolveBankId, syncHindsightMirror, syncMnemonMirror } from '../rag/mirror.ts'
import type { MemorySedimentService } from './sediment.ts'
import type { MemorySettings } from './protocol.ts'
export type { MemorySettings }

const MEMORY_SETTINGS_KEY = 'memory.settings'
const MEMORY_KB_NAME = '会话记忆库'

export const DEFAULT_MEMORY_SETTINGS: MemorySettings = {
  enabled: true,
  autoSediment: true,
  autoInject: true,
  topK: 4,
  threshold: 0.35,
  maxChars: 1200,
}

function writeJson(res: import('node:http').ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'content-length': Buffer.byteLength(body) })
  res.end(body)
}

function readJsonBody(req: import('node:http').IncomingMessage): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    let size = 0
    const parts: Buffer[] = []
    req.on('data', (chunk: Buffer) => { size += chunk.length; if (size > 1024 * 1024) { resolve(null); req.destroy(); return } parts.push(chunk) })
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(parts).toString('utf8')) as Record<string, unknown>) } catch { resolve(null) } })
    req.on('error', () => resolve(null))
  })
}

function guard(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse): boolean {
  if (isLoopbackRequest(req)) return true
  writeJson(res, 403, { ok: false, error: 'forbidden: loopback-only' })
  return false
}

/** 规整记忆设置（部分保存不炸；数值夹紧）。 */
export function normalizeMemorySettings(raw: unknown, current: MemorySettings): MemorySettings {
  if (typeof raw !== 'object' || raw === null) return current
  const body = raw as Record<string, unknown>
  return {
    enabled: typeof body.enabled === 'boolean' ? body.enabled : current.enabled,
    autoSediment: typeof body.autoSediment === 'boolean' ? body.autoSediment : current.autoSediment,
    autoInject: typeof body.autoInject === 'boolean' ? body.autoInject : current.autoInject,
    topK: typeof body.topK === 'number' && body.topK > 0 ? Math.min(20, Math.floor(body.topK)) : current.topK,
    threshold: typeof body.threshold === 'number' && body.threshold >= 0 && body.threshold <= 1 ? body.threshold : current.threshold,
    maxChars: typeof body.maxChars === 'number' && body.maxChars >= 300 ? Math.min(4000, Math.floor(body.maxChars)) : current.maxChars,
  }
}

/** 记忆路由依赖（接线层注入）。 */
export interface MemoryRouteDeps {
  rag: RagService
  sediment: MemorySedimentService
  getSettings: () => MemorySettings
  putSettings: (next: MemorySettings) => void
}

/** 确保来源知识库存在（按名称查，缺则建）。 */
function ensureKb(rag: RagService, name: string, source: 'project' | 'mirror', description: string): string {
  const existing = rag.listKbs().find((kb) => kb.name === name)
  if (existing !== undefined) return existing.id
  return rag.createKb(name, { source, description }).id
}

export function makeMemoryRoutes(deps: MemoryRouteDeps): WebRoute[] {
  const { rag, sediment } = deps
  return [
    {
      kind: 'exact',
      path: '/api/dsh-devforge/memory/status',
      handler: async (req, res) => {
        if (!guard(req, res)) return
        try {
          if (req.method !== 'GET') { writeJson(res, 405, { ok: false, error: 'GET only' }); return }
          const settings = deps.getSettings()
          const memoryKb = rag.listKbs().find((kb) => kb.source === 'memory')
          const mnemonRoot = mnemonDataRoot()
          const hindsight = readHindsightConfig()
          writeJson(res, 200, {
            ok: true,
            status: {
              enabled: settings.enabled,
              autoSediment: settings.autoSediment,
              autoInject: settings.autoInject,
              memoryKbId: memoryKb?.id ?? '',
              memoryCount: memoryKb === undefined ? 0 : rag.listDocs(memoryKb.id).length,
              sedimentCount: sediment.sedimentCount,
              injectCount: 0,
              lastSedimentAt: sediment.lastSedimentAt,
              mirror: {
                mnemonRootExists: existsSync(mnemonRoot),
                hindsightConfigured: hindsight !== undefined,
                hindsightServerMode: hindsight?.serverMode ?? '',
                hindsightBank: hindsight === undefined ? '' : resolveBankId(hindsight),
              },
            },
          })
        } catch (error) { writeJson(res, 400, { ok: false, error: (error instanceof Error ? error.message : String(error)).slice(0, 200) }) }
      },
    },
    {
      kind: 'exact',
      path: '/api/dsh-devforge/memory/settings',
      handler: async (req, res) => {
        if (!guard(req, res)) return
        try {
          if (req.method === 'GET') { writeJson(res, 200, { ok: true, settings: deps.getSettings() }); return }
          if (req.method === 'PUT') {
            const body = await readJsonBody(req)
            deps.putSettings(normalizeMemorySettings(body, deps.getSettings()))
            writeJson(res, 200, { ok: true, settings: deps.getSettings() })
            return
          }
          writeJson(res, 405, { ok: false, error: 'GET/PUT only' })
        } catch (error) { writeJson(res, 400, { ok: false, error: (error instanceof Error ? error.message : String(error)).slice(0, 200) }) }
      },
    },
    {
      kind: 'exact',
      path: '/api/dsh-devforge/memory/memories',
      handler: async (req, res) => {
        if (!guard(req, res)) return
        try {
          if (req.method !== 'GET') { writeJson(res, 405, { ok: false, error: 'GET only' }); return }
          const memoryKb = rag.listKbs().find((kb) => kb.source === 'memory')
          const docs = memoryKb === undefined ? [] : rag.listDocs(memoryKb.id)
          writeJson(res, 200, { ok: true, kbId: memoryKb?.id ?? '', docs })
        } catch (error) { writeJson(res, 400, { ok: false, error: (error instanceof Error ? error.message : String(error)).slice(0, 200) }) }
      },
    },
    {
      kind: 'exact',
      path: '/api/dsh-devforge/memory/memories/item',
      handler: async (req, res) => {
        if (!guard(req, res)) return
        try {
          const id = new URL(req.url ?? '', 'http://localhost').searchParams.get('id') ?? ''
          if (req.method !== 'DELETE' || id === '') { writeJson(res, id === '' ? 400 : 405, { ok: false, error: id === '' ? 'id 必填' : 'DELETE only' }); return }
          rag.deleteDoc(id)
          writeJson(res, 200, { ok: true })
        } catch (error) { writeJson(res, 400, { ok: false, error: (error instanceof Error ? error.message : String(error)).slice(0, 200) }) }
      },
    },
    {
      kind: 'exact',
      path: '/api/dsh-devforge/rag/kb/index',
      handler: async (req, res) => {
        if (!guard(req, res)) return
        try {
          if (req.method !== 'POST') { writeJson(res, 405, { ok: false, error: 'POST only' }); return }
          const body = await readJsonBody(req)
          const path = typeof body?.path === 'string' ? body.path.trim() : ''
          const name = typeof body?.name === 'string' && body.name.trim() !== '' ? body.name.trim() : (path === '' ? '' : path.split('/').filter(Boolean).pop() ?? '')
          if (path === '' || name === '') { writeJson(res, 400, { ok: false, error: 'path 必填（本机绝对路径）' }); return }
          const kbId = ensureKb(rag, name, 'project', '项目自动索引：' + path)
          const report = await new ProjectIndexer(rag, kbId).run(path)
          writeJson(res, 200, { ok: true, kbId, report })
        } catch (error) { writeJson(res, 400, { ok: false, error: (error instanceof Error ? error.message : String(error)).slice(0, 200) }) }
      },
    },
    {
      kind: 'exact',
      path: '/api/dsh-devforge/rag/mirror/sync',
      handler: async (req, res) => {
        if (!guard(req, res)) return
        try {
          if (req.method !== 'POST') { writeJson(res, 405, { ok: false, error: 'POST only' }); return }
          const body = await readJsonBody(req)
          const kind = typeof body?.kind === 'string' ? body.kind : ''
          if (kind !== 'mnemon' && kind !== 'hindsight') { writeJson(res, 400, { ok: false, error: 'kind 必须是 mnemon 或 hindsight' }); return }
          const kbName = kind === 'mnemon' ? 'Mnemon 镜像' : 'Hindsight 镜像'
          const kbId = ensureKb(rag, kbName, 'mirror', '只读镜像：' + (kind === 'mnemon' ? 'Mnemon Documents 与热记忆' : 'Hindsight 知识页'))
          const report = kind === 'mnemon'
            ? await syncMnemonMirror(rag, kbId, typeof body?.dataDir === 'string' && body.dataDir !== '' ? body.dataDir : undefined)
            : await syncHindsightMirror(rag, kbId, {
                ...(typeof body?.apiUrl === 'string' && body.apiUrl !== '' ? { apiUrl: body.apiUrl } : {}),
                ...(typeof body?.apiToken === 'string' && body.apiToken !== '' ? { apiToken: body.apiToken } : {}),
                ...(typeof body?.bankId === 'string' && body.bankId !== '' ? { bankId: body.bankId } : {}),
              })
          writeJson(res, 200, { ok: true, kbId, report })
        } catch (error) { writeJson(res, 400, { ok: false, error: (error instanceof Error ? error.message : String(error)).slice(0, 200) }) }
      },
    },
    {
      kind: 'exact',
      path: '/api/dsh-devforge/rag/mirror/status',
      handler: async (req, res) => {
        if (!guard(req, res)) return
        try {
          if (req.method !== 'GET') { writeJson(res, 405, { ok: false, error: 'GET only' }); return }
          const root = mnemonDataRoot()
          const active = join(root, 'documents', 'active')
          let mnemonDocs = 0
          try { if (existsSync(active)) mnemonDocs = readdirSync(active).filter((name) => name.endsWith('.md')).length } catch { /* 不可读按 0 */ }
          const hindsight = readHindsightConfig()
          writeJson(res, 200, {
            ok: true,
            mnemon: { root, rootExists: existsSync(root), docs: mnemonDocs },
            hindsight: { configured: hindsight !== undefined, serverMode: hindsight?.serverMode ?? '', bank: hindsight === undefined ? '' : resolveBankId(hindsight) },
          })
        } catch (error) { writeJson(res, 400, { ok: false, error: (error instanceof Error ? error.message : String(error)).slice(0, 200) }) }
      },
    },
  ]
}

void homedir
