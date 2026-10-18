/**
 * 记忆写入端治理测试（0.53.0）。
 *
 * 背景（2026-10-18 生产实测，全量逐条审阅 4871 条活跃记忆后定位）：
 * 记忆库膨胀的真凶不是记忆条数，而是三处「只写不清」的写入端缺陷——
 *   ① memory.candidate 6065 条 / 17.40 MB：候选被采纳后整份副本永久留存，从无裁剪路径；
 *   ② memory.meta.evidence 占 13.04 MB：每条证据存工具输出原文 500 字，长引文 13584 个实例
 *      去重后只有 2591 种唯一文本，单段最多重复 121 次；
 *   ③ 内容侧约四分之一是任务过程播报（「P2 已并入…（L133-134）」「679/679 测试通过」）。
 * 这些用例锁住对应的四条修复，防止回退。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RagStore } from '../src/rag/rag-store.ts'
import { NativeMemoryStore } from '../src/memory/native.ts'
import { MemoryGovernanceService } from '../src/memory/governance.ts'
import { dedupeEvidence, isLowValueMemory } from '../src/memory/sediment.ts'
import type { MemoryEvidence } from '../src/memory/protocol.ts'

function makeRig(): { rag: RagStore; store: NativeMemoryStore; governance: MemoryGovernanceService } {
  const rag = new RagStore(join(mkdtempSync(join(tmpdir(), 'dsh-writepath-')), 'store.db'))
  const store = new NativeMemoryStore(rag)
  const governance = new MemoryGovernanceService(rag, store)
  return { rag, store, governance }
}

/** 造一条已解决的候选（直接落域，绕过 propose 的节流裁剪，便于精确控制状态与时间）。 */
function seedCandidate(rag: RagStore, id: string, state: string, content: string, resolvedAt: number): void {
  rag.putDomainDoc('memory.candidate', id, {
    id,
    content,
    category: 'fact',
    tags: ['t'],
    importance: 3,
    confidence: 0.8,
    reason: '这是一段应当被丢弃的长理由'.repeat(20),
    scope: { kind: 'global' },
    evidence: [{ kind: 'tool', quote: '证据原文'.repeat(80), createdAt: resolvedAt }],
    duplicateIds: [],
    conflictIds: [],
    source: 'session',
    state,
    createdAt: resolvedAt,
    resolvedAt,
    resultEntryId: 'entry-' + id,
  })
}

test('候选墓碑化：超过保留期的终态候选压缩成墓碑，正文与证据被丢弃', () => {
  const { rag, governance } = makeRig()
  const old = Date.now() - 30 * 86_400_000
  seedCandidate(rag, 'c-old-auto', 'auto-activated', '很久以前被自动采纳的候选正文'.repeat(30), old)

  const before = rag.listDomainDocs('memory.candidate').find((row) => row.id === 'c-old-auto')!.data as Record<string, unknown>
  assert.equal(typeof before.content, 'string', '前置：裁剪前应保存整份正文')

  const pruned = governance.pruneResolvedCandidates(3)
  assert.equal(pruned, 1)

  const after = rag.listDomainDocs('memory.candidate').find((row) => row.id === 'c-old-auto')!.data as Record<string, unknown>
  assert.equal(after.content, undefined, '墓碑不应保留正文')
  assert.equal(after.evidence, undefined, '墓碑不应保留证据')
  assert.equal(after.reason, undefined, '墓碑不应保留理由')
  assert.equal(after.tombstoned, true)
  // 对账字段必须保住：知道这条候选后来对应哪条记忆。
  assert.equal(after.state, 'auto-activated')
  assert.equal(after.resultEntryId, 'entry-c-old-auto')
  assert.equal(after.resolvedAt, old)
})

test('候选墓碑化：保留期内的候选不动（追溯期）', () => {
  const { rag, governance } = makeRig()
  seedCandidate(rag, 'c-fresh', 'auto-activated', '刚刚才被采纳的候选', Date.now() - 3600_000)
  assert.equal(governance.pruneResolvedCandidates(3), 0)
  const row = rag.listDomainDocs('memory.candidate').find((item) => item.id === 'c-fresh')!.data as Record<string, unknown>
  assert.equal(typeof row.content, 'string', '追溯期内的候选必须保留全文')
})

test('候选墓碑化：pending 与 needs-resolution 绝不压缩（那是等用户裁决的活数据）', () => {
  const { rag, governance } = makeRig()
  const old = Date.now() - 90 * 86_400_000
  seedCandidate(rag, 'c-pending', 'pending', '待审核候选正文', old)
  seedCandidate(rag, 'c-needs', 'needs-resolution', '冲突待裁决候选正文', old)

  assert.equal(governance.pruneResolvedCandidates(3), 0)
  for (const id of ['c-pending', 'c-needs']) {
    const row = rag.listDomainDocs('memory.candidate').find((item) => item.id === id)!.data as Record<string, unknown>
    assert.equal(typeof row.content, 'string', id + ' 不应被墓碑化')
  }
})

test('候选墓碑化：重复执行幂等，不会反复改写', () => {
  const { rag, governance } = makeRig()
  const old = Date.now() - 30 * 86_400_000
  seedCandidate(rag, 'c-once', 'approved', '已审核通过的候选', old)
  assert.equal(governance.pruneResolvedCandidates(3), 1)
  assert.equal(governance.pruneResolvedCandidates(3), 0, '第二次不应再有可裁剪行')
})

test('候选墓碑化：墓碑不再出现在候选列表里（parseCandidate 需要正文）', () => {
  const { rag, governance } = makeRig()
  const old = Date.now() - 30 * 86_400_000
  seedCandidate(rag, 'c-gone', 'deduped', '与现有记忆重复的候选', old)
  governance.pruneResolvedCandidates(3)
  assert.equal(governance.listCandidates({ limit: 1000 }).some((item) => item.id === 'c-gone'), false)
})

test('quality()：候选超过 1000 条时待审计数不再被封顶失真', () => {
  const { rag, governance } = makeRig()
  const now = Date.now()
  // 1200 条待审候选：旧实现用 listCandidates({limit:1000}) 计数，会永远报 1000。
  for (let i = 0; i < 1200; i += 1) seedCandidate(rag, 'q-' + i, 'pending', '待审核候选 ' + i, now)
  const quality = governance.quality()
  assert.equal(quality.candidates, 1200, '待审候选必须真实计数，不能停在 limit 上')
})

test('evidence 去重：同一段引文只保留一份（按 digest）', () => {
  const items: MemoryEvidence[] = [
    { kind: 'tool', quote: '同一段工具输出', digest: 'aaa', createdAt: 1 },
    { kind: 'tool', quote: '同一段工具输出（重复读出）', digest: 'aaa', createdAt: 2 },
    { kind: 'user', quote: '用户原话', digest: 'bbb', createdAt: 3 },
    { kind: 'user', quote: '用户原话（没有 digest 时按文本去重）', createdAt: 4 },
  ]
  const out = dedupeEvidence(items)
  assert.equal(out.length, 3, 'digest 相同的第二条 + 文本相同的重复项应被丢弃')
  assert.equal(out[0]!.digest, 'aaa')
  assert.equal(out[1]!.digest, 'bbb')
})

test('evidence 去重：没有 digest 时按引文文本去重', () => {
  const items: MemoryEvidence[] = [
    { kind: 'tool', quote: '完全一样的输出', createdAt: 1 },
    { kind: 'tool', quote: '完全一样的输出', createdAt: 2 },
  ]
  assert.equal(dedupeEvidence(items).length, 1)
})

test('写入路径：证据引文超过 200 字被截断，不再整段保存工具输出', () => {
  const { store } = makeRig()
  const long = 'X'.repeat(500)
  const entry = store.create({
    content: '测试证据截断',
    category: 'fact',
    source: 'test',
    scope: { kind: 'global' },
    evidence: [{ kind: 'tool', quote: long, createdAt: Date.now() }],
  })
  assert.equal(entry.evidence[0]!.quote.length, 200, '引文应被截到 200 字')
})

test('低价值过滤：任务过程播报与一次性验收数字被拦下', () => {
  const junk = [
    'P2 hero 四件套已并入 renderInstallCmds 数组（L133-134）',
    'P1 showFormErr 已从字符串改为数组版，使用 <ul> 逐条渲染（L271-278）',
    'dsh-devforge 0.50.2 测试全部通过：679/679 通过',
    '本轮改动尚未推送，待验收',
  ]
  for (const text of junk) assert.equal(isLowValueMemory(text), true, '应被拦截：' + text)
})

test('低价值过滤：刻意做窄，宁可漏也不误伤（真实库回放校正后的精度取舍）', () => {
  // 初版宽模式（P 编号+完成动词 / 耗时+通过）在生产 3875 条上命中 22 条，12 条是误报：
  // 记录归档规则本身的记忆、以及「服务器已接入，winrm_test 耗时 808ms 通过」这类真实事实。
  // 收紧后只保留「任务编号+真实行号」与「N/N 测试比」两个强信号，其余交给提示词主防线。
  const passThrough = [
    // 描述规则本身——初版会被自己的规则命中
    '记忆审阅采用固定判定规则：任务播报（含 P0–P4 编号、已完成/已上线宣告、具体行号）应归档。',
    // 真实事实 + 附带一次性耗时
    'junhui-model（192.168.10.198）已纳入 DSH 服务器管理体系，winrm_test 耗时 808ms 通过，可执行 PowerShell',
    // 单次耗时播报：精度太低，宁可放行
    '构建耗时 38.8 秒稳定完成',
  ]
  for (const text of passThrough) assert.equal(isLowValueMemory(text), false, '应放行：' + text)
})

test('低价值过滤：真正有价值的规则、机制、教训不被误伤', () => {
  const keep = [
    '辉哥要求所有文档一律使用中文描述',
    '插件改动交付必须走暂存实例人工验收，通过后才允许重启生产',
    'evidence 字段膨胀的根因是每条都存 500 字工具输出原文',
    '钉选条目不能被自动沉淀覆盖，必须由工作台人工处理',
    'memory.candidate 的 limit 被硬封顶在 1000，导致待审计数失真',
    '发布流程为：推送 CNB → 部署 → 重启服务 → 健康检查',
  ]
  for (const text of keep) assert.equal(isLowValueMemory(text), false, '不应被拦截：' + text)
})

test('低价值过滤：长文档与多行内容不做过程播报判定（真实库回放发现的误报边界）', () => {
  // 生产回放实证：初版规则命中 22 条，其中 12 条是「记录归档规则本身」的记忆被自己的规则命中。
  // 分界是真垃圾为单行短句、误报为多行结构化文档，故长文档与多行一律放行。
  const ruleDoc = '记忆审阅采用固定判定规则：任务播报（含 P0–P4 编号、已完成/已上线宣告、具体行号）、过期版本与旧端口应归档。'
  assert.equal(isLowValueMemory(ruleDoc), false, '描述规则的单一长句不应被拦截')

  const multiLine = [
    '# 项目维护要点（2026-09-10）',
    '',
    '## 环境',
    '- P1 部署已完成（L120-130）',
    '- 679/679 测试通过',
  ].join('\n')
  assert.equal(isLowValueMemory(multiLine), false, '多行文档即使含播报片段也不应整条拦截')
})

test('自动激活：落盘候选不再带 evidence（证据已在 entry 里，候选副本是冗余）', () => {
  // 实测生产候选 77.9% 的体积来自 evidence（单条 3577 B，正文仅 219 B）。
  // 激活时证据已随 entryInput 写进 memory.entry，故持久化副本瘦身，内存返回值仍保留完整证据。
  const { rag, governance } = makeRig()
  const quote = 'Y'.repeat(180)
  const result = governance.activateAuto({
    content: '候选里的证据不应在激活后重复保存一份',
    category: 'fact',
    scope: { kind: 'global' },
    source: 'session-reflection',
    evidence: [{ kind: 'tool', quote, digest: 'deadbeef', createdAt: Date.now() }],
  })

  assert.notEqual(result.entry, undefined)
  // 内存返回对象保留证据，调用方语义不变。
  assert.equal(result.candidate.evidence.length, 1)
  // entry 拿到证据。
  assert.equal(result.entry!.evidence.length, 1)
  // 落盘候选副本不带证据。
  const stored = rag.listDomainDocs('memory.candidate').find((row) => row.id === result.candidate.id)!.data as Record<string, unknown>
  assert.deepEqual(stored.evidence, [], '候选落盘副本不应再存证据')
  assert.equal(stored.state, 'auto-activated')
  assert.equal(typeof stored.content, 'string', '正文仍保留，便于面板查看刚采纳的候选')
})

test('更新自身不算重复：excludeEntryIds 排除被更新的条目', () => {  const { store, governance } = makeRig()
  const entry = store.create({
    content: '记忆库空间膨胀的主因是 candidate 副本永久保留',
    category: 'insight',
    source: 'test',
    scope: { kind: 'global' },
  })
  // 不带排除：内容与自身高度重合，会被判成 deduped（旧行为）。
  const naive = governance.propose({
    content: '记忆库空间膨胀的主因是 candidate 副本永久保留',
    category: 'insight',
    scope: { kind: 'global' },
    source: 'agent-update-proposal',
  })
  assert.equal(naive.state, 'deduped', '前置：不排除自身时会判重复')

  // 带排除：跳过自身后应正常成为待审候选。
  const governed = governance.propose({
    content: '记忆库空间膨胀的主因是 candidate 副本永久保留',
    category: 'insight',
    scope: { kind: 'global' },
    source: 'agent-update-proposal',
    excludeEntryIds: [entry.id],
  })
  assert.notEqual(governed.state, 'deduped', '排除自身后不应再判重复')
  assert.deepEqual(governed.duplicateIds, [])
})
