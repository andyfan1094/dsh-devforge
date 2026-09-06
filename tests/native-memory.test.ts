/** 内置 memory 域单测：CRUD、关键词检索与幂等迁移。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RagStore } from '../src/rag/rag-store.ts'
import { NativeMemoryStore, tokenizeForMatch } from '../src/memory/native.ts'

function makeStore(): NativeMemoryStore {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-native-memory-'))
  return new NativeMemoryStore(new RagStore(join(dir, 'store.db'), join(dir, 'rag-vec.db')))
}

test('内置记忆：创建、列表、更新、删除', () => {
  const store = makeStore()
  const entry = store.create({ content: '辉哥偏好紧凑的信息密度', category: 'preference', tags: ['界面', '偏好'], importance: 5 }, 'pref-1')
  assert.equal(store.get('pref-1')?.content, entry.content)
  assert.equal(store.list({ category: 'preference' }).length, 1)
  const updated = store.update('pref-1', { content: '辉哥偏好紧凑但不拥挤的界面', importance: 4 })
  assert.equal(updated.importance, 4)
  assert.equal(store.delete('pref-1'), true)
  assert.equal(store.get('pref-1'), undefined)
  assert.equal(store.delete('pref-1'), false)
})

test('内置记忆：关键词检索按命中与重要度排序', () => {
  const store = makeStore()
  store.create({ content: 'RAG 使用硅基流动 bge-m3 向量模型', tags: ['RAG', '硅基流动'], importance: 4 }, 'rag-1')
  store.create({ content: '普通项目记录', importance: 1 }, 'other-1')
  const hits = store.search('硅基流动')
  assert.equal(hits[0]?.id, 'rag-1')
})

test('内置记忆：检索分词门槛（中文二元组命中、单词误伤拦截）', () => {
  const store = makeStore()
  store.create({ content: 'macOS 上 setsid 不存在，后台启动进程需用 nohup 加 disown', importance: 3 }, 'pit-1')
  store.create({ content: '记忆注入的查询只取用户消息正文', importance: 5 }, 'mem-1')
  // 分词器：拉丁词（长度≥2）+ 中文二元组。
  assert.ok(tokenizeForMatch('记忆中枢注入').includes('记忆'))
  assert.ok(tokenizeForMatch('DSH file').includes('dsh'))
  // 中文整句无空格：按二元组切分后仍能命中（记忆/注入 至少两个词元）。
  assert.equal(store.search('记忆中枢注入的相关性')[0]?.id, 'mem-1')
  // 英文样板查询只沾一个词（dsh）不再命中：门槛要求至少 2 个词元。
  assert.deepEqual(store.search('dsh file policy approval sandbox'), [])
  // 空查询返回空清单而不抛错。
  assert.deepEqual(store.search('   '), [])
  // 两个词元齐备则正常命中，且重要度只影响排序不影响入围。
  assert.equal(store.search('setsid nohup')[0]?.id, 'pit-1')
})

test('内置记忆：migrationKey 重复导入只更新不重复', () => {
  const store = makeStore()
  const first = store.migrate([{ content: '原始决策', category: 'decision', source: 'hindsight', migrationKey: 'h:1' }])
  const second = store.migrate([{ content: '更新决策', category: 'decision', source: 'hindsight', migrationKey: 'h:1' }])
  assert.deepEqual(first, { scanned: 1, added: 1, updated: 0, skipped: 0 })
  assert.deepEqual(second, { scanned: 1, added: 0, updated: 1, skipped: 0 })
  assert.equal(store.migrationStatus().migrated, 1)
  assert.equal(store.list()[0]?.content, '更新决策')
})

test('内置记忆：输入校验拒绝空内容、非法分类和超长查询', () => {
  const store = makeStore()
  assert.throws(() => store.create({ content: '' }))
  assert.throws(() => store.create({ content: 'x', category: 'bad' as never }))
  assert.throws(() => store.search('x'.repeat(501)))
})
