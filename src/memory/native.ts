/**
 * 天工造梦内置记忆域：使用 store.db 的 docs 域 memory.entry 持久化。
 * 不依赖 Mnemon/Hindsight，外部记忆仅作为可选迁移来源。
 */
import { randomUUID } from 'node:crypto'
import type { RagStore } from '../rag/rag-store.ts'
import type { NativeMemoryCategory, NativeMemoryEntry, NativeMemoryInput, NativeMemoryMigrationItem, NativeMemoryMigrationResult, NativeMemoryPatch } from './protocol.ts'

// 类型契约统一放 protocol.ts（纯类型），这里只做运行时存储实现。
export type { NativeMemoryCategory, NativeMemoryEntry, NativeMemoryInput, NativeMemoryMigrationItem, NativeMemoryMigrationResult, NativeMemoryPatch }

export const NATIVE_MEMORY_DOMAIN = 'memory.entry'

const CATEGORIES = new Set<NativeMemoryCategory>(['preference', 'decision', 'fact', 'insight', 'context', 'general'])

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

function asEntry(data: unknown, id: string): NativeMemoryEntry | undefined {
  if (data === null || typeof data !== 'object') return undefined
  const value = data as Partial<NativeMemoryEntry>
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

/**
 * 检索分词（导出供单测）：拉丁/数字连续段取词（长度 ≥ 2），中文按二元组（bigram）切分。
 * 中文没有空格分隔，旧的「整段子串包含」匹配对中文查询几乎永远落空、对英文样板
 * 查询又过于宽松；词元 + 二元组是零依赖下「中文能命中、英文有门槛」的折中。
 */
export function tokenizeForMatch(text: string): string[] {
  const lowered = text.toLocaleLowerCase()
  const tokens: string[] = []
  for (const word of lowered.match(/[a-z0-9][a-z0-9.+#-]*/gu) ?? []) {
    if (word.length >= 2) tokens.push(word)
  }
  for (const run of lowered.match(/[\u4e00-\u9fff]+/gu) ?? []) {
    if (run.length === 1) { tokens.push(run); continue }
    for (let index = 0; index < run.length - 1; index += 1) tokens.push(run.slice(index, index + 2))
  }
  return [...new Set(tokens)]
}

/**
 * 精确实体提取（导出供单测）：从查询里抽取版本号、git 提交号、绝对路径这类
 * 「逐字命中才算数」的实体。中文长查询会产生海量二元组，把这类实体的信号
 * 稀释掉（0.26.3 被 30 个 bigram 摊薄后与沾边旧文档同分）；实体逐字命中
 * 必须能在排序里明确优先。
 */
export function extractExactEntities(query: string): string[] {
  const lowered = query.toLocaleLowerCase()
  const found: string[] = []
  for (const match of lowered.matchAll(/\b\d+\.\d+\.\d+(?:[-.]\w+)*\b/gu)) found.push(match[0]) // 语义化版本号（0.26.3 / 0.26.3-beta.1）
  for (const match of lowered.matchAll(/\b[a-f0-9]{7,40}\b/gu)) found.push(match[0]) // git 提交号（短/长哈希）
  for (const match of lowered.matchAll(/(?:\/[\w.@+-]+){2,}/gu)) found.push(match[0]) // Unix 绝对路径
  for (const match of lowered.matchAll(/[a-z]:\\(?:[\w. -]+\\?)+/giu)) found.push(match[0].toLocaleLowerCase()) // Windows 路径
  return [...new Set(found)].slice(0, 8)
}

/** 有界新近度加分：7 天内 +0.1，30 天内 +0.05。
 * 让「最新的正确事实」稳定压过同分的旧长文，但不大到能让只沾边的
 * 新条目爬到强相关旧条目头上（覆盖度差距通常 ≥ 0.1）。 */
function recencyBoost(updatedAt: number, now: number): number {
  const ageDays = (now - updatedAt) / 86_400_000
  if (ageDays <= 7) return 0.1
  if (ageDays <= 30) return 0.05
  return 0
}

/** 内置记忆 CRUD 与关键词检索门面。 */
export class NativeMemoryStore {
  private readonly rag: RagStore

  constructor(rag: RagStore) { this.rag = rag }

  list(options?: { limit?: number; category?: NativeMemoryCategory }): NativeMemoryEntry[] {
    const limit = Math.max(1, Math.min(200, Math.floor(options?.limit ?? 100)))
    // 归档条目（做梦/手动整理的软删除产物）不进常规清单：面板、注入、图谱都只见活跃记忆。
    return this.all().filter((entry) => entry.archived !== true && (options?.category === undefined || entry.category === options.category)).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit)
  }

  /**
   * 常驻记忆清单：仅手动钉选（pinned），每轮固定注入。
   * 召回式检索覆盖不了「每轮必须知道」的红线与长期约定（与用户身份卡同哲学）；
   * 不引入 importance 自动常驻——沉淀模型的 critical 会通膨（实测把一次性状态
   * 也标成 critical），自动常驻会把噪音焊死在每轮上下文里；钉选必须显式操作，
   * 可控可审计。按更新时间新到旧、条数有上限，防止常驻层无限膨胀。
   */
  listPinned(options?: { limit?: number }): NativeMemoryEntry[] {
    const limit = Math.max(1, Math.min(20, Math.floor(options?.limit ?? 6)))
    return this.all()
      .filter((entry) => entry.pinned === true && entry.archived !== true)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, limit)
  }

  get(id: string): NativeMemoryEntry | undefined {
    if (!this.validId(id)) return undefined
    const row = this.rag.listDomainDocs(NATIVE_MEMORY_DOMAIN).find((item) => item.id === id)
    return row === undefined ? undefined : asEntry(row.data, row.id)
  }

  create(input: NativeMemoryInput, id?: string): NativeMemoryEntry {
    const now = Date.now()
    const entry = this.normalizeInput(input, id ?? randomUUID(), now, now)
    this.rag.putDomainDoc(NATIVE_MEMORY_DOMAIN, entry.id, entry)
    return entry
  }

  update(id: string, patch: NativeMemoryPatch): NativeMemoryEntry {
    const current = this.get(id)
    if (current === undefined) throw new Error('记忆不存在：' + id)
    const next = this.normalizeInput({ ...current, ...patch }, id, current.createdAt, Date.now())
    this.rag.putDomainDoc(NATIVE_MEMORY_DOMAIN, id, next)
    return next
  }

  delete(id: string): boolean {
    if (!this.validId(id) || this.get(id) === undefined) return false
    this.rag.deleteDomainDoc(NATIVE_MEMORY_DOMAIN, id)
    return true
  }

  search(query: string, options?: { limit?: number; category?: NativeMemoryCategory }): NativeMemoryEntry[] {
    // 空查询直接返回空清单（不再抛错）：面板与注入层的调用都更省心。
    if (typeof query !== 'string' || query.trim() === '') return []
    const terms = tokenizeForMatch(cleanText(query, 'query', 500))
    if (terms.length === 0) return []
    // 相关性门槛：至少命中 2 个不同词元（查询本身只有一个词元时命中 1 个即可）。
    // 旧实现「沾一个词就入围」，英文样板查询里的 DSH 之类常见词会把无关记忆全带进注入。
    // 精确实体逐字命中额外计 1 个词元（版本号/提交号这类实体往往只对应一个 token，
    // 不加记会被「至少 2 词元」门槛误杀）。
    const entities = extractExactEntities(query)
    const minHits = Math.min(2, terms.length)
    const now = Date.now()
    // 全量扫描活跃条目（旧实现只看最新 200 条：超过窗口的旧精确条目永远搜不到）。
    return this.all()
      .filter((entry) => entry.archived !== true && (options?.category === undefined || entry.category === options.category))
      .map((entry) => {
        const haystack = (entry.content + ' ' + entry.tags.join(' ') + ' ' + entry.category).toLocaleLowerCase()
        const hits = terms.filter((term) => haystack.includes(term)).length
        let score = hits / terms.length + entry.importance * 0.001
        let entityHits = 0
        for (const entity of entities) {
          if (haystack.includes(entity)) {
            entityHits += 1
            score += 0.3
            if (entityHits >= 2) break // 两个以上实体齐中视为强相关，加分封顶
          }
        }
        return { entry, effectiveHits: hits + (entityHits > 0 ? 1 : 0), score: score + recencyBoost(entry.updatedAt, now) }
      })
      .filter((item) => item.effectiveHits >= minHits)
      .sort((a, b) => b.score - a.score || b.entry.updatedAt - a.entry.updatedAt)
      .slice(0, Math.max(1, Math.min(100, Math.floor(options?.limit ?? 20))))
      .map((item) => item.entry)
  }

  /** 做梦快照：全部活跃记忆按更新时间新到旧（上限由调用方给定，不受 list 的面板 200 条上限约束）。 */
  dreamSnapshot(limit: number): NativeMemoryEntry[] {
    return this.all().filter((entry) => entry.archived !== true).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, Math.max(1, Math.floor(limit)))
  }

  /** 库活跃度指纹（活跃条数 + 最新更新时间）：做梦用同一口径判断「库是否变过」，无变化不重复整理。 */
  activityFingerprint(): { count: number; maxUpdatedAt: number } {
    const active = this.all().filter((entry) => entry.archived !== true)
    return { count: active.length, maxUpdatedAt: active.reduce((max, entry) => Math.max(max, entry.updatedAt), 0) }
  }

  /** 活跃条目数（status 路由的记忆总数口径：主存储真实条数，而非遗留 RAG 文档数）。 */
  activeCount(): number {
    return this.all().filter((entry) => entry.archived !== true).length
  }

  /** 归档/恢复：true=归档（软删除，可恢复），false=恢复活跃；钉选条目禁止归档（须先取消钉选）。 */
  archive(id: string, value: boolean): NativeMemoryEntry {
    const entry = this.get(id)
    if (entry === undefined) throw new Error('记忆不存在：' + id)
    if (value === true && entry.pinned === true) throw new Error('钉选条目不可归档，请先取消钉选：' + id)
    return this.update(id, { archived: value })
  }

  /** 归档清单（新到旧；面板「已归档」分组与恢复操作使用）。 */
  listArchived(options?: { limit?: number }): NativeMemoryEntry[] {
    const limit = Math.max(1, Math.min(500, Math.floor(options?.limit ?? 100)))
    return this.all().filter((entry) => entry.archived === true).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit)
  }

  /** 批量导入：优先按 migrationKey 幂等匹配，其次按显式 id 匹配。 */
  migrate(items: NativeMemoryMigrationItem[]): NativeMemoryMigrationResult {
    if (!Array.isArray(items)) throw new Error('items 必须是数组')
    const result: NativeMemoryMigrationResult = { scanned: items.length, added: 0, updated: 0, skipped: 0 }
    for (const item of items) {
      try {
        const key = typeof item.migrationKey === 'string' ? cleanText(item.migrationKey, 'migrationKey', 300) : undefined
        const existing = key === undefined ? (item.id === undefined ? undefined : this.get(item.id)) : this.all().find((entry) => entry.migrationKey === key)
        if (existing === undefined) { this.create({ ...item, ...(key === undefined ? {} : { migrationKey: key }) }, item.id); result.added += 1 }
        else { this.update(existing.id, { ...item, ...(key === undefined ? {} : { migrationKey: key }) }); result.updated += 1 }
      } catch { result.skipped += 1 }
    }
    return result
  }

  migrationStatus(): { count: number; migrated: number; lastUpdatedAt: number } {
    const entries = this.all()
    return { count: entries.length, migrated: entries.filter((entry) => entry.migrationKey !== undefined).length, lastUpdatedAt: entries.reduce((max, entry) => Math.max(max, entry.updatedAt), 0) }
  }

  private all(): NativeMemoryEntry[] { return this.rag.listDomainDocs(NATIVE_MEMORY_DOMAIN).map((row) => asEntry(row.data, row.id)).filter((entry): entry is NativeMemoryEntry => entry !== undefined) }

  private normalizeInput(input: NativeMemoryInput, id: string, createdAt: number, updatedAt: number): NativeMemoryEntry {
    if (!this.validId(id)) throw new Error('id 格式无效')
    const content = cleanText(input.content, 'content', 20_000)
    const category = cleanCategory(input.category)
    const tags = cleanTags(input.tags)
    const source = input.source === undefined ? 'native' : cleanText(input.source, 'source', 120)
    const sourceId = input.sourceId === undefined ? undefined : cleanText(input.sourceId, 'sourceId', 300)
    const migrationKey = input.migrationKey === undefined ? undefined : cleanText(input.migrationKey, 'migrationKey', 300)
    return { id, content, category, tags, source, ...(sourceId === undefined ? {} : { sourceId }), importance: cleanImportance(input.importance), createdAt, updatedAt, ...(migrationKey === undefined ? {} : { migrationKey }), ...(input.pinned === true ? { pinned: true } : {}), ...(input.archived === true ? { archived: true } : {}) }
  }

  private validId(id: string): boolean { return typeof id === 'string' && /^[A-Za-z0-9_-]{1,160}$/u.test(id) }
}
