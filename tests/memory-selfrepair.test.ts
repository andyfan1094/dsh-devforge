/**
 * 轮末记忆自评修复（0.55.0）回归测试。
 *
 * 这组用例锁住的是「全自动动库」的安全边界：辉哥 2026-10-19 决策是每轮自动跑、含删除，
 * 所以真正需要被钉死的不是「能不能改」，而是「不该改的绝不动」——
 * 没证据不改、没有注入不调模型、两道限额必须生效、钉选条目永不自动归档、
 * 模型输出坏了也不能影响会话收尾。全部用内存库 + 假 generate，零网络。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RagStore } from '../src/rag/rag-store.ts'
import { closeAllDb } from '../src/store/db.ts'
import { NativeMemoryStore } from '../src/memory/native.ts'
import { MemoryGovernanceService, MEMORY_AUDIT_DOMAIN, MEMORY_FEEDBACK_DOMAIN } from '../src/memory/governance.ts'
import { DEFAULT_MEMORY_SETTINGS } from '../src/memory/routes.ts'
import { MemorySelfRepairService, parseSelfRepairActions } from '../src/memory/selfrepair.ts'
import type { MemoryGenerateFn } from '../src/memory/sediment.ts'
import type { MemoryRecallTrace, MemorySettings, NativeMemoryEntry, NativeMemoryInput } from '../src/memory/protocol.ts'

interface RigOptions {
  /** 模型答复（数组时按调用次序取，用完后重复最后一条）。 */
  reply?: string | string[]
  settings?: Partial<MemorySettings>
  /** 需要精确控制模型调用时（抛错、调用途中改库）用它兜底。 */
  onGenerate?: (system: string, user: string, ctx: { store: NativeMemoryStore; governance: MemoryGovernanceService }) => Promise<string>
}

interface Rig {
  rag: RagStore
  store: NativeMemoryStore
  governance: MemoryGovernanceService
  service: MemorySelfRepairService
  prompts: Array<{ system: string; user: string }>
  dispose: () => void
}

function makeRig(options: RigOptions = {}): Rig {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-selfrepair-'))
  const rag = new RagStore(join(dir, 'store.db'))
  const store = new NativeMemoryStore(rag)
  const governance = new MemoryGovernanceService(rag, store)
  const prompts: Array<{ system: string; user: string }> = []
  const replies = Array.isArray(options.reply) ? options.reply : options.reply === undefined ? [''] : [options.reply]
  const generate: MemoryGenerateFn = async (system, user) => {
    prompts.push({ system, user })
    if (options.onGenerate !== undefined) return options.onGenerate(system, user, { store, governance })
    return replies[Math.min(prompts.length - 1, replies.length - 1)] ?? ''
  }
  const service = new MemorySelfRepairService(store, governance, generate, () => ({ ...DEFAULT_MEMORY_SETTINGS, ...(options.settings ?? {}) }))
  const dispose = (): void => {
    service.dispose()
    closeAllDb()
    rmSync(dir, { recursive: true, force: true })
  }
  return { rag, store, governance, service, prompts, dispose }
}

function seedEntry(store: NativeMemoryStore, input: Partial<NativeMemoryInput> & { id: string }): NativeMemoryEntry {
  const { id, ...rest } = input
  return store.create({ content: '这是一条测试记忆正文', category: 'fact', source: 'test', scope: { kind: 'global' }, ...rest }, id)
}

/** 造一条召回轨迹：默认把给定 id 都标记为真正进入上下文。 */
function recallTrace(input: {
  sessionId: string
  turn: number
  ids?: string[]
  excludedIds?: string[]
  mirrorIds?: string[]
  id?: string
}): MemoryRecallTrace {
  return {
    id: input.id ?? 'trace-' + input.sessionId + '-' + input.turn,
    sessionId: input.sessionId,
    turn: input.turn,
    queryHash: 'hash',
    queryPreview: '预览',
    scope: { kind: 'global' },
    latencyMs: 3,
    outcome: 'hit',
    degradedLayers: [],
    hits: [
      ...(input.ids ?? []).map((entryId) => ({ entryId, layer: 'native' as const, score: 0.9, included: true })),
      ...(input.excludedIds ?? []).map((entryId) => ({ entryId, layer: 'native' as const, score: 0.1, included: false })),
      ...(input.mirrorIds ?? []).map((entryId) => ({ entryId, layer: 'mirror' as const, score: 0.5, included: true })),
    ],
    createdAt: Date.now(),
  }
}

function auditRows(rag: RagStore): Array<{ action?: string; reason?: string; ids?: string[] }> {
  return rag.listDomainDocs(MEMORY_AUDIT_DOMAIN).map((row) => row.data as { action?: string; reason?: string; ids?: string[] })
}

function feedbackRows(rag: RagStore): Array<{ entryId?: string; verdict?: string; note?: string }> {
  return rag.listDomainDocs(MEMORY_FEEDBACK_DOMAIN).map((row) => row.data as { entryId?: string; verdict?: string; note?: string })
}

const DIALOG = { userText: '辉哥说暂存实例用 3081 端口，不要用 3080', assistantText: '已确认：暂存实例固定 3081 端口，生产 3080，两者隔离。' }

// ---------------------------------------------------------------------------
// 不调模型的路径：这些轮次占绝大多数，必须零开销、零副作用
// ---------------------------------------------------------------------------

test('本轮无注入记忆：一次模型都不调，库与审计零副作用', async () => {
  const rig = makeRig({ reply: '{"actions":[{"id":"x","action":"archive"}]}' })
  try {
    seedEntry(rig.store, { id: 'mem-unused', content: '这条记忆本轮没有被注入，不该被自评碰到' })
    // 有轨迹但命中未装入上下文（included=false），等同没有注入。
    rig.governance.recordRecall(recallTrace({ sessionId: 's1', turn: 1, excludedIds: ['mem-unused'] }))
    const result = await rig.service.run({ sessionId: 's1', turn: 1, ...DIALOG })
    assert.equal(rig.prompts.length, 0, '没有真正注入的记忆时不允许调模型（每轮都跑，成本必须可控）')
    assert.equal(result.injected, 0)
    assert.equal(rig.store.get('mem-unused')?.state, 'active')
    assert.equal(auditRows(rig.rag).length, 0, '什么都没做就不该写审计')
  } finally { rig.dispose() }
})

test('mirror 层命中不算注入记忆：chunkId 不是 native 记忆', async () => {
  const rig = makeRig({ reply: '{"actions":[{"id":"chunk-1","action":"archive"}]}' })
  try {
    rig.governance.recordRecall(recallTrace({ sessionId: 's1', turn: 1, mirrorIds: ['chunk-1'] }))
    const result = await rig.service.run({ sessionId: 's1', turn: 1, ...DIALOG })
    assert.equal(result.injected, 0, '镜像库 entryId 是 chunkId，不能当记忆 id 用')
    assert.equal(rig.prompts.length, 0)
  } finally { rig.dispose() }
})

test('自评开关关闭：整轮跳过，连注入统计都不计', async () => {
  const rig = makeRig({ reply: '{"actions":[{"id":"mem-1","action":"archive"}]}', settings: { selfRepairEnabled: false } })
  try {
    seedEntry(rig.store, { id: 'mem-1' })
    rig.governance.recordRecall(recallTrace({ sessionId: 's1', turn: 1, ids: ['mem-1'] }))
    const result = await rig.service.run({ sessionId: 's1', turn: 1, ...DIALOG })
    assert.equal(rig.prompts.length, 0)
    assert.equal(result.injected, 0)
    assert.equal(rig.store.get('mem-1')?.state, 'active')
  } finally { rig.dispose() }
})

test('本轮对话窗口为空：没有证据就不调模型（防止逼模型凭猜测改）', async () => {
  const rig = makeRig({ reply: '{"actions":[{"id":"mem-1","action":"archive"}]}' })
  try {
    seedEntry(rig.store, { id: 'mem-1' })
    rig.governance.recordRecall(recallTrace({ sessionId: 's1', turn: 1, ids: ['mem-1'] }))
    const result = await rig.service.run({ sessionId: 's1', turn: 1 })
    assert.equal(rig.prompts.length, 0)
    assert.equal(result.injected, 1, '注入统计仍然记账，只是不改库')
    assert.equal(rig.store.get('mem-1')?.state, 'active')
  } finally { rig.dispose() }
})

test('动作数上限为 0 时视为用户关闭自动改动：不调模型', async () => {
  const rig = makeRig({ reply: '{"actions":[{"id":"mem-1","action":"update","content":"改后的正文内容"}]}', settings: { selfRepairMaxActions: 0 } })
  try {
    seedEntry(rig.store, { id: 'mem-1', content: '原来的正文' })
    rig.governance.recordRecall(recallTrace({ sessionId: 's1', turn: 1, ids: ['mem-1'] }))
    const result = await rig.service.run({ sessionId: 's1', turn: 1, ...DIALOG })
    assert.equal(rig.prompts.length, 0)
    assert.equal(rig.store.get('mem-1')?.content, '原来的正文')
    assert.equal(result.updated, 0)
  } finally { rig.dispose() }
})

// ---------------------------------------------------------------------------
// 四类会写库的动作
// ---------------------------------------------------------------------------

test('outdated：条目被隔离，且负记忆层留下记录', async () => {
  const rig = makeRig({ reply: '{"actions":[{"id":"mem-port","action":"outdated","reason":"本轮确认暂存端口已改为 3081"}]}' })
  try {
    seedEntry(rig.store, { id: 'mem-port', content: '暂存实例使用 3080 端口' })
    rig.governance.recordRecall(recallTrace({ sessionId: 's1', turn: 1, ids: ['mem-port'] }))
    const result = await rig.service.run({ sessionId: 's1', turn: 1, ...DIALOG })
    assert.equal(result.outdated, 1)
    const meta = rig.store.getMeta('mem-port')
    assert.equal(meta?.state, 'quarantined', '过时走隔离（可逆），不是硬删除')
    // 负层是「错误说法不得再被采用」的闸门：没有它，换个措辞又会长回来。
    const negatives = rig.governance.negatives.list()
    assert.equal(negatives.length, 1)
    assert.equal(negatives[0]!.kind, 'superseded')
    assert.ok(negatives[0]!.content.includes('3080'))
  } finally { rig.dispose() }
})

test('incorrect：同样隔离，负层记为 falsified', async () => {
  const rig = makeRig({ reply: '{"actions":[{"id":"mem-bad","action":"incorrect","reason":"本轮工具输出证明该结论错误"}]}' })
  try {
    seedEntry(rig.store, { id: 'mem-bad', content: 'dsh-devforge 用 npm 发布' })
    rig.governance.recordRecall(recallTrace({ sessionId: 's1', turn: 1, ids: ['mem-bad'] }))
    const result = await rig.service.run({ sessionId: 's1', turn: 1, ...DIALOG })
    assert.equal(result.incorrect, 1)
    assert.equal(rig.store.getMeta('mem-bad')?.state, 'quarantined')
    assert.equal(rig.governance.negatives.list()[0]!.kind, 'falsified')
  } finally { rig.dispose() }
})

test('update：正文被就地更新，版本号前进', async () => {
  const rig = makeRig({ reply: '{"actions":[{"id":"mem-up","action":"update","content":"暂存实例固定 3081 端口，生产固定 3080，两者必须隔离","reason":"本轮用户明确纠正端口"}]}' })
  try {
    const before = seedEntry(rig.store, { id: 'mem-up', content: '暂存实例和生产都用 3080 端口' })
    rig.governance.recordRecall(recallTrace({ sessionId: 's1', turn: 1, ids: ['mem-up'] }))
    const result = await rig.service.run({ sessionId: 's1', turn: 1, ...DIALOG })
    assert.equal(result.updated, 1)
    const after = rig.store.get('mem-up')!
    assert.equal(after.content, '暂存实例固定 3081 端口，生产固定 3080，两者必须隔离')
    assert.equal(after.revision, before.revision + 1)
    assert.equal(after.state, 'active')
  } finally { rig.dispose() }
})

test('update：与现文仅空白差异时不制造新版本', async () => {
  const rig = makeRig({ reply: '{"actions":[{"id":"mem-same","action":"update","content":"暂存实例用 3081 端口"}]}' })
  try {
    const before = seedEntry(rig.store, { id: 'mem-same', content: '暂存实例用 3081 端口' })
    rig.governance.recordRecall(recallTrace({ sessionId: 's1', turn: 1, ids: ['mem-same'] }))
    const result = await rig.service.run({ sessionId: 's1', turn: 1, ...DIALOG })
    assert.equal(result.updated, 0)
    assert.equal(result.kept, 1, '同义改动算保留，不算修正')
    assert.equal(rig.store.get('mem-same')?.revision, before.revision)
  } finally { rig.dispose() }
})

test('archive：软归档且 archivedBy=selfrepair，同时写负层与审计', async () => {
  const rig = makeRig({ reply: '{"actions":[{"id":"mem-junk","action":"archive","reason":"本轮确认该任务已终结，这条过程记录无长期价值"}]}' })
  try {
    seedEntry(rig.store, { id: 'mem-junk', content: '某次构建产物大小 42401 字节' })
    rig.governance.recordRecall(recallTrace({ sessionId: 's1', turn: 1, ids: ['mem-junk'] }))
    const result = await rig.service.run({ sessionId: 's1', turn: 1, ...DIALOG })
    assert.equal(result.archived, 1)
    const after = rig.store.get('mem-junk')!
    assert.equal(after.state, 'archived')
    // 归档来源必须可辨：面板要能区分「人删的 / 管家删的 / 自评删的」。
    // 走真实读回路径（asMeta 解析）断言，锁住「写得进去也必须读得出来」这一点——
    // 这里曾经是坏的：protocol.ts 的联合与 archive() 形参都加了 'selfrepair'，
    // 但 asMeta 白名单漏了它，面板永远显示不出来源。
    assert.equal(after.archivedBy, 'selfrepair')
    assert.equal(rig.store.getMeta('mem-junk')?.archivedBy, 'selfrepair')
    assert.equal(rig.store.listArchived().find((entry) => entry.id === 'mem-junk')?.archivedBy, 'selfrepair')
    assert.equal(rig.governance.negatives.list().length, 1, '归档要写负层，防止同义说法重新长回来')
    const audit = auditRows(rig.rag).find((row) => row.action === 'selfrepair')
    assert.notEqual(audit, undefined)
    assert.ok(audit!.reason!.includes('归档 1'), '审计里要能看出这轮归档了几条')
    assert.deepEqual(audit!.ids, ['mem-junk'])
  } finally { rig.dispose() }
})

test('同一 id 出现多条动作：只应用第一条，其余记跳过（不重复占额度、不自我矛盾）', async () => {
  const rig = makeRig({
    reply: '{"actions":[{"id":"mem-dup","action":"update","content":"修正后的正文内容"},{"id":"mem-dup","action":"archive","reason":"重复"}]}',
  })
  try {
    seedEntry(rig.store, { id: 'mem-dup', content: '原始正文' })
    rig.governance.recordRecall(recallTrace({ sessionId: 's1', turn: 1, ids: ['mem-dup'] }))
    const result = await rig.service.run({ sessionId: 's1', turn: 1, ...DIALOG })
    assert.equal(result.updated, 1)
    assert.equal(result.archived, 0, '刚更新的条目不该立刻又被归档')
    assert.equal(result.skipped, 1)
    const after = rig.store.get('mem-dup')!
    assert.equal(after.state, 'active')
    assert.equal(after.content, '修正后的正文内容')
  } finally { rig.dispose() }
})

// ---------------------------------------------------------------------------
// 不该动的：非法 id、已失效条目、钉选条目
// ---------------------------------------------------------------------------

test('模型编造的 id 与已归档 id：跳过且不抛错', async () => {
  const rig = makeRig({ reply: '{"actions":[{"id":"mem-not-exist","action":"archive"},{"id":"mem-gone","action":"update","content":"试图改一条已经归档的记忆"}]}' })
  try {
    seedEntry(rig.store, { id: 'mem-live', content: '本轮注入的正常记忆' })
    seedEntry(rig.store, { id: 'mem-gone', content: '早已归档的记忆' })
    rig.store.archive('mem-gone', true, 'user')
    rig.governance.recordRecall(recallTrace({ sessionId: 's1', turn: 1, ids: ['mem-live', 'mem-gone'] }))
    const result = await rig.service.run({ sessionId: 's1', turn: 1, ...DIALOG })
    assert.equal(result.skipped, 2, '未知 id 与已失效条目都只记跳过')
    assert.equal(result.archived, 0)
    assert.equal(rig.store.get('mem-gone')?.content, '早已归档的记忆', '已归档条目的正文不得被改')
    assert.equal(rig.store.get('mem-live')?.state, 'active')
  } finally { rig.dispose() }
})

test('模型调用途中条目被别的路径归档：应用前复查状态，放弃动作', async () => {
  const rig = makeRig({
    onGenerate: async (_system, _user, ctx) => {
      // 模拟「本轮里工具刚把这条归档了」：注入快照是旧的，应用时必须重新读库。
      ctx.store.archive('mem-race', true, 'user')
      return '{"actions":[{"id":"mem-race","action":"update","content":"这条不该再被改动"}]}'
    },
  })
  try {
    seedEntry(rig.store, { id: 'mem-race', content: 'race 前的正文' })
    rig.governance.recordRecall(recallTrace({ sessionId: 's1', turn: 1, ids: ['mem-race'] }))
    const result = await rig.service.run({ sessionId: 's1', turn: 1, ...DIALOG })
    assert.equal(result.updated, 0)
    assert.equal(result.skipped, 1)
    assert.equal(rig.store.get('mem-race')?.content, 'race 前的正文')
  } finally { rig.dispose() }
})

test('钉选条目不被自动归档：只记一条反馈，库状态原样', async () => {
  const rig = makeRig({ reply: '{"actions":[{"id":"mem-pin","action":"archive","reason":"模型认为这条已经没用"}]}' })
  try {
    seedEntry(rig.store, { id: 'mem-pin', content: '辉哥钉选的硬规则：任何交付都必须推送 CNB', pinned: true })
    rig.governance.recordRecall(recallTrace({ sessionId: 's1', turn: 1, ids: ['mem-pin'] }))
    const result = await rig.service.run({ sessionId: 's1', turn: 1, ...DIALOG })
    assert.equal(result.archived, 0)
    assert.equal(result.pinnedSkipped, 1)
    const after = rig.store.get('mem-pin')!
    assert.equal(after.state, 'active', '钉选是用户显式立场，轮末自评无权删')
    assert.equal(after.pinned, true)
    // 意见要留痕，但只作为反馈，不产生任何库变更。
    const feedback = feedbackRows(rig.rag)
    assert.equal(feedback.length, 1)
    assert.equal(feedback[0]!.verdict, 'irrelevant')
    assert.ok(feedback[0]!.note!.includes('钉选'))
    assert.equal(rig.governance.negatives.list().length, 0, '没归档就不该污染负层')
  } finally { rig.dispose() }
})

// ---------------------------------------------------------------------------
// 两道爆炸半径闸门
// ---------------------------------------------------------------------------

test('总动作数超过 selfRepairMaxActions：截断到上限，其余记为丢弃', async () => {
  const reply = '{"actions":[' + ['m1', 'm2', 'm3', 'm4'].map((id) => '{"id":"' + id + '","action":"update","content":"修正后的正文 ' + id + '"}').join(',') + ']}'
  const rig = makeRig({ reply, settings: { selfRepairMaxActions: 2 } })
  try {
    for (const id of ['m1', 'm2', 'm3', 'm4']) seedEntry(rig.store, { id, content: '原始正文 ' + id })
    rig.governance.recordRecall(recallTrace({ sessionId: 's1', turn: 1, ids: ['m1', 'm2', 'm3', 'm4'] }))
    const result = await rig.service.run({ sessionId: 's1', turn: 1, ...DIALOG })
    assert.equal(result.updated, 2)
    assert.equal(result.dropped, 2)
    assert.equal(rig.store.get('m3')?.content, '原始正文 m3', '超出限额的动作必须被丢弃')
    const audit = auditRows(rig.rag).find((row) => row.action === 'selfrepair')
    assert.ok(audit!.reason!.includes('限额丢弃 2'), '丢弃数量要写进审计，否则无从追溯')
  } finally { rig.dispose() }
})

test('归档数超过 selfRepairMaxArchive：即便总动作额度没用完也照样挡下', async () => {
  const reply = '{"actions":[' + ['a1', 'a2', 'a3'].map((id) => '{"id":"' + id + '","action":"archive","reason":"重复"}').join(',') + ']}'
  const rig = makeRig({ reply, settings: { selfRepairMaxActions: 5, selfRepairMaxArchive: 1 } })
  try {
    for (const id of ['a1', 'a2', 'a3']) seedEntry(rig.store, { id, content: '待清理正文 ' + id })
    rig.governance.recordRecall(recallTrace({ sessionId: 's1', turn: 1, ids: ['a1', 'a2', 'a3'] }))
    const result = await rig.service.run({ sessionId: 's1', turn: 1, ...DIALOG })
    assert.equal(result.archived, 1)
    assert.equal(result.dropped, 2)
    const archived = ['a1', 'a2', 'a3'].filter((id) => rig.store.get(id)?.state === 'archived')
    assert.equal(archived.length, 1)
    assert.ok(auditRows(rig.rag).some((row) => (row.reason ?? '').includes('归档 1') && (row.reason ?? '').includes('限额丢弃 2')))
  } finally { rig.dispose() }
})

// ---------------------------------------------------------------------------
// 容错：模型输出与调用失败都不允许影响会话收尾
// ---------------------------------------------------------------------------

test('模型输出非法 JSON：不抛错、无任何副作用，并记一条解析失败审计', async () => {
  const rig = makeRig({ reply: '我觉得这些记忆都挺合理的，不需要改。' })
  try {
    seedEntry(rig.store, { id: 'mem-x', content: '原始正文' })
    rig.governance.recordRecall(recallTrace({ sessionId: 's1', turn: 1, ids: ['mem-x'] }))
    const result = await rig.service.run({ sessionId: 's1', turn: 1, ...DIALOG })
    assert.deepEqual(result, { injected: 1, kept: 0, updated: 0, outdated: 0, incorrect: 0, archived: 0, pinnedSkipped: 0, skipped: 0, dropped: 0 })
    assert.equal(rig.store.get('mem-x')?.content, '原始正文')
    assert.equal(rig.store.get('mem-x')?.state, 'active')
    assert.ok(auditRows(rig.rag).some((row) => row.action === 'selfrepair-parse-failed'))
  } finally { rig.dispose() }
})

test('模型调用抛错：异常被吞掉，记失败计数与审计', async () => {
  const rig = makeRig({ onGenerate: async () => { throw new Error('503 服务不可用') } })
  try {
    seedEntry(rig.store, { id: 'mem-y', content: '原始正文' })
    rig.governance.recordRecall(recallTrace({ sessionId: 's1', turn: 1, ids: ['mem-y'] }))
    const result = await rig.service.run({ sessionId: 's1', turn: 1, ...DIALOG })
    assert.equal(result.updated, 0)
    assert.equal(rig.service.failureCount, 1)
    assert.ok(rig.service.lastError.includes('503'))
    assert.ok(auditRows(rig.rag).some((row) => row.action === 'selfrepair-failed'))
    assert.equal(rig.store.get('mem-y')?.content, '原始正文')
  } finally { rig.dispose() }
})

test('parseSelfRepairActions：围栏、前置解释、裸数组都能解析', () => {
  const fenced = '```json\n{"actions":[{"id":"a1","action":"update","content":"新正文"}]}\n```'
  assert.deepEqual(parseSelfRepairActions(fenced), [{ id: 'a1', action: 'update', content: '新正文' }])

  const chatty = '好的，我检查完了：{"actions":[{"id":"a2","action":"keep"},{"id":"a3","action":"archive","reason":"重复"}]} 以上。'
  assert.equal(parseSelfRepairActions(chatty).length, 2)

  const bare = '[{"id":"a4","action":"outdated"}]'
  assert.equal(parseSelfRepairActions(bare)[0]!.action, 'outdated')

  // 非法动作名与非对象项直接丢弃，不猜、不补。
  const dirty = '{"actions":[{"id":"a5","action":"删除"},{"action":"update"},null,"x"]}'
  assert.deepEqual(parseSelfRepairActions(dirty), [])

  assert.deepEqual(parseSelfRepairActions(''), [])
  assert.deepEqual(parseSelfRepairActions('完全不是 JSON'), [])
})

// ---------------------------------------------------------------------------
// 事件接线
// ---------------------------------------------------------------------------

/** 最小事件上下文替身：on 注册，emit 触发（与 memory-workflow 的 fakeCtx 同形）。 */
function fakeCtx(): { on: (event: string, listener: (...args: never[]) => unknown) => () => void; emit: (event: string, ...args: unknown[]) => void } {
  const listeners = new Map<string, Array<(...args: never[]) => unknown>>()
  return {
    on: (event, listener) => {
      const list = listeners.get(event) ?? []
      list.push(listener)
      listeners.set(event, list)
      return () => { const rest = listeners.get(event) ?? []; const index = rest.indexOf(listener); if (index >= 0) rest.splice(index, 1) }
    },
    emit: (event, ...args) => { for (const listener of listeners.get(event) ?? []) listener(...args) },
  }
}

test('attach：真实宿主形状（只有 snapshotEvents）turn/end 后自动跑一轮自评', async () => {
  const rig = makeRig({ reply: '{"actions":[{"id":"mem-attach","action":"update","content":"暂存实例固定 3081 端口"}]}' })
  try {
    seedEntry(rig.store, { id: 'mem-attach', content: '暂存实例用 3080 端口' })
    rig.governance.recordRecall(recallTrace({ sessionId: 's-attach', turn: 1, ids: ['mem-attach'] }))
    const events = [
      { type: 'user/message', data: { role: 'user', content: [{ type: 'text', text: DIALOG.userText }] } },
      { type: 'assistant/message', data: { turn: 1, step: 1, message: { content: [{ type: 'text', text: DIALOG.assistantText }] } } },
      { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
    ]
    const ctx = fakeCtx()
    rig.service.attach(ctx)
    ctx.emit('session/event', { id: 's-attach', snapshotEvents: () => events }, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
    // 监听器是 fire-and-forget（绝不能阻塞宿主收尾），所以这里等它跑完。
    await new Promise((resolve) => setTimeout(resolve, 30))
    assert.equal(rig.prompts.length, 1)
    assert.ok(rig.prompts[0]!.user.includes('3081'), '提示词要带上本轮对话，模型才可能看到证据')
    assert.equal(rig.store.get('mem-attach')?.content, '暂存实例固定 3081 端口')
  } finally { rig.dispose() }
})

test('attach：非 turn/end 事件与非本轮会话不触发自评', async () => {
  const rig = makeRig({ reply: '{"actions":[{"id":"mem-z","action":"archive"}]}' })
  try {
    seedEntry(rig.store, { id: 'mem-z', content: '原始正文' })
    rig.governance.recordRecall(recallTrace({ sessionId: 's-other', turn: 1, ids: ['mem-z'] }))
    const ctx = fakeCtx()
    rig.service.attach(ctx)
    const session = { id: 's-other', events: [] }
    // ① 不是 turn/end；② turn/end 但轮次对不上——相邻轮次不得补位，
    //    否则会拿本轮的证据去改上一轮注入的记忆，凭空放大爆炸半径。
    ctx.emit('session/event', session, { type: 'step/end', data: { turn: 1 } })
    ctx.emit('session/event', session, { type: 'turn/end', data: { turn: 2, reason: { kind: 'completed' } } })
    await new Promise((resolve) => setTimeout(resolve, 30))
    assert.equal(rig.prompts.length, 0)
    assert.equal(rig.store.get('mem-z')?.state, 'active')
  } finally { rig.dispose() }
})

test('宿主没给轮次号（turn=0）时兜底取本会话最近一条轨迹', async () => {
  const rig = makeRig({ reply: '{"actions":[{"id":"mem-t0","action":"update","content":"兜底路径也能修正的正文"}]}' })
  try {
    seedEntry(rig.store, { id: 'mem-t0', content: '原始正文' })
    rig.governance.recordRecall(recallTrace({ sessionId: 's-zero', turn: 7, ids: ['mem-t0'] }))
    // turn=0 表示宿主未提供轮次号：此时无法精确定位，只能退到最近一条轨迹。
    // 事件流里的 turn/end 同样不带 turn（模拟缺轮次号的宿主形状）。
    const events = [
      { type: 'user/message', data: { role: 'user', content: [{ type: 'text', text: DIALOG.userText }] } },
      { type: 'assistant/message', data: { turn: 7, step: 1, message: { content: [{ type: 'text', text: DIALOG.assistantText }] } } },
      { type: 'turn/end', data: { reason: { kind: 'completed' } } },
    ]
    const ctx = fakeCtx()
    rig.service.attach(ctx)
    ctx.emit('session/event', { id: 's-zero', snapshotEvents: () => events }, { type: 'turn/end', data: { reason: { kind: 'completed' } } })
    await new Promise((resolve) => setTimeout(resolve, 30))
    assert.equal(rig.prompts.length, 1)
    assert.equal(rig.store.get('mem-t0')?.content, '兜底路径也能修正的正文')
  } finally { rig.dispose() }
})
