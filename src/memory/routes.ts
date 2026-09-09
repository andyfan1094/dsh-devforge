/**
 * 记忆工作台路由 —— /api/dsh-devforge/memory/* 与镜像/项目索引端点（loopback-only）。
 * 端点：状态、设置读写、记忆列表/删除、项目增量索引、Mnemon/Hindsight 镜像同步。
 */
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { dshHome } from '../remote/shared/dsh-home.ts'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { isLoopbackRequest } from '../loopback.ts'
import type { RagService } from '../rag/service.ts'
import { ProjectIndexer } from '../rag/project-indexer.ts'
import { mnemonDataRoot, readHindsightConfig, resolveBankId, syncHindsightMirror, syncMnemonMirror } from '../rag/mirror.ts'
import { collectHindsightItems, collectMnemeItems, collectMnemonItems } from './migrate.ts'
import { buildMemoryGraph } from './graph.ts'
import type { MemoryDreamService } from './dream.ts'
import type { MemorySedimentService } from './sediment.ts'
import type { MemoryStatsStore } from './stats.ts'
import type { MemoryInjectionService } from './inject.ts'
import { NativeMemoryStore, type NativeMemoryInput, type NativeMemoryPatch, type NativeMemoryMigrationItem } from './native.ts'
import { DEFAULT_USER_PROFILE, normalizeUserProfile, type MemoryUserProfile } from './profile.ts'
import type { MemorySettings } from './protocol.ts'
export type { MemorySettings }

const MEMORY_SETTINGS_KEY = 'memory.settings'
const MEMORY_PROFILE_KEY = 'memory.profile'
const MEMORY_KB_NAME = '会话记忆库'

export const DEFAULT_MEMORY_SETTINGS: MemorySettings = {
  enabled: true,
  autoSediment: true,
  autoInject: true,
  topK: 4,
  threshold: 0.35,
  maxChars: 1200,
  // 做梦默认关闭：整理动作由用户显式开启（红线：自动化动库必须用户点头）。
  dreamEnabled: false,
  dreamIdleMinutes: 10,
  dreamMinIntervalHours: 6,
  // 模型路由缺省跟随会话默认模型；建议配置专用裁决路由（如 minimax-cn + MiniMax-M2.7-highspeed）。
  dreamProvider: '',
  dreamModel: '',
  dreamMaxTokens: 8192,
  dreamMaxEntries: 300,
  dreamMaxChars: 240,
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
  // 数字字段统一「合法则采纳并夹紧，否则保留现值」的口径，脏输入不至于打崩设置。
  const clampNumber = (value: unknown, min: number, max: number, fallback: number): number => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
    return Math.max(min, Math.min(max, Math.floor(value)))
  }
  const cleanRoute = (value: unknown, fallback: string): string => {
    if (typeof value !== 'string') return fallback
    return value.trim().slice(0, 120)
  }
  return {
    enabled: typeof body.enabled === 'boolean' ? body.enabled : current.enabled,
    autoSediment: typeof body.autoSediment === 'boolean' ? body.autoSediment : current.autoSediment,
    autoInject: typeof body.autoInject === 'boolean' ? body.autoInject : current.autoInject,
    topK: typeof body.topK === 'number' && body.topK > 0 ? Math.min(20, Math.floor(body.topK)) : current.topK,
    threshold: typeof body.threshold === 'number' && body.threshold >= 0 && body.threshold <= 1 ? body.threshold : current.threshold,
    maxChars: typeof body.maxChars === 'number' && body.maxChars >= 300 ? Math.min(4000, Math.floor(body.maxChars)) : current.maxChars,
    dreamEnabled: typeof body.dreamEnabled === 'boolean' ? body.dreamEnabled : current.dreamEnabled,
    dreamIdleMinutes: clampNumber(body.dreamIdleMinutes, 1, 120, current.dreamIdleMinutes),
    dreamMinIntervalHours: clampNumber(body.dreamMinIntervalHours, 1, 168, current.dreamMinIntervalHours),
    dreamProvider: cleanRoute(body.dreamProvider, current.dreamProvider),
    dreamModel: cleanRoute(body.dreamModel, current.dreamModel),
    dreamMaxTokens: clampNumber(body.dreamMaxTokens, 1024, 65536, current.dreamMaxTokens),
    dreamMaxEntries: clampNumber(body.dreamMaxEntries, 20, 1000, current.dreamMaxEntries),
    dreamMaxChars: clampNumber(body.dreamMaxChars, 60, 2000, current.dreamMaxChars),
  }
}

/** 记忆路由依赖（接线层注入）。 */
export interface MemoryRouteDeps {
  rag: RagService
  sediment: MemorySedimentService
  stats: MemoryStatsStore
  /** 注入服务：状态接口回读真实注入次数（此前硬编码 0 是统计 bug）。 */
  injection: MemoryInjectionService
  getSettings: () => MemorySettings
  putSettings: (next: MemorySettings) => void
  /** 用户身份卡读写（settings 域 memory.profile；常驻注入的动态数据源）。 */
  getProfile: () => MemoryUserProfile
  putProfile: (next: MemoryUserProfile) => void
  native: NativeMemoryStore
  /** 做梦整理服务：状态查询与手动触发入口。 */
  dream: MemoryDreamService
}

/** 确保来源知识库存在（按名称查，缺则建）。 */
function ensureKb(rag: RagService, name: string, source: 'project' | 'mirror', description: string): string {
  const existing = rag.listKbs().find((kb) => kb.name === name)
  if (existing !== undefined) return existing.id
  return rag.createKb(name, { source, description }).id
}

export function makeMemoryRoutes(deps: MemoryRouteDeps): WebRoute[] {
  const { rag, sediment, native, injection, stats, getProfile, putProfile, dream } = deps
  return [
    {
      kind: 'exact', path: '/api/dsh-devforge/memory/profile',
      handler: async (req, res) => {
        if (!guard(req, res)) return
        try {
          if (req.method === 'GET') { writeJson(res, 200, { ok: true, profile: getProfile() }); return }
          if (req.method !== 'PUT') { writeJson(res, 405, { ok: false, error: 'GET/PUT only' }); return }
          const body = await readJsonBody(req)
          if (body === null) { writeJson(res, 400, { ok: false, error: '请求体必须是合法 JSON 对象' }); return }
          // 规整后落盘；section 文本是动态函数，保存即时生效无需重启
          putProfile(normalizeUserProfile(body, getProfile()))
          writeJson(res, 200, { ok: true, profile: getProfile() })
        } catch (error) { writeJson(res, 400, { ok: false, error: (error instanceof Error ? error.message : String(error)).slice(0, 200) }) }
      },
    },
    {
      kind: 'exact', path: '/api/dsh-devforge/memory/native',
      handler: async (req, res) => {
        if (!guard(req, res)) return
        if (req.method !== 'GET') { writeJson(res, 405, { ok: false, error: 'GET only' }); return }
        try { writeJson(res, 200, { ok: true, entries: native.list({ limit: 200 }) }) }
        catch (error) { writeJson(res, 400, { ok: false, error: (error instanceof Error ? error.message : String(error)).slice(0, 200) }) }
      },
    },
    {
      kind: 'exact', path: '/api/dsh-devforge/memory/graph',
      handler: async (req, res) => {
        if (!guard(req, res)) return
        if (req.method !== 'GET') { writeJson(res, 405, { ok: false, error: 'GET only' }); return }
        try { writeJson(res, 200, { ok: true, graph: buildMemoryGraph(native.list({ limit: 200 })) }) }
        catch (error) { writeJson(res, 400, { ok: false, error: (error instanceof Error ? error.message : String(error)).slice(0, 200) }) }
      },
    },
    {
      kind: 'exact', path: '/api/dsh-devforge/memory/search',
      handler: async (req, res) => {
        if (!guard(req, res)) return
        if (req.method !== 'GET') { writeJson(res, 405, { ok: false, error: 'GET only' }); return }
        try { const url = new URL(req.url ?? '', 'http://localhost'); const query = url.searchParams.get('q') ?? ''; const limit = Number(url.searchParams.get('limit') ?? 20); writeJson(res, 200, { ok: true, entries: native.search(query, { limit }) }) }
        catch (error) { writeJson(res, 400, { ok: false, error: (error instanceof Error ? error.message : String(error)).slice(0, 200) }) }
      },
    },
    {
      kind: 'exact', path: '/api/dsh-devforge/memory/save',
      handler: async (req, res) => {
        if (!guard(req, res)) return
        if (req.method !== 'POST') { writeJson(res, 405, { ok: false, error: 'POST only' }); return }
        try { const body = await readJsonBody(req); if (body === null) { writeJson(res, 400, { ok: false, error: '请求体必须是合法 JSON 对象' }); return }; writeJson(res, 200, { ok: true, entry: native.create(body as unknown as NativeMemoryInput) }) }
        catch (error) { writeJson(res, 400, { ok: false, error: (error instanceof Error ? error.message : String(error)).slice(0, 200) }) }
      },
    },
    {
      kind: 'exact', path: '/api/dsh-devforge/memory/update',
      handler: async (req, res) => {
        if (!guard(req, res)) return
        if (req.method !== 'PUT') { writeJson(res, 405, { ok: false, error: 'PUT only' }); return }
        try { const body = await readJsonBody(req); const id = typeof body?.id === 'string' ? body.id : ''; if (body === null || id === '') { writeJson(res, 400, { ok: false, error: 'id 必填且请求体合法' }); return }; const patch = { ...body }; delete patch.id; writeJson(res, 200, { ok: true, entry: native.update(id, patch as NativeMemoryPatch) }) }
        catch (error) { writeJson(res, 400, { ok: false, error: (error instanceof Error ? error.message : String(error)).slice(0, 200) }) }
      },
    },
    {
      kind: 'exact', path: '/api/dsh-devforge/memory/delete',
      handler: async (req, res) => {
        if (!guard(req, res)) return
        if (req.method !== 'DELETE') { writeJson(res, 405, { ok: false, error: 'DELETE only' }); return }
        try { const body = await readJsonBody(req); const id = typeof body?.id === 'string' ? body.id : ''; if (body === null || id === '') { writeJson(res, 400, { ok: false, error: 'id 必填且请求体合法' }); return }; if (!native.delete(id)) { writeJson(res, 404, { ok: false, error: '记忆不存在' }); return }; writeJson(res, 200, { ok: true }) }
        catch (error) { writeJson(res, 400, { ok: false, error: (error instanceof Error ? error.message : String(error)).slice(0, 200) }) }
      },
    },
    {
      kind: 'exact', path: '/api/dsh-devforge/memory/migrate',
      handler: async (req, res) => {
        if (!guard(req, res)) return
        if (req.method !== 'POST') { writeJson(res, 405, { ok: false, error: 'POST only' }); return }
        try { const body = await readJsonBody(req); const items = body?.items; if (body === null || !Array.isArray(items)) { writeJson(res, 400, { ok: false, error: 'items 必须是数组' }); return }; writeJson(res, 200, { ok: true, result: native.migrate(items as NativeMemoryMigrationItem[]) }) }
        catch (error) { writeJson(res, 400, { ok: false, error: (error instanceof Error ? error.message : String(error)).slice(0, 200) }) }
      },
    },
    {
      kind: 'exact', path: '/api/dsh-devforge/memory/migrate/external',
      handler: async (req, res) => {
        if (!guard(req, res)) return
        if (req.method !== 'POST') { writeJson(res, 405, { ok: false, error: 'POST only' }); return }
        try {
          const body = await readJsonBody(req)
          const kind = typeof body?.kind === 'string' ? body.kind : ''
          if (kind !== 'mnemon' && kind !== 'hindsight' && kind !== 'mneme') { writeJson(res, 400, { ok: false, error: 'kind 必须是 mnemon、hindsight 或 mneme' }); return }
          // 采集只读外部数据 → 幂等迁移进内置 memory.entry（重复执行只更新）。
          const items = kind === 'mnemon' ? collectMnemonItems(mnemonDataRoot()) : kind === 'mneme' ? collectMnemeItems(join(dshHome(), 'memory', 'memory.db')) : await collectHindsightItems()
          const result = native.migrate(items)
          writeJson(res, 200, { ok: true, result, status: native.migrationStatus() })
        } catch (error) { writeJson(res, 400, { ok: false, error: (error instanceof Error ? error.message : String(error)).slice(0, 200) }) }
      },
    },
    {
      kind: 'exact', path: '/api/dsh-devforge/memory/migration-status',
      handler: async (req, res) => { if (!guard(req, res)) return; if (req.method !== 'GET') { writeJson(res, 405, { ok: false, error: 'GET only' }); return }; writeJson(res, 200, { ok: true, status: native.migrationStatus() }) },
    },
    {
      // 做梦状态：开关、在途标记与最近 20 条运行审计（面板做梦卡片数据源）。
      kind: 'exact', path: '/api/dsh-devforge/memory/dream',
      handler: async (req, res) => { if (!guard(req, res)) return; if (req.method !== 'GET') { writeJson(res, 405, { ok: false, error: 'GET only' }); return }; writeJson(res, 200, { ok: true, dream: dream.status() }) },
    },
    {
      // 手动触发一轮做梦：异步执行立即返回，结果经 GET /dream 轮询（裁决约需数十秒）。
      kind: 'exact', path: '/api/dsh-devforge/memory/dream/run',
      handler: async (req, res) => {
        if (!guard(req, res)) return
        if (req.method !== 'POST') { writeJson(res, 405, { ok: false, error: 'POST only' }); return }
        try { const result = await dream.triggerNow(); writeJson(res, 200, { ok: result.started, ...result }) }
        catch (error) { writeJson(res, 400, { ok: false, error: (error instanceof Error ? error.message : String(error)).slice(0, 200) }) }
      },
    },
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
              // 记忆总数口径改为主存储真实活跃条数：旧口径读遗留 RAG 文档数，
              // 0.26.4 起 memory.entry 才是唯一事实源，两者会渐行渐远。
              memoryCount: native.activeCount(),
              sedimentCount: stats.read().sedimentTotal,
              sedimentRunCount: sediment.sedimentCount,
              sedimentAttemptCount: sediment.attemptCount,
              sedimentFailureCount: sediment.failureCount,
              sedimentLastError: sediment.lastError,
              injectCount: stats.read().injectTotal,
              injectRunCount: injection.injectCount,
              lastSedimentAt: stats.read().lastSedimentAt,
              lastInjectAt: stats.read().lastInjectAt,
              lastInjectPreview: stats.read().lastInjectPreview,
              injectNoHit: stats.read().injectNoHit,
              dreamTotal: stats.read().dreamTotal,
              lastDreamAt: stats.read().lastDreamAt,
              lastDreamStatus: stats.read().lastDreamStatus,
              lastDreamSummary: stats.read().lastDreamSummary,
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
      path: '/api/dsh-devforge/memory/memories/preview',
      handler: async (req, res) => {
        if (!guard(req, res)) return
        try {
          const id = new URL(req.url ?? '', 'http://localhost').searchParams.get('id') ?? ''
          if (req.method !== 'GET' || id === '') { writeJson(res, id === '' ? 400 : 405, { ok: false, error: id === '' ? 'id 必填' : 'GET only' }); return }
          // 预览取首块前 160 字压空白：让沉淀条目列表显示可读内容而非时间戳文件名
          const chunks = rag.listChunks(id)
          const text = (chunks[0]?.text ?? '').replace(/\s+/gu, ' ').trim().slice(0, 160)
          writeJson(res, 200, { ok: true, text })
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
