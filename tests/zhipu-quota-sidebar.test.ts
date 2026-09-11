/** 「智谱 5 小时」侧栏卡片数据规整纯函数单测（自 dsh-zhipu-quota 0.3.0 移植）。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extractZhipuRows, formatResetCountdown, normalizeReset, percentLevel } from '../src/client/zhipu-quota-core.ts'

/** 造一条已配置渠道的用量（默认带 5h 窗口）。 */
function okUsage(label: string, primary: boolean, limits: Array<Record<string, unknown>>) {
  return { id: 'k-' + label, label, ref: 'REF', primary, ok: true, dashboard: { level: 'lite', limits, window: 'day', warnings: [] } }
}

const FIVE_H = { kind: 'tokens-5h', usedPercent: 55, nextResetTime: 1_800_000_000_000, details: [] }
const WEEK = { kind: 'tokens-week', usedPercent: 10, nextResetTime: 1_800_000_000_000, details: [] }

test('双渠道：各出一条 5 小时行，保持服务端池序（主 Key 在前），周窗口被过滤', () => {
  const rows = extractZhipuRows({ usages: [okUsage('主力', true, [FIVE_H, WEEK]), okUsage('主 Key', false, [WEEK, { kind: 'tokens-5h', usedPercent: 0, details: [] }])] })
  assert.deepEqual(rows.map((row) => row.label), ['主力', '主 Key'])
  assert.deepEqual(rows.map((row) => row.percent), [55, 0])
  assert.deepEqual(rows.map((row) => row.primary), [true, false])
})

test('双渠道：失败渠道跳过，不影响其余渠道', () => {
  const rows = extractZhipuRows({ usages: [{ id: 'x', label: '备用号', ref: 'REF', primary: false, ok: false, error: 'HTTP 401' }, okUsage('主力', true, [FIVE_H])] })
  assert.deepEqual(rows.map((row) => row.label), ['主力'])
})

test('双渠道：超过上限只保留前 4 行（池序优先）', () => {
  const usages = ['一', '二', '三', '四', '五', '六'].map((label, index) => okUsage(label, index === 0, [FIVE_H]))
  assert.equal(extractZhipuRows({ usages }).length, 4)
  assert.equal(extractZhipuRows({ usages }).at(-1)?.label, '四')
})

test('usedPercent 缺失时按 used/total 换算，异常值 clamp 到 0..100', () => {
  const rows = extractZhipuRows({ usages: [okUsage('甲', true, [{ kind: 'tokens-5h', used: 30, total: 200, details: [] }]), okUsage('乙', false, [{ kind: 'tokens-5h', usedPercent: 250, details: [] }])] })
  assert.equal(rows[0]?.percent, 15)
  assert.equal(rows[1]?.percent, 100)
})

test('进度分档：≥95 危险、≥80 警告、其余正常', () => {
  assert.equal(percentLevel(95), 'danger')
  assert.equal(percentLevel(80), 'warning')
  assert.equal(percentLevel(79.9), 'normal')
})

test('重置时间：秒级时间戳放大为毫秒，ISO 字符串可解析，非法返回 undefined', () => {
  assert.equal(normalizeReset(1_800_000_000), 1_800_000_000_000)
  assert.equal(normalizeReset('2027-01-01T00:00:00Z'), Date.parse('2027-01-01T00:00:00Z'))
  assert.equal(normalizeReset(undefined), undefined)
  assert.equal(normalizeReset('not-a-date'), undefined)
})

test('异常载荷：非对象/空 usages/空 label 均安全降级', () => {
  assert.deepEqual(extractZhipuRows(null), [])
  assert.deepEqual(extractZhipuRows({}), [])
  assert.deepEqual(extractZhipuRows({ usages: ['bad', null, { ok: true }] }), [])
  const unnamed = extractZhipuRows({ usages: [okUsage('   ', false, [FIVE_H])] })
  assert.equal(unnamed[0]?.label, '渠道')
})

test('行数据带规整后的 resetAt（毫秒），供倒计时渲染', () => {
  const rows = extractZhipuRows({ usages: [okUsage('主力', true, [FIVE_H])] })
  assert.equal(rows[0]?.resetAt, 1_800_000_000_000)
  const unknown = extractZhipuRows({ usages: [okUsage('甲', true, [{ kind: 'tokens-5h', usedPercent: 1, details: [] }])] })
  assert.equal(unknown[0]?.resetAt, undefined)
})

test('倒计时文案：分钟/小时分/天/即将重置/未知', () => {
  const now = 1_000_000_000_000
  assert.equal(formatResetCountdown(now + 30 * 60_000, now), '30 分钟后重置')
  assert.equal(formatResetCountdown(now + 2 * 3_600_000, now), '2 小时后重置')
  assert.equal(formatResetCountdown(now + 2 * 3_600_000 + 15 * 60_000, now), '2 小时 15 分后重置')
  assert.equal(formatResetCountdown(now + 3 * 86_400_000, now), '3 天后重置')
  assert.equal(formatResetCountdown(now - 1, now), '即将重置')
  assert.equal(formatResetCountdown(undefined, now), '')
})
