/**
 * 飞书通道提示注入的单测。
 * 背景：飞书桥会话的模型不知道自己在飞书通道，调用 ask_user_question 等交互工具时
 * 弹框只会出现在电脑端 Web 面板，手机用户看不到也无法作答（0.36.2 实测踩坑）。
 * 本组用例锁定 withFeishuChannelHint 的前缀注入与空值边界行为。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { withFeishuChannelHint } from '../src/feishu/feishu-client.mjs'

test('通道提示：非空文本前注入提示前缀，原文完整保留在后面', () => {
  const result = withFeishuChannelHint('给我官网地址')
  assert.ok(result.startsWith('【通道提示】'), '应以【通道提示】开头')
  assert.ok(result.endsWith('给我官网地址'), '用户原文应完整保留在末尾')
  assert.ok(result.includes('禁止调用 ask_user_question'), '必须明确禁止交互弹框类工具')
  assert.ok(result.includes('飞书'), '提示必须说明当前处于飞书通道')
})

test('通道提示：提示内容说明弹框只会出现在电脑端、用户无法作答', () => {
  const result = withFeishuChannelHint('测试')
  assert.ok(result.includes('电脑端'), '应说明弹框出现在电脑端')
  assert.ok(result.includes('无法作答'), '应说明用户无法作答的后果')
})

test('通道提示：纯文本输入用文字提问的替代方案写入提示', () => {
  const result = withFeishuChannelHint('帮我查一下')
  assert.ok(result.includes('直接在回复文字里提问'), '应给出文字提问的替代方案')
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
