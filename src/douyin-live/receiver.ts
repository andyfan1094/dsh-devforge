/**
 * douyinLive 本地连接器按需启动器：只访问固定回环健康地址，不接受浏览器传入命令。
 * 连接器是独立进程，Host 重启后保留已启动进程；再次连接时先探活，缺失才启动。
 */
import { spawn } from 'node:child_process'
import { accessSync, constants, statSync } from 'node:fs'
import { userInfo } from 'node:os'
import { dirname, isAbsolute, join } from 'node:path'

const RECEIVER_HEALTH_URL = 'http://127.0.0.1:1088/health'
const PROBE_TIMEOUT_MS = 1500
const STARTUP_TIMEOUT_MS = 15000
const POLL_INTERVAL_MS = 250

/** Host 使用的本地连接器最小能力，便于服务测试注入内存实现。 */
export interface DouyinReceiver {
  /** 确保本地连接器已启动并通过健康检查。 */
  ensureRunning(signal?: AbortSignal): Promise<void>
}

/** 连接器启动器依赖；外部边界均可注入测试替身。 */
export interface DouyinReceiverOptions {
  /** 固定的连接器绝对路径；缺省按本机约定目录查找。 */
  binaryPath?: string
  /** 健康检查函数；生产缺省访问固定回环地址。 */
  probe?: (signal?: AbortSignal) => Promise<boolean>
  /** 进程启动函数；生产缺省使用 detached spawn。 */
  startProcess?: (binaryPath: string) => void
  /** 启动后等待健康检查的最长时间。 */
  startupTimeoutMs?: number
  /** 两次健康检查之间的间隔。 */
  pollIntervalMs?: number
  /** 结构化短日志，不记录连接器输出。 */
  log?: (message: string) => void
}

/** 在 macOS 隔离 HOME 下仍取得真实用户主目录，避免暂存实例拼错连接器路径。 */
function actualUserHome(): string {
  if (process.platform === 'darwin') {
    try { return userInfo().homedir }
    catch { /* 回退到 Node 的常规目录 */ }
  }
  return process.env.HOME || process.cwd()
}

/** 判断文件是否为普通可执行文件。 */
function isExecutableFile(path: string): boolean {
  try {
    if (!statSync(path).isFile()) return false
    accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/** 查找本机约定的 douyinLive，不从网络或浏览器输入推导可执行路径。 */
export function findDouyinReceiverBinary(): string | undefined {
  const candidates: string[] = []
  const configured = process.env.DSH_DOUYIN_LIVE_PATH?.trim()
  if (configured) candidates.push(configured)
  const home = actualUserHome()
  candidates.push(join(home, 'Documents', 'ds', 'douyin-live', 'douyinLive'))
  candidates.push(join(process.cwd(), 'douyin-live', 'douyinLive'))
  for (const candidate of candidates) {
    if (isAbsolute(candidate) && isExecutableFile(candidate)) return candidate
  }
  return undefined
}

/** 使用固定回环地址探测连接器，不跟随重定向，不传递凭据。 */
async function probeReceiver(signal?: AbortSignal): Promise<boolean> {
  const timeout = new AbortController()
  const timer = setTimeout(() => timeout.abort(), PROBE_TIMEOUT_MS)
  const combined = signal === undefined ? timeout.signal : AbortSignal.any([signal, timeout.signal])
  try {
    const response = await fetch(RECEIVER_HEALTH_URL, { signal: combined, redirect: 'error', cache: 'no-store' })
    if (!response.ok) {
      await response.body?.cancel()
      return false
    }
    const payload: unknown = await response.json()
    return payload !== null && typeof payload === 'object' && (payload as { ok?: unknown }).ok === true
  } catch {
    if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error('连接器启动请求已取消。')
    return false
  } finally {
    clearTimeout(timer)
  }
}

/** 以 detached 方式启动外部连接器；不继承 stdout/stderr，避免原始日志进入 DSH。 */
function startDetachedReceiver(binaryPath: string): void {
  const child = spawn(binaryPath, [], {
    cwd: dirname(binaryPath),
    detached: true,
    stdio: 'ignore',
    env: process.env,
  })
  child.on('error', () => { /* 健康检查超时后由调用方给出统一错误 */ })
  child.unref()
}

/** 让一个后台启动过程可被当前 HTTP 请求取消等待，但不杀掉正在启动的外部进程。 */
async function waitWithSignal<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal === undefined) return await promise
  if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : new Error('连接器启动请求已取消。')
  return await new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      signal.removeEventListener('abort', onAbort)
      reject(signal.reason instanceof Error ? signal.reason : new Error('连接器启动请求已取消。'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then((value) => {
      signal.removeEventListener('abort', onAbort)
      resolve(value)
    }, (error: unknown) => {
      signal.removeEventListener('abort', onAbort)
      reject(error)
    })
  })
}

/**
 * 管理本机 douyinLive 单实例启动竞争和健康等待。
 * 注意：不主动杀外部进程，保证 DSH Web 重启后连接器仍可被复用。
 */
export class DouyinReceiverProcess implements DouyinReceiver {
  private readonly binaryPath: string | undefined
  private readonly probe: (signal?: AbortSignal) => Promise<boolean>
  private readonly startProcess: (binaryPath: string) => void
  private readonly startupTimeoutMs: number
  private readonly pollIntervalMs: number
  private readonly log: (message: string) => void
  private starting: Promise<void> | undefined

  /** 初始化连接器路径和可替换的外部边界。 */
  constructor(options: DouyinReceiverOptions = {}) {
    this.binaryPath = options.binaryPath ?? findDouyinReceiverBinary()
    this.probe = options.probe ?? probeReceiver
    this.startProcess = options.startProcess ?? startDetachedReceiver
    this.startupTimeoutMs = Math.max(1000, options.startupTimeoutMs ?? STARTUP_TIMEOUT_MS)
    this.pollIntervalMs = Math.max(50, options.pollIntervalMs ?? POLL_INTERVAL_MS)
    this.log = options.log ?? (() => {})
  }

  /** 连接前先探活；同一 Host 内并发点击共享一个启动过程。 */
  async ensureRunning(signal?: AbortSignal): Promise<void> {
    if (await this.probe(signal)) return
    if (this.starting === undefined) {
      this.starting = this.startAndWait().finally(() => { this.starting = undefined })
    }
    await waitWithSignal(this.starting, signal)
  }

  /** 启动连接器并轮询固定健康端点，直到服务真正可接收 WebSocket。 */
  private async startAndWait(): Promise<void> {
    const binaryPath = this.binaryPath
    if (binaryPath === undefined) {
      throw new Error('未找到 douyinLive 连接器，请确认它位于 Documents/ds/douyin-live，或设置 DSH_DOUYIN_LIVE_PATH。')
    }
    this.log('抖音直播：本地连接器未运行，开始按需启动')
    this.startProcess(binaryPath)
    const deadline = Date.now() + this.startupTimeoutMs
    while (Date.now() < deadline) {
      if (await this.probe()) {
        this.log('抖音直播：本地连接器启动并通过健康检查')
        return
      }
      await new Promise<void>(resolve => setTimeout(resolve, this.pollIntervalMs))
    }
    throw new Error('douyinLive 连接器启动后未通过健康检查。')
  }
}
