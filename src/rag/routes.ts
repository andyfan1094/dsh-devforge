/**
 * RAG 记忆中枢路由 —— /api/dsh-devforge/rag/*（loopback-only，仿主路由族围栏）。
 * 端点：kb 列表/新建/删除、docs 列表/文本入库/文件入库/删除、切块预览、检索、设置。
 */
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isLoopbackRequest } from '../loopback.ts'
import { RagEmbeddingError } from './embedder.ts'
import { RagParserError, parseFile } from './parser.ts'
import type { RagService } from './service.ts'

/** RAG 文档上传体上限（PDF/DOCX 走 base64，放宽到 16MB）。 */
const MAX_BODY = 16 * 1024 * 1024

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

/** 统一错误分类（凭据/解析 400，上游失败 502，消息已脱敏）。 */
function fail(res: import('node:http').ServerResponse, error: unknown): void {
  if (error instanceof RagEmbeddingError || error instanceof RagParserError) {
    writeJson(res, 400, { ok: false, error: error.message })
    return
  }
  const message = error instanceof Error ? error.message : String(error)
  writeJson(res, 502, { ok: false, error: message.slice(0, 200) })
}

export function makeRagRoutes(service: RagService): WebRoute[] {
  return [
    {
      kind: 'exact',
      path: '/api/dsh-devforge/rag/kb',
      handler: async (req, res) => {
        if (!guard(req, res)) return
        try {
          if (req.method === 'GET') { writeJson(res, 200, { ok: true, kbs: service.listKbs() }); return }
          if (req.method === 'POST') {
            const body = await readJsonBody(req)
            const name = typeof body?.name === 'string' && body.name.trim() !== '' ? body.name.trim() : null
            if (name === null || body === null) { writeJson(res, 400, { ok: false, error: 'name 必填' }); return }
            const description = typeof body.description === 'string' ? body.description : undefined
            writeJson(res, 200, { ok: true, kb: service.createKb(name, { description }) })
            return
          }
          writeJson(res, 405, { ok: false, error: 'GET/POST only' })
        } catch (error) { fail(res, error) }
      },
    },
    {
      kind: 'exact',
      path: '/api/dsh-devforge/rag/kb/item',
      handler: async (req, res) => {
        if (!guard(req, res)) return
        try {
          const id = new URL(req.url ?? '', 'http://localhost').searchParams.get('id') ?? ''
          if (id === '') { writeJson(res, 400, { ok: false, error: 'id 必填' }); return }
          if (req.method !== 'DELETE') { writeJson(res, 405, { ok: false, error: 'DELETE only' }); return }
          service.deleteKb(id)
          writeJson(res, 200, { ok: true })
        } catch (error) { fail(res, error) }
      },
    },
    {
      kind: 'exact',
      path: '/api/dsh-devforge/rag/docs',
      handler: async (req, res) => {
        if (!guard(req, res)) return
        try {
          if (req.method === 'GET') {
            const kbId = new URL(req.url ?? '', 'http://localhost').searchParams.get('kbId') ?? undefined
            writeJson(res, 200, { ok: true, docs: service.listDocs(kbId) })
            return
          }
          if (req.method === 'POST') {
            const body = await readJsonBody(req)
            const kbId = typeof body?.kbId === 'string' ? body.kbId : ''
            const fileName = typeof body?.fileName === 'string' ? body.fileName : ''
            const text = typeof body?.text === 'string' ? body.text : ''
            if (kbId === '' || fileName === '' || text === '') { writeJson(res, 400, { ok: false, error: 'kbId/fileName/text 必填' }); return }
            writeJson(res, 200, { ok: true, doc: await service.ingestText(kbId, fileName, text) })
            return
          }
          writeJson(res, 405, { ok: false, error: 'GET/POST only' })
        } catch (error) { fail(res, error) }
      },
    },
    {
      kind: 'exact',
      path: '/api/dsh-devforge/rag/docs/file',
      handler: async (req, res) => {
        if (!guard(req, res)) return
        try {
          if (req.method !== 'POST') { writeJson(res, 405, { ok: false, error: 'POST only' }); return }
          const body = await readJsonBody(req)
          const kbId = typeof body?.kbId === 'string' ? body.kbId : ''
          const fileName = typeof body?.fileName === 'string' ? body.fileName : ''
          const base64 = typeof body?.base64 === 'string' ? body.base64 : ''
          if (kbId === '' || fileName === '' || base64 === '') { writeJson(res, 400, { ok: false, error: 'kbId/fileName/base64 必填' }); return }
          // 二进制落临时文件 → 解析器按扩展名抽取文本 → 直传文本入库 → 清理
          const dir = mkdtempSync(join(tmpdir(), 'rag-upload-'))
          const tempPath = join(dir, fileName.replace(/[/\\\\]/g, '_'))
          try {
            writeFileSync(tempPath, Buffer.from(base64, 'base64'))
            const text = await parseFile(tempPath, fileName)
            writeJson(res, 200, { ok: true, doc: await service.ingestText(kbId, fileName, text) })
          } finally {
            rmSync(dir, { recursive: true, force: true })
          }
        } catch (error) { fail(res, error) }
      },
    },
    {
      kind: 'exact',
      path: '/api/dsh-devforge/rag/docs/item',
      handler: async (req, res) => {
        if (!guard(req, res)) return
        try {
          const id = new URL(req.url ?? '', 'http://localhost').searchParams.get('id') ?? ''
          if (id === '') { writeJson(res, 400, { ok: false, error: 'id 必填' }); return }
          if (req.method !== 'DELETE') { writeJson(res, 405, { ok: false, error: 'DELETE only' }); return }
          service.deleteDoc(id)
          writeJson(res, 200, { ok: true })
        } catch (error) { fail(res, error) }
      },
    },
    {
      kind: 'exact',
      path: '/api/dsh-devforge/rag/chunks/preview',
      handler: async (req, res) => {
        if (!guard(req, res)) return
        try {
          if (req.method !== 'POST') { writeJson(res, 405, { ok: false, error: 'POST only' }); return }
          const body = await readJsonBody(req)
          const text = typeof body?.text === 'string' ? body.text : ''
          if (text === '') { writeJson(res, 400, { ok: false, error: 'text 必填' }); return }
          const options: { maxSize?: number; overlap?: number } = {}
          if (typeof body?.maxSize === 'number' && body.maxSize > 0) options.maxSize = body.maxSize
          if (typeof body?.overlap === 'number' && body.overlap >= 0) options.overlap = body.overlap
          writeJson(res, 200, { ok: true, chunks: service.previewChunks(text, options) })
        } catch (error) { fail(res, error) }
      },
    },
    {
      kind: 'exact',
      path: '/api/dsh-devforge/rag/search',
      handler: async (req, res) => {
        if (!guard(req, res)) return
        try {
          if (req.method !== 'POST') { writeJson(res, 405, { ok: false, error: 'POST only' }); return }
          const body = await readJsonBody(req)
          const query = typeof body?.query === 'string' ? body.query : ''
          if (query === '') { writeJson(res, 400, { ok: false, error: 'query 必填' }); return }
          const request: { kbIds?: string[]; query: string; topK?: number; vectorWeight?: number } = { query }
          if (Array.isArray(body?.kbIds)) request.kbIds = body.kbIds.filter((id): id is string => typeof id === 'string')
          if (typeof body?.topK === 'number' && body.topK > 0) request.topK = Math.floor(body.topK)
          if (typeof body?.vectorWeight === 'number' && body.vectorWeight >= 0 && body.vectorWeight <= 1) request.vectorWeight = body.vectorWeight
          writeJson(res, 200, { ok: true, hits: await service.search(request) })
        } catch (error) { fail(res, error) }
      },
    },
    {
      kind: 'exact',
      path: '/api/dsh-devforge/rag/settings',
      handler: async (req, res) => {
        if (!guard(req, res)) return
        try {
          if (req.method === 'GET') { writeJson(res, 200, { ok: true, settings: service.getSettings() }); return }
          if (req.method === 'PUT') {
            const body = await readJsonBody(req)
            if (body === null) { writeJson(res, 400, { ok: false, error: '请求体无效' }); return }
            // 宽松合并：缺省字段保留现值，保证面板部分保存不炸
            const current = service.getSettings()
            const next = { ...current, ...body } as typeof current
            service.putSettings(next)
            writeJson(res, 200, { ok: true, settings: service.getSettings() })
            return
          }
          writeJson(res, 405, { ok: false, error: 'GET/PUT only' })
        } catch (error) { fail(res, error) }
      },
    },
  ]
}