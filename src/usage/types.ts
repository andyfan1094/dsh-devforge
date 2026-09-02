/**
 * 用量看板共享类型 —— 纯类型定义，零运行时依赖（client bundle 安全）。
 * 背景：tokens.ts 宿主实现依赖 node:zlib/node:fs，任何 import（含 type-only）
 * 都可能被 Rolldown 拉进客户端 bundle 导致插件加载失败（0.14.2/0.14.3 两轮实证）。
 * 因此类型拆到本文件：client 侧只许 import 本文件，宿主侧 tokens.ts 再导出保持兼容。
 */

export interface TokenUsageRow {
  provider: string
  model: string
  requests: number
  inputTokens: number
  outputTokens: number
}

export interface TokenUsageWindow {
  /** 汇总行（全部模型，不截断）。 */
  requests: number
  inputTokens: number
  outputTokens: number
  /** 按总 token 降序的模型明细。 */
  rows: TokenUsageRow[]
}

export interface TokenUsageDailyPoint {
  day: string
  requests: number
  inputTokens: number
  outputTokens: number
}

export interface TokenUsageReport {
  updatedAt: number
  /** 扫描到的会话文件数。 */
  fileCount: number
  /** 解析失败被跳过的文件（含原因），正常应为空。 */
  skipped: Array<{ file: string; reason: string }>
  today: TokenUsageWindow
  week: TokenUsageWindow
  all: TokenUsageWindow
  /** 按本地日升序的每日用量序列（全量历史，前端自行截取最近 N 天画趋势图）。 */
  daily: TokenUsageDailyPoint[]
}