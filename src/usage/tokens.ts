/**
 * 模型 token 计量扫描器 —— 从 DSH 本机会话存储聚合「每模型 token 用量」。
 *
 * 数据源：$DSH_HOME/sessions/<工作区目录>/<sessionId>/session.jsonl(.zstd)。
 * 每条 assistant/message 事件都带 usage.inputTokens/outputTokens 与
 * message.source.provider/model，是客户端侧最真实、跨服务商通用的计量依据。
 *
 * .zstd 文件是「多帧拼接容器」（每批事件独立一帧，见官方 dsh-session-persistence-jsonl）：
 * Node 的一次性 zstdDecompressSync 只解第一帧，必须先做帧结构扫描再逐帧解压。
 * scanZstdFrames 的帧头解析逻辑源自官方包的公开帧扫描实现（MIT/Apache-2.0），
 * 此处 vendor 进插件以避免依赖宿主内部模块路径。
 *
 * 性能边界：按文件 mtime+size 增量解析（结果缓存进程内存），面板刷新只重扫
 * 被写入过的活动会话文件；首次全量扫描整库（数百 MB 压缩）为一次性成本。
 * 最后一帧若正在写入（torn）则跳过，待下次写入完成后再计入，不阻塞刷新。
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { constants as zstdConstants, zstdDecompressSync } from 'node:zlib'
import { formatLocalDay } from './day-format.ts'

// 客户端（浏览器 bundle）只允许引用本目录的纯函数模块（如 day-format.ts），
// 绝不能运行时引用本文件——node:zlib/node:fs 进客户端会被加载器拒绝（0.14.1 实证教训）。
export { formatLocalDay }

/** 单模型单天的用量聚合。 */
interface UsageAgg {
  requests: number
  inputTokens: number
  outputTokens: number
}

/** 单个会话文件的解析结果：按「本地日」分桶的聚合。 */
interface FileScanResult {
  /** 本地时区日期键（YYYY-MM-DD）→ 内部键(provider\u241Fmodel) → 聚合。 */
  days: Map<string, Map<string, UsageAgg>>
}

/** 缓存条目：记录文件指纹，指纹未变则复用旧结果。 */
interface CacheEntry extends FileScanResult {
  mtimeMs: number
  size: number
}

// 用量类型拆至同目录 types.ts（纯类型零 node 依赖）：client 侧只许 import types.ts，
// 本文件（node:zlib/node:fs 实现）绝不能进入客户端 bundle（0.14.3 彻底修复）。
import type { TokenUsageRow, TokenUsageWindow, TokenUsageDailyPoint, TokenUsageReport } from './types.ts'
export type { TokenUsageRow, TokenUsageWindow, TokenUsageDailyPoint, TokenUsageReport }

/** 内部聚合键分隔符（单元分隔符，不会出现在 provider/model 名里）。 */
const KEY_SEP = '\u241F'

/** zstd 帧魔数（0xFD2FB528 的小端）。 */
const ZSTD_MAGIC = 4247762216

/** 解析单事件行；非 assistant 计量行返回 null。解析失败（半行写入）也返回 null。 */
export function extractUsageFromLine(line: string): { dayKey: string; provider: string; model: string; input: number; output: number } | null {
  // 廉价预过滤：绝大多数行（工具结果等大块内容）在此被跳过，避免无谓 JSON.parse。
  if (!line.includes('"assistant/message"') || !line.includes('"usage"')) return null
  let event: { type?: unknown; time?: unknown; data?: { usage?: { inputTokens?: unknown; outputTokens?: unknown }; message?: { source?: { provider?: unknown; model?: unknown } } } }
  try { event = JSON.parse(line) } catch { return null }
  if (event.type !== 'assistant/message') return null
  const usage = event.data?.usage
  const input = typeof usage?.inputTokens === 'number' ? usage.inputTokens : 0
  const output = typeof usage?.outputTokens === 'number' ? usage.outputTokens : 0
  if (input <= 0 && output <= 0) return null
  const source = event.data?.message?.source
  const provider = typeof source?.provider === 'string' ? source.provider : 'unknown'
  const model = typeof source?.model === 'string' ? source.model : 'unknown'
  // 事件时间缺省时退回当前时间，保证计量不丢。
  const at = typeof event.time === 'number' && Number.isFinite(event.time) ? event.time : Date.now()
  return { dayKey: formatLocalDay(new Date(at)), provider, model, input, output }
}

/** 扫描 zstd 缓冲内的完整帧范围；文件尾部半帧（torn）不计入帧清单。逻辑源自官方实现。 */
export function scanZstdFrames(buffer: Buffer): Array<{ start: number; end: number }> {
  const frames: Array<{ start: number; end: number }> = []
  let offset = 0
  while (offset < buffer.length) {
    const start = offset
    if (buffer.length - offset < 4) break
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) throw new Error('invalid frame magic at byte ' + offset)
    offset += 4
    if (offset === buffer.length) break
    const descriptor = buffer.readUInt8(offset)
    offset += 1
    if ((descriptor & 24) !== 0) throw new Error('reserved frame-header bit at byte ' + (offset - 1))
    const contentSizeFlag = descriptor >>> 6
    const singleSegment = (descriptor & 32) !== 0
    const checksum = (descriptor & 4) !== 0
    const dictionaryFlag = descriptor & 3
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag
    const remainingHeaderBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes
    if (buffer.length - offset < remainingHeaderBytes) break
    offset += remainingHeaderBytes
    for (;;) {
      if (buffer.length - offset < 3) return frames
      const blockHeader = buffer.readUIntLE(offset, 3)
      offset += 3
      const lastBlock = (blockHeader & 1) !== 0
      const blockType = (blockHeader >>> 1) & 3
      const blockSize = blockHeader >>> 3
      if (blockType === 3) throw new Error('reserved block type at byte ' + (offset - 3))
      const payloadBytes = blockType === 1 ? 1 : blockSize
      if (buffer.length - offset < payloadBytes) return frames
      offset += payloadBytes
      if (lastBlock) break
    }
    if (checksum) {
      if (buffer.length - offset < 4) return frames
      offset += 4
    }
    frames.push({ start, end: offset })
  }
  return frames
}

/** 把多帧 zstd 会话文件解成完整文本；尾部 torn 帧的字节被忽略。 */
export function decodeSessionText(buffer: Buffer): string {
  const frames = scanZstdFrames(buffer)
  if (frames.length === 0) return ''
  const parts: Buffer[] = []
  for (const frame of frames) parts.push(zstdDecompressSync(buffer.subarray(frame.start, frame.end)))
  return Buffer.concat(parts).toString('utf8')
}

/** 解析单个会话文件文本为按日分桶聚合。 */
export function parseSessionText(text: string): FileScanResult {
  const days = new Map<string, Map<string, UsageAgg>>()
  for (const line of text.split('\n')) {
    const item = extractUsageFromLine(line)
    if (item === null) continue
    let bucket = days.get(item.dayKey)
    if (bucket === undefined) { bucket = new Map(); days.set(item.dayKey, bucket) }
    const key = item.provider + KEY_SEP + item.model
    const agg = bucket.get(key) ?? { requests: 0, inputTokens: 0, outputTokens: 0 }
    agg.requests += 1
    agg.inputTokens += item.input
    agg.outputTokens += item.output
    bucket.set(key, agg)
  }
  return { days }
}

/** 解析 DSH 会话存储根目录；隔离 HOME（暂存实例）天然读到自己的库。 */
export function resolveSessionsDir(dshHome?: string): string {
  const base = dshHome ?? process.env.DSH_HOME ?? join(homedir(), '.dsh')
  return join(base, 'sessions')
}

/** 递归收集会话事件文件（zstd 与明文两种后缀都认）。 */
export function listSessionFiles(dir: string): string[] {
  const found: string[] = []
  let entries: string[]
  try { entries = readdirSync(dir) } catch { return found }
  for (const entry of entries) {
    const full = join(dir, entry)
    let stat: import('node:fs').Stats
    try { stat = statSync(full) } catch { continue }
    if (stat.isDirectory()) found.push(...listSessionFiles(full))
    else if (entry === 'session.jsonl.zstd' || entry === 'session.jsonl') found.push(full)
  }
  return found
}

/** 进程内文件级缓存：跨刷新复用未变化文件的解析结果。 */
const fileCache = new Map<string, CacheEntry>()

/** 合并去重的进行中扫描，避免并发刷新重复全量解析。 */
let pendingScan: Promise<TokenUsageReport> | null = null

/** 由「文件路径 → 解析结果」聚合出三窗报告。 */
export function buildReport(scanned: Map<string, FileScanResult>, now: number, skipped: Array<{ file: string; reason: string }>): TokenUsageReport {
  const todayKey = formatLocalDay(new Date(now))
  // 本周从本地周一 00:00 起（国内习惯周一为一周之首）。
  const weekStart = new Date(now)
  const weekday = (weekStart.getDay() + 6) % 7
  weekStart.setDate(weekStart.getDate() - weekday)
  weekStart.setHours(0, 0, 0, 0)
  const weekKey = formatLocalDay(weekStart)

  const todayMap = new Map<string, UsageAgg>()
  const weekMap = new Map<string, UsageAgg>()
  const allMap = new Map<string, UsageAgg>()
  const dailyMap = new Map<string, UsageAgg>()
  const addTo = (map: Map<string, UsageAgg>, key: string, agg: UsageAgg): void => {
    const cur = map.get(key) ?? { requests: 0, inputTokens: 0, outputTokens: 0 }
    cur.requests += agg.requests
    cur.inputTokens += agg.inputTokens
    cur.outputTokens += agg.outputTokens
    map.set(key, cur)
  }
  for (const result of scanned.values()) {
    for (const [dayKey, bucket] of result.days) {
      for (const [key, agg] of bucket) {
        addTo(allMap, key, agg)
        addTo(dailyMap, dayKey, agg)
        if (dayKey === todayKey) addTo(todayMap, key, agg)
        if (dayKey >= weekKey) addTo(weekMap, key, agg)
      }
    }
  }
  // 每日序列按日期键升序（YYYY-MM-DD 字典序即时间序），供前端画每日趋势图。
  const daily: TokenUsageDailyPoint[] = [...dailyMap.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([day, agg]) => ({ day, inputTokens: agg.inputTokens, outputTokens: agg.outputTokens, requests: agg.requests }))
  return {
    updatedAt: now,
    fileCount: scanned.size,
    skipped,
    today: buildWindow(todayMap),
    week: buildWindow(weekMap),
    all: buildWindow(allMap),
    daily,
  }
}

/** 聚合映射 → 窗口（按总 token 降序）。 */
function buildWindow(map: Map<string, UsageAgg>): TokenUsageWindow {
  const rows: TokenUsageRow[] = []
  let requests = 0
  let inputTokens = 0
  let outputTokens = 0
  for (const [key, agg] of map) {
    const sep = key.indexOf(KEY_SEP)
    const provider = key.slice(0, sep)
    const model = key.slice(sep + KEY_SEP.length)
    rows.push({ provider, model, requests: agg.requests, inputTokens: agg.inputTokens, outputTokens: agg.outputTokens })
    requests += agg.requests
    inputTokens += agg.inputTokens
    outputTokens += agg.outputTokens
  }
  rows.sort((a, b) => (b.inputTokens + b.outputTokens) - (a.inputTokens + a.outputTokens))
  return { requests, inputTokens, outputTokens, rows }
}

/** 扫描会话库并产出报告（带增量缓存与并发去重）。 */
export function collectTokenUsage(now = Date.now()): TokenUsageReport {
  const dir = resolveSessionsDir()
  const files = listSessionFiles(dir)
  const scanned = new Map<string, FileScanResult>()
  const skipped: Array<{ file: string; reason: string }> = []
  for (const file of files) {
    let stat: import('node:fs').Stats
    try { stat = statSync(file) } catch { continue }
    const cached = fileCache.get(file)
    if (cached !== undefined && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
      scanned.set(file, cached)
      continue
    }
    try {
      const buffer = readFileSync(file)
      const text = file.endsWith('.zstd') ? decodeSessionText(buffer) : buffer.toString('utf8')
      const result = parseSessionText(text)
      fileCache.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, days: result.days })
      scanned.set(file, result)
    } catch (cause) {
      // 解压/读取失败（含正在写入被截断）按跳过处理，指纹不入缓存，下次刷新重试。
      skipped.push({ file, reason: cause instanceof Error ? cause.message : String(cause) })
      if (cached !== undefined) scanned.set(file, cached)
    }
  }
  // 缓存清理：已删除的会话文件不再占用内存。
  const alive = new Set(files)
  for (const key of fileCache.keys()) { if (!alive.has(key)) fileCache.delete(key) }
  return buildReport(scanned, now, skipped)
}

/** 面板刷新入口：并发请求共享同一次扫描。 */
export function collectTokenUsageShared(): Promise<TokenUsageReport> {
  if (pendingScan !== null) return pendingScan
  const job = (async () => {
    try {
      // 让出事件循环，避免首个大库全量扫描阻塞路由响应之外的请求。
      await new Promise<void>((resolve) => setImmediate(resolve))
      return collectTokenUsage()
    } finally { pendingScan = null }
  })()
  pendingScan = job
  return job
}

// 供单元测试固定 zstd 常量使用（避免测试文件各自硬编码）。
export const ZSTD_CHECKSUM_FLAG = zstdConstants.ZSTD_c_checksumFlag
