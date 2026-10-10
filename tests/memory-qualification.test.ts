/**
 * 负记忆层与四态资格测试（0.43.0 P1-5 / P1-6，契约移植自灵枢 dsh-memory）：
 * - 负记忆层：被拒绝/被证伪的说法落 `memory.rejected`，召回命中时回吐警示；
 * - 四态资格：ACCEPT / DEFER / BLINDSPOT / REJECT，不确定就标待确认，被否定就标不得采用。
 * 全部使用临时库与 fake 模型，零网络。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RagStore } from '../src/rag/rag-store.ts'
import { closeAllDb } from '../src/store/db.ts'
import { NativeMemoryStore } from '../src/memory/native.ts'
import { MemoryGovernanceService } from '../src/memory/governance.ts'
import { MemoryRecallService } from '../src/memory/recall.ts'
import { MemoryInjectionService } from '../src/memory/inject.ts'
import { memoryManageTool } from '../src/memory/tools.ts'
import { DEFAULT_RAG_SETTINGS, type RagService } from '../src/rag/service.ts'
import type { MemorySettings } from '../src/memory/protocol.ts'

function makeRig(): { store: NativeMemoryStore; governance: MemoryGovernanceService; ragStore: RagStore; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-mem-qual-'))
  const ragStore = new RagStore(join(dir, 'store.db'), join(dir, 'rag-vec.db'))
  const store = new NativeMemoryStore(ragStore)
  return { store, governance: new MemoryGovernanceService(ragStore, store), ragStore, dir }
}

function cleanup(dir: string): void {
  closeAllDb()
  rmSync(dir, { recursive: true, force: true })
}

/** 只提供召回必需的桩：嵌入不可用 → 只走词法层，测试不依赖网络与向量。 */
function fakeRagService(): RagService {
  const base = {
    getSettings: () => DEFAULT_RAG_SETTINGS,
    pickEmbedder: () => ({ embed: async () => { throw new Error('嵌入服务不可用') }, embedQuery: async () => { throw new Error('嵌入服务不可用') } }),
    listKbs: () => [],
    search: async () => [],
  }
  return base as unknown as RagService
}

const SETTINGS: MemorySettings = { enabled: true, autoSediment: true, autoInject: true, autoReflect: true, autoAcceptExplicit: true, autoActivate: true, projectProfile: true, semanticRecall: false, scopeIsolation: true, feedbackTracking: true, semanticWeight: 0, topK: 4, threshold: 0.05, maxChars: 1200, dreamEnabled: false, dreamIdleMinutes: 10, dreamMinIntervalHours: 6, dreamProvider: '', dreamModel: '', dreamMaxTokens: 8192, dreamMaxEntries: 300, dreamMaxChars: 240, sedimentProvider: '', sedimentModel: '' }

test('P1-5 负记忆层：被拒的说法落 memory.rejected，且不再重复入库', async () => {
  const { governance, dir } = makeRig()
  try {
    const candidate = governance.propose({ content: '构建命令是 yarn build', scope: { kind: 'global' }, source: 'agent-proposal' })
    governance.review({ id: candidate.id, action: 'reject', reason: '本项目实际用 pnpm build' })
    const negatives = governance.negatives.list({ limit: 10 })
    assert.equal(negatives.length, 1, '被否定的说法必须落负记忆层')
    assert.equal(negatives[0]?.kind, 'rejected')
    assert.equal(negatives[0]?.content, '构建命令是 yarn build')
    assert.ok((negatives[0]?.reason ?? '').includes('pnpm'), '否定原因要带上，供召回回吐')
  } finally { cleanup(dir) }
})

test('P1-5 负覆盖：已被否定的说法再被召回时带回警示，负记忆本身不参与排序', async () => {
  const { store, governance, ragStore, dir } = makeRig()
  try {
    // 历史遗留：错误说法先被沉淀成记忆，后来才被否定。
    store.create({ content: '暂存实例固定使用 3081 端口', category: 'fact', source: 'session', scope: { kind: 'global' } }, 'e-1')
    governance.negatives.record({ id: 'neg-1', content: '暂存实例固定使用 3081 端口', reason: '实测该端口段已改，勿再采用', kind: 'falsified', scope: { kind: 'global' }, actor: 'user' })
    const recall = new MemoryRecallService(store, fakeRagService(), ragStore, governance.negatives)
    const result = await recall.recall({ query: '暂存实例端口', scope: { kind: 'global' }, isolateScope: true, semantic: false, semanticWeight: 0, threshold: 0.05, limit: 5 })
    const guarded = result.hits.find((hit) => hit.entry.id === 'e-1')
    assert.ok(guarded !== undefined, '正记忆照常召回：负层只做覆盖提示，不删记忆也不改排序')
    assert.equal(guarded.negative?.kind, 'falsified')
    assert.ok((guarded.negative?.reason ?? '').includes('勿再采用'))
  } finally { cleanup(dir) }
})

test('P1-6 四态资格：证据不足的命中标「待确认」，不冒充确定结论', async () => {
  const { store, governance, ragStore, dir } = makeRig()
  try {
    store.create({ content: '暂存实例固定使用 3081 端口', category: 'fact', source: 'session', scope: { kind: 'global' } }, 'q-1')
    const recall = new MemoryRecallService(store, fakeRagService(), ragStore, governance.negatives)
    const injection = new MemoryInjectionService(fakeRagService(), () => SETTINGS, store, undefined, { recall })
    const decision = await injection.decideDetailed([{ role: 'user', content: [{ type: 'text', text: '暂存实例用哪个端口' }] }], { scope: { kind: 'global' }, sessionId: 's-1', turn: 1 })
    assert.ok(decision.text !== undefined)
    assert.equal(decision.qualification, 'DEFER', 'legacy 级证据不足以直接采信')
    assert.ok(decision.text.includes('待确认'), '低把握命中必须在行内标注待确认')
  } finally { cleanup(dir) }
})

test('P1-6 四态资格：被否定的命中标 REJECT 并写明不得采用', async () => {
  const { store, governance, ragStore, dir } = makeRig()
  try {
    store.create({ content: '暂存实例固定使用 3081 端口', category: 'fact', source: 'session', scope: { kind: 'global' } }, 'q-2')
    governance.negatives.record({ id: 'neg-2', content: '暂存实例固定使用 3081 端口', reason: '该说法已被实测推翻', kind: 'falsified', scope: { kind: 'global' }, actor: 'user' })
    const recall = new MemoryRecallService(store, fakeRagService(), ragStore, governance.negatives)
    const raw = await recall.recall({ query: '暂存实例用哪个端口', scope: { kind: 'global' }, isolateScope: true, semantic: false, semanticWeight: 0, threshold: 0.05, limit: 5 })
    assert.ok(raw.hits.some((item) => item.negative !== undefined), '召回层要先带上负覆盖标记')
    const injection = new MemoryInjectionService(fakeRagService(), () => SETTINGS, store, undefined, { recall })
    const decision = await injection.decideDetailed([{ role: 'user', content: [{ type: 'text', text: '暂存实例用哪个端口' }] }], { scope: { kind: 'global' }, sessionId: 's-2', turn: 1 })
    assert.ok(decision.text !== undefined)
    assert.equal(decision.qualification, 'REJECT')
    assert.ok(decision.text.includes('已被否定'), '被否定的说法必须行内警示')
    assert.ok(decision.text.includes('该说法已被实测推翻'), '警示要带否定原因')
  } finally { cleanup(dir) }
})

test('P1-6 工具侧检索：search 结果带四态资格，被否定的条目标 REJECT', async () => {
  const { store, governance, dir } = makeRig()
  try {
    store.create({ content: '暂存实例固定使用 3081 端口', category: 'fact', source: 'session', scope: { kind: 'global' } }, 't-1')
    governance.negatives.record({ id: 'neg-3', content: '暂存实例固定使用 3081 端口', reason: '已被实测推翻', kind: 'falsified', scope: { kind: 'global' }, actor: 'user' })
    const tool = memoryManageTool(store, { governance, scopeOfAgent: () => ({ kind: 'global' }) })
    const out = await tool.execute({ action: 'search', query: '暂存实例端口' }, {}) as unknown as { entries: unknown[]; qualifications?: Array<{ id: string; qualification: string; reason: string }> }
    assert.ok(out.entries.length > 0, '检索要有结果')
    const graded = out.qualifications?.find((item) => item.id === 't-1')
    assert.ok(graded !== undefined, '显式检索必须带资格：调用方全靠它判断能不能采信')
    assert.equal(graded.qualification, 'REJECT')
    assert.ok(graded.reason.includes('已被实测推翻'))
  } finally { cleanup(dir) }
})
