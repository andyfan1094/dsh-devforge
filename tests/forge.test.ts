/** 服务工厂 Agent 预设选择、实际挂载与失败回滚测试。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import {
  DEFAULT_FORGE_AGENT_PRESET,
  ForgeEngine,
  resolveForgeAgentPreset,
  type ForgeHostServices,
} from '../src/forge.ts'
import type { StandardsStore } from '../src/standards.ts'

/** 构造只实现本测试所需方法的规范库。 */
function fakeStandards(): StandardsStore {
  return { composeForAgent: () => '测试规范文本' } as unknown as StandardsStore
}

/** 构造最小 Host Context；ForgeEngine 只需订阅 disposed 事件和写日志。 */
function fakeContext(warnings: string[] = []): Context {
  return {
    on: () => () => {},
    logger: { warn: (message: string) => warnings.push(message) },
  } as unknown as Context
}

/** 等待异步 spawn 结算，避免把 queued 快照误判为最终状态。 */
async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (predicate()) return
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
  }
  assert.fail('异步服务生成任务未在预期时间内结算')
}

test('resolveForgeAgentPreset：默认选择 cordis-250k', async () => {
  const result = await resolveForgeAgentPreset({
    resolve: async (id) => ({ id }),
    mount: async () => ({}),
  }, undefined)
  assert.equal(result, DEFAULT_FORGE_AGENT_PRESET)
})

test('resolveForgeAgentPreset：首选预设缺失或损坏时回退 cordis 并告警', async () => {
  const warnings: string[] = []
  const result = await resolveForgeAgentPreset({
    resolve: async (id) => {
      if (id === DEFAULT_FORGE_AGENT_PRESET) return { id, broken: '兼容模块过期' }
      return { id: 'cordis' }
    },
    mount: async () => ({}),
  }, undefined, (message) => warnings.push(message))
  assert.equal(result, 'cordis')
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /cordis-250k/)
  assert.match(warnings[0], /cordis/)
})

test('resolveForgeAgentPreset：候选全部不可用时抛出明确错误', async () => {
  await assert.rejects(
    resolveForgeAgentPreset({
      resolve: async (id) => { throw new Error('不存在：' + id) },
      mount: async () => ({}),
    }, undefined),
    /无法挂载预设「cordis-250k」/,
  )
})

test('resolveForgeAgentPreset：没有预设服务时保留旧宿主兼容行为', async () => {
  assert.equal(await resolveForgeAgentPreset(undefined, undefined), undefined)
})

test('ForgeEngine：meta 与 setup mount 使用同一实际预设，且先挂载再首轮 followup', async () => {
  const workDir = mkdtempSync(join(tmpdir(), 'dsh-devforge-forge-'))
  try {
    const events: string[] = []
    let captured: Record<string, unknown> | undefined
    let mountedContext: Context | undefined
    let mountedPreset = ''
    let resolveFinished!: () => void
    const finished = new Promise<void>((resolve) => { resolveFinished = resolve })
    const agentCtx = {
      systemPrompt: {
        section: () => { events.push('section') },
      },
    } as unknown as Context
    const host: ForgeHostServices = {
      agents: {
        create: async (options) => {
          captured = options
          events.push('create')
          const setup = options.setup as ((context: Context) => Promise<void>)
          await setup(agentCtx)
          events.push('published')
          return {
            agent: {
              id: 'agent-forge-test',
              followup: () => { events.push('followup'); resolveFinished() },
              cancel: () => {},
            },
            dispose: () => {},
          }
        },
      },
      agentDefaultModel: { currentSelection: () => ({ provider: 'test', model: 'test-model' }) },
      agentPresets: {
        resolve: async (id) => ({ id }),
        mount: async (context, id) => {
          events.push('mount')
          mountedContext = context as Context
          mountedPreset = id
          return { id }
        },
      },
      on: () => () => {},
    }
    const engine = new ForgeEngine(fakeContext(), host, fakeStandards(), workDir, () => DEFAULT_FORGE_AGENT_PRESET)
    await engine.createJob({ name: '预设挂载测试', templateId: 'web-service', targetDir: workDir })
    await finished

    assert.equal((captured?.meta as { agentPreset?: string }).agentPreset, DEFAULT_FORGE_AGENT_PRESET)
    assert.equal(mountedPreset, DEFAULT_FORGE_AGENT_PRESET)
    assert.equal(mountedContext, agentCtx)
    assert.ok(events.indexOf('mount') < events.indexOf('published'))
    assert.ok(events.indexOf('published') < events.indexOf('followup'))
    assert.equal(engine.listJobs()[0]?.status, 'running')
    engine.dispose()
  } finally {
    rmSync(workDir, { recursive: true, force: true })
  }
})

test('ForgeEngine：设置 getter 在新任务中读取新预设', async () => {
  const firstDir = mkdtempSync(join(tmpdir(), 'dsh-devforge-forge-first-'))
  const secondDir = mkdtempSync(join(tmpdir(), 'dsh-devforge-forge-second-'))
  try {
    let preferred = 'first-preset'
    const seen: string[] = []
    const finished: Promise<void>[] = []
    const host: ForgeHostServices = {
      agents: {
        create: async (options) => {
          const setup = options.setup as ((context: Context) => Promise<void>)
          await setup({ systemPrompt: { section: () => {} } } as unknown as Context)
          seen.push((options.meta as { agentPreset?: string }).agentPreset ?? '')
          let resolveFinished!: () => void
          finished.push(new Promise<void>((resolve) => { resolveFinished = resolve }))
          return {
            agent: { id: 'agent-' + seen.length, followup: () => resolveFinished(), cancel: () => {} },
            dispose: () => {},
          }
        },
      },
      agentDefaultModel: { currentSelection: () => ({ provider: 'test', model: 'test-model' }) },
      agentPresets: { resolve: async (id) => ({ id }), mount: async () => ({}) },
      on: () => () => {},
    }
    const engine = new ForgeEngine(fakeContext(), host, fakeStandards(), firstDir, () => preferred)
    await engine.createJob({ name: '首个预设', templateId: 'web-service', targetDir: firstDir })
    await waitFor(() => seen.length === 1)
    preferred = 'second-preset'
    await engine.createJob({ name: '第二个预设', templateId: 'web-service', targetDir: secondDir })
    await waitFor(() => seen.length === 2)
    assert.deepEqual(seen, ['first-preset', 'second-preset'])
    engine.dispose()
  } finally {
    rmSync(firstDir, { recursive: true, force: true })
    rmSync(secondDir, { recursive: true, force: true })
  }
})

test('ForgeEngine：preset mount 失败时任务进入 failed，不伪装成成功', async () => {
  const workDir = mkdtempSync(join(tmpdir(), 'dsh-devforge-forge-failed-'))
  try {
    let createCalled = false
    const host: ForgeHostServices = {
      agents: {
        create: async (options) => {
          createCalled = true
          const setup = options.setup as ((context: Context) => Promise<void>)
          await setup({ systemPrompt: { section: () => {} } } as unknown as Context)
          return { agent: { id: 'never-published', followup: () => {}, cancel: () => {} }, dispose: () => {} }
        },
      },
      agentDefaultModel: { currentSelection: () => ({ provider: 'test', model: 'test-model' }) },
      agentPresets: {
        resolve: async (id) => ({ id }),
        mount: async () => { throw new Error('mount failed: preset dependency missing') },
      },
      on: () => () => {},
    }
    const engine = new ForgeEngine(fakeContext(), host, fakeStandards(), workDir, () => DEFAULT_FORGE_AGENT_PRESET)
    await engine.createJob({ name: '失败回滚测试', templateId: 'web-service', targetDir: workDir })
    await waitFor(() => engine.listJobs()[0]?.status === 'failed')
    const job = engine.listJobs()[0]
    assert.equal(createCalled, true)
    assert.equal(job?.status, 'failed')
    assert.match(job?.lastMessage ?? '', /mount failed/)
    engine.dispose()
  } finally {
    rmSync(workDir, { recursive: true, force: true })
  }
})
