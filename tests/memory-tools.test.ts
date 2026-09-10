import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RagStore } from '../src/rag/rag-store.ts'
import { NativeMemoryStore } from '../src/memory/native.ts'
import { memoryManageTool } from '../src/memory/tools.ts'

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
