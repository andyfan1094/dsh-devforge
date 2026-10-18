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
import { appendProjectFact } from '../projects/store.ts'
import { isDevforgeSource } from '../session-source.ts'

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
  // 兼容三种形态：新 kind（'dsh-devforge'）、v3→v4 迁移产物（'plugin:dsh-devforge'）、
  // 未迁移的 v3 写法（kind='plugin' + plugin='dsh-devforge'）。
  return isDevforgeSource((data as { source?: unknown } | undefined)?.source)
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

/** 宿主系统提示注入的来源：它们被投递成 user/message，但不是用户说的话。
 *  进窗口只会把系统文本当成用户提问，并借尾部截断把真实提问挤出
 *  （生产实况：skill-catalog 171 条 + agent-instructions 15 条）。
 *  这里用精确黑名单而非「只收 user」白名单：后台通知（plugin）、子代理回报、
 *  目标触发等轮次同样要能沉淀——干活的轮次正是那种形状，不能一刀切误杀。 */
const INJECTED_USER_MESSAGE_SOURCES = new Set(['skill-catalog', 'agent-instructions'])

function isUserAuthoredMessage(data: unknown): boolean {
  const source = (data as { source?: { kind?: unknown } } | undefined)?.source
  const kind = source !== null && typeof source === 'object' ? source.kind : undefined
  return kind === undefined || !INJECTED_USER_MESSAGE_SOURCES.has(String(kind))
}

/** 提取最近一轮用户/助手文本；插件记忆快照与系统提示注入必须排除，后台通知保留。 */
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
    if (event.type === 'user/message') {
      if (!isUserAuthoredMessage(event.data)) continue
      userParts.push(text)
    } else if (event.type === 'assistant/message') assistantParts.push(text)
  }
  return { userText: userParts.join('\n').slice(-maxChars), assistantText: assistantParts.join('\n').slice(-maxChars) }
}

/** 压空白后的内容键，供 legacy 去重与测试复用。 */
export function normalizeMemoryText(text: string): string {
  return text.replace(/\s+/gu, ' ').trim()
}

/**
 * 证据引文长度上限（0.51.0）。
 *
 * 原为 500 字，等于把工具结果原文整段永久存进 memory.meta。生产实测：evidence 字段占
 * memory.meta 15.23 MB 里的 13.04 MB（86%），长引文 13584 个实例去重后只有 2591 种唯一文本，
 * 同一段被重复存了 121 次。证据的用途是「回读核对来源」，200 字足够定位，不需要全文。
 */
const EVIDENCE_QUOTE_LIMIT = 200

/** 临时进度/未交付状态不入记忆：这类内容下一轮就失效，留下只会污染召回。 */
const TRANSIENT_STATE_PATTERN = /(未提交|尚未提交|暂未提交|未推送|暂未推送|尚未推送|待验收|稍后继续|下次继续|回头再)/u

/**
 * 任务过程播报过滤器（0.51.0）。
 *
 * 生产实测：4871 条活跃记忆里约四分之一的低价值条目属于两类——
 * ① 带任务编号与行号的完成宣告（“P2 hero 四件套已并入 renderInstallCmds 数组（L133-134）”）
 * ② 一次性验收数字（“679/679 测试通过”“38.8 秒耗时 9 项 passed”）
 * 这类内容对以后的决策没有任何指导意义，却会被召回注入上下文。光靠提示词约束不可靠，
 * 这里做机械兜底；提示词侧同步加了禁令（见 runBatch 的 system 文案）。
 */
const PROCESS_BROADCAST_PATTERNS: readonly RegExp[] = [
  // 任务编号 + 完成动作 + 代码行号：典型开发过程播报
  /\bP[0-4]\b[^。；\n]{0,40}(已修复|已改为|已完成|已并入|已派单|已上线|已落地)/u,
  // 任务编号与行号同时出现（覆盖「已从…改为…」这类不含固定动词的句式）
  /\bP[0-4]\b[^。；\n]{0,100}\bL\d+/u,
  // 完成动作 + 具体行号区间（L133-134 / L271-278）
  /(已修复|已改为|已并入|已新增|已从)[^。；\n]{0,60}\bL\d+\s*[-–~]\s*\d+/u,
  // N/N 测试通过、全部通过等一次性验收数字
  /\b\d{2,}\s*\/\s*\d{2,}\s*(测试|单测|用例)?\s*(全部)?(通过|green|passed)/iu,
  // 单次耗时的性能播报
  /(耗时|用时)\s*\d+(\.\d+)?\s*(秒|s|毫秒|ms)[^。；\n]{0,20}(通过|完成|稳定)/u,
]

/**
 * 判断一条候选是否属于低价值内容（临时状态 / 任务过程播报 / 一次性验收数字）。
 * 抽成导出函数便于单测直接锁定拦截规则，也避免 runBatch 里堆两处判断。
 */
export function isLowValueMemory(content: string): boolean {
  if (TRANSIENT_STATE_PATTERN.test(content)) return true
  return PROCESS_BROADCAST_PATTERNS.some((pattern) => pattern.test(content))
}

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
        const quote = normalizeMemoryText(contentText(data)).slice(0, EVIDENCE_QUOTE_LIMIT)
        const messageId = typeof data?.id === 'string' ? data.id : ''
        if (quote !== '' && messageId !== '') evidence.push({ kind: 'user', quote, sessionId, messageId, ...(typeof event.seq === 'number' ? { eventSeq: event.seq } : {}), digest: createHash('sha256').update(quote).digest('hex'), createdAt: Date.now() })
      }
      if (event.type === 'tool/result') {
        const message = data?.message as { source?: { callId?: unknown } } | undefined
        const callId = typeof message?.source?.callId === 'string' ? message.source.callId : ''
        const quote = normalizeMemoryText(contentText(data)).slice(0, EVIDENCE_QUOTE_LIMIT)
        const failed = data?.error !== undefined
        if (failed) toolFailures += 1
        else toolSuccesses += 1
        if (quote !== '') evidence.push({ kind: 'tool', quote, sessionId, ...(callId === '' ? {} : { callId }), ...(typeof event.seq === 'number' ? { eventSeq: event.seq } : {}), digest: createHash('sha256').update(quote).digest('hex'), createdAt: Date.now() })
      }
    }
  }
  // 同一轮的工具输出常被重复读出（同一文件读两次、同一查询跑两遍），按 digest 去重后再截断，
  // 避免把重复文本当作多条「独立证据」写进记忆。
  return { ...window, completed: isCompletedReason(reason), endReason: reason, scope, evidence: dedupeEvidence(evidence).slice(0, 8), toolNames: [...new Set(toolNames.values())].slice(0, 50), toolSuccesses, toolFailures }
}

/**
 * 按 digest（缺省退回 quote 文本）去重证据数组，保留首次出现的位置。
 * 0.51.0：证据此前从不跨条去重，同一段工具输出被复制到多条记忆，最大重复 121 次。
 */
export function dedupeEvidence(items: readonly MemoryEvidence[]): MemoryEvidence[] {
  const seen = new Set<string>()
  const out: MemoryEvidence[] = []
  for (const item of items) {
    const quote = typeof item.quote === 'string' ? item.quote : ''
    const key = typeof item.digest === 'string' && item.digest !== '' ? item.digest : createHash('sha256').update(quote).digest('hex')
    if (seen.has(key)) continue
    seen.add(key)
    out.push(item)
  }
  return out
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
      '禁止写任务过程播报：不要记录「P1/P2/P3 已修复」「已改为」「已并入」「已上线」这类完成宣告，也不要带代码行号（L133-134）；这类内容任务结束后就失去意义。',
      '禁止写一次性验收数字：不要记录「679/679 测试通过」「耗时 38.8 秒」「某次包体 42401 字节」这类只对当时有效的数字。',
      '禁止写会立刻过期的状态快照：不要记录「当前均为最新版本」「当前配置为空」「版本 0.41.3 已生效」这类时点状态；要写就写可长期成立的机制或约定。',
      '只写对以后再遇到同类问题仍有指导意义的内容：规则、机制、根因、教训、参数用法。宁少勿滥。',
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
    // 跨窗口合并后再去重：同一批多轮里重复出现的工具输出只保留一份。
    const evidence = dedupeEvidence(eligible.flatMap((item) => item.evidence)).slice(-8)
    const candidateIds: string[] = []
    const keys = this.existingKeysOf()
    const kbId = this.getKbId()
    let stored = 0
    for (const candidate of candidates.slice(0, 5)) {
      const content = normalizeMemoryText(candidate.content)
      // 临时状态 + 任务过程播报/一次性验收数字：机械兜底拦截，不依赖模型遵守提示词。
      if (isLowValueMemory(content)) continue
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
    // 项目经验回流（0.34.19）：智能体自我进化闭环的最后一环——
    // 反思产出的「可复用教训」与关键事实自动并入项目事实卡，该项目下次会话必达注入，
    // 踩过的坑不再靠检索碰运气（如发布踩坑后找到的稳定办法，下次发布直接生效）。
    this.reflectIntoProjectCard(scope, task, candidates)
    return stored
  }

  /**
   * 把本次反思的项目相关经验回流进项目事实卡（scope.kind=project 时）：
   * - task.lessons 全量回流（反思提示词要求只写可复用教训）；
   * - items 仅回流 critical（关键事实），避免项目卡被流水账灌爆；
   * - 去重/限长/裁剪由 appendProjectFact 统一保证；失败静默不影响反思主流程。
   */
  private reflectIntoProjectCard(scope: MemoryScopeContext, task: ReflectionTask, candidates: ExtractedCandidate[]): void {
    try {
      if (scope.kind !== 'project' || typeof scope.id !== 'string' || scope.id === '') return
      const texts: string[] = []
      if (Array.isArray(task.lessons)) {
        for (const lesson of task.lessons) {
          const text = normalizeMemoryText(typeof lesson === 'string' ? lesson : '')
          if (text.length >= 8) texts.push(text)
        }
      }
      for (const candidate of candidates) {
        if (candidate.importance !== 'critical') continue
        const text = normalizeMemoryText(typeof candidate.content === 'string' ? candidate.content : '')
        if (text.length >= 8) texts.push(text)
      }
      for (const text of texts.slice(0, 5)) appendProjectFact(scope.id, text, 'agent')
    } catch { /* 回流失败不影响记忆沉淀主流程 */ }
  }

  /** 技术复盘兜底：模型不可用时也按轮次留痕，保证任务复盘链路不断档。 */
  private recordTechnicalEpisodes(sessionId: string, windows: readonly PendingWindow[], watermarkTurn: number, batchFailed: boolean): void {
    if (this.governance === undefined) return
    for (const window of windows) {
      // 任务成败只由这一轮自己的证据决定：轮次未完成，或工具失败多于成功。
      const toolFailed = window.toolFailures > window.toolSuccesses
      const outcome: 'success' | 'failure' = window.completed !== true || toolFailed ? 'failure' : 'success'
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
        // 提炼整批失败是「复盘缺口」，如实标记即可；它不能反过来给已干成的任务扣失败帽子。
        ...(batchFailed ? { reflectionGap: true as const } : {}),
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
