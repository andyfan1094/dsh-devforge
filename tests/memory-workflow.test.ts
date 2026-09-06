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
import { extractLastTurnWindow, MemorySedimentService, normalizeMemoryText } from '../src/memory/sediment.ts'
import { buildMemoryQuery, messageText, MemoryInjectionService, RELATIVE_KEEP_RATIO, renderMemoryContext, renderNativeContext, stripBoilerplate } from '../src/memory/inject.ts'
import { MemoryStatsStore } from '../src/memory/stats.ts'
import { closeDb } from '../src/store/db.ts'
import { mergeHits, WorkflowEngine } from '../src/workflow/engine.ts'
import type { RagDocument, RagSearchHit } from '../src/rag/protocol.ts'
import type { RagService } from '../src/rag/service.ts'

const SETTINGS = { enabled: true, autoSediment: true, autoInject: true, topK: 4, threshold: 0.3, maxChars: 1200 }

function hit(id: string, score: number, text = '内容' + id): RagSearchHit {
  return { chunkId: id, docId: 'd' + id, kbId: 'kb1', fileName: 'f.md', headingPath: '', text, score }
}

/** 最小 RagService 替身（只实现被测面）。 */
function fakeRag(overrides?: Partial<Record<string, unknown>>): RagService {
  const docs: RagDocument[] = []
  const base = {
    listKbs: () => [{ id: 'kb1', name: '会话记忆库', source: 'memory', createdAt: 0 }],
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
    const text = '<system-reminder>技能目录与运行时上下文样板</system-reminder>\n[记忆中枢自动注入] 候选\n---\n真正的问题'
    const cleaned = stripBoilerplate(text)
    assert.ok(!cleaned.includes('样板'))
    assert.ok(!cleaned.includes('自动注入'))
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
