/**
 * 沙箱提权参数清洗单测（0.33.0）。
 *
 * 覆盖：A 类（成对缺失/空白 justification）、B 类（只带 justification）、
 * C 类（不严格更宽，含 danger-full-access 会话）、保守放行的合法提权、
 * 以及钩子的实际行为（替换 exec.arguments、pass-through next、异常不外溢）。
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  KNOWN_ESCALATION_TARGETS,
  SANDBOX_ESCALATION_FIELDS,
  WIDER_SANDBOX_MODES,
  createEffectiveModeResolver,
  installSandboxEscalationGuard,
  judgeEscalationArgs,
  stripEscalationFields,
  type EscalationStripInfo,
  type ToolExecutionLike,
} from '../src/sandbox-escalation-guard.ts'

test('升级阶梯表与宿主 WIDER_MODES 语义一致', () => {
  assert.deepEqual(WIDER_SANDBOX_MODES['read-only'], ['workspace-write', 'danger-full-access'])
  assert.deepEqual(WIDER_SANDBOX_MODES['workspace-write'], ['danger-full-access'])
  assert.deepEqual(WIDER_SANDBOX_MODES['danger-full-access'], [])
  assert.deepEqual([...KNOWN_ESCALATION_TARGETS].sort(), ['danger-full-access', 'workspace-write'])
  assert.deepEqual([...SANDBOX_ESCALATION_FIELDS], ['sandbox_permissions', 'justification'])
})

test('不带提权字段一律放行', () => {
  assert.deepEqual(judgeEscalationArgs({ command: 'ls', description: 'd' }, 'danger-full-access'), { action: 'keep' })
  assert.deepEqual(judgeEscalationArgs({}, 'read-only'), { action: 'keep' })
  // 非对象参数（工具 schema 损坏或内置工具）不参与裁定
  assert.deepEqual(judgeEscalationArgs(undefined, 'read-only'), { action: 'keep' })
  assert.deepEqual(judgeEscalationArgs(null, 'read-only'), { action: 'keep' })
  assert.deepEqual(judgeEscalationArgs([1, 2], 'read-only'), { action: 'keep' })
  assert.deepEqual(judgeEscalationArgs('str', 'read-only'), { action: 'keep' })
})

test('A 类：带了模式但 justification 缺失/空白/非字符串 → 剥离', () => {
  const base = { command: 'ls', description: 'd', sandbox_permissions: 'danger-full-access' }
  assert.deepEqual(judgeEscalationArgs(base, 'read-only'), { action: 'strip', reason: 'justification-missing-or-blank' })
  assert.deepEqual(judgeEscalationArgs({ ...base, justification: '' }, 'read-only'), { action: 'strip', reason: 'justification-missing-or-blank' })
  assert.deepEqual(judgeEscalationArgs({ ...base, justification: '   ' }, 'read-only'), { action: 'strip', reason: 'justification-missing-or-blank' })
  // 非字符串 justification 会让宿主的 .trim() 抛 TypeError，同样必然失败
  assert.deepEqual(judgeEscalationArgs({ ...base, justification: null }, 'read-only'), { action: 'strip', reason: 'justification-missing-or-blank' })
  assert.deepEqual(judgeEscalationArgs({ ...base, justification: 42 }, 'read-only'), { action: 'strip', reason: 'justification-missing-or-blank' })
  // 模式未知也拦得住：A 类判定先于模式比较
  assert.deepEqual(judgeEscalationArgs(base, undefined), { action: 'strip', reason: 'justification-missing-or-blank' })
})

test('B 类：只带 justification → 剥离', () => {
  assert.deepEqual(
    judgeEscalationArgs({ command: 'ls', description: 'd', justification: '需要写入' }, 'read-only'),
    { action: 'strip', reason: 'justification-without-mode' },
  )
  assert.deepEqual(
    judgeEscalationArgs({ justification: '' }, 'danger-full-access'),
    { action: 'strip', reason: 'justification-without-mode' },
  )
})

test('C 类：请求模式不严格更宽 → 剥离（含 danger-full-access 会话）', () => {
  const ask = (mode: string, effective: string) => judgeEscalationArgs(
    { sandbox_permissions: mode, justification: '需要更宽权限' }, effective,
  )
  // 用户实际踩的坑：会话已在最宽模式，模型仍请求 danger-full-access
  assert.deepEqual(ask('danger-full-access', 'danger-full-access'), { action: 'strip', reason: 'not-strictly-wider' })
  // 同级 / 降级 / 地板目标
  assert.deepEqual(ask('workspace-write', 'workspace-write'), { action: 'strip', reason: 'not-strictly-wider' })
  assert.deepEqual(ask('workspace-write', 'danger-full-access'), { action: 'strip', reason: 'not-strictly-wider' })
  assert.deepEqual(ask('read-only', 'read-only'), { action: 'strip', reason: 'not-strictly-wider' })
  assert.deepEqual(ask('read-only', 'workspace-write'), { action: 'strip', reason: 'not-strictly-wider' })
  // 拼错/非字符串模式同样是必然失败
  assert.deepEqual(ask('full-access', 'read-only'), { action: 'strip', reason: 'not-strictly-wider' })
  assert.deepEqual(
    judgeEscalationArgs({ sandbox_permissions: true, justification: 'reason' }, 'read-only'),
    { action: 'strip', reason: 'not-strictly-wider' },
  )
})

test('合法提权保持原语义（交给审批链）', () => {
  assert.deepEqual(
    judgeEscalationArgs({ sandbox_permissions: 'workspace-write', justification: '需要写入工作区' }, 'read-only'),
    { action: 'keep' },
  )
  assert.deepEqual(
    judgeEscalationArgs({ sandbox_permissions: 'danger-full-access', justification: '需要系统级安装' }, 'workspace-write'),
    { action: 'keep' },
  )
})

test('模式无法判定时保守放行合法目标、只拦非法目标', () => {
  assert.deepEqual(
    judgeEscalationArgs({ sandbox_permissions: 'workspace-write', justification: '需要写入' }, undefined),
    { action: 'keep' },
  )
  assert.deepEqual(
    judgeEscalationArgs({ sandbox_permissions: 'danger-full-access', justification: '需要写入' }, 'future-mode'),
    { action: 'keep' },
  )
  assert.deepEqual(
    judgeEscalationArgs({ sandbox_permissions: 'nonsense', justification: '需要写入' }, undefined),
    { action: 'strip', reason: 'unknown-mode' },
  )
})

test('模式解析：必须以方法形式调用 resolve，保留 this 绑定（0.33.0 翻车点回归）', () => {
  // 真实宿主服务就是这个形状：resolve 内部依赖 this.defaultMode / this.overrideOf。
  const service = {
    defaultMode: 'danger-full-access',
    override: undefined as string | undefined,
    overrideOf(): string | undefined { return this.override },
    resolve(request: { session?: unknown; mode?: string } = {}) {
      return { mode: request.mode ?? (request.session === undefined ? undefined : this.overrideOf()) ?? this.defaultMode }
    },
  }
  const resolveMode = createEffectiveModeResolver({ get: (name) => (name === 'sandboxPolicy' ? service : undefined) })
  // 无会话：走 this.defaultMode
  assert.equal(resolveMode({}), 'danger-full-access')
  // 有会话但无覆盖：仍回落到 this.defaultMode
  assert.equal(resolveMode({ agent: { session: {} } }), 'danger-full-access')
  // 有会话且带 sandbox/mode 覆盖：this.overrideOf 生效
  service.override = 'read-only'
  assert.equal(resolveMode({ agent: { session: {} } }), 'read-only')
  service.override = undefined
  // 解构调用会丢 this → 抛错 → 被吞成 undefined；这里断言绝不能是 undefined
  assert.notEqual(resolveMode({ agent: { session: {} } }), undefined)
})

test('模式解析：服务缺失或异常一律返回 undefined，不抛错', () => {
  assert.equal(createEffectiveModeResolver({ get: () => undefined })({}), undefined)
  assert.equal(createEffectiveModeResolver({ get: () => ({}) })({}), undefined)
  const throwing = createEffectiveModeResolver({ get: () => ({ resolve: () => { throw new Error('projection boom') } }) })
  assert.equal(throwing({ agent: { session: {} } }), undefined)
})

test('钩子：携带提权字段却放行时触发 onKeep 留痕（静默失效可见化）', () => {
  const listeners: Array<(exec: ToolExecutionLike, next: () => unknown) => unknown> = []
  const keeps: Array<{ tool: string; effectiveMode?: string; requestedMode?: string }> = []
  installSandboxEscalationGuard({ on: (_n, l) => { listeners.push(l); return undefined } }, {
    resolveEffectiveMode: () => 'read-only',
    onKeep: (info) => keeps.push(info),
  })
  // 合法提权：放行 + 留痕
  listeners[0](makeExec({ command: 'ls', sandbox_permissions: 'workspace-write', justification: '需要写入工作区' }), () => 'ok')
  assert.equal(keeps.length, 1)
  assert.equal(keeps[0].requestedMode, 'workspace-write')
  assert.equal(keeps[0].effectiveMode, 'read-only')
  // 完全不带提权字段：不打扰
  listeners[0](makeExec({ command: 'ls' }), () => 'ok')
  assert.equal(keeps.length, 1)
})

test('钩子：模式无法判定时 danger-full-access 请求保守放行但必须留痕', () => {
  const listeners: Array<(exec: ToolExecutionLike, next: () => unknown) => unknown> = []
  const keeps: Array<{ effectiveMode?: string }> = []
  installSandboxEscalationGuard({ on: (_n, l) => { listeners.push(l); return undefined } }, {
    resolveEffectiveMode: () => undefined,
    onKeep: (info) => keeps.push(info),
  })
  const exec = makeExec({ command: 'ls', sandbox_permissions: 'danger-full-access', justification: '理由' })
  listeners[0](exec, () => 'ok')
  assert.deepEqual(exec.arguments, { command: 'ls', sandbox_permissions: 'danger-full-access', justification: '理由' })
  assert.equal(keeps.length, 1)
  assert.equal(keeps[0].effectiveMode, undefined)
})

test('stripEscalationFields 只去掉两个字段，其余原样保留', () => {
  const stripped = stripEscalationFields({
    command: 'rm -rf x',
    description: 'd',
    timeoutMs: 1000,
    run_in_background: true,
    sandbox_permissions: 'danger-full-access',
    justification: 'reason',
  })
  assert.deepEqual(stripped, {
    command: 'rm -rf x',
    description: 'd',
    timeoutMs: 1000,
    run_in_background: true,
  })
})

/** 构造一个最小 exec。 */
function makeExec(args: Record<string, unknown>): ToolExecutionLike {
  return { name: 'bash', callId: 'c1', arguments: { ...args } }
}

test('钩子：剥离必然失败的字段并替换 exec.arguments，然后放行', () => {
  const listeners: Array<(exec: ToolExecutionLike, next: () => unknown) => unknown> = []
  const strips: EscalationStripInfo[] = []
  const dispose = installSandboxEscalationGuard({
    on: (name, listener, options) => {
      assert.equal(name, 'tools/pre-execute')
      assert.equal(options?.prepend, true)
      listeners.push(listener)
      return () => {}
    },
  }, {
    resolveEffectiveMode: () => 'danger-full-access',
    onStrip: (info) => strips.push(info),
  })
  assert.equal(listeners.length, 1)

  const exec = makeExec({ command: 'ls', description: 'd', sandbox_permissions: 'danger-full-access', justification: 'x' })
  let nexted = 0
  const decision = listeners[0](exec, () => { nexted += 1; return { kind: 'allow' } })
  assert.deepEqual(decision, { kind: 'allow' })
  assert.equal(nexted, 1)
  assert.deepEqual(exec.arguments, { command: 'ls', description: 'd' })
  assert.equal(strips.length, 1)
  assert.equal(strips[0].reason, 'not-strictly-wider')
  assert.equal(strips[0].requestedMode, 'danger-full-access')
  assert.equal(strips[0].effectiveMode, 'danger-full-access')
  assert.equal(strips[0].tool, 'bash')
  assert.equal(strips[0].callId, 'c1')
  dispose()
})

test('钩子：合法提权不触碰参数，也不触发观测回调', () => {
  const listeners: Array<(exec: ToolExecutionLike, next: () => unknown) => unknown> = []
  const strips: EscalationStripInfo[] = []
  installSandboxEscalationGuard({
    on: (_name, listener) => { listeners.push(listener); return undefined },
  }, {
    resolveEffectiveMode: () => 'read-only',
    onStrip: (info) => strips.push(info),
  })
  const original = { command: 'ls', description: 'd', sandbox_permissions: 'workspace-write', justification: '需要写入工作区' }
  const exec = makeExec(original)
  listeners[0](exec, () => ({ kind: 'allow' }))
  assert.deepEqual(exec.arguments, original)
  assert.equal(strips.length, 0)
})

test('钩子：无参数 exec / 解析抛错都不影响放行', () => {
  const listeners: Array<(exec: ToolExecutionLike, next: () => unknown) => unknown> = []
  installSandboxEscalationGuard({ on: (_n, l) => { listeners.push(l); return undefined } }, {
    resolveEffectiveMode: () => { throw new Error('policy boom') },
    onStrip: () => { throw new Error('observer boom') },
  })
  let nexted = 0
  const bare: ToolExecutionLike = { name: 'bash', callId: 'c2' }
  assert.deepEqual(listeners[0](bare, () => { nexted += 1; return 'ok' }), 'ok')
  const exec = makeExec({ command: 'ls', justification: 'x' })
  assert.deepEqual(listeners[0](exec, () => { nexted += 1; return 'ok' }), 'ok')
  assert.deepEqual(exec.arguments, { command: 'ls' })
  assert.equal(nexted, 2)
})

test('钩子：ctx.on 返回非函数时卸载不抛错', () => {
  const dispose = installSandboxEscalationGuard({ on: () => undefined })
  assert.doesNotThrow(() => dispose())
})
