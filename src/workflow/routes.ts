/**
 * 工作流路由 —— /api/dsh-devforge/rag/workflows/*（loopback-only）。
 * 端点：列表/保存/删除/运行/运行历史。
 */
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { isLoopbackRequest } from '../loopback.ts'
import type { WorkflowEngine } from './engine.ts'
import type { WorkflowNodes } from './protocol.ts'

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

/** 宽松解析节点集合（缺省字段回退，防面板部分保存炸掉）。 */
export function parseWorkflowNodes(raw: unknown): WorkflowNodes | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const node = raw as Record<string, unknown>
  const retrieve = node.retrieve as { topK?: unknown; vectorWeight?: unknown; kbIds?: unknown } | undefined
  if (retrieve === undefined) return undefined
  const rewrite = node.rewrite as { enabled?: unknown } | undefined
  const rerank = node.rerank as { enabled?: unknown } | undefined
  const generate = node.generate as { provider?: unknown; model?: unknown; maxTokens?: unknown } | undefined
  const selfCheck = node.selfCheck as { enabled?: unknown; maxRetries?: unknown } | undefined
  return {
    ...(rewrite !== undefined ? { rewrite: { enabled: rewrite.enabled === true } } : {}),
    retrieve: {
      ...(Array.isArray(retrieve.kbIds) ? { kbIds: retrieve.kbIds.filter((id): id is string => typeof id === 'string') } : {}),
      topK: typeof retrieve.topK === 'number' && retrieve.topK > 0 ? Math.floor(retrieve.topK) : 8,
      vectorWeight: typeof retrieve.vectorWeight === 'number' && retrieve.vectorWeight >= 0 && retrieve.vectorWeight <= 1 ? retrieve.vectorWeight : 0.5,
    },
    ...(rerank !== undefined ? { rerank: { enabled: rerank.enabled === true } } : {}),
    generate: {
      ...(typeof generate?.provider === 'string' && generate.provider !== '' ? { provider: generate.provider } : {}),
      ...(typeof generate?.model === 'string' && generate.model !== '' ? { model: generate.model } : {}),
      ...(typeof generate?.maxTokens === 'number' && generate.maxTokens > 0 ? { maxTokens: Math.floor(generate.maxTokens) } : {}),
    },
    ...(selfCheck !== undefined ? { selfCheck: { enabled: selfCheck.enabled === true, maxRetries: typeof selfCheck.maxRetries === 'number' ? Math.floor(selfCheck.maxRetries) : 1 } } : {}),
  }
}

export function makeWorkflowRoutes(engine: WorkflowEngine): WebRoute[] {
  return [
    {
      kind: 'exact',
      path: '/api/dsh-devforge/rag/workflows',
      handler: async (req, res) => {
        if (!guard(req, res)) return
        try {
          if (req.method === 'GET') { writeJson(res, 200, { ok: true, workflows: engine.list() }); return }
          if (req.method === 'POST') {
            const body = await readJsonBody(req)
            const name = typeof body?.name === 'string' ? body.name : ''
            const nodes = parseWorkflowNodes(body?.nodes)
            if (name.trim() === '' || nodes === undefined) { writeJson(res, 400, { ok: false, error: 'name 与 nodes.retrieve 必填' }); return }
            const workflow = engine.save({
              ...(typeof body?.id === 'string' && body.id !== '' ? { id: body.id } : {}),
              name,
              ...(typeof body?.description === 'string' ? { description: body.description } : {}),
              nodes,
            })
            writeJson(res, 200, { ok: true, workflow })
            return
          }
          writeJson(res, 405, { ok: false, error: 'GET/POST only' })
        } catch (error) { writeJson(res, 400, { ok: false, error: (error instanceof Error ? error.message : String(error)).slice(0, 200) }) }
      },
    },
    {
      kind: 'exact',
      path: '/api/dsh-devforge/rag/workflows/item',
      handler: async (req, res) => {
        if (!guard(req, res)) return
        try {
          const id = new URL(req.url ?? '', 'http://localhost').searchParams.get('id') ?? ''
          if (req.method !== 'DELETE' || id === '') { writeJson(res, id === '' ? 400 : 405, { ok: false, error: id === '' ? 'id 必填' : 'DELETE only' }); return }
          writeJson(res, 200, { ok: engine.remove(id) })
        } catch (error) { writeJson(res, 400, { ok: false, error: (error instanceof Error ? error.message : String(error)).slice(0, 200) }) }
      },
    },
    {
      kind: 'exact',
      path: '/api/dsh-devforge/rag/workflows/run',
      handler: async (req, res) => {
        if (!guard(req, res)) return
        try {
          if (req.method !== 'POST') { writeJson(res, 405, { ok: false, error: 'POST only' }); return }
          const body = await readJsonBody(req)
          const query = typeof body?.query === 'string' ? body.query : ''
          if (query.trim() === '') { writeJson(res, 400, { ok: false, error: 'query 必填' }); return }
          const result = await engine.run({ query, ...(typeof body?.workflowId === 'string' && body.workflowId !== '' ? { workflowId: body.workflowId } : {}) })
          writeJson(res, 200, { ok: true, result })
        } catch (error) { writeJson(res, 502, { ok: false, error: (error instanceof Error ? error.message : String(error)).slice(0, 200) }) }
      },
    },
    {
      kind: 'exact',
      path: '/api/dsh-devforge/rag/workflows/runs',
      handler: async (req, res) => {
        if (!guard(req, res)) return
        try {
          if (req.method !== 'GET') { writeJson(res, 405, { ok: false, error: 'GET only' }); return }
          const workflowId = new URL(req.url ?? '', 'http://localhost').searchParams.get('workflowId') ?? undefined
          writeJson(res, 200, { ok: true, runs: engine.listRuns(workflowId === '' ? undefined : workflowId) })
        } catch (error) { writeJson(res, 400, { ok: false, error: (error instanceof Error ? error.message : String(error)).slice(0, 200) }) }
      },
    },
  ]
}
