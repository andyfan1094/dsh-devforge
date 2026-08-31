/** 飞书任务完成卡片构造、TurnEndReason 归一化与通知订阅单测。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildCompletionCard, describeTurnEndReason } from '../src/feishu/outbound.mjs'
import { createCompletionNotifier } from '../src/feishu/completion-notifier.mjs'

test('buildCompletionCard：正常完成渲染绿色标题并带主题', () => {
  const card = buildCompletionCard({ subject: '修复登录页', turn: 3, durationMs: 65_000, reason: { kind: 'completed' } })
  assert.equal(card.schema, '2.0')
  assert.equal(card.header.template, 'green')
  assert.equal(card.header.title.content, '✅ 任务完成：修复登录页')
  const text = JSON.stringify(card)
  assert.match(text, /第 3 轮/)
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

test('buildCompletionCard：blocked 渲染黄色等待而不是失败', () => {
  const card = buildCompletionCard({ subject: '等确认', turn: 2, durationMs: 1_000, reason: { kind: 'blocked' } })
  assert.equal(card.header.template, 'yellow')
  assert.equal(card.header.title.content, '⏸ 任务等待输入：等确认')
})

test('buildCompletionCard：aborted 渲染灰色并带中止来源', () => {
  const card = buildCompletionCard({ subject: '长任务', turn: 4, durationMs: 1_000, reason: { kind: 'aborted', reason: 'user' } })
  assert.equal(card.header.template, 'grey')
  assert.equal(card.header.title.content, '⚪ 任务已中止：长任务')
  assert.match(JSON.stringify(card), /由用户中止/)
})

test('buildCompletionCard：旧字符串失败原因保持红色兼容', () => {
  const card = buildCompletionCard({ subject: '部署服务', turn: 1, durationMs: 2_500, reason: 'tool_failed:bash' })
  assert.equal(card.header.template, 'red')
  assert.equal(card.header.title.content, '❌ 任务失败：部署服务')
  assert.match(JSON.stringify(card), /tool_failed:bash/)
})

test('buildCompletionCard：主题为空时标题只有状态词且正文无主题行', () => {
  const card = buildCompletionCard({ turn: 1, durationMs: 0, reason: { kind: 'completed' } })
  assert.equal(card.header.title.content, '✅ 任务完成')
  assert.equal(card.body.elements[0]?.tag, 'div')
  assert.equal(card.body.elements[0]?.fields?.length, 2)
})

test('buildCompletionCard：超长主题标题截断且卡片保持小体积', () => {
  const huge = 'a'.repeat(500)
  const card = buildCompletionCard({ subject: huge, turn: 1, durationMs: 0, reason: { kind: 'completed' } })
  const body = JSON.stringify(card)
  assert.ok(body.length < 2_000)
  assert.ok(card.header.title.content.length <= '✅ 任务完成：'.length + 32)
})

test('describeTurnEndReason：max-tokens 视为完成并附说明', () => {
  const state = describeTurnEndReason({ kind: 'max-tokens' })
  assert.equal(state.failed, false)
  assert.match(state.text, /输出上限/)
})

test('describeTurnEndReason：未知对象兜底 JSON 且不输出 [object Object]', () => {
  const state = describeTurnEndReason({ foo: 'bar', baz: 1 })
  assert.equal(state.failed, true)
  assert.doesNotMatch(state.text, /\[object Object\]/)
  assert.match(state.text, /foo/)
})

test('createCompletionNotifier：主题取自最近用户消息且 reason 归一化', async () => {
  const sent = []
  const notifier = createCompletionNotifier({
    getConfig: () => ({ notifyOnComplete: true, notifyChatId: 'oc_test' }),
    getClient: () => ({}),
    sendCard: async (client, chatId, card) => { sent.push({ chatId, card }); return 'm1' },
  })
  const session = { id: 's1' }
  notifier.observe(session, { type: 'user/message', data: { message: { content: [{ type: 'text', text: '帮我统计今天的销售数据' }] } } })
  notifier.observe(session, { type: 'turn/start', data: { turn: 2 } })
  notifier.observe(session, { type: 'turn/end', data: { turn: 2, reason: { kind: 'completed' } } })
  assert.equal(sent.length, 1)
  assert.equal(sent[0].chatId, 'oc_test')
  assert.equal(sent[0].card.header.title.content, '✅ 任务完成：帮我统计今天的销售数据')
})

test('createCompletionNotifier：关闭开关时不发送', () => {
  const sent = []
  const notifier = createCompletionNotifier({
    getConfig: () => ({ notifyOnComplete: false, notifyChatId: 'oc_test' }),
    getClient: () => ({}),
    sendCard: async (client, chatId, card) => { sent.push({ chatId, card }); return 'm1' },
  })
  notifier.observe({ id: 's1' }, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
  assert.equal(sent.length, 0)
})
