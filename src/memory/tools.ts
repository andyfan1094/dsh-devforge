/**
 * 内置长期记忆 Agent 工具。
 *
 * 只读动作直接访问 active memory.entry；写动作接入治理服务后会回读当前会话的
 * 真实用户消息。只有明确“记住/确认保存”且内容对应时才直接激活，否则创建待审核候选。
 */
import { createHash } from 'node:crypto'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { checkMemoryAdmission } from './admission.ts'
import type { MemoryGovernanceService } from './governance.ts'
import { memoryScopeMatches } from './scope.ts'
import type { NativeMemoryStore } from './native.ts'
import type { MemoryCandidate, MemoryEvidence, MemoryQualification, MemoryScopeContext, NativeMemoryCategory, NativeMemoryEntry, RejectedMemory } from './protocol.ts'
import { pickNegativeCoverage } from './negatives.ts'

function text(value: string): Array<{ type: 'text'; text: string }> { return [{ type: 'text', text: value }] }

const categories: NativeMemoryCategory[] = ['preference', 'decision', 'fact', 'insight', 'context', 'general']
const scopeSchema = {
  type: 'object', additionalProperties: false,
  properties: { kind: { type: 'string', required: true, enum: ['global', 'project', 'workspace'] }, id: { type: 'string' }, label: { type: 'string' } },
} as const
const evidenceSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    kind: { type: 'string', required: true, enum: ['user', 'tool', 'assistant', 'manual', 'migration'] }, quote: { type: 'string', required: true },
    sourceId: { type: 'string' }, sessionId: { type: 'string' }, turn: { type: 'integer' }, eventSeq: { type: 'integer' }, messageId: { type: 'string' }, callId: { type: 'string' }, digest: { type: 'string' }, createdAt: { type: 'number', required: true },
  },
} as const
const entrySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true }, content: { type: 'string', required: true },
    category: { type: 'string', required: true, enum: categories }, tags: { type: 'array', required: true, items: { type: 'string' } },
    source: { type: 'string', required: true }, sourceId: { type: 'string' }, importance: { type: 'number', required: true },
    state: { type: 'string', required: true, enum: ['active', 'superseded', 'archived', 'quarantined'] }, revision: { type: 'integer', required: true },
    supersedes: { type: 'array', required: true, items: { type: 'string' } }, supersededBy: { type: 'string' },
    trust: { type: 'string', required: true, enum: ['confirmed', 'verified', 'inferred', 'legacy'] }, confidence: { type: 'number', required: true }, scope: { ...scopeSchema, required: true }, memoryKey: { type: 'string' },
    evidence: { type: 'array', required: true, items: evidenceSchema }, validUntil: { type: 'number' },
    accessCount: { type: 'integer', required: true }, usedCount: { type: 'integer', required: true }, helpfulCount: { type: 'integer', required: true }, harmfulCount: { type: 'integer', required: true }, lastAccessedAt: { type: 'number' },
    createdAt: { type: 'number', required: true }, updatedAt: { type: 'number', required: true }, migrationKey: { type: 'string' }, pinned: { type: 'boolean' }, archived: { type: 'boolean' },
  },
} as const

/**
 * 工具输出。
 *
 * `ok` 只表示「工具这次执行没出错」，**不代表记忆记住了**；`committed` 才是
 * 「本次是否真的落盘为长期记忆」（0.43.0 P1-4，契约移植自灵枢 dsh-memory）。
 * 重复（deduped）、待审核（pending/needs-resolution）、被拒（rejected）一律 committed:false，
 * 且在 `missing` 里写清要怎么补才能落盘——绝不把「受理」当「保存成功」。
 */
type MemoryToolOutput = { ok: boolean; action: string; committed?: boolean; pendingReason?: string; missing?: string[]; entry?: NativeMemoryEntry; entries?: NativeMemoryEntry[]; qualifications?: Array<{ id: string; qualification: MemoryQualification; reason: string }>; count?: number; message?: string }

/**
 * 检索结果的四态资格（P1-6）：显式检索这条路上没有注入层的说明文字，
 * 全靠这里告诉调用方「能不能直接采信」。负覆盖一律 REJECT，证据与相似度都够才 ACCEPT，
 * 其余 DEFER——不确定就给待确认，绝不把弱证据包装成定论。
 */
function gradeSearchHits(hits: Array<{ entry: NativeMemoryEntry; score: number }>, negatives: RejectedMemory[] | undefined): Array<{ id: string; qualification: MemoryQualification; reason: string }> {
  const topScore = hits.reduce((max, hit) => Math.max(max, hit.score), 0)
  return hits.map((hit) => {
    const negative = negatives === undefined ? undefined : pickNegativeCoverage(negatives, hit.entry.content)
    if (negative !== undefined) return { id: hit.entry.id, qualification: 'REJECT' as const, reason: '该说法已被否定：' + (negative.reason === '' ? '无原因说明' : negative.reason) }
    const trusted = hit.entry.trust === 'confirmed' || hit.entry.trust === 'verified'
    if (trusted && hit.score >= topScore * 0.8) return { id: hit.entry.id, qualification: 'ACCEPT' as const, reason: '证据与相似度足够' }
    return { id: hit.entry.id, qualification: 'DEFER' as const, reason: trusted ? '相似度不足，采用前请确认' : '证据等级偏低（' + hit.entry.trust + '），采用前请确认' }
  })
}

/** 未落盘时给出可照做的补齐清单：拒绝必须能修，而不是一句失败（P1-7）。 */
function resolutionMissing(candidate: MemoryCandidate): string[] {
  const missing: string[] = []
  if (candidate.state === 'needs-resolution') {
    const existing = candidate.conflictIds.length > 0 ? '（冲突记忆：' + candidate.conflictIds.join('、') + '）' : ''
    missing.push('冲突处理：这条与现有事实冲突' + existing + '。请说明是取代旧事实，还是并存的不同维度（可传 memoryKey 标明同一事实键）')
  }
  if (candidate.state === 'rejected') missing.push('写入被拒：' + (candidate.resolutionReason ?? '未说明原因'))
  if (missing.length === 0) missing.push('请补充更明确的来源证据（source/sourceId）后重试，或到记忆工作台审核该候选：' + candidate.id)
  return missing
}

function render(value: MemoryToolOutput): string {
  // 未落盘必须写在最前面：调用方读到的第一句就该是「没记住」，而不是「已写入」。
  if (value.committed === false) {
    const head = value.message ?? '本次写入未落盘'
    const missing = value.missing ?? []
    return missing.length > 0 ? head + '\n需要补：\n- ' + missing.join('\n- ') : head
  }
  if (value.message !== undefined) return value.message
  if (value.entry !== undefined) return '已' + (value.action === 'delete' ? '删除' : value.action === 'save' ? '写入' : '更新') + '内置长期记忆：' + value.entry.content
  if (value.entries !== undefined) {
    if (value.entries.length === 0) return '（暂无匹配的内置长期记忆）'
    // P1-6：检索结果带上四态资格，被否定与把握不足的条目必须显式标注。
    const marks = new Map((value.qualifications ?? []).map((item) => [item.id, item.qualification + '：' + item.reason]))
    return value.entries.map((entry, index) => {
      const mark = marks.get(entry.id)
      return `${index + 1}. [${entry.category}] ${entry.content}${entry.pinned === true ? '（常驻）' : ''}${mark === undefined ? '' : '（⚠ ' + mark + '）'}`
    }).join('\n')
  }
  return value.ok ? '操作完成' : '操作失败'
}

function messageText(data: unknown): string {
  const value = data as { content?: unknown } | null
  if (value === null || !Array.isArray(value.content)) return ''
  return value.content.map((block) => {
    const item = block as { type?: unknown; text?: unknown }
    return item.type === 'text' && typeof item.text === 'string' ? item.text : ''
  }).join('')
}

function normalized(value: string): string {
  return value.toLocaleLowerCase().replace(/\s+/gu, '').replace(/[，。！？、,.!?;；:：'"“”‘’`()（）\[\]{}]/gu, '')
}

interface VerifiedUserRequest {
  explicit: boolean
  evidence?: MemoryEvidence
}

/** 从工具所属会话回读最后一条 direct-user 消息；写入意图与目标内容都必须对应。 */
function verifyLatestUserRequest(exec: unknown, content: string, intent: 'save' | 'update' | 'delete'): VerifiedUserRequest {
  const session = (exec as { agent?: { session?: { id?: unknown; snapshotEvents?: unknown } } } | null)?.agent?.session
  if (session === undefined || typeof session.snapshotEvents !== 'function') return { explicit: false }
  let events: readonly unknown[] = []
  try { events = (session.snapshotEvents as () => readonly unknown[])() } catch { return { explicit: false } }
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index] as { seq?: unknown; type?: unknown; data?: unknown }
    if (event.type !== 'user/message') continue
    const data = event.data as { id?: unknown; source?: { kind?: unknown }; content?: unknown } | undefined
    if (data?.source?.kind !== 'user' || typeof data.id !== 'string') continue
    const raw = messageText(data).trim()
    const intentMatches = intent === 'save'
      ? /(记住|记下|保存.*记忆|加入.*记忆|以后.*按|确认.*记忆)/u.test(raw)
      : intent === 'update'
        ? /(修改|更新|改成|改为|设为|钉选|常驻|取消.*常驻)/u.test(raw)
        : /(删除|忘掉|遗忘|移除.*记忆|归档)/u.test(raw)
    const source = normalized(raw)
    const target = normalized(content)
    const stripped = source.replace(/^(请|帮我|你要|把|将)?(记住|记下|修改|更新|删除|忘掉|遗忘|归档)/u, '')
    const contentMatches = target.length >= 4 && (source.includes(target) || (stripped.length >= 4 && target.includes(stripped)))
    const quote = raw.slice(0, 500)
    const sessionId = typeof session.id === 'string' ? session.id : ''
    return {
      explicit: intentMatches && contentMatches,
      evidence: {
        kind: 'user', quote, sourceId: data.id, sessionId, messageId: data.id,
        ...(typeof event.seq === 'number' ? { eventSeq: event.seq } : {}),
        digest: createHash('sha256').update(quote).digest('hex'), createdAt: Date.now(),
      },
    }
  }
  return { explicit: false }
}

export interface MemoryManageToolOptions {
  governance?: MemoryGovernanceService
  scopeOfAgent?: (agent: unknown) => MemoryScopeContext
}

/** 内置长期记忆的保存、检索、读取、更新和删除入口。 */
export function memoryManageTool(store: NativeMemoryStore, options?: MemoryManageToolOptions) {
  return defineTool({
    name: 'memory_manage',
    description: '管理天工造梦内置长期记忆（memory.entry）：save 保存记忆并自动激活（有明确用户指令时为确认信任，否则按证据链分级）；search/list/get/update/delete 用于检索和维护。需要每轮固定记住时 pinned=true。',
    parameters: {
      action: { type: 'string', enum: ['list', 'get', 'save', 'search', 'update', 'delete', 'feedback'], description: '操作类型，默认 list。feedback 用于标注某条记忆是否可用（接通风控反馈回路）。' },
      verdict: { type: 'string', enum: ['useful', 'irrelevant', 'incorrect', 'outdated'], description: 'feedback 必填：useful 有用；irrelevant 不相关；incorrect 内容有错；outdated 已过时（incorrect/outdated 会隔离该条并把旧说法写入负记忆层）。' },
      note: { type: 'string', description: 'feedback 可选：补充说明，用于审计与负记忆理由。' },
      id: { type: 'string', description: 'get/update/delete 使用的记忆 id。' },
      content: { type: 'string', description: 'save 必填；update 时为新内容。' },
      category: { type: 'string', enum: categories, description: '记忆分类。' },
      tags: { type: 'array', items: { type: 'string' }, description: '检索标签。' },
      source: { type: 'string', description: '来源标签；不能作为用户确认凭据。' },
      sourceId: { type: 'string', description: '来源对象标识。' },
      importance: { type: 'number', description: '重要性 1-5。' },
      pinned: { type: 'boolean', description: '是否每轮常驻注入。' },
      query: { type: 'string', description: 'search 使用的查询词。' },
      limit: { type: 'integer', description: 'list/search 返回条数。' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean', required: true }, action: { type: 'string', required: true }, committed: { type: 'boolean' }, pendingReason: { type: 'string' }, missing: { type: 'array', items: { type: 'string' } }, entry: entrySchema, entries: { type: 'array', items: entrySchema }, qualifications: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { id: { type: 'string', required: true }, qualification: { type: 'string', required: true, enum: ['ACCEPT', 'DEFER', 'BLINDSPOT', 'REJECT'] }, reason: { type: 'string', required: true } } } }, count: { type: 'integer' }, message: { type: 'string' } } },
      render: (_args, value: MemoryToolOutput) => text(render(value)),
    },
    async execute(args, exec): Promise<MemoryToolOutput> {
      const action = args.action ?? 'list'
      const scope = options?.scopeOfAgent?.(exec.agent) ?? { kind: 'global' }
      const enforceScope = options?.scopeOfAgent !== undefined
      const visible = (entry: NativeMemoryEntry): boolean => !enforceScope || memoryScopeMatches(entry, scope, true)
      const scopeOptions = enforceScope ? { scope, isolateScope: true as const } : {}
      /** 更新把旧结论换掉时，把旧说法写进负层，避免它换个措辞又被当成有效答案召回（0.50.2）。 */
      const recordSupersededNegative = (old: NativeMemoryEntry, note?: string): void => {
        try {
          options?.governance?.negatives.record({
            id: 'neg-' + old.id,
            content: old.content,
            reason: '已被新结论取代：' + (note === undefined ? '同一条记忆更新' : note).slice(0, 200),
            kind: 'superseded',
            scope: old.scope,
            actor: 'agent',
            sourceId: old.id,
          })
        } catch { /* 负层写入失败不影响更新结果。 */ }
      }
      try {
        if (action === 'list') {
          const entries = store.list({ limit: args.limit, category: args.category, ...scopeOptions })
          return { ok: true, action, entries, count: entries.length }
        }
        if (action === 'search') {
          if (!args.query) return { ok: false, action, message: 'search 需要 query' }
          const hits = store.searchDetailed(args.query, { limit: args.limit, category: args.category, ...scopeOptions })
          const entries = hits.map((hit) => hit.entry)
          const negatives = options?.governance?.negatives.list({ scope, isolateScope: scopeOptions.isolateScope })
          return { ok: true, action, entries, qualifications: gradeSearchHits(hits, negatives), count: entries.length }
        }
        if (action === 'get') {
          if (!args.id) return { ok: false, action, message: 'get 需要 id' }
          const entry = store.get(args.id)
          return entry === undefined || !visible(entry) ? { ok: false, action, message: '当前作用域内记忆不存在：' + args.id } : { ok: true, action, entry }
        }
        if (action === 'save') {
          if (!args.content) return { ok: false, action, committed: false, message: 'save 需要 content', missing: ['content：必填，写明要记住的具体事实'] }
          // 0.43.0 P1-7：写入前过受理闸门，拒绝时给出可照做的缺失清单（自动沉淀不经此闸门）。
          const admission = checkMemoryAdmission({ content: args.content })
          if (!admission.admitted) return { ok: false, action, committed: false, message: '记忆写入被拒：' + admission.reason, missing: admission.missing }
          if (options?.governance === undefined) return { ok: true, action, committed: true, entry: store.create({ content: args.content, category: args.category, tags: args.tags, source: args.source ?? 'agent', sourceId: args.sourceId, importance: args.importance, pinned: args.pinned === true }) }
          const verified = verifyLatestUserRequest(exec, args.content, 'save')
          const verifiedSourceId = verified.explicit && verified.evidence !== undefined
            ? ['direct-user', verified.evidence.sessionId, verified.evidence.messageId, verified.evidence.digest].filter(Boolean).join(':')
            : args.sourceId
          const candidateInput = { content: args.content, category: args.category, tags: args.tags, importance: args.importance, scope, source: 'agent-proposal', sourceId: verifiedSourceId, evidence: verified.evidence === undefined ? [] : [verified.evidence] }
          if (verified.explicit && verified.evidence !== undefined) {
            const accepted = options.governance.acceptExplicitUser(candidateInput)
            if (accepted.entry !== undefined && args.pinned === true && accepted.entry.pinned !== true) return { ok: true, action, committed: true, entry: store.update(accepted.entry.id, { pinned: true }) }
            if (accepted.entry !== undefined) {
              // deduped：内容与现有记忆等价，没有新增落盘——不能报成「保存成功」。
              if (accepted.candidate.state === 'deduped') return { ok: true, action, committed: false, pendingReason: 'duplicate', entry: accepted.entry, message: '该内容与现有记忆重复，未新增（已有记忆 id=' + accepted.entry.id + '）：' + accepted.entry.content }
              return { ok: true, action, committed: true, entry: accepted.entry }
            }
            return { ok: true, action, committed: false, pendingReason: 'conflict', message: '已识别用户明确保存请求，但与现有事实冲突，未落盘，已进入待审核候选：' + accepted.candidate.id, missing: resolutionMissing(accepted.candidate) }
          }
          // 全自动路径（辉哥 2026-09-10 决策）：无明确指令的写入也直接激活，证据链决定信任等级。
          const auto = options.governance.activateAuto(candidateInput)
          if (auto.entry !== undefined && args.pinned === true && auto.entry.pinned !== true) return { ok: true, action, committed: true, entry: store.update(auto.entry.id, { pinned: true }) }
          if (auto.entry !== undefined) {
            if (auto.candidate.state === 'deduped') return { ok: true, action, committed: false, pendingReason: 'duplicate', entry: auto.entry, message: '该内容与现有记忆重复，未新增（已有记忆 id=' + auto.entry.id + '）：' + auto.entry.content }
            return { ok: true, action, committed: true, entry: auto.entry }
          }
          const pendingReason = auto.candidate.state === 'rejected' ? 'rejected' : 'pending'
          return { ok: true, action, committed: false, pendingReason, message: (pendingReason === 'rejected' ? '写入被拒，未落盘，候选：' : '未落盘，已进入待审核候选：') + auto.candidate.id, missing: resolutionMissing(auto.candidate) }
        }
        if (action === 'update') {
          if (!args.id) return { ok: false, action, committed: false, message: 'update 需要 id' }
          if (args.content === undefined && args.category === undefined && args.tags === undefined && args.source === undefined && args.sourceId === undefined && args.importance === undefined && args.pinned === undefined) return { ok: false, action, committed: false, message: 'update 至少需要一个要修改的字段' }
          const current = store.get(args.id)
          if (current === undefined || !visible(current)) return { ok: false, action, committed: false, message: '当前作用域内记忆不存在：' + args.id }
          const requestedContent = args.content ?? current.content
          const verified = verifyLatestUserRequest(exec, requestedContent, 'update')
          if (options?.governance !== undefined && !verified.explicit) {
            // 缺 memoryKey 的条目（实测 1038/5167 条）无法靠取代链去重：给新条目编一个 memoryKey
            // 也匹配不到旧条目，结果就是「更新 = 新增一条 + 旧条目原样留着」，越更新越重复。
            // 这里对这一类直接就地改写它自己（0.50.2）。
            if (current.memoryKey === undefined) {
              const inPlace = Object.fromEntries(Object.entries({
                content: args.content,
                category: args.category,
                tags: args.tags,
                importance: args.importance,
                source: 'agent-update-proposal',
                ...(args.sourceId === undefined ? {} : { sourceId: args.sourceId }),
                ...(verified.evidence === undefined ? {} : { evidence: [...current.evidence, verified.evidence] }),
              }).filter(([, value]) => value !== undefined))
              const written = store.update(args.id, inPlace)
              if (args.content !== undefined && args.content !== current.content) recordSupersededNegative(current, args.note)
              return { ok: true, action, committed: true, entry: written }
            }
            // 全自动路径：更新类写入也直接激活，同 memoryKey 旧事实自动取代。
            // excludeEntryIds 传被更新的条目自身：否则改写成与原文相近的措辞时，去重比对会
            // 把条目自己认成重复并拒绝更新（0.51.0 修）。
            const auto = options.governance.activateAuto({ content: requestedContent, category: args.category ?? current.category, tags: args.tags ?? current.tags, importance: args.importance ?? current.importance, scope: current.scope, memoryKey: current.memoryKey, source: 'agent-update-proposal', sourceId: args.sourceId, evidence: verified.evidence === undefined ? [] : [verified.evidence], excludeEntryIds: [current.id] })
            if (auto.entry !== undefined && args.content !== undefined && args.content !== current.content) recordSupersededNegative(current, args.note)
            return auto.entry !== undefined
              ? { ok: true, action, committed: auto.candidate.state !== 'deduped', ...(auto.candidate.state === 'deduped' ? { pendingReason: 'duplicate', message: '更新后内容与现有记忆重复，未落盘（已有 id=' + auto.entry.id + '）' } : {}), entry: auto.entry }
              : { ok: true, action, committed: false, pendingReason: 'pending', message: '更新未落盘，已进入待审核候选：' + auto.candidate.id, missing: resolutionMissing(auto.candidate) }
          }
          const verifiedSourceId = verified.evidence === undefined ? args.sourceId : ['direct-user', verified.evidence.sessionId, verified.evidence.messageId, verified.evidence.digest].filter(Boolean).join(':')
          const governed = options?.governance === undefined ? {} : { source: 'user-confirmed', sourceId: verifiedSourceId, trust: 'confirmed' as const, confidence: 1, evidence: verified.evidence === undefined ? current.evidence : [...current.evidence, verified.evidence] }
          const patch = Object.fromEntries(Object.entries({ content: args.content, category: args.category, tags: args.tags, source: args.source, sourceId: args.sourceId, importance: args.importance, pinned: args.pinned, ...governed }).filter(([, value]) => value !== undefined))
          const updated = store.update(args.id, patch)
          if (args.content !== undefined && args.content !== current.content) recordSupersededNegative(current, args.note)
          return { ok: true, action, committed: true, entry: updated }
        }
        if (action === 'feedback') {
          if (!args.id) return { ok: false, action, committed: false, message: 'feedback 需要 id' }
          if (args.verdict === undefined) return { ok: false, action, committed: false, message: 'feedback 需要 verdict（useful/irrelevant/incorrect/outdated）', missing: ['verdict：必填，写明这条记忆是否有用'] }
          const target = store.get(args.id)
          if (target === undefined || !visible(target)) return { ok: false, action, committed: false, message: '当前作用域内记忆不存在：' + args.id }
          if (options?.governance === undefined) {
            // 无治理层（单元测试/精简接线）时退化为直接累计计数，保证动作语义不丢。
            store.markFeedback(args.id, args.verdict === 'useful')
            return { ok: true, action, committed: true, entry: store.get(args.id), message: '已记录反馈：' + args.verdict }
          }
          const feedback = options.governance.submitDirectFeedback({ entryId: args.id, verdict: args.verdict, ...(args.note === undefined ? {} : { note: args.note }) })
          const after = store.get(args.id) ?? target
          return { ok: true, action, committed: true, entry: after, message: '已记录反馈：' + feedback.verdict + (args.verdict === 'incorrect' || args.verdict === 'outdated' ? '，该条已隔离并写入负记忆层' : '') }
        }
        if (action === 'delete') {
          if (!args.id) return { ok: false, action, committed: false, message: 'delete 需要 id' }
          const entry = store.get(args.id)
          if (entry === undefined || !visible(entry)) return { ok: false, action, committed: false, message: '当前作用域内记忆不存在：' + args.id }
          if (options?.governance !== undefined && !verifyLatestUserRequest(exec, entry.content, 'delete').explicit) return { ok: false, action, committed: false, message: '归档未通过 Host 用户确认校验，请明确说明要删除的记忆内容或在记忆工作台操作', missing: ['用户确认：请在消息里明确说明要删除的记忆内容（归档是不可逆状态变更，必须有用户原话证据）'] }
          const archived = store.archive(args.id, true)
          // 归档的说法必须进负层（0.50.2）：否则同一错误结论会以别的措辞从沉淀里长回来，召回也没有警示。
          try {
            options?.governance?.negatives.record({
              id: 'neg-' + entry.id,
              content: entry.content,
              reason: '已归档：' + (args.note === undefined ? '用户/助手确认不再适用' : args.note).slice(0, 200),
              kind: 'rejected',
              scope: entry.scope,
              actor: 'user',
              sourceId: entry.id,
            })
          } catch { /* 负层写入失败不影响归档结果。 */ }
          return { ok: true, action, committed: true, entry: archived, message: '已软归档内置长期记忆：' + args.id }
        }
        return { ok: false, action, committed: false, message: '不支持的 memory_manage action：' + action }
      } catch (error) {
        return { ok: false, action, committed: false, message: '内置长期记忆操作失败：' + (error instanceof Error ? error.message : String(error)).slice(0, 200) }
      }
    },
  })
}
