/**
 * 飞书通道提示注入的单测。
 * 背景：飞书桥会话的模型不知道自己在飞书通道；除 ask_user_question（已由飞书答题器
 * 以互动卡片接管）外，其他电脑端 GUI 交互用户在手机上都看不到（0.36.2 实测踩坑）。
 * 本组用例锁定 withFeishuChannelHint 的前缀注入与空值边界行为。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { withFeishuChannelHint } from '../src/feishu/feishu-client.mjs'

test('通道提示：非空文本前注入提示前缀，原文完整保留在后面', () => {
  const result = withFeishuChannelHint('给我官网地址')
  assert.ok(result.startsWith('【通道提示】'), '应以【通道提示】开头')
  assert.ok(result.endsWith('给我官网地址'), '用户原文应完整保留在末尾')
  assert.ok(result.includes('飞书'), '提示必须说明当前处于飞书通道')
})

test('通道提示：说明 ask_user_question 由飞书卡片接管，可正常使用', () => {
  const result = withFeishuChannelHint('测试')
  assert.ok(result.includes('ask_user_question'), '应提到 ask_user_question')
  assert.ok(result.includes('互动卡片'), '应说明问题以飞书互动卡片送达')
})

test('通道提示：禁止依赖电脑端 GUI 的其他交互', () => {
  const result = withFeishuChannelHint('帮我查一下')
  assert.ok(result.includes('电脑端'), '应说明电脑端 GUI 不可见')
  assert.ok(result.includes('dsh_feishu_send_file'), '应给出飞书发送工具替代方案')
})

test('通道提示：空串原样返回，不产生纯提示的空消息', () => {
  assert.equal(withFeishuChannelHint(''), '')
})

test('通道提示：纯空白文本视为空，原样返回', () => {
  assert.equal(withFeishuChannelHint('   \n\t '), '')
})

test('通道提示：undefined / null 输入安全降级为空串', () => {
  assert.equal(withFeishuChannelHint(undefined), '')
  assert.equal(withFeishuChannelHint(null), '')
})

test('通道提示：前后空白被裁剪，原文内容不丢失', () => {
  const result = withFeishuChannelHint('  你好  ')
  assert.ok(result.includes('你好'))
  assert.ok(!result.includes('  你好  '), '不应保留未裁剪的原始空白')
})
