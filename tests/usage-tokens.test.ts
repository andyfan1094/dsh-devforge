/** 模型 token 计量模块单测：行解析、多帧 zstd 解码、三窗聚合边界。 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { zstdCompressSync, constants as zstdConstants } from 'node:zlib'
import { buildReport, decodeSessionText, extractUsageFromLine, formatLocalDay, parseSessionText, scanZstdFrames } from '../src/usage/tokens.ts'

/** 构造一条 assistant/message 计量事件行（与宿主会话库实际结构一致）。 */
function usageLine(time: number, provider: string, model: string, input: number, output: number): string {
  return JSON.stringify({
    type: 'assistant/message',
    seq: 1,
    time,
    data: {
      turn: 1,
      step: 1,
      message: { role: 'assistant', content: [{ type: 'text', text: '你好' }], source: { kind: 'model', provider, model } },
      usage: { inputTokens: input, outputTokens: output },
    },
  })
}

test('行解析：正常计量行提取 provider/model/输入输出与本地日', () => {
  const line = usageLine(Date.UTC(2026, 8, 2, 5, 0, 0), 'zai-coding-cn', 'glm-5.3-flash', 1000, 200)
  const item = extractUsageFromLine(line)
  assert.ok(item !== null)
  assert.equal(item.provider, 'zai-coding-cn')
  assert.equal(item.model, 'glm-5.3-flash')
  assert.equal(item.input, 1000)
  assert.equal(item.output, 200)
})

test('行解析：非计量行、缺 usage、坏 JSON 全部返回 null', () => {
  assert.equal(extractUsageFromLine('{"type":"tool/call","data":{}}'), null)
  assert.equal(extractUsageFromLine('{"type":"assistant/message","data":{"message":{"source":{"provider":"p","model":"m"}}}}'), null)
  assert.equal(extractUsageFromLine('{broken json'), null)
  assert.equal(extractUsageFromLine(''), null)
})

test('多帧 zstd 容器：逐帧解压拼接，尾部 torn 帧安全忽略', () => {
  // 模仿 DSH：每批事件一个独立带校验和的帧，追加拼接；最后模拟半帧写入。
  const options = { params: { [zstdConstants.ZSTD_c_checksumFlag]: 1 } }
  const frameA = zstdCompressSync(Buffer.from('第一帧内容\n', 'utf8'), options)
  const frameB = zstdCompressSync(Buffer.from('第二帧内容\n', 'utf8'), options)
  const torn = zstdCompressSync(Buffer.from('第三帧还没有写完的内容', 'utf8'), options).subarray(0, 9)
  const container = Buffer.concat([frameA, frameB, torn])
  const frames = scanZstdFrames(container)
  assert.equal(frames.length, 2)
  const text = decodeSessionText(container)
  assert.equal(text, '第一帧内容\n第二帧内容\n')
})

test('parseSessionText：按本地日分桶累计', () => {
  const base = Date.UTC(2026, 8, 2, 3, 0, 0)
  const text = [
    usageLine(base, 'p1', 'm1', 100, 10),
    usageLine(base + 60_000, 'p1', 'm1', 50, 5),
    usageLine(base + 120_000, 'p2', 'm2', 7, 1),
  ].join('\n')
  const parsed = parseSessionText(text)
  assert.ok(parsed.days.size >= 1)
  // 三条事件都落在同一 UTC 时刻附近；本地日可能跨日，但同键累计必须正确。
  let m1Requests = 0
  let m1Input = 0
  let m2Requests = 0
  for (const bucket of parsed.days.values()) {
    for (const [key, agg] of bucket) {
      if (key.includes('m1')) { m1Requests += agg.requests; m1Input += agg.inputTokens }
      if (key.includes('m2')) m2Requests += agg.requests
    }
  }
  assert.equal(m1Requests, 2)
  assert.equal(m1Input, 150)
  assert.equal(m2Requests, 1)
})

test('buildReport：今日/本周/全部三窗边界正确', () => {
  // 固定 now 为某个周三中午，规避时区漂移：所有日期键都用同一 formatLocalDay 推导。
  const now = new Date(2026, 8, 2, 12, 0, 0).getTime() // 2026-09-02 周三 本地
  const todayKey = formatLocalDay(new Date(now))
  const thisMondayKey = formatLocalDay(new Date(now - 2 * 86_400_000)) // 周一
  const lastWeekKey = formatLocalDay(new Date(now - 9 * 86_400_000)) // 上上周四，必在窗口外
  const scanned = new Map([
    ['a', { days: new Map([
      [todayKey, new Map([['p\u241Ftoday-model', { requests: 1, inputTokens: 100, outputTokens: 10 }]])],
      [thisMondayKey, new Map([['p\u241Fweek-model', { requests: 2, inputTokens: 200, outputTokens: 20 }]])],
      [lastWeekKey, new Map([['p\u241Fold-model', { requests: 4, inputTokens: 400, outputTokens: 40 }]])],
    ]) }],
  ])
  const report = buildReport(scanned, now, [])
  assert.equal(report.all.rows.length, 3)
  assert.equal(report.all.inputTokens, 700)
  // 今日窗只含今天那一行。
  assert.equal(report.today.rows.length, 1)
  assert.equal(report.today.rows[0].model, 'today-model')
  assert.equal(report.today.inputTokens, 100)
  // 本周窗含周一与今天的两行（不含上周）。
  assert.equal(report.week.rows.length, 2)
  assert.equal(report.week.inputTokens, 300)
  // 行按总 token 降序。
  assert.deepEqual(report.all.rows.map((row) => row.model), ['old-model', 'week-model', 'today-model'])
  // 每日序列按日期升序，逐日合计正确（趋势图数据源）。
  assert.deepEqual(report.daily.map((point) => point.day), [lastWeekKey, thisMondayKey, todayKey])
  assert.deepEqual(report.daily.map((point) => point.inputTokens), [400, 200, 100])
  assert.deepEqual(report.daily.map((point) => point.requests), [4, 2, 1])
})
