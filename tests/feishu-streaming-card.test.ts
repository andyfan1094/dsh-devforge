/**
 * 流式卡片「停止任务」按钮生命周期单测。
 * 背景：2026-09-27 辉哥反馈——飞书会话模型回复完成后，卡片底部仍留着「停止任务」按钮，
 * 用户会点到已结束的任务。修复要求：进行中保留按钮，收尾（finish）后必须摘除。
 * 本组用例锁定 buildStreamingCard 的 showStop 契约与收尾态其它元素完整性。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildStreamingCard, CARD_STOP_ACTION } from '../src/feishu/feishu-client.mjs'

/** 从卡片 body.elements 中取出元素 id 列表，便于断言元素增删。 */
function elementIds(card: { body?: { elements?: Array<{ element_id?: string }> } }): string[] {
  const elements = card?.body?.elements
  if (!Array.isArray(elements)) return []
  return elements.map((element) => String(element?.element_id ?? ''))
}

/** 取出停止按钮元素（不存在时返回 undefined）。 */
function stopButtonOf(card: { body?: { elements?: Array<Record<string, unknown>> } }) {
  const elements = card?.body?.elements
  if (!Array.isArray(elements)) return undefined
  return elements.find((element) => element?.element_id === 'dsh_feishu_stop_btn')
}

test('进行中卡片：默认渲染停止按钮，回调动作为 stop', () => {
  const card = buildStreamingCard('正在处理')
  const button = stopButtonOf(card as never)
  assert.ok(button, '进行中必须带停止按钮')
  const behaviors = button?.behaviors as Array<{ type?: string; value?: { action?: string } }> | undefined
  assert.equal(behaviors?.[0]?.type, 'callback', '按钮必须是回调按钮')
  assert.equal(behaviors?.[0]?.value?.action, CARD_STOP_ACTION, '回调动作须为 stop')
})

test('收尾卡片：showStop=false 时摘除停止按钮', () => {
  const card = buildStreamingCard('已完成', { streaming: false, showStop: false })
  assert.equal(stopButtonOf(card as never), undefined, '收尾卡片不得残留停止按钮')
})

test('收尾卡片：摘按钮不影响状态/工具/正文/页脚四元素', () => {
  const card = buildStreamingCard('最终答案', {
    streaming: false,
    status: '**已完成**',
    tools: 'read_file',
    footer: '模型：GLM-Flash · 耗时：3秒',
    showStop: false,
  })
  const ids = elementIds(card as never)
  assert.ok(ids.includes('dsh_feishu_status'), '状态元素保留')
  assert.ok(ids.includes('dsh_feishu_tools'), '工具元素保留')
  assert.ok(ids.includes('dsh_feishu_answer'), '正文元素保留')
  assert.ok(ids.includes('dsh_feishu_meta'), '页脚元素保留')
  const elements = (card as { body: { elements: Array<Record<string, unknown>> } }).body.elements
  const meta = elements.find((element) => element.element_id === 'dsh_feishu_meta')
  const metaText = (meta?.text ?? {}) as { element_id?: string; content?: string }
  assert.equal(metaText.element_id, 'dsh_feishu_meta_txt', '页脚文本元素 id 不变（CardKit 增量更新依赖）')
  assert.equal(metaText.content, '模型：GLM-Flash · 耗时：3秒', '页脚内容须透传')
  const tools = elements.find((element) => element.element_id === 'dsh_feishu_tools')
  const toolsText = (tools?.text ?? {}) as { element_id?: string; content?: string }
  assert.equal(toolsText.element_id, 'dsh_feishu_tools_txt', '工具文本元素 id 不变（CardKit 增量更新依赖）')
  assert.equal(toolsText.content, 'read_file', '工具内容须透传')
  const answer = elements.find((element) => element.element_id === 'dsh_feishu_answer')
  assert.equal(answer?.content, '最终答案', '正文内容须为最终答复')
})

test('收尾卡片：关闭流式模式且不再带 streaming_config', () => {
  const card = buildStreamingCard('完成', { streaming: false, showStop: false }) as {
    config?: { streaming_mode?: boolean; streaming_config?: unknown }
  }
  assert.equal(card.config?.streaming_mode, false, '收尾后必须关闭流式模式')
  assert.equal(card.config?.streaming_config, undefined, '非流式不再携带打字机配置')
})

test('进行中卡片：保留流式模式与打字机配置', () => {
  const card = buildStreamingCard('处理中') as {
    config?: { streaming_mode?: boolean; streaming_config?: unknown }
  }
  assert.equal(card.config?.streaming_mode, true)
  assert.ok(card.config?.streaming_config, '流式模式应带打字机配置')
})

test('摘要截断：summary 超长时截到 120 字符', () => {
  const long = '答'.repeat(200)
  const card = buildStreamingCard(long, { summary: long }) as { config?: { summary?: { content?: string } } }
  assert.equal(card.config?.summary?.content?.length, 120)
})

test('空正文兜底：内容为空时渲染占位文本而非空卡片', () => {
  const card = buildStreamingCard('', { streaming: false, showStop: false }) as {
    body?: { elements?: Array<{ element_id?: string; content?: string }> }
  }
  const answer = card.body?.elements?.find((element) => element.element_id === 'dsh_feishu_answer')
  assert.ok(String(answer?.content ?? '').length > 0, '正文元素不得为空字符串')
})
