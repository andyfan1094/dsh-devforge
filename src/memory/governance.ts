/**
 * 可信记忆治理服务。
 *
 * 模型提炼、任务复盘与外部迁移只能提出候选；候选只有经过工作台人工审核，
 * 或 Host 验证到直接用户明确要求保存的原话后，才能进入 active memory.entry。
 * 正反馈只做质量统计，绝不自动提升信任、作用域、重要度或钉选状态。
 */
import { createHash, randomUUID } from 'node:crypto'
import type { RagStore } from '../rag/rag-store.ts'
import type {
  MemoryCandidate,
  MemoryEpisode,
  MemoryEvidence,
  MemoryQualityStats,
  MemoryRecallFeedback,
  MemoryRecallTrace,
  MemoryScopeContext,
  NativeMemoryCategory,
  NativeMemoryEntry,
} from './protocol.ts'
import type { NativeMemoryStore } from './native.ts'

export const MEMORY_CANDIDATE_DOMAIN = 'memory.candidate'
export const MEMORY_EPISODE_DOMAIN = 'memory.episode'
export const MEMORY_RECALL_DOMAIN = 'memory.recall'
export const MEMORY_FEEDBACK_DOMAIN = 'memory.feedback'
export const MEMORY_AUDIT_DOMAIN = 'memory.audit'
export const MEMORY_PENDING_DOMAIN = 'memory.pending-window'

const CATEGORIES = new Set<NativeMemoryCategory>(['preference', 'decision', 'fact', 'insight', 'context', 'general'])
const MAX_TRACES = 500
const MAX_EPISODES = 500

export interface MemoryCandidateInput {
  content: string
  category?: NativeMemoryCategory
  tags?: string[]
  importance?: number
  confidence?: number
  reason?: string
  scope: MemoryScopeContext
  memoryKey?: string
  evidence?: MemoryEvidence[]
  source: string
  sourceId?: string
  sessionId?: string
  turn?: number
}

export interface MemoryReviewInput {
  id: string
  action: 'approve' | 'reject'
  content?: string
  category?: NativeMemoryCategory
  tags?: string[]
  importance?: number
  scope?: MemoryScopeContext
  memoryKey?: string
  supersedesIds?: string[]
  reason?: string
}

function clip(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function normalized(value: string): string {
  return value.toLocaleLowerCase().replace(/\s+/gu, ' ').replace(/[，。！？、,.!?;；:：'"“”‘’`()（）\[\]{}]/gu, '').trim()
}

function validScope(scope: MemoryScopeContext): MemoryScopeContext {
  if (scope.kind === 'global') return { kind: 'global' }
  if (scope.kind !== 'project' && scope.kind !== 'workspace') throw new Error('记忆作用域无效')
  const id = clip(scope.id, 500)
  if (id === '') throw new Error('项目或工作区作用域必须包含 id')
  const label = clip(scope.label, 160)
  return { kind: scope.kind, id, ...(label === '' ? {} : { label }) }
}

function parseCandidate(data: unknown, id: string): MemoryCandidate | undefined {
  if (data === null || typeof data !== 'object') return undefined
  const value = data as Partial<MemoryCandidate>
  if (typeof value.content !== 'string' || typeof value.createdAt !== 'number') return undefined
  const state = ['pending', 'needs-resolution', 'approved', 'auto-activated', 'rejected', 'deduped'].includes(String(value.state)) ? value.state as MemoryCandidate['state'] : 'pending'
  return {
    id,
    content: value.content,
    category: CATEGORIES.has(value.category as NativeMemoryCategory) ? value.category as NativeMemoryCategory : 'general',
    tags: Array.isArray(value.tags) ? value.tags.filter((tag): tag is string => typeof tag === 'string').slice(0, 20) : [],
    importance: typeof value.importance === 'number' ? Math.max(1, Math.min(5, Math.round(value.importance))) : 3,
    confidence: typeof value.confidence === 'number' ? Math.max(0, Math.min(1, value.confidence)) : 0.5,
    reason: typeof value.reason === 'string' ? value.reason : '',
    scope: value.scope === undefined ? { kind: 'global' } : validScope(value.scope),
    ...(typeof value.memoryKey === 'string' && value.memoryKey !== '' ? { memoryKey: value.memoryKey } : {}),
    evidence: Array.isArray(value.evidence) ? value.evidence : [],
    duplicateIds: Array.isArray(value.duplicateIds) ? value.duplicateIds.filter((item): item is string => typeof item === 'string') : [],
    conflictIds: Array.isArray(value.conflictIds) ? value.conflictIds.filter((item): item is string => typeof item === 'string') : [],
    source: typeof value.source === 'string' ? value.source : 'unknown',
    ...(typeof value.sourceId === 'string' ? { sourceId: value.sourceId } : {}),
    ...(typeof value.sessionId === 'string' ? { sessionId: value.sessionId } : {}),
    ...(typeof value.turn === 'number' ? { turn: value.turn } : {}),
    state,
    createdAt: value.createdAt,
    ...(typeof value.resolvedAt === 'number' ? { resolvedAt: value.resolvedAt } : {}),
    ...(typeof value.resolutionReason === 'string' ? { resolutionReason: value.resolutionReason } : {}),
    ...(typeof value.resultEntryId === 'string' ? { resultEntryId: value.resultEntryId } : {}),
  }
}

function parseEpisode(data: unknown, id: string): MemoryEpisode | undefined {
  if (data === null || typeof data !== 'object') return undefined
  const value = data as Partial<MemoryEpisode>
  if (typeof value.sessionId !== 'string' || typeof value.turn !== 'number' || typeof value.createdAt !== 'number') return undefined
  return {
    id,
    sessionId: value.sessionId,
    turn: value.turn,
    scope: value.scope === undefined ? { kind: 'workspace' } : validScope(value.scope),
    goal: clip(value.goal, 1000),
    summary: clip(value.summary, 3000),
    outcome: ['success', 'partial', 'failure'].includes(String(value.outcome)) ? value.outcome as MemoryEpisode['outcome'] : 'unknown',
    toolNames: Array.isArray(value.toolNames) ? value.toolNames.filter((item): item is string => typeof item === 'string').slice(0, 50) : [],
    toolSuccesses: typeof value.toolSuccesses === 'number' ? value.toolSuccesses : 0,
    toolFailures: typeof value.toolFailures === 'number' ? value.toolFailures : 0,
    lessons: Array.isArray(value.lessons) ? value.lessons.filter((item): item is string => typeof item === 'string').slice(0, 10) : [],
    candidateIds: Array.isArray(value.candidateIds) ? value.candidateIds.filter((item): item is string => typeof item === 'string') : [],
    injectedMemoryIds: Array.isArray(value.injectedMemoryIds) ? value.injectedMemoryIds.filter((item): item is string => typeof item === 'string') : [],
    usedMemoryIds: Array.isArray(value.usedMemoryIds) ? value.usedMemoryIds.filter((item): item is string => typeof item === 'string') : [],
    createdAt: value.createdAt,
    // 技术兜底标记必须存活往返：读回时丢掉它，面板就分不清「任务失败」和「复盘缺口」。
    ...(value.reflectionGap === true ? { reflectionGap: true as const } : {}),
  }
}

/** 候选、复盘、召回轨迹和反馈的业务层。 */
export class MemoryGovernanceService {
  private readonly rag: RagStore
  private readonly native: NativeMemoryStore
  constructor(rag: RagStore, native: NativeMemoryStore) {
    this.rag = rag
    this.native = native
  }

  /** 创建候选并在写入前标记精确重复与同 claim 冲突。 */
  propose(input: MemoryCandidateInput): MemoryCandidate {
    const content = clip(input.content, 20_000)
    if (content === '') throw new Error('候选记忆内容不能为空')
    const sourceId = clip(input.sourceId, 300)
    if (sourceId !== '') {
      const existing = this.listCandidates({ limit: 1000 }).find((item) => item.sourceId === sourceId)
      if (existing !== undefined) return existing
    }
    const scope = validScope(input.scope)
    const category = CATEGORIES.has(input.category as NativeMemoryCategory) ? input.category as NativeMemoryCategory : 'general'
    const active = this.native.listAll()
    const sameScope = active.filter((entry) => entry.archived !== true && entry.scope.kind === scope.kind && entry.scope.id === scope.id)
    const contentKey = normalized(content)
    const duplicates = sameScope.filter((entry) => normalized(entry.content) === contentKey || normalized(entry.content).includes(contentKey) || contentKey.includes(normalized(entry.content))).map((entry) => entry.id)
    const memoryKey = clip(input.memoryKey, 300)
    const conflicts = memoryKey === '' ? [] : sameScope.filter((entry) => entry.memoryKey === memoryKey && !duplicates.includes(entry.id)).map((entry) => entry.id)
    const now = Date.now()
    const candidate: MemoryCandidate = {
      id: randomUUID(),
      content,
      category,
      tags: [...new Set((input.tags ?? []).map((tag) => clip(tag, 80)).filter(Boolean))].slice(0, 20),
      importance: typeof input.importance === 'number' ? Math.max(1, Math.min(5, Math.round(input.importance))) : 3,
      confidence: typeof input.confidence === 'number' ? Math.max(0, Math.min(1, input.confidence)) : 0.5,
      reason: clip(input.reason, 1000),
      scope,
      ...(memoryKey === '' ? {} : { memoryKey }),
      evidence: Array.isArray(input.evidence) ? input.evidence.slice(0, 8) : [],
      duplicateIds: duplicates,
      conflictIds: conflicts,
      source: clip(input.source, 120) || 'unknown',
      ...(clip(input.sourceId, 300) === '' ? {} : { sourceId: clip(input.sourceId, 300) }),
      ...(clip(input.sessionId, 200) === '' ? {} : { sessionId: clip(input.sessionId, 200) }),
      ...(typeof input.turn === 'number' && Number.isSafeInteger(input.turn) ? { turn: input.turn } : {}),
      state: duplicates.length > 0 ? 'deduped' : conflicts.length > 0 ? 'needs-resolution' : 'pending',
      createdAt: now,
      ...(duplicates[0] === undefined ? {} : { resultEntryId: duplicates[0], resolvedAt: now, resolutionReason: '与现有活跃记忆重复' }),
    }
    this.rag.withDomainTransaction(() => {
      this.rag.putDomainDoc(MEMORY_CANDIDATE_DOMAIN, candidate.id, candidate)
      this.audit('propose', [candidate.id], candidate.state)
    })
    return candidate
  }

  listCandidates(options?: { states?: MemoryCandidate['state'][]; limit?: number }): MemoryCandidate[] {
    const states = options?.states
    const limit = Math.max(1, Math.min(1000, Math.floor(options?.limit ?? 200)))
    return this.rag.listDomainDocs(MEMORY_CANDIDATE_DOMAIN).flatMap((row) => {
      const item = parseCandidate(row.data, row.id)
      return item === undefined || (states !== undefined && !states.includes(item.state)) ? [] : [item]
    }).sort((a, b) => b.createdAt - a.createdAt).slice(0, limit)
  }

  /** 人工审核候选。最终内容/作用域/事实键会重新计算冲突，禁止悄悄覆盖。 */
  review(input: MemoryReviewInput): { candidate: MemoryCandidate; entry?: NativeMemoryEntry } {
    const candidate = this.listCandidates({ limit: 1000 }).find((item) => item.id === input.id)
    if (candidate === undefined) throw new Error('候选记忆不存在：' + input.id)
    if (candidate.state === 'approved' || candidate.state === 'rejected' || candidate.state === 'deduped') {
      return { candidate, ...(candidate.resultEntryId === undefined ? {} : { entry: this.native.get(candidate.resultEntryId) }) }
    }

    const now = Date.now()
    const alreadyApplied = this.native.listAll().find((entry) => entry.source === 'user-reviewed' && entry.sourceId === candidate.id)
    if (alreadyApplied !== undefined) {
      const recovered = { ...candidate, state: 'approved' as const, resolvedAt: now, resolutionReason: '恢复已原子落库的审核结果', resultEntryId: alreadyApplied.id }
      this.rag.withDomainTransaction(() => {
        this.rag.putDomainDoc(MEMORY_CANDIDATE_DOMAIN, candidate.id, recovered)
        this.audit('recover-approval', [candidate.id, alreadyApplied.id], recovered.resolutionReason)
      })
      return { candidate: recovered, entry: alreadyApplied }
    }

    if (input.action === 'reject') {
      const rejected = { ...candidate, state: 'rejected' as const, resolvedAt: now, resolutionReason: clip(input.reason, 500) || '人工拒绝' }
      this.rag.withDomainTransaction(() => {
        this.rag.putDomainDoc(MEMORY_CANDIDATE_DOMAIN, candidate.id, rejected)
        this.audit('reject', [candidate.id], rejected.resolutionReason ?? '')
      })
      return { candidate: rejected }
    }

    const content = clip(input.content, 20_000) || candidate.content
    const scope = input.scope === undefined ? candidate.scope : validScope(input.scope)
    const memoryKey = clip(input.memoryKey, 300) || candidate.memoryKey
    const active = this.native.listAll().filter((entry) => entry.state === 'active' && entry.scope.kind === scope.kind && entry.scope.id === scope.id)
    const duplicate = active.find((entry) => normalized(entry.content) === normalized(content))
    if (duplicate !== undefined) {
      const deduped = { ...candidate, state: 'deduped' as const, duplicateIds: [duplicate.id], conflictIds: [], resolvedAt: now, resolutionReason: '审核内容与现有活跃记忆重复', resultEntryId: duplicate.id }
      this.rag.withDomainTransaction(() => {
        this.rag.putDomainDoc(MEMORY_CANDIDATE_DOMAIN, candidate.id, deduped)
        this.audit('dedupe', [candidate.id, duplicate.id], deduped.resolutionReason)
      })
      return { candidate: deduped, entry: duplicate }
    }

    const actualConflicts = memoryKey === undefined ? [] : active.filter((entry) => entry.memoryKey === memoryKey).map((entry) => entry.id).sort()
    const supersedesIds = [...new Set(input.supersedesIds ?? [])].sort()
    if (actualConflicts.length !== supersedesIds.length || actualConflicts.some((id, index) => id !== supersedesIds[index])) {
      throw new Error(actualConflicts.length === 0 ? '当前审核内容没有可取代的活跃冲突记忆' : '批准冲突候选时必须明确选择全部当前冲突记忆')
    }
    const entryInput = {
      content,
      category: input.category ?? candidate.category,
      tags: input.tags ?? candidate.tags,
      importance: input.importance ?? candidate.importance,
      source: 'user-reviewed',
      sourceId: candidate.id,
      trust: 'confirmed' as const,
      confidence: 1,
      scope,
      ...(memoryKey === undefined ? {} : { memoryKey }),
      evidence: [...candidate.evidence, { kind: 'manual' as const, quote: clip(input.reason, 500) || '记忆工作台人工审核通过', sourceId: candidate.id, createdAt: now }],
    }
    return this.rag.withDomainTransaction(() => {
      const entry = supersedesIds.length > 0 ? this.native.supersede(supersedesIds, entryInput, clip(input.reason, 500) || '人工确认新事实取代旧事实') : this.native.create(entryInput)
      const approved = { ...candidate, state: 'approved' as const, conflictIds: actualConflicts, resolvedAt: now, resolutionReason: clip(input.reason, 500) || '人工审核通过', resultEntryId: entry.id }
      this.rag.putDomainDoc(MEMORY_CANDIDATE_DOMAIN, candidate.id, approved)
      this.audit(supersedesIds.length > 0 ? 'supersede' : 'approve', [candidate.id, entry.id, ...supersedesIds], approved.resolutionReason ?? '')
      return { candidate: approved, entry }
    })
  }

  /** 直接用户明确要求保存时调用；证据必须由 Host 从当前 session 事件构造。 */
  acceptExplicitUser(input: MemoryCandidateInput): { candidate: MemoryCandidate; entry?: NativeMemoryEntry } {
    if (!(input.evidence ?? []).some((item) => item.kind === 'user' && item.sessionId !== undefined && item.messageId !== undefined && item.digest !== undefined)) throw new Error('缺少可回读验证的直接用户证据')
    const candidate = this.propose(input)
    if (candidate.state === 'deduped') return { candidate, entry: candidate.resultEntryId === undefined ? undefined : this.native.get(candidate.resultEntryId) }
    if (candidate.state === 'needs-resolution') return { candidate }
    return this.review({ id: candidate.id, action: 'approve', reason: 'Host 已验证直接用户明确保存请求' })
  }

  /**
   * 全自动激活（辉哥 2026-09-10 决策）：沉淀与工具写入的候选无需人工审核，
   * 直接进入 active memory.entry。信任等级按证据链分级：带工具/用户原话证据
   * 为 verified，仅模型提炼为 inferred。同 scope + memoryKey 的旧事实自动取代，
   * 但钉选条目是用户显式钉下的硬规则，自动沉淀不得覆盖（保留并由工作台治理）。
   */
  activateAuto(input: MemoryCandidateInput): { candidate: MemoryCandidate; entry?: NativeMemoryEntry } {
    const candidate = this.propose(input)
    if (candidate.state === 'deduped') return { candidate, entry: candidate.resultEntryId === undefined ? undefined : this.native.get(candidate.resultEntryId) }
    if (candidate.state === 'rejected') return { candidate }
    const now = Date.now()
    const hasStrongEvidence = (candidate.evidence ?? []).some((item) => item.kind === 'tool' || item.kind === 'user')
    const entryInput: Parameters<NativeMemoryStore['create']>[0] = {
      content: candidate.content,
      category: candidate.category,
      tags: candidate.tags,
      importance: candidate.importance,
      source: candidate.source === 'unknown' ? 'session-reflection' : candidate.source,
      sourceId: candidate.id,
      trust: hasStrongEvidence ? 'verified' : 'inferred',
      confidence: candidate.confidence,
      scope: candidate.scope,
      ...(candidate.memoryKey === undefined ? {} : { memoryKey: candidate.memoryKey }),
      evidence: candidate.evidence,
    }
    const supersedeIds = candidate.conflictIds.filter((id) => {
      const entry = this.native.get(id)
      return entry !== undefined && entry.pinned !== true
    })
    const entry = supersedeIds.length > 0
      ? this.native.supersede(supersedeIds, entryInput, '自动沉淀新证据取代旧事实', 'system')
      : this.native.create(entryInput)
    const resolutionReason = supersedeIds.length > 0 ? '自动激活并取代冲突旧事实' : '自动激活（无需人工审核）'
    const activated = { ...candidate, state: 'auto-activated' as const, resolvedAt: now, resolutionReason, resultEntryId: entry.id }
    this.rag.withDomainTransaction(() => {
      this.rag.putDomainDoc(MEMORY_CANDIDATE_DOMAIN, candidate.id, activated)
      this.audit(supersedeIds.length > 0 ? 'auto-supersede' : 'auto-activate', [candidate.id, entry.id, ...supersedeIds], resolutionReason)
    })
    return { candidate: activated, entry }
  }

  recordEpisode(episode: MemoryEpisode): MemoryEpisode {
    const existing = this.rag.listDomainDocs(MEMORY_EPISODE_DOMAIN).find((row) => row.id === episode.id)
    if (existing !== undefined) return parseEpisode(existing.data, existing.id) ?? episode
    this.rag.withDomainTransaction(() => {
      this.rag.putDomainDoc(MEMORY_EPISODE_DOMAIN, episode.id, episode)
      this.trimDomain(MEMORY_EPISODE_DOMAIN, MAX_EPISODES, 'createdAt')
      if (episode.usedMemoryIds.length > 0) this.native.markUsed(episode.usedMemoryIds)
    })
    return episode
  }

  listEpisodes(limit = 100): MemoryEpisode[] {
    return this.rag.listDomainDocs(MEMORY_EPISODE_DOMAIN).flatMap((row) => {
      const item = parseEpisode(row.data, row.id)
      return item === undefined ? [] : [item]
    }).sort((a, b) => b.createdAt - a.createdAt).slice(0, Math.max(1, Math.min(500, Math.floor(limit))))
  }

  recordRecall(trace: MemoryRecallTrace): void {
    this.rag.withDomainTransaction(() => {
      this.rag.putDomainDoc(MEMORY_RECALL_DOMAIN, trace.id, trace)
      this.trimDomain(MEMORY_RECALL_DOMAIN, MAX_TRACES, 'createdAt')
      const included = trace.hits.filter((hit) => hit.included && hit.layer !== 'mirror').map((hit) => hit.entryId)
      if (included.length > 0) this.native.markAccessed(included)
    })
  }

  listRecalls(limit = 100): MemoryRecallTrace[] {
    return this.rag.listDomainDocs(MEMORY_RECALL_DOMAIN).flatMap((row) => {
      const value = row.data as Partial<MemoryRecallTrace> | null
      if (value === null || typeof value !== 'object' || typeof value.createdAt !== 'number' || !Array.isArray(value.hits)) return []
      return [{ ...value, id: row.id } as MemoryRecallTrace]
    }).sort((a, b) => b.createdAt - a.createdAt).slice(0, Math.max(1, Math.min(500, Math.floor(limit))))
  }

  submitFeedback(input: Omit<MemoryRecallFeedback, 'id' | 'createdAt'>): MemoryRecallFeedback {
    const recall = this.listRecalls(500).find((item) => item.id === input.recallId)
    if (recall === undefined || !recall.hits.some((hit) => hit.entryId === input.entryId && hit.included)) throw new Error('只能反馈真实注入过的记忆命中')
    const id = createHash('sha256').update(input.recallId + '\u0000' + input.entryId).digest('hex').slice(0, 40)
    const existing = this.rag.listDomainDocs(MEMORY_FEEDBACK_DOMAIN).find((row) => row.id === id)
    if (existing !== undefined) return existing.data as MemoryRecallFeedback
    const feedback: MemoryRecallFeedback = { id, recallId: input.recallId, entryId: input.entryId, verdict: input.verdict, ...(clip(input.note, 500) === '' ? {} : { note: clip(input.note, 500) }), createdAt: Date.now() }
    return this.rag.withDomainTransaction(() => {
      this.rag.putDomainDoc(MEMORY_FEEDBACK_DOMAIN, id, feedback)
      if (input.verdict === 'useful') this.native.markFeedback(input.entryId, true)
      if (input.verdict === 'incorrect' || input.verdict === 'outdated') {
        this.native.markFeedback(input.entryId, false)
        try { this.native.quarantine(input.entryId) } catch { /* 钉选或已失效条目只记录反馈，等待人工处理。 */ }
      }
      this.audit('feedback:' + input.verdict, [input.recallId, input.entryId], feedback.note ?? '')
      return feedback
    })
  }

  quality(): MemoryQualityStats {
    const quality = this.native.qualityBase()
    quality.candidates = this.listCandidates({ states: ['pending', 'needs-resolution'], limit: 1000 }).length
    quality.conflicts = this.native.listRelations().filter((item) => item.kind === 'conflicts-with').length + this.listCandidates({ states: ['needs-resolution'], limit: 1000 }).length
    const feedback = this.rag.listDomainDocs(MEMORY_FEEDBACK_DOMAIN).map((row) => row.data as Partial<MemoryRecallFeedback>)
    quality.helpful = feedback.filter((item) => item.verdict === 'useful').length
    quality.irrelevant = feedback.filter((item) => item.verdict === 'irrelevant').length
    quality.incorrect = feedback.filter((item) => item.verdict === 'incorrect').length
    quality.outdated = feedback.filter((item) => item.verdict === 'outdated').length
    quality.episodes = this.rag.listDomainDocs(MEMORY_EPISODE_DOMAIN).length
    quality.retrievals = this.rag.listDomainDocs(MEMORY_RECALL_DOMAIN).length
    return quality
  }

  /** turn/end 时先把不可变窗口落盘，Host 重启不会丢掉静默期内尚未提炼的工作。 */
  savePendingWindow<T extends { turn: number }>(sessionId: string, data: T): void {
    this.rag.putDomainDoc(MEMORY_PENDING_DOMAIN, sessionId + ':' + data.turn, { sessionId, ...data, queuedAt: Date.now() })
  }

  listPendingWindows<T extends { turn: number }>(sessionId?: string): Array<{ id: string; sessionId: string; data: T }> {
    return this.rag.listDomainDocs(MEMORY_PENDING_DOMAIN).flatMap((row) => {
      const value = row.data as Record<string, unknown> | null
      if (value === null || typeof value !== 'object' || typeof value.sessionId !== 'string' || typeof value.turn !== 'number') return []
      if (sessionId !== undefined && value.sessionId !== sessionId) return []
      return [{ id: row.id, sessionId: value.sessionId, data: value as T }]
    })
  }

  deletePendingWindows(ids: readonly string[]): void {
    for (const id of ids) this.rag.deleteDomainDoc(MEMORY_PENDING_DOMAIN, id)
  }

  private audit(action: string, ids: string[], reason: string): void {
    const id = randomUUID()
    this.rag.putDomainDoc(MEMORY_AUDIT_DOMAIN, id, { id, action, ids, reason: reason.slice(0, 500), createdAt: Date.now() })
  }

  private trimDomain(domain: string, limit: number, timeField: string): void {
    const rows = this.rag.listDomainDocs(domain).map((row) => ({ id: row.id, time: typeof (row.data as Record<string, unknown> | null)?.[timeField] === 'number' ? (row.data as Record<string, number>)[timeField] : 0 })).sort((a, b) => b.time - a.time)
    for (const row of rows.slice(limit)) this.rag.deleteDomainDoc(domain, row.id)
  }
}
