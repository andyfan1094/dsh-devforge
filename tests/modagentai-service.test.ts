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
import { buildTiangongModels, parseTiangongCatalog, parseTiangongCatalogImages, tiangongCatalogOutdated, tiangongCapacityOutdated, tiangongDeclarationOutdated, tiangongEffortsOutdated, tiangongProtocolOutdated, TIANGONG_CONTEXT_WINDOW, TIANGONG_DEEPSEEK_EFFORTS, TIANGONG_DEEPSEEK_MODEL_ID, TIANGONG_KIMI_EFFORTS, TIANGONG_KIMI_MODEL_ID, TIANGONG_REASONING_EFFORTS } from '../src/modagentai/provider-declaration.ts'
import { closeAllDb, getDb, putSettings } from '../src/store/db.ts'

/** 构造打桩 ctx：settings 段内存模拟，credentials 返回固定令牌。 */
function makeCtx(providers: Record<string, unknown>, opts: { token?: string; catalog?: unknown; images?: string[] } = {}) {
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
  const siteImage = { enabled: false, model: '' }
  const openai = {
    removeEndpoint: async () => {},
    // 官网生图线路打桩：记录开关与模型，便于断言「登录即接入」。
    setSiteImage: async (input: { enabled: boolean; model?: string }) => {
      siteImage.enabled = input.enabled === true
      if (typeof input.model === 'string' && input.model.trim() !== '') siteImage.model = input.model.trim()
      return { siteImage: { ...siteImage } }
    },
  }
  const service = new ModagentaiService(ctx as never, openai as never)
  // 单测绝不联网：站点目录拉取默认打桩为「离线」（空数组 → 退化为内置清单）；
  // 验证「官网目录优先」的用例通过 opts.catalog 注入站点响应。
  service.fetchOfficialCatalog = async () => (opts.catalog === undefined ? [] : parseTiangongCatalog(opts.catalog))
  // 生图模型清单同样打桩：默认「官网未下发」（空数组 → 保留既有生图模型）。
  service.fetchOfficialImageModels = async () => opts.images ?? []
  return { service, state, siteImage }
}

/** 历史版本写入的上下文窗口（256K）；升级后应被启动自愈改写为 TIANGONG_CONTEXT_WINDOW。 */
const LEGACY_CONTEXT_WINDOW = 262_144

const LEGACY_TIANGONG = {
  apiKeyEnv: 'MODAGENTAI_GW_API_KEY',
  displayName: '天工造梦',
  api: 'openai-completions',
  baseURL: 'https://modagentai.com/api/gw/v1',
  models: [{ id: 'GLM-Flash', name: 'GLM-Flash', contextWindow: LEGACY_CONTEXT_WINDOW, input: ['text', 'image'], reasoningEfforts: { low: 'low', medium: 'medium', high: 'high' } }],
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

test('容量判定：旧 256K 视为落后，200K 不落后，未注册不触发', () => {
  assert.equal(tiangongCapacityOutdated({
    models: [{ id: 'GLM-Flash', contextWindow: LEGACY_CONTEXT_WINDOW }],
  }), true, '旧 256K 应判落后')
  assert.equal(tiangongCapacityOutdated({
    models: [{ id: TIANGONG_DEEPSEEK_MODEL_ID, contextWindow: LEGACY_CONTEXT_WINDOW }],
  }), true, 'DeepSeek 条目旧 256K 同样判落后')
  assert.equal(tiangongCapacityOutdated({
    models: [{ id: 'GLM-Flash', contextWindow: TIANGONG_CONTEXT_WINDOW }],
    defaultContextWindow: LEGACY_CONTEXT_WINDOW,
  }), true, 'provider 级默认容量是旧值也判落后')
  assert.equal(tiangongCapacityOutdated({
    models: [
      { id: 'GLM-Flash', contextWindow: TIANGONG_CONTEXT_WINDOW },
      { id: TIANGONG_DEEPSEEK_MODEL_ID, contextWindow: TIANGONG_CONTEXT_WINDOW },
    ],
    defaultContextWindow: TIANGONG_CONTEXT_WINDOW,
  }), false, '已是 200K 不落后')
  assert.equal(tiangongCapacityOutdated({
    models: [{ id: 'GLM-Flash', contextWindow: 150_000 }],
  }), false, '用户手动填写的其它容量不算落后（启动流程不覆盖人工设置）')
  assert.equal(tiangongCapacityOutdated(undefined), false)
  assert.equal(tiangongCapacityOutdated({}), false)
  assert.equal(tiangongCapacityOutdated({ models: [{ id: 'Other', contextWindow: LEGACY_CONTEXT_WINDOW }] }), false, '非天工造梦模型不看容量')
})

test('声明判定：五档但缺 DeepSeek V4.1 Flash 视为落后；完整声明不触发', () => {
  const fiveTierNoDeepseek = {
    models: [{ id: 'GLM-Flash', name: 'GLM-Flash', contextWindow: TIANGONG_CONTEXT_WINDOW, input: ['text', 'image'], reasoningEfforts: { ...TIANGONG_REASONING_EFFORTS } }],
  }
  assert.equal(tiangongEffortsOutdated(fiveTierNoDeepseek), false, '档位判定不看 DeepSeek')
  assert.equal(tiangongDeclarationOutdated(fiveTierNoDeepseek), true, '缺 DeepSeek 条目应判落后')
  assert.equal(tiangongDeclarationOutdated({
    models: [
      { id: 'GLM-Flash', contextWindow: TIANGONG_CONTEXT_WINDOW, reasoningEfforts: { ...TIANGONG_REASONING_EFFORTS } },
      { id: TIANGONG_DEEPSEEK_MODEL_ID, name: TIANGONG_DEEPSEEK_MODEL_ID, contextWindow: TIANGONG_CONTEXT_WINDOW, input: ['text'], reasoningEfforts: { ...TIANGONG_DEEPSEEK_EFFORTS } },
    ],
  }), true, 'DeepSeek 旧声明缺 image（2026-09-27 实测支持看图）应判落后')
  const complete = {
    models: [
      { id: 'GLM-Flash', contextWindow: TIANGONG_CONTEXT_WINDOW, reasoningEfforts: { ...TIANGONG_REASONING_EFFORTS } },
      { id: TIANGONG_DEEPSEEK_MODEL_ID, name: TIANGONG_DEEPSEEK_MODEL_ID, contextWindow: TIANGONG_CONTEXT_WINDOW, input: ['text', 'image'], reasoningEfforts: { ...TIANGONG_DEEPSEEK_EFFORTS } },
      { id: TIANGONG_KIMI_MODEL_ID, name: TIANGONG_KIMI_MODEL_ID, contextWindow: TIANGONG_CONTEXT_WINDOW, input: ['text', 'image'], reasoningEfforts: { ...TIANGONG_KIMI_EFFORTS } },
    ],
  }
  assert.equal(tiangongDeclarationOutdated(complete), false, '完整声明（含 image、200K 容量与 Kimi-K3）不落后')
  // 2026-10-12 新增 Kimi-K3：老账号声明里没有这一条，启动自愈必须判定落后并自动补齐。
  assert.equal(tiangongDeclarationOutdated({ models: complete.models.slice(0, 2) }), true, '缺 Kimi-K3 条目应判落后（老账号自动补齐）')
  assert.equal(tiangongDeclarationOutdated(undefined), false)
  assert.equal(tiangongDeclarationOutdated({}), false)
})

test('启动自愈：五档旧声明缺 DeepSeek 模型时自动补齐（上下文按辉哥定稿 200K）', async () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-devforge-modagentai-'))
  process.env.DSH_HOME = home
  try {
    const fiveTierNoDeepseek = {
      apiKeyEnv: 'MODAGENTAI_GW_API_KEY',
      displayName: '天工造梦',
      api: 'openai-completions',
      baseURL: 'https://modagentai.com/api/gw/v1',
      models: [{ id: 'GLM-Flash', name: 'GLM-Flash', contextWindow: TIANGONG_CONTEXT_WINDOW, input: ['text', 'image'], reasoningEfforts: { ...TIANGONG_REASONING_EFFORTS } }],
    }
    const { service, state } = makeCtx({ tiangong: fiveTierNoDeepseek })
    await service.migrateLegacyGateway()
    const setMutation = state.mutations.find((m) => m.op === 'set' && m.path[1] === 'tiangong')
    assert.ok(setMutation, '应产生 tiangong set 变更')
    const models = (state.providers.tiangong as { models: Array<{ id: string; contextWindow?: number; reasoningEfforts?: Record<string, string> }> }).models
    const deepseek = models.find((m) => m.id === TIANGONG_DEEPSEEK_MODEL_ID)
    assert.ok(deepseek, '应写入 DeepSeek V4.1 Flash 模型条目')
    assert.equal(deepseek.contextWindow, TIANGONG_CONTEXT_WINDOW, '上下文 200000（200K，不声明 1M 也不贴 256K）')
    assert.deepEqual(deepseek.input, ['text', 'image'], 'input 必须带 image（2026-09-27 实测上游支持看图）')
    assert.equal(deepseek.reasoningEfforts?.low, 'low')
    assert.equal(deepseek.reasoningEfforts?.high, 'high')
    assert.equal(deepseek.reasoningEfforts?.max, 'max')
    state.mutations.length = 0
    await service.migrateLegacyGateway()
    assert.equal(state.mutations.length, 0, '第二轮幂等不写入')
  } finally {
    closeAllDb()
    delete process.env.DSH_HOME
    rmSync(home, { recursive: true, force: true })
  }
})

test('启动自愈：声明完整但上下文仍是旧 256K 时自动压到 200K（已安装插件升级即自动校正）', async () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-devforge-modagentai-'))
  process.env.DSH_HOME = home
  try {
    // 0.42.0 及更早版本登录后写入的形态：档位与看图声明都对，只有容量是 256K。
    const legacyCapacity = {
      apiKeyEnv: 'MODAGENTAI_GW_API_KEY',
      displayName: '天工造梦',
      api: 'openai-completions',
      baseURL: 'https://modagentai.com/api/gw/v1',
      models: [
        { id: 'GLM-Flash', name: 'GLM-Flash', contextWindow: LEGACY_CONTEXT_WINDOW, input: ['text', 'image'], reasoningEfforts: { ...TIANGONG_REASONING_EFFORTS } },
        { id: TIANGONG_DEEPSEEK_MODEL_ID, name: TIANGONG_DEEPSEEK_MODEL_ID, contextWindow: LEGACY_CONTEXT_WINDOW, input: ['text', 'image'], reasoningEfforts: { ...TIANGONG_DEEPSEEK_EFFORTS } },
      ],
      defaultContextWindow: LEGACY_CONTEXT_WINDOW,
    }
    const { service, state } = makeCtx({ tiangong: legacyCapacity })
    await service.migrateLegacyGateway()
    const setMutation = state.mutations.find((m) => m.op === 'set' && m.path[1] === 'tiangong')
    assert.ok(setMutation, '旧 256K 声明应触发自愈刷新')
    const written = state.providers.tiangong as { models: Array<{ id: string; contextWindow?: number }>; defaultContextWindow?: number }
    assert.equal(written.defaultContextWindow, TIANGONG_CONTEXT_WINDOW, 'provider 级默认容量同步改写')
    for (const model of written.models) {
      assert.equal(model.contextWindow, TIANGONG_CONTEXT_WINDOW, model.id + ' 上下文应压到 200K')
    }
    state.mutations.length = 0
    await service.migrateLegacyGateway()
    assert.equal(state.mutations.length, 0, '第二轮幂等不写入')
  } finally {
    closeAllDb()
    delete process.env.DSH_HOME
    rmSync(home, { recursive: true, force: true })
  }
})

test('启动自愈：老账号声明（无 Kimi-K3）自动补齐 Kimi-K3 条目', async () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-devforge-modagentai-'))
  process.env.DSH_HOME = home
  try {
    // 2026-10-12 之前登录写入的形态：GLM-Flash 与 DeepSeek V4.1 Flash 都完整，只缺 Kimi-K3。
    const noKimi = {
      apiKeyEnv: 'MODAGENTAI_GW_API_KEY',
      displayName: '天工造梦',
      api: 'openai-completions',
      baseURL: 'https://modagentai.com/api/gw/v1',
      models: [
        { id: 'GLM-Flash', name: 'GLM-Flash', contextWindow: TIANGONG_CONTEXT_WINDOW, input: ['text', 'image'], reasoningEfforts: { ...TIANGONG_REASONING_EFFORTS } },
        { id: TIANGONG_DEEPSEEK_MODEL_ID, name: TIANGONG_DEEPSEEK_MODEL_ID, contextWindow: TIANGONG_CONTEXT_WINDOW, input: ['text', 'image'], reasoningEfforts: { ...TIANGONG_DEEPSEEK_EFFORTS } },
      ],
      defaultContextWindow: TIANGONG_CONTEXT_WINDOW,
    }
    const { service, state } = makeCtx({ tiangong: noKimi })
    await service.migrateLegacyGateway()
    const setMutation = state.mutations.find((m) => m.op === 'set' && m.path[1] === 'tiangong')
    assert.ok(setMutation, '缺 Kimi-K3 应触发自愈刷新（已登录老账号无需重装插件）')
    const models = (state.providers.tiangong as {
      models: Array<{ id: string; contextWindow?: number; input?: string[]; reasoningEfforts?: Record<string, string> }>
    }).models
    const kimi = models.find((m) => m.id === TIANGONG_KIMI_MODEL_ID)
    assert.ok(kimi, '应写入 Kimi-K3 模型条目')
    assert.equal(kimi.contextWindow, TIANGONG_CONTEXT_WINDOW, '上下文按惯例声明 200K')
    assert.deepEqual(kimi.input, ['text', 'image'], 'input 必须带 image')
    assert.equal(kimi.reasoningEfforts?.low, 'low')
    assert.equal(kimi.reasoningEfforts?.high, 'high')
    assert.equal(kimi.reasoningEfforts?.max, 'max')
    state.mutations.length = 0
    await service.migrateLegacyGateway()
    assert.equal(state.mutations.length, 0, '第二轮幂等不写入')
  } finally {
    closeAllDb()
    delete process.env.DSH_HOME
    rmSync(home, { recursive: true, force: true })
  }
})

test('启动自愈：DeepSeek 旧声明缺 image 时自动刷新补齐看图能力', async () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-devforge-modagentai-'))
  process.env.DSH_HOME = home
  try {
    const deepseekTextOnly = {
      apiKeyEnv: 'MODAGENTAI_GW_API_KEY',
      displayName: '天工造梦',
      api: 'openai-completions',
      baseURL: 'https://modagentai.com/api/gw/v1',
      models: [
        { id: 'GLM-Flash', name: 'GLM-Flash', contextWindow: TIANGONG_CONTEXT_WINDOW, input: ['text', 'image'], reasoningEfforts: { ...TIANGONG_REASONING_EFFORTS } },
        { id: TIANGONG_DEEPSEEK_MODEL_ID, name: TIANGONG_DEEPSEEK_MODEL_ID, contextWindow: TIANGONG_CONTEXT_WINDOW, input: ['text'], reasoningEfforts: { ...TIANGONG_DEEPSEEK_EFFORTS } },
      ],
    }
    const { service, state } = makeCtx({ tiangong: deepseekTextOnly })
    await service.migrateLegacyGateway()
    const setMutation = state.mutations.find((m) => m.op === 'set' && m.path[1] === 'tiangong')
    assert.ok(setMutation, '旧声明缺 image 应触发自愈刷新')
    const models = (state.providers.tiangong as { models: Array<{ id: string; input?: string[] }> }).models
    const deepseek = models.find((m) => m.id === TIANGONG_DEEPSEEK_MODEL_ID)
    assert.ok(deepseek, '刷新后 DeepSeek 条目仍在')
    assert.deepEqual(deepseek.input, ['text', 'image'], '刷新后 input 应补齐 image')
    state.mutations.length = 0
    await service.migrateLegacyGateway()
    assert.equal(state.mutations.length, 0, '第二轮幂等不写入')
  } finally {
    closeAllDb()
    delete process.env.DSH_HOME
    rmSync(home, { recursive: true, force: true })
  }
})

test('启动自愈：声明已是 200K 完整版时不写入（升级过的安装不被反复改写）', async () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-devforge-modagentai-'))
  process.env.DSH_HOME = home
  try {
    const current = {
      apiKeyEnv: 'MODAGENTAI_GW_API_KEY',
      displayName: '天工造梦',
      api: 'anthropic-messages',
      baseURL: 'https://modagentai.com/api/gw',
      models: [
        { id: 'GLM-Flash', name: 'GLM-Flash', contextWindow: TIANGONG_CONTEXT_WINDOW, input: ['text', 'image'], reasoningEfforts: { ...TIANGONG_REASONING_EFFORTS } },
        { id: TIANGONG_DEEPSEEK_MODEL_ID, name: TIANGONG_DEEPSEEK_MODEL_ID, contextWindow: TIANGONG_CONTEXT_WINDOW, input: ['text', 'image'], reasoningEfforts: { ...TIANGONG_DEEPSEEK_EFFORTS } },
        { id: TIANGONG_KIMI_MODEL_ID, name: TIANGONG_KIMI_MODEL_ID, contextWindow: TIANGONG_CONTEXT_WINDOW, input: ['text', 'image'], reasoningEfforts: { ...TIANGONG_KIMI_EFFORTS } },
      ],
      defaultContextWindow: TIANGONG_CONTEXT_WINDOW,
    }
    const { service, state } = makeCtx({ tiangong: current })
    await service.migrateLegacyGateway()
    assert.equal(state.mutations.length, 0, '已是新版声明不应产生任何写入')
  } finally {
    closeAllDb()
    delete process.env.DSH_HOME
    rmSync(home, { recursive: true, force: true })
  }
})

test('协议判定：旧 OpenAI 组合判落后，anthropic 新组合不落后，第三方端点不覆盖', () => {
  assert.equal(tiangongProtocolOutdated(LEGACY_TIANGONG), true, '旧组合（openai-completions + /api/gw/v1）应判落后')
  assert.equal(tiangongProtocolOutdated({
    api: 'anthropic-messages',
    baseURL: 'https://modagentai.com/api/gw',
  }), false, '已是 anthropic-messages 新组合不落后')
  assert.equal(tiangongProtocolOutdated({
    api: 'openai-completions',
    baseURL: 'https://relay.example.com/v1',
  }), false, '第三方端点不被启动自愈覆盖')
  assert.equal(tiangongProtocolOutdated(undefined), false)
  assert.equal(tiangongProtocolOutdated({ api: 'openai-completions' }), false, '缺 baseURL 时不判定')
})

test('启动自愈：旧 OpenAI 兼容声明自动改写为 Anthropic Messages 协议', async () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-devforge-modagentai-'))
  process.env.DSH_HOME = home
  try {
    const legacyOpenAi = {
      apiKeyEnv: 'MODAGENTAI_GW_API_KEY',
      displayName: '天工造梦',
      api: 'openai-completions',
      baseURL: 'https://modagentai.com/api/gw/v1',
      models: [
        { id: 'GLM-Flash', name: 'GLM-Flash', contextWindow: TIANGONG_CONTEXT_WINDOW, input: ['text', 'image'], reasoningEfforts: { ...TIANGONG_REASONING_EFFORTS } },
        { id: TIANGONG_DEEPSEEK_MODEL_ID, name: TIANGONG_DEEPSEEK_MODEL_ID, contextWindow: TIANGONG_CONTEXT_WINDOW, input: ['text', 'image'], reasoningEfforts: { ...TIANGONG_DEEPSEEK_EFFORTS } },
        { id: TIANGONG_KIMI_MODEL_ID, name: TIANGONG_KIMI_MODEL_ID, contextWindow: TIANGONG_CONTEXT_WINDOW, input: ['text', 'image'], reasoningEfforts: { ...TIANGONG_KIMI_EFFORTS } },
      ],
      defaultContextWindow: TIANGONG_CONTEXT_WINDOW,
    }
    const { service, state } = makeCtx({ tiangong: legacyOpenAi })
    await service.migrateLegacyGateway()
    const written = state.providers.tiangong as { api?: string; baseURL?: string; streamIdleTimeoutMs?: number }
    assert.equal(written.api, 'anthropic-messages', '协议改写为 Anthropic Messages')
    assert.equal(written.baseURL, 'https://modagentai.com/api/gw', 'baseURL 去掉 /v1（适配器自拼 /v1/messages）')
    assert.equal(written.streamIdleTimeoutMs, 600_000, 'Anthropic 通道放宽流空闲超时')
    state.mutations.length = 0
    await service.migrateLegacyGateway()
    assert.equal(state.mutations.length, 0, '第二轮幂等不写入')
  } finally {
    closeAllDb()
    delete process.env.DSH_HOME
    rmSync(home, { recursive: true, force: true })
  }
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

// —— 站点模型目录同步（辉哥 2026-10-12 定稿：已登录账号自动同步官方模型）——
// 站点 GET /api/gw/model-catalog 下发当前开放的模型与能力；插件启动/登录时拉一次，
// 官网新增或调整模型只需改站点配置，不必再改插件发新版。

/** 站点目录响应样例（形态与站点 model-catalog.bll 的 { ok, data: { models } } 一致）。 */
function catalogPayload(models: Array<Record<string, unknown>>): unknown {
  return { ok: true, data: { models } }
}

test('站点目录解析：结构异常一律返回空数组（回退内置清单）', () => {
  assert.deepEqual(parseTiangongCatalog(undefined), [])
  assert.deepEqual(parseTiangongCatalog(null), [])
  assert.deepEqual(parseTiangongCatalog({}), [])
  assert.deepEqual(parseTiangongCatalog({ data: {} }), [])
  assert.deepEqual(parseTiangongCatalog({ data: { models: 'nope' } }), [])
  assert.deepEqual(parseTiangongCatalog({ data: { models: [null, 1, 'x'] } }), [])
  assert.deepEqual(parseTiangongCatalog({ data: { models: [{ id: '   ' }] } }), [], '空 id 丢弃')
})

test('站点目录解析：缺字段逐项兜底，重复 id 只留首条', () => {
  const entries = parseTiangongCatalog(catalogPayload([
    { id: 'A' },
    { id: 'B', contextWindow: 0, input: [], reasoningEfforts: [] },
    { id: 'A', contextWindow: 999 },
  ]))
  assert.deepEqual(entries.map((e) => e.id), ['A', 'B'], '重复 id 只保留首条')
  assert.equal(entries[0]?.contextWindow, TIANGONG_CONTEXT_WINDOW, '窗口缺失回退 200K')
  assert.deepEqual(entries[0]?.input, ['text', 'image'], 'input 缺失回退 text+image')
  assert.deepEqual(entries[0]?.reasoningEfforts, ['low', 'high', 'max'], '档位缺失回退三档')
  assert.equal(entries[1]?.contextWindow, TIANGONG_CONTEXT_WINDOW, '非正数窗口回退 200K')
})

test('目录判定：站点新增模型或缺能力判落后，完全一致不落后', () => {
  const provider = {
    models: [{ id: 'GLM-Flash', contextWindow: TIANGONG_CONTEXT_WINDOW, input: ['text', 'image'], reasoningEfforts: { ...TIANGONG_REASONING_EFFORTS } }],
  }
  const entry = (over: Record<string, unknown> = {}) => parseTiangongCatalog(catalogPayload([{
    id: 'GLM-Flash', contextWindow: TIANGONG_CONTEXT_WINDOW, input: ['text', 'image'], reasoningEfforts: ['low', 'high', 'max'], ...over,
  }]))[0]!
  assert.equal(tiangongCatalogOutdated(provider, [entry()]), false, '站点与声明能力一致不落后')
  assert.equal(tiangongCatalogOutdated(provider, [entry({ contextWindow: 128_000 })]), true, '站点调整窗口判落后')
  assert.equal(tiangongCatalogOutdated(provider, [entry({ reasoningEfforts: ['low', 'high', 'max', 'ultra'] })]), true, '站点出现声明里没有的档位判落后')
  assert.equal(tiangongCatalogOutdated(provider, [entry({ input: ['text'] })]), false, '站点放宽要求（不再要求 image）不判落后')
  assert.equal(tiangongCatalogOutdated(provider, parseTiangongCatalog(catalogPayload([{ id: 'Future-Model' }]))), true, '站点新增模型判落后')
  assert.equal(tiangongCatalogOutdated(provider, []), false, '目录为空交给内置判定')
  assert.equal(tiangongCatalogOutdated(undefined, [entry()]), false, '未注册 provider 不判定')
})

test('模型清单组装：站点能力优先，站点未下发的内置模型补齐', () => {
  const models = buildTiangongModels(parseTiangongCatalog(catalogPayload([
    { id: 'GLM-Flash', contextWindow: 128_000, input: ['text'], reasoningEfforts: ['low', 'high'] },
  ])), [
    { id: 'GLM-Flash', name: 'GLM-Flash', contextWindow: TIANGONG_CONTEXT_WINDOW },
    { id: TIANGONG_KIMI_MODEL_ID, name: TIANGONG_KIMI_MODEL_ID, contextWindow: TIANGONG_CONTEXT_WINDOW },
  ])
  assert.deepEqual(models.map((m) => m.id), ['GLM-Flash', TIANGONG_KIMI_MODEL_ID])
  assert.equal(models[0]?.contextWindow, 128_000, '站点下发的窗口优先于内置值')
  assert.deepEqual(models[0]?.input, ['text'])
  assert.deepEqual(models[0]?.reasoningEfforts, { low: 'low', high: 'high' }, '档位数组转 DSH Record 形态')
  assert.equal(models[1]?.contextWindow, TIANGONG_CONTEXT_WINDOW, '站点未下发的内置模型按内置补齐')
})

test('fetchOfficialCatalog：令牌为空不发请求，非 2xx 与异常都返回空数组', async () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-devforge-modagentai-'))
  process.env.DSH_HOME = home
  try {
    const { service } = makeCtx({}, { token: '' })
    // 恢复真实实现：makeCtx 默认把该方法打桩为「离线」
    service.fetchOfficialCatalog = ModagentaiService.prototype.fetchOfficialCatalog.bind(service)
    const stub = stubFetch(() => new Response('{}', { status: 200 }))
    stub.install()
    try {
      assert.deepEqual(await service.fetchOfficialCatalog(), [], '无令牌返回空数组')
      assert.equal(stub.calls.length, 0, '未登录不应打官网')
      const { service: logged } = makeCtx({})
      logged.fetchOfficialCatalog = ModagentaiService.prototype.fetchOfficialCatalog.bind(logged)
      assert.deepEqual(await logged.fetchOfficialCatalog(), [], '空 body 结构不符 → 空数组')
      assert.equal(stub.calls.length, 1)
      assert.equal(stub.calls[0]?.url, 'https://modagentai.com/api/gw/model-catalog')
      const headers = stub.calls[0]?.init?.headers as Record<string, string>
      assert.equal(headers.authorization, 'Bearer session-token', '复用会话令牌鉴权')
    } finally {
      stub.restore()
    }
    const unauthorized = stubFetch(() => new Response('unauthorized', { status: 401 }))
    unauthorized.install()
    try {
      const { service: s } = makeCtx({})
      s.fetchOfficialCatalog = ModagentaiService.prototype.fetchOfficialCatalog.bind(s)
      assert.deepEqual(await s.fetchOfficialCatalog(), [], '401 返回空数组')
    } finally {
      unauthorized.restore()
    }
    const boom = stubFetch(() => { throw new Error('network down') })
    boom.install()
    try {
      const { service: s } = makeCtx({})
      s.fetchOfficialCatalog = ModagentaiService.prototype.fetchOfficialCatalog.bind(s)
      assert.deepEqual(await s.fetchOfficialCatalog(), [], '网络异常返回空数组，不抛出')
    } finally {
      boom.restore()
    }
  } finally {
    closeAllDb()
    delete process.env.DSH_HOME
    rmSync(home, { recursive: true, force: true })
  }
})

test('启动自愈：官网目录新增模型时自动写入（站点能力优先，老账号免重登）', async () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-devforge-modagentai-'))
  process.env.DSH_HOME = home
  try {
    // 老账号现状：三个内置模型、能力齐备，与新目录的差别只有「官网多了一个新模型」
    const complete = {
      apiKeyEnv: 'MODAGENTAI_GW_API_KEY',
      displayName: '天工造梦',
      api: 'openai-completions',
      baseURL: 'https://modagentai.com/api/gw/v1',
      models: [
        { id: 'GLM-Flash', name: 'GLM-Flash', contextWindow: TIANGONG_CONTEXT_WINDOW, input: ['text', 'image'], reasoningEfforts: { ...TIANGONG_REASONING_EFFORTS } },
        { id: TIANGONG_DEEPSEEK_MODEL_ID, name: TIANGONG_DEEPSEEK_MODEL_ID, contextWindow: TIANGONG_CONTEXT_WINDOW, input: ['text', 'image'], reasoningEfforts: { ...TIANGONG_DEEPSEEK_EFFORTS } },
        { id: TIANGONG_KIMI_MODEL_ID, name: TIANGONG_KIMI_MODEL_ID, contextWindow: TIANGONG_CONTEXT_WINDOW, input: ['text', 'image'], reasoningEfforts: { ...TIANGONG_KIMI_EFFORTS } },
      ],
      defaultContextWindow: TIANGONG_CONTEXT_WINDOW,
    }
    const { service, state } = makeCtx({ tiangong: complete }, {
      catalog: catalogPayload([
        { id: 'GLM-Flash', contextWindow: TIANGONG_CONTEXT_WINDOW, input: ['text', 'image'], reasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'] },
        { id: TIANGONG_DEEPSEEK_MODEL_ID, contextWindow: TIANGONG_CONTEXT_WINDOW, input: ['text', 'image'], reasoningEfforts: ['low', 'high', 'max'] },
        { id: TIANGONG_KIMI_MODEL_ID, contextWindow: TIANGONG_CONTEXT_WINDOW, input: ['text', 'image'], reasoningEfforts: ['low', 'high', 'max'] },
        { id: 'Future-Model', contextWindow: 500_000, input: ['text'], reasoningEfforts: ['low', 'max'] },
      ]),
    })
    await service.migrateLegacyGateway()
    assert.ok(state.mutations.some((m) => m.op === 'set' && m.path[1] === 'tiangong'), '站点新增模型应触发声明写入')
    const models = (state.providers.tiangong as { models: Array<Record<string, unknown>> }).models
    assert.deepEqual(models.map((m) => m.id), ['GLM-Flash', TIANGONG_DEEPSEEK_MODEL_ID, TIANGONG_KIMI_MODEL_ID, 'Future-Model'], '官网新模型自动补进声明末尾')
    const future = models.find((m) => m.id === 'Future-Model')
    assert.equal(future?.contextWindow, 500_000, '新模型能力直接来自站点')
    assert.deepEqual(future?.reasoningEfforts, { low: 'low', max: 'max' })
    state.mutations.length = 0
    await service.migrateLegacyGateway()
    assert.equal(state.mutations.length, 0, '第二轮幂等不写入')
  } finally {
    closeAllDb()
    delete process.env.DSH_HOME
    rmSync(home, { recursive: true, force: true })
  }
})

test('启动自愈：站点不可达时退化为内置三模型声明（离线兜底）', async () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-devforge-modagentai-'))
  process.env.DSH_HOME = home
  try {
    // makeCtx 默认把目录拉取打桩为空数组，等价于「未登录或官网不可达」；
    // 给一份历史旧声明（只有 GLM-Flash 且是 256K），验证离线时也按内置清单补齐。
    const { service, state } = makeCtx({ tiangong: LEGACY_TIANGONG })
    await service.migrateLegacyGateway()
    assert.ok(state.mutations.some((m) => m.op === 'set' && m.path[1] === 'tiangong'), '旧声明在离线时也应被内置清单纠正')
    const models = (state.providers.tiangong as { models: Array<Record<string, unknown>> }).models
    assert.deepEqual(models.map((m) => m.id), ['GLM-Flash', TIANGONG_DEEPSEEK_MODEL_ID, TIANGONG_KIMI_MODEL_ID], '离线仍声明三个官方模型')
    assert.equal(models[1]?.contextWindow, TIANGONG_CONTEXT_WINDOW)
    assert.deepEqual(models[2]?.input, ['text', 'image'])
  } finally {
    closeAllDb()
    delete process.env.DSH_HOME
    rmSync(home, { recursive: true, force: true })
  }
})

test('官网生图目录：解析 data.images，去空去重，结构异常一律空数组', () => {
  assert.deepEqual(parseTiangongCatalogImages(undefined), [])
  assert.deepEqual(parseTiangongCatalogImages(null), [])
  assert.deepEqual(parseTiangongCatalogImages({}), [])
  assert.deepEqual(parseTiangongCatalogImages({ data: {} }), [])
  assert.deepEqual(parseTiangongCatalogImages({ data: { images: 'nope' } }), [])
  assert.deepEqual(parseTiangongCatalogImages({ data: { images: [null, 1, '  '] } }), [])
  assert.deepEqual(
    parseTiangongCatalogImages({ data: { images: ['gpt-image-2', ' gpt-image-2 ', 'gpt-image-3'] } }),
    ['gpt-image-2', 'gpt-image-3'],
    '重复与空白项规整后只留一份',
  )
})

test('官网生图线路：登录（applyGateway）即接入，模型取站点目录 data.images 首项', async () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-devforge-modagentai-'))
  process.env.DSH_HOME = home
  try {
    const { service, siteImage } = makeCtx({}, { images: ['gpt-image-2', 'gpt-image-3'] })
    await service.applyGateway()
    assert.equal(siteImage.enabled, true, '登录即开启官网生图线路')
    assert.equal(siteImage.model, 'gpt-image-2', '生图模型取站点下发的首个图像模型')
  } finally {
    closeAllDb()
    delete process.env.DSH_HOME
    rmSync(home, { recursive: true, force: true })
  }
})

test('官网生图线路：站点未下发图像模型时保留原模型，未登录手动同步抛 401', async () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-devforge-modagentai-'))
  process.env.DSH_HOME = home
  try {
    // 站点目录没有 images 字段（旧版官网）：开启线路但不写空模型名。
    const { service, siteImage } = makeCtx({})
    const applied = await service.applySiteImage()
    assert.equal(applied.enabled, true)
    assert.equal(applied.model, '', '未下发时模型为空串，由面板提示尚未同步')

    // 未登录（令牌为空）时手动同步必须 401，且不写入任何线路配置。
    const offline = makeCtx({}, { token: '' })
    await assert.rejects(
      () => offline.service.applySiteImage(),
      (error: unknown) => error instanceof ModagentaiServiceError && error.status === 401,
    )
  } finally {
    closeAllDb()
    delete process.env.DSH_HOME
    rmSync(home, { recursive: true, force: true })
  }
})

test('官网生图线路：登出后停用（保留模型名，重新登录自动恢复）', async () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-devforge-modagentai-'))
  process.env.DSH_HOME = home
  // logout 会尽力通知官网吊销会话；此处打桩 fetch，避免单测联网。
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async () => new Response(JSON.stringify({ ok: true }), { status: 200 })) as typeof fetch
  try {
    const { service, siteImage } = makeCtx({}, { images: ['gpt-image-2'] })
    await service.applyGateway()
    assert.equal(siteImage.enabled, true)
    await service.logout()
    assert.equal(siteImage.enabled, false, '登出即停用官网生图线路')
    assert.equal(siteImage.model, 'gpt-image-2', '模型名保留，重新登录无需再同步')
  } finally {
    globalThis.fetch = originalFetch
    closeAllDb()
    delete process.env.DSH_HOME
    rmSync(home, { recursive: true, force: true })
  }
})
