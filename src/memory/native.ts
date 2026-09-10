/**
 * 天工造梦内置记忆主存储。
 *
 * 正文继续写入旧版 `memory.entry`，可信度、作用域、版本状态和反馈写入
 * `memory.meta` sidecar。这样新版可以安全扩展，旧版回滚也不会在一次 update
 * 中把新增元数据抹掉。所有召回只读取 state=active 且未过期的条目。
 */
import { createHash, randomUUID } from 'node:crypto'
import type { RagStore } from '../rag/rag-store.ts'
import { memoryScopeMatches } from './scope.ts'
import type {
  MemoryEntryMeta,
  MemoryEvidence,
  MemoryQualityStats,
  MemoryRelation,
  MemoryScopeContext,
  MemorySearchHit,
  MemoryTrust,
  NativeMemoryCategory,
  NativeMemoryEntry,
  NativeMemoryInput,
  NativeMemoryMigrationItem,
  NativeMemoryMigrationResult,
  NativeMemoryPatch,
} from './protocol.ts'

export type { NativeMemoryCategory, NativeMemoryEntry, NativeMemoryInput, NativeMemoryMigrationItem, NativeMemoryMigrationResult, NativeMemoryPatch }

export const NATIVE_MEMORY_DOMAIN = 'memory.entry'
export const MEMORY_META_DOMAIN = 'memory.meta'
export const MEMORY_RELATION_DOMAIN = 'memory.relation'

const CATEGORIES = new Set<NativeMemoryCategory>(['preference', 'decision', 'fact', 'insight', 'context', 'general'])
const TRUST_LEVELS = new Set<MemoryTrust>(['confirmed', 'verified', 'inferred', 'legacy'])

/** 旧版可读的正文结构；升级元数据不得直接依赖该 JSON 保存。 */
interface StoredMemoryEntry {
  id: string
  content: string
  category: NativeMemoryCategory
  tags: string[]
  source: string
  sourceId?: string
  importance: number
  createdAt: number
  updatedAt: number
  migrationKey?: string
  pinned?: boolean
  archived?: boolean
}

function cleanText(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string') throw new Error(field + ' 必须是字符串')
  const text = value.trim()
  if (text === '' || text.length > max) throw new Error(field + ' 不能为空且不得超过 ' + max + ' 个字符')
  return text
}

function cleanTags(value: unknown): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new Error('tags 必须是字符串数组')
  const tags = value.map((tag) => cleanText(tag, 'tag', 80)).slice(0, 20)
  return [...new Set(tags)]
}

function cleanCategory(value: unknown): NativeMemoryCategory {
  if (value === undefined) return 'general'
  if (typeof value !== 'string' || !CATEGORIES.has(value as NativeMemoryCategory)) throw new Error('category 类型无效')
  return value as NativeMemoryCategory
}

function cleanImportance(value: unknown): number {
  if (value === undefined) return 3
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('importance 必须是数字')
  return Math.max(1, Math.min(5, Math.round(value)))
}

function cleanCounter(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0
}

function cleanConfidence(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback
}

function cleanScope(value: unknown): MemoryScopeContext {
  if (value === null || typeof value !== 'object') return { kind: 'global' }
  const scope = value as Partial<MemoryScopeContext>
  if (scope.kind === 'global') return { kind: 'global' }
  if (scope.kind !== 'project' && scope.kind !== 'workspace') return { kind: 'global' }
  const id = typeof scope.id === 'string' && scope.id.trim() !== '' ? scope.id.trim().slice(0, 500) : undefined
  const label = typeof scope.label === 'string' && scope.label.trim() !== '' ? scope.label.trim().slice(0, 160) : undefined
  return { kind: scope.kind, ...(id === undefined ? {} : { id }), ...(label === undefined ? {} : { label }) }
}

function cleanEvidence(value: unknown): MemoryEvidence[] {
  if (!Array.isArray(value)) return []
  const out: MemoryEvidence[] = []
  for (const raw of value.slice(0, 8)) {
    if (raw === null || typeof raw !== 'object') continue
    const item = raw as Partial<MemoryEvidence>
    if (!['user', 'tool', 'assistant', 'manual', 'migration'].includes(String(item.kind))) continue
    if (typeof item.quote !== 'string' || item.quote.trim() === '') continue
    out.push({
      kind: item.kind as MemoryEvidence['kind'],
      quote: item.quote.trim().slice(0, 500),
      ...(typeof item.sourceId === 'string' && item.sourceId !== '' ? { sourceId: item.sourceId.slice(0, 300) } : {}),
      ...(typeof item.sessionId === 'string' && item.sessionId !== '' ? { sessionId: item.sessionId.slice(0, 200) } : {}),
      ...(typeof item.turn === 'number' && Number.isSafeInteger(item.turn) && item.turn >= 0 ? { turn: item.turn } : {}),
      ...(typeof item.eventSeq === 'number' && Number.isSafeInteger(item.eventSeq) && item.eventSeq >= 0 ? { eventSeq: item.eventSeq } : {}),
      ...(typeof item.messageId === 'string' && item.messageId !== '' ? { messageId: item.messageId.slice(0, 200) } : {}),
      ...(typeof item.callId === 'string' && item.callId !== '' ? { callId: item.callId.slice(0, 200) } : {}),
      ...(typeof item.digest === 'string' && item.digest !== '' ? { digest: item.digest.slice(0, 128) } : {}),
      createdAt: typeof item.createdAt === 'number' && item.createdAt > 0 ? item.createdAt : Date.now(),
    })
  }
  return out
}

function contentHash(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

function asStoredEntry(data: unknown, id: string): StoredMemoryEntry | undefined {
  if (data === null || typeof data !== 'object') return undefined
  const value = data as Partial<StoredMemoryEntry>
  if (typeof value.content !== 'string' || typeof value.createdAt !== 'number') return undefined
  return {
    id,
    content: value.content,
    category: CATEGORIES.has(value.category as NativeMemoryCategory) ? value.category as NativeMemoryCategory : 'general',
    tags: Array.isArray(value.tags) ? value.tags.filter((tag): tag is string => typeof tag === 'string') : [],
    source: typeof value.source === 'string' && value.source !== '' ? value.source : 'native',
    ...(typeof value.sourceId === 'string' && value.sourceId !== '' ? { sourceId: value.sourceId } : {}),
    importance: typeof value.importance === 'number' ? Math.max(1, Math.min(5, Math.round(value.importance))) : 3,
    createdAt: value.createdAt,
    updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : value.createdAt,
    ...(typeof value.migrationKey === 'string' && value.migrationKey !== '' ? { migrationKey: value.migrationKey } : {}),
    ...(value.pinned === true ? { pinned: true } : {}),
    ...(value.archived === true ? { archived: true } : {}),
  }
}

function fallbackMeta(entry: StoredMemoryEntry): MemoryEntryMeta {
  return {
    entryId: entry.id,
    schemaVersion: 2,
    revision: 1,
    state: entry.archived === true ? 'archived' : 'active',
    trust: 'legacy',
    confidence: entry.pinned === true ? 0.9 : 0.5,
    scope: { kind: 'global' },
    contentHash: contentHash(entry.content),
    evidence: [],
    supersedes: [],
    accessCount: 0,
    usedCount: 0,
    helpfulCount: 0,
    harmfulCount: 0,
    updatedAt: entry.updatedAt,
  }
}

function asMeta(data: unknown, entry: StoredMemoryEntry): MemoryEntryMeta {
  const fallback = fallbackMeta(entry)
  if (data === null || typeof data !== 'object') return fallback
  const value = data as Partial<MemoryEntryMeta>
  const state = ['active', 'superseded', 'archived', 'quarantined'].includes(String(value.state)) ? value.state as MemoryEntryMeta['state'] : fallback.state
  const trust = TRUST_LEVELS.has(value.trust as MemoryTrust) ? value.trust as MemoryTrust : fallback.trust
  return {
    entryId: entry.id,
    schemaVersion: 2,
    revision: typeof value.revision === 'number' && Number.isSafeInteger(value.revision) && value.revision > 0 ? value.revision : 1,
    state,
    trust,
    confidence: cleanConfidence(value.confidence, fallback.confidence),
    scope: cleanScope(value.scope),
    ...(typeof value.memoryKey === 'string' && value.memoryKey.trim() !== '' ? { memoryKey: value.memoryKey.trim().slice(0, 300) } : {}),
    contentHash: typeof value.contentHash === 'string' && value.contentHash !== '' ? value.contentHash : fallback.contentHash,
    evidence: cleanEvidence(value.evidence),
    supersedes: Array.isArray(value.supersedes) ? value.supersedes.filter((id): id is string => typeof id === 'string').slice(0, 50) : [],
    ...(typeof value.supersededBy === 'string' && value.supersededBy !== '' ? { supersededBy: value.supersededBy } : {}),
    ...(typeof value.validUntil === 'number' && value.validUntil > 0 ? { validUntil: value.validUntil } : {}),
    accessCount: cleanCounter(value.accessCount),
    usedCount: cleanCounter(value.usedCount),
    helpfulCount: cleanCounter(value.helpfulCount),
    harmfulCount: cleanCounter(value.harmfulCount),
    ...(typeof value.lastAccessedAt === 'number' && value.lastAccessedAt > 0 ? { lastAccessedAt: value.lastAccessedAt } : {}),
    updatedAt: typeof value.updatedAt === 'number' && value.updatedAt > 0 ? value.updatedAt : entry.updatedAt,
  }
}

function hydrateEntry(entry: StoredMemoryEntry, meta: MemoryEntryMeta): NativeMemoryEntry {
  const inactive = meta.state !== 'active'
  return {
    ...entry,
    trust: meta.trust,
    state: meta.state,
    revision: meta.revision,
    supersedes: meta.supersedes,
    ...(meta.supersededBy === undefined ? {} : { supersededBy: meta.supersededBy }),
    confidence: meta.confidence,
    scope: meta.scope,
    ...(meta.memoryKey === undefined ? {} : { memoryKey: meta.memoryKey }),
    evidence: meta.evidence,
    ...(meta.validUntil === undefined ? {} : { validUntil: meta.validUntil }),
    accessCount: meta.accessCount,
    usedCount: meta.usedCount,
    helpfulCount: meta.helpfulCount,
    harmfulCount: meta.harmfulCount,
    ...(meta.lastAccessedAt === undefined ? {} : { lastAccessedAt: meta.lastAccessedAt }),
    ...(inactive ? { archived: true } : entry.archived === true ? { archived: true } : {}),
  }
}

/** 检索分词：拉丁/数字连续段取词，中文按二元组切分。 */
export function tokenizeForMatch(text: string): string[] {
  const lowered = text.toLocaleLowerCase()
  const tokens: string[] = []
  for (const word of lowered.match(/[a-z0-9][a-z0-9.+#-]*/gu) ?? []) if (word.length >= 2) tokens.push(word)
  for (const run of lowered.match(/[\u4e00-\u9fff]+/gu) ?? []) {
    if (run.length === 1) { tokens.push(run); continue }
    for (let index = 0; index < run.length - 1; index += 1) tokens.push(run.slice(index, index + 2))
  }
  return [...new Set(tokens)]
}

/** 提取版本号、提交号和绝对路径等必须逐字匹配的实体。 */
export function extractExactEntities(query: string): string[] {
  const lowered = query.toLocaleLowerCase()
  const found: string[] = []
  for (const match of lowered.matchAll(/\b\d+\.\d+\.\d+(?:[-.]\w+)*\b/gu)) found.push(match[0])
  for (const match of lowered.matchAll(/\b[a-f0-9]{7,40}\b/gu)) found.push(match[0])
  for (const match of lowered.matchAll(/(?:\/[\w.@+-]+){2,}/gu)) found.push(match[0])
  for (const match of lowered.matchAll(/[a-z]:\\(?:[\w. -]+\\?)+/giu)) found.push(match[0].toLocaleLowerCase())
  return [...new Set(found)].slice(0, 8)
}

function recencyBoost(updatedAt: number, now: number): number {
  const ageDays = (now - updatedAt) / 86_400_000
  if (ageDays <= 7) return 0.1
  if (ageDays <= 30) return 0.05
  return 0
}

function trustScore(trust: MemoryTrust): number {
  if (trust === 'confirmed') return 1
  if (trust === 'verified') return 0.85
  if (trust === 'inferred') return 0.55
  return 0.35
}

/** 内置记忆 CRUD、版本元数据和可解释词法检索门面。 */
export class NativeMemoryStore {
  private readonly rag: RagStore

  constructor(rag: RagStore) { this.rag = rag }

  list(options?: { limit?: number; category?: NativeMemoryCategory; scope?: MemoryScopeContext; isolateScope?: boolean }): NativeMemoryEntry[] {
    const limit = Math.max(1, Math.min(1000, Math.floor(options?.limit ?? 100)))
    return this.all().filter((entry) => this.isRecallable(entry, options?.scope, options?.isolateScope === true) && (options?.category === undefined || entry.category === options.category)).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit)
  }

  /** 常驻记忆也遵守项目作用域，项目红线不会泄露到其他仓库。 */
  listPinned(options?: { limit?: number; scope?: MemoryScopeContext; isolateScope?: boolean }): NativeMemoryEntry[] {
    const limit = Math.max(1, Math.min(20, Math.floor(options?.limit ?? 6)))
    return this.all().filter((entry) => entry.pinned === true && this.isRecallable(entry, options?.scope, options?.isolateScope === true)).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit)
  }

  get(id: string): NativeMemoryEntry | undefined {
    if (!this.validId(id)) return undefined
    const row = this.rag.listDomainDocs(NATIVE_MEMORY_DOMAIN).find((item) => item.id === id)
    if (row === undefined) return undefined
    const stored = asStoredEntry(row.data, row.id)
    if (stored === undefined) return undefined
    return hydrateEntry(stored, this.metaFor(stored))
  }

  getMeta(id: string): MemoryEntryMeta | undefined {
    const entryRow = this.rag.listDomainDocs(NATIVE_MEMORY_DOMAIN).find((item) => item.id === id)
    if (entryRow === undefined) return undefined
    const stored = asStoredEntry(entryRow.data, entryRow.id)
    return stored === undefined ? undefined : this.metaFor(stored)
  }

  create(input: NativeMemoryInput, id?: string): NativeMemoryEntry {
    const now = Date.now()
    const entryId = id ?? randomUUID()
    const stored = this.normalizeStored(input, entryId, now, now)
    const meta = this.normalizeMeta(input, stored, undefined, now)
    this.rag.withDomainTransaction(() => {
      this.rag.putDomainDoc(NATIVE_MEMORY_DOMAIN, entryId, stored)
      this.rag.putDomainDoc(MEMORY_META_DOMAIN, entryId, meta)
    })
    return hydrateEntry(stored, meta)
  }

  update(id: string, patch: NativeMemoryPatch, expectedUpdatedAt?: number): NativeMemoryEntry {
    const current = this.get(id)
    const currentMeta = this.getMeta(id)
    if (current === undefined || currentMeta === undefined) throw new Error('记忆不存在：' + id)
    if (currentMeta.state !== 'active') throw new Error('非活跃记忆不可直接更新，请先通过对应治理流程处理：' + id)
    if (expectedUpdatedAt !== undefined && current.updatedAt !== expectedUpdatedAt) throw new Error('记忆已被其他操作更新，请刷新后重试')
    const now = Date.now()
    const stored = this.normalizeStored({ ...current, ...patch }, id, current.createdAt, now)
    const meta = this.normalizeMeta({ ...current, ...patch }, stored, currentMeta, now)
    this.rag.withDomainTransaction(() => {
      this.rag.putDomainDoc(NATIVE_MEMORY_DOMAIN, id, stored)
      this.rag.putDomainDoc(MEMORY_META_DOMAIN, id, meta)
    })
    return hydrateEntry(stored, meta)
  }

  /**
   * 原子取代一组活跃事实：新条目写入与旧条目失效、关系记录同事务提交。
   * 钉选条目必须由调用方先显式取消，避免普通候选绕过生产红线保护。
   */
  supersede(ids: readonly string[], input: NativeMemoryInput, reason: string, actor: MemoryRelation['actor'] = 'user'): NativeMemoryEntry {
    const uniqueIds = [...new Set(ids)]
    if (uniqueIds.length === 0) throw new Error('取代至少需要一个旧记忆 id')
    const old = uniqueIds.map((id) => ({ entry: this.get(id), meta: this.getMeta(id) }))
    if (old.some((item) => item.entry === undefined || item.meta === undefined)) throw new Error('待取代记忆不存在')
    if (old.some((item) => item.meta?.state !== 'active')) throw new Error('只能取代活跃记忆')
    if (old.some((item) => item.entry?.pinned === true)) throw new Error('钉选条目不可直接取代，请先人工取消钉选')
    const now = Date.now()
    const entryId = randomUUID()
    const stored = this.normalizeStored({ ...input, archived: false }, entryId, now, now)
    const newMeta = this.normalizeMeta({ ...input, archived: false }, stored, undefined, now)
    newMeta.supersedes = uniqueIds
    this.rag.withDomainTransaction(() => {
      this.rag.putDomainDoc(NATIVE_MEMORY_DOMAIN, entryId, stored)
      this.rag.putDomainDoc(MEMORY_META_DOMAIN, entryId, newMeta)
      for (const item of old) {
        const oldEntry = item.entry!
        const oldMeta = item.meta!
        const oldStored = this.normalizeStored({ ...oldEntry, archived: true }, oldEntry.id, oldEntry.createdAt, now)
        const supersededMeta: MemoryEntryMeta = { ...oldMeta, state: 'superseded', supersededBy: entryId, revision: oldMeta.revision + 1, updatedAt: now }
        const relation: MemoryRelation = { id: randomUUID(), kind: 'supersedes', fromEntryId: entryId, toEntryId: oldEntry.id, reason: reason.slice(0, 500), actor, createdAt: now }
        this.rag.putDomainDoc(NATIVE_MEMORY_DOMAIN, oldEntry.id, oldStored)
        this.rag.putDomainDoc(MEMORY_META_DOMAIN, oldEntry.id, supersededMeta)
        this.rag.putDomainDoc(MEMORY_RELATION_DOMAIN, relation.id, relation)
      }
    })
    return hydrateEntry(stored, newMeta)
  }

  /** 读取取代/冲突/重复关系，供详情页和质量治理使用。 */
  listRelations(): MemoryRelation[] {
    return this.rag.listDomainDocs(MEMORY_RELATION_DOMAIN).flatMap((row) => {
      const value = row.data as Partial<MemoryRelation> | null
      if (value === null || typeof value !== 'object' || typeof value.fromEntryId !== 'string' || typeof value.toEntryId !== 'string') return []
      if (!['supersedes', 'conflicts-with', 'duplicates'].includes(String(value.kind))) return []
      return [{ id: row.id, kind: value.kind as MemoryRelation['kind'], fromEntryId: value.fromEntryId, toEntryId: value.toEntryId, reason: typeof value.reason === 'string' ? value.reason : '', actor: value.actor === 'dream' || value.actor === 'system' ? value.actor : 'user', createdAt: typeof value.createdAt === 'number' ? value.createdAt : 0 }]
    })
  }

  delete(id: string): boolean {
    if (!this.validId(id) || this.get(id) === undefined) return false
    this.rag.withDomainTransaction(() => {
      this.rag.deleteDomainDoc(NATIVE_MEMORY_DOMAIN, id)
      this.rag.deleteDomainDoc(MEMORY_META_DOMAIN, id)
    })
    return true
  }

  search(query: string, options?: { limit?: number; category?: NativeMemoryCategory; scope?: MemoryScopeContext; isolateScope?: boolean }): NativeMemoryEntry[] {
    return this.searchDetailed(query, options).map((hit) => hit.entry)
  }

  /** 返回可解释分数，供 RRF 融合、召回轨迹和面板诊断复用。 */
  searchDetailed(query: string, options?: { limit?: number; category?: NativeMemoryCategory; scope?: MemoryScopeContext; isolateScope?: boolean }): MemorySearchHit[] {
    if (typeof query !== 'string' || query.trim() === '') return []
    const terms = tokenizeForMatch(cleanText(query, 'query', 500))
    if (terms.length === 0) return []
    const entities = extractExactEntities(query)
    const minHits = Math.min(2, terms.length)
    const now = Date.now()
    const result = this.all().filter((entry) => this.isRecallable(entry, options?.scope, options?.isolateScope === true) && (options?.category === undefined || entry.category === options.category)).map((entry) => {
      const haystack = (entry.content + ' ' + entry.tags.join(' ') + ' ' + entry.category).toLocaleLowerCase()
      const matchedTerms = terms.filter((term) => haystack.includes(term))
      const entityHits = entities.filter((entity) => haystack.includes(entity)).slice(0, 2)
      const lexicalScore = matchedTerms.length / terms.length + entityHits.length * 0.3 + recencyBoost(entry.updatedAt, now)
      const qualityScore = trustScore(entry.trust) * 0.08 + entry.confidence * 0.04 + entry.importance * 0.001
      const scopeScore = entry.scope.kind === 'global' ? 0 : 0.03
      return { entry, effectiveHits: matchedTerms.length + (entityHits.length > 0 ? 1 : 0), hit: { entry, score: lexicalScore + qualityScore + scopeScore, lexicalScore, semanticScore: 0, qualityScore, scopeScore, matchedTerms, entityHits } }
    }).filter((item) => item.effectiveHits >= minHits).sort((a, b) => b.hit.score - a.hit.score || b.entry.updatedAt - a.entry.updatedAt)
    return result.slice(0, Math.max(1, Math.min(200, Math.floor(options?.limit ?? 20)))).map((item) => item.hit)
  }

  /** 记录真实曝光；不在检索阶段更新，只有最终装入上下文后才计数。 */
  markAccessed(ids: readonly string[]): void {
    const now = Date.now()
    for (const id of [...new Set(ids)]) {
      const meta = this.getMeta(id)
      if (meta === undefined) continue
      this.writeMeta({ ...meta, accessCount: meta.accessCount + 1, lastAccessedAt: now, updatedAt: meta.updatedAt })
    }
  }

  /** 记录任务复盘明确声明实际使用了哪些召回记忆。 */
  markUsed(ids: readonly string[]): void {
    for (const id of [...new Set(ids)]) {
      const meta = this.getMeta(id)
      if (meta !== undefined) this.writeMeta({ ...meta, usedCount: meta.usedCount + 1 })
    }
  }

  /** 反馈只累计质量事实；useful 不会自动改变排序、信任、作用域或钉选。 */
  markFeedback(id: string, helpful: boolean): void {
    const meta = this.getMeta(id)
    if (meta === undefined) throw new Error('记忆不存在：' + id)
    this.writeMeta({ ...meta, helpfulCount: meta.helpfulCount + (helpful ? 1 : 0), harmfulCount: meta.harmfulCount + (helpful ? 0 : 1) })
  }

  dreamSnapshot(limit: number): NativeMemoryEntry[] {
    return this.all().filter((entry) => this.isRecallable(entry)).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, Math.max(1, Math.floor(limit)))
  }

  activityFingerprint(): { count: number; maxUpdatedAt: number } {
    const active = this.all().filter((entry) => this.isRecallable(entry))
    return { count: active.length, maxUpdatedAt: active.reduce((max, entry) => Math.max(max, entry.updatedAt), 0) }
  }

  activeCount(): number { return this.all().filter((entry) => this.isRecallable(entry)).length }

  archive(id: string, value: boolean): NativeMemoryEntry {
    const entry = this.get(id)
    const meta = this.getMeta(id)
    if (entry === undefined || meta === undefined) throw new Error('记忆不存在：' + id)
    if (value && meta.state !== 'active') throw new Error('只有活跃记忆可以归档：' + id)
    if (!value && meta.state !== 'archived') throw new Error('只有人工归档的记忆可以恢复：' + id)
    if (value && entry.pinned === true) throw new Error('钉选条目不可归档，请先取消钉选：' + id)
    const now = Date.now()
    const stored = this.normalizeStored({ ...entry, archived: value }, id, entry.createdAt, now)
    const nextMeta: MemoryEntryMeta = { ...meta, state: value ? 'archived' : 'active', revision: meta.revision + 1, updatedAt: now }
    this.rag.withDomainTransaction(() => {
      this.rag.putDomainDoc(NATIVE_MEMORY_DOMAIN, id, stored)
      this.rag.putDomainDoc(MEMORY_META_DOMAIN, id, nextMeta)
    })
    return hydrateEntry(stored, nextMeta)
  }

  /** 错误/过期反馈可隔离条目，等待人工修订；隔离不是硬删除。 */
  quarantine(id: string): NativeMemoryEntry {
    const entry = this.get(id)
    const meta = this.getMeta(id)
    if (entry === undefined || meta === undefined) throw new Error('记忆不存在：' + id)
    if (meta.state !== 'active') throw new Error('只有活跃记忆可以隔离：' + id)
    if (entry.pinned === true) throw new Error('钉选条目不可自动隔离，请先人工处理：' + id)
    const now = Date.now()
    const stored = this.normalizeStored({ ...entry, archived: true }, id, entry.createdAt, now)
    const nextMeta: MemoryEntryMeta = { ...meta, state: 'quarantined', revision: meta.revision + 1, updatedAt: now }
    this.rag.withDomainTransaction(() => {
      this.rag.putDomainDoc(NATIVE_MEMORY_DOMAIN, id, stored)
      this.rag.putDomainDoc(MEMORY_META_DOMAIN, id, nextMeta)
    })
    return hydrateEntry(stored, nextMeta)
  }

  listArchived(options?: { limit?: number; states?: Array<'archived' | 'superseded' | 'quarantined'> }): NativeMemoryEntry[] {
    const limit = Math.max(1, Math.min(1000, Math.floor(options?.limit ?? 100)))
    const states = new Set(options?.states ?? ['archived'])
    return this.all().filter((entry) => entry.state !== 'active' && states.has(entry.state)).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit)
  }

  /** 全部条目供治理统计使用；调用方不得把该结果直接注入模型。 */
  listAll(options?: { limit?: number }): NativeMemoryEntry[] {
    const limit = Math.max(1, Math.min(10_000, Math.floor(options?.limit ?? 10_000)))
    return this.all().sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit)
  }

  listMetas(): MemoryEntryMeta[] {
    const storedById = new Map(this.rag.listDomainDocs(NATIVE_MEMORY_DOMAIN).map((row) => [row.id, asStoredEntry(row.data, row.id)]))
    return [...storedById.entries()].flatMap(([id, stored]) => stored === undefined ? [] : [this.getMeta(id) ?? fallbackMeta(stored)])
  }

  /** 基于真实状态计算质量基线；候选、复盘和反馈域计数由治理服务补齐。 */
  qualityBase(): MemoryQualityStats {
    const metas = this.listMetas()
    const now = Date.now()
    const empty: MemoryQualityStats = { active: 0, candidates: 0, superseded: 0, archived: 0, quarantined: 0, scoped: 0, confirmed: 0, verified: 0, inferred: 0, legacy: 0, conflicts: 0, expired: 0, helpful: 0, irrelevant: 0, incorrect: 0, outdated: 0, episodes: 0, retrievals: 0 }
    for (const meta of metas) {
      empty[meta.state] += 1
      empty[meta.trust] += 1
      if (meta.scope.kind !== 'global') empty.scoped += 1
      if (meta.validUntil !== undefined && meta.validUntil <= now) empty.expired += 1
      empty.helpful += meta.helpfulCount
      empty.incorrect += meta.harmfulCount
    }
    return empty
  }

  /** 批量导入保持幂等，但外部来源默认 legacy，后续由候选治理升级信任。 */
  migrate(items: NativeMemoryMigrationItem[]): NativeMemoryMigrationResult {
    if (!Array.isArray(items)) throw new Error('items 必须是数组')
    const result: NativeMemoryMigrationResult = { scanned: items.length, added: 0, updated: 0, skipped: 0 }
    for (const item of items) {
      try {
        const key = typeof item.migrationKey === 'string' ? cleanText(item.migrationKey, 'migrationKey', 300) : undefined
        const existing = key === undefined ? (item.id === undefined ? undefined : this.get(item.id)) : this.all().find((entry) => entry.migrationKey === key)
        const normalized = { ...item, trust: item.trust ?? 'legacy', ...(key === undefined ? {} : { migrationKey: key }) } satisfies NativeMemoryInput
        if (existing === undefined) { this.create(normalized, item.id); result.added += 1 }
        else { this.update(existing.id, normalized); result.updated += 1 }
      } catch { result.skipped += 1 }
    }
    return result
  }

  migrationStatus(): { count: number; migrated: number; lastUpdatedAt: number } {
    const entries = this.all()
    return { count: entries.length, migrated: entries.filter((entry) => entry.migrationKey !== undefined).length, lastUpdatedAt: entries.reduce((max, entry) => Math.max(max, entry.updatedAt), 0) }
  }

  private all(): NativeMemoryEntry[] {
    const metas = new Map(this.rag.listDomainDocs(MEMORY_META_DOMAIN).map((row) => [row.id, row.data]))
    return this.rag.listDomainDocs(NATIVE_MEMORY_DOMAIN).flatMap((row) => {
      const stored = asStoredEntry(row.data, row.id)
      return stored === undefined ? [] : [hydrateEntry(stored, asMeta(metas.get(row.id), stored))]
    })
  }

  private metaFor(stored: StoredMemoryEntry): MemoryEntryMeta {
    const row = this.rag.listDomainDocs(MEMORY_META_DOMAIN).find((item) => item.id === stored.id)
    return asMeta(row?.data, stored)
  }

  private isRecallable(entry: NativeMemoryEntry, scope?: MemoryScopeContext, isolate = false): boolean {
    if (entry.archived === true) return false
    if (entry.validUntil !== undefined && entry.validUntil <= Date.now()) return false
    return scope === undefined ? true : memoryScopeMatches(entry, scope, isolate)
  }

  private normalizeStored(input: NativeMemoryInput, id: string, createdAt: number, updatedAt: number): StoredMemoryEntry {
    const content = cleanText(input.content, 'content', 20_000)
    const category = cleanCategory(input.category)
    const tags = cleanTags(input.tags)
    const source = input.source === undefined ? 'native' : cleanText(input.source, 'source', 120)
    const sourceId = input.sourceId === undefined ? undefined : cleanText(input.sourceId, 'sourceId', 300)
    const migrationKey = input.migrationKey === undefined ? undefined : cleanText(input.migrationKey, 'migrationKey', 300)
    return { id, content, category, tags, source, ...(sourceId === undefined ? {} : { sourceId }), importance: cleanImportance(input.importance), createdAt, updatedAt, ...(migrationKey === undefined ? {} : { migrationKey }), ...(input.pinned === true ? { pinned: true } : {}), ...(input.archived === true ? { archived: true } : {}) }
  }

  private normalizeMeta(input: NativeMemoryInput, stored: StoredMemoryEntry, current: MemoryEntryMeta | undefined, now: number): MemoryEntryMeta {
    const trust = TRUST_LEVELS.has(input.trust as MemoryTrust) ? input.trust as MemoryTrust : current?.trust ?? 'legacy'
    const scope = input.scope === undefined ? current?.scope ?? { kind: 'global' } : cleanScope(input.scope)
    const archived = input.archived === true
    return {
      entryId: stored.id,
      schemaVersion: 2,
      revision: (current?.revision ?? 0) + 1,
      state: archived ? 'archived' : current?.state === 'superseded' || current?.state === 'quarantined' ? current.state : 'active',
      trust,
      confidence: cleanConfidence(input.confidence, current?.confidence ?? (trust === 'confirmed' ? 1 : trust === 'verified' ? 0.85 : trust === 'inferred' ? 0.6 : 0.5)),
      scope,
      ...(typeof input.memoryKey === 'string' && input.memoryKey.trim() !== '' ? { memoryKey: input.memoryKey.trim().slice(0, 300) } : current?.memoryKey === undefined ? {} : { memoryKey: current.memoryKey }),
      contentHash: contentHash(stored.content),
      evidence: input.evidence === undefined ? current?.evidence ?? [] : cleanEvidence(input.evidence),
      supersedes: current?.supersedes ?? [],
      ...(current?.supersededBy === undefined ? {} : { supersededBy: current.supersededBy }),
      ...(typeof input.validUntil === 'number' && input.validUntil > 0 ? { validUntil: input.validUntil } : current?.validUntil === undefined ? {} : { validUntil: current.validUntil }),
      accessCount: cleanCounter(input.accessCount ?? current?.accessCount),
      usedCount: cleanCounter(input.usedCount ?? current?.usedCount),
      helpfulCount: cleanCounter(input.helpfulCount ?? current?.helpfulCount),
      harmfulCount: cleanCounter(input.harmfulCount ?? current?.harmfulCount),
      ...(typeof input.lastAccessedAt === 'number' && input.lastAccessedAt > 0 ? { lastAccessedAt: input.lastAccessedAt } : current?.lastAccessedAt === undefined ? {} : { lastAccessedAt: current.lastAccessedAt }),
      updatedAt: now,
    }
  }

  private writeMeta(meta: MemoryEntryMeta): void { this.rag.putDomainDoc(MEMORY_META_DOMAIN, meta.entryId, meta) }

  private validId(id: string): boolean { return typeof id === 'string' && /^[A-Za-z0-9_-]{1,160}$/u.test(id) }
}
