/**
 * 飞书会话标题：多机器人时带机器人名，单机器人保持原样。
 * 回归背景（2026-10-18）：同时接入「代码王者」和「天工助手」两个应用后，
 * DSH 会话列表里只看得到用户第一句话，分不清是哪个机器人开的会话。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { feishuSessionTitleOf } from '../src/feishu/index.mjs'

test('单机器人（不传名字）保持原有格式', () => {
  assert.equal(feishuSessionTitleOf('帮我看看服务器'), '飞书 · 帮我看看服务器')
  assert.equal(feishuSessionTitleOf('在？'), '飞书会话')
  assert.equal(feishuSessionTitleOf(''), '飞书会话')
})

test('多机器人时标题带上机器人名', () => {
  assert.equal(feishuSessionTitleOf('帮我看看服务器', '天工助手'), '飞书 · 天工助手 · 帮我看看服务器')
  assert.equal(feishuSessionTitleOf('在？', '天工助手'), '飞书 · 天工助手')
  assert.equal(feishuSessionTitleOf('', '代码王者'), '飞书 · 代码王者')
})

test('名字两端的空白不会污染标题，空名字等价于不传', () => {
  assert.equal(feishuSessionTitleOf('测试任务', '  天工助手  '), '飞书 · 天工助手 · 测试任务')
  assert.equal(feishuSessionTitleOf('测试任务', '   '), '飞书 · 测试任务')
})

test('摘要仍按 24 字截断，加名字不改变截断规则', () => {
  const long = '一'.repeat(40)
  assert.equal(feishuSessionTitleOf(long, '天工助手'), '飞书 · 天工助手 · ' + '一'.repeat(24))
})

test('开头的感叹号（插队标记）仍被剥掉', () => {
  assert.equal(feishuSessionTitleOf('!快看一眼', '天工助手'), '飞书 · 天工助手 · 快看一眼')
})
