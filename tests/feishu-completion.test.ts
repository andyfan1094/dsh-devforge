/** 飞书完成通知的请求/结果卡片、状态归一化与任务收敛单测。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildCompletionCard, describeTurnEndReason } from '../src/feishu/outbound.mjs'
import { createCompletionNotifier } from '../src/feishu/completion-notifier.mjs'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const assistant = (text, turn = 1, step = 1) => ({
  type: 'assistant/message',
  data: { turn, step, message: { content: [{ type: 'text', text }] } },
})
const route = (model, provider = 'test-provider') => ({
  type: 'request/header',
  data: { header: { config: { provider, model } }, reason: 'initial' },
})

function makeNotifier(sent, overrides = {}) {
  return createCompletionNotifier({
    getConfig: () => ({ notifyOnComplete: true, notifyChatId: 'oc_test' }),
    getClient: () => ({}),
    sendCard: async (client, chatId, card) => { sent.push({ chatId, card }); return 'm1' },
    settleMs: 20,
    ...overrides,
  })
}

test('buildCompletionCard：完成通知包含固定标题、用户请求、模型回复与辅助信息', () => {
  const card = buildCompletionCard({
    subject: '修复登录页',
    request: '请修复登录页并说明处理结果',
    response: '已修复登录校验，并补充了回归测试。',
    model: 'gpt-5.6',
    turn: 3,
    durationMs: 65_000,
    reason: { kind: 'completed' },
  })
  assert.equal(card.schema, '2.0')
  assert.equal(card.header.template, 'green')
  assert.equal(card.header.title.content, '【GPT-5.6 处理完成】')
  const text = JSON.stringify(card)
  assert.match(text, /请求/)
  assert.match(text, /请修复登录页并说明处理结果/)
  assert.match(text, /结果/)
  assert.match(text, /已修复登录校验，并补充了回归测试/)
  assert.match(text, /DSH · 共 3 轮 · 耗时 1 分 5 秒/)
})

test('buildCompletionCard：失败通知同时保留模型回复和结构化失败原因', () => {
  const card = buildCompletionCard({
    request: '部署服务',
    response: '已完成构建，但部署阶段未成功。',
    model: 'glm-5.3',
    turn: 1,
    durationMs: 2_500,
    reason: { kind: 'error', error: { message: '上游连接超时', code: 'ETIMEDOUT' } },
  })
  assert.equal(card.header.template, 'red')
  assert.equal(card.header.title.content, '【GLM-5.3 处理失败】')
  const text = JSON.stringify(card)
  assert.match(text, /已完成构建，但部署阶段未成功/)
  assert.match(text, /失败原因/)
  assert.match(text, /上游连接超时/)
  assert.match(text, /ETIMEDOUT/)
  assert.doesNotMatch(text, /\[object Object\]/)
})

test('buildCompletionCard：没有模型回复时明确提示，不能只显示轮次耗时', () => {
  const card = buildCompletionCard({ request: '检查仓库', turn: 1, durationMs: 0, reason: { kind: 'completed' } })
  const text = JSON.stringify(card)
  assert.match(text, /检查仓库/)
  assert.match(text, /任务已结束，但未捕获到模型最终回复/)
})

test('buildCompletionCard：按 UTF-8 字节截断，整卡始终低于飞书 30 KB 限制', () => {
  for (const response of ['甲'.repeat(13_000), '\\"'.repeat(13_000)]) {
    const card = buildCompletionCard({ request: '\\"'.repeat(3_000), response, turn: 1, durationMs: 0, reason: { kind: 'completed' } })
    const text = JSON.stringify(card)
    assert.ok(Buffer.byteLength(text, 'utf8') < 30 * 1024)
    assert.match(text, /内容过长，已截断/)
    const markdown = card.body.elements.filter((element) => element?.text?.tag === 'lark_md')
    assert.ok(markdown.every((element) => Array.from(element.text.content).length < 4_000))
  }
})

test('buildCompletionCard：模型名与 blocked/paused/aborted 状态组成清晰标题', () => {
  assert.equal(buildCompletionCard({ request: 'A', response: '需要输入', model: 'gpt-5.6', reason: { kind: 'blocked' } }).header.title.content, '【GPT-5.6 等待输入】')
  assert.equal(buildCompletionCard({ request: 'B', response: '已经暂停', model: 'glm-5.3', reason: { kind: 'paused' } }).header.title.content, '【GLM-5.3 已暂停】')
  assert.equal(buildCompletionCard({ request: 'C', response: '已经中止', model: 'minimax-m2.5', reason: { kind: 'aborted', reason: 'user' } }).header.title.content, '【MiniMax-m2.5 已中止】')
})

test('describeTurnEndReason：旧字符串失败原因与未知对象兼容', () => {
  assert.equal(describeTurnEndReason('tool_failed:bash').failed, true)
  const state = describeTurnEndReason({ foo: 'bar' })
  assert.equal(state.failed, true)
  assert.doesNotMatch(state.text, /\[object Object\]/)
  assert.equal(describeTurnEndReason({ kind: 'max-tokens' }).failed, false)
})

test('通知：连续多轮收敛后只发一张，内容取最后一条模型回复', async () => {
  const sent = []
  const notifier = makeNotifier(sent)
  const session = { id: 's1' }
  notifier.observe(session, route('gpt-5.6'))
  notifier.observe(session, { type: 'user/message', data: { message: { content: [{ type: 'text', text: '帮我统计今天的销售数据' }] } } })
  notifier.observe(session, { type: 'turn/start', data: { turn: 1 } })
  notifier.observe(session, assistant('正在读取销售数据。', 1))
  notifier.observe(session, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
  notifier.observe(session, { type: 'turn/start', data: { turn: 2 } })
  notifier.observe(session, assistant('已统计完成：销售额 12 万元。', 2))
  notifier.observe(session, { type: 'turn/end', data: { turn: 2, reason: { kind: 'completed' } } })
  assert.equal(sent.length, 0)
  await sleep(80)
  assert.equal(sent.length, 1)
  const text = JSON.stringify(sent[0].card)
  assert.equal(sent[0].card.header.title.content, '【GPT-5.6 处理完成】')
  assert.match(text, /帮我统计今天的销售数据/)
  assert.match(text, /已统计完成：销售额 12 万元/)
  assert.doesNotMatch(text, /正在读取销售数据/)
  assert.match(text, /共 2 轮/)
})

test('通知：真实模型标题跨任务保持，并在路由切换后更新', async () => {
  const sent = []
  const notifier = makeNotifier(sent)
  const session = { id: 's-model-route' }
  notifier.observe(session, route('glm-5.3'))
  for (const [turn, request, response] of [[1, '任务一', '任务一完成'], [2, '任务二', '任务二完成']]) {
    notifier.observe(session, { type: 'user/message', data: { content: [{ type: 'text', text: request }] } })
    notifier.observe(session, { type: 'turn/start', data: { turn } })
    notifier.observe(session, assistant(response, turn))
    notifier.observe(session, { type: 'turn/end', data: { turn, reason: { kind: 'completed' } } })
    await sleep(80)
  }
  assert.equal(sent[0].card.header.title.content, '【GLM-5.3 处理完成】')
  assert.equal(sent[1].card.header.title.content, '【GLM-5.3 处理完成】')
  notifier.observe(session, route('openai/gpt-5.6'))
  notifier.observe(session, { type: 'user/message', data: { content: [{ type: 'text', text: '任务三' }] } })
  notifier.observe(session, { type: 'turn/start', data: { turn: 3 } })
  notifier.observe(session, assistant('任务三完成', 3))
  notifier.observe(session, { type: 'turn/end', data: { turn: 3, reason: { kind: 'completed' } } })
  await sleep(80)
  assert.equal(sent[2].card.header.title.content, '【GPT-5.6 处理完成】')
})

test('通知：收敛前开启新轮次则继续静默', async () => {
  const sent = []
  const notifier = makeNotifier(sent)
  const session = { id: 's2' }
  notifier.observe(session, { type: 'turn/start', data: { turn: 1 } })
  notifier.observe(session, assistant('第一轮结果', 1))
  notifier.observe(session, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
  notifier.observe(session, { type: 'turn/start', data: { turn: 2 } })
  await sleep(80)
  assert.equal(sent.length, 0)
})

test('通知：goal complete 等待当前 turn/end，纳入 goal 完成后的最终回复', async () => {
  const sent = []
  const notifier = makeNotifier(sent)
  const session = { id: 's3' }
  notifier.observe(session, { type: 'user/message', data: { message: { content: [{ type: 'text', text: '彻底修复飞书通知' }] } } })
  notifier.observe(session, { type: 'goal/change', data: { operation: 'set', goal: { phase: 'active', roundsStarted: 1 } } })
  notifier.observe(session, { type: 'turn/start', data: { turn: 1 } })
  notifier.observe(session, assistant('中间检查完成。', 1))
  notifier.observe(session, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
  notifier.observe(session, { type: 'turn/start', data: { turn: 2 } })
  notifier.observe(session, { type: 'goal/change', data: { operation: 'set', goal: { phase: 'complete', roundsStarted: 2 } } })
  assert.equal(sent.length, 0)
  notifier.observe(session, assistant('已经加入标题、请求和模型最终回复，并通过全部测试。', 2))
  assert.equal(sent.length, 0)
  notifier.observe(session, { type: 'turn/end', data: { turn: 2, reason: { kind: 'completed' } } })
  assert.equal(sent.length, 1)
  const text = JSON.stringify(sent[0].card)
  assert.match(text, /彻底修复飞书通知/)
  assert.match(text, /已经加入标题、请求和模型最终回复，并通过全部测试/)
  assert.match(text, /共 2 轮/)
})

test('通知：goal 活跃期间遇到错误终态仍立即发送，后续 goal 终态不重复', () => {
  const sent = []
  const notifier = makeNotifier(sent)
  const session = { id: 's-active-error' }
  notifier.observe(session, { type: 'user/message', data: { content: [{ type: 'text', text: '执行高风险任务' }] } })
  notifier.observe(session, { type: 'goal/change', data: { operation: 'set', goal: { phase: 'active' } } })
  notifier.observe(session, { type: 'turn/start', data: { turn: 1 } })
  notifier.observe(session, assistant('任务执行到一半失败。'))
  notifier.observe(session, { type: 'turn/end', data: { turn: 1, reason: { kind: 'error', error: { message: '中途失败' } } } })
  assert.equal(sent.length, 1)
  assert.equal(sent[0].card.header.title.content, '【DSH 处理失败】')
  notifier.observe(session, { type: 'goal/change', data: { operation: 'set', goal: { phase: 'complete', roundsStarted: 1 } } })
  assert.equal(sent.length, 1)
})

test('通知：下一条用户请求早于上个 turn/end 时，先结算待发送 goal 再记录新任务', async () => {
  const sent = []
  const notifier = makeNotifier(sent)
  const session = { id: 's-early-user' }
  notifier.observe(session, { type: 'user/message', data: { content: [{ type: 'text', text: '旧任务请求' }] } })
  notifier.observe(session, { type: 'goal/change', data: { operation: 'set', goal: { phase: 'active' } } })
  notifier.observe(session, { type: 'turn/start', data: { turn: 1 } })
  notifier.observe(session, assistant('旧任务最终回复。'))
  notifier.observe(session, { type: 'goal/change', data: { operation: 'set', goal: { phase: 'complete', roundsStarted: 1 } } })
  notifier.observe(session, { type: 'user/message', data: { content: [{ type: 'text', text: '新任务请求' }] } })
  assert.equal(sent.length, 1)
  const first = JSON.stringify(sent[0].card)
  assert.match(first, /旧任务请求/)
  assert.match(first, /旧任务最终回复/)
  assert.doesNotMatch(first, /新任务请求/)
  notifier.observe(session, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
  notifier.observe(session, { type: 'turn/start', data: { turn: 2 } })
  notifier.observe(session, assistant('新任务最终回复。', 2))
  notifier.observe(session, { type: 'turn/end', data: { turn: 2, reason: { kind: 'completed' } } })
  await sleep(80)
  assert.equal(sent.length, 2)
  const second = JSON.stringify(sent[1].card)
  assert.match(second, /新任务请求/)
  assert.match(second, /新任务最终回复/)
})

test('通知：goal 终态晚于 turn/end 时立即结算，不泄漏到下一任务', async () => {
  const sent = []
  const notifier = makeNotifier(sent)
  const session = { id: 's-late-goal' }
  notifier.observe(session, { type: 'user/message', data: { content: [{ type: 'text', text: '任务甲' }] } })
  notifier.observe(session, { type: 'goal/change', data: { operation: 'set', goal: { phase: 'active' } } })
  notifier.observe(session, { type: 'turn/start', data: { turn: 1 } })
  notifier.observe(session, assistant('任务甲已经完成。'))
  notifier.observe(session, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
  assert.equal(sent.length, 0)
  notifier.observe(session, { type: 'goal/change', data: { operation: 'set', goal: { phase: 'complete', roundsStarted: 1 } } })
  assert.equal(sent.length, 1)
  assert.match(JSON.stringify(sent[0].card), /任务甲已经完成/)
  notifier.observe(session, { type: 'user/message', data: { content: [{ type: 'text', text: '任务乙' }] } })
  notifier.observe(session, { type: 'turn/start', data: { turn: 2 } })
  notifier.observe(session, assistant('任务乙已经完成。', 2))
  notifier.observe(session, { type: 'turn/end', data: { turn: 2, reason: { kind: 'completed' } } })
  await sleep(80)
  assert.equal(sent.length, 2)
  assert.match(JSON.stringify(sent[1].card), /任务乙已经完成/)
})

test('通知：agent disposed 缺少 turn/end 时按已知 goal 终态兜底发送', () => {
  const sent = []
  const notifier = makeNotifier(sent)
  const session = { id: 's-disposed' }
  notifier.observe(session, { type: 'user/message', data: { content: [{ type: 'text', text: '完成后关闭会话' }] } })
  notifier.observe(session, { type: 'goal/change', data: { operation: 'set', goal: { phase: 'active' } } })
  notifier.observe(session, { type: 'turn/start', data: { turn: 1 } })
  notifier.observe(session, assistant('任务已经完成，会话准备关闭。'))
  notifier.observe(session, { type: 'goal/change', data: { operation: 'set', goal: { phase: 'complete', roundsStarted: 1 } } })
  assert.equal(sent.length, 0)
  assert.equal(notifier.observeAgentDisposed(session), true)
  assert.equal(sent.length, 1)
  assert.equal(sent[0].card.header.title.content, '【DSH 处理完成】')
  assert.match(JSON.stringify(sent[0].card), /任务已经完成，会话准备关闭/)
})

test('通知：goal blocked 等待 turn/end 并带回模型说明', () => {
  const sent = []
  const notifier = makeNotifier(sent)
  const session = { id: 's4' }
  notifier.observe(session, { type: 'user/message', data: { message: { content: [{ type: 'text', text: '部署服务' }] } } })
  notifier.observe(session, { type: 'goal/change', data: { operation: 'set', goal: { phase: 'active' } } })
  notifier.observe(session, { type: 'turn/start', data: { turn: 1 } })
  notifier.observe(session, { type: 'goal/change', data: { operation: 'set', goal: { phase: 'blocked', roundsStarted: 1 } } })
  notifier.observe(session, assistant('缺少服务器地址，请补充后继续。'))
  assert.equal(sent.length, 0)
  notifier.observe(session, { type: 'turn/end', data: { turn: 1, reason: { kind: 'blocked' } } })
  assert.equal(sent.length, 1)
  assert.equal(sent[0].card.header.title.content, '【DSH 等待输入】')
  assert.match(JSON.stringify(sent[0].card), /缺少服务器地址，请补充后继续/)
})

test('通知：失败立即发送，卡片包含请求、模型回复和失败原因', () => {
  const sent = []
  const notifier = makeNotifier(sent)
  const session = { id: 's5' }
  notifier.observe(session, { type: 'user/message', data: { message: { content: [{ type: 'text', text: '执行部署' }] } } })
  notifier.observe(session, { type: 'turn/start', data: { turn: 1 } })
  notifier.observe(session, assistant('构建成功，但部署接口返回错误。'))
  notifier.observe(session, { type: 'turn/end', data: { turn: 1, reason: { kind: 'error', error: { message: '连接超时', code: 'E1' } } } })
  assert.equal(sent.length, 1)
  const text = JSON.stringify(sent[0].card)
  assert.match(text, /执行部署/)
  assert.match(text, /构建成功，但部署接口返回错误/)
  assert.match(text, /连接超时/)
})

test('通知：新任务没有回复时不会串入上一个任务结果', async () => {
  const sent = []
  const notifier = makeNotifier(sent)
  const session = { id: 's6' }
  notifier.observe(session, { type: 'user/message', data: { message: { content: [{ type: 'text', text: '任务一' }] } } })
  notifier.observe(session, { type: 'turn/start', data: { turn: 1 } })
  notifier.observe(session, assistant('任务一结果'))
  notifier.observe(session, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
  await sleep(80)
  // 模拟异常恢复时缺少第二个 user/message，仍不能复用任务一请求或回复。
  notifier.observe(session, { type: 'turn/start', data: { turn: 2 } })
  notifier.observe(session, { type: 'turn/end', data: { turn: 2, reason: { kind: 'error', error: { message: '任务二失败' } } } })
  assert.equal(sent.length, 2)
  const second = JSON.stringify(sent[1].card)
  assert.match(second, /任务二失败/)
  assert.match(second, /未记录原始请求/)
  assert.doesNotMatch(second, /任务一/)
})

test('通知：关闭时不发送且清除旧模型，重新打开后不能冒用旧路由', async () => {
  const sent = []
  let notifyOnComplete = false
  const notifier = createCompletionNotifier({
    getConfig: () => ({ notifyOnComplete, notifyChatId: 'oc_test' }),
    getClient: () => ({}),
    sendCard: async (client, chatId, card) => { sent.push({ chatId, card }); return 'm1' },
    settleMs: 20,
  })
  const session = { id: 's7' }
  notifier.observe(session, route('gpt-5.6'))
  notifier.observe(session, { type: 'user/message', data: { content: [{ type: 'text', text: '关闭期间的任务' }] } })
  notifier.observe(session, { type: 'turn/start', data: { turn: 1 } })
  notifier.observe(session, assistant('不会发送'))
  notifier.observe(session, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
  await sleep(80)
  assert.equal(sent.length, 0)
  notifyOnComplete = true
  notifier.observe(session, { type: 'user/message', data: { content: [{ type: 'text', text: '重新打开后的任务' }] } })
  notifier.observe(session, { type: 'turn/start', data: { turn: 2 } })
  notifier.observe(session, assistant('重新打开后完成', 2))
  notifier.observe(session, { type: 'turn/end', data: { turn: 2, reason: { kind: 'completed' } } })
  await sleep(80)
  assert.equal(sent.length, 1)
  assert.equal(sent[0].card.header.title.content, '【DSH 处理完成】')
})
