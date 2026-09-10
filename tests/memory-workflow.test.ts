/**
 * 记忆层 + 工作流 + 索引/镜像/重排 单测（全部 fake 注入，零网络零凭据）。
 */
import assert from 'node:assert/strict'
import { test, describe } from 'node:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { compileGitignoreLine, Ignored } from '../src/rag/ignore-lite.ts'
import { collectFiles, ProjectIndexer } from '../src/rag/project-indexer.ts'
import { collectPageRefs, listMnemonMarkdowns, mnemonDataRoot, readHindsightConfig, resolveBankId } from '../src/rag/mirror.ts'
import { buildRerankRequestBody, LlmReranker, parseRerankResponse } from '../src/rag/rerank.ts'
import { extractLastTurnWindow, MemorySedimentService, normalizeMemoryText, sessionEventsOf } from '../src/memory/sediment.ts'
import { buildMemoryQuery, messageText, MemoryInjectionService, RELATIVE_KEEP_RATIO, renderMemoryContext, renderNativeContext, stripBoilerplate } from '../src/memory/inject.ts'
import { normalizeMemorySettings, DEFAULT_MEMORY_SETTINGS } from '../src/memory/routes.ts'
import { MemoryStatsStore } from '../src/memory/stats.ts'
import { NativeMemoryStore, type NativeMemoryEntry } from '../src/memory/native.ts'
import { RagStore } from '../src/rag/rag-store.ts'
import { closeDb } from '../src/store/db.ts'
import { MemoryGovernanceService } from '../src/memory/governance.ts'
import { mergeHits, WorkflowEngine } from '../src/workflow/engine.ts'
import type { RagDocument, RagSearchHit } from '../src/rag/protocol.ts'
import type { RagService } from '../src/rag/service.ts'

const SETTINGS = { enabled: true, autoSediment: true, autoInject: true, autoReflect: true, autoActivate: true, projectProfile: true, topK: 4, threshold: 0.3, maxChars: 1200 }

function hit(id: string, score: number, text = '内容' + id): RagSearchHit {
  return { chunkId: id, docId: 'd' + id, kbId: 'kb1', fileName: 'f.md', headingPath: '', text, score }
}

/** 最小 RagService 替身（只实现被测面）。 */
function fakeRag(overrides?: Partial<Record<string, unknown>>): RagService {
  const docs: RagDocument[] = []
  const base = {
    listKbs: () => [{ id: 'kb1', name: '镜像库', source: 'mirror', createdAt: 0 }],
    listDocs: () => docs,
    listChunks: () => [],
    deleteDoc: () => {},
    search: async () => [hit('1', 0.9)],
    ingestText: async (kbId: string, fileName: string) => {
      docs.push({ id: fileName, kbId, fileName, contentHash: 'h', status: 'ready', chunkCount: 1, createdAt: 0 })
      return docs[docs.length - 1]!
    },
    ...overrides,
  }
  return base as unknown as RagService
}

describe('gitignore 轻量匹配', () => {
  test('注释/取反/空行编译为 undefined', () => {
    assert.equal(compileGitignoreLine('# 注释'), undefined)
    assert.equal(compileGitignoreLine('!keep.md'), undefined)
    assert.equal(compileGitignoreLine('   '), undefined)
  })
  test('根锚定与段内通配', () => {
    const rule = compileGitignoreLine('/dist')
    assert.ok(rule !== undefined)
    assert.ok(rule.pattern.test('dist/'))
    assert.ok(!rule.pattern.test('src/dist/'))
    const star = compileGitignoreLine('*.log')
    assert.ok(star !== undefined)
    assert.ok(star.pattern.test('a/b.log'))
  })
  test('Ignored 目录叠加与目录规则', () => {
    const root = mkdtempSync(join(tmpdir(), 'ig-'))
    try {
      writeFileSync(join(root, '.gitignore'), 'ignored-dir/\n*.secret\n')
      const ignored = new Ignored().withGitignore(root, join(root, '.gitignore'))
      assert.equal(ignored.isIgnoredDir(join(root, 'ignored-dir'), root), true)
      assert.equal(ignored.isIgnoredFile(join(root, 'x.secret'), root), true)
      assert.equal(ignored.isIgnoredFile(join(root, 'keep.md'), root), false)
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
})

describe('项目增量索引', () => {
  test('collectFiles 尊重 gitignore 与固定排除目录', () => {
    const root = mkdtempSync(join(tmpdir(), 'proj-'))
    try {
      writeFileSync(join(root, '.gitignore'), 'skip.md\n')
      mkdirSync(join(root, 'node_modules'), { recursive: true })
      writeFileSync(join(root, 'node_modules', 'x.js'), 'x')
      mkdirSync(join(root, 'packages', 'app'), { recursive: true })
      writeFileSync(join(root, 'packages', 'app', 'a.ts'), 'export {}')
      writeFileSync(join(root, 'skip.md'), 'no')
      writeFileSync(join(root, 'README.md'), 'hello')
      const files = collectFiles(root)
      assert.ok(files.includes('packages/app/a.ts'))
      assert.ok(files.includes('README.md'))
      assert.ok(!files.some((f) => f.includes('node_modules')))
      assert.ok(!files.includes('skip.md'))
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
  test('ProjectIndexer 二次运行零重复入库', async () => {
    const root = mkdtempSync(join(tmpdir(), 'idx-'))
    try {
      writeFileSync(join(root, 'a.md'), '# 标题\n内容')
      let ingests = 0
      const rag = fakeRag({
        ingestText: async (kbId: string, fileName: string) => {
          ingests += 1
          const text = '# 标题\n内容'
          return { id: fileName, kbId, fileName, contentHash: 'stable', status: 'ready', chunkCount: 1, createdAt: 0 } as RagDocument
        },
      })
      // 让 listDocs 返回与入库一致的记录（模拟服务端幂等语义）
      const docs: RagDocument[] = []
      const rag2 = fakeRag({
        listDocs: () => docs,
        ingestText: async (kbId: string, fileName: string) => {
          ingests += 1
          const doc: RagDocument = { id: fileName, kbId, fileName, contentHash: 'stable', status: 'ready', chunkCount: 1, createdAt: 0 }
          docs.push(doc)
          return doc
        },
      }) as unknown as RagService
      const indexer = new ProjectIndexer(rag2, 'kb1')
      const first = await indexer.run(root)
      assert.equal(first.added, 1) // 仅 a.md（.gitignore 不在白名单）
      const second = await indexer.run(root)
      assert.equal(second.added, 0)
      assert.equal(second.updated, 1) // 哈希不同 → 走更新而非新增
      void rag
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
})

describe('镜像连接器（只读）', () => {
  test('readHindsightConfig 解析与 daemon 回退', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hs-'))
    try {
      const path = join(dir, 'coding-agent.json')
      writeFileSync(path, JSON.stringify({ serverMode: 'daemon', apiPort: 8622, apiToken: 'tok', bankId: 'b1' }))
      const config = readHindsightConfig(path)
      assert.ok(config !== undefined)
      assert.equal(config.apiUrl, 'http://127.0.0.1:8622')
      assert.equal(resolveBankId(config), 'b1')
      writeFileSync(path, JSON.stringify({ serverMode: 'self-hosted', apiUrl: 'https://example.test/', bankId: 'b2' }))
      const config2 = readHindsightConfig(path)
      assert.equal(config2?.apiUrl, 'https://example.test')
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
  test('collectPageRefs 只取页面节点', () => {
    const tree = [{ kind: 'folder', id: 'f1', name: 'F', children: [{ kind: 'page', id: 'p1', name: '页一' }, { kind: 'page', id: 'p2', name: '页二' }] }]
    assert.deepEqual(collectPageRefs(tree).map((p) => p.id), ['p1', 'p2'])
  })
  test('mnemonDataRoot 与列表', () => {
    assert.equal(mnemonDataRoot('~/.x').endsWith('/.x'), true)
    const dir = mkdtempSync(join(tmpdir(), 'mn-'))
    try {
      mkdirSync(join(dir, 'runtime'), { recursive: true })
      writeFileSync(join(dir, 'runtime', 'MEMORY.md'), 'M')
      const files = listMnemonMarkdowns(dir)
      assert.ok(files.some((f) => f.key === 'mnemon/runtime/MEMORY.md'))
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})

describe('重排', () => {
  test('请求体与响应解析', () => {
    const body = JSON.parse(buildRerankRequestBody('rerank', 'q', ['a', 'b'], 1))
    assert.deepEqual(body, { model: 'rerank', query: 'q', documents: ['a', 'b'], top_n: 1 })
    assert.deepEqual(parseRerankResponse({ results: [{ index: 1 }, { index: 0 }, { index: 9 }] }, 2), [1, 0])
  })
  test('LLM 重排打分排序与解析失败回退', async () => {
    const good = new LlmReranker(async () => '{"scores":[{"i":0,"s":1},{"i":1,"s":9}]}')
    assert.deepEqual(await good.rerank('q', [{ text: 'a' }, { text: 'b' }], 2), [1, 0])
    const bad = new LlmReranker(async () => '不是JSON')
    assert.deepEqual(await bad.rerank('q', [{ text: 'a' }, { text: 'b' }], 1), [0])
  })
})

describe('会话记忆沉淀', () => {
  test('提取最近一轮窗口', () => {
    const events = [
      { type: 'turn/end', data: { turn: 1 } },
      { type: 'user/message', data: { content: [{ type: 'text', text: '喜欢紧凑排版' }] } },
      { type: 'assistant/message', data: { content: [{ type: 'text', text: '好的，已记住并按紧凑密度实现，这里有足够长的答复内容以便通过窗口过滤。' }] } },
      { type: 'turn/end', data: { turn: 2 } },
    ]
    const window = extractLastTurnWindow(events)
    assert.ok(window.userText.includes('紧凑排版'))
    assert.ok(window.assistantText.includes('紧凑密度'))
  })
  test('提炼去重入库', async () => {
    const stored: string[] = []
    const rag = fakeRag({
      listDocs: () => [],
      listChunks: () => [],
      ingestText: async (_kb: string, _name: string, text: string) => { stored.push(text); return { id: 'x', kbId: 'kb1', fileName: 'x', contentHash: 'h', status: 'ready', chunkCount: 1, createdAt: 0 } as RagDocument },
    })
    const session = { id: 's1', events: [
      { type: 'user/message', data: { content: [{ type: 'text', text: '部署服务器是 1.2.3.4' }] } },
      { type: 'assistant/message', data: { content: [{ type: 'text', text: '已记录服务器地址 1.2.3.4。本条答复写得足够长，是为了通过沉淀窗口的最小答复长度过滤判断，属于测试构造内容。' }] } },
      { type: 'turn/end', data: { turn: 1 } },
    ] }
    let call = 0
    const sediment = new MemorySedimentService(rag, () => 'kb1', async () => {
      call += 1
      return '{"items":[{"content":"部署服务器是 1.2.3.4","importance":"critical"}]}'
    }, () => SETTINGS)
    const first = await sediment.process(session, 's1', 1)
    assert.equal(first, 1)
    // 同内容再次提炼（fake 总返回同 JSON）→ 哈希去重为零入库；同轮次水位短路。
    const second = await sediment.process(session, 's1', 1)
    assert.equal(second, 0)
    assert.equal(stored.length, 1)
    assert.equal(normalizeMemoryText(' a  b '), 'a b')
  })
  test('提炼过滤：未提交/未推送等临时状态不入库', async () => {
    const stored: string[] = []
    const rag = fakeRag({
      listDocs: () => [],
      listChunks: () => [],
      ingestText: async (_kb: string, _name: string, text: string) => { stored.push(text); return { id: 'x', kbId: 'kb1', fileName: 'x', contentHash: 'h', status: 'ready', chunkCount: 1, createdAt: 0 } as RagDocument },
    })
    const session = { id: 's2', events: [
      { type: 'user/message', data: { content: [{ type: 'text', text: '先改到这里' }] } },
      { type: 'assistant/message', data: { content: [{ type: 'text', text: '当前工作区包含未提交的改动，尚未执行推送。这一句是测试构造的足够长答复，用于通过沉淀窗口的最小答复长度过滤判断。' }] } },
      { type: 'turn/end', data: { turn: 1 } },
    ] }
    const sediment = new MemorySedimentService(rag, () => 'kb1', async () => '{"items":[{"content":"当前工作区包含未提交的改动，尚未执行推送","importance":"normal"}]}', () => SETTINGS)
    const storedCount = await sediment.process(session, 's2', 1)
    assert.equal(storedCount, 0, '临时状态条目必须被硬过滤，不入库')
    assert.equal(stored.length, 0)
  })
  test('沉淀全自动激活：候选直接成为 active，同 memoryKey 新证据自动取代', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-sed-auto-'))
    const ragStore = new RagStore(join(dir, 'store.db'), join(dir, 'rag-vec.db'))
    const native = new NativeMemoryStore(ragStore)
    const governance = new MemoryGovernanceService(ragStore, native)
    try {
      const rag = fakeRag({ listDocs: () => [], listChunks: () => [] })
      const projectScope = { kind: 'project' as const, id: 'p1' }
      const session = (id: string, host: string, answer: string) => ({ id, events: [
        { type: 'user/message', data: { content: [{ type: 'text', text: '把项目数据库配好' }] } },
        { type: 'tool/call', data: { callId: 'c1', name: 'read' } },
        { type: 'tool/result', data: { message: { source: { callId: 'c1' } }, content: [{ type: 'text', text: 'config.yaml: host: ' + host }] } },
        { type: 'assistant/message', data: { content: [{ type: 'text', text: answer + '。本句是测试构造的足够长答复，用于通过沉淀窗口的最小答复长度过滤判断。' }] } },
        { type: 'turn/end', data: { turn: 1 } },
      ] })
      let reply = '{"items":[{"content":"项目数据库地址是 10.0.0.2:3306","category":"fact","memoryKey":"db-addr","confidence":0.9}]}'
      const sediment = new MemorySedimentService(rag, () => 'kb1', async () => reply, () => SETTINGS, native, undefined, { governance, scopeOf: () => projectScope })
      const first = await sediment.process(session('s3', '10.0.0.2', '数据库配置完成，地址 10.0.0.2'), 's3', 1)
      assert.equal(first, 1, '自动激活计一次入库')
      const active1 = native.list()
      assert.equal(active1.length, 1)
      assert.equal(active1[0]?.state, 'active')
      assert.equal(active1[0]?.trust, 'verified', '带工具证据自动激活为 verified')
      assert.equal(active1[0]?.memoryKey, 'db-addr')
      assert.equal(governance.listCandidates({ states: ['pending', 'needs-resolution'] }).length, 0, '全自动后无待审核候选')
      assert.equal(governance.listCandidates({ states: ['auto-activated'] }).length, 1)
      assert.equal(sediment.lastOutcome, 'auto-stored:1')
      // 第二次沉淀同 memoryKey 新值 → 自动取代旧事实，无人工介入。
      reply = '{"items":[{"content":"项目数据库地址已迁移到 10.0.0.3:3306","category":"fact","memoryKey":"db-addr","confidence":0.9}]}'
      const second = await sediment.process(session('s4', '10.0.0.3', '数据库迁移完成，新地址 10.0.0.3'), 's4', 1)
      assert.equal(second, 1)
      const active2 = native.list()
      assert.equal(active2.length, 1, '取代后仍只有一条活跃事实')
      assert.ok(active2[0]?.content.includes('10.0.0.3'))
      assert.equal(active2[0]?.supersedes.length, 1, '保留取代链可追溯')
    } finally {
      closeDb(join(dir, 'store.db'))
      rmSync(dir, { recursive: true, force: true })
    }
  })
  test('复盘自动化：提炼成功即写任务复盘（目标/结果/工具/教训）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-sed-episode-'))
    const ragStore = new RagStore(join(dir, 'store.db'), join(dir, 'rag-vec.db'))
    const native = new NativeMemoryStore(ragStore)
    const governance = new MemoryGovernanceService(ragStore, native)
    try {
      const rag = fakeRag({ listDocs: () => [], listChunks: () => [] })
      // 模型输出同时带 task 复盘段：这是唯一的复盘数据来源，缺了就只能退化成技术复盘。
      const reply = '{"task":{"goal":"给项目配好数据库","summary":"已改 config.yaml 并重启服务","outcome":"success","lessons":["改完配置要重启"],"usedMemoryIds":[]},"items":[{"content":"项目数据库地址是 10.0.0.2:3306","category":"fact","confidence":0.9}]}'
      const session = { id: 's5', events: [
        { type: 'user/message', data: { content: [{ type: 'text', text: '把项目数据库配好' }] } },
        { type: 'tool/call', data: { callId: 'c1', name: 'read' } },
        { type: 'tool/result', data: { message: { source: { callId: 'c1' } }, content: [{ type: 'text', text: 'config.yaml: host: 10.0.0.2' }] } },
        { type: 'assistant/message', data: { content: [{ type: 'text', text: '数据库配置已经完成：先改好了 config.yaml 里的连接串，再重启了后端服务，健康检查接口返回 200，本次改动可以交付。本句是测试构造的长答复，用于通过沉淀窗口的最小答复长度过滤判断。' }] } },
        { type: 'turn/end', data: { turn: 1 } },
      ] }
      const sediment = new MemorySedimentService(rag, () => 'kb1', async () => reply, () => SETTINGS, native, undefined, { governance, scopeOf: () => ({ kind: 'global' }) })
      await sediment.process(session, 's5', 1)
      const episodes = governance.listEpisodes(10)
      assert.equal(episodes.length, 1, '每轮提炼成功都要留下一条任务复盘')
      assert.equal(episodes[0]?.goal, '给项目配好数据库')
      assert.equal(episodes[0]?.outcome, 'success')
      assert.deepEqual(episodes[0]?.toolNames, ['read'])
      assert.deepEqual(episodes[0]?.lessons, ['改完配置要重启'])
    } finally {
      closeDb(join(dir, 'store.db'))
      rmSync(dir, { recursive: true, force: true })
    }
  })
  test('复盘自动化：模型失败也不能断档，落技术复盘并保留待提炼窗口', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-sed-fail-'))
    const ragStore = new RagStore(join(dir, 'store.db'), join(dir, 'rag-vec.db'))
    const native = new NativeMemoryStore(ragStore)
    const governance = new MemoryGovernanceService(ragStore, native)
    try {
      const rag = fakeRag({ listDocs: () => [], listChunks: () => [] })
      const session = { id: 's6', events: [
        { type: 'user/message', data: { content: [{ type: 'text', text: '跑一遍部署检查' }] } },
        { type: 'tool/call', data: { callId: 'c1', name: 'bash' } },
        { type: 'tool/result', data: { message: { source: { callId: 'c1' } }, content: [{ type: 'text', text: '检查脚本输出：全部通过' }] } },
        { type: 'assistant/message', data: { turn: 1, content: [{ type: 'text', text: '部署检查已经跑完：端口、依赖版本、磁盘余量与备份任务四项全部通过，没有发现阻塞项，可以进入下一步交付流程。本句是测试构造的长答复，用于通过沉淀窗口的最小答复长度过滤判断。' }] } },
        { type: 'turn/end', data: { turn: 1 } },
      ] }
      const sediment = new MemorySedimentService(rag, () => 'kb1', async () => { throw new Error('模型调用失败：stream ended without a stop reason') }, () => SETTINGS, native, undefined, { governance, scopeOf: () => ({ kind: 'global' }), delayMs: 5 })
      const context = { on: (_event: string, listener: (session: unknown, event: unknown) => void) => { void listener(session, { type: 'turn/end', data: { turn: 1 } }); return () => { /* 卸载 */ } } }
      assert.equal(governance.listEpisodes(10).length, 0)
      sediment.attach(context)
      // 模型连续失败三次（初次 + 两次重试）后仍必须留下复盘记录，否则面板上「任务复盘」永远空白；
      // 该记录按失败计：复盘缺口必须显式可见，不能伪装成成功。
      for (let attempt = 0; attempt < 60 && governance.listEpisodes(10).length === 0; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 25))
      const episodes = governance.listEpisodes(10)
      assert.equal(episodes.length, 1, '模型失败也必须落一条待复盘记录')
      assert.equal(episodes[0]?.outcome, 'failure')
      assert.equal(episodes[0]?.goal, '跑一遍部署检查')
      assert.deepEqual(episodes[0]?.toolNames, ['bash'], '工具证据必须保留，复盘才可核对')
      assert.equal(episodes[0]?.toolSuccesses, 1)
      assert.equal(governance.listPendingWindows().length, 1, '待处理窗口保留：模型恢复后仍要补提炼，不能丢记忆')
      sediment.dispose()
    } finally {
      closeDb(join(dir, 'store.db'))
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('记忆主动注入', () => {
  test('消息文本提取与渲染截断', () => {
    assert.equal(messageText({ content: [{ type: 'text', text: '问题' }] }), '问题')
    const rendered = renderMemoryContext([hit('1', 0.9, '关键事实')], 50)
    assert.ok(rendered.includes('记忆中枢自动注入'))
    // 措辞降级：不再承诺「与当前问题相关」，改为候选 + 自行取舍。
    assert.ok(rendered.includes('可能与当前问题无关'))
    const nativeRendered = renderNativeContext([{ id: 'n1', content: '关键事实', category: 'general', tags: [], source: 'session', importance: 3, createdAt: 0, updatedAt: 0 }], 500)
    assert.ok(nativeRendered.includes('可能与当前问题无关'))
    assert.ok(rendered.length <= 50 + 1)
  })
  test('stripBoilerplate：剔除 system-reminder 块与记忆注入段', () => {
    const text = '<system-reminder>技能目录与运行时上下文样板</system-reminder>\n[记忆中枢自动注入] 候选\n---\n[项目档案] 以下是「悟空」已沉淀的项目记忆\n---\n真正的问题'
    const cleaned = stripBoilerplate(text)
    assert.ok(!cleaned.includes('样板'))
    assert.ok(!cleaned.includes('自动注入'))
    assert.ok(!cleaned.includes('项目档案'), '项目档案卡段同样必须从检索查询中剔除')
    assert.ok(!cleaned.includes('悟空'))
    assert.ok(cleaned.includes('真正的问题'))
  })
  test('buildMemoryQuery：取最后一条用户消息、跳过插件快照并剔除样板段', () => {
    const messages = [
      { role: 'user', content: [{ type: 'text', text: '<system-reminder>技能目录样板</system-reminder>旧问题：上一轮问过部署' }] },
      { role: 'user', source: { kind: 'plugin', plugin: 'dsh-devforge' }, content: [{ type: 'text', text: '[记忆中枢自动注入] 检索候选' }] },
      { role: 'user', content: [{ type: 'text', text: '[内置长期记忆] 候选段\n---\n记忆注入的相关性到底怎么判断？' }] },
    ]
    const query = buildMemoryQuery(messages)
    assert.ok(query.startsWith('记忆注入的相关性到底怎么判断'))
    assert.ok(!query.includes('样板'))
    assert.ok(!query.includes('旧问题'))
    assert.ok(!query.includes('自动注入'))
    // 只剩插件快照时返回空串 → 本轮判定 no-hit，不注入。
    assert.equal(buildMemoryQuery([{ role: 'user', source: { kind: 'plugin' }, content: [{ type: 'text', text: '[记忆中枢自动注入] 候选' }] }]), '')
    assert.equal(buildMemoryQuery([]), '')
  })
  test('decide 阈值过滤与来源库过滤', async () => {
    const rag = fakeRag({ search: async () => [hit('1', 0.2), hit('2', 0.8)] })
    const injection = new MemoryInjectionService(rag, () => SETTINGS)
    const text = await injection.decide([{ content: [{ type: 'text', text: '服务器地址是什么' }] }])
    assert.ok(text !== undefined)
    assert.ok(text.includes('f.md'))
    assert.ok(!text.includes('内容1'))
  })
  test('decide 动态阈值：与最高分差距过大的弱命中被丢弃', async () => {
    const rag = fakeRag({ search: async () => [hit('1', 0.5), hit('2', 0.2)] })
    const injection = new MemoryInjectionService(rag, () => SETTINGS)
    const text = await injection.decide([{ content: [{ type: 'text', text: '服务器地址是什么' }] }])
    // 相对线 = 0.5 × RELATIVE_KEEP_RATIO < 绝对线 0.3，取 0.3：0.5 保留、0.2 丢弃。
    assert.ok(RELATIVE_KEEP_RATIO > 0.3 && RELATIVE_KEEP_RATIO < 1)
    assert.ok(text !== undefined && text.includes('内容1'))
    assert.ok(!text.includes('内容2'))
  })
  test('decide 常驻记忆：检索零命中仍注入常驻块，且常驻条目不重复', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mem-pinned-'))
    try {
      const native = new NativeMemoryStore(new RagStore(join(dir, 'store.db'), join(dir, 'rag-vec.db')))
      native.create({ content: '未经辉哥再次确认不得重启生产环境', importance: 4, pinned: true }, 'rule-1')
      const rag = fakeRag({ search: async () => [] })
      const injection = new MemoryInjectionService(rag, () => SETTINGS, native)
      const detail = await injection.decideDetailed([{ content: [{ type: 'text', text: '帮我看看今天的直播数据' }] }])
      assert.equal(detail.reason, undefined, '常驻记忆存在时即使检索零命中也必须注入')
      assert.ok(detail.text?.includes('常驻记忆'))
      assert.ok(detail.text?.includes('未经辉哥再次确认不得重启生产环境'))
      // 常驻条目同时命中检索时只在常驻块出现一次（去重）。
      native.create({ content: '直播数据看板地址是 live.example.com', importance: 3, pinned: true }, 'pin-1')
      const detail2 = await injection.decideDetailed([{ content: [{ type: 'text', text: '直播数据看板地址是 live.example.com' }] }])
      const occurrences = (detail2.text?.match(/live\.example\.com/g) ?? []).length
      assert.equal(occurrences, 1, '常驻条目不得在检索块重复出现')
    } finally { closeDb(join(dir, 'store.db')); rmSync(dir, { recursive: true, force: true }) }
  })
})

describe('记忆设置规整（0.26.6 沉淀路由）', () => {
  test('sedimentProvider/sedimentModel 合法采纳、非法回退', () => {
    const next = normalizeMemorySettings({ sedimentProvider: ' volcengine-ark-plan ', sedimentModel: 'glm-5.3-flash', topK: 6 }, DEFAULT_MEMORY_SETTINGS)
    assert.equal(next.sedimentProvider, 'volcengine-ark-plan')
    assert.equal(next.sedimentModel, 'glm-5.3-flash')
    assert.equal(next.topK, 6)
    const bad = normalizeMemorySettings({ sedimentProvider: 123, sedimentModel: null }, DEFAULT_MEMORY_SETTINGS)
    assert.equal(bad.sedimentProvider, DEFAULT_MEMORY_SETTINGS.sedimentProvider)
    assert.equal(bad.sedimentModel, DEFAULT_MEMORY_SETTINGS.sedimentModel)
  })
})

describe('记忆持久化统计（0.17.14 可观测修复）', () => {
  test('MemoryStatsStore：存量库基线引导 + 跨实例持久化累计', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mem-stats-'))
    const dbPath = join(dir, 'store.db')
    try {
      const docs = [
        { id: 'a', kbId: 'kb1', fileName: 'a.md', contentHash: 'h', status: 'ready', chunkCount: 1, createdAt: 0 },
        { id: 'b', kbId: 'kb1', fileName: 'b.md', contentHash: 'h', status: 'ready', chunkCount: 1, createdAt: 0 },
      ] as RagDocument[]
      const rag = fakeRag({ listDocs: () => docs })
      const store1 = new MemoryStatsStore(rag, () => 'kb1', dbPath)
      const first = store1.read()
      assert.equal(first.sedimentTotal, 2, '首次读取以存量 memory 库文档数做基线，不与沉淀库总量自相矛盾')
      store1.update((prev) => ({ ...prev, sedimentTotal: prev.sedimentTotal + 3, injectTotal: prev.injectTotal + 1, lastInjectAt: 123, lastInjectPreview: '内置长期记忆 · 关键事实' }))
      // 新实例读同一库：累计值持久化生效。
      const store2 = new MemoryStatsStore(rag, () => 'kb1', dbPath)
      const second = store2.read()
      assert.equal(second.sedimentTotal, 5)
      assert.equal(second.injectTotal, 1)
      assert.equal(second.lastInjectAt, 123)
      assert.ok(second.lastInjectPreview.includes('关键事实'))
    } finally { closeDb(dbPath); rmSync(dir, { recursive: true, force: true }) }
  })
  test('decideDetailed：未启用与无命中分别给出 reason，与注入统计口径对齐', async () => {
    const disabled = new MemoryInjectionService(fakeRag(), () => ({ ...SETTINGS, enabled: false }))
    assert.equal((await disabled.decideDetailed([{ content: [{ type: 'text', text: '服务器地址' }] }])).reason, 'disabled')
    const noHit = new MemoryInjectionService(fakeRag({ search: async () => [] }), () => SETTINGS)
    const decision = await noHit.decideDetailed([{ content: [{ type: 'text', text: '服务器地址' }] }])
    assert.equal(decision.text, undefined)
    assert.equal(decision.reason, 'no-hit')
  })
})

describe('工作流引擎', () => {
  test('多路召回合并去重保最高分', () => {
    const merged = mergeHits([[hit('1', 0.6), hit('2', 0.5)], [hit('1', 0.9), hit('3', 0.4)]], 8)
    assert.deepEqual(merged.map((h) => h.chunkId + ':' + h.score.toFixed(1)), ['1:0.9', '2:0.5', '3:0.4'])
  })
  test('端到端运行（改写+自评重试+历史）', async () => {
    const store = new Map<string, Map<string, unknown>>()
    const domain = (name: string) => {
      let m = store.get(name)
      if (m === undefined) { m = new Map(); store.set(name, m) }
      return m
    }
    let llmCalls = 0
    const engine = new WorkflowEngine(
      fakeRag({ search: async () => [hit('1', 0.9, '暂存实例用 3081 端口')] }),
      {
        listDomain: (name) => [...domain(name).entries()].map(([id, data]) => ({ id, data })),
        putDomain: (name, id, data) => { domain(name).set(id, data) },
        deleteDomain: (name, id) => { domain(name).delete(id) },
      },
      async () => {
        llmCalls += 1
        return llmCalls === 1 ? '{"queries":["3081 启动"]}' : '暂存实例用 3081 端口启动 [1]'
      },
    )
    engine.save({ name: '默认', nodes: { rewrite: { enabled: true }, retrieve: { topK: 8, vectorWeight: 0.5 }, rerank: { enabled: false }, generate: { maxTokens: 200 }, selfCheck: { enabled: true, maxRetries: 1 } } })
    const result = await engine.run({ query: '暂存实例怎么启动' })
    assert.equal(result.status, 'ok')
    assert.ok(result.answer.includes('3081'))
    assert.ok(result.steps.some((s) => s.name === 'rewrite'))
    assert.ok(result.steps.some((s) => s.name === 'retrieve'))
    assert.ok(result.steps.some((s) => s.name === 'selfCheck'))
    assert.equal(engine.listRuns().length, 1)
    const resolved = engine.resolve('默认')
    assert.ok(resolved !== undefined)
  })
})

/** 0.26.4 记忆失效修复回归：真实宿主形状、批量窗口、降级与快照协议。 */
describe('会话记忆沉淀 0.26.4 修复回归', () => {
  /** 最小事件上下文替身：on 注册监听，emit 手动触发（session/event 与 agent/pre-step 共用）。 */
  function fakeCtx(): { on: (event: string, listener: (...args: never[]) => unknown) => () => void; emit: (event: string, ...args: unknown[]) => unknown } {
    const listeners = new Map<string, Array<(...args: never[]) => unknown>>()
    return {
      on: (event, listener) => {
        const list = listeners.get(event) ?? []
        list.push(listener)
        listeners.set(event, list)
        return () => { const rest = listeners.get(event) ?? []; const index = rest.indexOf(listener); if (index >= 0) rest.splice(index, 1) }
      },
      emit: (event, ...args) => {
        let result: unknown
        for (const listener of listeners.get(event) ?? []) result = listener(...args)
        return result
      },
    }
  }

  /** 真实宿主形状：只有 snapshotEvents()，没有 events 属性（旧实现读不到 → 沉淀恒 0）。 */
  function hostLikeSession(id: string, events: readonly unknown[]): unknown {
    return { id, snapshotEvents: () => events }
  }

  function turnEvents(turn: number, userText: string, assistantText: string, injectedSnapshot?: string): unknown[] {
    const events: unknown[] = [
      { type: 'user/message', data: { role: 'user', content: [{ type: 'text', text: userText }] } },
    ]
    if (injectedSnapshot !== undefined) {
      // 插件注入快照：宿主契约下 source.kind='plugin'，绝不能被当成用户话术提炼。
      events.splice(1, 0, { type: 'user/message', data: { role: 'user', source: { kind: 'plugin', plugin: 'dsh-devforge', form: 'snapshot', sections: [{ name: 'memory', text: injectedSnapshot }] }, content: [{ type: 'text', text: injectedSnapshot }] } })
    }
    events.push(
      { type: 'assistant/message', data: { turn, step: 1, message: { content: [{ type: 'text', text: assistantText }] } } },
      { type: 'turn/end', data: { turn } },
    )
    return events
  }

  const LONG_REPLY = '本轮已经完成发布与推送，官网包哈希核对一致，这段是测试构造的足够长答复文本，用于通过沉淀窗口的最小长度过滤判断，避免被当成短寒暄丢弃处理。'

  test('sessionEventsOf：优先宿主 snapshotEvents()，旧 events 兜底', () => {
    const snap = [{ type: 'turn/end' }]
    assert.equal(sessionEventsOf({ snapshotEvents: () => snap, events: [{ type: 'other' }] }), snap)
    const legacy = [{ type: 'turn/end' }]
    assert.equal(sessionEventsOf({ events: legacy }), legacy)
    assert.deepEqual(sessionEventsOf({}), [])
    assert.deepEqual(sessionEventsOf(null), [])
  })

  test('attach：真实宿主形状（仅 snapshotEvents）turn/end 后自动沉淀到 native，且不写 RAG', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mem-attach-'))
    try {
      const native = new NativeMemoryStore(new RagStore(join(dir, 'store.db'), join(dir, 'rag-vec.db')))
      let ragIngest = 0
      const rag = fakeRag({ ingestText: async () => { ragIngest += 1; throw new Error('有 native 时不应双写 RAG') } })
      const ctx = fakeCtx()
      const sediment = new MemorySedimentService(rag, () => 'kb1', async () => '{"items":[{"content":"dsh-devforge 0.26.3 已发布到官网且源码提交 a9ab307 已推送 CNB","importance":"critical"}]}', () => SETTINGS, native, undefined, { delayMs: 10 })
      sediment.attach(ctx)
      const events = turnEvents(1, '天工造梦发布进展如何', LONG_REPLY)
      ctx.emit('session/event', hostLikeSession('s-host', events), { type: 'turn/end', data: { turn: 1 } })
      await new Promise((resolve) => setTimeout(resolve, 80))
      const list = native.list()
      assert.equal(list.length, 1)
      assert.ok(list[0]!.content.includes('0.26.3'))
      assert.equal(list[0]!.source, 'session')
      assert.equal(ragIngest, 0, '有 native 时绝不双写 RAG 文档')
      assert.equal(sediment.attemptCount, 1)
      assert.equal(sediment.failureCount, 0)
    } finally { closeDb(join(dir, 'store.db')); rmSync(dir, { recursive: true, force: true }) }
  })

  test('attach：静默期内连续多轮不丢轮次——两轮窗口合并为一次提炼', async () => {
    const stored: string[] = []
    let prompted = ''
    const rag = fakeRag({
      listDocs: () => [],
      listChunks: () => [],
      ingestText: async (_kb: string, _name: string, text: string) => { stored.push(text); return { id: 'x', kbId: 'kb1', fileName: 'x', contentHash: 'h', status: 'ready', chunkCount: 1, createdAt: 0 } as RagDocument },
    })
    const ctx = fakeCtx()
    const sediment = new MemorySedimentService(rag, () => 'kb1', async (_system, user) => {
      prompted = user
      return '{"items":[{"content":"批处理合并了两轮的关键结论","importance":"normal"}]}'
    }, () => SETTINGS, undefined, undefined, { delayMs: 10 })
    sediment.attach(ctx)
    // legacy 路径（无 native）：验证批处理与老数据面兼容。
    const events: unknown[] = []
    for (const [turn, marker] of [[1, '第一轮完成了构建与测试'], [2, '第二轮完成了发布与官网切换']] as const) {
      events.push(
        { type: 'user/message', data: { role: 'user', content: [{ type: 'text', text: marker + '，进展如何' }] } },
        { type: 'assistant/message', data: { turn, step: 1, message: { content: [{ type: 'text', text: marker + '。' + LONG_REPLY }] } } },
        { type: 'turn/end', data: { turn } },
      )
      ctx.emit('session/event', hostLikeSession('s-batch', [...events]), { type: 'turn/end', data: { turn } })
    }
    await new Promise((resolve) => setTimeout(resolve, 80))
    assert.ok(prompted.includes('第一轮完成了构建与测试'), '第一轮窗口不得被防抖丢弃')
    assert.ok(prompted.includes('第二轮完成了发布与官网切换'), '第二轮窗口必须进入同一批提炼')
    assert.equal(stored.length, 1, '多轮合并为一次提炼入库')
  })

  test('attach：插件注入快照不进入提炼窗口（防旧记忆回流再入库）', async () => {
    let prompted = ''
    const stored: string[] = []
    const rag = fakeRag({
      listDocs: () => [],
      listChunks: () => [],
      ingestText: async (_kb: string, _name: string, text: string) => { stored.push(text); return { id: 'x', kbId: 'kb1', fileName: 'x', contentHash: 'h', status: 'ready', chunkCount: 1, createdAt: 0 } as RagDocument },
    })
    const ctx = fakeCtx()
    const sediment = new MemorySedimentService(rag, () => 'kb1', async (_system, user) => { prompted = user; return '{"items":[{"content":"辉哥偏好紧凑排版","importance":"normal"}]}' }, () => SETTINGS, undefined, undefined, { delayMs: 10 })
    sediment.attach(ctx)
    const events = turnEvents(1, '我喜欢紧凑排版', LONG_REPLY, '[内置长期记忆] 旧版候选：dsh-devforge 0.17.1 已发布到官网（过期事实，不得回流）')
    ctx.emit('session/event', hostLikeSession('s-plugin', events), { type: 'turn/end', data: { turn: 1 } })
    await new Promise((resolve) => setTimeout(resolve, 80))
    assert.ok(prompted.includes('紧凑排版'))
    assert.ok(!prompted.includes('0.17.1'), '插件快照不得进入提炼输入')
    assert.equal(stored.length, 1)
  })

  test('attach：提炼失败计数与脱敏原因可观测，且有界自动重试', async () => {
    let calls = 0
    const rag = fakeRag({ listDocs: () => [], listChunks: () => [], ingestText: async () => { throw new Error('不应走到写入') } })
    const ctx = fakeCtx()
    const sediment = new MemorySedimentService(rag, () => 'kb1', async () => { calls += 1; throw new Error('模型超时') }, () => SETTINGS, undefined, undefined, { delayMs: 10 })
    sediment.attach(ctx)
    const events = turnEvents(1, '随便聊聊进展', LONG_REPLY)
    ctx.emit('session/event', hostLikeSession('s-fail', events), { type: 'turn/end', data: { turn: 1 } })
    await new Promise((resolve) => setTimeout(resolve, 120))
    assert.ok(calls >= 2, '失败后应有界重试')
    assert.equal(sediment.failureCount, calls)
    assert.equal(sediment.attemptCount, calls)
    assert.ok(sediment.lastError.includes('模型超时'))
  })

  test('attach：仅后台通知触发的智能体工作轮次也能沉淀（0.26.5 修正误杀）', async () => {
    let prompted = ''
    const stored: string[] = []
    const rag = fakeRag({
      listDocs: () => [],
      listChunks: () => [],
      ingestText: async (_kb: string, _name: string, text: string) => { stored.push(text); return { id: 'x', kbId: 'kb1', fileName: 'x', contentHash: 'h', status: 'ready', chunkCount: 1, createdAt: 0 } as RagDocument },
    })
    const ctx = fakeCtx()
    const sediment = new MemorySedimentService(rag, () => 'kb1', async (_system, user) => { prompted = user; return '{"items":[{"content":"dsh-devforge 0.26.5 修复了通知触发轮次不沉淀的问题","importance":"critical"}]}' }, () => SETTINGS, undefined, undefined, { delayMs: 10 })
    sediment.attach(ctx)
    // tool-jobs 通知是 plugin 来源——干活的轮次正是这种形状，不得被误杀。
    const events = [
      { type: 'user/message', data: { role: 'user', source: { kind: 'plugin', plugin: 'tool-jobs' }, content: [{ type: 'text', text: 'background job bash-2 finished [status: completed, exit code: 0].' }] } },
      { type: 'assistant/message', data: { turn: 10, step: 1, message: { content: [{ type: 'text', text: '抓捕结果：attempt 1 说明管线已经真实跑通并完成判定，这一段是测试构造的足够长答复内容，用于通过沉淀窗口的最小长度过滤判断，避免被当成短寒暄丢弃处理。' }] } } },
      { type: 'turn/end', data: { turn: 10 } },
    ]
    ctx.emit('session/event', hostLikeSession('s-jobs', events), { type: 'turn/end', data: { turn: 10 } })
    await new Promise((resolve) => setTimeout(resolve, 80))
    assert.equal(sediment.attemptCount, 1, '通知轮必须进入提炼')
    assert.equal(stored.length, 1)
    assert.ok(prompted.includes('background job'), '通知文本应作为上下文进入提示词')
    assert.equal(sediment.lastOutcome, 'stored:1')
  })

  test('attach：本插件记忆快照仍被排除，不回流（0.26.5 过滤收窄不放松）', async () => {
    let prompted = ''
    const stored: string[] = []
    const rag = fakeRag({
      listDocs: () => [],
      listChunks: () => [],
      ingestText: async (_kb: string, _name: string, text: string) => { stored.push(text); return { id: 'x', kbId: 'kb1', fileName: 'x', contentHash: 'h', status: 'ready', chunkCount: 1, createdAt: 0 } as RagDocument },
    })
    const ctx = fakeCtx()
    const sediment = new MemorySedimentService(rag, () => 'kb1', async (_system, user) => { prompted = user; return '{"items":[{"content":"普通偏好记录","importance":"normal"}]}' }, () => SETTINGS, undefined, undefined, { delayMs: 10 })
    sediment.attach(ctx)
    const events = [
      { type: 'user/message', data: { role: 'user', source: { kind: 'plugin', plugin: 'dsh-devforge', form: 'snapshot', sections: [{ name: 'memory', text: '[内置长期记忆] 旧候选 0.17.1' }] }, content: [{ type: 'text', text: '[内置长期记忆] 旧候选 0.17.1' }] } },
      { type: 'assistant/message', data: { turn: 11, step: 1, message: { content: [{ type: 'text', text: '收到，本条记忆快照不应进入提炼窗口；这段是测试构造的足够长答复内容，用于通过沉淀窗口的最小长度过滤判断，避免被当成短寒暄丢弃处理。' }] } } },
      { type: 'turn/end', data: { turn: 11 } },
    ]
    ctx.emit('session/event', hostLikeSession('s-snap', events), { type: 'turn/end', data: { turn: 11 } })
    await new Promise((resolve) => setTimeout(resolve, 80))
    assert.ok(!prompted.includes('0.17.1'), '记忆快照不得回流')
    assert.ok(prompted.includes('本轮无新用户输入'))
    assert.equal(stored.length, 1)
  })

  test('提炼判定可观测：no-candidates 与 window-short 分别可见', async () => {
    const noCandidates = new MemorySedimentService(fakeRag({ listDocs: () => [], listChunks: () => [], ingestText: async () => { throw new Error('不应写入') } }), () => 'kb1', async () => '{"items":[]}', () => SETTINGS, undefined, undefined, { delayMs: 0 })
    const session = { id: 's-nc', events: turnEvents(1, '随便聊聊', LONG_REPLY) }
    await noCandidates.process(session, 's-nc', 1)
    assert.equal(noCandidates.lastOutcome, 'no-candidates')
    assert.equal(noCandidates.attemptCount, 1)
    assert.equal(noCandidates.failureCount, 0)

    const shortWindow = new MemorySedimentService(fakeRag(), () => 'kb1', async () => { throw new Error('不应调用模型') }, () => SETTINGS, undefined, undefined, { delayMs: 0 })
    const tiny = { id: 's-short', events: turnEvents(1, '嗯', '好的。') }
    await shortWindow.process(tiny, 's-short', 1)
    assert.equal(shortWindow.lastOutcome, 'window-short')
    assert.equal(shortWindow.attemptCount, 1, '窗口过短也计入尝试，链路可观测')
  })

  test('decide：无任何 RAG 库仍注入常驻与内置记忆（旧实现提前 no-hit）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mem-degrade-'))
    try {
      const native = new NativeMemoryStore(new RagStore(join(dir, 'store.db'), join(dir, 'rag-vec.db')))
      native.create({ content: '生产环境禁止未经辉哥确认重启', importance: 4, pinned: true }, 'rule-1')
      native.create({ content: 'dsh-devforge 0.26.3 已发布到官网', importance: 3 }, 'fact-1')
      const rag = fakeRag({ listKbs: () => [], search: async () => { throw new Error('向量服务不可用') } })
      const injection = new MemoryInjectionService(rag, () => SETTINGS, native)
      const detail = await injection.decideDetailed([{ content: [{ type: 'text', text: 'dsh-devforge 0.26.3 发布到哪了' }] }])
      assert.equal(detail.reason, undefined, '常驻/内置存在时不得因 RAG 故障整体缺席')
      assert.ok(detail.text?.includes('常驻记忆'))
      assert.ok(detail.text?.includes('生产环境禁止未经辉哥确认重启'))
      assert.ok(detail.text?.includes('0.26.3'))
    } finally { closeDb(join(dir, 'store.db')); rmSync(dir, { recursive: true, force: true }) }
  })

  test('decide：镜像 RAG 抛错只损失增强层，常驻与内置照常注入', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mem-mirror-'))
    try {
      const native = new NativeMemoryStore(new RagStore(join(dir, 'store.db'), join(dir, 'rag-vec.db')))
      native.create({ content: '发布包上传后必须核对 SHA256', importance: 3, pinned: true }, 'rule-1')
      native.create({ content: '暂存实例固定使用 3081 端口', importance: 3 }, 'fact-1')
      const rag = fakeRag({ search: async () => { throw new Error('嵌入失败') } })
      const injection = new MemoryInjectionService(rag, () => SETTINGS, native)
      const detail = await injection.decideDetailed([{ content: [{ type: 'text', text: '暂存实例用什么端口' }] }])
      assert.equal(detail.reason, undefined)
      assert.ok(detail.text?.includes('发布包上传后必须核对 SHA256'))
      assert.ok(detail.text?.includes('3081'))
    } finally { closeDb(join(dir, 'store.db')); rmSync(dir, { recursive: true, force: true }) }
  })

  test('decide：注入消息按宿主快照协议标记 form/sections', async () => {
    const injection = new MemoryInjectionService(fakeRag(), () => SETTINGS)
    const ctx = fakeCtx()
    injection.attach(ctx)
    const decision = await ctx.emit('agent/pre-step', { messages: [{ role: 'user', content: [{ type: 'text', text: '服务器地址是什么' }] }], step: 1 }, async () => ({ messages: [{ role: 'user', content: [{ type: 'text', text: '服务器地址是什么' }] }] })) as { messages: Array<{ source: { kind?: string; form?: string; sections?: Array<{ name: string; text: string }> } }> }
    const last = decision.messages[decision.messages.length - 1]!
    assert.equal(last.source.kind, 'plugin')
    assert.equal(last.source.form, 'snapshot', '必须按宿主快照协议声明，后续快照才能替代前者')
    assert.equal(last.source.sections?.[0]?.name, 'memory')
    assert.ok(last.source.sections?.[0]?.text.includes('记忆中枢自动注入'))
  })

  test('renderNativeContext：整条装入预算，绝不截半条', () => {
    const entry = (id: string, ch: string): NativeMemoryEntry => ({ id, content: ch.repeat(120), category: 'general', tags: [], source: 'session', importance: 3, createdAt: 0, updatedAt: Date.now() })
    const text = renderNativeContext([entry('a', 'A'), entry('b', 'B')], 250)
    assert.ok(text.includes('AAAA'), '首条必须完整注入')
    assert.ok(!text.includes('BB'), '第二条装不下整条就不得出现半条')
  })

  test('renderNativeContext：每条渲染更新日期，帮助模型判断时效', () => {
    const text = renderNativeContext([{ id: 'n1', content: '关键事实', category: 'general', tags: [], source: 'session', importance: 3, createdAt: 0, updatedAt: 1_700_000_000_000 }], 500)
    assert.ok(text.includes('2023-'), '条目必须带更新日期')
  })

  test('decide：预算内内置记忆优先于镜像 RAG，长旧文档不再挤掉精确候选', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mem-budget-'))
    try {
      const native = new NativeMemoryStore(new RagStore(join(dir, 'store.db'), join(dir, 'rag-vec.db')))
      native.create({ content: 'dsh-devforge 0.26.3 已发布到官网，发布提交 a9ab307，本条为较长的上下文说明用于验证预算分配行为', importance: 3 }, 'native-1')
      const rag = fakeRag({ search: async () => [hit('1', 0.9, 'Y'.repeat(400))] })
      const injection = new MemoryInjectionService(rag, () => ({ ...SETTINGS, maxChars: 300 }), native)
      const detail = await injection.decideDetailed([{ content: [{ type: 'text', text: '0.26.3 发布事实在哪' }] }])
      const text = detail.text ?? ''
      const nativeAt = text.indexOf('0.26.3')
      const ragAt = text.indexOf('YYYY')
      assert.ok(nativeAt >= 0, '内置精确候选必须获得预算')
      assert.ok(ragAt === -1 || ragAt > nativeAt, '内置记忆必须先于镜像 RAG 渲染（旧实现 RAG 先行会挤占预算）')
    } finally { closeDb(join(dir, 'store.db')); rmSync(dir, { recursive: true, force: true }) }
  })

  test('decide：内置与镜像同内容去重，不双份注入', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mem-dedupe-'))
    try {
      const native = new NativeMemoryStore(new RagStore(join(dir, 'store.db'), join(dir, 'rag-vec.db')))
      native.create({ content: '直播数据看板地址是 live.example.com', importance: 3 }, 'fact-1')
      const rag = fakeRag({ search: async () => [hit('1', 0.9, '直播数据看板地址是 live.example.com')] })
      const injection = new MemoryInjectionService(rag, () => SETTINGS, native)
      const detail = await injection.decideDetailed([{ content: [{ type: 'text', text: '直播数据看板地址是什么' }] }])
      const occurrences = (detail.text?.match(/live\.example\.com/g) ?? []).length
      assert.equal(occurrences, 1, '同一事实在常驻/内置/镜像三层只允许出现一次')
    } finally { closeDb(join(dir, 'store.db')); rmSync(dir, { recursive: true, force: true }) }
  })
})
