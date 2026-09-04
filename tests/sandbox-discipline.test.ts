/** 沙箱升级纪律注入：文本与宿主校验语义一致性的无网络单测。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SANDBOX_DISCIPLINE_SECTION_NAME, SANDBOX_DISCIPLINE_SECTION_ORDER, SANDBOX_DISCIPLINE_TEXT } from '../src/sandbox-discipline.ts'

test('沙箱升级纪律：节名与顺序不与既有节冲突', () => {
  assert.equal(SANDBOX_DISCIPLINE_SECTION_NAME, 'plugin:dsh-devforge:sandbox-discipline')
  // 项目约束节是 80，工具指引是 100-199，本节应夹在中间。
  assert.equal(SANDBOX_DISCIPLINE_SECTION_ORDER, 90)
})

test('沙箱升级纪律：文本覆盖宿主校验的每条失败路径', () => {
  // 两条死循环报错原文必须逐字出现（模型按报错原文检索规则）。
  assert.ok(SANDBOX_DISCIPLINE_TEXT.includes('not strictly wider'))
  assert.ok(SANDBOX_DISCIPLINE_TEXT.includes('invalid justification'))
  // 升级阶梯必须与 @deepseek-ai/dsh-sandbox 的 WIDER_MODES 单链一致。
  assert.ok(SANDBOX_DISCIPLINE_TEXT.includes('read-only → workspace-write → danger-full-access'))
  // 成对校验与拒绝即终局语义。
  assert.ok(SANDBOX_DISCIPLINE_TEXT.includes('成对出现'))
  assert.ok(SANDBOX_DISCIPLINE_TEXT.includes('终局'))
  // 错误恢复动作：去掉参数原样重发。
  assert.ok(SANDBOX_DISCIPLINE_TEXT.includes('去掉这两个字段'))
  // 拒绝标记的识别样板。
  assert.ok(SANDBOX_DISCIPLINE_TEXT.includes('[sandbox:'))
})

test('沙箱升级纪律：不得包含注释终止序列或占位符', () => {
  assert.ok(!SANDBOX_DISCIPLINE_TEXT.includes('*/'))
  assert.ok(!SANDBOX_DISCIPLINE_TEXT.includes('TODO'))
  assert.ok(SANDBOX_DISCIPLINE_TEXT.trim().length > 0)
})
