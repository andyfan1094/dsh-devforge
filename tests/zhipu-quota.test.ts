import assert from 'node:assert/strict'
import test from 'node:test'
import { classifyQuotaLimit, parseQuotaLimits } from '../src/zhipu/quota.ts'
import { mergeZhipuProvider } from '../src/zhipu/service.ts'

test('解析当前 CREDIT_LIMIT 的 5 小时和周额度', () => {
  const limits = parseQuotaLimits([
    { type: 'CREDIT_LIMIT', unit: 3, number: 5, percentage: 12.5, nextResetTime: '2026-08-30T12:00:00Z' },
    { type: 'CREDIT_LIMIT', unit: 6, number: 1, percentage: 44 },
  ])
  assert.deepEqual(limits.map((limit) => limit.kind), ['tokens-5h', 'tokens-week'])
  assert.equal(limits[0]?.usedPercent, 12.5)
})

test('兼容历史 TOKENS_LIMIT 和 MCP 额度', () => {
  const limits = parseQuotaLimits([
    { type: 'TIME_LIMIT', usageDetails: [{ modelCode: 'web-search', usage: 3 }] },
    { type: 'TOKENS_LIMIT', unit: 6, percentage: 20 },
    { type: 'TOKENS_LIMIT', unit: 3, percentage: 10 },
  ])
  assert.deepEqual(limits.map((limit) => limit.kind), ['tokens-5h', 'tokens-week', 'tools-month'])
  assert.deepEqual(limits[2]?.details, [{ name: 'web-search', used: 3 }])
})

test('模型完善只补缺失项并保留用户配置', () => {
  const merged = mergeZhipuProvider({
    apiKeyEnv: 'CUSTOM_ZHIPU_KEY',
    baseURL: 'https://gateway.example/v1',
    models: [{ id: 'glm-5.3', name: '自定义 GLM-5.3', maxTokens: 4096 }],
  }, 'ZAI_CODING_CN_API_KEY')
  assert.equal(merged.apiKeyEnv, 'CUSTOM_ZHIPU_KEY')
  assert.equal(merged.baseURL, 'https://gateway.example/v1')
  const models = merged.models as Array<Record<string, unknown>>
  assert.equal(models.length, 2)
  assert.equal(models[0]?.name, '自定义 GLM-5.3')
  assert.equal(models[0]?.maxTokens, 4096)
  assert.equal(models[1]?.id, 'glm-5.3-flash')
})

test('异常字段不会污染页面契约', () => {
  assert.equal(classifyQuotaLimit({ type: 'CREDIT_LIMIT', number: 5 }), 'tokens-5h')
  const limits = parseQuotaLimits([null, 'bad', { type: 'OTHER', percentage: Number.NaN }])
  assert.equal(limits.length, 1)
  assert.equal(limits[0]?.kind, 'unknown')
  assert.equal(limits[0]?.usedPercent, undefined)
})

test('侧栏方舟行：只提取已订阅套餐的 5 小时窗口，未配置/未订阅不占行', async () => {
  const { extractArkRows } = await import('../src/client/zhipu-quota-core.ts')
  const rows = extractArkRows({
    plans: [
      {
        product: 'agent-plan',
        subscribed: true,
        periods: [
          { level: '5h', used: 0, total: 100, usedPercent: 0 },
          { level: 'weekly', used: 0, total: 100, usedPercent: 0 },
        ],
      },
      {
        product: 'coding-plan',
        subscribed: true,
        periods: [{ level: '5h', used: 40, total: 100, usedPercent: 40, resetAt: 1_800_000_000_000 }],
      },
    ],
  })
  assert.deepEqual(rows.map((row) => row.label), ['方舟 Agent', '方舟 Coding'])
  assert.equal(rows[1]?.percent, 40)
  assert.equal(rows[1]?.resetAt, 1_800_000_000_000)
  assert.equal(rows[1]?.level, 'normal')

  // AK/SK 未配置（空 plans）与未订阅套餐都不产生行。
  assert.deepEqual(extractArkRows({ plans: [] }), [])
  assert.deepEqual(extractArkRows({
    plans: [{ product: 'coding-plan', subscribed: false, periods: [] }],
  }), [])
  // 非 5h 窗口（比如上游只回了 monthly）不冒充 5 小时行。
  assert.deepEqual(extractArkRows({
    plans: [{ product: 'agent-plan', subscribed: true, periods: [{ level: 'monthly', used: 1, total: 2, usedPercent: 50 }] }],
  }), [])
  // 异常载荷安全：null / 缺 plans 字段一律空行。
  assert.deepEqual(extractArkRows(null), [])
  assert.deepEqual(extractArkRows({}), [])
})

test('侧栏方舟行：周或月额度满时 5 小时窗口强制显示已满并注明阻断', async () => {
  const { extractArkRows } = await import('../src/client/zhipu-quota-core.ts')
  // 周额度满（100%），5h 实际只有 40%：显示必须拉满并标注阻断。
  const weeklyBlocked = extractArkRows({
    plans: [{
      product: 'coding-plan',
      subscribed: true,
      periods: [
        { level: '5h', used: 400, total: 1000, usedPercent: 40, resetAt: 1_800_000_000_000 },
        { level: 'weekly', used: 1000, total: 1000, usedPercent: 100 },
        { level: 'monthly', used: 30, total: 1000, usedPercent: 3 },
      ],
    }],
  })
  assert.equal(weeklyBlocked[0]?.percent, 100)
  assert.equal(weeklyBlocked[0]?.level, 'danger')
  assert.match(weeklyBlocked[0]?.label ?? '', /已阻断/)
  assert.match(weeklyBlocked[0]?.title ?? '', /周额度已满/)

  // 月额度满同样阻断。
  const monthlyBlocked = extractArkRows({
    plans: [{
      product: 'agent-plan',
      subscribed: true,
      periods: [
        { level: '5h', used: 10, total: 100, usedPercent: 10 },
        { level: 'monthly', used: 1000, total: 1000, usedPercent: 100 },
      ],
    }],
  })
  assert.equal(monthlyBlocked[0]?.percent, 100)
  assert.match(monthlyBlocked[0]?.title ?? '', /月额度已满/)

  // 周/月未满时保持 5h 真实值。
  const normal = extractArkRows({
    plans: [{
      product: 'coding-plan',
      subscribed: true,
      periods: [
        { level: '5h', used: 400, total: 1000, usedPercent: 40 },
        { level: 'weekly', used: 800, total: 1000, usedPercent: 80 },
        { level: 'monthly', used: 500, total: 1000, usedPercent: 50 },
      ],
    }],
  })
  assert.equal(normal[0]?.percent, 40)
  assert.doesNotMatch(normal[0]?.label ?? '', /已阻断/)
})
