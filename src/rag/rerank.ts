/**
 * RAG 重排层 —— 检索召回后的精排。
 *
 * 三种模式（与 rag.settings.rerank.mode 对应）：
 * - zhipu：智谱 rerank API（/api/paas/v4/rerank，model=rerank），语义精排首选；
 * - llm：LLM 打分兜底（注入打分适配器，逐条打 0-10 相关分后重排）；
 * - off：直通（保持混合检索顺序）。
 *
 * 红线：凭据每次请求重新解析；错误一律脱敏，绝不把 Bearer Key 带进异常或日志。
 */
import { RagEmbeddingError, safeEmbeddingError } from './embedder.ts'

/** 单条待重排候选项（只需原文文本，索引由调用方按下标对齐）。 */
export interface RerankCandidate {
  text: string
}

/** 重排器接口：返回按相关性排序后的候选下标数组（只含入选 topN）。 */
export interface Reranker {
  rerank(query: string, candidates: RerankCandidate[], topN: number): Promise<number[]>
}

/** LLM 打分适配器（由接线层注入，测试注入 fake）。 */
export type LlmScoreFn = (system: string, user: string) => Promise<string>

/** 构造智谱 rerank 请求体（导出供单测校验协议形状）。 */
export function buildRerankRequestBody(model: string, query: string, documents: string[], topN: number): string {
  return JSON.stringify({ model, query, documents, top_n: topN })
}

/** 从响应提取排序结果（返回文档下标数组，跳过越界项）。 */
export function parseRerankResponse(payload: unknown, docCount: number): number[] {
  const body = payload as { results?: Array<{ index?: number }> }
  if (!Array.isArray(body.results)) throw new RagEmbeddingError('重排渠道返回格式无效')
  const out: number[] = []
  for (const item of body.results) {
    const index = item.index
    if (typeof index === 'number' && Number.isInteger(index) && index >= 0 && index < docCount) out.push(index)
  }
  return out
}

/** 智谱 rerank 客户端（手写 HTTP，凭据注入式解析）。 */
export class ZhipuReranker implements Reranker {
  private readonly resolveApiKey: () => Promise<string>
  private readonly model: string
  private readonly baseURL: string
  private readonly path: string
  private readonly timeoutMs: number

  constructor(resolveApiKey: () => Promise<string>, options?: { model?: string; baseURL?: string; path?: string; timeoutMs?: number }) {
    this.resolveApiKey = resolveApiKey
    this.model = options?.model ?? 'rerank'
    this.baseURL = options?.baseURL ?? 'https://open.bigmodel.cn'
    this.path = options?.path ?? '/api/paas/v4/rerank'
    this.timeoutMs = options?.timeoutMs ?? 20000
  }

  /** 调用 rerank API；空候选直接短路。 */
  async rerank(query: string, candidates: RerankCandidate[], topN: number): Promise<number[]> {
    if (candidates.length === 0 || topN <= 0) return []
    const apiKey = await this.resolveApiKey()
    let response: Response
    try {
      response = await fetch(this.baseURL + this.path, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
        body: buildRerankRequestBody(this.model, query, candidates.map(item => item.text), Math.min(topN, candidates.length)),
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch (error) {
      throw new RagEmbeddingError('重排渠道请求失败：' + safeEmbeddingError(error))
    }
    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new RagEmbeddingError('重排渠道 HTTP ' + response.status + '：' + safeEmbeddingError(body))
    }
    const payload = (await response.json()) as { error?: { message?: string } }
    if (payload.error?.message !== undefined) throw new RagEmbeddingError('重排渠道拒绝：' + safeEmbeddingError(payload.error.message))
    return parseRerankResponse(payload, candidates.length)
  }
}

/** LLM 打分重排：一次请求对全部候选打分（候选已截断，输入规模可控）。 */
export class LlmReranker implements Reranker {
  private readonly score: LlmScoreFn

  constructor(score: LlmScoreFn) {
    this.score = score
  }

  async rerank(query: string, candidates: RerankCandidate[], topN: number): Promise<number[]> {
    if (candidates.length === 0 || topN <= 0) return []
    const system = '你是检索相关性评估器。只输出 JSON，不要输出任何解释。'
    const lines = candidates.map((item, i) => '#' + i + ': ' + item.text.slice(0, 500).replace(/\s+/gu, ' ')).join('\n')
    const user = '问题：' + query + '\n\n候选（编号 #0..#' + (candidates.length - 1) + '）：\n' + lines + '\n\n请给每条候选输出与问题的相关分（0-10 整数），返回 JSON：{"scores":[{"i":0,"s":3},...]}，必须覆盖全部编号。'
    const raw = await this.score(system, user)
    const scores = new Map<number, number>()
    try {
      const start = raw.indexOf('{')
      const end = raw.lastIndexOf('}')
      const parsed = JSON.parse(start >= 0 && end > start ? raw.slice(start, end + 1) : '{}') as { scores?: Array<{ i?: number; s?: number }> }
      for (const item of parsed.scores ?? []) {
        if (typeof item.i === 'number' && item.i >= 0 && item.i < candidates.length) scores.set(item.i, typeof item.s === 'number' ? item.s : 0)
      }
    } catch {
      return candidates.map((_, i) => i).slice(0, Math.min(topN, candidates.length)) // 解析失败退化为原序
    }
    if (scores.size === 0) return candidates.map((_, i) => i).slice(0, Math.min(topN, candidates.length)) // 无有效打分同样回退原序
    return [...scores.entries()].sort((a, b) => b[1] - a[1]).slice(0, Math.min(topN, candidates.length)).map(([index]) => index)
  }
}
