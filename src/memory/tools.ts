/**
 * 内置长期记忆 Agent 工具。
 *
 * 只读动作直接访问 active memory.entry；写动作接入治理服务后会回读当前会话的
 * 真实用户消息。只有明确“记住/确认保存”且内容对应时才直接激活，否则创建待审核候选。
 */
import { createHash } from 'node:crypto'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { MemoryGovernanceService } from './governance.ts'
import { memoryScopeMatches } from './scope.ts'
import type { NativeMemoryStore } from './native.ts'
import type { MemoryEvidence, MemoryScopeContext, NativeMemoryCategory, NativeMemoryEntry } from './protocol.ts'

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

type MemoryToolOutput = { ok: boolean; action: string; entry?: NativeMemoryEntry; entries?: NativeMemoryEntry[]; count?: number; message?: string }

function render(value: MemoryToolOutput): string {
  if (value.message !== undefined) return value.message
  if (value.entry !== undefined) return '已' + (value.action === 'delete' ? '删除' : value.action === 'save' ? '写入' : '更新') + '内置长期记忆：' + value.entry.content
  if (value.entries !== undefined) return value.entries.length === 0 ? '（暂无匹配的内置长期记忆）' : value.entries.map((entry, index) => `${index + 1}. [${entry.category}] ${entry.content}${entry.pinned === true ? '（常驻）' : ''}`).join('\n')
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
    description: '管理天工造梦内置长期记忆（memory.entry）：save 保存用户明确确认的事实、偏好、决策或踩坑经验；未能由 Host 回读验证的写入只进入待审核候选。search/list/get/update/delete 用于检索和维护。需要每轮固定记住时 pinned=true。',
    parameters: {
      action: { type: 'string', enum: ['list', 'get', 'save', 'search', 'update', 'delete'], description: '操作类型，默认 list。' },
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
      schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean', required: true }, action: { type: 'string', required: true }, entry: entrySchema, entries: { type: 'array', items: entrySchema }, count: { type: 'integer' }, message: { type: 'string' } } },
      render: (_args, value: MemoryToolOutput) => text(render(value)),
    },
    async execute(args, exec): Promise<MemoryToolOutput> {
      const action = args.action ?? 'list'
      const scope = options?.scopeOfAgent?.(exec.agent) ?? { kind: 'global' }
      const enforceScope = options?.scopeOfAgent !== undefined
      const visible = (entry: NativeMemoryEntry): boolean => !enforceScope || memoryScopeMatches(entry, scope, true)
      const scopeOptions = enforceScope ? { scope, isolateScope: true as const } : {}
      try {
        if (action === 'list') {
          const entries = store.list({ limit: args.limit, category: args.category, ...scopeOptions })
          return { ok: true, action, entries, count: entries.length }
        }
        if (action === 'search') {
          if (!args.query) return { ok: false, action, message: 'search 需要 query' }
          const entries = store.search(args.query, { limit: args.limit, category: args.category, ...scopeOptions })
          return { ok: true, action, entries, count: entries.length }
        }
        if (action === 'get') {
          if (!args.id) return { ok: false, action, message: 'get 需要 id' }
          const entry = store.get(args.id)
          return entry === undefined || !visible(entry) ? { ok: false, action, message: '当前作用域内记忆不存在：' + args.id } : { ok: true, action, entry }
        }
        if (action === 'save') {
          if (!args.content) return { ok: false, action, message: 'save 需要 content' }
          if (options?.governance === undefined) return { ok: true, action, entry: store.create({ content: args.content, category: args.category, tags: args.tags, source: args.source ?? 'agent', sourceId: args.sourceId, importance: args.importance, pinned: args.pinned === true }) }
          const verified = verifyLatestUserRequest(exec, args.content, 'save')
          const verifiedSourceId = verified.explicit && verified.evidence !== undefined
            ? ['direct-user', verified.evidence.sessionId, verified.evidence.messageId, verified.evidence.digest].filter(Boolean).join(':')
            : args.sourceId
          const candidateInput = { content: args.content, category: args.category, tags: args.tags, importance: args.importance, scope, source: 'agent-proposal', sourceId: verifiedSourceId, evidence: verified.evidence === undefined ? [] : [verified.evidence] }
          if (verified.explicit && verified.evidence !== undefined) {
            const accepted = options.governance.acceptExplicitUser(candidateInput)
            if (accepted.entry !== undefined && args.pinned === true && accepted.entry.pinned !== true) return { ok: true, action, entry: store.update(accepted.entry.id, { pinned: true }) }
            if (accepted.entry !== undefined) return { ok: true, action, entry: accepted.entry }
            return { ok: true, action, message: '已识别用户明确保存请求，但与现有事实冲突，已进入待审核候选：' + accepted.candidate.id }
          }
          const candidate = options.governance.propose(candidateInput)
          return { ok: true, action, message: '未检测到可回读验证的用户明确保存指令，已创建待审核候选：' + candidate.id }
        }
        if (action === 'update') {
          if (!args.id) return { ok: false, action, message: 'update 需要 id' }
          if (args.content === undefined && args.category === undefined && args.tags === undefined && args.source === undefined && args.sourceId === undefined && args.importance === undefined && args.pinned === undefined) return { ok: false, action, message: 'update 至少需要一个要修改的字段' }
          const current = store.get(args.id)
          if (current === undefined || !visible(current)) return { ok: false, action, message: '当前作用域内记忆不存在：' + args.id }
          const requestedContent = args.content ?? current.content
          const verified = verifyLatestUserRequest(exec, requestedContent, 'update')
          if (options?.governance !== undefined && !verified.explicit) {
            const candidate = options.governance.propose({ content: requestedContent, category: args.category ?? current.category, tags: args.tags ?? current.tags, importance: args.importance ?? current.importance, scope: current.scope, memoryKey: current.memoryKey, source: 'agent-update-proposal', sourceId: args.sourceId, evidence: verified.evidence === undefined ? [] : [verified.evidence] })
            return { ok: true, action, message: '更新未通过 Host 用户确认校验，已创建待审核候选：' + candidate.id }
          }
          const verifiedSourceId = verified.evidence === undefined ? args.sourceId : ['direct-user', verified.evidence.sessionId, verified.evidence.messageId, verified.evidence.digest].filter(Boolean).join(':')
          const governed = options?.governance === undefined ? {} : { source: 'user-confirmed', sourceId: verifiedSourceId, trust: 'confirmed' as const, confidence: 1, evidence: verified.evidence === undefined ? current.evidence : [...current.evidence, verified.evidence] }
          const patch = Object.fromEntries(Object.entries({ content: args.content, category: args.category, tags: args.tags, source: args.source, sourceId: args.sourceId, importance: args.importance, pinned: args.pinned, ...governed }).filter(([, value]) => value !== undefined))
          return { ok: true, action, entry: store.update(args.id, patch) }
        }
        if (action === 'delete') {
          if (!args.id) return { ok: false, action, message: 'delete 需要 id' }
          const entry = store.get(args.id)
          if (entry === undefined || !visible(entry)) return { ok: false, action, message: '当前作用域内记忆不存在：' + args.id }
          if (options?.governance !== undefined && !verifyLatestUserRequest(exec, entry.content, 'delete').explicit) return { ok: false, action, message: '归档未通过 Host 用户确认校验，请明确说明要删除的记忆内容或在记忆工作台操作' }
          return { ok: true, action, entry: store.archive(args.id, true), message: '已软归档内置长期记忆：' + args.id }
        }
        return { ok: false, action, message: '不支持的 memory_manage action：' + action }
      } catch (error) {
        return { ok: false, action, message: '内置长期记忆操作失败：' + (error instanceof Error ? error.message : String(error)).slice(0, 200) }
      }
    },
  })
}
