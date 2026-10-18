/**
 * 记忆管家测试（0.51.0）。
 *
 * 背景（2026-10-18 生产实测）：每天新增 100~340 条记忆，而做梦每天只归档 30~60 条，
 * 净增 40~240 条/天；5194 条活跃里 3282 条（63%）accessCount=0，写完从未被召回。
 * 核心记忆域 memory.entry/meta 此前没有任何容量上限——辅域（audit/episode/recall）都有限制，
 * 唯独真正占库的记忆本体无限涨。管家就是补上这个缺口：按使用价值淘汰、同类合并、库容止损。
 *
 * 这些用例锁住三条硬边界：钉选永不动、只软归档（可恢复）、每次限量。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RagStore } from '../src/rag/rag-store.ts'
import { NativeMemoryStore } from '../src/memory/native.ts'
import { MemoryCuratorService } from '../src/memory/curator.ts'
import { DEFAULT_MEMORY_SETTINGS } from '../src/memory/routes.ts'
import type { MemorySettings } from '../src/memory/protocol.ts'

function makeRig(overrides?: Partial<MemorySettings>): { store: NativeMemoryStore; curator: MemoryCuratorService; settings: MemorySettings; audits: string[] } {
  const ragStore = new RagStore(join(mkdtempSync(join(tmpdir(), 'dsh-curator-')), 'store.db'))
  const store = new NativeMemoryStore(ragStore)
  const settings: MemorySettings = { ...DEFAULT_MEMORY_SETTINGS, ...overrides }
  const audits: string[] = []
  const curator = new MemoryCuratorService({
    native: store,
    config: () => settings,
    audit: (action, ids) => audits.push(action + ':' + ids.join(',')),
  })
  return { store, curator, settings, audits }
}

function seed(store: NativeMemoryStore, id: string, content: string, extra?: { category?: 'fact' | 'context' | 'preference'; importance?: number; pinned?: boolean }): string {
  store.create({ content, category: extra?.category ?? 'fact', source: 'test', importance: extra?.importance ?? 3, scope: { kind: 'global' }, ...(extra?.pinned === true ? { pinned: true } : {}) }, id)
  return id
}

test('curator：零访问 + 老 + 低重要 = 淘汰候选；有访问/钉选/高重要受保护', () => {
  // 阈值 60：新建普通条目算下来约 45 分（重要度 30 + 近期 +15），会被判为"低于阈值"淘汰候选；
  // 受保护的条目无论分数都不进候选。
  const { store, curator } = makeRig({ curatorEvictThreshold: 60 })
  seed(store, 'cold-1', '这是一条从来没被召回过、重要性也低的老记忆')
  seed(store, 'cold-2', '另一条同样零访问的普通事实，理应被淘汰')
  seed(store, 'hot-1', '被频繁召回过的关键事实，必须留下')
  seed(store, 'pin-1', '钉选条目，无论分数多低都不许动', { pinned: true })
  seed(store, 'imp-1', '最高重要度的条目必须保护', { importance: 5 })

  // 把 hot-1 伪装成"被召回 8 次且最近用过"
  store.markAccessed(['hot-1', 'hot-1', 'hot-1', 'hot-1', 'hot-1', 'hot-1', 'hot-1', 'hot-1'])

  const plan = curator.plan()
  const evictIds = plan.evict.map((item) => item.id)
  assert.ok(evictIds.includes('cold-1'), '零访问老条目应进淘汰候选')
  assert.ok(evictIds.includes('cold-2'), '零访问老条目应进淘汰候选')

  const byId = new Map(plan.evict.map((item) => [item.id, item]))
  assert.equal(byId.has('pin-1'), false, '钉选条目绝不能出现在淘汰候选里')
  assert.equal(byId.has('imp-1'), false, '最高重要度条目绝不能出现在淘汰候选里')
  assert.equal(byId.has('hot-1'), false, '被召回过的条目受保护期保护')

  // 每条候选都必须给出人类可读原因（自动化动记忆库，不可解释=不可信）
  for (const item of plan.evict) assert.ok(item.reasons.length > 0, '淘汰候选必须带原因：' + item.id)
})

test('curator：执行是软归档，可一键恢复（绝不物理删除）', () => {
  const { store, curator } = makeRig({ curatorMaxEntries: 0, curatorEvictThreshold: 60 })
  seed(store, 'victim-1', '这条会被管家淘汰，但必须可恢复而不是被删掉')
  const before = store.listAll().length

  const result = curator.execute({ dryRun: false })
  assert.ok(result.summary.evicted >= 1, '应至少淘汰一条')
  assert.equal(store.listAll().length, before, '软归档不减少库内条目总数')

  const entry = store.get('victim-1')
  assert.ok(entry !== undefined, '条目必须还在')
  assert.equal(entry!.state, 'archived', '应处于归档状态')

  // 救援路径
  const restored = curator.restore(['victim-1'])
  assert.equal(restored, 1)
  assert.equal(store.get('victim-1')!.state, 'active', '恢复后必须回到活跃')
})

test('curator：dryRun 缺省不落库（安全默认）', () => {
  const { store, curator } = makeRig({ curatorMaxEntries: 0, curatorEvictThreshold: 60 })
  seed(store, 'safe-1', '预演模式下这条不该被改动')
  const result = curator.execute({})
  assert.equal(result.summary.evicted, 0, '预演不得淘汰任何条目')
  assert.equal(store.get('safe-1')!.state, 'active')
  assert.equal(result.plan.total, 1, '预演仍要给出计划')
})

test('curator：库容超限才自动止损，且只淘汰超出部分', () => {
  const { store, curator } = makeRig({ curatorMaxEntries: 3, curatorEvictThreshold: 0 })
  for (let i = 0; i < 6; i += 1) seed(store, 'cap-' + i, '库容测试条目 ' + i + '，内容足够长以便判定')

  const plan = curator.plan()
  assert.equal(plan.liveCount, 6)
  assert.equal(plan.overCapacity, 3, '超出 3 条')

  const result = curator.execute({ dryRun: false, capacityOnly: true })
  assert.equal(result.summary.evicted, 3, '只淘汰超出的 3 条')
  assert.equal(store.listAll().filter((entry) => entry.state === 'active').length, 3)
})

test('curator：同分类高相似才会合并，跨分类绝不合并', () => {
  const { store, curator } = makeRig({ curatorMaxEntries: 0, curatorEvictThreshold: 0 })
  // 同分类：两句几乎一样，应合并
  seed(store, 'dup-a', '产出文件应通过飞书发送工具直接发给用户，不依赖网页界面展示')
  seed(store, 'dup-b', '产出文件应通过飞书发送工具直接发给用户，不要依赖网页界面展示')
  // 跨分类：内容相同但分类不同，不许合并（合并会改变语义归属）
  seed(store, 'cross-a', '这条内容完全一致用于验证跨分类合并禁令', { category: 'fact' })
  seed(store, 'cross-b', '这条内容完全一致用于验证跨分类合并禁令', { category: 'decision' })

  const plan = curator.plan()
  const allLosers = plan.merge.flatMap((group) => group.loserIds)
  assert.ok(allLosers.includes('dup-b') || allLosers.includes('dup-a'), '同分类近似条目应进合并候选')
  assert.equal(allLosers.includes('cross-a') && allLosers.includes('cross-b'), false, '跨分类条目不得互相合并')

  const before = store.listAll().filter((entry) => entry.state === 'active').length
  const result = curator.execute({ dryRun: false })
  assert.ok(result.summary.mergedGroups >= 1, '应执行至少一组合并')
  const merged = store.listAll().filter((entry) => entry.state === 'superseded')
  assert.ok(merged.length >= 1, '被合并的条目应转为 superseded 而不是消失')
  // 回归点：初版按 loser 逐条 supersede，每条都会新建一个 keeper 副本，导致活跃数一条都不减
  // （生产实测活跃数只减了归档量、合并量为 0）。合并必须真正收敛条数。
  const after = store.listAll().filter((entry) => entry.state === 'active').length
  const groupsTotal = plan.merge.reduce((sum, group) => sum + group.loserIds.length, 0)
  assert.equal(after, before - groupsTotal, '合并后活跃条数必须按被合并数下降')
})

test('curator：钉选条目不参与合并（supersede 遇钉选会抛错）', () => {
  const { store, curator } = makeRig({ curatorMaxEntries: 0, curatorEvictThreshold: 0 })
  seed(store, 'pin-a', '钉选的这条记忆内容与其他条目高度相似用于验证合并禁令', { pinned: true })
  seed(store, 'pin-b', '钉选的这条记忆内容与其他条目高度相似用于验证合并禁令')
  const plan = curator.plan()
  const inMerge = plan.merge.some((group) => group.keeperId === 'pin-a' || group.loserIds.includes('pin-a'))
  assert.equal(inMerge, false, '钉选条目不得出现在合并组')
  const result = curator.execute({ dryRun: false })
  assert.equal(result.summary.errors.length, 0, '不得因钉选抛错')
})

test('curator：合并会把同类补充事实拼进新条目，不丢信息', () => {
  const { store, curator } = makeRig({ curatorMaxEntries: 0, curatorEvictThreshold: 0 })
  seed(store, 'k-1', '发票识别链路：预处理 3.5s、GPT 定位 7s、三区域 PaddleOCR 并发 21-31s')
  seed(store, 'k-2', '发票识别链路：预处理 3.5s、GPT 定位 7s、三区域 PaddleOCR 并发 21-31s，整票兜底 OCR 后 GPT 修复')

  const plan = curator.plan()
  assert.ok(plan.merge.length >= 1, '应识别出同类组')
  curator.execute({ dryRun: false })

  // 合并走 supersede：新旧条目都转 superseded，产出唯一一条承载合并内容的新条目。
  const live = store.listAll().filter((entry) => entry.state === 'active')
  assert.equal(live.length, 1, '两条合成一条')
  assert.ok(String(live[0].content).includes('兜底 OCR'), '合并后的条目必须保住原有补充事实')
  assert.ok(String(live[0].content).includes('预处理'), '保留者的主体内容不能丢')
})

test('curator：单次淘汰受 curatorMaxEvict 限制（防一次失手清空）', () => {
  const { store, curator } = makeRig({ curatorMaxEntries: 0, curatorMaxEvict: 2, curatorEvictThreshold: 60 })
  // 内容刻意各不相同，避免被合并逻辑先行收编（这个用例测的是淘汰限量，不是合并）
  const topics = ['构建命令是 pnpm build', '部署端口固定 3081', '日志目录在 logs 下', '数据库使用 SQLite', '备份走 CNB 仓库', '网关地址为 modagentai', '前端源码在 src client', '测试用 node test', '主题色走设计 token', '记忆库位于 devforge 目录']
  topics.forEach((text, i) => seed(store, 'limit-' + i, text + '，限量用例第 ' + i + ' 条'))
  const result = curator.execute({ dryRun: false })
  assert.equal(result.summary.evicted, 2, '单次最多淘汰 curatorMaxEvict 条')
})

test('curator：库容未超限且分数达标时什么都不做', () => {
  const { store, curator } = makeRig({ curatorMaxEntries: 100, curatorEvictThreshold: 0 })
  seed(store, 'fine-1', '一切正常的记忆条目，不该被任何自动流程动到')
  const result = curator.execute({ dryRun: false, capacityOnly: true })
  assert.equal(result.summary.evicted, 0)
  assert.equal(result.summary.capacityOk, true)
  assert.equal(store.get('fine-1')!.state, 'active')
})

test('curator：带记忆键的事实槽位必须硬保护（身份卡/称呼类不经过召回，靠分数会误杀）', () => {
  const { store, curator } = makeRig({ curatorEvictThreshold: 100 })
  // 生产实证：这条 24 分，差点被淘汰；它的 accessCount 恒为 0，因为身份卡由注入链路直供、不走召回。
  store.create({ content: '用户称呼为「辉哥」', category: 'preference', source: 'test', importance: 2, scope: { kind: 'global' }, memoryKey: 'user.address-name' }, 'slot-1')
  const plan = curator.plan()
  assert.equal(plan.evict.some((item) => item.id === 'slot-1'), false, '带 memoryKey 的槽位绝不能进淘汰候选')
  const scored = plan.evict.length === 0 ? undefined : plan.evict[0]
  assert.equal(scored, undefined, '阈值拉满时也不该有槽位候选')
})

test('curator：用户身份自述即使没有记忆键也受保护', () => {
  const { store, curator } = makeRig({ curatorEvictThreshold: 100 })
  // 生产实证：这两条 accessCount=0（身份设定走注入不走召回），分数 16/25，会被稳定误杀。
  seed(store, 'id-1', '用户被称为辉哥，在方案 A 与方案 B 之间拥有决策权', { category: 'context', importance: 2 })
  seed(store, 'id-2', '用户称呼辉哥，交流氛围偏口语化的团队协作风格', { category: 'context', importance: 2 })
  const plan = curator.plan()
  const ids = plan.evict.map((item) => item.id)
  assert.equal(ids.includes('id-1'), false, '身份自述不得被淘汰')
  assert.equal(ids.includes('id-2'), false, '身份自述不得被淘汰')
})

test('curator：淘汰与恢复都写审计（可追溯）', () => {
  const { store, curator, audits } = makeRig({ curatorMaxEntries: 0, curatorEvictThreshold: 60 })
  seed(store, 'audit-1', '这条会被淘汰，动作必须留下审计痕迹')
  curator.execute({ dryRun: false })
  assert.ok(audits.some((line) => line.startsWith('curator-evict')), '淘汰必须写审计')
  curator.restore(['audit-1'])
  assert.ok(audits.some((line) => line.startsWith('curator-restore')), '恢复必须写审计')
})

