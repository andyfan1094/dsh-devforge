/**
 * DSH Web 重启管理器。
 *
 * 面板或 Agent 显式请求后，先启动独立引导进程，再结束当前 DSH Web Host。
 * 引导进程复用当前 Node 可执行文件和启动参数，短时启动失败时重试，避免旧 Host
 * 尚未释放端口时重启失败。路由层负责浏览器可信来源校验，本类不接收命令文本。
 */

import { spawn } from 'node:child_process'

/** DSH 重启调度结果。 */
export interface DshRestartResult {
  /** 是否已安排重启。 */
  scheduled: boolean
  /** 面向面板和 Agent 的状态消息。 */
  message: string
}

/** 当前 Host 结束后，后台进程尝试启动 Web 的最大次数。 */
const MAX_BOOT_ATTEMPTS = 8
/** 让 HTTP 响应完整返回后再结束当前 Host。 */
const SHUTDOWN_DELAY_MS = 250
/** 给旧 Host 留出的首次退出窗口。 */
const FIRST_BOOT_DELAY_MS = 1000
/** 子进程持续运行超过此窗口时，认为 Host 已成功启动。 */
const STARTUP_STABLE_WINDOW_MS = 2500

/** 本机 DSH Web 重启调度器。 */
export class DshWebRestartManager {
  /** 当前生命周期是否已经安排重启，防止连点竞争端口。 */
  private scheduled = false

  /**
   * 安排一次 DSH Web 重启。
   *
   * 后台引导进程复用本次启动的 Node 可执行文件与参数，因此会保留 profile、port、
   * host、patch 等现有配置。当前 Host 在 HTTP 响应返回后退出，GUI 会短暂断开。
   */
  requestRestart(): DshRestartResult {
    if (this.scheduled) {
      return { scheduled: true, message: 'DSH 已在重启中，请等待服务恢复。' }
    }

    this.startDetachedWebHost()
    this.scheduled = true
    console.info('[dsh-devforge] 已安排 DSH Web 重启。')

    const shutdownTimer: NodeJS.Timeout = setTimeout(() => {
      if (process.platform === 'win32') {
        process.exit(0)
      }
      process.kill(process.pid, 'SIGTERM')
    }, SHUTDOWN_DELAY_MS)
    shutdownTimer.unref()

    return { scheduled: true, message: 'DSH 正在重启，服务恢复后页面将自动刷新。' }
  }

  /** 启动与当前 Host 分离的引导进程，并保留原始启动命令。 */
  private startDetachedWebHost(): void {
    const executable = process.execPath
    const argumentsToReuse = process.argv.slice(1)
    if (argumentsToReuse.length === 0) {
      throw new Error('无法确定当前 DSH Web 的启动参数，已取消重启。')
    }

    // 引导进程使用固定脚本和 JSON 参数，不把浏览器输入拼入 shell 命令。
    const bootstrap = [
      "const { spawn } = require('node:child_process')",
      "const { mkdirSync, openSync } = require('node:fs')",
      "const { join } = require('node:path')",
      'const executable = process.argv[1]',
      'const args = JSON.parse(process.argv[2])',
      "const logDir = join(process.env.DSH_HOME || process.cwd(), 'logs')",
      "mkdirSync(logDir, { recursive: true })",
      "const logFd = openSync(join(logDir, 'dsh-web-restart.log'), 'a')",
      'let attempt = 0',
      'let retryScheduled = false',
      'function scheduleRetry() {',
      '  if (retryScheduled || attempt >= ' + MAX_BOOT_ATTEMPTS + ') return',
      '  retryScheduled = true',
      '  setTimeout(() => { retryScheduled = false; start() }, 1000)',
      '}',
      'function start() {',
      '  attempt += 1',
      "  const child = spawn(executable, args, { detached: true, stdio: ['ignore', logFd, logFd], env: process.env })",
      '  let stable = false',
      '  const stableTimer = setTimeout(() => { stable = true; child.unref() }, ' + STARTUP_STABLE_WINDOW_MS + ')',
      "  child.once('error', () => { clearTimeout(stableTimer); if (!stable) scheduleRetry() })",
      "  child.once('exit', () => { clearTimeout(stableTimer); if (!stable) scheduleRetry() })",
      '}',
      'setTimeout(start, ' + FIRST_BOOT_DELAY_MS + ')',
    ].join(';')
    const bootstrapProcess = spawn(executable, ['-e', bootstrap, executable, JSON.stringify(argumentsToReuse)], {
      detached: true,
      stdio: 'ignore',
      env: process.env,
    })
    bootstrapProcess.unref()
  }
}
