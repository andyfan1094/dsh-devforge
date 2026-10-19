import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RagStore } from '../src/rag/rag-store.ts'
import { NativeMemoryStore } from '../src/memory/native.ts'
import { memoryManageTool, resolveMemoryId } from '../src/memory/tools.ts'

test('memory_manage 保存、检索、更新和软归档内置记忆', async () => {
  const store = new NativeMemoryStore(new RagStore(join(mkdtempSync(join(tmpdir(), 'dsh-memory-tools-')), 'rag.db')))
  const tool = memoryManageTool(store) as any
  const saved = await tool.execute({ action: 'save', content: '抖音媒体接口为空时，先检查浏览器媒体缓存。', category: 'insight', tags: ['抖音', '踩坑'], pinned: true, source: 'user-confirmed' })
  assert.equal(saved.ok, true)
  assert.equal(saved.entry.pinned, true)
  const found = await tool.execute({ action: 'search', query: '浏览器媒体缓存' })
  assert.equal(found.entries.length, 1)
  const updated = await tool.execute({ action: 'update', id: saved.entry.id, pinned: false })
  assert.equal(updated.entry.pinned, undefined)
  const deleted = await tool.execute({ action: 'delete', id: saved.entry.id })
  assert.equal(deleted.ok, true)
  // 软归档语义：get 仍可读但状态变为 archived，检索不再命中。
  const archived = await tool.execute({ action: 'get', id: saved.entry.id })
  assert.equal(archived.ok, true)
  assert.equal(archived.entry.state, 'archived')
  const searched = await tool.execute({ action: 'search', query: '浏览器媒体缓存' })
  assert.equal(searched.entries.length, 0)
})

test('memory_manage 校验保存内容', async () => {
  const store = new NativeMemoryStore(new RagStore(join(mkdtempSync(join(tmpdir(), 'dsh-memory-tools-')), 'rag.db')))
  const result = await (memoryManageTool(store) as any).execute({ action: 'save', content: '' })
  assert.equal(result.ok, false)
})

/** 取出工具 render 出来的纯文本（render 返回的是 host 的 text 包装）。 */
function renderText(tool: any, value: unknown): string {
  return JSON.stringify(tool.output.render({}, value))
}

test('memory_manage 读取：回显短 ID 与分类，且绝不能误报「已更新」', async () => {
  const store = new NativeMemoryStore(new RagStore(join(mkdtempSync(join(tmpdir(), 'dsh-memory-tools-')), 'rag.db')))
  const tool = memoryManageTool(store) as any
  const saved = await tool.execute({ action: 'save', content: '暂存实例固定监听 3081 端口，与生产不共用 HOME。', category: 'fact', source: 'user-confirmed' })
  const short = saved.entry.id.slice(0, 8)

  // 用 8 位短 ID 读取（这正是模型在注入行里看到的形式）。
  const read = await tool.execute({ action: 'get', id: short })
  assert.equal(read.ok, true)
  assert.equal(read.entry.id, saved.entry.id)

  const text = renderText(tool, read)
  // 读一条记忆却被告知「已更新内置长期记忆」，用户会以为自己的记忆被动过。
  assert.doesNotMatch(text, /已更新|已写入|已删除|已软归档/u)
  // 回显短 ID，读完想接着 update/feedback 不必再找一遍。
  assert.match(text, new RegExp(short, 'u'))
  assert.match(text, /fact/u)
  assert.match(text, /3081/u)
})

test('memory_manage 短 ID 解析：唯一前缀可用，歧义只报数量不猜也不泄漏完整 id', async () => {
  const store = new NativeMemoryStore(new RagStore(join(mkdtempSync(join(tmpdir(), 'dsh-memory-tools-')), 'rag.db')))
  const tool = memoryManageTool(store) as any
  // 显式指定 id，造出两条共享 6 位前缀的记忆（真实 uuid 无法控制）。
  const a = store.create({ content: '共享前缀的记忆甲', category: 'fact', source: 'test' }, 'abcd1234-0000-4000-8000-000000000001')
  store.create({ content: '共享前缀的记忆乙', category: 'fact', source: 'test' }, 'abcd1234-0000-4000-8000-000000000002')

  // 完整 id 精确命中优先，不受歧义影响。
  assert.equal((await tool.execute({ action: 'get', id: a.id })).entry.id, a.id)

  // 6 位前缀撞上两条 → 拒绝猜，且回复里不能出现完整 id。
  const ambiguous = await tool.execute({ action: 'get', id: 'abcd12' })
  assert.equal(ambiguous.ok, false)
  assert.match(ambiguous.message, /匹配到 2 条/u)
  assert.match(ambiguous.message, /补更多位数/u)
  assert.doesNotMatch(ambiguous.message, /abcd1234-0000/u)

  // 空串在 action 入口就被拦下（!args.id），给的是明确提示而不是「命中一切」。
  const blank = await tool.execute({ action: 'get', id: '' })
  assert.equal(blank.ok, false)
  assert.match(blank.message, /需要 id/u)
  // 解析器自身也兜一层：即使绕过入口校验，空串也必须判为不存在，
  // 否则 startsWith('') 会匹配全库 —— 把「空参数」变成「命中一切」。
  const blankResolved = resolveMemoryId(store, '')
  assert.equal(blankResolved.ok, false)
  assert.match((blankResolved as { message: string }).message, /不存在/u)

  // 不存在的短 ID 给的是人话，不是内部异常。
  const missing = await tool.execute({ action: 'get', id: 'ffffffff' })
  assert.equal(missing.ok, false)
  assert.match(missing.message, /不存在/u)
})
