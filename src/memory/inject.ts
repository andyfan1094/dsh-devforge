/**
 * 会话记忆主动注入 —— agent/pre-step 驱动的每轮首步上下文增强。
 *
 * 0.26.4 重构（记忆失效根因修复，均有回归测试）：
 * - 注入分层：常驻钉选 → 内置词法检索（memory.entry，同步本地扫描）→ RAG
 *   镜像库（可选增强）。旧实现先 await RAG 检索且提前按 KB 存在性短路，
 *   向量/嵌入故障会把常驻硬规则和内置记忆一起拖死；
 * - memory.entry 是唯一事实源：RAG 自动注入只搜 mirror 镜像库（Mnemon/
 *   Hindsight），不再搜 memory 会话记忆库——那份是 0.26.4 前的双写遗留，
 *   与 native 同内容却永不随整理失效，只会重复占用预算；
 * - 注入快照按宿主正式协议标记 form:'snapshot' + sections：声明「后快照
 *   替代前快照」语义，且沉淀窗口据此排除插件消息，阻断旧记忆回流；
 * - 常驻块独立预算（不侵占检索注入预算）；内置条目渲染更新日期，
 *   整条装入预算、绝不截半条。
 */
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { RagSearchHit } from '../rag/protocol.ts'
import type { RagService } from '../rag/service.ts'
import type { MemorySettings, NativeMemoryEntry } from './protocol.ts'
import type { NativeMemoryStore } from './native.ts'
import type { MemoryStatsStore } from './stats.ts'
import { normalizeMemoryText } from './sediment.ts'

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
      return !head.includes('自动注入') && !head.includes('长期记忆') && !head.includes('常驻记忆')
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

/** 条目日期戳（ISO 日期部分；非法时间返回空串）。 */
function entryDateStamp(entry: NativeMemoryEntry): string {
  const date = new Date(entry.updatedAt)
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10)
}

/** 渲染内置记忆条目快照（导出供单测校验格式与预算）：
 * - 每条带更新日期：模型可据此判断时效（旧事实不冒充现状）；
 * - 整条装入预算，装不下整条就停止（绝不截半条——半条比缺条更误导）；
 * - 仅当首条单独超预算时才截断首条，保证有内容可注入。 */
export function renderNativeContext(entries: NativeMemoryEntry[], maxChars: number): string {
  if (entries.length === 0) return ''
  const header = '[内置长期记忆] 以下是检索到的长期记忆候选，可能与当前问题无关，请自行取舍；版本号、路径、发布状态等可变事实以条目日期与实时核验为准：'
  const lines: string[] = [header]
  let used = header.length
  let included = 0
  for (const entry of entries) {
    const stamp = entryDateStamp(entry)
    const line = '[' + (stamp !== '' ? stamp + ' · ' : '') + entry.source + ' · ' + entry.category + '] ' + entry.content
    if (used + line.length + 1 > maxChars && included > 0) break
    lines.push(line)
    used += line.length + 1
    included += 1
  }
  if (included === 0 && entries.length > 0) {
    const stamp = entryDateStamp(entries[0]!)
    const line = '[' + (stamp !== '' ? stamp + ' · ' : '') + entries[0]!.source + ' · ' + entries[0]!.category + '] ' + entries[0]!.content
    lines.push(line.slice(0, Math.max(0, maxChars - header.length)))
  }
  const text = lines.join('\n')
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

  /** RAG 可选增强范围：仅 mirror 镜像库（Mnemon/Hindsight）。
   * memory 会话记忆库已不是事实源（0.26.4 起自动记忆唯一落 memory.entry），
   * 不再参与自动注入：同内容双份只会重复占用预算，且旧文档永不随整理失效。 */
  enhancementKbIds(): string[] {
    return this.rag.listKbs().filter((kb) => kb.source === 'mirror').map((kb) => kb.id)
  }

  /** 兼容旧名：历史调用方语义即「自动注入检索的库清单」。 */
  memoryKbIds(): string[] {
    return this.enhancementKbIds()
  }

  /** 对一次 pre-step 做注入决策，带跳过原因（导出便于单测与可观测统计）。
   * 分层与降级：常驻/内置记忆不依赖 RAG；RAG 镜像增强独立 try——
   * 向量、嵌入或网络故障只损失增强层，绝不拖死硬规则与词法召回。 */
  async decideDetailed(messages: readonly unknown[]): Promise<InjectDecision> {
    const settings = this.config()
    if (!settings.enabled || !settings.autoInject) return { reason: 'disabled' }
    const query = buildMemoryQuery(messages)
    if (query === '') return { reason: 'no-hit' }
    // 1) 常驻钉选最先读：显式钉选是「每轮必须知道」的红线，不依赖任何检索服务。
    let pinnedEntries: NativeMemoryEntry[] = []
    try { pinnedEntries = this.native?.listPinned({ limit: PINNED_MAX_ENTRIES }) ?? [] } catch { /* 常驻清单失败不影响检索注入 */ }
    // 2) 内置词法检索：同步本地扫描 memory.entry，不依赖向量与知识库存在性。
    let nativeEntries: NativeMemoryEntry[] = []
    try { nativeEntries = this.native?.search(query, { limit: settings.topK }) ?? [] } catch { /* 内置检索失败不影响常驻注入 */ }
    // 常驻条目已在常驻块出现，不再重复占用检索块预算。
    if (pinnedEntries.length > 0) {
      const pinnedIds = new Set(pinnedEntries.map((entry) => entry.id))
      nativeEntries = nativeEntries.filter((entry) => !pinnedIds.has(entry.id))
    }
    // 3) RAG 镜像库可选增强：独立 try，失败静默降级为空。
    let good: RagSearchHit[] = []
    try {
      const kbIds = this.enhancementKbIds()
      if (kbIds.length > 0) {
        const hits = await this.rag.search({ query, kbIds, topK: settings.topK, vectorWeight: 0.5 })
        // 双重阈值：绝对线（settings.threshold）兜底，相对线砍掉与本次最高分差距过大的弱命中，
        // 避免话题只是沾边的记忆以低分混进注入块（见 RELATIVE_KEEP_RATIO 注释）。
        const topScore = hits.reduce((max, hit) => Math.max(max, hit.score), 0)
        const floor = Math.max(settings.threshold, 0.01, topScore * RELATIVE_KEEP_RATIO)
        // 与内置记忆按规范化内容去重：同一事实不双份占用预算。
        const nativeNorms = new Set(nativeEntries.map((entry) => normalizeMemoryText(entry.content)))
        good = hits.filter((hit) => hit.score >= floor && !nativeNorms.has(normalizeMemoryText(hit.text)))
      }
    } catch { good = [] /* 镜像增强失败：只损失增强层 */ }
    if (pinnedEntries.length === 0 && good.length === 0 && nativeEntries.length === 0) return { reason: 'no-hit' }
    // 预算：常驻块独立预算优先；检索预算内内置记忆优先、镜像增强兜底
    // （旧实现 RAG 先渲染，长文档会把精确的内置候选挤到零预算）。
    const pinnedText = renderPinnedContext(pinnedEntries, PINNED_MAX_CHARS)
    let remaining = settings.maxChars
    const nativeText = renderNativeContext(nativeEntries, remaining)
    remaining = Math.max(0, remaining - nativeText.length)
    const ragText = renderMemoryContext(good, remaining)
    const combined = [pinnedText, nativeText, ragText].filter((part) => part !== '').join('\n---\n')
    return combined === '' ? { reason: 'no-hit' } : { text: combined }
  }

  /** 旧签名兼容：只取注入文本。 */
  async decide(messages: readonly unknown[]): Promise<string | undefined> {
    return (await this.decideDetailed(messages)).text
  }

  /** 挂到宿主上下文；返回卸载函数。
   * 注入消息按宿主正式协议声明 form:'snapshot' + sections：后快照替代前快照，
   * 且沉淀窗口据此排除插件消息（阻断旧记忆回流再入库）。 */
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
              source: { kind: 'plugin', plugin: 'dsh-devforge', form: 'snapshot', sections: [{ name: 'memory', text }] },
            })],
          }
        } catch { return decision }
      })
      return typeof off === 'function' ? off as () => void : () => {}
    } catch { return () => {} }
  }
}
