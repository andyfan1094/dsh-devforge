/** 飞书任务完成卡片构造、TurnEndReason 归一化与「整个任务收敛才通知」单测。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildCompletionCard, describeTurnEndReason } from '../src/feishu/outbound.mjs'
import { createCompletionNotifier } from '../src/feishu/completion-notifier.mjs'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function makeNotifier(sent, overrides = {}) {
  return createCompletionNotifier({
    getConfig: () => ({ notifyOnComplete: true, notifyChatId: 'oc_test' }),
    getClient: () => ({}),
    sendCard: async (client, chatId, card) => { sent.push({ chatId, card }); return 'm1' },
    settleMs: 20,
    ...overrides,
  })
}

test('buildCompletionCard：正常完成渲染绿色标题并带主题，轮次显示共 N 轮', () => {
  const card = buildCompletionCard({ subject: '修复登录页', turn: 3, durationMs: 65_000, reason: { kind: 'completed' } })
  assert.equal(card.schema, '2.0')
  assert.equal(card.header.template, 'green')
  assert.equal(card.header.title.content, '✅ 任务完成：修复登录页')
  const text = JSON.stringify(card)
  assert.match(text, /共 3 轮/)
  assert.match(text, /1 分 5 秒/)
  assert.doesNotMatch(text, /原因/)
})

test('buildCompletionCard：失败渲染红色标题与可读原因', () => {
  const card = buildCompletionCard({
    subject: '部署服务', turn: 1, durationMs: 2_500,
    reason: { kind: 'error', error: { message: '上游连接超时', code: 'ETIMEDOUT' } },
  })
  assert.equal(card.header.template, 'red')
  assert.equal(card.header.title.content, '❌ 任务失败：部署服务')
  const text = JSON.stringify(card)
  assert.match(text, /上游连接超时/)
  assert.match(text, /ETIMEDOUT/)
})

test('buildCompletionCard：结构化 reason 绝不输出 [object Object]', () => {
  const failed = buildCompletionCard({ subject: 'X', turn: 1, durationMs: 0, reason: { kind: 'error', error: { message: 'boom' } } })
  assert.doesNotMatch(JSON.stringify(failed), /\[object Object\]/)
  const weird = buildCompletionCard({ subject: 'X', turn: 1, durationMs: 0, reason: { foo: 'bar' } })
  const weirdText = JSON.stringify(weird)
  assert.doesNotMatch(weirdText, /\[object Object\]/)
  assert.match(weirdText, /foo/)
})

test('buildCompletionCard：blocked/paused 渲染黄色，aborted 渲染灰色', () => {
  assert.equal(buildCompletionCard({ subject: 'A', turn: 1, durationMs: 0, reason: { kind: 'blocked' } }).header.title.content, '⏸ 任务等待输入：A')
  assert.equal(buildCompletionCard({ subject: 'B', turn: 1, durationMs: 0, reason: { kind: 'paused' } }).header.title.content, '⏸ 任务已暂停：B')
  const aborted = buildCompletionCard({ subject: 'C', turn: 1, durationMs: 0, reason: { kind: 'aborted', reason: 'user' } })
  assert.equal(aborted.header.title.content, '⚪ 任务已中止：C')
  assert.match(JSON.stringify(aborted), /由用户中止/)
})

test('describeTurnEndReason：旧字符串失败原因与未知对象兼容', () => {
  assert.equal(describeTurnEndReason('tool_failed:bash').failed, true)
  const state = describeTurnEndReason({ foo: 'bar' })
  assert.equal(state.failed, true)
  assert.doesNotMatch(state.text, /\[object Object\]/)
  assert.equal(describeTurnEndReason({ kind: 'max-tokens' }).failed, false)
})

test('通知：连续多轮收敛后只发一张，聚合共 N 轮', async () => {
  const sent = []
  const notifier = makeNotifier(sent)
  const session = { id: 's1' }
  notifier.observe(session, { type: 'user/message', data: { message: { content: [{ type: 'text', text: '帮我统计今天的销售数据' }] } } })
  notifier.observe(session, { type: 'turn/start', data: { turn: 1 } })
  notifier.observe(session, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
  notifier.observe(session, { type: 'turn/start', data: { turn: 2 } })
  notifier.observe(session, { type: 'turn/end', data: { turn: 2, reason: { kind: 'completed' } } })
  assert.equal(sent.length, 0)
  await sleep(80)
  assert.equal(sent.length, 1)
  assert.equal(sent[0].card.header.title.content, '✅ 任务完成：帮我统计今天的销售数据')
  assert.match(JSON.stringify(sent[0].card), /共 2 轮/)
})

test('通知：收敛前开启新轮次则继续静默', async () => {
  const sent = []
  const notifier = makeNotifier(sent)
  const session = { id: 's2' }
  notifier.observe(session, { type: 'turn/start', data: { turn: 1 } })
  notifier.observe(session, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
  notifier.observe(session, { type: 'turn/start', data: { turn: 2 } })
  await sleep(80)
  assert.equal(sent.length, 0)
})

test('通知：goal active 期间静默，goal complete 收敛点只发一张', async () => {
  const sent = []
  const notifier = makeNotifier(sent)
  const session = { id: 's3' }
  notifier.observe(session, { type: 'goal/change', data: { operation: 'set', goal: { phase: 'active', roundsStarted: 1 } } })
  for (const turn of [1, 2, 3]) {
    notifier.observe(session, { type: 'turn/start', data: { turn } })
    notifier.observe(session, { type: 'turn/end', data: { turn, reason: { kind: 'completed' } } })
  }
  await sleep(80)
  assert.equal(sent.length, 0)
  notifier.observe(session, { type: 'goal/change', data: { operation: 'set', goal: { phase: 'complete', roundsStarted: 3 } } })
  assert.equal(sent.length, 1)
  assert.equal(sent[0].card.header.title.content, '✅ 任务完成')
  assert.match(JSON.stringify(sent[0].card), /共 3 轮/)
})

test('通知：goal blocked 发等待输入卡', () => {
  const sent = []
  const notifier = makeNotifier(sent)
  const session = { id: 's4' }
  notifier.observe(session, { type: 'goal/change', data: { operation: 'set', goal: { phase: 'active' } } })
  notifier.observe(session, { type: 'turn/start', data: { turn: 1 } })
  notifier.observe(session, { type: 'turn/end', data: { turn: 1, reason: { kind: 'blocked' } } })
  notifier.observe(session, { type: 'goal/change', data: { operation: 'set', goal: { phase: 'blocked', roundsStarted: 1 } } })
  assert.equal(sent.length, 1)
  assert.equal(sent[0].card.header.title.content, '⏸ 任务等待输入')
})

test('通知：失败与中止立即发卡不等待收敛', async () => {
  const sent = []
  const notifier = makeNotifier(sent)
  const session = { id: 's5' }
  notifier.observe(session, { type: 'turn/start', data: { turn: 1 } })
  notifier.observe(session, { type: 'turn/end', data: { turn: 1, reason: { kind: 'error', error: { message: ' boom', code: 'E1' } } } })
  assert.equal(sent.length, 1)
  assert.equal(sent[0].card.header.template, 'red')
  notifier.observe(session, { type: 'turn/start', data: { turn: 2 } })
  notifier.observe(session, { type: 'turn/end', data: { turn: 2, reason: { kind: 'aborted', reason: 'user' } } })
  assert.equal(sent.length, 2)
  assert.equal(sent[1].card.header.template, 'grey')
})

test('通知：关闭开关时不发送', async () => {
  const sent = []
  const notifier = createCompletionNotifier({
    getConfig: () => ({ notifyOnComplete: false, notifyChatId: 'oc_test' }),
    getClient: () => ({}),
    sendCard: async (client, chatId, card) => { sent.push({ chatId, card }); return 'm1' },
    settleMs: 20,
  })
  notifier.observe({ id: 's6' }, { type: 'turn/start', data: { turn: 1 } })
  notifier.observe({ id: 's6' }, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
  await sleep(80)
  assert.equal(sent.length, 0)
})
