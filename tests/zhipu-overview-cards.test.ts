/** Coding Plan 侧栏套餐用量卡片构建器：智谱多渠道（按 Key 池）展示与降级逻辑。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { INITIAL_CARD, zhipuCard, zhipuCardFromUsages } from '../src/client/panel/overview-cards.ts'
import type { ZhipuDashboard, ZhipuKeyUsage, ZhipuQuotaLimit } from '../src/zhipu/protocol.ts'

const RESET_AT = 1_700_000_000_000

/** 造一张智谱看板：默认带 5h + 本周两条窗口。 */
function makeDashboard(overrides?: Partial<{ level: string; limits: ZhipuQuotaLimit[] }>): ZhipuDashboard {
  return {
    level: overrides?.level,
    limits: overrides?.limits ?? [
      { kind: 'tokens-5h', usedPercent: 48, nextResetTime: RESET_AT, details: [] },
      { kind: 'tokens-week', usedPercent: 9, nextResetTime: RESET_AT, details: [] },
    ],
    modelUsage: { totalCalls: 0, totalTokens: 0, models: [] },
    toolUsage: { networkSearch: 0, webRead: 0, zread: 0 },
    window: 'day',
    fetchedAt: 0,
    warnings: [],
  }
}

/** 造一条按 Key 的成功用量。 */
function okUsage(label: string, primary: boolean, dashboard: ZhipuDashboard): ZhipuKeyUsage {
  return { id: 'key-' + label, label, ref: 'REF_' + label, primary, ok: true, dashboard }
}

/** 造一条按 Key 的失败用量。 */
function failUsage(label: string, primary: boolean, error: string): ZhipuKeyUsage {
  return { id: 'key-' + label, label, ref: 'REF_' + label, primary, ok: false, error }
}

const STATUS = { credentialConfigured: true }

test('初始卡片：加载态且未配置', () => {
  assert.equal(INITIAL_CARD.phase, 'loading')
  assert.equal(INITIAL_CARD.configured, false)
})

test('智谱单卡：窗口行与旧版一致（无渠道前缀）', () => {
  const card = zhipuCard(STATUS, makeDashboard({ level: 'GLM-4.7' }))
  assert.equal(card.phase, 'ready')
  assert.equal(card.configured, true)
  assert.equal(card.badge, 'GLM-4.7')
  assert.deepEqual(card.periods.map((period) => period.label), ['5 小时额度', '本周额度'])
  assert.equal(card.periods[0].usedPercent, 48)
  assert.equal(card.periods[0].resetAt, RESET_AT)
  assert.deepEqual(card.warnings, [])
})

test('智谱单卡：unknown 窗口过滤、usedPercent 缺失时按 used/total 换算并 clamp', () => {
  const dashboard = makeDashboard({
    limits: [
      { kind: 'unknown', usedPercent: 5, details: [] },
      { kind: 'tokens-5h', used: 30, total: 100, details: [] },
      { kind: 'tools-month', usedPercent: 250, details: [] },
    ],
  })
  const card = zhipuCard(STATUS, dashboard)
  assert.deepEqual(card.periods.map((period) => period.label), ['5 小时额度', '本月工具额度'])
  assert.equal(card.periods[0].usedPercent, 30)
  assert.equal(card.periods[1].usedPercent, 100)
})

test('智谱多渠道：双渠道各出 5h/本周两行，主 Key 在前，行首带渠道名', () => {
  const usages = [
    okUsage('主 Key', true, makeDashboard({ level: 'GLM-4.7' })),
    okUsage('备用号', false, makeDashboard()),
  ]
  const card = zhipuCardFromUsages(STATUS, usages)
  assert.equal(card.phase, 'ready')
  assert.deepEqual(card.periods.map((period) => period.label), [
    '主 Key · 5 小时额度',
    '主 Key · 本周额度',
    '备用号 · 5 小时额度',
    '备用号 · 本周额度',
  ])
  assert.equal(card.badge, 'GLM-4.7 · 2 渠道')
  assert.deepEqual(card.warnings, [])
})

test('智谱多渠道：5 小时额度行可被窗口级别推断命中（倒计时分档不回退）', () => {
  const card = zhipuCardFromUsages(STATUS, [okUsage('主 Key', true, makeDashboard()), okUsage('备用号', false, makeDashboard())])
  const fiveHour = card.periods.find((period) => period.label.includes('备用号') && period.label.includes('5 小时'))
  assert.notEqual(fiveHour, undefined)
  assert.ok(fiveHour.label.includes('5 小时'))
})

test('智谱多渠道：单渠道时退化为无前缀展示且不加渠道数', () => {
  const card = zhipuCardFromUsages(STATUS, [okUsage('主 Key', true, makeDashboard({ level: 'GLM-4.7' }))])
  assert.deepEqual(card.periods.map((period) => period.label), ['5 小时额度', '本周额度'])
  assert.equal(card.badge, 'GLM-4.7')
})

test('智谱多渠道：一把 Key 失败只降级为警示，其余渠道照常展示', () => {
  const usages = [
    okUsage('主 Key', true, makeDashboard()),
    failUsage('备用号', false, '智谱官方接口 HTTP 401'),
  ]
  const card = zhipuCardFromUsages(STATUS, usages)
  assert.equal(card.phase, 'ready')
  assert.deepEqual(card.periods.map((period) => period.label), ['主 Key · 5 小时额度', '主 Key · 本周额度'])
  assert.deepEqual(card.warnings, ['备用号 用量读取失败：智谱官方接口 HTTP 401'])
})

test('智谱多渠道：全部失败整卡转错误态，错误含各渠道明细', () => {
  const card = zhipuCardFromUsages(STATUS, [
    failUsage('主 Key', true, 'HTTP 429'),
    failUsage('备用号', false, 'HTTP 401'),
  ])
  assert.equal(card.phase, 'error')
  assert.equal(card.periods.length, 0)
  assert.equal(card.error, '主 Key 用量读取失败：HTTP 429；备用号 用量读取失败：HTTP 401')
})

test('智谱多渠道：渠道为空按凭据状态给出待配置或暂无数据', () => {
  const unconfigured = zhipuCardFromUsages(STATUS, [])
  assert.equal(unconfigured.phase, 'ready')
  assert.equal(unconfigured.configured, true)
  assert.equal(unconfigured.periods.length, 0)
  const noStatus = zhipuCardFromUsages(null, [])
  assert.equal(noStatus.configured, false)
})

test('智谱多渠道：失败 Key 失去 error 字段时警示兜底为未知错误', () => {
  const usage: ZhipuKeyUsage = { id: 'k', label: '备用号', ref: 'REF', primary: false, ok: false }
  const card = zhipuCardFromUsages(STATUS, [usage])
  assert.deepEqual(card.warnings, ['备用号 用量读取失败：未知错误'])
})
