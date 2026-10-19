/**
 * 失败自动续跑（auto-continue）单测。
 *
 * 覆盖「辉哥 2026-10-19 需求」的每一条边界：
 * - 只对模型报错（turn/end reason.kind === 'error'）补发一次；
 * - 用户主动停止 / 中断 / 超长 / 拦截都不补；
 * - 只作用本机 GUI 会话（飞书独立会话、子代理一律跳过）；
 * - 连续失败上限 + 成功清零 + 同一轮去重 + 延迟等待期复核 + dispose 取消。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AutoContinueService, buildContinueMessage, isErrorTurnEnd, isGuiConversation, isSubagentAgent, reasonKindOf, type AutoContinueAgent, type AutoContinueSettings } from '../src/auto-continue/service.ts'
import { DEFAULT_AUTO_CONTINUE_SETTINGS, normalizeAutoContinueSettings } from '../src/auto-continue/protocol.ts'

const IMMEDIATE = (run: () => void): (() => void) => { run(); return () => {} }

interface Captured {
  agent: AutoContinueAgent
  messages: unknown[]
}

function makeAgent(header: Record<string, unknown> = {}): Captured {
  const messages: unknown[] = []
  const agent: AutoContinueAgent = {
    followup(message: unknown) { messages.push(message) },
    session: { id: 'session-gui-1', header },
  }
  return { agent, messages }
}

interface Harness {
  service: AutoContinueService
  captured: Captured
  settings: AutoContinueSettings
  pending: Array<() => void>
}

function makeHarness(overrides: {
  settings?: Partial<AutoContinueSettings>
  agent?: AutoContinueAgent
  defer?: boolean
  now?: () => number
} = {}): Harness {
  const captured = makeAgent()
  const settings: AutoContinueSettings = { ...DEFAULT_AUTO_CONTINUE_SETTINGS, ...overrides.settings }
  const pending: Array<() => void> = []
  const service = new AutoContinueService({
    readSettings: () => settings,
    resolveAgent: () => overrides.agent ?? captured.agent,
    schedule: overrides.defer === true
      ? (run) => { pending.push(run); return () => { const index = pending.indexOf(run); if (index >= 0) pending.splice(index, 1) } }
      : IMMEDIATE,
  })
  return { service, captured, settings, pending }
}

const session = (id = 'session-gui-1'): { id: string } => ({ id })
const turnEnd = (kind: string, turn = 1): { type: string; data: { turn: number; reason: { kind: string } } } => ({
  type: 'turn/end',
  data: { turn, reason: { kind } },
})

// ---------- 协议层 ----------

test('设置默认值：开启、正文「继续」、最多补 1 次、延迟 3 秒', () => {
  assert.deepEqual(DEFAULT_AUTO_CONTINUE_SETTINGS, { enabled: true, text: '继续', maxAttempts: 1, delayMs: 3000 })
})

test('设置归一化：缺字段沿用当前值，越界值收敛，空正文回退默认「继续」', () => {
  const base: AutoContinueSettings = { enabled: false, text: '再来一次', maxAttempts: 3, delayMs: 5000 }
  assert.deepEqual(normalizeAutoContinueSettings({}, base), base)
  assert.deepEqual(normalizeAutoContinueSettings({ enabled: true }, base), { ...base, enabled: true })
  const clamped = normalizeAutoContinueSettings({ maxAttempts: 99, delayMs: -5 }, base)
  assert.equal(clamped.maxAttempts, 5)
  assert.equal(clamped.delayMs, 0)
  assert.equal(normalizeAutoContinueSettings({ text: '   ' }, base).text, '继续')
  assert.equal(normalizeAutoContinueSettings({ text: 'x'.repeat(500) }, base).text.length, 200)
  assert.equal(normalizeAutoContinueSettings(null, base).text, '再来一次')
})

// ---------- 纯判定 ----------

test('turn/end 原因解析：只把 error 认作失败，非 turn/end 返回空串', () => {
  assert.equal(reasonKindOf(turnEnd('error')), 'error')
  assert.equal(isErrorTurnEnd(turnEnd('error')), true)
  assert.equal(isErrorTurnEnd(turnEnd('completed')), false)
  assert.equal(isErrorTurnEnd(turnEnd('aborted')), false)
  assert.equal(reasonKindOf({ type: 'assistant/message', data: {} }), '')
  assert.equal(reasonKindOf(null), '')
})

test('范围判定：飞书独立会话与子代理都不归本功能管', () => {
  assert.equal(isGuiConversation('session-602ce01e-cd82'), true)
  assert.equal(isGuiConversation('session-feishu-v2-abc'), false)
  assert.equal(isGuiConversation('session-feishu-abc'), false)
  assert.equal(isGuiConversation(''), false)
  assert.equal(isSubagentAgent(makeAgent({ origin: 'subagent' }).agent), true)
  assert.equal(isSubagentAgent(makeAgent({ delegationDepth: 1 }).agent), true)
  assert.equal(isSubagentAgent(makeAgent({}).agent), false)
  assert.equal(isSubagentAgent(undefined), false)
})

test('补发消息结构：user 角色、正文、生产者自有 source（v4 契约）', () => {
  const message = buildContinueMessage('  继续  ')
  assert.equal(message.role, 'user')
  assert.deepEqual(message.content, [{ type: 'text', text: '继续' }])
  assert.equal(message.source.kind, 'dsh-devforge')
  assert.equal(message.source.form, 'notice')
  assert.equal(typeof message.id, 'string')
  assert.equal(buildContinueMessage('').content[0].text, '继续')
})

// ---------- 服务：触发与限次 ----------

test('模型报错：自动补发一条「继续」并打开新一轮', () => {
  const { service, captured } = makeHarness()
  service.handle(session(), turnEnd('error', 7))
  assert.equal(captured.messages.length, 1)
  const message = captured.messages[0] as { role: string; content: Array<{ text: string }> }
  assert.equal(message.role, 'user')
  assert.equal(message.content[0].text, '继续')
  assert.equal(service.stats.attemptCount, 1)
  assert.equal(service.stats.lastSessionId, 'session-gui-1')
})

test('同一会话连续失败：默认最多补 1 次，第二次失败停手并记下跳过原因', () => {
  const { service, captured } = makeHarness()
  service.handle(session(), turnEnd('error', 1))
  service.handle(session(), turnEnd('error', 2))
  assert.equal(captured.messages.length, 1)
  assert.equal(service.stats.skipCount, 1)
  assert.match(service.stats.lastSkipReason, /上限/)
})

test('成功轮次清零：失败补一次 → 正常完成 → 再失败又能补一次', () => {
  const { service, captured } = makeHarness()
  service.handle(session(), turnEnd('error', 1))
  service.handle(session(), turnEnd('completed', 2))
  service.handle(session(), turnEnd('error', 3))
  assert.equal(captured.messages.length, 2)
})

test('同一轮重复投递只处理一次（恢复补记不会二次补发）', () => {
  const { service, captured } = makeHarness({ settings: { maxAttempts: 3 } })
  service.handle(session(), turnEnd('error', 5))
  service.handle(session(), turnEnd('error', 5))
  assert.equal(captured.messages.length, 1)
})

// ---------- 服务：不该触发的场景 ----------

test('用户主动停止 / 系统中断 / 超长截断 / 被拦截：一律不补发', () => {
  const { service, captured } = makeHarness()
  for (const kind of ['aborted', 'interrupted', 'max-tokens', 'blocked', 'forked']) {
    service.handle(session(), turnEnd(kind, 1))
  }
  assert.equal(captured.messages.length, 0)
})

test('飞书独立会话失败不补发', () => {
  const { service, captured } = makeHarness()
  service.handle(session('session-feishu-v2-deadbeef'), turnEnd('error', 1))
  assert.equal(captured.messages.length, 0)
  assert.match(service.stats.lastSkipReason, /飞书/)
})

test('子代理会话失败不补发', () => {
  const capturedAgent = makeAgent({ origin: 'subagent' })
  const { service } = makeHarness({ agent: capturedAgent.agent })
  service.handle(session(), turnEnd('error', 1))
  assert.equal(capturedAgent.messages.length, 0)
  assert.match(service.stats.lastSkipReason, /子代理/)
})

test('开关关闭或连续上限为 0：不补发', () => {
  const off = makeHarness({ settings: { enabled: false } })
  off.service.handle(session(), turnEnd('error', 1))
  assert.equal(off.captured.messages.length, 0)
  assert.match(off.service.stats.lastSkipReason, /关闭/)

  const zero = makeHarness({ settings: { maxAttempts: 0 } })
  zero.service.handle(session(), turnEnd('error', 1))
  assert.equal(zero.captured.messages.length, 0)
  assert.match(zero.service.stats.lastSkipReason, /上限为 0/)
})

test('会话没有活跃 Agent（未 resume / 已释放）：不补发', () => {
  const service = new AutoContinueService({
    readSettings: () => DEFAULT_AUTO_CONTINUE_SETTINGS,
    resolveAgent: () => undefined,
    schedule: IMMEDIATE,
  })
  service.handle(session(), turnEnd('error', 1))
  assert.equal(service.stats.attemptCount, 0)
  assert.match(service.stats.lastSkipReason, /活跃 Agent/)
})

// ---------- 服务：延迟与卸载 ----------

test('延迟等待期间关掉开关：到点也不再补发', () => {
  const harness = makeHarness({ defer: true })
  harness.service.handle(session(), turnEnd('error', 1))
  assert.equal(harness.pending.length, 1)
  harness.settings.enabled = false
  harness.pending[0]()
  assert.equal(harness.captured.messages.length, 0)
  assert.match(harness.service.stats.lastSkipReason, /等待期间/)
})

test('延迟等待期间 Agent 已释放：到点跳过而不是抛错', () => {
  const harness = makeHarness({ defer: true })
  let alive = true
  const service = new AutoContinueService({
    readSettings: () => DEFAULT_AUTO_CONTINUE_SETTINGS,
    resolveAgent: () => alive ? harness.captured.agent : undefined,
    schedule: (run) => { harness.pending.push(run); return () => {} },
  })
  service.handle(session(), turnEnd('error', 1))
  alive = false
  harness.pending[0]()
  assert.equal(harness.captured.messages.length, 0)
  assert.match(service.stats.lastSkipReason, /已释放/)
})

test('followup 抛错只记录不冒泡', () => {
  const service = new AutoContinueService({
    readSettings: () => DEFAULT_AUTO_CONTINUE_SETTINGS,
    resolveAgent: () => ({ followup() { throw new Error('session closed') }, session: { header: {} } }),
    schedule: IMMEDIATE,
  })
  service.handle(session(), turnEnd('error', 1))
  assert.equal(service.stats.attemptCount, 0)
  assert.match(service.stats.lastError, /session closed/)
})

test('dispose：取消等待中的补发，之后事件不再处理', async () => {
  const pending: Array<() => void> = []
  const service = new AutoContinueService({
    readSettings: () => DEFAULT_AUTO_CONTINUE_SETTINGS,
    resolveAgent: () => makeAgent().agent,
    schedule: (run) => { pending.push(run); return () => { const index = pending.indexOf(run); if (index >= 0) pending.splice(index, 1) } },
  })
  service.handle(session(), turnEnd('error', 1))
  assert.equal(pending.length, 1)
  service.dispose()
  assert.equal(pending.length, 0)
  service.handle(session(), turnEnd('error', 2))
  assert.equal(service.stats.attemptCount, 0)
})

test('attach：只订阅 session/event，异常不影响宿主', () => {
  const subscribed: string[] = []
  const { service } = makeHarness()
  const off = service.attach({
    on(event: string, listener: (...args: never[]) => unknown) {
      subscribed.push(event)
      ;(globalThis as { __listener?: (...args: never[]) => unknown }).__listener = listener
      return () => {}
    },
  })
  assert.deepEqual(subscribed, ['session/event'])
  const listener = (globalThis as { __listener?: (session: unknown, event: unknown) => void }).__listener
  assert.equal(typeof listener, 'function')
  // 畸形事件（session 为 null）不得抛错
  listener?.(null, null)
  listener?.(session(), turnEnd('error', 1))
  off()
})
