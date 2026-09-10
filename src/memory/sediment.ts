/**
 * 会话记忆自动沉淀与任务复盘。
 *
 * turn/end 到达时立即把不可变窗口写入持久化待处理域，静默期后批量调用模型。
 * 新版接入 MemoryGovernanceService 时，模型输出只能成为待审核候选；没有治理服务的
 * 旧测试/回滚环境保留 legacy 直写路径。记忆快照自身永不回流进提炼窗口。
 */
import { createHash } from 'node:crypto'
import type { RagService } from '../rag/service.ts'
import type { MemoryGovernanceService } from './governance.ts'
import type { MemorySettings, MemoryEvidence, MemoryScopeContext, NativeMemoryCategory } from './protocol.ts'
import type { NativeMemoryStore } from './native.ts'
import type { MemoryStatsStore } from './stats.ts'

export type MemoryGenerateFn = (system: string, user: string) => Promise<string>

interface ExtractedCandidate {
  content: string
  category?: NativeMemoryCategory
  importance: 'critical' | 'normal' | 'low'
  confidence?: number
  reason?: string
  memoryKey?: string
}

interface ReflectionTask {
  goal?: string
  summary?: string
  outcome?: 'success' | 'partial' | 'failure' | 'unknown'
  lessons?: string[]
  usedMemoryIds?: string[]
}

export function sessionEventsOf(session: unknown): readonly unknown[] {
  const record = session as { snapshotEvents?: unknown; events?: unknown } | null
  if (record === null || typeof record !== 'object') return []
  if (typeof record.snapshotEvents === 'function') {
    try {
      const events = (record.snapshotEvents as () => readonly unknown[])()
      return Array.isArray(events) ? events : []
    } catch { /* snapshot 异常按空处理 */ }
  }
  return Array.isArray(record.events) ? record.events : []
}

function isMemorySnapshotSource(data: unknown): boolean {
  const source = (data as { source?: { kind?: unknown; plugin?: unknown } } | undefined)?.source
  return source !== null && typeof source === 'object' && source.kind === 'plugin' && source.plugin === 'dsh-devforge'
}

function contentText(data: unknown): string {
  const record = data as { content?: unknown; message?: { content?: unknown } } | undefined
  const content = Array.isArray(record?.content) ? record.content : Array.isArray(record?.message?.content) ? record.message.content : []
  return content.map((block) => {
    const value = block as { type?: unknown; text?: unknown }
    return value?.type === 'text' && typeof value.text === 'string' ? value.text : ''
  }).join('')
}

function lastTurnBounds(events: readonly unknown[]): { start: number; end: number } | undefined {
  let end = -1
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if ((events[index] as { type?: unknown })?.type === 'turn/end') { end = index; break }
  }
  if (end < 0) return undefined
  let start = 0
  for (let index = end - 1; index >= 0; index -= 1) {
    if ((events[index] as { type?: unknown })?.type === 'turn/end') { start = index + 1; break }
  }
  return { start, end }
}

/** 提取最近一轮用户/助手文本；插件记忆快照必须排除，其他后台通知保留。 */
export function extractLastTurnWindow(events: readonly unknown[], maxChars = 9000): { userText: string; assistantText: string } {
  const bounds = lastTurnBounds(events)
  if (bounds === undefined) return { userText: '', assistantText: '' }
  const userParts: string[] = []
  const assistantParts: string[] = []
  for (const raw of events.slice(bounds.start, bounds.end)) {
    const event = raw as { type?: unknown; data?: unknown }
    if (isMemorySnapshotSource(event.data)) continue
    const text = contentText(event.data)
    if (text === '') continue
    if (event.type === 'user/message') userParts.push(text)
    else if (event.type === 'assistant/message') assistantParts.push(text)
  }
  return { userText: userParts.join('\n').slice(-maxChars), assistantText: assistantParts.join('\n').slice(-maxChars) }
}

/** 压空白后的内容键，供 legacy 去重与测试复用。 */
export function normalizeMemoryText(text: string): string {
  return text.replace(/\s+/gu, ' ').trim()
}

const TRANSIENT_STATE_PATTERN = /(未提交|尚未提交|暂未提交|未推送|暂未推送|尚未推送|待验收|稍后继续|下次继续|回头再)/u

/** 只有宿主明确报告的中断/失败才算未完成轮次；缺省（unknown）按正常完成处理。
 * 真实宿主的 turn/end 事件往往不带 reason.kind，白名单会让自动沉淀整体失效。 */
const NON_COMPLETED_REASONS = new Set(['aborted', 'error', 'cancelled', 'canceled', 'interrupted', 'timeout', 'failed'])

export function isCompletedReason(reason: string): boolean {
  return !NON_COMPLETED_REASONS.has(reason.toLocaleLowerCase())
}

export const DEFAULT_SEDIMENT_DELAY_MS = 15_000
const MAX_PENDING_WINDOWS = 100
const MAX_BATCH_RETRIES = 2

interface PendingWindow {
  pendingId?: string
  turn: number
  userText: string
  assistantText: string
  completed: boolean
  endReason: string
  scope: MemoryScopeContext
  evidence: MemoryEvidence[]
  toolNames: string[]
  toolSuccesses: number
  toolFailures: number
}

export interface MemorySedimentOptions {
  delayMs?: number
  governance?: MemoryGovernanceService
  scopeOf?: (session: unknown) => MemoryScopeContext
}

/** 从轮次事件构造脱敏证据与工具结果统计。 */
function turnDetails(events: readonly unknown[], sessionId: string, scope: MemoryScopeContext, reason: string): Omit<PendingWindow, 'pendingId' | 'turn'> {
  const bounds = lastTurnBounds(events)
  const window = extractLastTurnWindow(events)
  const evidence: MemoryEvidence[] = []
  const toolNames = new Map<string, string>()
  let toolSuccesses = 0
  let toolFailures = 0
  if (bounds !== undefined) {
    for (const raw of events.slice(bounds.start, bounds.end)) {
      const event = raw as { seq?: unknown; type?: unknown; data?: unknown }
      const data = event.data as Record<string, unknown> | undefined
      if (event.type === 'tool/call') {
        const callId = typeof data?.callId === 'string' ? data.callId : ''
        const name = typeof data?.name === 'string' ? data.name : ''
        if (callId !== '' && name !== '') toolNames.set(callId, name)
      }
      if (event.type === 'user/message') {
        const source = data?.source as { kind?: unknown } | undefined
        if (source?.kind !== 'user') continue
        const quote = normalizeMemoryText(contentText(data)).slice(0, 500)
        const messageId = typeof data?.id === 'string' ? data.id : ''
        if (quote !== '' && messageId !== '') evidence.push({ kind: 'user', quote, sessionId, messageId, ...(typeof event.seq === 'number' ? { eventSeq: event.seq } : {}), digest: createHash('sha256').update(quote).digest('hex'), createdAt: Date.now() })
      }
      if (event.type === 'tool/result') {
        const message = data?.message as { source?: { callId?: unknown } } | undefined
        const callId = typeof message?.source?.callId === 'string' ? message.source.callId : ''
        const quote = normalizeMemoryText(contentText(data)).slice(0, 500)
        const failed = data?.error !== undefined
        if (failed) toolFailures += 1
        else toolSuccesses += 1
        if (quote !== '') evidence.push({ kind: 'tool', quote, sessionId, ...(callId === '' ? {} : { callId }), ...(typeof event.seq === 'number' ? { eventSeq: event.seq } : {}), digest: createHash('sha256').update(quote).digest('hex'), createdAt: Date.now() })
      }
    }
  }
  return { ...window, completed: isCompletedReason(reason), endReason: reason, scope, evidence: evidence.slice(0, 8), toolNames: [...new Set(toolNames.values())].slice(0, 50), toolSuccesses, toolFailures }
}

/** 会话记忆沉淀服务。 */
export class MemorySedimentService {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly pending = new Map<string, { windows: PendingWindow[]; retries: number }>()
  private processedTurns = new Map<string, number>()
  private existingKeys: Set<string> | undefined
  sedimentCount = 0
  lastSedimentAt = 0
  attemptCount = 0
  failureCount = 0
  lastError = ''
  lastOutcome = ''
  private readonly delayMs: number
  private readonly disposers: Array<() => void> = []
  private readonly rag: RagService
  private readonly getKbId: () => string
  private readonly generate: MemoryGenerateFn
  private readonly config: () => MemorySettings
  private readonly native?: NativeMemoryStore
  private readonly stats?: MemoryStatsStore
  private readonly governance?: MemoryGovernanceService
  private readonly scopeOf: (session: unknown) => MemoryScopeContext

  constructor(
    rag: RagService,
    getKbId: () => string,
    generate: MemoryGenerateFn,
    config: () => MemorySettings,
    native?: NativeMemoryStore,
    stats?: MemoryStatsStore,
    options?: MemorySedimentOptions,
  ) {
    this.rag = rag
    this.getKbId = getKbId
    this.generate = generate
    this.config = config
    this.native = native
    this.stats = stats
    this.delayMs = Math.max(0, Math.floor(options?.delayMs ?? DEFAULT_SEDIMENT_DELAY_MS))
    this.governance = options?.governance
    this.scopeOf = options?.scopeOf ?? (() => ({ kind: 'global' }))
  }

  /** 挂载事件并恢复重启前已经落盘的待处理窗口。 */
  attach(ctx: unknown): void {
    try {
      for (const row of this.governance?.listPendingWindows<PendingWindow>() ?? []) {
        const entry = this.pending.get(row.sessionId) ?? { windows: [], retries: 0 }
        entry.windows.push({ ...row.data, pendingId: row.id })
        this.pending.set(row.sessionId, entry)
        this.armTimer(row.sessionId)
      }
      const holder = ctx as { on?: (event: string, listener: (...args: never[]) => unknown) => unknown }
      const off = holder.on?.('session/event', (session: unknown, event: { type?: unknown; data?: unknown }) => {
        if (event?.type !== 'turn/end') return
        const settings = this.config()
        if (!settings.enabled || !settings.autoSediment) return
        const id = this.sessionIdOf(session)
        if (id === undefined) return
        const data = event.data as { turn?: unknown; reason?: { kind?: unknown } } | undefined
        const turn = typeof data?.turn === 'number' ? data.turn : this.turnOf(session)
        const reason = typeof data?.reason?.kind === 'string' ? data.reason.kind : 'unknown'
        const details = turnDetails(sessionEventsOf(session), id, this.scopeOf(session), reason)
        if (details.assistantText.trim() === '') return
        this.enqueue(id, turn, details)
      })
      if (typeof off === 'function') this.disposers.push(off as () => void)
    } catch { /* 事件不可用时不影响主会话 */ }
  }

  dispose(): void {
    for (const dispose of this.disposers) { try { dispose() } catch { /* 忽略 */ } }
    this.disposers.length = 0
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.timers.clear()
    this.pending.clear()
  }

  private enqueue(sessionId: string, turn: number, details: Omit<PendingWindow, 'pendingId' | 'turn'>): void {
    const entry = this.pending.get(sessionId) ?? { windows: [], retries: 0 }
    const pendingId = sessionId + ':' + turn
    const item: PendingWindow = { pendingId, turn, ...details }
    const existingIndex = entry.windows.findIndex((window) => window.turn === turn)
    if (existingIndex >= 0) entry.windows[existingIndex] = item
    else entry.windows.push(item)
    entry.windows.sort((a, b) => a.turn - b.turn)
    if (entry.windows.length > MAX_PENDING_WINDOWS) entry.windows = entry.windows.slice(-MAX_PENDING_WINDOWS)
    this.pending.set(sessionId, entry)
    this.governance?.savePendingWindow(sessionId, item)
    this.armTimer(sessionId)
  }

  private armTimer(sessionId: string): void {
    const previous = this.timers.get(sessionId)
    if (previous !== undefined) clearTimeout(previous)
    const timer = setTimeout(() => {
      this.timers.delete(sessionId)
      void this.processSession(sessionId).catch(() => { /* 失败已在服务内记数 */ })
    }, this.delayMs)
    timer.unref?.()
    this.timers.set(sessionId, timer)
  }

  private sessionIdOf(session: unknown): string | undefined {
    const record = session as { id?: unknown; header?: { id?: unknown } } | null
    if (record === null || typeof record !== 'object') return undefined
    return typeof record.id === 'string' ? record.id : typeof record.header?.id === 'string' ? record.header.id : undefined
  }

  private turnOf(session: unknown): number {
    const events = sessionEventsOf(session)
    const last = events[events.length - 1] as { data?: { turn?: unknown } } | undefined
    return typeof last?.data?.turn === 'number' ? last.data.turn : 0
  }

  /**
   * 整理一条批次的复盘落点：提炼成功时完成轮次已由 runBatch 写详细复盘，这里只补未完成轮次；
   * 提炼彻底失败时全部轮次都要落技术复盘，否则面板「任务复盘」在模型故障期完全空白。
   */
  private recordBatchFallback(sessionId: string, windows: readonly PendingWindow[], watermarkTurn: number, failed: boolean): void {
    const targets = failed ? windows : windows.filter((window) => !window.completed)
    this.recordTechnicalEpisodes(sessionId, targets, watermarkTurn, failed)
  }

  /** 批次失败（含重试用尽）：落技术复盘，让复盘链路不断档；待处理窗口保留，模型恢复后仍能补提炼。 */
  private recordFailedBatch(sessionId: string, windows: readonly PendingWindow[], watermarkTurn: number): void {
    this.recordBatchFallback(sessionId, windows, watermarkTurn, true)
  }

  private async processSession(sessionId: string): Promise<void> {
    const entry = this.pending.get(sessionId)
    if (entry === undefined || entry.windows.length === 0) { this.pending.delete(sessionId); return }
    const settings = this.config()
    if (!settings.enabled || !settings.autoSediment) return
    const maxTurn = entry.windows.reduce((max, item) => Math.max(max, item.turn), 0)
    try {
      await this.runBatch(sessionId, entry.windows, maxTurn)
      this.governance?.deletePendingWindows(entry.windows.map((item) => item.pendingId).filter((id): id is string => id !== undefined))
      this.pending.delete(sessionId)
    } catch (error) {
      entry.retries += 1
      this.failureCount += 1
      this.lastError = (error instanceof Error ? error.message : String(error)).slice(0, 200)
      this.lastOutcome = 'failed'
      if (entry.retries <= MAX_BATCH_RETRIES) this.armTimer(sessionId)
      else this.recordFailedBatch(sessionId, entry.windows, maxTurn)
    }
  }

  /** 兼容测试与面板手动路径；未挂治理服务时维持旧版 active 写入行为。 */
  async process(session: unknown, sessionId: string, turn: number): Promise<number> {
    if (turn > 0 && this.processedTurns.get(sessionId) === turn) return 0
    const queued = this.pending.get(sessionId)
    if (queued !== undefined && queued.windows.length > 0) {
      const maxTurn = queued.windows.reduce((max, item) => Math.max(max, item.turn), 0)
      const stored = await this.runBatch(sessionId, queued.windows, maxTurn)
      this.governance?.deletePendingWindows(queued.windows.map((item) => item.pendingId).filter((id): id is string => id !== undefined))
      this.pending.delete(sessionId)
      return stored
    }
    const events = sessionEventsOf(session)
    const end = [...events].reverse().find((raw) => (raw as { type?: unknown })?.type === 'turn/end') as { data?: { reason?: { kind?: unknown } } } | undefined
    const reason = typeof end?.data?.reason?.kind === 'string' ? end.data.reason.kind : 'completed'
    const details = turnDetails(events, sessionId, this.scopeOf(session), reason)
    if (details.assistantText.trim() === '') return 0
    return this.runBatch(sessionId, [{ turn, ...details }], turn)
  }

  private async runBatch(sessionId: string, windows: readonly PendingWindow[], watermarkTurn: number): Promise<number> {
    const settings = this.config()
    if (!settings.enabled || !settings.autoSediment) return 0
    this.attemptCount += 1
    const eligible = windows.filter((window) => window.completed)
    const assistantText = eligible.map((item) => item.assistantText).join('\n')
    if (assistantText.trim().length < 50) {
      this.recordBatchFallback(sessionId, windows, watermarkTurn, false)
      this.lastOutcome = 'window-short'
      this.processedTurns.set(sessionId, watermarkTurn)
      return 0
    }
    const dialog = eligible.map((item) => (item.userText.trim() !== '' ? '【用户】' + item.userText + '\n【助手】' : '【用户】（本轮无新用户输入，由后台任务/通知触发的智能体工作轮次）\n【助手】') + item.assistantText).join('\n\n')
    const system = [
      '你是记忆提炼员和任务复盘员。提炼结果会自动生效为长期记忆，必须只写对话中真实出现的内容。',
      '从对话中识别长期偏好、稳定决策、环境事实、经工具验证的结果和可复用踩坑经验；跳过寒暄、问题本身、临时进度、待验收/未提交/未推送状态、凭据和原始代码。',
      '每条候选必须有 category、confidence、reason；可变配置或状态必须给稳定 memoryKey，便于发现新旧冲突后自动取代。事实性内容尽量给出证据说明；无证据的推断 confidence 应降低。',
      '同时输出 task 复盘：目标、结果摘要、success/partial/failure/unknown、可复用 lessons、实际使用的 injected memory id。没有证据时 outcome=unknown。',
      '最多 5 条候选，每条一句独立中文陈述。只输出 JSON。',
    ].join('\n')
    const user = '对话窗口（共 ' + eligible.length + ' 轮）：\n' + dialog + '\n\n返回 JSON：{"task":{"goal":"...","summary":"...","outcome":"success|partial|failure|unknown","lessons":["..."],"usedMemoryIds":[]},"items":[{"content":"...","category":"preference|decision|fact|insight|context|general","importance":"critical|normal|low","confidence":0.0,"reason":"证据说明","memoryKey":"可选稳定事实键"}]}'
    let raw: string
    try { raw = await this.generate(system, user) } catch (error) { throw new Error('提炼模型调用失败：' + (error instanceof Error ? error.message : String(error)).slice(0, 120)) }
    let candidates: ExtractedCandidate[] = []
    let task: ReflectionTask = {}
    try {
      const start = raw.indexOf('{')
      const end = raw.lastIndexOf('}')
      const parsed = JSON.parse(start >= 0 && end > start ? raw.slice(start, end + 1) : '{}') as { items?: ExtractedCandidate[]; task?: ReflectionTask }
      candidates = (parsed.items ?? []).filter((item) => typeof item.content === 'string' && normalizeMemoryText(item.content).length >= 6)
      task = parsed.task ?? {}
    } catch { throw new Error('提炼输出无法解析为 JSON') }

    const scope = eligible[eligible.length - 1]?.scope ?? { kind: 'workspace' }
    const evidence = eligible.flatMap((item) => item.evidence).slice(-8)
    const candidateIds: string[] = []
    const keys = this.existingKeysOf()
    const kbId = this.getKbId()
    let stored = 0
    for (const candidate of candidates.slice(0, 5)) {
      const content = normalizeMemoryText(candidate.content)
      if (TRANSIENT_STATE_PATTERN.test(content)) continue
      const importance = candidate.importance === 'critical' || candidate.importance === 'low' ? candidate.importance : 'normal'
      const contentDigest = createHash('sha256').update(content).digest('hex')
      try {
        if (this.governance !== undefined) {
          const input = {
            content,
            category: candidate.category,
            importance: importance === 'critical' ? 5 : importance === 'low' ? 2 : 3,
            confidence: candidate.confidence,
            reason: candidate.reason,
            scope,
            memoryKey: candidate.memoryKey,
            evidence,
            source: 'session-reflection',
            sourceId: 'session:' + sessionId + ':' + watermarkTurn + ':' + contentDigest,
            sessionId,
            turn: watermarkTurn,
          }
          if (settings.autoActivate === false) {
            // 回退：仅创建待审核候选（面板可恢复人工审核工作流）。
            const proposed = this.governance.propose(input)
            candidateIds.push(proposed.id)
            if (proposed.state === 'pending' || proposed.state === 'needs-resolution') stored += 1
            continue
          }
          // 全自动路径（辉哥 2026-09-10 决策）：候选直接激活为活跃记忆，不再停留待审核。
          const auto = this.governance.activateAuto(input)
          candidateIds.push(auto.candidate.id)
          if (auto.entry !== undefined) stored += 1
          continue
        }
        if (keys.has(content) || [...keys].some((existing) => existing.includes(content) || content.includes(existing))) continue
        if (this.native !== undefined) {
          this.native.migrate([{ content, category: candidate.category ?? 'general', source: 'session', sourceId: sessionId, importance: importance === 'critical' ? 5 : importance === 'low' ? 2 : 3, migrationKey: 'session:' + sessionId + ':' + watermarkTurn + ':' + contentDigest }])
        } else {
          const fileName = 'mem-' + Date.now() + '-' + stored + '.md'
          const text = '重要性: ' + importance + '\n来源会话: ' + sessionId + '\n沉淀时间: ' + new Date().toISOString() + '\n\n' + content
          await this.rag.ingestText(kbId, fileName, text, { source: 'memory' })
        }
        keys.add(content)
        this.existingKeys = undefined
        stored += 1
      } catch { /* 单条失败继续，批次其他候选仍可保存 */ }
    }

    if (this.governance !== undefined && settings.autoReflect !== false) {
      const recalls = this.governance.listRecalls(200).filter((trace) => trace.sessionId === sessionId && trace.turn <= watermarkTurn)
      const allowedUsed = new Set(recalls.flatMap((trace) => trace.hits.filter((hit) => hit.included && hit.layer !== 'mirror').map((hit) => hit.entryId)))
      const usedMemoryIds = (Array.isArray(task.usedMemoryIds) ? task.usedMemoryIds : []).filter((id): id is string => typeof id === 'string' && allowedUsed.has(id))
      const injectedMemoryIds = [...allowedUsed]
      const allTools = [...new Set(eligible.flatMap((item) => item.toolNames))]
      this.governance.recordEpisode({
        id: sessionId + ':' + watermarkTurn,
        sessionId,
        turn: watermarkTurn,
        scope,
        goal: normalizeMemoryText(typeof task.goal === 'string' ? task.goal : eligible[0]?.userText ?? '').slice(0, 1000),
        summary: normalizeMemoryText(typeof task.summary === 'string' ? task.summary : assistantText).slice(0, 3000),
        outcome: ['success', 'partial', 'failure'].includes(String(task.outcome)) ? task.outcome as 'success' | 'partial' | 'failure' : 'unknown',
        toolNames: allTools,
        toolSuccesses: eligible.reduce((sum, item) => sum + item.toolSuccesses, 0),
        toolFailures: eligible.reduce((sum, item) => sum + item.toolFailures, 0),
        lessons: Array.isArray(task.lessons) ? task.lessons.filter((item): item is string => typeof item === 'string').map((item) => normalizeMemoryText(item).slice(0, 500)).slice(0, 10) : [],
        candidateIds,
        injectedMemoryIds,
        usedMemoryIds,
        createdAt: Date.now(),
      })
      // 详细复盘已落：只给未完成轮次补技术复盘，避免同一轮次重复记账
      this.recordBatchFallback(sessionId, windows, watermarkTurn, false)
    }

    this.processedTurns.set(sessionId, watermarkTurn)
    this.lastOutcome = stored > 0 ? (this.governance === undefined ? 'stored:' : 'auto-stored:') + stored : candidates.length === 0 ? 'no-candidates' : 'filtered-or-deduped'
    if (stored > 0) {
      this.sedimentCount += stored
      this.lastSedimentAt = Date.now()
      this.stats?.update((prev) => ({ ...prev, sedimentTotal: prev.sedimentTotal + stored, lastSedimentAt: this.lastSedimentAt }))
    }
    return stored
  }

  /** 技术复盘兜底：模型不可用时也按轮次留痕，保证任务复盘链路不断档。 */
  private recordTechnicalEpisodes(sessionId: string, windows: readonly PendingWindow[], watermarkTurn: number, batchFailed: boolean): void {
    if (this.governance === undefined) return
    for (const window of windows) {
      // 完成轮次（含提炼失败兜底）按工具成败判定结果，不给整轮扣失败帽子。
      const toolFailed = window.toolFailures > window.toolSuccesses
      // 整批提炼失败时全部轮次记失败：复盘没提炼出来本身就是一次复盘缺口，面板必须能一眼看出。
      const outcome: 'success' | 'failure' = batchFailed || window.completed !== true || toolFailed ? 'failure' : 'success'
      this.governance.recordEpisode({
        id: sessionId + ':' + window.turn,
        sessionId,
        turn: window.turn,
        scope: window.scope,
        goal: normalizeMemoryText(window.userText).slice(0, 1000),
        summary: normalizeMemoryText(window.assistantText).slice(0, 3000),
        outcome,
        toolNames: window.toolNames,
        toolSuccesses: window.toolSuccesses,
        toolFailures: window.toolFailures,
        lessons: [],
        candidateIds: [],
        injectedMemoryIds: [],
        usedMemoryIds: [],
        createdAt: Date.now(),
      })
    }
    void watermarkTurn
  }

  private existingKeysOf(): Set<string> {
    if (this.existingKeys !== undefined) return this.existingKeys
    const keys = new Set<string>()
    if (this.native !== undefined) {
      for (const entry of this.native.dreamSnapshot(1000)) keys.add(normalizeMemoryText(entry.content))
    } else {
      for (const doc of this.rag.listDocs(this.getKbId())) for (const chunk of this.rag.listChunks(doc.id)) keys.add(normalizeMemoryText(chunk.text))
    }
    this.existingKeys = keys
    return keys
  }
}
