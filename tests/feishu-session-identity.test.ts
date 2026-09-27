/**
 * 飞书会话身份单测。
 * 背景：identity 决定 stableSessionIdOf 的哈希，identity 一变飞书聊天就落到全新会话、上下文全断。
 * 0.41.5 修：跟随默认模型时思考强度取自运行时状态（重启前后会漂移），参与身份会导致
 * 「每次重启都新开会话、每次都要重讲背景」（辉哥 2026-09-27 实录）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { selectionIdentity } from '../src/feishu/session-identity.mjs'
import { stableSessionIdOf } from '../src/feishu/index.mjs'

const BASE = { provider: 'tiangong', model: 'DeepSeek V4.1 Flash' }
const CHAT = 'oc_83aada9ffa4d7483c557b55b1caa8e82'

test('会话身份：跟随默认模型时思考强度漂移不改变身份（0.41.5 修重启断上下文）', () => {
  const high = selectionIdentity({ ...BASE, reasoningEffort: 'high' }, 'cordis', 'D:\\项目', true)
  const empty = selectionIdentity({ ...BASE, reasoningEffort: '' }, 'cordis', 'D:\\项目', true)
  const missing = selectionIdentity({ ...BASE }, 'cordis', 'D:\\项目', true)
  assert.equal(high, empty, '跟随默认时高强度与空强度必须等价')
  assert.equal(empty, missing, '跟随默认时字段缺失也必须等价')
  // 身份相同 → 会话 ID 相同，重启后才会复用同一个会话
  assert.equal(stableSessionIdOf(CHAT, high), stableSessionIdOf(CHAT, empty))
})

test('会话身份：显式配置模型时思考强度仍参与身份', () => {
  const high = selectionIdentity({ ...BASE, reasoningEffort: 'high' }, 'cordis', 'D:\\项目', false)
  const low = selectionIdentity({ ...BASE, reasoningEffort: 'low' }, 'cordis', 'D:\\项目', false)
  assert.notEqual(high, low, '用户显式改强度照旧换会话')
})

test('会话身份：模型/预设/工作目录任一变化都会换身份', () => {
  const baseline = selectionIdentity(BASE, 'cordis', 'D:\\项目', true)
  assert.notEqual(baseline, selectionIdentity({ ...BASE, model: 'GLM-4.6' }, 'cordis', 'D:\\项目', true))
  assert.notEqual(baseline, selectionIdentity({ ...BASE, provider: 'zhipu' }, 'cordis', 'D:\\项目', true))
  assert.notEqual(baseline, selectionIdentity(BASE, 'other-preset', 'D:\\项目', true))
  assert.notEqual(baseline, selectionIdentity(BASE, 'cordis', 'D:\\项目\\子目录', true))
})

test('会话身份：同输入可复现，且不同聊天互不串号', () => {
  const one = selectionIdentity({ ...BASE, reasoningEffort: 'medium' }, 'cordis', 'D:\\项目', true)
  const two = selectionIdentity({ ...BASE, reasoningEffort: 'medium' }, 'cordis', 'D:\\项目', true)
  assert.equal(one, two, '身份必须可复现')
  assert.notEqual(stableSessionIdOf(CHAT, one), stableSessionIdOf('oc_other_chat', one), '不同 chatId 必须落到不同会话')
})
