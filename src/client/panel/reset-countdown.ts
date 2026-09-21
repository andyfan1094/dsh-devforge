/** Coding Plan 用量看板共享的重置时间计算工具。
 *
 * 三家服务商（智谱 / MiniMax / 火山方舟）原本各自实现了一份独立的 formatCountdown，
 * 把倒计时文本塞进 quotaMeta 行内 span，导致关键提醒被 "60.0% 剩余" 之类的二级文字稀释。
 *
 * 本模块把"把秒级/字符串时间戳规整成结构化数据"沉淀到一处：
 * - resolveArkReset / resolveZhipuReset / resolveGenericReset / resolveOverviewReset
 *   返回带 urgency 的 ResetView，与对应 React 组件（见 reset-badge.tsx）解耦。
 * - urgency 按"剩余时间"分级，与进度条按"已用百分比"着色正交。
 *
 * 该文件刻意保持纯函数 + 无 JSX，方便 node --experimental-strip-types 直接单测。
 */

/** 倒计时紧急度，驱动徽章颜色和脉冲动画。 */
export type ResetUrgency = 'normal' | 'warning' | 'danger'

/** 用量窗口类型，决定 urgency 阈值。 */
export type ResetLevel = 'short-window' | 'weekly' | 'monthly' | 'unknown'

/** 结构化倒计时视图。 */
export interface ResetView {
  /** 显示给用户的紧凑文案（辉哥 2026-09-21 定稿）：'5h-3:00' / '周-1d3h' / '月-28d20h' / '即将重置' / '重置时间未知'。 */
  text: string
  /** 剩余时间分级，控制徽章颜色与是否启用脉冲。 */
  urgency: ResetUrgency
  /** 剩余毫秒数（已 clamp 到 >= 0）。用于组件内部判断。 */
  remainingMs: number
}

/** 阈值常量集中放在一起，方便回归测试与微调。 */
const SHORT_WINDOW_DANGER_MS = 60 * 60_000
const SHORT_WINDOW_WARNING_MS = 3 * 60 * 60_000
const WEEKLY_DANGER_MS = 6 * 60 * 60_000
const WEEKLY_WARNING_MS = 24 * 60 * 60_000

/** 由 level 字段推断 ResetLevel；未知 level 一律按 unknown 走保守阈值。 */
export function inferLevel(level: string | undefined): ResetLevel {
  if (level === undefined) return 'unknown'
  const normalized = level.toLowerCase()
  if (normalized === '5h' || normalized === 'session' || normalized === 'interval' || normalized === 'tokens-5h') return 'short-window'
  if (normalized === 'weekly' || normalized === 'week' || normalized === 'tokens-week') return 'weekly'
  if (normalized === 'monthly' || normalized === 'month' || normalized === 'tools-month') return 'monthly'
  return 'unknown'
}

/** 把毫秒级剩余时间映射到 urgency。 */
export function classifyByLevel(level: ResetLevel, remainingMs: number): ResetUrgency {
  if (level === 'short-window') {
    if (remainingMs <= SHORT_WINDOW_DANGER_MS) return 'danger'
    if (remainingMs <= SHORT_WINDOW_WARNING_MS) return 'warning'
    return 'normal'
  }
  if (remainingMs <= WEEKLY_DANGER_MS) return 'danger'
  if (remainingMs <= WEEKLY_WARNING_MS) return 'warning'
  return 'normal'
}

/** 窗口前缀（辉哥定稿）：短窗口 '5h'、周 '周'、月 '月'；unknown 无前缀。 */
function levelPrefix(level: ResetLevel): string {
  if (level === 'short-window') return '5h'
  if (level === 'weekly') return '周'
  if (level === 'monthly') return '月'
  return ''
}

/** 紧凑时长（辉哥定稿 2026-09-21）：短窗口 'H:MM' 钟表式；长窗口 <1h 'Mm'、<24h 'Hh'、更长 'DdHh'（分钟舍弃）。 */
function formatDurationCompact(level: ResetLevel, remainingMs: number): string {
  const totalMinutes = Math.max(1, Math.ceil(remainingMs / 60_000))
  if (level === 'short-window') {
    return Math.floor(totalMinutes / 60) + ':' + String(totalMinutes % 60).padStart(2, '0')
  }
  const totalHours = Math.floor(totalMinutes / 60)
  if (totalHours < 1) return totalMinutes + 'm'
  if (totalHours < 24) return totalHours + 'h'
  return Math.floor(totalHours / 24) + 'd' + (totalHours % 24) + 'h'
}

/** 通用窗口倒计时文案：'5h-3:00' / '周-1d3h' / '月-28d20h'；已过期「即将重置」。 */
export function formatLevelText(level: ResetLevel, remainingMs: number): string {
  if (remainingMs <= 0) return '即将重置'
  const prefix = levelPrefix(level)
  return prefix === '' ? formatDurationCompact(level, remainingMs) : prefix + '-' + formatDurationCompact(level, remainingMs)
}

/** 通用分钟级倒计时文案（紧凑格式）。 */
export function formatGenericText(remainingMs: number, level: ResetLevel = 'unknown'): string {
  return formatLevelText(level, remainingMs)
}

/** OverviewTab 用的简化文案：同一紧凑格式。 */
export function formatSimpleText(remainingMs: number, level: ResetLevel = 'unknown'): string {
  return formatLevelText(level, remainingMs)
}

/** 把官方可能的字符串或秒级时间戳规整为毫秒时间戳。 */
export function normalizeTimestamp(value: string | number | undefined): number | undefined {
  if (value === undefined) return undefined
  const raw = typeof value === 'number' ? value : Date.parse(value)
  if (!Number.isFinite(raw)) return undefined
  return raw < 1_000_000_000_000 ? raw * 1000 : raw
}

/** 火山方舟：period.resetAt 直接是毫秒级 number。 */
export function resolveArkReset(period: { level: string; resetAt?: number | undefined }, now: number): ResetView {
  if (period.resetAt === undefined) {
    return { text: '重置时间未知', urgency: 'normal', remainingMs: Number.POSITIVE_INFINITY }
  }
  const remainingMs = Math.max(0, period.resetAt - now)
  const resolvedLevel = inferLevel(period.level)
  return {
    text: formatLevelText(resolvedLevel, remainingMs),
    urgency: classifyByLevel(resolvedLevel, remainingMs),
    remainingMs,
  }
}

/** 智谱：nextResetTime 可能是字符串 ISO 或秒/毫秒级数字；按 limit.kind 推断窗口级别。 */
export function resolveZhipuReset(value: string | number | undefined, now: number, kind?: string): ResetView {
  const timestamp = normalizeTimestamp(value)
  if (timestamp === undefined) {
    return { text: '重置时间未知', urgency: 'normal', remainingMs: Number.POSITIVE_INFINITY }
  }
  const remainingMs = Math.max(0, timestamp - now)
  const resolvedLevel = inferLevel(kind)
  return {
    text: formatLevelText(resolvedLevel, remainingMs),
    urgency: classifyByLevel(resolvedLevel, remainingMs),
    remainingMs,
  }
}

/** MiniMax 共用：纯毫秒级时间戳，按窗口级别分级。 */
export function resolveGenericReset(
  timestamp: number | undefined,
  now: number,
  level: ResetLevel | string = 'unknown',
): ResetView {
  if (timestamp === undefined) {
    return { text: '重置时间未知', urgency: 'normal', remainingMs: Number.POSITIVE_INFINITY }
  }
  const remainingMs = Math.max(0, timestamp - now)
  const resolvedLevel: ResetLevel = typeof level === 'string' && ['short-window', 'weekly', 'monthly', 'unknown'].includes(level)
    ? level as ResetLevel
    : inferLevel(level)
  return {
    text: formatLevelText(resolvedLevel, remainingMs),
    urgency: classifyByLevel(resolvedLevel, remainingMs),
    remainingMs,
  }
}

/** OverviewTab 专用的简化版（同一紧凑格式）。 */
export function resolveOverviewReset(
  timestamp: number | undefined,
  now: number,
  level: ResetLevel | string = 'unknown',
): ResetView {
  if (timestamp === undefined) {
    return { text: '重置时间未知', urgency: 'normal', remainingMs: Number.POSITIVE_INFINITY }
  }
  const remainingMs = Math.max(0, timestamp - now)
  const resolvedLevel: ResetLevel = typeof level === 'string' && ['short-window', 'weekly', 'monthly', 'unknown'].includes(level)
    ? level as ResetLevel
    : inferLevel(level)
  return {
    text: formatLevelText(resolvedLevel, remainingMs),
    urgency: classifyByLevel(resolvedLevel, remainingMs),
    remainingMs,
  }
}

