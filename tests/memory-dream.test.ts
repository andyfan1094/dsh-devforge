/**
 * 记忆库做梦整理测试 —— 触发门槛、决策解析/应用红线与全流程审计。
 * 覆盖来自真实踩坑的红线：钉选不可触碰、单条非法只跳过不整批作废、解析失败不落库。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RagStore } from '../src/rag/rag-store.ts'
import { NativeMemoryStore } from '../src/memory/native.ts'
import { applyDreamDecisions, buildDreamSystemPrompt, buildDreamUserPrompt, dreamGate, MemoryDreamService, parseDreamDecisions } from '../src/memory/dream.ts'
import { DEFAULT_MEMORY_SETTINGS } from '../src/memory/routes.ts'
import type { MemorySettings } from '../src/memory/protocol.ts'

/** 每个用例独立临时库，互不污染。 */
function makeStore(): { store: NativeMemoryStore; ragStore: RagStore } {
  const ragStore = new RagStore(join(mkdtempSync(join(tmpdir(), 'dsh-memory-dream-')), 'rag.db'))
  return { store: new NativeMemoryStore(ragStore), ragStore }
}

/** 造一条记忆并返回 id。 */
function seed(store: NativeMemoryStore, content: string, extra?: { pinned?: boolean; category?: 'general' | 'preference' | 'decision' | 'fact' | 'insight' | 'context' }): string {
  return store.create({ content, category: extra?.category ?? 'general', source: 'test', importance: 3, ...(extra?.pinned === true ? { pinned: true } : {}) }).id
}

/** 覆盖做梦设置（默认关闭，测试按需打开）。 */
function settings(overrides: Partial<MemorySettings>): MemorySettings {
  return { ...DEFAULT_MEMORY_SETTINGS, ...overrides }
}

test('dreamGate 四重门槛：开关、库规模、指纹、静默与最小间隔', () => {
  // 用现实毫秒标尺：now ≈ 27.8h，最近一次写入在 30 分钟前（已过 10 分钟静默窗口）。
  const now = 100_000_000
  const min30 = 30 * 60_000
  const base = { enabled: true, dreamEnabled: true, count: 20, maxUpdatedAt: now - min30, lastFinishedAt: 0, lastFingerprint: '', now, idleMinutes: 10, minIntervalHours: 6 }
  assert.equal(dreamGate(base).allow, true)
  assert.equal(dreamGate({ ...base, dreamEnabled: false }).allow, false)
  assert.equal(dreamGate({ ...base, count: 5 }).allow, false)
  // 指纹未变：上次做梦后库没有任何变化。
  assert.equal(dreamGate({ ...base, lastFinishedAt: now - min30, lastFingerprint: '20:' + (now - min30) }).allow, false)
  // 静默窗口未到（写入后仅 5 分钟）。
  assert.equal(dreamGate({ ...base, maxUpdatedAt: now - 5 * 60_000 }).allow, false)
  // 最小间隔未到（上次做完仅 2 小时，静默窗口已过、指纹也变了）。
  assert.equal(dreamGate({ ...base, lastFinishedAt: now - 2 * 3_600_000, lastFingerprint: '19:999', maxUpdatedAt: now - min30, count: 19 }).allow, false)
})

test('parseDreamDecisions：容忍围栏与前后缀，无数组抛错', () => {
  const clean = parseDreamDecisions('[{"action":"archive","ids":["a"]}]')
  assert.equal(clean.length, 1)
  const fenced = parseDreamDecisions('整理结果如下：\n```json\n[{"action":"keep","ids":["b"]}]\n```\n以上。')
  assert.equal(fenced.length, 1)
  assert.throws(() => parseDreamDecisions('我觉得都挺好，不用整理。'), /no json array/)
})

test('buildDreamUserPrompt：携带 id 与钉选标记，超长内容截断', () => {
  const { store } = makeStore()
  const long = seed(store, '很长的内容'.repeat(100))
  const pinned = seed(store, '红线：未经确认不得重启生产', { pinned: true })
  const prompt = buildDreamUserPrompt(store.dreamSnapshot(100), 40)
  assert.ok(prompt.includes(long.slice(0, 8)) === false || prompt.includes('…'))
  assert.ok(prompt.includes('"pinned":true'))
  assert.ok(prompt.includes(pinned))
  assert.ok(buildDreamSystemPrompt().includes('钉') === false && buildDreamSystemPrompt().includes('keep'))
})

test('applyDreamDecisions：归档生效且检索不再命中，恢复后回归', () => {
  const { store } = makeStore()
  const a = seed(store, '过期的一次性任务进度：等待验收')
  const result = applyDreamDecisions(store, [{ action: 'archive', ids: [a] }])
  assert.equal(result.archived, 1)
  assert.equal(store.list().length, 0)
  assert.equal(store.listArchived().length, 1)
  assert.equal(store.search('等待验收').length, 0)
  store.archive(a, false)
  assert.equal(store.list().length, 1)
})

test('applyDreamDecisions：钉选条目任何决策都跳过', () => {
  const { store } = makeStore()
  const pinned = seed(store, '生产重启红线', { pinned: true })
  const normal = seed(store, '普通记忆')
  const result = applyDreamDecisions(store, [
    { action: 'archive', ids: [pinned] },
    { action: 'merge', ids: [pinned, normal], content: '试图合并钉选' },
    { action: 'update', ids: [pinned], content: '试图修订钉选' },
  ])
  assert.equal(result.archived + result.merged + result.updated, 0)
  assert.equal(result.skipped.length, 3)
  assert.equal(store.get(pinned)?.archived, undefined)
  assert.equal(store.get(normal)?.archived, undefined)
})

test('applyDreamDecisions：合并同主题重复，信息并入保留条', () => {
  const { store } = makeStore()
  const first = seed(store, '服务工厂支持 GLM-5.3 模型路由', { category: 'decision' })
  const second = seed(store, '服务工厂直连智谱 Coding Plan', { category: 'decision' })
  const third = seed(store, '服务工厂用量看板走火山方舟', { category: 'decision' })
  const result = applyDreamDecisions(store, [{ action: 'merge', ids: [first, second, third], keepId: first, content: '服务工厂：智谱直连 GLM-5.3，用量看板走火山方舟。', importance: 4 }])
  assert.equal(result.merged, 1)
  assert.equal(result.archived, 2)
  const keeper = store.get(first)
  assert.ok(keeper?.content.includes('用量看板'))
  assert.equal(keeper?.importance, 4)
  assert.equal(keeper?.tags.length, 0)
  assert.equal(store.list().length, 1)
})

test('applyDreamDecisions：跨分类合并与未知 id 一律跳过，合法子集照常应用', () => {
  const { store } = makeStore()
  const pref = seed(store, '用户偏好竖屏', { category: 'preference' })
  const fact = seed(store, '环境事实 Node 26', { category: 'fact' })
  const junk = seed(store, '一次性临时状态：稍后继续')
  const result = applyDreamDecisions(store, [
    { action: 'merge', ids: [pref, fact], content: '跨分类非法合并' },
    { action: 'archive', ids: ['不存在的id'] },
    { action: 'merge', ids: [junk], content: '只有一个 id' },
    { action: 'archive', ids: [junk] },
  ])
  assert.equal(result.archived, 1)
  assert.equal(result.skipped.length, 3)
  assert.equal(store.list().length, 2)
})

test('MemoryDreamService：全流程裁决-应用-审计-统计回调', async () => {
  const { store, ragStore } = makeStore()
  const dup1 = seed(store, '备份用 6 位密码加密 store.db')
  const dup2 = seed(store, '备份加密采用 6 位密码保护 store.db')
  for (let i = 0; i < 8; i++) seed(store, '独立记忆 ' + i + '：内容各不相同不重复')
  let statsCalls = 0
  const dream = new MemoryDreamService({
    native: store,
    generate: async (input) => {
      assert.equal(input.maxTokens, 8192)
      return '[{"action":"merge","ids":["' + dup1 + '","' + dup2 + '"],"content":"备份：store.db 用 6 位密码加密。","reason":"重复"},{"action":"archive","ids":["' + dup2 + '"],"reason":"已并入"}]'
    },
    config: () => settings({ dreamEnabled: true }),
    listDomain: (domain) => ragStore.listDomainDocs(domain),
    putDomain: (domain, id, data) => ragStore.putDomainDoc(domain, id, data),
    deleteDomain: (domain, id) => ragStore.deleteDomainDoc(domain, id),
  })
  dream.onRunFinished = () => { statsCalls += 1 }
  const run = await dream.run(true)
  assert.equal(run.status, 'degraded')
  assert.equal(run.merged, 1)
  assert.equal(run.skipped.length, 1)
  assert.equal(statsCalls, 1)
  assert.equal(store.list().length, 9)
  // 审计可读：手动触发标记与模型路由记录在案。
  const status = dream.status()
  assert.equal(status.runs.length, 1)
  assert.equal(status.runs[0].manual, true)
  assert.equal(status.runs[0].model, '会话默认模型')
})

test('MemoryDreamService：模型抛错与无数组输出都落 failed 且不改库', async () => {
  const { store, ragStore } = makeStore()
  for (let i = 0; i < 10; i++) seed(store, '记忆 ' + i)
  const failing = new MemoryDreamService({
    native: store,
    generate: async () => { throw new Error('模型限流') },
    config: () => settings({ dreamEnabled: true }),
    listDomain: (domain) => ragStore.listDomainDocs(domain),
    putDomain: (domain, id, data) => ragStore.putDomainDoc(domain, id, data),
    deleteDomain: (domain, id) => ragStore.deleteDomainDoc(domain, id),
  })
  const failed = await failing.run(true)
  assert.equal(failed.status, 'failed')
  assert.ok(failed.error?.includes('限流'))
  const garbage = new MemoryDreamService({
    native: store,
    generate: async () => '今天天气不错，无需整理。',
    config: () => settings({ dreamEnabled: true }),
    listDomain: (domain) => ragStore.listDomainDocs(domain),
    putDomain: (domain, id, data) => ragStore.putDomainDoc(domain, id, data),
    deleteDomain: (domain, id) => ragStore.deleteDomainDoc(domain, id),
  })
  const noArray = await garbage.run(true)
  assert.equal(noArray.status, 'failed')
  assert.ok(noArray.error?.includes('no json array'))
  assert.equal(store.list().length, 10)
})

test('MemoryDreamService：活跃不足与总开关关闭时手动触发被拒', async () => {
  const { store, ragStore } = makeStore()
  seed(store, '唯一一条')
  const dream = new MemoryDreamService({
    native: store,
    generate: async () => '[]',
    config: () => settings({ dreamEnabled: true }),
    listDomain: (domain) => ragStore.listDomainDocs(domain),
    putDomain: (domain, id, data) => ragStore.putDomainDoc(domain, id, data),
    deleteDomain: (domain, id) => ragStore.deleteDomainDoc(domain, id),
  })
  const skipped = await dream.run(true)
  assert.equal(skipped.status, 'skipped')
  const off = new MemoryDreamService({
    native: store,
    generate: async () => '[]',
    config: () => settings({ enabled: false }),
    listDomain: (domain) => ragStore.listDomainDocs(domain),
    putDomain: (domain, id, data) => ragStore.putDomainDoc(domain, id, data),
    deleteDomain: (domain, id) => ragStore.deleteDomainDoc(domain, id),
  })
  const refused = await off.triggerNow()
  assert.equal(refused.started, false)
})
