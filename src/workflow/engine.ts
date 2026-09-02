/**
 * RAG 工作流引擎 —— 改写 → 多源检索 → 精排 → 生成 → 自评重试 的可配置管线。
 *
 * - DSL 即 WorkflowNodes：节点可开关可调参，缺省关闭，检索节点必选；
 * - 模型调用走注入的 LlmTextFn（接线层 = ctx.llm.stream + BlockAssembler，
 *   跟随会话默认模型路由；测试注入 fake，零网络）；
 * - 每步计时入 trace；运行历史写 rag.workflow_run（保留最近 50 条）。
 */
import { randomUUID } from 'node:crypto'
import type { RagSearchHit } from '../rag/protocol.ts'
import type { RagService } from '../rag/service.ts'
import type { WorkflowDefinition, WorkflowNodes, WorkflowRunRecord, WorkflowRunResult, WorkflowStepTrace } from './protocol.ts'

/** 文本生成适配器（接线层实现；单测注入 fake）。 */
export type WorkflowLlmFn = (input: { system: string; user: string; maxTokens?: number; provider?: string; model?: string }) => Promise<string>

/** 工作流存储依赖（RagStore 的通用域操作，由 RagService 暴露）。 */
export interface WorkflowStore {
  listDomain(domain: string): Array<{ id: string; data: unknown }>
  putDomain(domain: string, id: string, data: unknown): void
  deleteDomain(domain: string, id: string): void
}

const WORKFLOW_DOMAIN = 'rag.workflow'
const RUN_DOMAIN = 'rag.workflow_run'
const MAX_RUNS = 50
const MAX_CONTEXT_BLOCKS = 6
const CONTEXT_BLOCK_CHARS = 800

/** 提取 JSON 对象（兼容模型输出前后缀）。 */
function parseJsonObject(raw: string): Record<string, unknown> {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) return {}
  try { return JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown> } catch { return {} }
}

/** 合并多路召回：按 chunkId 去重保留最高分。导出供单测。 */
export function mergeHits(results: RagSearchHit[][], topK: number): RagSearchHit[] {
  const byId = new Map<string, RagSearchHit>()
  for (const hits of results) {
    for (const hit of hits) {
      const prev = byId.get(hit.chunkId)
      if (prev === undefined || hit.score > prev.score) byId.set(hit.chunkId, hit)
    }
  }
  return [...byId.values()].sort((a, b) => b.score - a.score).slice(0, Math.max(topK, 1))
}

/** 工作流引擎。 */
export class WorkflowEngine {
  private readonly rag: RagService
  private readonly store: WorkflowStore
  private readonly llm: WorkflowLlmFn

  constructor(rag: RagService, store: WorkflowStore, llm: WorkflowLlmFn) {
    this.rag = rag
    this.store = store
    this.llm = llm
  }

  list(): WorkflowDefinition[] {
    return this.store.listDomain(WORKFLOW_DOMAIN).map((row) => row.data as WorkflowDefinition).sort((a, b) => a.createdAt - b.createdAt)
  }

  save(input: { id?: string; name: string; description?: string; nodes: WorkflowNodes }): WorkflowDefinition {
    const name = input.name.trim()
    if (name === '') throw new Error('工作流名称必填')
    if (!input.nodes || typeof input.nodes.retrieve !== 'object') throw new Error('检索节点必选')
    const existing = input.id !== undefined ? this.list().find((item) => item.id === input.id) : undefined
    const definition: WorkflowDefinition = {
      id: existing?.id ?? randomUUID(),
      name,
      ...(input.description !== undefined ? { description: input.description } : existing?.description !== undefined ? { description: existing.description } : {}),
      nodes: input.nodes,
      createdAt: existing?.createdAt ?? Date.now(),
      updatedAt: Date.now(),
    }
    this.store.putDomain(WORKFLOW_DOMAIN, definition.id, definition)
    return definition
  }

  remove(id: string): boolean {
    const before = this.list().length
    this.store.deleteDomain(WORKFLOW_DOMAIN, id)
    return this.list().length < before
  }

  listRuns(workflowId?: string): WorkflowRunRecord[] {
    const all = this.store.listDomain(RUN_DOMAIN).map((row) => row.data as WorkflowRunRecord)
    const filtered = workflowId === undefined ? all : all.filter((run) => run.workflowId === workflowId)
    return filtered.sort((a, b) => b.createdAt - a.createdAt).slice(0, MAX_RUNS)
  }

  /** 解析目标工作流：显式 id → 命名 → 唯一/首个。 */
  resolve(workflowId?: string): WorkflowDefinition | undefined {
    const all = this.list()
    if (workflowId !== undefined && workflowId !== '') return all.find((item) => item.id === workflowId) ?? all.find((item) => item.name === workflowId)
    return all[0]
  }

  /** 运行一条工作流（无已定义工作流时用全默认节点兜底）。 */
  async run(input: { query: string; workflowId?: string }): Promise<WorkflowRunResult> {
    const query = input.query.trim()
    if (query === '') throw new Error('query 必填')
    const definition = this.resolve(input.workflowId) ?? this.save({ name: '默认工作流', nodes: this.defaultNodes() })
    const steps: WorkflowStepTrace[] = []
    const record = async (name: string, fn: () => Promise<string | undefined>): Promise<void> => {
      const started = Date.now()
      try {
        const detail = await fn()
        steps.push({ name, ms: Date.now() - started, ...(detail !== undefined ? { detail } : {}) })
      } catch (error) {
        steps.push({ name, ms: Date.now() - started, detail: '失败：' + (error instanceof Error ? error.message : String(error)).slice(0, 120) })
        throw error
      }
    }
    let currentQuery = query
    // 1) 查询改写
    const variants: string[] = [query]
    if (definition.nodes.rewrite?.enabled === true) {
      await record('rewrite', async () => {
        const raw = await this.llm({
          system: '你是检索查询改写器。把问题改写为 2-3 个措辞不同的等价检索式（保留专有名词）。只输出 JSON：{"queries":["..."]}',
          user: query,
          maxTokens: 300,
          ...(definition.nodes.generate.provider !== undefined ? { provider: definition.nodes.generate.provider } : {}),
          ...(definition.nodes.generate.model !== undefined ? { model: definition.nodes.generate.model } : {}),
        })
        const parsed = parseJsonObject(raw)
        const list = Array.isArray(parsed.queries) ? parsed.queries.filter((q): q is string => typeof q === 'string' && q.trim() !== '') : []
        variants.length = 0
        variants.push(query, ...list.slice(0, 3))
        return '改写 ' + (list.length) + ' 路'
      })
    }
    // 2) 多源检索（每路并行）
    let hits: RagSearchHit[] = []
    await record('retrieve', async () => {
      const results = await Promise.all(variants.map((variant) => this.rag.search({
        query: variant,
        ...(definition.nodes.retrieve.kbIds !== undefined ? { kbIds: definition.nodes.retrieve.kbIds } : {}),
        topK: definition.nodes.retrieve.topK,
        vectorWeight: definition.nodes.retrieve.vectorWeight,
      })))
      hits = mergeHits(results, Math.max(definition.nodes.retrieve.topK, 8))
      return '召回 ' + hits.length + ' 条'
    })
    // 3) 精排（节点开启且服务可用时由 search 内部已按全局设置精排；此处对多路合并结果再截断）
    if (definition.nodes.rerank?.enabled === true && hits.length > 0) {
      await record('rerank', async () => {
        hits = await this.rag.rerankHits(query, hits, 6)
        return '精排后 ' + hits.length + ' 条'
      })
    }
    if (hits.length === 0) {
      const empty: WorkflowRunResult = { runId: '', answer: '知识库中没有检索到相关材料，无法作答。可先在「记忆中枢」入库文档或项目索引。', sources: [], steps, status: 'ok' }
      return empty
    }
    // 4) 生成（带引用）
    const material = hits.slice(0, MAX_CONTEXT_BLOCKS).map((hit, index) => {
      const source = hit.headingPath !== '' ? hit.fileName + ' · ' + hit.headingPath : hit.fileName
      return '[' + (index + 1) + '] ' + source + '\n' + hit.text.slice(0, CONTEXT_BLOCK_CHARS)
    }).join('\n---\n')
    const genSystem = '你是严谨的知识库问答助手。只依据给定的编号材料回答用户问题；每个关键论断后标注引用编号如 [1]。材料不足以回答时明确说明。用中文。'
    let answer = ''
    const generateOnce = async (warning: string): Promise<void> => {
      answer = await this.llm({
        system: genSystem + warning,
        user: '问题：' + query + '\n\n材料：\n' + material,
        maxTokens: definition.nodes.generate.maxTokens ?? 1200,
        ...(definition.nodes.generate.provider !== undefined ? { provider: definition.nodes.generate.provider } : {}),
        ...(definition.nodes.generate.model !== undefined ? { model: definition.nodes.generate.model } : {}),
      })
    }
    await record('generate', async () => { await generateOnce(''); return undefined })
    // 5) 自评重试
    if (definition.nodes.selfCheck?.enabled === true) {
      const maxRetries = Math.max(0, Math.min(definition.nodes.selfCheck.maxRetries, 2))
      for (let attempt = 0; attempt < maxRetries; attempt++) {
        let grounded = true
        let reason = ''
        await record('selfCheck', async () => {
          const raw = await this.llm({
            system: '你是答案审查器。判断答案是否严格基于材料且引用编号正确。只输出 JSON：{"grounded":true|false,"reason":"..."}',
            user: '材料：\n' + material + '\n\n答案：\n' + answer,
            maxTokens: 300,
          })
          const parsed = parseJsonObject(raw)
          grounded = parsed.grounded !== false
          reason = typeof parsed.reason === 'string' ? parsed.reason.slice(0, 120) : ''
          return grounded ? '通过' : '未过：' + reason
        })
        if (grounded) break
        await record('generate(重试)', async () => { await generateOnce('（注意：上一稿被审查驳回——' + reason + '；必须更严格地只依据材料并正确标注引用。）'); return undefined })
      }
    }
    const runId = randomUUID()
    const sources = hits.slice(0, MAX_CONTEXT_BLOCKS).map((hit) => ({ fileName: hit.fileName, headingPath: hit.headingPath, score: hit.score }))
    const recordData: WorkflowRunRecord = {
      id: runId,
      workflowId: definition.id,
      workflowName: definition.name,
      query,
      answer,
      sources,
      steps,
      status: 'ok',
      createdAt: Date.now(),
    }
    this.putRun(recordData)
    return { runId, answer, sources, steps, status: 'ok' }
  }

  /** 记录一次失败运行（接线层 catch 后调用，保证失败也留痕）。 */
  recordFailure(definitionId: string, definitionName: string, query: string, steps: WorkflowStepTrace[], error: unknown): void {
    this.putRun({
      id: randomUUID(),
      workflowId: definitionId,
      workflowName: definitionName,
      query,
      answer: '',
      sources: [],
      steps,
      status: 'failed',
      error: (error instanceof Error ? error.message : String(error)).slice(0, 200),
      createdAt: Date.now(),
    })
  }

  /** 运行历史入库 + 裁剪（保留最近 MAX_RUNS 条）。 */
  private putRun(record: WorkflowRunRecord): void {
    this.store.putDomain(RUN_DOMAIN, record.id, record)
    const all = this.store.listDomain(RUN_DOMAIN).map((row) => ({ id: row.id, data: row.data as WorkflowRunRecord })).sort((a, b) => b.data.createdAt - a.data.createdAt)
    for (const stale of all.slice(MAX_RUNS)) {
      try { this.store.deleteDomain(RUN_DOMAIN, stale.id) } catch { /* 清理失败不影响主流程 */ }
    }
  }

  /** 默认节点（首个工作流的兜底形态）。 */
  private defaultNodes(): WorkflowNodes {
    return { retrieve: { topK: 8, vectorWeight: 0.5 }, generate: { maxTokens: 1200 }, selfCheck: { enabled: true, maxRetries: 1 } }
  }
}
