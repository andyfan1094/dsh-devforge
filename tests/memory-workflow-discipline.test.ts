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

test('记忆工作流：必须先了解记忆，再来看问题（0.66.0 强化）', () => {
  // 辉哥诉求（2026-10-20）：不是「看不懂才查」，而是任何问题到手都先把记忆里的
  // 相关内容了解清楚——这件事是什么、词指哪件事、既有约定与上次怎么做的——了解好了
  // 再回头理解并回答；只搜标题不算了解，命中后必须读正文。
  assert.ok(MEMORY_WORKFLOW_TEXT.includes('先了解记忆'))
  assert.ok(MEMORY_WORKFLOW_TEXT.includes('了解好了'))
  assert.ok(MEMORY_WORKFLOW_TEXT.includes('读明白'))
  assert.ok(MEMORY_WORKFLOW_TEXT.includes('读正文'))
  // 兜底口径不许退化成「问用户」：确实查不到才澄清。
  assert.ok(MEMORY_WORKFLOW_TEXT.includes('禁止没翻记忆就猜着回答'))
  assert.ok(MEMORY_WORKFLOW_TEXT.includes('空手反问'))
  assert.ok(MEMORY_WORKFLOW_TEXT.includes('检索不到任何相关记忆'))
  // 旧弱表述必须被替换掉：只写「检索相关记忆，带着命中的依据再继续」，
  // 模型会扫一眼标题就当已了解，这正是被否掉的口径。
  assert.ok(!MEMORY_WORKFLOW_TEXT.includes('带着命中的依据再继续'))
  // 顺序门禁：「先了解记忆」必须排在「再来看问题」之前，且整条位于「再核事实」之前。
  const learnIndex = MEMORY_WORKFLOW_TEXT.indexOf('先了解记忆')
  const lookIndex = MEMORY_WORKFLOW_TEXT.indexOf('再来看问题')
  const verifyIndex = MEMORY_WORKFLOW_TEXT.indexOf('再核事实')
  assert.ok(learnIndex >= 0 && lookIndex >= 0 && learnIndex < lookIndex, '先了解记忆必须位于再来看问题之前')
  assert.ok(learnIndex < verifyIndex, '了解记忆门禁必须位于再核事实之前')
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
