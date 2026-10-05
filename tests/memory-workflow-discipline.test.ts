/**
 * 记忆工作流纪律注入：文本与插件真实能力一致性的无网络单测。
 *
 * 这段文本是「每轮必达」的常驻指令，一旦措辞漂移（承诺库里没有的能力、
 * 或丢掉闭环三步中的任一步），模型就会退回「不查就答 / 拿过期记忆当现状」。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MEMORY_WORKFLOW_SECTION_NAME, MEMORY_WORKFLOW_SECTION_ORDER, MEMORY_WORKFLOW_TEXT } from '../src/memory/workflow-discipline.ts'

test('记忆工作流：节名与顺序不与既有节冲突', () => {
  assert.equal(MEMORY_WORKFLOW_SECTION_NAME, 'plugin:dsh-devforge:memory-workflow')
  // 用户身份卡 50、项目约束 80、沙箱纪律/插件总览 90：本节夹在约束与沙箱之间。
  assert.equal(MEMORY_WORKFLOW_SECTION_ORDER, 85)
})

test('记忆工作流：闭环三步齐全（先查记忆 → 再核事实 → 回写修正）', () => {
  assert.ok(MEMORY_WORKFLOW_TEXT.includes('先查记忆'))
  assert.ok(MEMORY_WORKFLOW_TEXT.includes('再核事实'))
  assert.ok(MEMORY_WORKFLOW_TEXT.includes('回写修正'))
  // 回写是义务而非可选项：这是辉哥诉求的核心（发现记忆有误必须更新记忆）。
  assert.ok(MEMORY_WORKFLOW_TEXT.includes('不是可选项'))
  // 可变事实不得凭记忆断言。
  assert.ok(MEMORY_WORKFLOW_TEXT.includes('可变事实'))
})

test('记忆工作流：只承诺插件真实具备的工具能力', () => {
  assert.ok(MEMORY_WORKFLOW_TEXT.includes('rag_search'))
  assert.ok(MEMORY_WORKFLOW_TEXT.includes('memory_manage'))
  // pinned 是常驻钉选的真实入口，写错会让模型无法把规则钉成常驻。
  assert.ok(MEMORY_WORKFLOW_TEXT.includes('pinned=true'))
  // 冲突时替换而非堆积旧说法。
  assert.ok(MEMORY_WORKFLOW_TEXT.includes('替换'))
})

test('记忆工作流：不得包含注释终止序列或占位符', () => {
  assert.ok(!MEMORY_WORKFLOW_TEXT.includes('*/'))
  assert.ok(!MEMORY_WORKFLOW_TEXT.includes('TODO'))
  assert.ok(MEMORY_WORKFLOW_TEXT.trim().length > 0)
})
