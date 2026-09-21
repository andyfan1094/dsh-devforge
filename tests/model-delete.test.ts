/**
 * 模型删除（墓碑式）与方舟 Coding Plan 数据面的后端行为测试。
 *
 * 运行方式：node --experimental-strip-types --test tests/model-delete.test.ts
 * 隔离手段：每个用例把 DSH_HOME 指向独立临时目录，store.db（deleted-models 墓碑域）
 * 完全隔离；结束统一 closeAllDb 释放句柄（Windows 下不关库删不掉目录）。
 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, beforeEach, test } from 'node:test'
import { SettingsConflictError } from '@deepseek-ai/dsh-settings'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { Context } from '@deepseek-ai/cordis'
import { closeAllDb, getDb } from '../src/store/db.ts'
import { addDeletedModels, listDeletedModels } from '../src/model-tombstones.ts'
import { settingsNamespace } from '../src/settings-compat.ts'
import { MINIMAX_MODELS, MINIMAX_PROVIDER_ID, MiniMaxService, MiniMaxServiceError } from '../src/minimax/service.ts'
import { ArkCodingPlanService, ArkServiceError, mergeArkCodingProvider } from '../src/ark/service.ts'
import { ARK_CODING_BASE_URL, ARK_CODING_DEFAULT_MODELS, ARK_CODING_PROVIDER_ID } from '../src/ark/protocol.ts'
import { OpenAiGatewayService } from '../src/openai/service.ts'

// ------------------------------------------------ fake 宿主环境

type Section = Record<string, unknown>

/** 按 mutate 的 path op 更新假 settings（set 建缺失层级，unset 删除叶子）。 */
function applyOps(section: Section, ops: Array<{ op: string; path: string[]; value?: unknown }>): void {
  for (const op of ops) {
    let node: Section = section
    for (const key of op.path.slice(0, -1)) {
      const child = node[key]
      if (child === null || typeof child !== 'object') node[key] = {}
      node = node[key] as Section
    }
    const leaf = op.path[op.path.length - 1] as string
    if (op.op === 'set') node[leaf] = op.value
    else delete node[leaf]
  }
}

/** 假 settings：get/describe/mutate 三件套，revision 冲突抛 SettingsConflictError。 */
function makeFakeSettings(initial: Record<string, Section>) {
  const state = new Map<string, { value: Section; revision: number }>()
  for (const [ns, value] of Object.entries(initial)) state.set(ns, { value: structuredClone(value), revision: 1 })
  return {
    get(ns: string): unknown {
      return state.get(ns)?.value
    },
    describe(): Array<{ ns: string; value: unknown; revision: number }> {
      return [...state.entries()].map(([ns, item]) => ({ ns, value: item.value, revision: item.revision }))
    },
    async mutate(ns: string, ops: Array<{ op: string; path: string[]; value?: unknown }>, expectedRevision: number): Promise<void> {
      const item = state.get(ns)
      if (item === undefined || item.revision !== expectedRevision) {
        throw new SettingsConflictError(settingsNamespace(ns), expectedRevision, item?.revision ?? -1)
      }
      applyOps(item.value, ops)
      item.revision += 1
    },
  }
}

/** 假凭据服务：describe/resolve 按 env 名存取，writable 恒 true。 */
function makeFakeCredentials(values: Record<string, string>) {
  const store = new Map(Object.entries(values))
  return {
    async resolve(ref: string): Promise<{ value: string; source: string } | undefined> {
      const value = store.get(String(ref))
      return value === undefined ? undefined : { value, source: 'test' }
    },
    async describe(ref: string): Promise<{ configured: boolean; writable: boolean }> {
      return { configured: store.has(String(ref)), writable: true }
    },
  }
}

/** 组装 services 需要的最小 Context 形状（真实调用只触达 settings/credentials/logger）。 */
function makeContext(options: { settings?: Record<string, Section>; credentials?: Record<string, string> } = {}): Context {
  return {
    settings: makeFakeSettings(options.settings ?? {}),
    credentials: makeFakeCredentials(options.credentials ?? {}),
    logger: { warn: () => {} },
  } as unknown as Context
}

/** 构造一个 llm-pi-ai providers 小节。 */
function providerSection(providers: Record<string, Section>): Record<string, Section> {
  return { [settingsNamespaceKey()]: { providers } }
}
function settingsNamespaceKey(): string {
  return 'llm-pi-ai'
}

// ------------------------------------------------ DSH_HOME 隔离

const tempDirs: string[] = []

beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), 'devforge-model-delete-'))
  tempDirs.push(dir)
  process.env.DSH_HOME = dir
})

after(() => {
  closeAllDb()
  delete process.env.DSH_HOME
  for (const dir of tempDirs) {
    try { rmSync(dir, { recursive: true, force: true }) } catch { /* Windows 句柄延迟释放时忽略 */ }
  }
})

// ------------------------------------------------ MiniMax：墓碑式删除主链路

function makeMiniMaxService(providers: Record<string, Section>, extraSettings: Record<string, Section> = {}): MiniMaxService {
  return new MiniMaxService(
    makeContext({
      settings: { ...providerSection(providers), ...extraSettings },
      credentials: { MINIMAX_CN_API_KEY: 'test-key' },
    }),
    { enabled: true, apiKeyEnv: 'MINIMAX_CN_API_KEY', timeoutMs: 1000, tools: false },
  )
}

test('MiniMax 批量删除按 id 过滤生效并写入墓碑（trim + 去重）', async () => {
  const service = makeMiniMaxService({
    'minimax-cn': { apiKeyEnv: 'MINIMAX_CN_API_KEY', models: [{ id: 'MiniMax-M3' }, { id: 'MiniMax-M2.7' }, { id: 'MiniMax-M2.5' }] },
  })
  const status = await service.deleteModels([' MiniMax-M2.7 ', 'MiniMax-M2.5', 'MiniMax-M2.7'])
  assert.deepEqual(status.models.map((model) => model.id), ['MiniMax-M3'])
  assert.deepEqual(listDeletedModels(getDb(), MINIMAX_PROVIDER_ID).sort(), ['MiniMax-M2.5', 'MiniMax-M2.7'])
})

test('删空被保留保护拒绝且不落任何墓碑', async () => {
  const service = makeMiniMaxService({
    'minimax-cn': { apiKeyEnv: 'MINIMAX_CN_API_KEY', models: [{ id: 'MiniMax-M3' }, { id: 'MiniMax-M2.7' }] },
  })
  await assert.rejects(
    () => service.deleteModels(['MiniMax-M3', 'MiniMax-M2.7']),
    (error: unknown) => {
      assert.ok(error instanceof MiniMaxServiceError)
      assert.equal((error as MiniMaxServiceError).status, 400)
      assert.equal((error as Error).message, '至少保留一个模型')
      return true
    },
  )
  assert.deepEqual(listDeletedModels(getDb(), MINIMAX_PROVIDER_ID), [])
})

test('主脑路由工人模型命中待删 id 且 provider 匹配时拒绝删除', async () => {
  const service = makeMiniMaxService(
    { 'minimax-cn': { apiKeyEnv: 'MINIMAX_CN_API_KEY', models: [{ id: 'MiniMax-M3' }, { id: 'MiniMax-M2.7' }] } },
    { 'brain-router': { enabled: true, workerProvider: 'minimax-cn', workerModel: 'MiniMax-M3' } },
  )
  await assert.rejects(
    () => service.deleteModels(['MiniMax-M3']),
    (error: unknown) => {
      assert.ok(error instanceof MiniMaxServiceError)
      assert.equal((error as MiniMaxServiceError).status, 400)
      assert.equal((error as Error).message, '模型正被主脑路由的工人模型引用，请先在主脑路由页签更换工人模型')
      return true
    },
  )
})

test('工人 provider 不匹配或总开关关闭时不拦截删除', async () => {
  // workerProvider 指向别家 provider：不拦截。
  const mismatch = makeMiniMaxService(
    { 'minimax-cn': { apiKeyEnv: 'MINIMAX_CN_API_KEY', models: [{ id: 'MiniMax-M3' }, { id: 'MiniMax-M2.7' }] } },
    { 'brain-router': { enabled: true, workerProvider: 'zai-coding-cn', workerModel: 'MiniMax-M3' } },
  )
  const status = await mismatch.deleteModels(['MiniMax-M3'])
  assert.deepEqual(status.models.map((model) => model.id), ['MiniMax-M2.7'])
  // enabled=false：路由整体不生效，不拦截。
  const disabled = makeMiniMaxService(
    { 'minimax-cn': { apiKeyEnv: 'MINIMAX_CN_API_KEY', models: [{ id: 'MiniMax-M3' }, { id: 'MiniMax-M2.7' }] } },
    { 'brain-router': { enabled: false, workerProvider: 'minimax-cn', workerModel: 'MiniMax-M3' } },
  )
  const statusDisabled = await disabled.deleteModels(['MiniMax-M3'])
  assert.deepEqual(statusDisabled.models.map((model) => model.id), ['MiniMax-M2.7'])
})

test('启动自动补齐跳过墓碑模型，restore 全量恢复并清墓碑', async () => {
  const service = makeMiniMaxService({
    'minimax-cn': { apiKeyEnv: 'MINIMAX_CN_API_KEY', models: [{ id: 'MiniMax-M3' }, { id: 'MiniMax-M2.5' }] },
  })
  await service.deleteModels(['MiniMax-M2.5'])

  // 启动自动补齐（restore=false）：其余默认模型补齐，被删的 M2.5 不复活。
  const autoStatus = await service.ensureModels()
  const autoIds = autoStatus.models.map((model) => model.id)
  assert.ok(autoIds.includes('MiniMax-M3'), '未删除的模型保留')
  assert.ok(!autoIds.includes('MiniMax-M2.5'), '墓碑模型不得在启动补齐中复活')
  assert.ok(autoIds.length >= MINIMAX_MODELS.length - 1, '其余默认模型已补齐')
  assert.deepEqual(listDeletedModels(getDb(), MINIMAX_PROVIDER_ID), ['MiniMax-M2.5'])

  // 面板手动补齐（restore=true）：全量恢复 + 清墓碑。
  const restored = await service.ensureModels(true)
  assert.ok(restored.models.map((model) => model.id).includes('MiniMax-M2.5'), 'restore 恢复被删模型')
  assert.deepEqual(listDeletedModels(getDb(), MINIMAX_PROVIDER_ID), [], '恢复成功后墓碑清除')
})

test('ids 形状非法抛 400「ids 不能为空」', async () => {
  const service = makeMiniMaxService({
    'minimax-cn': { apiKeyEnv: 'MINIMAX_CN_API_KEY', models: [{ id: 'MiniMax-M3' }] },
  })
  for (const bad of [undefined, [], ['   '], 'MiniMax-M3', [123]]) {
    await assert.rejects(
      () => service.deleteModels(bad),
      (error: unknown) => {
        assert.ok(error instanceof MiniMaxServiceError)
        assert.equal((error as MiniMaxServiceError).status, 400)
        assert.equal((error as Error).message, 'ids 不能为空')
        return true
      },
    )
  }
})

// ------------------------------------------------ 方舟 Coding Plan：合并形状与墓碑

test('方舟 Coding Plan provider 合并形状：固定官方端点 + 实测 9 模型池', () => {
  assert.equal(ARK_CODING_PROVIDER_ID, 'volcengine-ark-coding')
  const merged = mergeArkCodingProvider(undefined, 'ARK_CODING_PLAN_API_KEY')
  assert.equal(merged.displayName, '火山方舟 Coding Plan')
  assert.equal(merged.api, 'openai-completions')
  assert.equal(merged.baseURL, ARK_CODING_BASE_URL)
  assert.deepEqual(merged.compat, { supportsDeveloperRole: false })
  assert.equal(merged.apiKeyEnv, 'ARK_CODING_PLAN_API_KEY')
  const ids = (merged.models as Array<{ id: string }>).map((model) => model.id)
  assert.equal(ids.length, ARK_CODING_DEFAULT_MODELS.length)
  assert.deepEqual(ids, ARK_CODING_DEFAULT_MODELS.map((model) => model.id))

  // 漂移防护：已有配置的 api/baseURL 被无条件覆盖，其余用户显式字段保留。
  const drifted = mergeArkCodingProvider(
    { displayName: '自定义', api: 'anthropic-messages', baseURL: 'https://evil.example/v1', apiKeyEnv: 'MY_KEY', models: [{ id: 'doubao-seed-code' }] },
    'ARK_CODING_PLAN_API_KEY',
  )
  assert.equal(drifted.baseURL, ARK_CODING_BASE_URL)
  assert.equal(drifted.api, 'openai-completions')
  assert.equal(drifted.apiKeyEnv, 'MY_KEY')
  assert.equal(drifted.displayName, '自定义')
  const driftedIds = (drifted.models as Array<{ id: string }>).map((model) => model.id)
  assert.deepEqual([...driftedIds].sort(), [...ARK_CODING_DEFAULT_MODELS.map((model) => model.id)].sort(), '已有模型不重复追加')
})

test('方舟 Coding Plan 启动补齐跳过墓碑，restore 全量恢复并清墓碑', async () => {
  const service = new ArkCodingPlanService(
    makeContext({ settings: providerSection({}), credentials: { ARK_CODING_PLAN_API_KEY: 'test-key' } }),
    { enabled: true, apiKeyEnv: 'ARK_CODING_PLAN_API_KEY' },
  )
  // 先手动补齐全量写入，再删除一个 Coding Plan 模型。
  await service.ensureCodingModels(true)
  const codingIds = (await service.status()).codingModels.map((model) => model.id)
  assert.equal(codingIds.length, ARK_CODING_DEFAULT_MODELS.length)
  await service.deleteModels(['doubao-seed-code'], 'coding')

  // 启动自动补齐（restore=false）：被删模型不复活。
  const autoStatus = await service.ensureCodingModels()
  assert.ok(!autoStatus.codingModels.some((model) => model.id === 'doubao-seed-code'))
  assert.ok(listDeletedModels(getDb(), ARK_CODING_PROVIDER_ID).includes('doubao-seed-code'))

  // 手动补齐（restore=true）：复活并清墓碑。
  const restored = await service.ensureCodingModels(true)
  assert.ok(restored.codingModels.some((model) => model.id === 'doubao-seed-code'))
  assert.deepEqual(listDeletedModels(getDb(), ARK_CODING_PROVIDER_ID), [])
})

test('方舟 deleteModels 校验链路：ids 非法 400、ArkServiceError 类型正确', async () => {
  const service = new ArkCodingPlanService(
    makeContext({ settings: providerSection({}), credentials: { ARK_CODING_PLAN_API_KEY: 'test-key' } }),
    { enabled: true, apiKeyEnv: 'ARK_CODING_PLAN_API_KEY' },
  )
  await assert.rejects(
    () => service.deleteModels([], 'coding'),
    (error: unknown) => {
      assert.ok(error instanceof ArkServiceError)
      assert.equal((error as ArkServiceError).status, 400)
      assert.equal((error as Error).message, 'ids 不能为空')
      return true
    },
  )
})

// ------------------------------------------------ OpenAI 网关：无墓碑删除

function makeOpenAiService(): OpenAiGatewayService {
  const endpoints = [
    { id: 'default', name: '主端点', baseURL: 'https://a.example/v1', apiKeyEnv: 'OPENAI_GATEWAY_API_KEY' },
    { id: 'second', name: '备用端点', baseURL: 'https://b.example/v1', apiKeyEnv: 'OPENAI_GATEWAY_API_KEY_2' },
  ]
  return new OpenAiGatewayService(
    makeContext({
      settings: {
        [settingsNamespaceKey()]: {
          providers: {
            'openai-gateway': { apiKeyEnv: 'OPENAI_GATEWAY_API_KEY', models: [{ id: 'm1', name: 'M1' }, { id: 'm2', name: 'M2' }] },
            'openai-gateway-second': { apiKeyEnv: 'OPENAI_GATEWAY_API_KEY_2', models: [{ id: 'n1', name: 'N1' }] },
          },
        },
      },
      credentials: { OPENAI_GATEWAY_API_KEY: 'k1', OPENAI_GATEWAY_API_KEY_2: 'k2' },
    }),
    { enabled: true, baseURL: '', apiKeyEnv: 'OPENAI_GATEWAY_API_KEY', imageModel: '', timeoutMs: 1000, endpoints },
  )
}

test('OpenAI 网关按端点删除模型且不落墓碑', async () => {
  const service = makeOpenAiService()
  const status = await service.deleteModels({ endpointId: 'default', ids: ['m1'] })
  const endpoint = status.endpoints.find((item) => item.id === 'default')
  assert.deepEqual(endpoint?.models.map((model) => model.id), ['m2'])
  // 其它端点不受影响。
  const second = status.endpoints.find((item) => item.id === 'second')
  assert.deepEqual(second?.models.map((model) => model.id), ['n1'])
  // 不写墓碑。
  assert.deepEqual(listDeletedModels(getDb(), 'openai-gateway'), [])
  assert.deepEqual(listDeletedModels(getDb(), 'openai-gateway-second'), [])
})

test('OpenAI 网关：端点不存在 404、删空被拒 400、ids 非法 400', async () => {
  const service = makeOpenAiService()
  await assert.rejects(
    () => service.deleteModels({ endpointId: 'missing', ids: ['m1'] }),
    (error: unknown) => {
      assert.ok(error instanceof Error)
      assert.equal((error as { status?: number }).status, 404)
      assert.equal((error as Error).message, '指定端点不存在')
      return true
    },
  )
  await assert.rejects(
    () => service.deleteModels({ endpointId: 'second', ids: ['n1'] }),
    (error: unknown) => {
      assert.equal((error as { status?: number }).status, 400)
      assert.equal((error as Error).message, '至少保留一个模型')
      return true
    },
  )
  await assert.rejects(
    () => service.deleteModels({ endpointId: 'default', ids: [] }),
    (error: unknown) => {
      assert.equal((error as { status?: number }).status, 400)
      assert.equal((error as Error).message, 'ids 不能为空')
      return true
    },
  )
})

// ------------------------------------------------ 墓碑存储本身

test('墓碑合并去重、移除静默、空清单整键移除', () => {
  const db = getDb()
  assert.deepEqual(listDeletedModels(db, 'p1'), [])
  addDeletedModels(db, 'p1', ['a', 'b', 'a', '  a  '])
  assert.deepEqual(listDeletedModels(db, 'p1'), ['a', 'b'])
  addDeletedModels(db, 'p1', ['a'])
  assert.deepEqual(listDeletedModels(db, 'p1'), ['a', 'b'], '重复写入不产生重复条目')
  // 不存在的 provider/id：静默无异常。
  addDeletedModels(db, 'p2', [])
  assert.deepEqual(listDeletedModels(db, 'p2'), [])
})
