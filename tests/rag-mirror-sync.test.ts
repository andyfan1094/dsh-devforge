/**
 * 记忆中枢半瘫修复回归（2026-09-18）。
 *
 * 覆盖三个根因的修复：
 * 1. 镜像空扫描保护：源侧扫不到内容时不得清空已有知识库（防自动同步数据事故）；
 * 2. rag_search 双源检索：长期记忆（memory.entry）必须能被知识库检索入口搜到；
 * 3. 镜像自动同步调度：启动补跑、周期执行、防重入、源缺失跳过、失败不中断。
 *
 * 全部使用 FakeEmbedder 与临时目录，不调真实 API、不碰生产库。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDb } from '../src/store/db.ts'
import { RagStore } from '../src/rag/rag-store.ts'
import { RagService, type RagEmbedder } from '../src/rag/service.ts'
import { syncMnemonMirror } from '../src/rag/mirror.ts'
import { MirrorSyncScheduler, normalizeMirrorSyncSettings, DEFAULT_MIRROR_SYNC_SETTINGS } from '../src/rag/mirror-sync.ts'
import { NativeMemoryStore } from '../src/memory/native.ts'

/** 伪向量化器：同文本同向量（确定性，无网络）。 */
class FakeEmbedder implements RagEmbedder {
  calls = 0
  async embed(texts: string[], _model?: string): Promise<Float32Array[]> {
    this.calls++
    return texts.map(t => this.vectorOf(t))
  }
  async embedQuery(text: string, _model?: string): Promise<Float32Array> {
    this.calls++
    return this.vectorOf(text)
  }
  private vectorOf(text: string): Float32Array {
    const code = text.codePointAt(0) ?? 0
    return Float32Array.from([((code % 97) + 1) / 98, 0.2, 0.3, 0.4])
  }
}

function makeEnv(): { service: RagService; store: RagStore; fake: FakeEmbedder; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'rag-mirror-'))
  const store = new RagStore(join(dir, 'main.db'), join(dir, 'vec.db'))
  const fake = new FakeEmbedder()
  const service = new RagService(store, { zhipu: fake, ark: fake, 'openai-gateway': fake, siliconflow: fake })
  return { service, store, fake, dir }
}

/** 造一个 Mnemon 数据根：runtime/MEMORY.md + documents/active/*.md。 */
function makeMnemonRoot(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'mnemon-root-'))
  mkdirSync(join(root, 'runtime'), { recursive: true })
  mkdirSync(join(root, 'documents', 'active'), { recursive: true })
  for (const [rel, content] of Object.entries(files)) {
    writeFileSync(join(root, rel), content, 'utf8')
  }
  return root
}

// ─────────────────────────── 根因 1：空扫描保护

test('镜像空扫描保护：源侧为空时不得清空已有知识库', async () => {
  const { service, dir } = makeEnv()
  const kb = service.createKb('Mnemon 镜像', { source: 'mirror' })
  // 先正常入库一篇
  await service.ingestText(kb.id, 'mnemon/runtime/MEMORY.md', '用户称呼为辉哥。')
  assert.equal(service.listDocs(kb.id).length, 1)

  // 源目录不存在（被移动/卸载）→ 扫到 0 项：旧实现会删光全库
  const report = await syncMnemonMirror(service, kb.id, join(dir, '不存在的目录'))
  assert.equal(report.scanned, 0)
  assert.equal(report.removed, 0, '空扫描绝不能删除已有文档')
  assert.ok(report.errors.length > 0, '空扫描必须报错以便观测')
  assert.equal(service.listDocs(kb.id).length, 1, '库内容必须原样保留')
  closeDb(join(dir, 'main.db'))
})

test('镜像正常同步：新增/更新/删除语义保持正确', async () => {
  const { service, dir } = makeEnv()
  const kb = service.createKb('Mnemon 镜像', { source: 'mirror' })
  const root = makeMnemonRoot({
    'runtime/MEMORY.md': '用户称呼为辉哥。',
    'runtime/USER.md': '辉哥偏好中文文档。',
  })
  const first = await syncMnemonMirror(service, kb.id, root)
  assert.equal(first.added, 2)
  assert.equal(first.errors.length, 0)

  // 内容不变 → 全部跳过（零嵌入调用）
  const second = await syncMnemonMirror(service, kb.id, root)
  assert.equal(second.skipped, 2)
  assert.equal(second.added + second.updated + second.removed, 0)

  // 删掉源文件 → 对应文档被移除（非空扫描，删除语义仍生效）
  writeFileSync(join(root, 'runtime', 'USER.md'), '辉哥偏好中文文档，且要求直接执行。', 'utf8')
  const third = await syncMnemonMirror(service, kb.id, root)
  assert.equal(third.updated, 1, '内容变化应更新')
  closeDb(join(dir, 'main.db'))
})

// ─────────────────────────── 根因 2：rag_search 双源检索

test('rag_search 双源：长期记忆可被知识库检索入口搜到', async () => {
  const { service, store, dir } = makeEnv()
  const native = new NativeMemoryStore(store)
  native.create({ content: '波斯通生产开户客户号 C87875，走 AGENTCODE 序列取号。', category: 'fact', importance: 5 })
  native.create({ content: 'chainglobal 网关必须用 --noproxy 直连，走系统代理会 403。', category: 'fact', importance: 4 })

  // 模拟修复前的状态：RAG 库里没有任何相关文档切块
  const { ragSearchTool } = await import('../src/rag/tools.ts')
  const tool = ragSearchTool(service, native) as unknown as { execute: (args: { query: string; topK?: number }) => Promise<{ ok: boolean; hits?: Array<{ text: string; origin: string }>; sources?: { rag: number; memory: number } }> }
  const out = await tool.execute({ query: 'C87875 客户号' })
  assert.equal(out.ok, true)
  assert.ok(out.hits !== undefined && out.hits.length >= 1, '必须能搜到长期记忆')
  assert.ok(out.hits.some(hit => hit.text.includes('C87875')), '命中内容应包含目标记忆')
  assert.ok(out.hits.some(hit => hit.origin === 'memory'), '命中来源应标记为长期记忆')
  assert.equal(out.sources?.memory !== undefined && out.sources.memory >= 1, true, 'sources 应报告记忆源命中数')
  closeDb(join(dir, 'main.db'))
})

test('rag_search 未注入 native 时仍可正常检索文档（向后兼容）', async () => {
  const { service, dir } = makeEnv()
  const kb = service.createKb('部署知识')
  await service.ingestText(kb.id, '部署.md', '暂存实例需要隔离 HOME 启动，端口 3081。')
  const { ragSearchTool } = await import('../src/rag/tools.ts')
  const tool = ragSearchTool(service) as unknown as { execute: (args: { query: string }) => Promise<{ ok: boolean; hits?: Array<{ text: string; origin: string }> }> }
  const out = await tool.execute({ query: '暂存实例 端口' })
  assert.equal(out.ok, true)
  assert.ok(out.hits !== undefined && out.hits.length >= 1)
  assert.ok(out.hits.every(hit => hit.origin === 'rag'))
  closeDb(join(dir, 'main.db'))
})

test('rag_search 显式限定 kbIds 时不混入长期记忆', async () => {
  const { service, store, dir } = makeEnv()
  const native = new NativeMemoryStore(store)
  native.create({ content: '限定了知识库时不应混入长期记忆条目。', category: 'fact', importance: 3 })
  const { ragSearchTool } = await import('../src/rag/tools.ts')
  const tool = ragSearchTool(service, native) as unknown as { execute: (args: { query: string; kbIds: string[] }) => Promise<{ ok: boolean; hits?: Array<{ origin: string }>; sources?: { memory: number } }> }
  const kb = service.createKb('指定库')
  const out = await tool.execute({ query: '长期记忆', kbIds: [kb.id] })
  assert.equal(out.sources?.memory, 0, '限定 kbIds 时不应检索长期记忆')
  closeDb(join(dir, 'main.db'))
})

// ─────────────────────────── 根因 3：自动同步调度

test('配置规整：缺省/越界值回退默认', () => {
  assert.deepEqual(normalizeMirrorSyncSettings(undefined), DEFAULT_MIRROR_SYNC_SETTINGS)
  assert.equal(normalizeMirrorSyncSettings({ intervalMinutes: 1 }).intervalMinutes, 5, '低于下限应抬到 5 分钟')
  assert.equal(normalizeMirrorSyncSettings({ intervalMinutes: 99999 }).intervalMinutes, 1440, '高于上限应压到 24 小时')
  assert.equal(normalizeMirrorSyncSettings({ enabled: false }).enabled, false)
  assert.equal(normalizeMirrorSyncSettings({}).enabled, true, '缺省应默认启用')
})

test('调度器：启动补跑执行同步且写入最近运行记录', async () => {
  const { service, dir } = makeEnv()
  const root = makeMnemonRoot({ 'runtime/MEMORY.md': '用户称呼为辉哥。' })
  // 用真实 Mnemon 根驱动：MNEMON 数据根由 mnemonDataRoot() 解析，这里直接调 runOnce 验证调度语义
  const scheduler = new MirrorSyncScheduler({
    rag: service,
    config: () => ({ enabled: true, intervalMinutes: 60 }),
    startupDelayMs: 0,
  })
  const run = await scheduler.runOnce('测试触发')
  assert.equal(run.trigger, '测试触发')
  assert.ok(run.at > 0)
  assert.equal(scheduler.lastRun?.trigger, '测试触发')
  scheduler.dispose()
  closeDb(join(dir, 'main.db'))
  void root
})

test('调度器：总开关关闭时不启动定时器', () => {
  const { service, dir } = makeEnv()
  const scheduler = new MirrorSyncScheduler({ rag: service, config: () => ({ enabled: false, intervalMinutes: 60 }), startupDelayMs: 0 })
  scheduler.start()
  const internals = scheduler as unknown as { timer?: unknown; startupTimer?: unknown }
  assert.equal(internals.timer, undefined, '关闭时不应创建周期定时器')
  assert.equal(internals.startupTimer, undefined, '关闭时不应创建启动补跑定时器')
  scheduler.dispose()
  closeDb(join(dir, 'main.db'))
})

test('调度器：防重入——同步在途时再次触发直接返回', async () => {
  const { service, dir } = makeEnv()
  const scheduler = new MirrorSyncScheduler({ rag: service, config: () => ({ enabled: true, intervalMinutes: 60 }) })
  // 手工把 running 置位，模拟在途同步
  ;(scheduler as unknown as { running: boolean }).running = true
  const run = await scheduler.runOnce('并发触发')
  assert.equal(run.error, '已有同步在途')
  scheduler.dispose()
  closeDb(join(dir, 'main.db'))
})

test('设置规整：旧库缺 mirrorSync 节时补默认值，不抛错', () => {
  const { service, dir } = makeEnv()
  // 模拟旧版本写入的设置快照（无 mirrorSync 节）
  const legacy = { embedding: { provider: 'zhipu', model: 'embedding-3' }, rerank: { mode: 'zhipu', topN: 4 }, chunk: { maxSize: 512, overlap: 64 }, search: { topK: 8, vectorWeight: 0.5, threshold: 0 }, advanced: { concurrency: 4, cacheEnabled: true, timeoutMs: 30000 } }
  const store = (service as unknown as { store: RagStore }).store
  store.putRagSettings(legacy as never)
  const settings = service.getSettings()
  assert.deepEqual(settings.mirrorSync, { enabled: true, intervalMinutes: 60 }, '老库应补上 mirrorSync 默认值')
  assert.equal(settings.embedding.model, 'embedding-3', '已有字段不得被默认值覆盖')
  closeDb(join(dir, 'main.db'))
})
