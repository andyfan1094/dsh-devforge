/** 智谱官方 API 直调（开放平台）：Provider 合并、启动补齐与 Key 验证保存的无污染单测。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listCredentialRefs } from '../src/credentials-writer.ts'
import { ZhipuCodingPlanService, mergeZhipuOfficialProvider, ZHIPU_OFFICIAL_DEFAULT_MODELS, ZhipuServiceError } from '../src/zhipu/service.ts'
import { ZHIPU_OFFICIAL_BASE_URL, ZHIPU_OFFICIAL_PROVIDER_ID } from '../src/zhipu/protocol.ts'

/** 官方能力测试用的最小配置。 */
function officialConfig(): { enabled: boolean; apiKeyEnv: string; timeoutMs: number; mcpTools: boolean } {
  return { enabled: true, apiKeyEnv: 'ZAI_CODING_CN_API_KEY', timeoutMs: 15_000, mcpTools: false }
}

/** 假 ctx 的最小形状：只覆盖官方能力用到的 settings/credentials，永不触网。 */
interface StubCtx {
  settings: {
    describe: () => Array<{ ns: string; revision: number; value: unknown }>
    mutate: (ns: unknown, ops: Array<{ op: string; path: string[]; value: unknown }>) => Promise<void>
    get: () => unknown
  }
  credentials: {
    describe: () => Promise<{ configured: boolean; writable: boolean }>
    resolve: () => Promise<{ value: string } | undefined>
  }
}

/** 构造假 ctx；onMutate 用于观察写入次数，resolve 可注入已配置凭据。 */
function makeStubCtx(options: { onMutate?: () => void; resolveValue?: string } = {}): StubCtx {
  const stored: { providers: Record<string, unknown> } = { providers: {} }
  return {
    settings: {
      describe: () => [{ ns: 'llm-pi-ai', revision: 1, value: stored }],
      mutate: async (_ns: unknown, ops: Array<{ value: unknown }>) => {
        options.onMutate?.()
        stored.providers[ZHIPU_OFFICIAL_PROVIDER_ID] = ops[0]?.value
      },
      get: () => stored,
    },
    credentials: {
      describe: async () => ({ configured: false, writable: true }),
      resolve: async () => options.resolveValue === undefined ? undefined : { value: options.resolveValue },
    },
  }
}

/** 在独立临时 HOME 内执行用例：受管凭据与 store.db 全部落进临时目录，互不污染。 */
async function withTempHome(run: (home: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-devforge-zhipu-official-'))
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = dir
  try {
    await run(dir)
  } finally {
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    await rm(dir, { recursive: true, force: true })
  }
}

/** 临时替换全局 fetch，用例结束恢复。 */
async function withFetchStub(stub: typeof fetch, run: () => Promise<void>): Promise<void> {
  const original = globalThis.fetch
  globalThis.fetch = stub
  try {
    await run()
  } finally {
    globalThis.fetch = original
  }
}

test('官方 Provider 合并：固定开放平台端点并补默认模型', () => {
  const merged = mergeZhipuOfficialProvider(undefined, 'ZHIPU_OFFICIAL_API_KEY')
  assert.equal(merged.apiKeyEnv, 'ZHIPU_OFFICIAL_API_KEY')
  assert.equal(merged.baseURL, ZHIPU_OFFICIAL_BASE_URL)
  assert.equal(merged.api, 'openai-completions')
  assert.equal(merged.displayName, '智谱开放平台')
  const ids = (merged.models as Array<{ id: string }>).map((model) => model.id)
  assert.deepEqual(ids, ZHIPU_OFFICIAL_DEFAULT_MODELS.map((model) => model.id))
})

test('官方 Provider 合并：保留用户字段、强制官方端点且不重复加模型', () => {
  const merged = mergeZhipuOfficialProvider({
    displayName: '我的智谱',
    apiKeyEnv: 'MY_ZHIPU_KEY',
    // 用户误填第三方地址：合并必须强制回官方端点，防止 Key 外流。
    baseURL: 'https://evil.example.com',
    models: [{ id: 'glm-5.3-flash', name: '自定义' }, { id: 'custom-model', name: 'Custom' }],
  }, 'ZHIPU_OFFICIAL_API_KEY')
  assert.equal(merged.displayName, '我的智谱')
  assert.equal(merged.apiKeyEnv, 'MY_ZHIPU_KEY')
  assert.equal(merged.baseURL, ZHIPU_OFFICIAL_BASE_URL)
  const ids = (merged.models as Array<{ id: string }>).map((model) => model.id)
  assert.equal(ids.filter((id) => id === 'glm-5.3-flash').length, 1, '已有模型不应重复补入')
  assert.deepEqual(ids, ['glm-5.3-flash', 'custom-model'])
})

test('官方 ensureOfficialModels：缺失时补写一次，重复调用跳过写入', async () => {
  let mutations = 0
  const ctx = makeStubCtx({ onMutate: () => { mutations += 1 } })
  const service = new ZhipuCodingPlanService(ctx as never, officialConfig(), {} as never)
  const status = await service.ensureOfficialModels()
  assert.equal(mutations, 1, '缺失 provider 时应补写一次')
  assert.equal(status.providerConfigured, true)
  assert.equal(status.baseURL, ZHIPU_OFFICIAL_BASE_URL)
  await service.ensureOfficialModels()
  assert.equal(mutations, 1, '模型已是最新时不应再写入')
})

test('官方 Key 保存：401 视为无效且不落盘', async () => {
  await withTempHome(async () => {
    await withFetchStub((async () => new Response('unauthorized', { status: 401 })) as typeof fetch, async () => {
      const service = new ZhipuCodingPlanService(makeStubCtx() as never, officialConfig(), {} as never)
      await assert.rejects(service.saveOfficialKey({ value: 'bad-key' }), (error: unknown) => {
        assert.ok(error instanceof ZhipuServiceError)
        assert.equal((error as ZhipuServiceError).status, 401)
        return true
      })
      assert.deepEqual(await listCredentialRefs(), [], '验证失败的 Key 不允许写入受管凭据')
    })
  })
})

test('官方 Key 保存：验证通过后写入受管凭据', async () => {
  await withTempHome(async (home) => {
    await withFetchStub((async () => new Response(
      JSON.stringify({ data: [{ id: 'glm-5.3-flash' }, { id: 'glm-5.2' }] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )) as typeof fetch, async () => {
      const service = new ZhipuCodingPlanService(makeStubCtx() as never, officialConfig(), {} as never)
      const status = await service.saveOfficialKey({ value: 'good-key' })
      assert.equal(status.credentialEnv, 'ZHIPU_OFFICIAL_API_KEY')
      assert.ok((await listCredentialRefs()).includes('ZHIPU_OFFICIAL_API_KEY'), '验证通过后应写入受管凭据')
      const raw = await readFile(join(home, '.credentials.yaml'), 'utf8')
      assert.match(raw, /ZHIPU_OFFICIAL_API_KEY: good-key/)
    })
  })
})

test('官方拉取模型：未配置 Key 时给出可读错误', async () => {
  const service = new ZhipuCodingPlanService(makeStubCtx() as never, officialConfig(), {} as never)
  await assert.rejects(service.fetchOfficialModels(), /尚未配置官方 API Key/)
})
