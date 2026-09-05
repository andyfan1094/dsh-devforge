import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir, userInfo } from 'node:os'
import { join } from 'node:path'
import type { CompanionSnapshot, CompanionState } from './protocol.ts'

const APP_PATH = '/Applications/Douyin Webcast Mate.app'
const LOG_DIR_NAME = 'Douyin Webcast Mate'
const MAX_LOG_BYTES = 2 * 1024 * 1024
const LOG_FILE_PATTERN = /^\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\.log$/
const RECEIVER_ORIGIN = 'http://127.0.0.1:1088'

type CompanionEvent = { kind: 'start' | 'stop'; roomId: string; at: number }

/** 伴侣日志只解析状态行和内部房间号，原始日志不会离开 Host。 */
function parseEvent(line: string, fallbackAt: number): CompanionEvent | undefined {
  const timestamp = line.match(/^\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3})/)?.[1]
  const at = timestamp === undefined ? fallbackAt : Date.parse(timestamp)
  const start = line.match(/evt=start-live-ok\s+room_id=(\d{6,25})/)
  if (start?.[1]) return { kind: 'start', roomId: start[1], at: Number.isFinite(at) ? at : fallbackAt }
  const stop = line.match(/evt=stop-live-ok(?:\s+[^\n]*?)?\s+room_id=(\d{6,25})/)
  if (stop?.[1]) return { kind: 'stop', roomId: stop[1], at: Number.isFinite(at) ? at : fallbackAt }
  return undefined
}

/** 从最新主日志读取最后一次开播/停播事件；不追踪旧媒体服务日志。 */
function latestEvents(logDir: string, now: number): CompanionEvent[] {
  let names: string[]
  try { names = readdirSync(logDir).filter(name => LOG_FILE_PATTERN.test(name)).sort().slice(-4) } catch { return [] }
  const events: CompanionEvent[] = []
  for (const name of names) {
    const file = join(logDir, name)
    try {
      const stat = statSync(file)
      const text = readFileSync(file, { encoding: 'utf8' }).slice(-MAX_LOG_BYTES)
      for (const line of text.split('\n')) {
        const event = parseEvent(line, stat.mtimeMs || now)
        if (event) events.push(event)
      }
    } catch { /* 文件轮转/伴侣写入竞争时跳过本个文件，下一轮重读。 */ }
  }
  return events.sort((left, right) => left.at - right.at)
}

/** 读取伴侣是否安装、最近一场直播的内部房间号和状态。 */
export function readDouyinCompanionSnapshot(baseHome = process.platform === 'darwin' ? userInfo().homedir : homedir(), now = Date.now()): CompanionSnapshot {
  const installed = existsSync(APP_PATH)
  const logDir = join(baseHome, 'Library', 'Logs', LOG_DIR_NAME)
  const latest = latestEvents(logDir, now).at(-1)
  if (latest === undefined) return { installed, state: installed ? 'unknown' : 'offline', internalRoomId: '', publicRoomId: '', error: '', updatedAt: undefined }
  return {
    installed,
    state: latest.kind === 'start' ? 'live' : 'offline',
    internalRoomId: latest.kind === 'start' ? latest.roomId : '',
    publicRoomId: '',
    error: '',
    updatedAt: latest.at,
  }
}

/** 通过本机 douyinLive 的只读查询把已绑定的公开房间映射到当前内部 room_id。 */
export async function probeDouyinPublicRoom(roomInput: string, request: typeof fetch = fetch): Promise<{ live: boolean; publicRoomId: string; internalRoomId: string } | undefined> {
  if (!/^\d{1,20}$/.test(roomInput)) return undefined
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 3000)
  try {
    const response = await request(RECEIVER_ORIGIN + '/api/v1/rooms/' + encodeURIComponent(roomInput), { signal: controller.signal })
    if (!response.ok) return undefined
    const payload: unknown = await response.json()
    if (payload === null || typeof payload !== 'object') return undefined
    const data = (payload as { data?: unknown }).data
    if (data === null || typeof data !== 'object') return undefined
    const record = data as { live_id?: unknown; is_live?: unknown; status?: unknown; room_id?: unknown }
    const publicRoomId = typeof record.live_id === 'string' ? record.live_id : roomInput
    const internalRoomId = typeof record.room_id === 'string' ? record.room_id : ''
    return { live: record.is_live === true || record.status === 'online', publicRoomId, internalRoomId }
  } catch { return undefined } finally { clearTimeout(timer) }
}

/** 约束状态值的纯函数，供服务与测试复用。 */
export function companionStateLabel(state: CompanionState): string {
  if (state === 'live') return '直播中'
  if (state === 'offline') return '未开播'
  return '状态未知'
}
