/** 飞书任务完成卡片构造与配置默认值单测。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildCompletionCard } from '../src/feishu/outbound.mjs'

test('buildCompletionCard：成功状态渲染绿色头与基本字段', () => {
  const card = buildCompletionCard({ subject: '  修复登录页  ', turn: 3, durationMs: 65_000, reason: 'success' })
  assert.equal(card.schema, '2.0')
  assert.equal(card.header.template, 'green')
  assert.equal(card.header.title.content, '✅ 任务完成')
  const text = JSON.stringify(card)
  assert.match(text, /修复登录页/)
  assert.match(text, /第 3 轮/)
  assert.match(text, /1 分 5 秒/)
})

test('buildCompletionCard：失败状态渲染红色头与原因', () => {
  const card = buildCompletionCard({ subject: '部署服务', turn: 1, durationMs: 2_500, reason: 'tool_failed:bash' })
  assert.equal(card.header.template, 'red')
  assert.equal(card.header.title.content, '❌ 任务失败')
  const text = JSON.stringify(card)
  assert.match(text, /部署服务/)
  assert.match(text, /tool_failed:bash/)
  assert.match(text, /3 秒/)
})

test('buildCompletionCard：缺省值容错', () => {
  const card = buildCompletionCard({})
  assert.equal(card.header.title.content, '✅ 任务完成')
  assert.equal(card.body.elements[0]?.text?.content, '**任务完成**')
})

test('buildCompletionCard：超长主题被截断并加安全后备', () => {
  const huge = 'a'.repeat(500)
  const card = buildCompletionCard({ subject: huge, turn: 1, durationMs: 0 })
  const body = JSON.stringify(card)
  assert.ok(body.length < 2_000)
  assert.match(body, /任务完成/)
})
