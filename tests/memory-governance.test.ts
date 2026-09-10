/**
 * 可信记忆治理专项测试：sidecar 兼容、候选治理、作用域隔离、混合召回与反馈红线。
 * 全部使用临时 store.db 与 fake 模型/RAG，零网络。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RagStore } from '../src/rag/rag-store.ts'
import { closeDb } from '../src/store/db.ts'
import { NativeMemoryStore, MEMORY_META_DOMAIN, NATIVE_MEMORY_DOMAIN } from '../src/memory/native.ts'
import { MemoryGovernanceService } from '../src/memory/governance.ts'
import { MemoryRecallService } from '../src/memory/recall.ts'
import { MemoryInjectionService } from '../src/memory/inject.ts'
import { memoryManageTool } from '../src/memory/tools.ts'
import { memoryScopeMatches, resolveMemoryScope } from '../src/memory/scope.ts'
import { DEFAULT_RAG_SETTINGS, type RagEmbedder, type RagService } from '../src/rag/service.ts'
import type { ProjectEntry } from '../src/projects/protocol.ts'
import type { MemoryScopeContext, MemorySettings, NativeMemoryEntry } from '../src/memory/protocol.ts'

/** 每个用例独立临时库。 */
function makeRig(): { store: NativeMemoryStore; governance: MemoryGovernanceService; ragStore: RagStore; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-mem-gov-'))
  const ragStore = new RagStore(join(dir, 'store.db'), join(dir, 'rag-vec.db'))
  const store = new NativeMemoryStore(ragStore)
  return { store, governance: new MemoryGovernanceService(ragStore, store), ragStore, dir }
}

function cleanup(dir: string): void {
  closeDb(join(dir, 'store.db'))
  rmSync(dir, { recursive: true, force: true })
}

function projectEntry(id: string, path: string): ProjectEntry {
  return { id, name: id, path, machinePaths: {}, description: '', repoKind: 'none' as ProjectEntry['repoKind'], repoUrl: '', repoBranch: '', siteUrl: '', deployTargets: [] }
}

const SETTINGS: MemorySettings = { enabled: true, autoSediment: true, autoInject: true, autoReflect: true, autoAcceptExplicit: true, semanticRecall: true, scopeIsolation: true, feedbackTracking: true, semanticWeight: 0.35, topK: 4, threshold: 0.35, maxChars: 1200, dreamEnabled: false, dreamIdleMinutes: 10, dreamMinIntervalHours: 6, dreamProvider: '', dreamModel: '', dreamMaxTokens: 8192, dreamMaxEntries: 300, dreamMaxChars: 240, sedimentProvider: '', sedimentModel: '' }

function entryScope(entry: NativeMemoryEntry | undefined): MemoryScopeContext { return entry?.scope ?? { kind: 'global' } }

test('sidecar 兼容：无 meta 的旧 memory.entry 按 legacy/global/active 读取', () => {
  const { ragStore, store, dir } = makeRig()
  try {
    ragStore.putDomainDoc(NATIVE_MEMORY_DOMAIN, 'legacy-1', { id: 'legacy-1', content: '旧版条目没有元数据', category: 'fact', tags: [], source: 'session', importance: 3, createdAt: 1000, updatedAt: 1000 })
    const entry = store.get('legacy-1')
    assert.equal(entry?.trust, 'legacy')
    assert.equal(entry?.scope.kind, 'global')
    assert.equal(entry?.state, 'active')
    assert.equal(entry?.revision, 1)
    assert.equal(entry?.supersedes.length, 0)
    // 兼容读取是惰性的；首次 update 后 sidecar 落盘，正文结构未动。
    store.update('legacy-1', { importance: 4 })
    assert.ok(ragStore.listDomainDocs(MEMORY_META_DOMAIN).some((row) => row.id === 'legacy-1'))
  } finally { cleanup(dir) }
})

test('pending 候选永不进入召回；去重候选直接关联现有条目', () => {
  const { store, governance, dir } = makeRig()
  try {
    store.create({ content: '生产重启需要辉哥确认', scope: { kind: 'global' } }, 'rule-1')
    const dup = governance.propose({ content: '生产重启需要辉哥确认', scope: { kind: 'global' }, source: 'session-reflection', sourceId: 's:1' })
    assert.equal(dup.state, 'deduped')
    assert.equal(dup.resultEntryId, 'rule-1')
    const fresh = governance.propose({ content: '暂存实例固定使用隔离 HOME 与 3081 端口', scope: { kind: 'global' }, source: 'session-reflection', sourceId: 's:2' })
    assert.equal(fresh.state, 'pending')
    // 幂等：同 sourceId 重复 propose 返回同一候选。
    assert.equal(governance.propose({ content: '暂存实例固定使用隔离 HOME 与 3081 端口', scope: { kind: 'global' }, source: 'session-reflection', sourceId: 's:2' }).id, fresh.id)
    // pending 候选不出现在任何召回面。
    assert.equal(store.search('暂存实例 3081').length, 0)
    assert.equal(store.list().some((entry) => entry.id === fresh.id), false)
    assert.equal(governance.listCandidates({ states: ['pending'] }).some((item) => item.id === fresh.id), true)
  } finally { cleanup(dir) }
})

test('memory_manage：无 Host 证据的写入只进候选，不激活', async () => {
  const { store, governance, dir } = makeRig()
  try {
    const tool = memoryManageTool(store, { governance, scopeOfAgent: () => ({ kind: 'global' }) }) as any
    const result = await tool.execute({ action: 'save', content: '模型声称用户已确认的独断内容' }, {})
    assert.equal(result.ok, true)
    assert.ok(String(result.message).includes('待审核候选'))
    assert.equal(store.list().length, 0, '无证据写入绝不直接激活')
  } finally { cleanup(dir) }
})

test('memory_manage：Host 回读到直接用户明确要求时自动激活为 confirmed', async () => {
  const { store, governance, dir } = makeRig()
  try {
    const events = [
      { seq: 1, type: 'user/message', data: { id: 'm1', source: { kind: 'user' }, content: [{ type: 'text', text: '请记住：部署服务器是 1.2.3.4' }] } },
    ]
    const exec = { agent: { session: { id: 'sess-1', snapshotEvents: () => events } } }
    const tool = memoryManageTool(store, { governance, scopeOfAgent: () => ({ kind: 'global' }) }) as any
    const result = await tool.execute({ action: 'save', content: '部署服务器是 1.2.3.4' }, exec)
    assert.equal(result.ok, true)
    assert.ok(result.entry, '明确用户请求必须直接激活')
    assert.equal(result.entry.trust, 'confirmed')
    assert.equal(result.entry.source, 'user-reviewed')
    // 同一用户消息重复保存 → 幂等去重，不产生第二条。
    const again = await tool.execute({ action: 'save', content: '部署服务器是 1.2.3.4' }, exec)
    assert.equal(store.list().length, 1)
    assert.equal(again.entry?.id, result.entry.id)
  } finally { cleanup(dir) }
})

test('memory_manage：删除需要用户明确指令；软归档后检索不可见', async () => {
  const { store, governance, dir } = makeRig()
  try {
    store.create({ content: '旧工具链要下线的记录条目' }, 'old-1')
    const tool = memoryManageTool(store, { governance, scopeOfAgent: () => ({ kind: 'global' }) }) as any
    const refused = await tool.execute({ action: 'delete', id: 'old-1' }, {})
    assert.equal(refused.ok, false, '无用户指令不得归档')
    const events = [{ seq: 2, type: 'user/message', data: { id: 'm2', source: { kind: 'user' }, content: [{ type: 'text', text: '把 旧工具链要下线的记录条目 删除掉' }] } }]
    const exec = { agent: { session: { id: 'sess-1', snapshotEvents: () => events } } }
    const ok = await tool.execute({ action: 'delete', id: 'old-1' }, exec)
    assert.equal(ok.ok, true)
    assert.equal(store.get('old-1')?.state, 'archived')
    assert.equal(store.search('旧工具链').length, 0)
  } finally { cleanup(dir) }
})

test('作用域：最长项目路径命中、隔离过滤与跨项目不可见', () => {
  const projects = [projectEntry('p-parent', '/Users/andyfan/Documents/ds'), projectEntry('p-child', '/Users/andyfan/Documents/ds/dsh-devforge')]
  assert.equal(resolveMemoryScope('/Users/andyfan/Documents/ds/dsh-devforge/src', projects).id, 'p-child')
  assert.equal(resolveMemoryScope('/Users/andyfan/Documents/ds/other', projects).id, 'p-parent')
  assert.equal(resolveMemoryScope('/Users/elsewhere', projects).kind, 'workspace')
  const scopeA: MemoryScopeContext = { kind: 'project', id: 'p-child' }
  const entryA = { scope: { kind: 'project' as const, id: 'p-child' } } as NativeMemoryEntry
  const entryB = { scope: { kind: 'project' as const, id: 'p-parent' } } as NativeMemoryEntry
  const entryGlobal = { scope: { kind: 'global' as const } } as NativeMemoryEntry
  assert.equal(memoryScopeMatches(entryA, scopeA, true), true)
  assert.equal(memoryScopeMatches(entryB, scopeA, true), false, '跨项目记忆必须被硬过滤')
  assert.equal(memoryScopeMatches(entryGlobal, scopeA, true), true, '全局记忆始终可见')
  assert.equal(memoryScopeMatches(entryB, scopeA, false), true, '关闭隔离时不过滤')

  const { store, dir } = makeRig()
  try {
    store.create({ content: '全局红线：生产重启需确认', scope: { kind: 'global' } }, 'g1')
    store.create({ content: 'A 项目专属事实', scope: { kind: 'project', id: 'p-child' } }, 'a1')
    store.create({ content: 'B 项目专属事实', scope: { kind: 'project', id: 'p-parent' } }, 'b1')
    const visible = store.list({ scope: scopeA, isolateScope: true }).map((entry) => entry.id).sort()
    assert.deepEqual(visible, ['a1', 'g1'])
    assert.deepEqual(store.search('A 项目专属事实', { scope: scopeA, isolateScope: true }).map((entry) => entry.id), ['a1'])
  } finally { cleanup(dir) }
})

test('候选审核：冲突必须显式取代，且取代链原子落库', () => {
  const { store, governance, dir } = makeRig()
  try {
    store.create({ content: '服务端口是 3000', scope: { kind: 'global' }, memoryKey: 'service.port' }, 'old-fact')
    const candidate = governance.propose({ content: '服务端口改为 3081', scope: { kind: 'global' }, memoryKey: 'service.port', source: 'session-reflection', sourceId: 's:9' })
    assert.equal(candidate.state, 'needs-resolution')
    assert.deepEqual(candidate.conflictIds, ['old-fact'])
    // 不给取代清单 → 拒绝。
    assert.throws(() => governance.review({ id: candidate.id, action: 'approve' }))
    const result = governance.review({ id: candidate.id, action: 'approve', supersedesIds: ['old-fact'], reason: '端口迁移完成' })
    assert.equal(result.entry?.state, 'active')
    assert.equal(result.entry?.trust, 'confirmed')
    assert.deepEqual(result.entry?.supersedes, ['old-fact'])
    const old = store.get('old-fact')
    assert.equal(old?.state, 'superseded')
    assert.equal(old?.supersededBy, result.entry?.id)
    const relations = store.listRelations()
    assert.equal(relations.length, 1)
    assert.equal(relations[0]?.kind, 'supersedes')
    // 已取代条目不可恢复，也不可再直接更新。
    assert.throws(() => store.archive('old-fact', false))
    assert.throws(() => store.update('old-fact', { content: '试图复活旧事实' }))
    assert.equal(entryScope(store.get('old-fact')).kind, 'global')
  } finally { cleanup(dir) }
})

test('候选审核：审核中断后重试可恢复已落库结果，不重复创建', () => {
  const { store, governance, dir } = makeRig()
  try {
    const candidate = governance.propose({ content: '恢复路径验证条目内容', scope: { kind: 'global' }, source: 'session-reflection', sourceId: 's:10' })
    // 模拟「正文已写入但候选状态未更新」的历史故障现场。
    const orphan = store.create({ content: '恢复路径验证条目内容', scope: { kind: 'global' }, source: 'user-reviewed', sourceId: candidate.id, trust: 'confirmed' })
    const result = governance.review({ id: candidate.id, action: 'approve' })
    assert.equal(result.entry?.id, orphan.id, '必须恢复既有条目而不是再建一条')
    assert.equal(result.candidate.state, 'approved')
    assert.equal(store.list().length, 1)
  } finally { cleanup(dir) }
})

test('钉选红线：钉选条目不可取代、不可隔离、不可归档', () => {
  const { store, governance, dir } = makeRig()
  try {
    store.create({ content: '生产重启红线', pinned: true, scope: { kind: 'global' }, memoryKey: 'prod.restart' }, 'pin-1')
    const candidate = governance.propose({ content: '试图绕过红线的替代说法', scope: { kind: 'global' }, memoryKey: 'prod.restart', source: 'session-reflection', sourceId: 's:11' })
    assert.equal(candidate.state, 'needs-resolution')
    assert.throws(() => governance.review({ id: candidate.id, action: 'approve', supersedesIds: ['pin-1'] }))
    assert.throws(() => store.quarantine('pin-1'))
    assert.throws(() => store.archive('pin-1', true))
  } finally { cleanup(dir) }
})

test('软归档状态机：只有 archived 可恢复；superseded/quarantined 分列可见', () => {
  const { store, dir } = makeRig()
  try {
    const a = store.create({ content: '人工归档条目' }, 'arch-1')
    store.archive(a.id, true)
    assert.equal(store.get('arch-1')?.state, 'archived')
    store.archive(a.id, false)
    assert.equal(store.get('arch-1')?.state, 'active')
    const b = store.create({ content: '被隔离条目' }, 'q-1')
    store.quarantine(b.id)
    const c = store.create({ content: '被取代条目' }, 'sup-1')
    store.create({ content: '新版本条目内容', scope: { kind: 'global' } }, 'new-1')
    store.supersede([c.id], { content: '新版本条目内容', scope: { kind: 'global' } }, '演进')
    // 默认 archived 视图不含 superseded/quarantined。
    assert.equal(store.listArchived().some((entry) => entry.id === b.id), false)
    assert.equal(store.listArchived().some((entry) => entry.id === c.id), false)
    assert.equal(store.listArchived({ states: ['quarantined'] }).some((entry) => entry.id === b.id), true)
    assert.equal(store.listArchived({ states: ['superseded'] }).some((entry) => entry.id === c.id), true)
    // 全量状态视图：archived+quarantined+superseded 至少 2 条（arch-1 已恢复为 active 不在内）。
    assert.ok(store.listArchived({ states: ['archived', 'quarantined', 'superseded'] }).length >= 2)
  } finally { cleanup(dir) }
})

test('持久待处理窗口：落盘、按会话读取与清理', () => {
  const { governance, dir } = makeRig()
  try {
    governance.savePendingWindow('sess-a', { turn: 1, userText: 'u', assistantText: 'a', completed: true, endReason: 'completed', scope: { kind: 'global' }, evidence: [], toolNames: [], toolSuccesses: 0, toolFailures: 0 })
    governance.savePendingWindow('sess-b', { turn: 2, userText: '', assistantText: 'b', completed: false, endReason: 'aborted', scope: { kind: 'global' }, evidence: [], toolNames: [], toolSuccesses: 0, toolFailures: 0 })
    assert.equal(governance.listPendingWindows('sess-a').length, 1)
    assert.equal(governance.listPendingWindows().length, 2)
    governance.deletePendingWindows(governance.listPendingWindows('sess-a').map((row) => row.id))
    assert.equal(governance.listPendingWindows('sess-a').length, 0)
    assert.equal(governance.listPendingWindows('sess-b').length, 1)
  } finally { cleanup(dir) }
})

/** 可控向量注册表：同文本同向量，正交文本余弦 0，语义通道完全确定。 */
function registryEmbedder(pairs: Array<[string, number[]]>): RagEmbedder {
  const table = new Map(pairs.map(([text, vector]) => [text, new Float32Array(vector)]))
  const fallback = (): Float32Array => new Float32Array([0, 0, 1])
  return {
    embed: async (texts: string[]) => texts.map((text) => table.get(text) ?? fallback()),
    embedQuery: async (text: string) => table.get(text) ?? fallback(),
  }
}

function fakeRagService(embedder: RagEmbedder | 'fail'): RagService {
  const base = {
    getSettings: () => DEFAULT_RAG_SETTINGS,
    pickEmbedder: () => embedder === 'fail'
      ? { embed: async () => { throw new Error('嵌入服务不可用') }, embedQuery: async () => { throw new Error('嵌入服务不可用') } } as unknown as RagEmbedder
      : embedder,
    listKbs: () => [],
    search: async () => [],
  }
  return base as unknown as RagService
}

test('混合召回：embedding 失败只降级语义层，词法命中照常返回', async () => {
  const { store, ragStore, dir } = makeRig()
  try {
    store.create({ content: '暂存实例必须使用 3081 端口', scope: { kind: 'global' } }, 'f1')
    const recall = new MemoryRecallService(store, fakeRagService('fail'), ragStore)
    const result = await recall.recall({ query: '暂存实例端口', scope: { kind: 'global' }, isolateScope: true, semantic: true, semanticWeight: 0.35, threshold: 0.35, limit: 4 })
    assert.equal(result.hits[0]?.entry.id, 'f1')
    assert.ok(result.degradedLayers.some((layer) => layer.startsWith('semantic:')))
  } finally { cleanup(dir) }
})

test('混合召回：语义通道可为无词法重叠的条目补召回，且阈值生效', async () => {
  const { store, ragStore, dir } = makeRig()
  try {
    const semContent = '一二三四五六七八'
    const noiseContent = '完全不相关长度也不同'
    store.create({ content: semContent, scope: { kind: 'global' } }, 'sem-1')
    store.create({ content: noiseContent, scope: { kind: 'global' } }, 'noise-1')
    const query = '甲乙丙丁戊己庚辛'
    const recall = new MemoryRecallService(store, fakeRagService(registryEmbedder([[query, [1, 0, 0]], [semContent, [1, 0, 0]], [noiseContent, [0, 1, 0]]])), ragStore)
    const result = await recall.recall({ query, scope: { kind: 'global' }, isolateScope: true, semantic: true, semanticWeight: 0.35, threshold: 0.35, limit: 4 })
    assert.equal(result.hits[0]?.entry.id, 'sem-1', '语义冠军必须补召回')
    assert.equal(result.degradedLayers.length, 0)
    // threshold=1 时融合分远低于阈值 → 长尾不放行。
    const strict = await recall.recall({ query, scope: { kind: 'global' }, isolateScope: true, semantic: true, semanticWeight: 0.35, threshold: 1, limit: 4 })
    assert.equal(strict.hits.length, 0)
  } finally { cleanup(dir) }
})

test('召回轨迹与反馈：useful 只计数不改信任；incorrect 隔离；幂等', async () => {
  const { store, governance, dir } = makeRig()
  try {
    store.create({ content: '发布包必须核对 SHA256', scope: { kind: 'global' } }, 'fb-1')
    const injection = new MemoryInjectionService(fakeRagService('fail'), () => ({ ...SETTINGS, semanticRecall: false }), store, undefined, { governance, scopeOfAgent: () => ({ kind: 'global' }) })
    const decision = await injection.decideDetailed([{ role: 'user', content: [{ type: 'text', text: '发布包要核对什么' }] }], { scope: { kind: 'global' }, sessionId: 's-fb', turn: 1 })
    assert.ok(decision.text !== undefined)
    assert.ok(decision.traceId !== undefined)
    const recalls = governance.listRecalls(10)
    assert.equal(recalls.length, 1)
    assert.equal(recalls[0]?.outcome, 'hit')
    assert.equal(store.get('fb-1')?.accessCount, 1, '真实装入上下文才计曝光')
    // useful：计数 + 幂等（同 recall+entry 只允许一次评价）。
    governance.submitFeedback({ recallId: recalls[0]!.id, entryId: 'fb-1', verdict: 'useful' })
    const repeated = governance.submitFeedback({ recallId: recalls[0]!.id, entryId: 'fb-1', verdict: 'incorrect', note: '试图改口' })
    assert.equal(repeated.verdict, 'useful', '重复提交返回首次评价结果')
    assert.equal(store.get('fb-1')?.helpfulCount, 1)
    assert.equal(store.get('fb-1')?.trust, 'legacy', '正反馈绝不自动升级信任')
    // 第二次真实注入产生新 trace：incorrect 反馈隔离非钉选条目。
    const decision2 = await injection.decideDetailed([{ role: 'user', content: [{ type: 'text', text: '发布包要核对什么' }] }], { scope: { kind: 'global' }, sessionId: 's-fb', turn: 2 })
    const recalls2 = governance.listRecalls(10)
    assert.equal(recalls2.length, 2)
    assert.ok(decision2.traceId !== undefined && decision2.traceId !== decision.traceId, '每次注入独立 trace')
    governance.submitFeedback({ recallId: recalls2[0]!.id, entryId: 'fb-1', verdict: 'incorrect' })
    assert.equal(store.get('fb-1')?.state, 'quarantined')
    assert.equal(store.get('fb-1')?.harmfulCount, 1)
    // 伪造 recallId / 未注入条目 → 拒绝。
    assert.throws(() => governance.submitFeedback({ recallId: 'fake', entryId: 'fb-1', verdict: 'useful' }))
  } finally { cleanup(dir) }
})

test('质量统计：状态/信任/候选/作用域分列且与真实数据一致', () => {
  const { store, governance, dir } = makeRig()
  try {
    store.create({ content: '全局事实甲', scope: { kind: 'global' } }, 'q1')
    store.create({ content: '项目事实乙', scope: { kind: 'project', id: 'p1' } }, 'q2')
    governance.propose({ content: '待审核候选丙', scope: { kind: 'global' }, source: 'test', sourceId: 'q:3' })
    const quality = governance.quality()
    assert.equal(quality.active, 2)
    assert.equal(quality.candidates, 1)
    assert.equal(quality.scoped, 1)
    assert.equal(quality.legacy, 2)
  } finally { cleanup(dir) }
})
