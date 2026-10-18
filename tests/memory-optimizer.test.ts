/**
 * 记忆优化器修复测试（0.50.2）。
 *
 * 背景（2026-10-18 线上实测）：记忆库 6090 条、活跃 5167 条，做梦累计跑 148 次，
 * 但第 300 新的一条已经是当日凌晨——等于 4867 条（94%）老记忆永远进不了整理视野；
 * 同时 updated 恒为 0（不会改错）、memory.rejected 域 0 行（负层空转）、
 * helpfulCount/harmfulCount 全为 0（反馈从未接通）、20 次做梦里 6 次 failed（空输出）。
 * 这个文件逐条锁住对应的修复，防止回退。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RagStore } from '../src/rag/rag-store.ts'
import { NativeMemoryStore } from '../src/memory/native.ts'
import { MemoryGovernanceService } from '../src/memory/governance.ts'
import { applyDreamDecisions, MemoryDreamService } from '../src/memory/dream.ts'
import { memoryManageTool } from '../src/memory/tools.ts'
import { DEFAULT_MEMORY_SETTINGS } from '../src/memory/routes.ts'
import type { MemoryDreamDecision } from '../src/memory/protocol.ts'

function makeRig(): { store: NativeMemoryStore; governance: MemoryGovernanceService; ragStore: RagStore } {
  const ragStore = new RagStore(join(mkdtempSync(join(tmpdir(), 'dsh-memory-opt-')), 'store.db'))
  const store = new NativeMemoryStore(ragStore)
  return { store, governance: new MemoryGovernanceService(ragStore, store), ragStore }
}

/** 造一条带确定 id 的记忆（id 可控才能断言轮转覆盖面）。 */
function seedWithId(store: NativeMemoryStore, id: string, content: string, category: 'fact' | 'decision' | 'insight' = 'fact'): string {
  store.create({ content, category, source: 'test', importance: 3, scope: { kind: 'global' } }, id)
  return id
}

test('dreamSnapshotPage：游标轮转必须覆盖全库，不再只盯着最新几条（0.50.2）', () => {
  const { store } = makeRig()
  const ids: string[] = []
  for (let i = 0; i < 40; i += 1) ids.push(seedWithId(store, 'mem-' + String(i).padStart(2, '0'), '第 ' + i + ' 条记忆内容'))

  // 旧实现每次只返回「最新 N 条」，且顺序恒定——永远看不到更老的条目。
  const legacy = store.dreamSnapshot(10)
  assert.equal(legacy.length, 10)

  // 新实现：每轮带着游标继续扫，整库一轮内必须全覆盖（40 条 / 每轮轮转 8 条）。
  const seen = new Set<string>()
  let cursor = ''
  let wrapped = false
  for (let round = 0; round < 10 && !wrapped; round += 1) {
    const page = store.dreamSnapshotPage(10, cursor)
    assert.ok(page.entries.length > 0)
    for (const entry of page.entries) seen.add(entry.id)
    wrapped = page.wrapped
    cursor = page.nextCursor
  }
  for (const id of ids) assert.ok(seen.has(id), '轮转漏掉了条目：' + id)
})

test('dreamSnapshotPage：游标推进单调，且绕回后给出 wrapped 标记', () => {
  const { store } = makeRig()
  for (let i = 0; i < 20; i += 1) seedWithId(store, 'r-' + String(i).padStart(2, '0'), '轮转条目 ' + i)
  const first = store.dreamSnapshotPage(8, '')
  assert.equal(first.wrapped, false)
  assert.notEqual(first.nextCursor, '')
  const second = store.dreamSnapshotPage(8, first.nextCursor)
  assert.notEqual(second.nextCursor, first.nextCursor)
  // 直接拿一个极大的游标（模拟已扫到末尾）→ 必须绕回并标记，而不是返回空。
  const afterEnd = store.dreamSnapshotPage(8, '9999999999999999:zzz')
  assert.equal(afterEnd.wrapped, true)
  assert.ok(afterEnd.entries.length > 0, '绕回后仍要有条目可整理，不能空转')
})

test('applyDreamDecisions：跨分类合并需显式 category，否则仍然跳过（0.50.2）', () => {
  const { store } = makeRig()
  const a = seedWithId(store, 'x-a', '网关 usage 口径错误的旧结论', 'fact')
  const b = seedWithId(store, 'x-b', '网关 usage 口径已修复上线', 'decision')
  const rejected = applyDreamDecisions(store, [{ action: 'merge', ids: [a, b], content: '合并内容' } as MemoryDreamDecision])
  assert.equal(rejected.merged, 0)
  assert.match(rejected.skipped[0]?.reason ?? '', /跨分类/)
  // 显式给出合并后的 category 才允许跨分类合并——安全属性不变，但不再整组丢弃。
  const merged = applyDreamDecisions(store, [{ action: 'merge', ids: [a, b], content: '合并后的结论', category: 'fact' } as MemoryDreamDecision])
  assert.equal(merged.merged, 1)
  assert.equal(store.get(a)?.category, 'fact')
  assert.equal(store.get(b)?.state, 'archived')
})

test('submitDirectFeedback：不给 recallId 也能落账，incorrect 会隔离并写负记忆层（0.50.2）', () => {
  const { store, governance } = makeRig()
  const id = seedWithId(store, 'fb-1', '旧结论：压缩用 cordis-250k 预设')

  const useful = governance.submitDirectFeedback({ entryId: id, verdict: 'useful' })
  assert.equal(useful.verdict, 'useful')
  assert.equal(store.get(id)?.helpfulCount, 1, 'useful 必须真的累计到 helpfulCount')

  governance.submitDirectFeedback({ entryId: id, verdict: 'incorrect', note: '该预设已废弃' })
  assert.equal(store.get(id)?.harmfulCount, 1, 'incorrect 必须累计到 harmfulCount')
  assert.equal(store.get(id)?.state, 'quarantined', 'incorrect 的条目必须被隔离')

  const negatives = governance.negatives.list()
  assert.equal(negatives.length, 1, '被证伪的说法必须落进 memory.rejected')
  assert.equal(negatives[0]?.kind, 'falsified')
  assert.match(negatives[0]?.content ?? '', /cordis-250k/)
})

test('memory_manage feedback：模型可直接按 id 反馈，无需内部 recallId（0.50.2）', async () => {
  const { store, governance } = makeRig()
  const tool = memoryManageTool(store, { governance }) as any
  const saved = await tool.execute({ action: 'save', content: '临时结论：端口是 51739' })
  assert.equal(saved.ok, true)

  const feedback = await tool.execute({ action: 'feedback', id: saved.entry.id, verdict: 'useful' })
  assert.equal(feedback.committed, true)
  assert.equal(store.get(saved.entry.id)?.helpfulCount, 1)

  const missing = await tool.execute({ action: 'feedback', id: saved.entry.id })
  assert.equal(missing.ok, false, '缺 verdict 必须报错并给出缺失清单')
})

test('memory_manage：缺 memoryKey 的记忆更新后就地改写，不再产生重复条目（0.50.2）', async () => {
  const { store, governance } = makeRig()
  const tool = memoryManageTool(store, { governance }) as any
  const saved = await tool.execute({ action: 'save', content: '旧结论：暂存端口 3080' })
  const id = saved.entry.id
  assert.equal(store.get(id)?.memoryKey, undefined, '该用例要求条目本身没有 memoryKey')

  const before = store.listAll().filter((entry) => entry.state === 'active').length
  const updated = await tool.execute({ action: 'update', id, content: '新结论：暂存端口固定 3081' })
  assert.equal(updated.committed, true)
  assert.equal(store.get(id)?.content, '新结论：暂存端口固定 3081', '必须就地改写这一条')
  assert.equal(store.get(id)?.state, 'active')
  const after = store.listAll().filter((entry) => entry.state === 'active').length
  assert.equal(after, before, '更新不得新增活跃条目')
  // 旧说法进负层，避免它再被当成有效答案召回。
  assert.ok(governance.negatives.list().some((item) => item.kind === 'superseded' && item.content.includes('3080')))
})

test('MemoryDreamService：空输出重试会放宽 max_tokens 并压短提示（0.50.2）', async () => {
  const { store, ragStore } = makeRig()
  for (let i = 0; i < 10; i += 1) seedWithId(store, 'empty-' + i, '待整理记忆 ' + i + '：内容各不相同')
  const budgets: number[] = []
  const systems: string[] = []
  const dream = new MemoryDreamService({
    native: store,
    generate: async (input) => {
      budgets.push(input.maxTokens ?? 0)
      systems.push(input.system)
      // 首轮空输出（推理模型把预算吃光的真实故障形态），第二轮给出合法数组。
      return budgets.length === 1 ? '' : '[]'
    },
    config: () => ({ ...DEFAULT_MEMORY_SETTINGS, dreamEnabled: true, dreamMaxTokens: 8192 }),
    listDomain: (domain) => ragStore.listDomainDocs(domain),
    putDomain: (domain, id, data) => ragStore.putDomainDoc(domain, id, data),
    deleteDomain: (domain, id) => ragStore.deleteDomainDoc(domain, id),
  })
  const run = await dream.run(true)
  assert.equal(run.retried, true, '空输出必须触发一次重试')
  assert.equal(budgets.length, 2)
  assert.ok(budgets[1] > budgets[0], '重试必须放宽 token 预算：' + budgets.join(' → '))
  assert.ok(systems[1].length < systems[0].length, '空输出重试必须压短系统提示，否则会再失败一次')
  assert.ok(systems[1].includes('JSON'), '重试提示仍要强调只输出 JSON')
})

test('memory_manage delete：归档的说法写进负记忆层（0.50.2）', async () => {
  const { store, governance } = makeRig()
  const tool = memoryManageTool(store, { governance }) as any
  const saved = await tool.execute({ action: 'save', content: '要删除的旧说法：默认分支是 main' })
  const id = saved.entry.id
  // 伪造一条用户明确的删除指令，绕过 Host 确认门槛（真实的确认校验另有测试覆盖）。
  const exec = {
    agent: {
      session: {
        id: 'session-test',
        snapshotEvents: () => [{
          seq: 1,
          type: 'user/message',
          data: { id: 'msg-1', source: { kind: 'user' }, content: [{ type: 'text', text: '删除这条：要删除的旧说法：默认分支是 main' }] },
        }],
      },
    },
  }
  const deleted = await tool.execute({ action: 'delete', id }, exec)
  assert.equal(deleted.ok, true)
  assert.equal(store.get(id)?.state, 'archived')
  const negatives = governance.negatives.list()
  assert.ok(negatives.some((item) => item.kind === 'rejected' && item.content.includes('默认分支是 main')), '归档的说法必须落负层')
})
