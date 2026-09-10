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
import { createHash, randomUUID } from 'node:crypto'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { RagSearchHit } from '../rag/protocol.ts'
import type { RagService } from '../rag/service.ts'
import type { MemoryRecallTrace, MemoryScopeContext, MemorySettings, NativeMemoryEntry } from './protocol.ts'
import type { MemoryGovernanceService } from './governance.ts'
import type { MemoryRecallService } from './recall.ts'
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
      return !head.includes('自动注入') && !head.includes('长期记忆') && !head.includes('常驻记忆') && !head.includes('项目档案')
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
interface RenderedEntries { text: string; includedIds: Set<string> }

function renderNativeContextDetailed(entries: NativeMemoryEntry[], maxChars: number): RenderedEntries {
  if (entries.length === 0 || maxChars <= 0) return { text: '', includedIds: new Set() }
  const header = '[内置长期记忆] 以下是检索到的长期记忆候选，可能与当前问题无关，请自行取舍；版本号、路径、发布状态等可变事实以条目日期与实时核验为准：'
  const lines: string[] = [header]
  const includedIds = new Set<string>()
  let used = header.length
  for (const entry of entries) {
    const stamp = entryDateStamp(entry)
    const line = '[' + (stamp !== '' ? stamp + ' · ' : '') + entry.source + ' · ' + entry.category + '] ' + entry.content
    if (used + line.length + 1 > maxChars) {
      if (includedIds.size === 0) {
        lines.push(line.slice(0, Math.max(0, maxChars - header.length - 1)))
        includedIds.add(entry.id)
      }
      break
    }
    lines.push(line)
    includedIds.add(entry.id)
    used += line.length + 1
  }
  return { text: lines.join('\n').slice(0, maxChars), includedIds }
}

export function renderNativeContext(entries: NativeMemoryEntry[], maxChars: number): string {
  return renderNativeContextDetailed(entries, maxChars).text
}

/** 常驻记忆条数上限：与检索注入相互独立，防止常驻层无限膨胀挤占上下文。 */
export const PINNED_MAX_ENTRIES = 6

/** 常驻记忆字符预算（独立于检索注入预算）。 */
export const PINNED_MAX_CHARS = 600

/** 项目档案卡字符预算（独立于检索注入预算）：工作目录命中登记项目时，
 * 该项目已沉淀的活跃记忆全量注入，让新会话免于从头探索项目事实。 */
export const PROFILE_MAX_CHARS = 1800

function renderPinnedContextDetailed(entries: NativeMemoryEntry[], maxChars: number): RenderedEntries {
  if (entries.length === 0 || maxChars <= 0) return { text: '', includedIds: new Set() }
  const header = '[常驻记忆] 以下是每轮固定加载的记忆（钉选条目，必须遵守）：'
  const lines: string[] = [header]
  const includedIds = new Set<string>()
  let used = header.length
  for (const entry of entries) {
    const line = '[' + entry.source + ' · ' + entry.category + '] ' + entry.content
    if (used + line.length + 1 > maxChars) {
      if (includedIds.size === 0) {
        lines.push(line.slice(0, Math.max(0, maxChars - header.length - 1)))
        includedIds.add(entry.id)
      }
      break
    }
    lines.push(line)
    includedIds.add(entry.id)
    used += line.length + 1
  }
  return { text: lines.join('\n').slice(0, maxChars), includedIds }
}

/** 渲染常驻记忆块（每轮固定加载，不参与检索相关性过滤；导出供单测）。 */
export function renderPinnedContext(entries: NativeMemoryEntry[], maxChars: number): string {
  return renderPinnedContextDetailed(entries, maxChars).text
}

/** 渲染项目档案卡（导出供单测）：
 * - 工作目录命中登记项目时，该项目全部活跃记忆按更新时间倒序全量装入；
 * - 与检索注入不同，档案卡不参与相关性过滤——项目事实无论本轮话题是什么都要在场；
 * - 整条装入、装不下即停（绝不截半条），钉选条目由常驻层负责、此处剔除防重复。 */
export function renderProjectProfileDetailed(entries: NativeMemoryEntry[], label: string, maxChars: number): RenderedEntries {
  if (entries.length === 0 || maxChars <= 0) return { text: '', includedIds: new Set() }
  const header = '[项目档案] 以下是「' + label + '」已沉淀的项目记忆（全量注入，按更新时间排序，无需重新探索即可直接使用）：'
  const lines: string[] = [header]
  const includedIds = new Set<string>()
  let used = header.length
  for (const entry of entries) {
    if (entry.pinned === true) continue
    const stamp = entryDateStamp(entry)
    const line = '[' + (stamp !== '' ? stamp + ' · ' : '') + entry.category + '] ' + entry.content
    if (used + line.length + 1 > maxChars) break
    lines.push(line)
    includedIds.add(entry.id)
    used += line.length + 1
  }
  return { text: lines.join('\n').slice(0, maxChars), includedIds }
}

/** 渲染项目档案卡文本（导出供单测）。 */
export function renderProjectProfile(entries: NativeMemoryEntry[], label: string, maxChars: number): string {
  return renderProjectProfileDetailed(entries, label, maxChars).text
}

/** 注入决策明细：text 为空时 reason 说明跳过原因；traceId 可关联人工反馈。 */
export interface InjectDecision { text?: string; reason?: 'disabled' | 'no-hit'; traceId?: string }

export interface MemoryInjectionOptions {
  recall?: MemoryRecallService
  governance?: MemoryGovernanceService
  scopeOfAgent?: (agent: unknown) => MemoryScopeContext
}

/** 记忆主动注入服务。 */
export class MemoryInjectionService {
  injectCount = 0
  private readonly rag: RagService
  private readonly config: () => MemorySettings
  private readonly native?: NativeMemoryStore
  private readonly stats?: MemoryStatsStore
  private readonly recall?: MemoryRecallService
  private readonly governance?: MemoryGovernanceService
  private readonly scopeOfAgent: (agent: unknown) => MemoryScopeContext

  constructor(
    rag: RagService,
    config: () => MemorySettings,
    native?: NativeMemoryStore,
    stats?: MemoryStatsStore,
    options?: MemoryInjectionOptions,
  ) {
    this.rag = rag
    this.config = config
    this.native = native
    this.stats = stats
    this.recall = options?.recall
    this.governance = options?.governance
    this.scopeOfAgent = options?.scopeOfAgent ?? (() => ({ kind: 'global' }))
  }

  /** RAG 可选增强范围只包含外部 mirror，遗留 memory RAG 库永不回流。 */
  enhancementKbIds(): string[] {
    return this.rag.listKbs().filter((kb) => kb.source === 'mirror').map((kb) => kb.id)
  }

  memoryKbIds(): string[] { return this.enhancementKbIds() }

  /**
   * 作用域过滤发生在 topK 之前；内置记忆走词法+语义融合，语义或镜像失败只记降级。
   * 每次决策保存逐命中轨迹，后续反馈只能引用真正装入上下文的 entryId。
   */
  async decideDetailed(messages: readonly unknown[], context?: { scope?: MemoryScopeContext; sessionId?: string; turn?: number }): Promise<InjectDecision> {
    const settings = this.config()
    if (!settings.enabled || !settings.autoInject) return { reason: 'disabled' }
    const startedAt = Date.now()
    const query = buildMemoryQuery(messages)
    const scope = context?.scope ?? { kind: 'global' }
    const traceId = randomUUID()
    const trace = (outcome: MemoryRecallTrace['outcome'], hits: MemoryRecallTrace['hits'], degradedLayers: string[]): void => {
      this.governance?.recordRecall({
        id: traceId,
        sessionId: context?.sessionId ?? 'unknown',
        turn: context?.turn ?? 0,
        queryHash: createHash('sha256').update(query).digest('hex'),
        queryPreview: query.replace(/\s+/gu, ' ').slice(0, 160),
        scope,
        latencyMs: Date.now() - startedAt,
        outcome,
        degradedLayers,
        hits,
        createdAt: Date.now(),
      })
    }
    if (query === '') { trace('empty-query', [], []); return { reason: 'no-hit', traceId } }

    const degradedLayers: string[] = []
    let pinnedEntries: NativeMemoryEntry[] = []
    try { pinnedEntries = this.native?.listPinned({ limit: PINNED_MAX_ENTRIES, scope, isolateScope: settings.scopeIsolation !== false }) ?? [] }
    catch (error) { degradedLayers.push('pinned:' + (error instanceof Error ? error.message : String(error)).slice(0, 120)) }

    // 项目档案卡：命中登记项目时该项目活跃记忆全量注入，不参与相关性过滤（钉选走常驻层）。
    let profileEntries: NativeMemoryEntry[] = []
    if (settings.projectProfile !== false && scope.kind === 'project') {
      try {
        profileEntries = (this.native?.list({ limit: 100, scope, isolateScope: settings.scopeIsolation !== false }) ?? []).filter((entry) => entry.pinned !== true)
      } catch (error) { degradedLayers.push('profile:' + (error instanceof Error ? error.message : String(error)).slice(0, 120)) }
    }

    let nativeEntries: NativeMemoryEntry[] = []
    let nativeScores = new Map<string, number>()
    let nativeLayers = new Map<string, 'native' | 'semantic'>()
    try {
      if (this.recall !== undefined) {
        const result = await this.recall.recall({ query, scope, isolateScope: settings.scopeIsolation !== false, semantic: settings.semanticRecall !== false, semanticWeight: settings.semanticWeight ?? 0.35, threshold: settings.threshold, limit: settings.topK })
        degradedLayers.push(...result.degradedLayers)
        nativeEntries = result.hits.map((hit) => hit.entry)
        nativeScores = new Map(result.hits.map((hit) => [hit.entry.id, hit.score]))
        nativeLayers = new Map(result.hits.map((hit) => [hit.entry.id, hit.lexicalScore === 0 && hit.semanticScore > 0 ? 'semantic' as const : 'native' as const]))
      } else {
        const ranked = this.native?.searchDetailed(query, { limit: settings.topK, scope, isolateScope: settings.scopeIsolation !== false }) ?? []
        const topScore = ranked[0]?.score ?? 0
        const floor = Math.max(settings.threshold, topScore * RELATIVE_KEEP_RATIO)
        const hits = ranked.filter((hit) => hit.score >= floor)
        nativeEntries = hits.map((hit) => hit.entry)
        nativeScores = new Map(hits.map((hit) => [hit.entry.id, hit.score]))
        nativeLayers = new Map(hits.map((hit) => [hit.entry.id, 'native' as const]))
      }
    } catch (error) { degradedLayers.push('native:' + (error instanceof Error ? error.message : String(error)).slice(0, 120)) }

    if (pinnedEntries.length > 0) {
      const pinnedIds = new Set(pinnedEntries.map((entry) => entry.id))
      nativeEntries = nativeEntries.filter((entry) => !pinnedIds.has(entry.id))
    }

    let mirrorHits: RagSearchHit[] = []
    try {
      const kbIds = this.enhancementKbIds()
      if (kbIds.length > 0) {
        const hits = await this.rag.search({ query, kbIds, topK: settings.topK, vectorWeight: 0.5 })
        const topScore = hits.reduce((max, hit) => Math.max(max, hit.score), 0)
        const floor = Math.max(settings.threshold, 0.01, topScore * RELATIVE_KEEP_RATIO)
        const nativeNorms = new Set([...pinnedEntries, ...profileEntries, ...nativeEntries].map((entry) => normalizeMemoryText(entry.content)))
        mirrorHits = hits.filter((hit) => hit.score >= floor && !nativeNorms.has(normalizeMemoryText(hit.text)))
      }
    } catch (error) { degradedLayers.push('mirror:' + (error instanceof Error ? error.message : String(error)).slice(0, 120)) }

    if (pinnedEntries.length === 0 && profileEntries.length === 0 && mirrorHits.length === 0 && nativeEntries.length === 0) {
      trace(degradedLayers.length > 0 ? 'degraded' : 'no-hit', [], degradedLayers)
      return { reason: 'no-hit', traceId }
    }

    const pinnedRendered = renderPinnedContextDetailed(pinnedEntries, PINNED_MAX_CHARS)
    const profileRendered = renderProjectProfileDetailed(profileEntries, scope.label ?? scope.id ?? '本项目', PROFILE_MAX_CHARS)
    const profileIds = new Set(profileRendered.includedIds)
    const nativeForRender = nativeEntries.filter((entry) => !profileIds.has(entry.id))
    let remaining = settings.maxChars
    const nativeRendered = renderNativeContextDetailed(nativeForRender, remaining)
    remaining = Math.max(0, remaining - nativeRendered.text.length)
    const ragText = renderMemoryContext(mirrorHits, remaining)
    const combined = [pinnedRendered.text, profileRendered.text, nativeRendered.text, ragText].filter((part) => part !== '').join('\n---\n')
    const hits: MemoryRecallTrace['hits'] = [
      ...pinnedEntries.map((entry) => ({ entryId: entry.id, layer: 'pinned' as const, score: 1, included: pinnedRendered.includedIds.has(entry.id), ...(pinnedRendered.includedIds.has(entry.id) ? {} : { skipReason: 'pinned-budget' }) })),
      ...profileEntries.map((entry) => ({ entryId: entry.id, layer: 'profile' as const, score: 1, included: profileRendered.includedIds.has(entry.id), ...(profileRendered.includedIds.has(entry.id) ? {} : { skipReason: 'profile-budget' }) })),
      ...nativeEntries.map((entry) => ({ entryId: entry.id, layer: nativeLayers.get(entry.id) ?? 'native', score: nativeScores.get(entry.id) ?? 0, included: nativeRendered.includedIds.has(entry.id), ...(profileIds.has(entry.id) ? { skipReason: 'profile-dedup' } : nativeRendered.includedIds.has(entry.id) ? {} : { skipReason: 'native-budget' }) })),
      ...mirrorHits.map((hit) => ({ entryId: hit.chunkId, layer: 'mirror' as const, score: hit.score, included: ragText.includes(hit.text), ...(ragText.includes(hit.text) ? {} : { skipReason: 'mirror-budget' }) })),
    ]
    trace(degradedLayers.length > 0 ? 'degraded' : 'hit', hits, degradedLayers)
    return combined === '' ? { reason: 'no-hit', traceId } : { text: combined, traceId }
  }

  async decide(messages: readonly unknown[]): Promise<string | undefined> {
    return (await this.decideDetailed(messages)).text
  }

  /** pre-step 首步解析真实会话作用域并追加 snapshot；traceId 放入独立 section 供审计关联。 */
  attach(ctx: unknown): () => void {
    try {
      const holder = ctx as { on?: (event: string, listener: (...args: never[]) => unknown) => unknown }
      const off = holder.on?.('agent/pre-step', async (payload: { agent?: unknown; messages?: unknown[]; turn?: number; step?: number; signal?: AbortSignal }, next: () => Promise<{ messages?: unknown[] }>) => {
        const decision = await next()
        try {
          if (payload.step !== 1 || payload.signal?.aborted === true) return decision
          const agent = payload.agent as { session?: { id?: unknown; header?: { id?: unknown } } } | undefined
          const sessionId = typeof agent?.session?.id === 'string' ? agent.session.id : typeof agent?.session?.header?.id === 'string' ? agent.session.header.id : 'unknown'
          const detail = await this.decideDetailed(Array.isArray(payload.messages) ? payload.messages : [], { scope: this.scopeOfAgent(payload.agent), sessionId, turn: payload.turn ?? 0 })
          if (detail.reason === 'disabled') return decision
          if (detail.text === undefined || detail.text === '') {
            this.stats?.update((prev) => ({ ...prev, injectNoHit: prev.injectNoHit + 1 }))
            return decision
          }
          const text = detail.text
          this.injectCount += 1
          this.stats?.update((prev) => ({ ...prev, injectTotal: prev.injectTotal + 1, lastInjectAt: Date.now(), lastInjectPreview: text.slice(0, 120) }))
          const sections = [{ name: 'memory', text }, ...(detail.traceId === undefined ? [] : [{ name: 'memory-recall-id', text: detail.traceId }])]
          return {
            ...decision,
            messages: [...(decision.messages ?? []), createUserMessage({
              content: [{ type: 'text', text }],
              source: { kind: 'plugin', plugin: 'dsh-devforge', form: 'snapshot', sections },
            })],
          }
        } catch { return decision }
      })
      return typeof off === 'function' ? off as () => void : () => {}
    } catch { return () => {} }
  }
}
