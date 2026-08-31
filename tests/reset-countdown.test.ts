/** Coding Plan 重置时间徽章：覆盖三个 resolver 的文本与紧急度分档。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  resolveArkReset,
  resolveGenericReset,
  resolveOverviewReset,
  resolveZhipuReset,
} from '../src/client/panel/reset-countdown.ts'

const NOW = 1_700_000_000_000
const MS_MIN = 60_000
const MS_HOUR = 60 * MS_MIN
const MS_DAY = 24 * MS_HOUR

test('方舟重置：基本分钟/小时/天文本', () => {
  assert.equal(resolveArkReset({ level: '5h', resetAt: NOW + 30 * MS_MIN }, NOW).text, '30 分钟后重置')
  assert.equal(resolveArkReset({ level: '5h', resetAt: NOW + 2 * MS_HOUR + 15 * MS_MIN }, NOW).text, '2 小时 15 分钟后重置')
  assert.equal(resolveArkReset({ level: 'weekly', resetAt: NOW + 6 * MS_DAY + 3 * MS_HOUR }, NOW).text, '6 天 3 小时后重置')
  assert.equal(resolveArkReset({ level: '5h', resetAt: NOW + 41 * MS_MIN }, NOW).text, '41 分钟后重置')
})

test('方舟重置：缺失 resetAt 返回未知视图', () => {
  const view = resolveArkReset({ level: '5h', resetAt: undefined }, NOW)
  assert.equal(view.text, '重置时间未知')
  assert.equal(view.urgency, 'normal')
})

test('方舟重置：时间已过 clamp 到 0 并标记即将重置', () => {
  const view = resolveArkReset({ level: '5h', resetAt: NOW - 1000 }, NOW)
  assert.equal(view.text, '即将重置')
  assert.equal(view.remainingMs, 0)
})

test('方舟重置：5h 窗口临界 1h 与 3h', () => {
  assert.equal(resolveArkReset({ level: '5h', resetAt: NOW + 60 * MS_MIN }, NOW).urgency, 'danger')
  assert.equal(resolveArkReset({ level: '5h', resetAt: NOW + 61 * MS_MIN }, NOW).urgency, 'warning')
  assert.equal(resolveArkReset({ level: '5h', resetAt: NOW + 3 * MS_HOUR }, NOW).urgency, 'warning')
  assert.equal(resolveArkReset({ level: '5h', resetAt: NOW + 3 * MS_HOUR + 1 }, NOW).urgency, 'normal')
})

test('方舟重置：周窗口临界 6h 与 24h', () => {
  assert.equal(resolveArkReset({ level: 'weekly', resetAt: NOW + 6 * MS_HOUR }, NOW).urgency, 'danger')
  assert.equal(resolveArkReset({ level: 'weekly', resetAt: NOW + 6 * MS_HOUR + 1 }, NOW).urgency, 'warning')
  assert.equal(resolveArkReset({ level: 'weekly', resetAt: NOW + 24 * MS_HOUR }, NOW).urgency, 'warning')
  assert.equal(resolveArkReset({ level: 'weekly', resetAt: NOW + 24 * MS_HOUR + 1 }, NOW).urgency, 'normal')
})

test('智谱重置：兼容 ISO 字符串、秒级与毫秒级数字', () => {
  const iso = resolveZhipuReset(new Date(NOW + 30 * MS_MIN).toISOString(), NOW, 'tokens-5h')
  assert.equal(iso.text, '30 分钟后重置')
  assert.equal(iso.urgency, 'danger')
  const seconds = resolveZhipuReset(Math.floor((NOW + 30 * MS_MIN) / 1000), NOW, 'tokens-5h')
  assert.equal(seconds.text, '30 分钟后重置')
  const millis = resolveZhipuReset(NOW + 30 * MS_MIN, NOW, 'tokens-5h')
  assert.equal(millis.text, '30 分钟后重置')
})

test('智谱重置：非法字符串返回未知视图', () => {
  assert.equal(resolveZhipuReset('not-a-date', NOW, 'tokens-5h').text, '重置时间未知')
})

test('智谱重置：按 kind 区分 5h vs 周窗口阈值', () => {
  assert.equal(resolveZhipuReset(NOW + 2 * MS_HOUR, NOW, 'tokens-5h').urgency, 'warning')
  assert.equal(resolveZhipuReset(NOW + 2 * MS_HOUR, NOW, 'tokens-week').urgency, 'danger')
  assert.equal(resolveZhipuReset(NOW + 12 * MS_HOUR, NOW, 'tokens-5h').urgency, 'normal')
  assert.equal(resolveZhipuReset(NOW + 12 * MS_HOUR, NOW, 'tokens-week').urgency, 'warning')
})

test('通用重置：按 level 字段推断窗口级别', () => {
  const inputs = ['5h', 'session', 'interval', 'weekly', 'week', 'monthly', 'month', 'other', '']
  for (const input of inputs) {
    const view = resolveGenericReset(NOW + MS_HOUR, NOW, input)
    assert.equal(view.urgency, 'danger', '1h 剩余应当升 danger for ' + input)
  }
  assert.equal(resolveGenericReset(NOW + 12 * MS_HOUR, NOW, '5h').urgency, 'normal')
  assert.equal(resolveGenericReset(NOW + 12 * MS_HOUR, NOW, 'weekly').urgency, 'warning')
  assert.equal(resolveGenericReset(NOW + 12 * MS_HOUR, NOW, 'monthly').urgency, 'warning')
  assert.equal(resolveGenericReset(NOW + 30 * MS_MIN, NOW, '5h').urgency, 'danger')
  assert.equal(resolveGenericReset(NOW + 30 * MS_MIN, NOW, 'weekly').urgency, 'danger')
  assert.equal(resolveGenericReset(NOW + 30 * MS_MIN, NOW, 'monthly').urgency, 'danger')
})

test('Overview 重置：单一粒度文案', () => {
  assert.equal(resolveOverviewReset(NOW + 30 * MS_MIN, NOW, 'short-window').text, '30 分钟后重置')
  assert.equal(resolveOverviewReset(NOW + 5 * MS_HOUR, NOW, 'weekly').text, '5 小时后重置')
  assert.equal(resolveOverviewReset(NOW + 3 * MS_DAY, NOW, 'monthly').text, '3 天后重置')
})

test('Overview 重置：保留 Overview 原剩余 <= 0 直接即将重置语义', () => {
  assert.equal(resolveOverviewReset(NOW - 1000, NOW, 'weekly').text, '即将重置')
  assert.equal(resolveOverviewReset(undefined, NOW, 'weekly').text, '重置时间未知')
})
