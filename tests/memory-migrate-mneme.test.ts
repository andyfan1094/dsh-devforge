/**
 * Mneme 记忆迁移测试 —— 外部 memory.db 活跃条目采集、分类映射与幂等导入。
 * 覆盖红线：归档/遗忘条目不搬家；脏 tags 不影响迁移；库不存在返回空数组。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { RagStore } from '../src/rag/rag-store.ts'
import { NativeMemoryStore } from '../src/memory/native.ts'
import { collectMnemeItems } from '../src/memory/migrate.ts'

test('collectMnemeItems：活跃条目采集、分类映射与归档过滤', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-mneme-migrate-'))
  const dbPath = join(dir, 'memory.db')
  const db = new DatabaseSync(dbPath)
  db.exec(`CREATE TABLE memories (
    id TEXT PRIMARY KEY, type TEXT, title TEXT, content TEXT, tags TEXT,
    importance INTEGER, archived INTEGER DEFAULT 0, forgotten INTEGER DEFAULT 0
  )`)
  const insert = db.prepare('INSERT INTO memories (id, type, title, content, tags, importance, archived, forgotten) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
  insert.run('m-1', 'preference', '竖屏发布', '所有成片都用竖屏格式', JSON.stringify(['视频']), 5, 0, 0)
  insert.run('m-2', 'decision', '生产红线', '未经辉哥确认不得重启生产', '[]', 5, 0, 0)
  insert.run('m-3', 'project', '', '天工造梦项目持续推进中', '[]', 3, 0, 0)
  insert.run('m-4', 'fact', '已判定垃圾', '这条已被 mneme 归档', '[]', 1, 1, 0)
  insert.run('m-5', 'fact', '已遗忘', '这条被遗忘标记', '[]', 1, 0, 1)
  db.close()

  const items = collectMnemeItems(dbPath)
  assert.equal(items.length, 3)
  assert.equal(items[0].category, 'preference')
  assert.equal(items[0].importance, 5)
  assert.deepEqual(items[0].tags, ['视频'])
  assert.ok(items[0].content.startsWith('竖屏发布'))
  assert.equal(items[1].category, 'decision')
  assert.equal(items[2].category, 'context')
  assert.ok(items.every((item) => item.source === 'mneme' && item.migrationKey?.startsWith('mneme:')))

  // 幂等导入：重复执行只更新不重复。
  const store = new NativeMemoryStore(new RagStore(join(mkdtempSync(join(tmpdir(), 'dsh-mneme-store-')), 'rag.db')))
  const first = store.migrate(items)
  assert.equal(first.added, 3)
  const second = store.migrate(items)
  assert.equal(second.added, 0)
  assert.equal(second.updated, 3)
  assert.equal(store.list().length, 3)
})

test('collectMnemeItems：库不存在返回空数组', () => {
  assert.deepEqual(collectMnemeItems('/tmp/不存在/mneme-memory.db'), [])
})
