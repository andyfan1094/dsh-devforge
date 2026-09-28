/**
 * 飞书会话身份单测。
 * 背景：identity 决定 stableSessionIdOf 的哈希，identity 一变飞书聊天就落到全新会话、上下文全断。
 * 0.41.5 修：跟随默认模型时思考强度取自运行时状态（重启前后会漂移），参与身份会导致
 * 「每次重启都新开会话、每次都要重讲背景」（辉哥 2026-09-27 实录）。
 * 0.41.7 定稿：模型三件套整体退出身份——在飞书里换模型/换 provider/换思考强度都复用同一会话，
 * 历史上下文保留（辉哥 2026-09-28 实录：换模型就新开会话）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { legacySelectionIdentity, selectionIdentity } from '../src/feishu/session-identity.mjs'
import { stableSessionIdOf } from '../src/feishu/index.mjs'

const BASE = { provider: 'tiangong', model: 'DeepSeek V4.1 Flash' }
const CHAT = 'oc_83aada9ffa4d7483c557b55b1caa8e82'

test('会话身份 0.41.7：换模型/provider/强度都不改变身份（飞书换模型不再换会话）', () => {
  const baseline = selectionIdentity(BASE, 'cordis', 'D:\\项目', true)
  assert.equal(baseline, selectionIdentity({ ...BASE, model: 'GLM-4.6' }, 'cordis', 'D:\\项目', true), '换模型必须复用同一会话')
  assert.equal(baseline, selectionIdentity({ ...BASE, provider: 'zhipu' }, 'cordis', 'D:\\项目', true), '换 provider 必须复用同一会话')
  assert.equal(baseline, selectionIdentity({ ...BASE, reasoningEffort: 'high' }, 'cordis', 'D:\\项目', false), '显式配置下换强度也必须复用同一会话')
  assert.equal(baseline, selectionIdentity({ provider: 'x', model: 'y' }, 'cordis', 'D:\\项目', true), '选择内容不同但身份等价')
  assert.equal(
    stableSessionIdOf(CHAT, baseline),
    stableSessionIdOf(CHAT, selectionIdentity({ ...BASE, model: 'GLM-4.6' }, 'cordis', 'D:\\项目', true)),
    '身份相同 → 会话 ID 相同，换模型后才会复用同一个会话',
  )
})

test('会话身份：预设与工作目录仍决定身份（换预设/换目录照旧换会话）', () => {
  const baseline = selectionIdentity(BASE, 'cordis', 'D:\\项目', true)
  assert.notEqual(baseline, selectionIdentity(BASE, 'other-preset', 'D:\\项目', true))
  assert.notEqual(baseline, selectionIdentity(BASE, 'cordis', 'D:\\项目\\子目录', true))
})

test('兼容身份：老算法仍复现含模型的三件套，且与新身份号不同（升级后可先试新号再试老号继承上下文）', () => {
  const legacy = legacySelectionIdentity({ ...BASE, reasoningEffort: 'max' }, 'ptc', 'D:\\项目', false)
  assert.equal(
    legacy,
    JSON.stringify({ provider: 'tiangong', model: 'DeepSeek V4.1 Flash', reasoningEffort: 'max', agentPreset: 'ptc', cwd: 'D:\\项目' }),
    '老身份串必须逐字段复现，否则算不出老会话号、接不回历史上下文',
  )
  const legacyId = stableSessionIdOf(CHAT, legacy)
  const freshId = stableSessionIdOf(CHAT, selectionIdentity({ ...BASE, reasoningEffort: 'max' }, 'ptc', 'D:\\项目', false))
  assert.notEqual(legacyId, freshId, '新老身份号必须不同，候选顺序才有意义')
  // 跟随默认时强度不参与老身份（0.41.5 的修复必须保留，否则老号算不出来）
  assert.equal(
    legacySelectionIdentity({ ...BASE, reasoningEffort: 'high' }, 'cordis', 'D:\\项目', true),
    legacySelectionIdentity({ ...BASE, reasoningEffort: '' }, 'cordis', 'D:\\项目', true),
  )
})

test('会话身份：同输入可复现，且不同聊天互不串号', () => {
  const one = selectionIdentity({ ...BASE, reasoningEffort: 'medium' }, 'cordis', 'D:\\项目', true)
  const two = selectionIdentity({ ...BASE, reasoningEffort: 'medium' }, 'cordis', 'D:\\项目', true)
  assert.equal(one, two, '身份必须可复现')
  assert.notEqual(stableSessionIdOf(CHAT, one), stableSessionIdOf('oc_other_chat', one), '不同 chatId 必须落到不同会话')
})
