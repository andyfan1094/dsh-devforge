/**
 * 官网账号服务（modagentai）单测：天工造梦原生 provider 推理档位声明与启动自愈。
 * 隔离：DSH_HOME 指向临时目录，settings/credentials 全部打桩，不触碰真实用户目录。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { ModagentaiService, ModagentaiServiceError } from '../src/modagentai/service.ts'
import { tiangongEffortsOutdated, TIANGONG_REASONING_EFFORTS } from '../src/modagentai/provider-declaration.ts'
import { closeAllDb, getDb, putSettings } from '../src/store/db.ts'

/** 构造打桩 ctx：settings 段内存模拟，credentials 返回固定令牌。 */
function makeCtx(providers: Record<string, unknown>, opts: { token?: string } = {}) {
  const state = {
    providers: { ...providers } as Record<string, unknown>,
    mutations: [] as Array<{ op: string; path: string[] }>,
    revision: 7,
  }
  const token = opts.token ?? 'session-token'
  const ctx = {
    credentials: {
      resolve: async (ref: unknown) => (token === '' ? undefined : { value: token }),
      set: async (_ref: unknown, _value: string) => {},
      unset: async (_ref: unknown) => {},
    },
    settings: {
      describe: () => [{ ns: 'llm-pi-ai', revision: state.revision, value: { providers: state.providers } }],
      mutate: async (_ns: unknown, mutations: any[], revision: number) => {
        assert.equal(revision, state.revision)
        for (const m of mutations) {
          state.mutations.push(m)
          if (m.op === 'set' && m.path[0] === 'providers') state.providers[m.path[1]] = m.value
          if (m.op === 'unset' && m.path[0] === 'providers') delete state.providers[m.path[1]]
        }
        state.revision += 1
      },
    },
    logger: { info() {}, warn() {} },
  }
  const openai = { removeEndpoint: async () => {} }
  return { service: new ModagentaiService(ctx as never, openai as never), state }
}

const LEGACY_TIANGONG = {
  apiKeyEnv: 'MODAGENTAI_GW_API_KEY',
  displayName: '天工造梦',
  api: 'openai-completions',
  baseURL: 'https://modagentai.com/api/gw/v1',
  models: [{ id: 'GLM-Flash', name: 'GLM-Flash', contextWindow: 262144, input: ['text', 'image'], reasoningEfforts: { low: 'low', medium: 'medium', high: 'high' } }],
}

test('档位判定：旧三档落后，五档不落后，未注册不触发', () => {
  assert.equal(tiangongEffortsOutdated(LEGACY_TIANGONG), true)
  assert.equal(tiangongEffortsOutdated({
    models: [{ id: 'GLM-Flash', reasoningEfforts: { ...TIANGONG_REASONING_EFFORTS } }],
  }), false)
  assert.equal(tiangongEffortsOutdated(undefined), false)
  assert.equal(tiangongEffortsOutdated({}), false)
  assert.equal(tiangongEffortsOutdated({ models: [{ id: 'Other' }] }), false)
  assert.equal(tiangongEffortsOutdated({ models: [{ id: 'GLM-Flash', reasoningEfforts: false }] }), true)
})

test('启动自愈：旧三档声明自动刷新为五档（含 xhigh/max）', async () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-devforge-modagentai-'))
  process.env.DSH_HOME = home
  try {
    const { service, state } = makeCtx({ tiangong: LEGACY_TIANGONG })
    await service.migrateLegacyGateway()
    const setMutation = state.mutations.find((m) => m.op === 'set' && m.path[1] === 'tiangong')
    assert.ok(setMutation, '应产生 tiangong set 变更')
    const written = (state.providers.tiangong as { models: Array<{ reasoningEfforts: Record<string, string> }> }).models[0].reasoningEfforts
    assert.equal(written.xhigh, 'xhigh')
    assert.equal(written.max, 'max')
  } finally {
    closeAllDb()
    delete process.env.DSH_HOME
    rmSync(home, { recursive: true, force: true })
  }
})

test('启动自愈：档位已是五档时幂等不写入', async () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-devforge-modagentai-'))
  process.env.DSH_HOME = home
  try {
    const { service, state } = makeCtx({ tiangong: LEGACY_TIANGONG })
    await service.migrateLegacyGateway()
    state.mutations.length = 0
    await service.migrateLegacyGateway()
    assert.equal(state.mutations.length, 0, '第二轮不应再产生变更')
  } finally {
    closeAllDb()
    delete process.env.DSH_HOME
    rmSync(home, { recursive: true, force: true })
  }
})

test('启动自愈：旧中转残留仍触发迁移并清理 legacy provider', async () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-devforge-modagentai-'))
  process.env.DSH_HOME = home
  try {
    const { service, state } = makeCtx({ 'openai-gateway-modagentai': { baseURL: 'https://old.example.com/v1' } })
    await service.migrateLegacyGateway()
    assert.ok(state.mutations.some((m) => m.op === 'unset' && m.path[1] === 'openai-gateway-modagentai'), 'legacy 应被清理')
    assert.ok(state.providers.tiangong !== undefined, 'tiangong 应被写入')
  } finally {
    closeAllDb()
    delete process.env.DSH_HOME
    rmSync(home, { recursive: true, force: true })
  }
})

test('启动自愈：未登录时不做任何写入', async () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-devforge-modagentai-'))
  process.env.DSH_HOME = home
  try {
    const { service, state } = makeCtx({ tiangong: LEGACY_TIANGONG }, { token: '' })
    await service.migrateLegacyGateway()
    assert.equal(state.mutations.length, 0)
  } finally {
    closeAllDb()
    delete process.env.DSH_HOME
    rmSync(home, { recursive: true, force: true })
  }
})

// —— profile / updateProfile（辉哥 2026-09-23 定稿：个人中心身份卡数据源）——

/** 写入已登录账号信息（profile 接口从 store.db settings 读用户名/角色）。 */
function writeAccount(username: string, role = 'admin'): void {
  putSettings(getDb(), 'modagentai.settings', { username, role, autoApplied: false, appliedModels: 0, appliedAt: 1 })
}

/** fetch 打桩：记录调用并按脚本返回；返回调用列表与恢复函数的容器由调用方 try/finally 恢复。 */
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

test('profile：未登录短路径不发请求', async () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-devforge-modagentai-'))
  process.env.DSH_HOME = home
  const stub = stubFetch(() => new Response('{}', { status: 200 }))
  try {
    const { service } = makeCtx({})
    stub.install()
    const result = await service.profile()
    assert.deepEqual(result, { loggedIn: false, username: '', role: '' })
    assert.equal(stub.calls.length, 0, '未登录不应发起任何请求')
  } finally {
    stub.restore()
    closeAllDb()
    delete process.env.DSH_HOME
    rmSync(home, { recursive: true, force: true })
  }
})

test('profile：401 返回 expired 基础形态', async () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-devforge-modagentai-'))
  process.env.DSH_HOME = home
  const stub = stubFetch(() => new Response('unauthorized', { status: 401 }))
  try {
    writeAccount('辉哥', 'admin')
    const { service } = makeCtx({})
    stub.install()
    const result = await service.profile()
    assert.deepEqual(result, { loggedIn: true, expired: true, username: '辉哥', role: 'admin' })
    assert.equal(stub.calls.length, 1)
    assert.equal(stub.calls[0]?.url, 'https://modagentai.com/api/auth/profile')
  } finally {
    stub.restore()
    closeAllDb()
    delete process.env.DSH_HOME
    rmSync(home, { recursive: true, force: true })
  }
})

test('profile：正常组装且只收 string 字段', async () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-devforge-modagentai-'))
  process.env.DSH_HOME = home
  const stub = stubFetch(() => new Response(JSON.stringify({
    ok: true,
    profile: { username: '官网侧不应采用', role: 'user', avatar: 'data:image/jpeg;base64,AAA', gender: 'male', birthday: '1990-01-01', extra: 1 },
  }), { status: 200, headers: { 'content-type': 'application/json' } }))
  try {
    writeAccount('辉哥', 'user')
    const { service } = makeCtx({})
    stub.install()
    const result = await service.profile()
    assert.equal(result.loggedIn, true)
    assert.equal(result.expired, undefined)
    assert.equal(result.username, '辉哥', '用户名/角色用本地 settings')
    assert.equal(result.role, 'user')
    assert.equal(result.avatar, 'data:image/jpeg;base64,AAA')
    assert.equal(result.gender, 'male')
    assert.equal(result.birthday, '1990-01-01')
  } finally {
    stub.restore()
    closeAllDb()
    delete process.env.DSH_HOME
    rmSync(home, { recursive: true, force: true })
  }
})

test('profile：网络异常返回基础形态不标 expired', async () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-devforge-modagentai-'))
  process.env.DSH_HOME = home
  const original = globalThis.fetch
  try {
    writeAccount('辉哥', 'user')
    const { service } = makeCtx({})
    globalThis.fetch = (async () => { throw new Error('network down') }) as typeof fetch
    const result = await service.profile()
    assert.deepEqual(result, { loggedIn: true, username: '辉哥', role: 'user' })
    assert.equal(result.expired, undefined)
  } finally {
    globalThis.fetch = original
    closeAllDb()
    delete process.env.DSH_HOME
    rmSync(home, { recursive: true, force: true })
  }
})

test('updateProfile：令牌为空抛 401', async () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-devforge-modagentai-'))
  process.env.DSH_HOME = home
  const stub = stubFetch(() => new Response('{}', { status: 200 }))
  try {
    const { service } = makeCtx({}, { token: '' })
    stub.install()
    await assert.rejects(service.updateProfile({ gender: 'male' }), (error: unknown) => {
      assert.ok(error instanceof ModagentaiServiceError)
      assert.equal(error.status, 401)
      assert.match(error.message, /尚未登录/)
      return true
    })
    assert.equal(stub.calls.length, 0, '未登录不应发起请求')
  } finally {
    stub.restore()
    closeAllDb()
    delete process.env.DSH_HOME
    rmSync(home, { recursive: true, force: true })
  }
})

test('updateProfile：avatar 超长预检抛 400 且不打官网', async () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-devforge-modagentai-'))
  process.env.DSH_HOME = home
  const stub = stubFetch(() => new Response('{}', { status: 200 }))
  try {
    writeAccount('辉哥', 'admin')
    const { service } = makeCtx({})
    stub.install()
    await assert.rejects(service.updateProfile({ avatar: 'data:image/jpeg;base64,' + 'A'.repeat(210_001) }), (error: unknown) => {
      assert.ok(error instanceof ModagentaiServiceError)
      assert.equal(error.status, 400)
      assert.match(error.message, /头像过大/)
      return true
    })
    assert.equal(stub.calls.length, 0, '预检失败不应发起请求')
  } finally {
    stub.restore()
    closeAllDb()
    delete process.env.DSH_HOME
    rmSync(home, { recursive: true, force: true })
  }
})

test('updateProfile：401 抛会话失效', async () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-devforge-modagentai-'))
  process.env.DSH_HOME = home
  const stub = stubFetch(() => new Response('unauthorized', { status: 401 }))
  try {
    writeAccount('辉哥', 'admin')
    const { service } = makeCtx({})
    stub.install()
    await assert.rejects(service.updateProfile({ gender: 'male' }), (error: unknown) => {
      assert.ok(error instanceof ModagentaiServiceError)
      assert.equal(error.status, 401)
      assert.match(error.message, /会话已失效/)
      return true
    })
  } finally {
    stub.restore()
    closeAllDb()
    delete process.env.DSH_HOME
    rmSync(home, { recursive: true, force: true })
  }
})

test('updateProfile：成功保存并回读（body 只含 string 字段）', async () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-devforge-modagentai-'))
  process.env.DSH_HOME = home
  const stub = stubFetch(() => new Response(JSON.stringify({
    ok: true,
    profile: { username: 'x', role: 'user', avatar: 'data:image/jpeg;base64,BBB', gender: 'female', birthday: '2000-02-29' },
  }), { status: 200, headers: { 'content-type': 'application/json' } }))
  try {
    writeAccount('辉哥', 'admin')
    const { service } = makeCtx({})
    stub.install()
    const result = await service.updateProfile({ avatar: 'data:image/jpeg;base64,BBB', gender: 'female', birthday: '2000-02-29', junk: 123 } as Record<string, unknown>)
    assert.equal(result.loggedIn, true)
    assert.equal(result.username, '辉哥')
    assert.equal(result.role, 'admin')
    assert.equal(result.avatar, 'data:image/jpeg;base64,BBB')
    assert.equal(result.gender, 'female')
    assert.equal(result.birthday, '2000-02-29')
    assert.equal(stub.calls.length, 1)
    assert.equal(stub.calls[0]?.init?.method, 'POST')
    const body = JSON.parse(String(stub.calls[0]?.init?.body)) as Record<string, unknown>
    assert.deepEqual(body, { avatar: 'data:image/jpeg;base64,BBB', gender: 'female', birthday: '2000-02-29' }, '非 string 字段不进 body')
    const headers = stub.calls[0]?.init?.headers as Record<string, string>
    assert.equal(headers.authorization, 'Bearer session-token')
    assert.equal(headers['content-type'], 'application/json')
  } finally {
    stub.restore()
    closeAllDb()
    delete process.env.DSH_HOME
    rmSync(home, { recursive: true, force: true })
  }
})

test('updateProfile：官网业务错误透传 error 文案与状态码', async () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-devforge-modagentai-'))
  process.env.DSH_HOME = home
  const stub = stubFetch(() => new Response(JSON.stringify({ ok: false, error: '生日格式不正确。' }), { status: 400, headers: { 'content-type': 'application/json' } }))
  try {
    writeAccount('辉哥', 'admin')
    const { service } = makeCtx({})
    stub.install()
    await assert.rejects(service.updateProfile({ birthday: 'bad-date' }), (error: unknown) => {
      assert.ok(error instanceof ModagentaiServiceError)
      assert.equal(error.status, 400)
      assert.equal(error.message, '生日格式不正确。')
      return true
    })
  } finally {
    stub.restore()
    closeAllDb()
    delete process.env.DSH_HOME
    rmSync(home, { recursive: true, force: true })
  }
})
