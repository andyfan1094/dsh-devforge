/** 内置 memory 域单测：CRUD、关键词检索与幂等迁移。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RagStore } from '../src/rag/rag-store.ts'
import { NativeMemoryStore, extractExactEntities, tokenizeForMatch } from '../src/memory/native.ts'

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

test('内置记忆：钉选常驻（仅显式 pinned，critical 不自动常驻）', () => {
  const store = makeStore()
  store.create({ content: '辉哥偏好紧凑排版', importance: 3 }, 'pref-1')
  const pinned = store.create({ content: '辉哥偏好鼠标跟随演示模式', importance: 3, pinned: true }, 'pin-1')
  assert.equal(pinned.pinned, true)
  // importance=5 不自动常驻：沉淀模型的 critical 会通膨，常驻必须显式钉选。
  store.create({ content: '未经辉哥再次确认不得重启生产', importance: 5 }, 'rule-1')
  assert.deepEqual(store.listPinned().map((entry) => entry.id), ['pin-1'])
  // patch 传 pinned:false 取消钉选后退出常驻清单。
  store.update('rule-1', { pinned: true })
  assert.deepEqual(store.listPinned().map((entry) => entry.id).sort(), ['pin-1', 'rule-1'])
  store.update('pin-1', { pinned: false })
  assert.equal(store.get('pin-1')?.pinned, undefined)
  assert.deepEqual(store.listPinned().map((entry) => entry.id), ['rule-1'])
  // 常驻清单默认上限 6 条，防止无限膨胀。
  for (let index = 0; index < 8; index += 1) store.create({ content: '钉选条目 ' + index, pinned: true }, 'bulk-' + index)
  assert.equal(store.listPinned().length, 6)
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

test('内置记忆：精确实体提取覆盖版本号/提交号/路径', () => {
  const entities = extractExactEntities('dsh-devforge 0.26.3 发布包和源码 /Users/andyfan/Documents/ds/dsh-devforge 提交 a9ab307')
  assert.ok(entities.includes('0.26.3'))
  assert.ok(entities.includes('a9ab307'))
  assert.ok(entities.some((entity) => entity.startsWith('/users/andyfan')))
  assert.deepEqual(extractExactEntities('纯中文问题没有实体'), [])
})

test('内置记忆：精确实体优先 + 全量扫描（0.26.4 排序修复）', () => {
  const store = makeStore()
  // 旧长文档：只提 dsh-devforge，无版本号（模拟旧事实反复压过新事实的场景）。
  store.create({ content: 'dsh-devforge 插件架构与交接记录，包含大量模块边界、验证结果、私有仓库与剩余风险的描述内容', importance: 3 }, 'old-doc')
  // 新事实：带版本号与提交号。
  store.create({ content: 'dsh-devforge 0.26.3 已发布到官网，源码提交 a9ab307 已推送 CNB', importance: 3 }, 'new-fact')
  const hits = store.search('dsh-devforge 0.26.3 最新发布状态是什么')
  assert.equal(hits[0]?.id, 'new-fact', '带精确实体的新事实必须压过沾边旧长文')
  assert.equal(store.search('a9ab307 这个提交改了什么')[0]?.id, 'new-fact', '提交号实体逐字命中可独立召回')
})

test('内置记忆：检索全量扫描活跃条目，不再受最新 200 条窗口限制', () => {
  const store = makeStore()
  store.create({ content: 'dsh-devforge-0.26.3.tgz 发布包已上传官网并核对哈希', importance: 3 }, 'precise')
  for (let index = 0; index < 250; index += 1) store.create({ content: '填充条目 ' + index, importance: 1 }, 'fill-' + index)
  const hits = store.search('dsh-devforge-0.26.3.tgz 发布包在哪')
  assert.equal(hits[0]?.id, 'precise', '窗口外的旧精确条目必须可检索')
})

test('内置记忆：有界新近度让新事实在同分时排前（7 天内加分）', () => {
  const store = makeStore()
  // 同词元覆盖、同重要度：更新时间新者优先（recencyBoost 对齐排序 tie-break 之外的显式加分）。
  store.create({ content: '记忆中枢检索会先做分词再匹配', importance: 3 }, 'old-1')
  store.create({ content: '记忆中枢检索会先做分词再匹配并注入', importance: 3 }, 'new-1')
  const hits = store.search('记忆中枢检索分词')
  assert.equal(hits[0]?.id, 'new-1', '同分时新条目靠前')
})
