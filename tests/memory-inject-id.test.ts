/**
 * 注入行短 ID + memory_manage 前缀解析单测（0.55.0）。
 *
 * 为什么要有这组用例：注入行带上「 · #短ID」之后，模型第一次能指名引用某条记忆。
 * 这条链路必须两端同时成立——渲染侧写出 8 位短 ID，工具侧能把它解析回唯一的完整 id；
 * 任何一端漂移，短 ID 就退化成「看得见、用不上」的装饰，模型仍只能复述正文去搜索，
 * 命中哪条全凭运气。因此这里既锁渲染格式，也锁解析语义（唯一/不存在/多命中）。
 *
 * 纯函数 + 临时库，不触宿主、不触生产库。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RagStore } from '../src/rag/rag-store.ts'
import { NativeMemoryStore } from '../src/memory/native.ts'
import { memoryManageTool, resolveMemoryId } from '../src/memory/tools.ts'
import { renderNativeContext, renderPinnedContext, renderProjectProfile, renderProjectProfileDetailed } from '../src/memory/inject.ts'
import { SHORT_MEMORY_ID_PREFIX, shortMemoryId } from '../src/memory/protocol.ts'
import type { NativeMemoryEntry } from '../src/memory/protocol.ts'

function makeRig(): { store: NativeMemoryStore; tool: any } {
  const store = new NativeMemoryStore(new RagStore(join(mkdtempSync(join(tmpdir(), 'dsh-memory-inject-id-')), 'rag.db')))
  return { store, tool: memoryManageTool(store) as any }
}

/** 极简条目工厂：渲染函数只读 id/content/category/source/updatedAt 等字段。
 * updatedAt=0 会渲染成 1970-01-01，正好用来固定日期前缀的断言。 */
function entry(id: string, content: string, extra?: Partial<NativeMemoryEntry>): NativeMemoryEntry {
  return { id, content, category: 'fact', tags: [], source: 'session', importance: 3, createdAt: 0, updatedAt: 0, ...extra }
}

test('三条 native 注入行都带「 · #」+8 位短 ID，位置在类别之后、正文之前', () => {
  const id = 'a1b2c3d4-1111-4222-8333-444455556666'
  const target = entry(id, '发布包上传后必须核对 SHA256')
  // 两端必须用同一个长度定义，否则注入的短 ID 与解析侧的假设会悄悄漂移。
  assert.equal(SHORT_MEMORY_ID_PREFIX, ' · #')
  assert.equal(shortMemoryId(id), 'a1b2c3d4', '短 ID 必须是完整 id 的前 8 位')

  const native = renderNativeContext([target], 2000)
  const pinned = renderPinnedContext([target], 2000)
  const profile = renderProjectProfile([target], 'P1', 2000)
  for (const [label, text] of [['内置', native], ['常驻', pinned], ['档案卡', profile]] as const) {
    assert.ok(text.includes(SHORT_MEMORY_ID_PREFIX + shortMemoryId(id)), label + '注入行必须带短 ID')
  }
  // 精确到位置：模型先看到「这是哪一条」，再看正文，才不会把 ID 当成正文的一部分。
  assert.match(native, /\[1970-01-01 · session · fact · #a1b2c3d4\] 发布包上传后必须核对 SHA256/u)
  assert.match(pinned, /\[session · fact · #a1b2c3d4\] 发布包上传后必须核对 SHA256/u)
  assert.match(profile, /\[1970-01-01 · fact · #a1b2c3d4\] 发布包上传后必须核对 SHA256/u)
})

test('短前缀唯一命中时能取回同一条完整记忆', async () => {
  const { store, tool } = makeRig()
  const created = store.create({ content: '直播数据看板地址是 live.example.com', category: 'fact' }, 'a1b2c3d4-aaaa-4bbb-8ccc-dddddddddddd')
  const short = created.id.slice(0, 8)
  assert.deepEqual(resolveMemoryId(store, short), { ok: true, id: created.id }, '解析结果必须是完整 id，后续分支才敢直接写库')
  const got = await tool.execute({ action: 'get', id: short })
  assert.equal(got.ok, true)
  assert.equal(got.entry.id, created.id, 'get 必须取回同一条，而不是碰巧同内容的其他条目')
})

test('完整 id 仍然精确命中（老路径不得因前缀解析而回归）', async () => {
  const { store, tool } = makeRig()
  const created = store.create({ content: 'MySQL 在 my 服务器的 /var/lib/mysql', category: 'fact' }, 'b2c3d4e5-aaaa-4bbb-8ccc-dddddddddddd')
  const got = await tool.execute({ action: 'get', id: created.id })
  assert.equal(got.ok, true)
  assert.equal(got.entry.id, created.id)
})

test('不存在的短前缀返回「不存在」而不是抛异常', async () => {
  const { tool } = makeRig()
  // 模型会照抄上下文里的短 ID；条目被删掉后仍会来查，这条路径必须给友好话术。
  await assert.doesNotReject(() => tool.execute({ action: 'get', id: 'ffffffff' }))
  const missing = await tool.execute({ action: 'get', id: 'ffffffff' })
  assert.equal(missing.ok, false)
  assert.match(missing.message, /记忆不存在/u)
  // 空白 id 不能被当成「空前缀」匹配全库：宁可报不存在，也不能张冠李戴。
  const blank = await tool.execute({ action: 'get', id: '   ' })
  assert.equal(blank.ok, false)
})

test('短前缀命中多条时报告命中条数并要求补位数，且不泄漏完整 id', async () => {
  const { store, tool } = makeRig()
  const first = store.create({ content: '事实 A' }, 'deadbeef-1111-4bbb-8ccc-dddddddddddd')
  const second = store.create({ content: '事实 B' }, 'deadbeef-2222-4bbb-8ccc-dddddddddddd')
  const ambiguous = await tool.execute({ action: 'get', id: 'deadbeef' })
  assert.equal(ambiguous.ok, false)
  assert.match(ambiguous.message, /2 条/u, '必须说明命中几条，调用方才知道该补位数')
  assert.ok(!ambiguous.message.includes(first.id) && !ambiguous.message.includes(second.id), '报错里不得出现完整 id（会顺手把库结构写进上下文）')
  // 补到唯一后必须能正常工作：否则「报歧义」就变成了死路。
  const exact = await tool.execute({ action: 'get', id: 'deadbeef-1' })
  assert.equal(exact.ok, true)
  assert.equal(exact.entry.id, first.id)
})

test('update/feedback/delete 用短前缀也只动同一条', async () => {
  const { store, tool } = makeRig()
  const target = store.create({ content: '看板地址是 live.example.com', category: 'fact' }, 'dddddddd-aaaa-4bbb-8ccc-dddddddddddd')
  const short = target.id.slice(0, 8)

  const updated = await tool.execute({ action: 'update', id: short, content: '看板地址改为 live2.example.com' })
  assert.equal(updated.ok, true)
  assert.equal(store.get(target.id)?.content, '看板地址改为 live2.example.com', '更新必须落到解析出的完整 id 上')

  const feedback = await tool.execute({ action: 'feedback', id: short, verdict: 'useful' })
  assert.equal(feedback.ok, true)
  assert.equal(feedback.entry.id, target.id)

  const deleted = await tool.execute({ action: 'delete', id: short })
  assert.equal(deleted.ok, true)
  // 软归档语义保留：条目仍在库里，只是状态变成 archived。
  assert.equal(store.get(target.id)?.state, 'archived')
})

test('加短 ID 不改变既有预算语义：整条装入，装不下整条就整条丢弃', () => {
  // 用例来自原有回归：预算 250 只能装下首条 120 字正文，第二条必须整条消失。
  // 加 ID 后每条多约 12 字，只允许「少装一条」，不允许「装半条」。
  const first = entry('11111111-aaaa-4bbb-8ccc-dddddddddddd', 'A'.repeat(120))
  const second = entry('22222222-aaaa-4bbb-8ccc-dddddddddddd', 'B'.repeat(120))
  const nativeText = renderNativeContext([first, second], 250)
  assert.ok(nativeText.includes('AAAA'), '首条正文必须完整')
  assert.ok(nativeText.includes('#11111111'), '首条连短 ID 一起完整装入')
  assert.ok(!nativeText.includes('BB'), '第二条装不下整条就不得出现半条')
  const pinnedText = renderPinnedContext([first, second], 250)
  assert.ok(pinnedText.includes('AAAA'))
  assert.ok(!pinnedText.includes('BB'), '常驻层同样绝不截半条')
})

test('档案卡加短 ID 后仍在预算内整条装入，超预算条目整条丢弃且不计入 includedIds', () => {
  const short = entry('eeeeeeee-aaaa-4bbb-8ccc-dddddddddddd', '短事实')
  const long = entry('ffffffff-aaaa-4bbb-8ccc-dddddddddddd', '超长事实'.repeat(500))
  const rendered = renderProjectProfileDetailed([short, long], 'P1', 200)
  assert.ok(rendered.text.includes('短事实'))
  assert.ok(rendered.text.includes('#eeeeeeee'))
  assert.ok(!rendered.text.includes('超长事实'), '超过预算的条目整条丢弃')
  // includedIds 是召回轨迹的真相来源：预算外条目绝不能记成「已注入」。
  assert.deepEqual([...rendered.includedIds], [short.id])
})
