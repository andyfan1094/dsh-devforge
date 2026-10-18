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
import { MemoryNegativeStore } from './negatives.ts'

export const MEMORY_CANDIDATE_DOMAIN = 'memory.candidate'
export const MEMORY_EPISODE_DOMAIN = 'memory.episode'
export const MEMORY_RECALL_DOMAIN = 'memory.recall'
export const MEMORY_FEEDBACK_DOMAIN = 'memory.feedback'
export const MEMORY_AUDIT_DOMAIN = 'memory.audit'
export const MEMORY_PENDING_DOMAIN = 'memory.pending-window'

const CATEGORIES = new Set<NativeMemoryCategory>(['preference', 'decision', 'fact', 'insight', 'context', 'general'])
const MAX_TRACES = 500
const MAX_EPISODES = 500
/**
 * 审计域保留上限（0.43.0）。
 * 生产实况：memory.audit 9485 条、无任何裁剪调用，比记忆本体（4825 条）还大——只写不清的域
 * 最终会把 store.db 与跨端备份一起撑大。裁剪助手 trimDomain 本就在本文件里，之前只是没人调用。
 */
const MAX_AUDIT = 2_000
/**
 * 审计裁剪节流：每 N 次审计写入才实扫一次（近万条的全表排序不能每条审计都做）。
 *
 * 生产调参（2026-10-10，重启后实测）：初版取 100 次 + 单次限删 500，但生产存量已达 9563 条，
 * 按那个节奏要上千次审计写入才收敛到上限——等于修复「很久以后才生效」。改为 20 次触发、
 * 一次收紧到上限，生产在几十次治理写入内就能回到 2000 条；此后每次只删超出的一小截，开销恒定。
 */
const AUDIT_TRIM_EVERY = 20
/**
 * 已解决候选的墓碑化（0.51.0）。
 *
 * 生产实况（2026-10-18 排查）：memory.candidate 曾达 6065 条 / 17.40 MB，其中 6057 条状态为
 * auto-activated——候选被采纳成正式记忆后，整份副本（正文 + 证据 + 作用域，单条约 2.8 KB）永久
 * 留在库里，没有任何裁剪路径。它比记忆正文（memory.entry 2.21 MB）大 8 倍，是 store.db 膨胀的
 * 最大单一来源。审计域的无界增长在 0.43.0 已修，候选域同样的问题漏掉了。
 *
 * 处理方式不是删除而是墓碑化：保留 id / state / resolvedAt / resultEntryId / duplicateIds 这五个
 * 对账字段，丢掉 content / evidence / tags / scope / reason。既断掉体积膨胀，又保住
 * 「这条候选后来对应哪条记忆」的可追溯性。
 */
const CANDIDATE_TOMBSTONE_DAYS = 3
/** 候选裁剪节流：每 N 次候选写入才实扫一次（候选域可达数千条，不能每次 propose 都全表排序）。 */
const CANDIDATE_PRUNE_EVERY = 20

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
  /**
   * 去重/冲突比对时排除的条目 id（通常是被更新的那条自己）。
   *
   * 修 0.51.0 缺陷：memory_manage update 把内容改写成与现有条目相近的表述时，propose() 的
   * 包含式比对会把**被更新的那条自身**认成重复，于是更新被拒并报“更新后内容与现有记忆重复，
   * 未落盘（已有 id=自己）”。语义上自己不该算自己的重复。
   */
  excludeEntryIds?: string[]
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
  /** 负记忆层（P1-5）：被拒绝/证伪/推翻的说法落 memory.rejected，召回时作负覆盖提示。 */
  readonly negatives: MemoryNegativeStore
  constructor(rag: RagStore, native: NativeMemoryStore) {
    this.rag = rag
    this.native = native
    this.negatives = new MemoryNegativeStore(rag)
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
    const excluded = new Set(input.excludeEntryIds ?? [])
    const active = this.native.listAll()
    const sameScope = active.filter((entry) => entry.archived !== true && !excluded.has(entry.id) && entry.scope.kind === scope.kind && entry.scope.id === scope.id)
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
    // 候选只经 propose 增长，因此在这里节流裁剪与增长点天然配对（同 audit 域 0.43.0 的做法）。
    this.pruneResolvedCandidatesThrottled()
    return candidate
  }

  /** 候选裁剪节流计数（进程内）。 */
  private candidateWrites = 0

  private pruneResolvedCandidatesThrottled(): void {
    this.candidateWrites += 1
    if (this.candidateWrites % CANDIDATE_PRUNE_EVERY !== 0) return
    try { this.pruneResolvedCandidates() } catch { /* 裁剪失败不影响候选写入主链路，下次触发重试 */ }
  }

  /**
   * 把超过保留期的已解决候选压缩成墓碑（0.51.0）。
   *
   * 只处理终态候选：approved / auto-activated / rejected / deduped。pending 与
   * needs-resolution 是待人工处理的，体积再大也不能动——那是用户还要裁决的活数据。
   *
   * 返回本次墓碑化的条数，便于做梦维护与面板展示。
   */
  pruneResolvedCandidates(keepDays = CANDIDATE_TOMBSTONE_DAYS): number {
    const now = Date.now()
    const cutoff = now - Math.max(0, keepDays) * 86_400_000
    const terminal = new Set<MemoryCandidate['state']>(['approved', 'auto-activated', 'rejected', 'deduped'])
    const rows = this.rag.listDomainDocs(MEMORY_CANDIDATE_DOMAIN)
    const victims: Array<{ id: string; tombstone: Record<string, unknown> }> = []
    for (const row of rows) {
      const data = row.data as Record<string, unknown> | null
      if (data === null || typeof data !== 'object') continue
      const state = String(data.state ?? '')
      if (!terminal.has(state as MemoryCandidate['state'])) continue
      // 已墓碑化的行没有 content 字段，跳过避免重复写入。
      if (typeof data.content !== 'string') continue
      const resolvedAt = typeof data.resolvedAt === 'number' ? data.resolvedAt : 0
      const createdAt = typeof data.createdAt === 'number' ? data.createdAt : 0
      if (Math.max(resolvedAt, createdAt) > cutoff) continue
      victims.push({
        id: row.id,
        tombstone: {
          id: row.id,
          state,
          ...(typeof data.resolvedAt === 'number' ? { resolvedAt: data.resolvedAt } : {}),
          ...(typeof data.createdAt === 'number' ? { createdAt: data.createdAt } : {}),
          ...(typeof data.resultEntryId === 'string' && data.resultEntryId !== '' ? { resultEntryId: data.resultEntryId } : {}),
          ...(Array.isArray(data.duplicateIds) && data.duplicateIds.length > 0 ? { duplicateIds: data.duplicateIds.slice(0, 10) } : {}),
          ...(typeof data.source === 'string' && data.source !== '' ? { source: data.source.slice(0, 120) } : {}),
          tombstoned: true,
          tombstonedAt: now,
        },
      })
    }
    if (victims.length === 0) return 0
    this.rag.withDomainTransaction(() => {
      for (const victim of victims) this.rag.putDomainDoc(MEMORY_CANDIDATE_DOMAIN, victim.id, victim.tombstone)
      this.audit('candidate-tombstone', victims.map((item) => item.id), '已解决候选超过 ' + keepDays + ' 天，压缩为墓碑以阻止体积膨胀')
    })
    return victims.length
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
        // P1-5 负记忆层：被否定的说法必须显式落层，否则下次还会被当成新知识重新提上来。
        this.negatives.record({ id: 'rej-' + candidate.id, content: candidate.content, reason: rejected.resolutionReason ?? '人工拒绝', kind: 'rejected', scope: candidate.scope, actor: 'user', sourceId: candidate.id })
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
        // 与 submitDirectFeedback 同口径：被证伪/过时的说法必须落负层，否则召回时没有警示。
        try {
          const entry = this.native.get(input.entryId)
          if (entry !== undefined) {
            this.negatives.record({
              id: 'neg-' + input.entryId,
              content: entry.content,
              reason: (input.verdict === 'outdated' ? '已过时：' : '已被证伪：') + (clip(input.note, 200) || '召回反馈标记'),
              kind: input.verdict === 'outdated' ? 'superseded' : 'falsified',
              scope: entry.scope,
              actor: 'user',
              sourceId: input.entryId,
            })
          }
        } catch { /* 负层写入失败不阻塞反馈落账。 */ }
        try { this.native.quarantine(input.entryId) } catch { /* 钉选或已失效条目只记录反馈，等待人工处理。 */ }
      }
      this.audit('feedback:' + input.verdict, [input.recallId, input.entryId], feedback.note ?? '')
      return feedback
    })
  }

  /**
   * 直接按记忆 id 提交反馈（0.50.2 新增）。
   *
   * 原 submitFeedback 要求调用方提供 recallId，并校验该 entry 确实出现在那条召回轨迹里——
   * 但这个 id 是内部轨迹标识，模型在会话里根本拿不到，所以 6044 条记忆的
   * helpfulCount/harmfulCount 长期全是 0，反馈回路等于从未接通（2026-10-18 实测）。
   * 这里允许只给 entryId：优先挂到最近一条包含它的召回轨迹上，没有轨迹也能落账。
   */
  submitDirectFeedback(input: { entryId: string; verdict: MemoryRecallFeedback['verdict']; note?: string }): MemoryRecallFeedback {
    const entry = this.native.get(input.entryId)
    if (entry === undefined) throw new Error('记忆不存在：' + input.entryId)
    const recall = this.listRecalls(500).find((item) => item.hits.some((hit) => hit.entryId === input.entryId && hit.included))
    const recallId = recall?.id ?? 'direct'
    const id = createHash('sha256').update(recallId + '\u0000' + input.entryId + '\u0000' + input.verdict).digest('hex').slice(0, 40)
    const existing = this.rag.listDomainDocs(MEMORY_FEEDBACK_DOMAIN).find((row) => row.id === id)
    if (existing !== undefined) return existing.data as MemoryRecallFeedback
    const feedback: MemoryRecallFeedback = { id, recallId, entryId: input.entryId, verdict: input.verdict, ...(clip(input.note, 500) === '' ? {} : { note: clip(input.note, 500) }), createdAt: Date.now() }
    return this.rag.withDomainTransaction(() => {
      this.rag.putDomainDoc(MEMORY_FEEDBACK_DOMAIN, id, feedback)
      if (input.verdict === 'useful') this.native.markFeedback(input.entryId, true)
      if (input.verdict === 'incorrect' || input.verdict === 'outdated') {
        this.native.markFeedback(input.entryId, false)
        // 负记忆落层（0.50.2）：光隔离/降权不够——被证伪的说法必须进 memory.rejected，
        // 否则同一条错误结论换个措辞又会从沉淀里长回来，召回时也没有警示。
        try {
          this.negatives.record({
            id: 'neg-' + input.entryId,
            content: entry.content,
            reason: (input.verdict === 'outdated' ? '已过时：' : '已被证伪：') + (clip(input.note, 200) || '召回反馈标记'),
            kind: input.verdict === 'outdated' ? 'superseded' : 'falsified',
            scope: entry.scope,
            actor: 'agent',
            sourceId: input.entryId,
          })
        } catch { /* 负层写入失败不阻塞反馈落账：隔离已生效，召回仍会跳过。 */ }
        try { this.native.quarantine(input.entryId) } catch { /* 钉选或已失效条目只记录反馈，等待人工处理。 */ }
      }
      this.audit('feedback:' + input.verdict, [recallId, input.entryId], feedback.note ?? '')
      return feedback
    })
  }

  quality(): MemoryQualityStats {
    const quality = this.native.qualityBase()
    // 0.51.0 修统计失真：原实现用 listCandidates({ limit: 1000 }) 计数，而 listCandidates 的 limit
    // 被 Math.min(1000, …) 硬封顶——候选一旦超过 1000 条（生产曾达 6065 条），待审数就永远停在
    // 1000 以内，面板显示的“待审候选”是假的。改为直接扫原始域行按状态计数，不受 limit 影响。
    // 单次解析全部候选行的开销与原先的 listCandidates 相同（都是全量 flatMap），没有额外代价。
    const rawRows = this.rag.listDomainDocs(MEMORY_CANDIDATE_DOMAIN)
    let pendingOrResolution = 0
    let needsResolution = 0
    for (const row of rawRows) {
      const data = row.data as Record<string, unknown> | null
      if (data === null || typeof data !== 'object') continue
      // 墓碑行没有 content，语义上已不是候选，不计入任何状态统计。
      if (typeof data.content !== 'string') continue
      const state = String(data.state ?? 'pending')
      if (state === 'pending' || state === 'needs-resolution') pendingOrResolution += 1
      if (state === 'needs-resolution') needsResolution += 1
    }
    quality.candidates = pendingOrResolution
    quality.conflicts = this.native.listRelations().filter((item) => item.kind === 'conflicts-with').length + needsResolution
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

  /** 审计裁剪节流计数（进程内；累计满 AUDIT_TRIM_EVERY 次写入触发一次实扫）。 */
  private auditWrites = 0

  /** 对外审计入口（记忆管家等外部服务复用同一套审计域与裁剪口径）。 */
  recordAudit(action: string, ids: string[], reason: string): void {
    try { this.audit(action, ids, reason) } catch { /* 审计失败绝不影响业务主链路 */ }
  }

  private audit(action: string, ids: string[], reason: string): void {
    const id = randomUUID()
    this.rag.putDomainDoc(MEMORY_AUDIT_DOMAIN, id, { id, action, ids, reason: reason.slice(0, 500), createdAt: Date.now() })
    // 0.43.0：审计域此前只写不裁（生产实况 9485 条无界增长）。
    // 节流触发 + 一次收紧到上限：既不放过无界增长，也不让每条审计都做近万条的全表排序。
    this.auditWrites += 1
    if (this.auditWrites % AUDIT_TRIM_EVERY !== 0) return
    try {
      this.trimDomain(MEMORY_AUDIT_DOMAIN, MAX_AUDIT, 'createdAt')
    } catch {
      // 裁剪失败绝不影响治理主链路：计数继续走，下次触发会重试。
    }
  }

  private trimDomain(domain: string, limit: number, timeField: string, maxDelete = Number.POSITIVE_INFINITY): void {
    const rows = this.rag.listDomainDocs(domain).map((row) => ({ id: row.id, time: typeof (row.data as Record<string, unknown> | null)?.[timeField] === 'number' ? (row.data as Record<string, number>)[timeField] : 0 })).sort((a, b) => b.time - a.time)
    const overflow = rows.slice(limit)
    if (overflow.length === 0) return
    // rows 是时间降序（新→旧），故 overflow 的**尾部**才是最旧的。单次限删必须从最旧一端删起，
    // 否则会出现「次旧的被删掉、最旧的反而一直留着」——规模越大越明显（被测试抓到的真实缺陷）。
    const victims = Number.isFinite(maxDelete)
      ? overflow.slice(Math.max(0, overflow.length - Math.floor(maxDelete)))
      : overflow
    for (const victim of victims) this.rag.deleteDomainDoc(domain, victim.id)
  }
}
