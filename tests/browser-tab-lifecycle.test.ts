/** 标签页生命周期测试：来源标记、闲置评估建议与清理目标选择。 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  DEFAULT_TAB_IDLE_MS,
  TAB_ORIGIN_GENERAL,
  TAB_ORIGIN_XIANYU_MESSAGE,
  TAB_ORIGIN_XHS_PUBLISH,
  describeTabOrigin,
  evaluateTabCleanup,
  renderTabAdvice,
  type TabRecord,
} from '../src/browser/service.ts'

const NOW = 1_000_000_000
const MIN_IDLE = DEFAULT_TAB_IDLE_MS

const tab = (index: number, url: string, current = false) => ({ index, current, title: '页' + index, url })

const record = (index: number, url: string, origin: string, idleMs: number): TabRecord => ({ index, url, origin, lastActivityAt: NOW - idleMs })

test('evaluateTabCleanup：未知来源只提示不清理', () => {
  const tabs = [tab(0, 'https://a.example/')]
  const { advice, closeIndexes } = evaluateTabCleanup(tabs, [], { now: NOW, minIdleMs: MIN_IDLE })
  assert.equal(advice[0]!.suggestion, 'unknown')
  assert.equal(advice[0]!.origin, undefined)
  assert.equal(advice[0]!.idleSeconds, undefined)
  assert.deepEqual(closeIndexes, [])
})

test('evaluateTabCleanup：常驻闲鱼消息页始终保留', () => {
  const tabs = [tab(1, 'https://www.goofish.com/im', true)]
  const records = [record(1, 'https://www.goofish.com/im', TAB_ORIGIN_XIANYU_MESSAGE, 3_600_000)]
  const { advice, closeIndexes } = evaluateTabCleanup(tabs, records, { now: NOW, minIdleMs: MIN_IDLE, includeGeneral: true })
  assert.equal(advice[0]!.suggestion, 'keep')
  assert.deepEqual(closeIndexes, [])
})

test('evaluateTabCleanup：发布类任务残留达到阈值进入清理清单', () => {
  const url = 'https://creator.xiaohongshu.com/publish/publish'
  const tabs = [tab(2, url)]
  const records = [record(2, url, TAB_ORIGIN_XHS_PUBLISH, 700_000)]
  const { advice, closeIndexes } = evaluateTabCleanup(tabs, records, { now: NOW, minIdleMs: MIN_IDLE })
  assert.equal(advice[0]!.suggestion, 'clean')
  assert.deepEqual(closeIndexes, [2])
})

test('evaluateTabCleanup：任务进行中的发布页保留', () => {
  const url = 'https://www.goofish.com/publish'
  const tabs = [tab(3, url)]
  const records = [record(3, url, 'xianyu-publish', 30_000)]
  const { advice, closeIndexes } = evaluateTabCleanup(tabs, records, { now: NOW, minIdleMs: MIN_IDLE })
  assert.equal(advice[0]!.suggestion, 'keep')
  assert.deepEqual(closeIndexes, [])
})

test('evaluateTabCleanup：闲置通用页默认只建议，includeGeneral 才进清理清单', () => {
  const url = 'https://b.example/doc'
  const tabs = [tab(4, url)]
  const records = [record(4, url, TAB_ORIGIN_GENERAL, 700_000)]
  const conservative = evaluateTabCleanup(tabs, records, { now: NOW, minIdleMs: MIN_IDLE })
  assert.equal(conservative.advice[0]!.suggestion, 'review')
  assert.deepEqual(conservative.closeIndexes, [])
  const aggressive = evaluateTabCleanup(tabs, records, { now: NOW, minIdleMs: MIN_IDLE, includeGeneral: true })
  assert.deepEqual(aggressive.closeIndexes, [4])
})

test('evaluateTabCleanup：阈值边界取大于等于，且清理清单按序号降序', () => {
  const tabs = [tab(0, 'https://a.example/'), tab(1, 'https://b.example/'), tab(2, 'https://c.example/')]
  const records = [
    record(0, 'https://a.example/', TAB_ORIGIN_XHS_PUBLISH, 600_000),
    record(1, 'https://b.example/', 'xianyu-publish', 599_999),
    record(2, 'https://c.example/', TAB_ORIGIN_XHS_PUBLISH, 601_000),
  ]
  const { advice, closeIndexes } = evaluateTabCleanup(tabs, records, { now: NOW, minIdleMs: MIN_IDLE })
  assert.equal(advice[0]!.suggestion, 'clean')
  assert.equal(advice[1]!.suggestion, 'keep')
  assert.equal(advice[2]!.suggestion, 'clean')
  assert.deepEqual(closeIndexes, [2, 0])
})

test('renderTabAdvice 输出来源、空闲秒数与建议；空清单返回空串', () => {
  const url = 'https://creator.xiaohongshu.com/publish/publish'
  const { advice } = evaluateTabCleanup([tab(2, url)], [record(2, url, TAB_ORIGIN_XHS_PUBLISH, 700_000)], { now: NOW, minIdleMs: MIN_IDLE })
  const rendered = renderTabAdvice(advice)
  assert.ok(rendered.startsWith('### 标签页评估'))
  assert.ok(rendered.includes('来源=小红书发布'))
  assert.ok(rendered.includes('空闲=700秒'))
  assert.ok(rendered.includes('任务残留'))
  assert.equal(renderTabAdvice([]), '')
})

test('describeTabOrigin 把来源标记翻译成中文', () => {
  assert.equal(describeTabOrigin(TAB_ORIGIN_GENERAL), '通用')
  assert.equal(describeTabOrigin(TAB_ORIGIN_XHS_PUBLISH), '小红书发布')
  assert.equal(describeTabOrigin('xianyu-publish'), '闲鱼发布')
  assert.equal(describeTabOrigin(TAB_ORIGIN_XIANYU_MESSAGE), '闲鱼消息')
  assert.equal(describeTabOrigin(undefined), '未知')
  assert.equal(describeTabOrigin('mystery'), '未知')
})
