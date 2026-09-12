/** 沙箱升级纪律注入：文本与宿主校验语义一致性的无网络单测。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SANDBOX_DISCIPLINE_SECTION_NAME, SANDBOX_DISCIPLINE_SECTION_ORDER, SANDBOX_DISCIPLINE_TEXT } from '../src/sandbox-discipline.ts'

test('沙箱升级纪律：节名与顺序不与既有节冲突', () => {
  assert.equal(SANDBOX_DISCIPLINE_SECTION_NAME, 'plugin:dsh-devforge:sandbox-discipline')
  // 项目约束节是 80，工具指引是 100-199，本节应夹在中间。
  assert.equal(SANDBOX_DISCIPLINE_SECTION_ORDER, 90)
})

test('沙箱升级纪律：文本给出绝对禁令与报错识别', () => {
  // 两条硬失败报错原文必须逐字出现（模型按报错原文识别自己带了不该带的字段）。
  assert.ok(SANDBOX_DISCIPLINE_TEXT.includes('not strictly wider'))
  assert.ok(SANDBOX_DISCIPLINE_TEXT.includes('invalid justification'))
  // 0.33.0 起改为绝对禁令：不再教"什么时候可以带"，而是禁止出现这两个字段
  // （教育式文本会被训练惯性强的 GPT/Codex 模型当成"有口子可用"）。
  assert.ok(SANDBOX_DISCIPLINE_TEXT.includes('一律禁止携带'))
  assert.ok(SANDBOX_DISCIPLINE_TEXT.includes('一次都不许'))
  // 错误恢复动作：去掉参数原样重发。
  assert.ok(SANDBOX_DISCIPLINE_TEXT.includes('去掉这两个字段'))
  // 真被沙箱拒绝时的唯一正确动作。
  assert.ok(SANDBOX_DISCIPLINE_TEXT.includes('[sandbox:'))
  assert.ok(SANDBOX_DISCIPLINE_TEXT.includes('向用户说明情况'))
})

test('沙箱升级纪律：不得包含注释终止序列或占位符', () => {
  assert.ok(!SANDBOX_DISCIPLINE_TEXT.includes('*/'))
  assert.ok(!SANDBOX_DISCIPLINE_TEXT.includes('TODO'))
  assert.ok(SANDBOX_DISCIPLINE_TEXT.trim().length > 0)
})
