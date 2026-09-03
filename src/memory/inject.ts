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

/** 记忆主动注入服务。 */
export class MemoryInjectionService {
  injectCount = 0

  private readonly rag: RagService
  private readonly config: () => MemorySettings
  private readonly native?: NativeMemoryStore

  constructor(rag: RagService, config: () => MemorySettings, native?: NativeMemoryStore) {
    this.rag = rag
    this.config = config
    this.native = native
  }

  /** 记忆检索范围：memory + mirror 来源知识库（不含手动库，避免噪声）。 */
  memoryKbIds(): string[] {
    return this.rag.listKbs().filter((kb) => kb.source === 'memory' || kb.source === 'mirror').map((kb) => kb.id)
  }

  /** 对一次 pre-step 做注入决策（导出便于单测；正常由 attach 内部调用）。 */
  async decide(messages: readonly unknown[]): Promise<string | undefined> {
    const settings = this.config()
    if (!settings.enabled || !settings.autoInject) return undefined
    const query = messages.map((message) => messageText(message)).join(' ').trim().slice(-600)
    if (query === '') return undefined
    const kbIds = this.memoryKbIds()
    if (kbIds.length === 0) return undefined
    const hits = await this.rag.search({ query, kbIds, topK: settings.topK, vectorWeight: 0.5 })
    const good = hits.filter((hit) => hit.score >= Math.max(settings.threshold, 0.01))
    // 内置长期记忆与 RAG 检索并联：两边都取，拼合后统一限长；全部为空才不注入。
    let nativeEntries: NativeMemoryEntry[] = []
    try { nativeEntries = this.native?.search(query, { limit: settings.topK }) ?? [] } catch { /* 内置检索失败不影响 RAG 注入 */ }
    if (good.length === 0 && nativeEntries.length === 0) return undefined
    const ragText = renderMemoryContext(good, settings.maxChars)
    const nativeText = renderNativeContext(nativeEntries, Math.max(0, settings.maxChars - ragText.length))
    const combined = [ragText, nativeText].filter((part) => part !== '').join('\n---\n')
    return combined === '' ? undefined : combined
  }

  /** 挂到宿主上下文；返回卸载函数。 */
  attach(ctx: unknown): () => void {
    try {
      const holder = ctx as { on?: (event: string, listener: (...args: never[]) => unknown) => unknown }
      const off = holder.on?.('agent/pre-step', async (payload: { messages?: unknown[]; step?: number; signal?: AbortSignal }, next: () => Promise<{ messages?: unknown[] }>) => {
        const decision = await next()
        try {
          if (payload.step !== 1 || payload.signal?.aborted === true) return decision
          const text = await this.decide(Array.isArray(payload.messages) ? payload.messages : [])
          if (text === undefined || text === '') return decision
          this.injectCount += 1
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
