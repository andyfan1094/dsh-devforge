/**
 * RAG 向量化客户端 —— 智谱开放平台 embeddings（/api/paas/v4/embeddings）。
 *
 * 设计要点：
 * - 凭据每次请求重新解析（resolveApiKey 注入，Key 更新无需重启，对齐 minimax 模式）；
 * - 批量自动分片（智谱单请求 input 条数有限制，保守 16 条/批）；
 * - 错误一律脱敏（绝不把 Bearer Key 带进异常或日志）；
 * - vectorKey(model,text) = sha256：embedding 缓存的命中键（防重复计费）。
 */
import { createHash } from 'node:crypto'
import { upstreamRequestHeaders, upstreamResponseText } from '../upstream-fetch.ts'

/** 向量化失败（脱敏后可直接呈现）。 */
export class RagEmbeddingError extends Error {
  readonly status: number
  constructor(message: string, status = 502) {
    super(message)
    this.name = 'RagEmbeddingError'
    this.status = status
  }
}

/** 脱敏错误文本：绝不泄露 Bearer Key。 */
export function safeEmbeddingError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  return raw.replace(/Bearer\s+[^\s]+/gi, 'Bearer [redacted]').slice(0, 300)
}

/** 通用分批纯函数（单测直接验证）。 */
export function makeBatches<T>(items: T[], batchSize: number): T[][] {
  if (batchSize <= 0) throw new Error('batchSize 必须为正数')
  const out: T[][] = []
  for (let i = 0; i < items.length; i += batchSize) out.push(items.slice(i, i + batchSize))
  return out
}

/** 缓存键：模型 + 文本的 sha256（同文本同模型永不重复计费）。 */
export function vectorKey(model: string, text: string): string {
  return createHash('sha256').update(model + '\n' + text).digest('hex')
}

/** 构造请求体（导出供单测校验协议形状）。 */
export function buildRequestBody(model: string, input: string[]): string {
  return JSON.stringify({ model, input })
}

/**
 * OpenAI 兼容 embeddings 客户端（智谱/方舟/OpenAI 中转三渠道共用，凭据与端点注入）。
 * 保留 ZhipuEmbedder 名称兼容既有接线；渠道差异只体现在 baseURL/path/model。
 */
export class ZhipuEmbedder {
  private readonly resolveApiKey: () => Promise<string>
  private readonly defaultModel: string
  private readonly baseURL: string
  /** 动态地址供给（OpenAI 中转站地址面板可改，每次请求重新读取）。 */
  private readonly baseURLProvider?: () => string
  /** embeddings 端点路径（智谱 /api/paas/v4/embeddings，OpenAI 兼容 /embeddings）。 */
  private readonly path: string
  private readonly timeoutMs: number
  private readonly batchSize: number

  constructor(resolveApiKey: () => Promise<string>, options?: { model?: string; baseURL?: string; baseURLProvider?: () => string; path?: string; timeoutMs?: number; batchSize?: number }) {
    this.resolveApiKey = resolveApiKey
    this.defaultModel = options?.model ?? 'embedding-3'
    this.baseURLProvider = options?.baseURLProvider
    this.baseURL = options?.baseURL ?? 'https://open.bigmodel.cn'
    this.path = options?.path ?? '/api/paas/v4/embeddings'
    this.timeoutMs = options?.timeoutMs ?? 30000
    this.batchSize = options?.batchSize ?? 16
  }

  /** 批量向量化：自动分片、按 index 归位、合并返回。model 可覆盖构造默认。 */
  async embed(texts: string[], model?: string): Promise<Float32Array[]> {
    if (texts.length === 0) return []
    const useModel = model ?? this.defaultModel
    const batches = makeBatches(texts, this.batchSize)
    const out: Float32Array[] = new Array(texts.length)
    for (const batch of batches) {
      const vectors = await this.embedBatch(batch, useModel)
      // 单批内顺序即原文顺序（上游按 input 顺序返回）
      for (let i = 0; i < batch.length; i++) out[texts.indexOf(batch[i], 0)] = vectors[i]
    }
    return out
  }

  /** 单条向量化（查询向量的快速路径）。 */
  async embedQuery(text: string, model?: string): Promise<Float32Array> {
    const [vec] = await this.embedBatch([text], model ?? this.defaultModel)
    return vec
  }

  /** 单批请求。 */
  private async embedBatch(batch: string[], model: string): Promise<Float32Array[]> {
    const apiKey = await this.resolveApiKey()
    const target = (this.baseURLProvider?.() ?? '').trim() || this.baseURL
    if (target === '') throw new RagEmbeddingError('尚未配置 OpenAI 中转站地址，请先在天工造梦「Coding Plan」页签填写。', 400)
    let response: Response
    try {
      response = await fetch(target + this.path, {
        method: 'POST',
        headers: upstreamRequestHeaders({ Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' }),
        body: buildRequestBody(model, batch),
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch (error) {
      throw new RagEmbeddingError('向量渠道请求失败：' + safeEmbeddingError(error))
    }
    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new RagEmbeddingError('向量渠道 HTTP ' + response.status + '：' + safeEmbeddingError(body))
    }
    const payload = JSON.parse(await upstreamResponseText(response)) as { data?: Array<{ embedding?: number[]; index?: number }>; error?: { message?: string } }
    if (payload.error?.message !== undefined) {
      throw new RagEmbeddingError('向量渠道拒绝：' + safeEmbeddingError(payload.error.message))
    }
    if (!Array.isArray(payload.data) || payload.data.length !== batch.length) {
      throw new RagEmbeddingError('向量渠道返回条数不符（期望 ' + batch.length + '）')
    }
    return payload.data.map(item => {
      const vec = item.embedding
      if (!Array.isArray(vec) || vec.length === 0) throw new RagEmbeddingError('向量渠道返回向量无效')
      return Float32Array.from(vec)
    })
  }
}
