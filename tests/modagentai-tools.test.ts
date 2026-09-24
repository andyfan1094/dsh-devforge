/**
 * 官网能力工具（modagentai_web_search / modagentai_search_quota）单测。
 * 运行：node --experimental-strip-types --test tests/modagentai-tools.test.ts
 * 模式：modagentai-service.test.ts 同款 ctx 打桩 + global.fetch 打桩（临时 HOME 隔离）。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ModagentaiService } from '../src/modagentai/service.ts'
import { modagentaiWebTools } from '../src/modagentai/tools.ts'
import { closeAllDb, getDb, putSettings } from '../src/store/db.ts'

/** 构造打桩 ctx：settings 段内存模拟，credentials 返回固定令牌。 */
function makeCtx(opts: { token?: string } = {}) {
  const token = opts.token ?? 'session-token'
  const ctx = {
    credentials: {
      resolve: async () => (token === '' ? undefined : { value: token }),
      set: async () => {},
      unset: async () => {},
    },
    settings: {
      describe: () => [{ ns: 'llm-pi-ai', revision: 7, value: { providers: {} } }],
      mutate: async () => {},
    },
    logger: { info() {}, warn() {} },
  }
  const openai = { removeEndpoint: async () => {} }
  return new ModagentaiService(ctx as never, openai as never)
}

/** 写入已登录账号信息（service 从 store.db settings 读用户名/角色）。 */
function writeAccount(username: string, role = 'admin'): void {
  putSettings(getDb(), 'modagentai.settings', { username, role, autoApplied: false, appliedModels: 0, appliedAt: 1 })
}

/** fetch 打桩：记录调用并按脚本返回。 */
function stubFetch(handler: (url: string, init?: RequestInit) => Response): { calls: Array<{ url: string; init?: RequestInit }>; install: () => void; restore: () => void } {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const original = globalThis.fetch
  return {
    calls,
    install: () => {
      globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        calls.push({ url, init })
        return handler(url, init)
      }) as typeof fetch
    },
    restore: () => {
      globalThis.fetch = original
    },
  }
}

/** 工具执行入口的轻量形状（defineTool 产物的 execute 方法）。 */
type Executable = { execute: (args: Record<string, unknown>) => Promise<unknown> }
function toolOf(modagentai: ModagentaiService, name: string): Executable {
  const found = modagentaiWebTools(modagentai).find((tool) => tool.name === name)
  assert.ok(found, '缺少工具：' + name)
  return found as unknown as Executable
}

test('modagentai_web_search：成功返回答案与网页列表，请求带 Bearer 与 query', async () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-devforge-modagentai-tools-'))
  process.env.DSH_HOME = home
  const stub = stubFetch(() => new Response(JSON.stringify({
    ok: true,
    channel: 'tavily',
    answer: 'CNB 是国内代码托管平台。',
    results: [{ title: 'CNB 官网', url: 'https://cnb.cool', content: '云原生构建' }, { title: '无链接行', url: '', content: 'x' }],
    cost: 0.01,
    balance: 9.99,
    searchesLeft: 999,
    took: 1230,
  }), { status: 200 }))
  try {
    writeAccount('辉哥')
    const modagentai = makeCtx({})
    const search = toolOf(modagentai, 'modagentai_web_search')
    stub.install()
    const result = await search.execute({ query: '  CNB 是什么  ' }) as { ok: boolean; channel: string; answer: string; results: Array<{ url: string }>; searchesLeft: number }
    assert.equal(result.ok, true)
    assert.equal(result.channel, 'tavily')
    assert.equal(result.answer, 'CNB 是国内代码托管平台。')
    assert.equal(result.results.length, 1, '无 url 的行应被过滤')
    assert.equal(result.results[0]?.url, 'https://cnb.cool')
    assert.equal(result.searchesLeft, 999)
    assert.equal(stub.calls.length, 1)
    assert.equal(stub.calls[0]?.url, 'https://modagentai.com/api/search')
    const headers = (stub.calls[0]?.init?.headers ?? {}) as Record<string, string>
    assert.equal(headers.authorization, 'Bearer session-token')
    const body = JSON.parse(String(stub.calls[0]?.init?.body)) as { query: string }
    assert.equal(body.query, 'CNB 是什么', '应 trim')
  } finally {
    stub.restore()
    closeAllDb()
    delete process.env.DSH_HOME
    rmSync(home, { recursive: true, force: true })
  }
})

test('modagentai_web_search：缺 query 拒绝；未登录 401；钻石用尽透传文案', async () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-devforge-modagentai-tools-'))
  process.env.DSH_HOME = home
  try {
    const modagentai = makeCtx({})
    const search = toolOf(modagentai, 'modagentai_web_search')
    const missing = await search.execute({}) as { ok: boolean; error: string }
    assert.equal(missing.ok, false)
    assert.ok(missing.error.includes('缺少 query'))

    writeAccount('辉哥')
    const exhausted = stubFetch(() => new Response(JSON.stringify({ error: { message: '💎 套餐钻石已用尽' } }), { status: 402 }))
    exhausted.install()
    try {
      const result = await search.execute({ query: 'x' }) as { ok: boolean; error: string }
      assert.equal(result.ok, false)
      assert.ok(result.error.includes('钻石已用尽'), '402 文案应透传')
    } finally {
      exhausted.restore()
    }

    const anon = makeCtx({ token: '' })
    const anonSearch = toolOf(anon, 'modagentai_web_search')
    const result = await anonSearch.execute({ query: 'x' }) as { ok: boolean; error: string }
    assert.equal(result.ok, false)
    assert.ok(result.error.includes('未登录官网账号'))
  } finally {
    closeAllDb()
    delete process.env.DSH_HOME
    rmSync(home, { recursive: true, force: true })
  }
})

test('modagentai_search_quota：返回余额折算；401 报重新登录', async () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-devforge-modagentai-tools-'))
  process.env.DSH_HOME = home
  const stub = stubFetch(() => new Response(JSON.stringify({ ok: true, balance: 4.2, costPerSearch: 0.01, searchesLeft: 420 }), { status: 200 }))
  try {
    writeAccount('辉哥')
    const quota = toolOf(makeCtx({}), 'modagentai_search_quota')
    stub.install()
    const result = await quota.execute({}) as { ok: boolean; searchesLeft: number }
    assert.equal(result.ok, true)
    assert.equal(result.searchesLeft, 420)
    assert.equal(stub.calls[0]?.url, 'https://modagentai.com/api/search/quota')
  } finally {
    stub.restore()
    closeAllDb()
    delete process.env.DSH_HOME
    rmSync(home, { recursive: true, force: true })
  }
})
