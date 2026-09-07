/**
 * 内置长期记忆 Agent 工具：把经过确认的记忆写入 memory.entry，并提供必要的检索与维护能力。
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { NativeMemoryStore } from './native.ts'
import type { NativeMemoryCategory, NativeMemoryEntry } from './protocol.ts'

function text(value: string): Array<{ type: 'text'; text: string }> {
  return [{ type: 'text', text: value }]
}

const categories: NativeMemoryCategory[] = ['preference', 'decision', 'fact', 'insight', 'context', 'general']
const entrySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true }, content: { type: 'string', required: true },
    category: { type: 'string', required: true, enum: categories }, tags: { type: 'array', required: true, items: { type: 'string' } },
    source: { type: 'string', required: true }, sourceId: { type: 'string' }, importance: { type: 'number', required: true },
    createdAt: { type: 'number', required: true }, updatedAt: { type: 'number', required: true }, migrationKey: { type: 'string' }, pinned: { type: 'boolean' },
  },
} as const

type MemoryToolOutput = { ok: boolean; action: string; entry?: NativeMemoryEntry; entries?: NativeMemoryEntry[]; count?: number; message?: string }

function render(value: MemoryToolOutput): string {
  if (value.message !== undefined) return value.message
  if (value.entry !== undefined) return '已' + (value.action === 'delete' ? '删除' : value.action === 'save' ? '写入' : '更新') + '内置长期记忆：' + value.entry.content
  if (value.entries !== undefined) return value.entries.length === 0 ? '（暂无匹配的内置长期记忆）' : value.entries.map((entry, index) => `${index + 1}. [${entry.category}] ${entry.content}${entry.pinned === true ? '（常驻）' : ''}`).join('\n')
  return value.ok ? '操作完成' : '操作失败'
}

/** 内置长期记忆的保存、检索、读取、更新和删除入口。未经用户确认不得调用 save 或 update。 */
export function memoryManageTool(store: NativeMemoryStore) {
  return defineTool({
    name: 'memory_manage',
    description: '管理天工造梦内置长期记忆（memory.entry）：save 保存经过用户确认的事实、偏好、决策或踩坑经验；search/list/get/update/delete 用于检索和维护。需要每轮固定记住时 save/update 显式设置 pinned=true。未经用户确认不要写入或修改。',
    parameters: {
      action: { type: 'string', enum: ['list', 'get', 'save', 'search', 'update', 'delete'], description: '操作类型，默认 list。' },
      id: { type: 'string', description: 'get/update/delete 使用的记忆 id。' },
      content: { type: 'string', description: 'save 必填；update 时为新内容。' },
      category: { type: 'string', enum: categories, description: '记忆分类。' },
      tags: { type: 'array', items: { type: 'string' }, description: '检索标签。' },
      source: { type: 'string', description: '来源，例如 user-confirmed 或 agent-learning。' },
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
    async execute(args): Promise<MemoryToolOutput> {
      const action = args.action ?? 'list'
      try {
        if (action === 'list') {
          const entries = store.list({ limit: args.limit, category: args.category })
          return { ok: true, action, entries, count: entries.length }
        }
        if (action === 'search') {
          if (!args.query) return { ok: false, action, message: 'search 需要 query' }
          const entries = store.search(args.query, { limit: args.limit, category: args.category })
          return { ok: true, action, entries, count: entries.length }
        }
        if (action === 'get') {
          if (!args.id) return { ok: false, action, message: 'get 需要 id' }
          const entry = store.get(args.id)
          return entry === undefined ? { ok: false, action, message: '记忆不存在：' + args.id } : { ok: true, action, entry }
        }
        if (action === 'save') {
          if (!args.content) return { ok: false, action, message: 'save 需要 content，且必须是经过用户确认的长期记忆' }
          return { ok: true, action, entry: store.create({ content: args.content, category: args.category, tags: args.tags, source: args.source ?? 'agent', sourceId: args.sourceId, importance: args.importance, pinned: args.pinned === true }) }
        }
        if (action === 'update') {
          if (!args.id) return { ok: false, action, message: 'update 需要 id' }
          if (args.content === undefined && args.category === undefined && args.tags === undefined && args.source === undefined && args.sourceId === undefined && args.importance === undefined && args.pinned === undefined) return { ok: false, action, message: 'update 至少需要一个要修改的字段' }
          const patch = Object.fromEntries(Object.entries({ content: args.content, category: args.category, tags: args.tags, source: args.source, sourceId: args.sourceId, importance: args.importance, pinned: args.pinned }).filter(([, value]) => value !== undefined))
          return { ok: true, action, entry: store.update(args.id, patch) }
        }
        if (action === 'delete') {
          if (!args.id) return { ok: false, action, message: 'delete 需要 id' }
          return store.delete(args.id) ? { ok: true, action, message: '已删除内置长期记忆：' + args.id } : { ok: false, action, message: '记忆不存在：' + args.id }
        }
        return { ok: false, action, message: '不支持的 memory_manage action：' + action }
      } catch (error) {
        return { ok: false, action, message: '内置长期记忆操作失败：' + (error instanceof Error ? error.message : String(error)).slice(0, 200) }
      }
    },
  })
}
