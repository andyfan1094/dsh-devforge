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
import { ModagentaiService } from '../src/modagentai/service.ts'
import { tiangongEffortsOutdated, TIANGONG_REASONING_EFFORTS } from '../src/modagentai/provider-declaration.ts'
import { closeAllDb } from '../src/store/db.ts'

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
