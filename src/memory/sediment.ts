/**
 * 会话记忆自动沉淀 —— turn/end 驱动的记忆提炼入库。
 *
 * - 订阅宿主 session/event（turn/end），轮次提交后立即提取该轮不可变窗口入队，
 *   静默期（默认 15s，测试可注入更短值）后把该会话全部未处理窗口合并成
 *   一次提炼（一次模型调用，最多 5 条候选）；
 * - 与库内已有记忆做规范化文本去重（全等或互含），命中即跳过（防重复入库）；
 * - memory.entry（内置长期记忆）为唯一事实源：有内置存储时只写 native，
 *   不再双写 RAG 文档——RAG 副本在整理/更新时不会同步失效，是「旧事实
 *   反复召回」的根因之一；RAG 记忆库仅保留 legacy 兜底路径（无 native 时）。
 * 红线：不落任何凭据；提炼失败只计数，绝不影响会话本身。
 *
 * 0.26.4 修复（记忆系统失效根因，均有回归测试）：
 * 1. 旧实现读取 session.events——宿主公共 API 是 snapshotEvents()，属性不存在
 *    导致提炼定时器每次空转，自动沉淀实际从未执行（生产 lastSedimentAt=0）；
 * 2. 旧实现 60s 防抖期内新轮次不断重置定时器、只提炼最后一轮，活跃会话的
 *    中间轮次永久丢失。现在 turn/end 立即提取窗口入队，不再互相覆盖；
 * 3. 提炼窗口过滤插件/工具来源消息：记忆注入快照绝不能回流成「记忆」，
 *    否则旧事实被改写再入库，形成自我强化回路；
 * 4. 失败可观测：尝试/失败计数与脱敏原因挂在服务实例上，经 status 路由暴露。
 */
import { createHash } from 'node:crypto'
import type { RagService } from '../rag/service.ts'
import type { MemorySettings } from './protocol.ts'
import type { NativeMemoryStore } from './native.ts'
import type { MemoryStatsStore } from './stats.ts'

/** 记忆提炼用的文本生成适配器（接线层用 ctx.llm.stream 实现；测试注入 fake）。 */
export type MemoryGenerateFn = (system: string, user: string) => Promise<string>

/** 提炼候选（模型 JSON 输出）。 */
interface MemoryCandidate {
  content: string
  importance: 'critical' | 'normal' | 'low'
}

/** 从会话事件里读取事件清单：优先宿主公共 API snapshotEvents()，旧版 session.events 兜底。
 * 0.26.4 关键修复：真实 Session 没有 events 属性，旧实现因此永远拿不到事件。 */
export function sessionEventsOf(session: unknown): readonly unknown[] {
  const record = session as { snapshotEvents?: unknown; events?: unknown } | null
  if (record === null || typeof record !== 'object') return []
  if (typeof record.snapshotEvents === 'function') {
    try {
      const events = (record.snapshotEvents as () => readonly unknown[])()
      return Array.isArray(events) ? events : []
    } catch { /* snapshot 异常按空处理，让上层走无事件分支 */ }
  }
  return Array.isArray(record.events) ? record.events : []
}

/** 判断事件来源是否为本插件注入的记忆快照（只有这类消息不是用户意图，不得进入提炼窗口）。
 * 0.26.5 修正：后台任务通知（如 tool-jobs）也是 plugin 来源，但它们承载的正是
 * 「智能体干活」的轮次——干活的总结恰恰来自这些轮次，不能一刀切排除；
 * 只排除本插件的记忆快照，防止旧记忆回流再入库。 */
function isMemorySnapshotSource(data: unknown): boolean {
  const source = (data as { source?: { kind?: unknown; plugin?: unknown } } | undefined)?.source
  if (source === null || typeof source !== 'object') return false
  const record = source as { kind?: unknown; plugin?: unknown }
  return record.kind === 'plugin' && record.plugin === 'dsh-devforge'
}

/** 从会话事件里提取最近一轮的用户/助手文本窗口（导出供单测）。
 * 本插件记忆快照一律排除，防止旧记忆回流；其余 plugin 消息（任务通知等）
 * 作为对话上下文保留——没有真实用户输入的工作轮次同样成立。 */
export function extractLastTurnWindow(events: readonly unknown[], maxChars = 9000): { userText: string; assistantText: string } {
  let lastEnd = -1
  for (let i = events.length - 1; i >= 0; i--) {
    if ((events[i] as { type?: unknown })?.type === 'turn/end') { lastEnd = i; break }
  }
  if (lastEnd < 0) return { userText: '', assistantText: '' }
  let start = 0
  for (let i = lastEnd - 1; i >= 0; i--) {
    if ((events[i] as { type?: unknown })?.type === 'turn/end') { start = i + 1; break }
  }
  const userParts: string[] = []
  const assistantParts: string[] = []
  for (const raw of events.slice(start, lastEnd)) {
    const event = raw as { type?: unknown; data?: unknown }
    const data = event.data as { content?: unknown; message?: unknown } | undefined
    const content = Array.isArray(data?.content) ? data?.content : Array.isArray((data?.message as { content?: unknown })?.content) ? (data?.message as { content: unknown[] }).content : undefined
    if (!Array.isArray(content)) continue
    const text = content.map((block) => {
      const b = block as { type?: unknown; text?: unknown }
      return b?.type === 'text' && typeof b.text === 'string' ? b.text : ''
    }).join('')
    if (text.trim() === '') continue
    if (event.type === 'user/message') {
      if (isMemorySnapshotSource(event.data)) continue
      userParts.push(text)
    }
    else if (event.type === 'assistant/message') assistantParts.push(text)
  }
  return { userText: userParts.join('\n').slice(-maxChars), assistantText: assistantParts.join('\n').slice(0, maxChars) }
}

/** 记忆规范化（去重键）：压空白去首尾。 */
export function normalizeMemoryText(text: string): string {
  return text.replace(/\s+/gu, ' ').trim()
}

/** 强临时状态信号：命中即视为「一次性任务进度」，不沉淀。
 * 这类条目（未提交/未推送/待验收等）很快过期，却会在之后的每轮检索里反复被
 * 命中注入，是「注入不相关」的高发来源；宁可漏存也不存噪音（提示词约束之外的双保险）。 */
const TRANSIENT_STATE_PATTERN = /(未提交|尚未提交|暂未提交|未推送|暂未推送|尚未推送|待验收|稍后继续|下次继续|回头再)/u

/** 提炼静默期默认值：轮次提交后等 15s 无新轮次才提炼（活跃对话合并批处理；
 * 测试经 options.delayMs 注入毫秒级短值）。 */
export const DEFAULT_SEDIMENT_DELAY_MS = 15_000

/** 单会话待处理窗口上限：防止持续失败的会话无限堆积（超出丢最旧）。 */
const MAX_PENDING_WINDOWS = 20

/** 批处理失败后的自动重试上限：超过后保留窗口待下一次 turn/end 自然再试。 */
const MAX_BATCH_RETRIES = 2

/** 已完成但尚未提炼的轮次窗口（turn/end 提交时立即提取的不可变快照）。 */
interface PendingWindow { turn: number; userText: string; assistantText: string }

/** 沉淀服务构造选项（测试注入短静默期）。 */
export interface MemorySedimentOptions { delayMs?: number }

/** 会话记忆沉淀服务。 */
export class MemorySedimentService {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()
  /** 每会话待处理窗口队列 + 重试计数：turn/end 立即入队，静默期后批量提炼。 */
  private readonly pending = new Map<string, { windows: PendingWindow[]; retries: number }>()
  /** 已成功提炼的水位（会话 → 最大轮次）：防止同一轮重复提炼。 */
  private processedTurns = new Map<string, number>()
  private existingKeys: Set<string> | undefined
  sedimentCount = 0
  lastSedimentAt = 0
  /** 本次进程运行期提炼尝试次数（含失败；观测自动沉淀是否真的在跑）。 */
  attemptCount = 0
  /** 本次进程运行期提炼失败次数（模型/解析异常；面板可见）。 */
  failureCount = 0
  /** 最近一次失败原因（脱敏截断；空串 = 无失败）。 */
  lastError = ''
  /** 最近一次提炼批处理的判定结果（stored:N / no-candidates / filtered-or-deduped / window-short / failed），面板可见。 */
  lastOutcome = ''
  private readonly delayMs: number
  private readonly disposers: Array<() => void> = []

  private readonly rag: RagService
  private readonly getKbId: () => string
  private readonly generate: MemoryGenerateFn
  private readonly config: () => MemorySettings
  private readonly native?: NativeMemoryStore
  private readonly stats?: MemoryStatsStore

  constructor(rag: RagService, getKbId: () => string, generate: MemoryGenerateFn, config: () => MemorySettings, native?: NativeMemoryStore, stats?: MemoryStatsStore, options?: MemorySedimentOptions) {
    this.rag = rag
    this.getKbId = getKbId
    this.generate = generate
    this.config = config
    this.native = native
    this.stats = stats
    this.delayMs = Math.max(0, Math.floor(options?.delayMs ?? DEFAULT_SEDIMENT_DELAY_MS))
  }

  /** 挂到宿主上下文（防御式解析 on）；dispose 解除全部监听与待处理定时器。
   * turn/end 提交后事件里就有轮次号：立即提取该轮窗口入队，不再依赖
   * 「定时器触发时再回读会话」——那是旧实现丢轮次与拿不到事件的根源。 */
  attach(ctx: unknown): void {
    try {
      const holder = ctx as { on?: (event: string, listener: (...args: never[]) => unknown) => unknown }
      const off = holder.on?.('session/event', (session: unknown, event: { type?: unknown; data?: unknown }) => {
        if (event?.type !== 'turn/end') return
        const settings = this.config()
        if (!settings.enabled || !settings.autoSediment) return
        const id = this.sessionIdOf(session)
        if (id === undefined) return
        const data = event.data as { turn?: unknown } | undefined
        const turn = typeof data?.turn === 'number' ? data.turn : this.turnOf(session)
        // 轮次提交即快照：此刻事件日志已包含完整一轮，提取结果不可变。
        // 0.26.5：工作轮次常常没有真实用户输入（后台任务通知触发），只要
        // 有实质助手产出就成立——干活的总结正是来自这些轮次。
        const window = extractLastTurnWindow(sessionEventsOf(session))
        if (window.assistantText.trim() === '') return
        this.enqueue(id, turn, window)
      })
      if (typeof off === 'function') this.disposers.push(off as () => void)
    } catch { /* 事件不可用时静默降级为不沉淀 */ }
  }

  dispose(): void {
    for (const dispose of this.disposers) { try { dispose() } catch { /* 忽略 */ } }
    this.disposers.length = 0
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.timers.clear()
    this.pending.clear()
  }

  /** 窗口入队：同轮覆盖（以最终快照为准），单会话窗口数有上限，随后重置静默期定时器。 */
  private enqueue(sessionId: string, turn: number, window: { userText: string; assistantText: string }): void {
    const entry = this.pending.get(sessionId) ?? { windows: [], retries: 0 }
    const existingIndex = entry.windows.findIndex((item) => item.turn === turn)
    const item: PendingWindow = { turn, userText: window.userText, assistantText: window.assistantText }
    if (existingIndex >= 0) entry.windows[existingIndex] = item
    else {
      entry.windows.push(item)
      if (entry.windows.length > MAX_PENDING_WINDOWS) entry.windows.shift()
    }
    this.pending.set(sessionId, entry)
    this.armTimer(sessionId)
  }

  /** 静默期定时器：期内无新轮次才提炼（同会话新轮次会重置，实现批处理合并）。 */
  private armTimer(sessionId: string): void {
    const previous = this.timers.get(sessionId)
    if (previous !== undefined) clearTimeout(previous)
    const timer = setTimeout(() => {
      this.timers.delete(sessionId)
      void this.processSession(sessionId).catch(() => { /* 单会话失败不影响其他会话 */ })
    }, this.delayMs)
    timer.unref?.()
    this.timers.set(sessionId, timer)
  }

  private sessionIdOf(session: unknown): string | undefined {
    const record = session as { id?: unknown } | null
    return record !== null && typeof record === 'object' && typeof record.id === 'string' ? record.id : undefined
  }

  private turnOf(session: unknown): number {
    const events = sessionEventsOf(session)
    const last = events[events.length - 1] as { data?: { turn?: unknown } } | undefined
    return typeof last?.data?.turn === 'number' ? last.data.turn : 0
  }

  /** 处理一个会话的全部待处理窗口（静默期触发；失败按上限重试）。 */
  private async processSession(sessionId: string): Promise<void> {
    const entry = this.pending.get(sessionId)
    if (entry === undefined || entry.windows.length === 0) { this.pending.delete(sessionId); return }
    const settings = this.config()
    if (!settings.enabled || !settings.autoSediment) { this.pending.delete(sessionId); return }
    const maxTurn = entry.windows.reduce((max, item) => Math.max(max, item.turn), 0)
    try {
      await this.runBatch(sessionId, entry.windows, maxTurn)
      this.pending.delete(sessionId)
    } catch (error) {
      // 失败可观测：计数 + 脱敏原因；有界重试，超过上限保留窗口待下次触发。
      entry.retries += 1
      this.failureCount += 1
      this.lastError = (error instanceof Error ? error.message : String(error)).slice(0, 200)
      this.lastOutcome = 'failed'
      if (entry.retries <= MAX_BATCH_RETRIES) this.armTimer(sessionId)
    }
  }

  /** 直接提炼一个会话（兼容旧签名：测试与面板手动触发路径）。
   * 若该会话有待处理窗口则立即批处理，否则从事件现取最近一轮。 */
  async process(session: unknown, sessionId: string, turn: number): Promise<number> {
    if (turn > 0 && this.processedTurns.get(sessionId) === turn) return 0
    const queued = this.pending.get(sessionId)
    if (queued !== undefined && queued.windows.length > 0) {
      const maxTurn = queued.windows.reduce((max, item) => Math.max(max, item.turn), 0)
      const stored = await this.runBatch(sessionId, queued.windows, maxTurn)
      this.pending.delete(sessionId)
      return stored
    }
    const window = extractLastTurnWindow(sessionEventsOf(session))
    if (window.assistantText.trim() === '') return 0
    return this.runBatch(sessionId, [{ turn, userText: window.userText, assistantText: window.assistantText }], turn)
  }

  /** 执行一次提炼批处理（多轮窗口合并为一次模型调用）。失败抛出交调用方计数。
   * 0.26.5：窗口有效性只看助手产出（工作轮次常无新用户输入）；无用户输入时
   * 提示词改用占位说明。每次判定的结果写入 lastOutcome 供面板观测。 */
  private async runBatch(sessionId: string, windows: readonly PendingWindow[], watermarkTurn: number): Promise<number> {
    const settings = this.config()
    if (!settings.enabled || !settings.autoSediment) return 0
    this.attemptCount += 1
    const assistantText = windows.map((item) => item.assistantText).join('\n')
    if (assistantText.trim().length < 50) { this.lastOutcome = 'window-short'; return 0 }
    const dialog = windows.map((item) => (item.userText.trim() !== '' ? '【用户】' + item.userText + '\n【助手】' : '【用户】（本轮无新用户输入，由后台任务/通知触发的智能体工作轮次）\n【助手】') + item.assistantText).join('\n\n')
    const system = '你是记忆管理员。从对话里提炼值得长期保存的记忆条目（用户偏好、项目决策、环境事实、踩坑教训、智能体完成的工作成果）。跳过：寒暄、纯进度播报（「已挂起任务」「等待用户回复」）、问题本身、原始代码、密钥；「工作区有未提交改动、尚未推送、待验收、稍后继续」这类很快过期的临时状态一律不要保存。最多 5 条，每条一句独立中文陈述。只输出 JSON，不输出解释。'
    const user = '对话窗口（共 ' + windows.length + ' 轮）：\n' + dialog + '\n\n返回 JSON：{"items":[{"content":"...","importance":"critical|normal|low"}]}'
    let raw: string
    try { raw = await this.generate(system, user) } catch (error) { throw new Error('提炼模型调用失败：' + (error instanceof Error ? error.message : String(error)).slice(0, 120)) }
    let candidates: MemoryCandidate[] = []
    try {
      const start = raw.indexOf('{')
      const end = raw.lastIndexOf('}')
      const parsed = JSON.parse(start >= 0 && end > start ? raw.slice(start, end + 1) : '{}') as { items?: MemoryCandidate[] }
      candidates = (parsed.items ?? []).filter((item) => typeof item.content === 'string' && normalizeMemoryText(item.content).length >= 6)
    } catch { throw new Error('提炼输出无法解析为 JSON') }
    if (candidates.length === 0) { this.lastOutcome = 'no-candidates'; return 0 }
    const keys = this.existingKeysOf()
    const kbId = this.getKbId()
    let stored = 0
    for (const candidate of candidates.slice(0, 5)) {
      const content = normalizeMemoryText(candidate.content)
      // 临时状态硬过滤：见 TRANSIENT_STATE_PATTERN 注释（提示词约束之外的双保险）。
      if (TRANSIENT_STATE_PATTERN.test(content)) continue
      // 去重键统一为规范化内容：全等或互含都视为重复（旧实现拿内容哈希去对
      // 「含头的切块文本」集合，哈希分支恒不命中，只剩脆弱的互含判断）。
      if (keys.has(content)) continue
      let duplicated = false
      for (const existing of keys) {
        if (existing.includes(content) || content.includes(existing)) { duplicated = true; break }
      }
      if (duplicated) continue
      const importance = candidate.importance === 'critical' || candidate.importance === 'low' ? candidate.importance : 'normal'
      const contentHash = createHash('sha256').update(content).digest('hex')
      try {
        if (this.native !== undefined) {
          // memory.entry 是唯一事实源：只写内置记忆，不再双写 RAG 文档
          // （RAG 副本在整理/归档时不随动，会让旧事实在注入里永生）。
          this.native.migrate([{ content, category: 'general', source: 'session', sourceId: sessionId, importance: importance === 'critical' ? 5 : importance === 'low' ? 2 : 3, migrationKey: 'session:' + sessionId + ':' + watermarkTurn + ':' + contentHash }])
        } else {
          // legacy 兜底：无内置存储时按旧路径写 RAG 记忆库（保持既有数据面兼容）。
          const fileName = 'mem-' + Date.now() + '-' + stored + '.md'
          const text = '重要性: ' + importance + '\n来源会话: ' + sessionId + '\n沉淀时间: ' + new Date().toISOString() + '\n\n' + content
          await this.rag.ingestText(kbId, fileName, text, { source: 'memory' })
        }
        keys.add(content)
        this.existingKeys = undefined // 下次重建
        stored += 1
      } catch { /* 单条失败继续 */ }
    }
    this.processedTurns.set(sessionId, watermarkTurn)
    this.lastOutcome = stored > 0 ? 'stored:' + stored : 'filtered-or-deduped'
    if (stored > 0) {
      this.sedimentCount += stored
      this.lastSedimentAt = Date.now()
      // 持久化累计口径：跨重启与沉淀库总量保持一致，卡片不再自相矛盾。
      this.stats?.update((prev) => ({ ...prev, sedimentTotal: prev.sedimentTotal + stored, lastSedimentAt: this.lastSedimentAt }))
    }
    return stored
  }

  /** 已有记忆的规范化内容键集合（懒加载）：
   * 有内置存储时从 memory.entry 活跃条目构建（真实事实源）；
   * 无内置存储时退回 RAG 记忆库切块（legacy 数据面）。 */
  private existingKeysOf(): Set<string> {
    if (this.existingKeys !== undefined) return this.existingKeys
    const keys = new Set<string>()
    if (this.native !== undefined) {
      for (const entry of this.native.dreamSnapshot(1000)) keys.add(normalizeMemoryText(entry.content))
    } else {
      for (const doc of this.rag.listDocs(this.getKbId())) {
        for (const chunk of this.rag.listChunks(doc.id)) {
          keys.add(normalizeMemoryText(chunk.text))
        }
      }
    }
    this.existingKeys = keys
    return keys
  }
}
