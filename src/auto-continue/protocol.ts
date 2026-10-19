/**
 * 失败自动续跑（auto-continue）—— 协议层。
 *
 * 需求（辉哥 2026-10-19）：一轮跑失败后，插件自动替用户补发一条「继续」，
 * 免去每次手动点一遍。默认只在**模型报错**（turn/end reason.kind === 'error'，
 * GUI 上显示为「本轮运行失败」）时触发，且同一会话连续失败最多补 maxAttempts 次，
 * 成功轮次后清零，绝不无限重试烧 token。
 *
 * 本文件只放纯数据：设置类型、默认值、归一化与路由常量（无运行时依赖，便于单测）。
 */

/** 面板数据通道：自动续跑设置。 */
export const AUTO_CONTINUE_API = {
  settings: '/api/dsh-devforge/auto-continue/settings',
} as const

/** 自动续跑设置。 */
export interface AutoContinueSettings {
  /** 总开关（默认开：辉哥要的就是失败后自动补一次）。 */
  enabled: boolean
  /** 补发的用户消息正文（默认「继续」）。 */
  text: string
  /** 同一会话**连续失败**最多自动补发几次（默认 1 = 只补一次）。 */
  maxAttempts: number
  /** 补发前等待毫秒数（默认 3000，等上游瞬态故障过去再试）。 */
  delayMs: number
}

/** 设置默认值。 */
export const DEFAULT_AUTO_CONTINUE_SETTINGS: AutoContinueSettings = {
  enabled: true,
  text: '继续',
  maxAttempts: 1,
  delayMs: 3000,
}

/**
 * 面板可见的运行统计（进程内计数，Host 重启清零）。
 * 定义在协议层而不是服务层：浏览器半边只 import 本文件，避免把 node:crypto 带进 bundle。
 */
export interface AutoContinueStats {
  /** 实际补发次数。 */
  attemptCount: number
  /** 判定命中但按规则跳过的次数（关闭、达上限、非 GUI 会话等）。 */
  skipCount: number
  /** 最近一次补发时间（0 表示从未补发）。 */
  lastAt: number
  /** 最近一次补发的会话号。 */
  lastSessionId: string
  /** 最近一次补发的正文。 */
  lastText: string
  /** 最近一次跳过的原因（中文，直接给面板看）。 */
  lastSkipReason: string
  /** 最近一次补发失败的错误信息。 */
  lastError: string
}

/** 正文长度上限：一条用户消息不该变成小作文。 */
const MAX_TEXT_LENGTH = 200
/** 连续补发次数上限：防止把失败循环放大成账单事故。 */
const MAX_ATTEMPTS_LIMIT = 5
/** 补发延迟上限。 */
const MAX_DELAY_MS = 60_000

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10)
  if (!Number.isFinite(parsed)) return fallback
  const floored = Math.floor(parsed)
  if (floored < min) return min
  if (floored > max) return max
  return floored
}

/**
 * 归一化设置：面板 PUT 的任意 body 都能落到合法值。
 * 缺字段用 base（当前值）补齐——面板只改一个字段时不会把其它字段重置成默认值。
 */
export function normalizeAutoContinueSettings(raw: unknown, base: AutoContinueSettings = DEFAULT_AUTO_CONTINUE_SETTINGS): AutoContinueSettings {
  const record = (raw !== null && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const text = typeof record.text === 'string' ? record.text.trim().slice(0, MAX_TEXT_LENGTH) : base.text
  return {
    enabled: typeof record.enabled === 'boolean' ? record.enabled : base.enabled,
    // 空正文没有意义：回退到默认「继续」，而不是发一条空白消息。
    text: text === '' ? DEFAULT_AUTO_CONTINUE_SETTINGS.text : text,
    maxAttempts: clampInt(record.maxAttempts, base.maxAttempts, 0, MAX_ATTEMPTS_LIMIT),
    delayMs: clampInt(record.delayMs, base.delayMs, 0, MAX_DELAY_MS),
  }
}
