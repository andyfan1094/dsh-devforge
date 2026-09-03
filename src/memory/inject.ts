/**
 * 会话记忆主动注入 —— agent/pre-step 驱动的每轮首步上下文增强。
 *
 * - 只在 step===1（用户消息刚进来的第一步）注入一次，避免每步重复嵌入计费；
 * - 用本轮用户消息拼查询 → 在「记忆类知识库」（source=memory / mirror）做混合检索，
 *   阈值过滤后以 plugin snapshot 用户消息追加进本轮（仿 dsh-time-context 模式）；
 * - 任何失败都返回原 decision（绝不阻塞会话），全部调用走 AbortSignal。
 */
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { RagSearchHit } from '../rag/protocol.ts'
import type { RagService } from '../rag/service.ts'
import type { MemorySettings, NativeMemoryEntry } from './protocol.ts'
import type { NativeMemoryStore } from './native.ts'
import type { MemoryStatsStore } from './stats.ts'

/** 从 user 消息内容块提取纯文本（防御式，未知形状返回空串）。 */
export function messageText(message: unknown): string {
  const record = message as { content?: unknown } | null
  if (record === null || typeof record !== 'object' || !Array.isArray(record.content)) return ''
  return record.content.map((block) => {
    const b = block as { type?: unknown; text?: unknown }
    return b?.type === 'text' && typeof b.text === 'string' ? b.text : ''
  }).join('')
}

/** 渲染注入快照（导出供单测校验格式与截断）。 */
export function renderMemoryContext(hits: RagSearchHit[], maxChars: number): string {
  if (hits.length === 0) return ''
  const lines: string[] = ['[记忆中枢自动注入] 以下是与当前问题相关的历史记忆，供参考（并非当前用户输入）：']
  for (const hit of hits) {
    const source = hit.headingPath !== '' ? hit.fileName + ' · ' + hit.headingPath : hit.fileName
    lines.push('[' + source + '] ' + hit.text)
  }
  const text = lines.join('\n---\n')
  return text.length > maxChars ? text.slice(0, maxChars) : text
}

/** 渲染内置记忆条目快照（与 RAG 快照拼接，统一截断）。 */
export function renderNativeContext(entries: NativeMemoryEntry[], maxChars: number): string {
  if (entries.length === 0) return ''
  const lines: string[] = ['[内置长期记忆] 以下是与当前问题相关的长期记忆条目，供参考：']
  for (const entry of entries) {
    lines.push('[' + entry.source + ' · ' + entry.category + '] ' + entry.content)
  }
  const text = lines.join('\n---\n')
  return text.length > maxChars ? text.slice(0, maxChars) : text
}

/** 注入决策明细：text 为空时 reason 说明跳过原因，供可观测统计区分"未启用/无命中"。 */
export interface InjectDecision { text?: string; reason?: 'disabled' | 'no-hit' }

/** 记忆主动注入服务。 */
export class MemoryInjectionService {
  injectCount = 0

  private readonly rag: RagService
  private readonly config: () => MemorySettings
  private readonly native?: NativeMemoryStore
  private readonly stats?: MemoryStatsStore

  constructor(rag: RagService, config: () => MemorySettings, native?: NativeMemoryStore, stats?: MemoryStatsStore) {
    this.rag = rag
    this.config = config
    this.native = native
    this.stats = stats
  }

  /** 记忆检索范围：memory + mirror 来源知识库（不含手动库，避免噪声）。 */
  memoryKbIds(): string[] {
    return this.rag.listKbs().filter((kb) => kb.source === 'memory' || kb.source === 'mirror').map((kb) => kb.id)
  }

  /** 对一次 pre-step 做注入决策，带跳过原因（导出便于单测与可观测统计）。 */
  async decideDetailed(messages: readonly unknown[]): Promise<InjectDecision> {
    const settings = this.config()
    if (!settings.enabled || !settings.autoInject) return { reason: 'disabled' }
    const query = messages.map((message) => messageText(message)).join(' ').trim().slice(-600)
    if (query === '') return { reason: 'no-hit' }
    const kbIds = this.memoryKbIds()
    if (kbIds.length === 0) return { reason: 'no-hit' }
    const hits = await this.rag.search({ query, kbIds, topK: settings.topK, vectorWeight: 0.5 })
    const good = hits.filter((hit) => hit.score >= Math.max(settings.threshold, 0.01))
    // 内置长期记忆与 RAG 检索并联：两边都取，拼合后统一限长；全部为空才不注入。
    let nativeEntries: NativeMemoryEntry[] = []
    try { nativeEntries = this.native?.search(query, { limit: settings.topK }) ?? [] } catch { /* 内置检索失败不影响 RAG 注入 */ }
    if (good.length === 0 && nativeEntries.length === 0) return { reason: 'no-hit' }
    const ragText = renderMemoryContext(good, settings.maxChars)
    const nativeText = renderNativeContext(nativeEntries, Math.max(0, settings.maxChars - ragText.length))
    const combined = [ragText, nativeText].filter((part) => part !== '').join('\n---\n')
    return combined === '' ? { reason: 'no-hit' } : { text: combined }
  }

  /** 旧签名兼容：只取注入文本。 */
  async decide(messages: readonly unknown[]): Promise<string | undefined> {
    return (await this.decideDetailed(messages)).text
  }

  /** 挂到宿主上下文；返回卸载函数。 */
  attach(ctx: unknown): () => void {
    try {
      const holder = ctx as { on?: (event: string, listener: (...args: never[]) => unknown) => unknown }
      const off = holder.on?.('agent/pre-step', async (payload: { messages?: unknown[]; step?: number; signal?: AbortSignal }, next: () => Promise<{ messages?: unknown[] }>) => {
        const decision = await next()
        try {
          if (payload.step !== 1 || payload.signal?.aborted === true) return decision
          const detail = await this.decideDetailed(Array.isArray(payload.messages) ? payload.messages : [])
          if (detail.reason === 'disabled') return decision
          if (detail.text === undefined || detail.text === '') {
            // 触发了但无命中：计入持久化跳过统计，与"功能未启用"可区分。
            this.stats?.update((prev) => ({ ...prev, injectNoHit: prev.injectNoHit + 1 }))
            return decision
          }
          const text = detail.text
          this.injectCount += 1
          // 持久化注入可观测：累计次数 + 最近时间 + 内容预览，面板可一眼确认功能活着。
          this.stats?.update((prev) => ({ ...prev, injectTotal: prev.injectTotal + 1, lastInjectAt: Date.now(), lastInjectPreview: text.slice(0, 120) }))
          return {
            ...decision,
            messages: [...(decision.messages ?? []), createUserMessage({
              content: [{ type: 'text', text }],
              source: { kind: 'plugin', plugin: 'dsh-devforge' },
            })],
          }
        } catch { return decision }
      })
      return typeof off === 'function' ? off as () => void : () => {}
    } catch { return () => {} }
  }
}
