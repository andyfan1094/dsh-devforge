import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/**
 * 沙箱提权清洗的独立留痕通道。
 *
 * 为什么需要它（0.33.0 / 0.33.1 连续两次教训）：
 * - 0.33.0：钩子静默失效（this 丢失被吞）——改了但没生效，日志零记录；
 * - 0.33.1：钩子生效了，但留痕走 `ctx.logger`，而该插件的 inject 里没有 `logger`，
 *   访问未声明服务会抛 "cannot get property ... without inject"，异常被钩子的
 *   try/catch 吞掉——**生效了但看不见**，等于又回到盲区。
 *
 * 所以留痕必须满足三条：绝不抛错、绝不依赖单一通道、可被外部脚本直接读取。
 * 本模块负责第三条：把每次剥离/放行写成 JSONL 追加到独立文件，
 * 供 `scripts/sandbox-guard-doctor.mjs` 读取，与宿主日志互为交叉验证。
 */

/** 一次清洗留痕记录。 */
export interface GuardTraceEntry {
  /** ISO 时间戳。 */
  readonly time: string
  /** strip = 剥掉了提权字段；keep = 携带提权字段但放行。 */
  readonly action: 'strip' | 'keep'
  /** 工具名。 */
  readonly tool: string
  /** 调用 id（有则记）。 */
  readonly callId?: string
  /** 该次调用所属会话 id（有则记，便于按会话核对）。 */
  readonly sessionId?: string
  /** 剥离原因（仅 strip）。 */
  readonly reason?: string
  /** 请求的提权模式。 */
  readonly requestedMode?: string
  /** 该次调用的有效模式；缺失即为「模式未判定」，那是危险信号。 */
  readonly effectiveMode?: string
}

/** 追加写入的留痕文件默认位置（尊重 DSH_HOME，暂存实例天然隔离）。 */
export function defaultGuardTraceFile(home?: string): string {
  const base = home ?? process.env.DSH_HOME ?? join(homedir(), '.dsh')
  return join(base, 'storages', 'dsh-devforge', 'sandbox-guard-trace.jsonl')
}

/** 默认体积上限：超过就只保留后半段，避免无限增长。 */
export const GUARD_TRACE_MAX_BYTES = 512 * 1024

/**
 * 构造留痕写入函数。任何失败（磁盘只读、目录不可建等）都被吞掉且不影响工具调用 ——
 * 但「写入失败」本身不应静默：调用方应另行落到日志通道。
 * @param file - 留痕文件路径。
 * @param maxBytes - 体积上限，超过则裁剪到后半段。
 * @returns 追加一条记录的函数。
 */
export function createGuardTracer(file: string, maxBytes = GUARD_TRACE_MAX_BYTES): (entry: GuardTraceEntry) => void {
  return (entry) => {
    try {
      mkdirSync(dirname(file), { recursive: true })
      if (existsSync(file) && statSync(file).size > maxBytes) {
        const kept = readFileSync(file, 'utf8').split('\n').filter((line) => line.length > 0)
        const half = kept.slice(Math.floor(kept.length / 2))
        writeFileSync(file, half.length > 0 ? `${half.join('\n')}\n` : '')
      }
      appendFileSync(file, `${JSON.stringify(entry)}\n`)
    } catch {
      // 留痕失败不影响工具调用成败；调用方同时还有日志通道。
    }
  }
}

/**
 * 读取留痕记录（最近的在后）。
 * @param file - 留痕文件路径。
 * @param limit - 最多返回条数。
 * @returns 解析成功的记录；文件不存在或损坏时返回空数组。
 */
export function readGuardTrace(file: string, limit = 20): GuardTraceEntry[] {
  try {
    if (!existsSync(file)) return []
    const lines = readFileSync(file, 'utf8').split('\n').filter((line) => line.trim().length > 0)
    const tail = limit > 0 ? lines.slice(-limit) : lines
    const entries: GuardTraceEntry[] = []
    for (const line of tail) {
      try {
        const parsed = JSON.parse(line) as GuardTraceEntry
        if (parsed !== null && typeof parsed === 'object' && typeof parsed.action === 'string') entries.push(parsed)
      } catch {
        // 跳过损坏行，不影响其余记录。
      }
    }
    return entries
  } catch {
    return []
  }
}
