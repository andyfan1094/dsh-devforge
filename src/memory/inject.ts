/**
 * 会话记忆主动注入 —— agent/pre-step 驱动的每轮首步上下文增强。
 *
 * - 只在 step===1（用户消息刚进来的第一步）注入一次，避免每步重复嵌入计费；
 * - 用最后一条用户消息正文构造查询（见 buildMemoryQuery）→ 在「记忆类知识库」
 *   （source=memory / mirror）做混合检索，双重阈值过滤后以 plugin snapshot 用户消息追加；
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

/** 检索相关性兜底比例：低于「本次最高分 × 该比例」的命中视为弱相关丢弃。
 * 混合检索的分数只代表「话题相近」，尾部低分命中往往只是沾边；用相对线砍掉
 * 长尾，比单靠绝对阈值更能保证注入的记忆与本轮问题强相关。 */
export const RELATIVE_KEEP_RATIO = 0.55

/** 剔除消息文本里的 harness 样板段（导出供单测）：
 * - <system-reminder>…</system-reminder> 整块（技能目录、运行时上下文等）；
 * - 记忆注入段（[记忆中枢自动注入] / [内置长期记忆] 开头的段落）。
 * 这些文本与用户意图无关，混进检索查询会把关键词带偏（例如英文样板词把
 * 一堆含 DSH 的无关记忆全部命中），是「注入不相关」的最大来源。 */
export function stripBoilerplate(text: string): string {
  const withoutReminders = text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/gu, '')
  return withoutReminders
    .split(/\n---\n/)
    .filter((segment) => {
      const head = segment.slice(0, 40)
      return !head.includes('自动注入') && !head.includes('长期记忆')
    })
    .join('\n---\n')
}

/** 从本轮消息构造记忆检索查询（导出供单测）：
 * - 只取最后一条「用户发出的非插件消息」：插件注入的记忆快照不是用户意图；
 * - 先剔除样板段再取前 600 字：用户的问题通常在消息开头，取头部比取整包
 *   尾部更贴近「当前问题」。 */
export function buildMemoryQuery(messages: readonly unknown[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index] as { role?: unknown; source?: unknown } | null
    if (message === null || typeof message !== 'object') continue
    if (message.role !== undefined && message.role !== 'user') continue
    const source = message.source as { kind?: unknown } | null
    if (source !== null && typeof source === 'object' && source.kind === 'plugin') continue
    const cleaned = stripBoilerplate(messageText(message)).trim()
    if (cleaned === '') continue
    return cleaned.slice(0, 600)
  }
  return ''
}

/** 渲染注入快照（导出供单测校验格式与截断）。 */
export function renderMemoryContext(hits: RagSearchHit[], maxChars: number): string {
  if (hits.length === 0) return ''
  const lines: string[] = ['[记忆中枢自动注入] 以下是检索到的历史记忆候选，可能与当前问题无关，请自行取舍（并非当前用户输入）：']
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
  const lines: string[] = ['[内置长期记忆] 以下是检索到的长期记忆候选，可能与当前问题无关，请自行取舍：']
  for (const entry of entries) {
    lines.push('[' + entry.source + ' · ' + entry.category + '] ' + entry.content)
  }
  const text = lines.join('\n---\n')
  return text.length > maxChars ? text.slice(0, maxChars) : text
}

/** 常驻记忆条数上限：与检索注入相互独立，防止常驻层无限膨胀挤占上下文。 */
export const PINNED_MAX_ENTRIES = 6

/** 常驻记忆字符预算（独立于检索注入预算；超出截断最旧条目内容）。 */
export const PINNED_MAX_CHARS = 600

/** 渲染常驻记忆块（每轮固定加载，不参与检索相关性过滤；导出供单测）。
 * 常驻资格由 NativeMemoryStore.listPinned 决定：仅显式钉选（pinned）。
 * 这与用户身份卡同哲学——「每轮必须知道」的红线与长期约定，不能指望检索
 * 每次都召回；也不做 importance 自动常驻（critical 会通膨，会把噪音焊死在每轮）。 */
export function renderPinnedContext(entries: NativeMemoryEntry[], maxChars: number): string {
  if (entries.length === 0) return ''
  const lines: string[] = ['[常驻记忆] 以下是每轮固定加载的记忆（钉选条目，必须遵守）：']
  for (const entry of entries) {
    lines.push('[' + entry.source + ' · ' + entry.category + '] ' + entry.content)
  }
  const text = lines.join('\n')
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
    const query = buildMemoryQuery(messages)
    if (query === '') return { reason: 'no-hit' }
    const kbIds = this.memoryKbIds()
    if (kbIds.length === 0) return { reason: 'no-hit' }
    const hits = await this.rag.search({ query, kbIds, topK: settings.topK, vectorWeight: 0.5 })
    // 双重阈值：绝对线（settings.threshold）兜底，相对线砍掉与本次最高分差距过大的弱命中，
    // 避免话题只是沾边的记忆以低分混进注入块（见 RELATIVE_KEEP_RATIO 注释）。
    const topScore = hits.reduce((max, hit) => Math.max(max, hit.score), 0)
    const floor = Math.max(settings.threshold, 0.01, topScore * RELATIVE_KEEP_RATIO)
    const good = hits.filter((hit) => hit.score >= floor)
    // 常驻记忆：仅显式钉选（pinned），每轮固定注入、独立预算，不参与任何检索
    // 相关性过滤（「每轮必须知道」的内容不能指望检索召回）。
    let pinnedEntries: NativeMemoryEntry[] = []
    try { pinnedEntries = this.native?.listPinned({ limit: PINNED_MAX_ENTRIES }) ?? [] } catch { /* 常驻清单失败不影响检索注入 */ }
    // 内置长期记忆与 RAG 检索并联：两边都取，拼合后统一限长；全部为空才不注入。
    let nativeEntries: NativeMemoryEntry[] = []
    try { nativeEntries = this.native?.search(query, { limit: settings.topK }) ?? [] } catch { /* 内置检索失败不影响 RAG 注入 */ }
    // 检索内置块去重：常驻条目已在常驻块出现，不再重复占用检索块预算。
    if (pinnedEntries.length > 0) {
      const pinnedIds = new Set(pinnedEntries.map((entry) => entry.id))
      nativeEntries = nativeEntries.filter((entry) => !pinnedIds.has(entry.id))
    }
    if (pinnedEntries.length === 0 && good.length === 0 && nativeEntries.length === 0) return { reason: 'no-hit' }
    // 预算分配：常驻块独立预算优先，剩余给 RAG 与检索内置块（保持原统一限长语义）。
    let remaining = settings.maxChars
    const pinnedText = renderPinnedContext(pinnedEntries, Math.min(PINNED_MAX_CHARS, remaining))
    remaining = Math.max(0, remaining - pinnedText.length)
    const ragText = renderMemoryContext(good, remaining)
    remaining = Math.max(0, remaining - ragText.length)
    const nativeText = renderNativeContext(nativeEntries, remaining)
    const combined = [pinnedText, ragText, nativeText].filter((part) => part !== '').join('\n---\n')
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
