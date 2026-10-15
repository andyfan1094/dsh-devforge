/**
 * DSH Web 重启管理器。
 *
 * 背景与实测教训（2026-10-15）：
 * 桌面版以 `ELECTRON_RUN_AS_NODE=1` 运行宿主，宿主命令行形如
 *   DeepSeek Harness.exe --expose-internals .../dsh-desktop-host/lib/index.js <dsh> <profile> ...
 * 旧实现不分场景地用 `spawn(process.execPath, process.argv.slice(1))` 再拉起宿主。
 * 在桌面版里这等于**又启动一个完整宿主**：它和桌面壳自己拉起的宿主争抢
 * 127.0.0.1:19387，输的那个写 `listen EADDRINUSE` 崩溃日志，赢的那个因为是 detached
 * 进程，父进程退出后变成「无窗口、父进程已消失、仍独占 19387/19390」的孤儿；
 * 之后手动打开桌面版只会再次 EADDRINUSE，而壳把「宿主启动失败」统一翻译成
 * 「另一个 DSH 实例在运行，请先退出它」——照做永远修不好。
 *
 * 当前策略：
 * - 桌面托管（argv 含 dsh-desktop-host）：宿主生命周期交给桌面壳，引导进程只做看门狗，
 *   壳在预算内没恢复时才兜底拉起，从根上消除双宿主竞争；
 * - CLI 模式（dsh web 等）：引导进程先等端口真正释放再拉起，失败按退避重试，并记录
 *   端口占用者 PID；
 * - 两条路径都把决策与端口状态写入 `DSH_HOME/logs/dsh-web-restart.log`（JSON 行留痕）。
 */

import { spawn, spawnSync, type SpawnOptions } from 'node:child_process'
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { connect } from 'node:net'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/** 重启模式：桌面壳托管，或独立 CLI 宿主。 */
export type DshRestartMode = 'desktop' | 'cli'

/** 引导策略：把生命周期交还桌面壳，或由引导进程自己拉起。 */
export type DshRestartStrategy = 'desktop-shell-handoff' | 'cli-sequential-bootstrap'

/** DSH 重启调度结果。 */
export interface DshRestartResult {
  /** 是否已安排重启。 */
  scheduled: boolean
  /** 面向面板和 Agent 的状态消息。 */
  message: string
  /** 识别的运行模式。 */
  mode: DshRestartMode
  /** 本次重启针对的端口。 */
  port: number
  /** 采用的引导策略。 */
  strategy: DshRestartStrategy
}

/** 端口占用者。 */
export interface PortOwner {
  pid: number
  /** 进程名（尽力获取，可能缺失）。 */
  name?: string
  /** 父进程 pid（尽力获取，可能缺失）。 */
  parentPid?: number
  /** 父进程是否仍存活；无法判定时为 undefined。 */
  parentAlive?: boolean
}

/** 重启环境体检结果（只读，不产生副作用）。 */
export interface DshRestartDiagnosis {
  mode: DshRestartMode
  port: number
  /** 端口当前是否有人监听。 */
  portListening: boolean
  /** 监听该端口的进程（含父进程存活情况）。 */
  owners: PortOwner[]
  /** 是否疑似旧版重启遗留的孤儿宿主。 */
  orphanSuspected: boolean
  /** 宿主自身 pid。 */
  selfPid: number
  /** 宿主是否就是端口占用者。 */
  selfOwnsPort: boolean
  /** 引导脚本路径。 */
  bootstrapScript: string
  /** 重启留痕日志路径。 */
  logFile: string
  /** 面向使用者的处置建议。 */
  hints: string[]
}

/** 可注入依赖，便于测试。 */
export interface DshRestartDeps {
  argv?: string[]
  env?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
  executable?: string
  /** 派生子进程（默认 node:child_process.spawn），测试可桩掉。 */
  spawnProcess?: (command: string, args: string[], options: SpawnOptions) => { unref: () => void; pid?: number | undefined }
  /** 安排自身退出（默认 setTimeout + unref），测试可桩掉。 */
  scheduleExit?: (run: () => void, delayMs: number) => void
  /** 留痕日志路径；默认 DSH_HOME/logs/dsh-web-restart.log。 */
  logFile?: string
  /** 引导脚本路径；默认 DSH_HOME/devforge/restart-bootstrap.cjs。 */
  bootstrapScript?: string
  /** 面板/工具消息里的附加说明。 */
  now?: () => Date
}

/** 让 HTTP 响应完整返回后再结束当前宿主。 */
const SHUTDOWN_DELAY_MS = 300
/** 引导进程首次动作前的缓冲，给旧宿主留出退出时间。 */
const FIRST_ACTION_DELAY_MS = 800
/** 子进程持续运行超过此窗口即认为宿主已稳定启动。 */
const STARTUP_STABLE_WINDOW_MS = 3000
/** 引导进程最多尝试拉起宿主的次数。 */
const MAX_BOOT_ATTEMPTS = 8
/** 桌面模式下等待桌面壳自行拉起新宿主的预算。 */
const DESKTOP_SHELL_WAIT_MS = 60000
/** CLI 模式下等待旧宿主释放端口的预算。 */
const CLI_WAIT_FREE_MS = 45000
/** 端口探测单次超时。 */
const PROBE_TIMEOUT_MS = 700

/** 是否由桌面壳托管（argv 含 dsh-desktop-host，或显式声明桌面环境）。 */
export function isDesktopManagedHost(argv: string[], env: NodeJS.ProcessEnv): boolean {
  if (argv.some(value => value.includes('dsh-desktop-host'))) return true
  return env.DSH_DESKTOP === '1' && env.ELECTRON_RUN_AS_NODE === '1'
}

/** 解析本次重启针对的端口：命令行 --port 优先，其次环境变量，最后 19387。 */
export function resolveRestartPort(argv: string[], env: NodeJS.ProcessEnv): number {
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    const inline = /^--(?:web-)?port=(\d+)$/.exec(value)
    if (inline !== null) return Number(inline[1])
    if ((value === '--port' || value === '--web-port') && argv[index + 1] !== undefined && /^\d+$/.test(argv[index + 1])) {
      return Number(argv[index + 1])
    }
  }
  const fromEnv = env.DSH_PORT ?? env.DSH_WEB_PORT
  if (fromEnv !== undefined && /^\d+$/.test(fromEnv)) return Number(fromEnv)
  const fromUrl = /^https?:\/\/[^:/]+:(\d+)/.exec(env.DSH_WEB_URL ?? '')
  if (fromUrl !== null) return Number(fromUrl[1])
  return 19387
}

/** 探测 127.0.0.1:port 是否已有人监听。 */
export async function probePort(port: number, timeoutMs: number = PROBE_TIMEOUT_MS): Promise<boolean> {
  return await new Promise<boolean>(resolve => {
    const socket = connect({ host: '127.0.0.1', port })
    let settled = false
    const finish = (value: boolean): void => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(value)
    }
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
    const timer = setTimeout(() => finish(false), timeoutMs)
    timer.unref()
  })
}

/** 列出监听指定端口的进程 PID（Windows 用 netstat，其它平台用 ss/lsof）。 */
export function listPortOwners(port: number, platform: NodeJS.Platform = process.platform): PortOwner[] {
  const pids = new Set<number>()
  try {
    if (platform === 'win32') {
      const result = spawnSync('netstat', ['-ano'], { encoding: 'utf8', windowsHide: true })
      for (const line of String(result.stdout ?? '').split(/\r?\n/)) {
        if (!line.includes(':' + String(port))) continue
        if (!/LISTENING/i.test(line)) continue
        const parts = line.trim().split(/\s+/)
        const last = parts[parts.length - 1]
        if (/^\d+$/.test(last)) pids.add(Number(last))
      }
    } else {
      const result = spawnSync('sh', ['-c', 'ss -ltnp 2>/dev/null || lsof -nP -iTCP:' + String(port) + ' -sTCP:LISTEN 2>/dev/null'], { encoding: 'utf8' })
      for (const match of String(result.stdout ?? '').matchAll(/pid=(\d+)|^(\S+\s+)?\S+\s+(\d+)\s/gm)) {
        const value = match[1] ?? match[3]
        if (value !== undefined) pids.add(Number(value))
      }
    }
  } catch {
    // 端口占用者查询失败不影响主流程。
  }
  return [...pids].map(pid => ({ pid }))
}

/** 批量补齐进程名与父进程信息（仅 Windows，一次 PowerShell 查询）。 */
export function describeProcesses(pids: number[], platform: NodeJS.Platform = process.platform): Map<number, PortOwner> {
  const described = new Map<number, PortOwner>()
  if (pids.length === 0 || platform !== 'win32') return described
  const filter = pids.map(pid => 'ProcessId=' + String(pid)).join(' OR ')
  const script = 'Get-CimInstance Win32_Process -Filter "' + filter + '" | Select-Object ProcessId,ParentProcessId,Name | ConvertTo-Json -Compress'
  try {
    const result = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', windowsHide: true, timeout: 15000 })
    const raw = String(result.stdout ?? '').trim()
    if (raw === '') return described
    const parsed: unknown = JSON.parse(raw)
    const rows = Array.isArray(parsed) ? parsed : [parsed]
    const all = new Set<number>()
    for (const row of rows) {
      const record = row as { ProcessId?: number; ParentProcessId?: number; Name?: string }
      if (typeof record.ParentProcessId === 'number') all.add(record.ParentProcessId)
    }
    const alive = new Set<number>()
    for (const pid of all) {
      try {
        process.kill(pid, 0)
        alive.add(pid)
      } catch {
        // 进程不存在，保持不在 alive 集合中。
      }
    }
    for (const row of rows) {
      const record = row as { ProcessId?: number; ParentProcessId?: number; Name?: string }
      if (typeof record.ProcessId !== 'number') continue
      described.set(record.ProcessId, {
        pid: record.ProcessId,
        name: record.Name,
        parentPid: record.ParentProcessId,
        parentAlive: typeof record.ParentProcessId === 'number' ? alive.has(record.ParentProcessId) : undefined,
      })
    }
  } catch {
    // 进程详情缺失时保留 PID 即可。
  }
  return described
}

/** 本机 DSH Web 重启调度器。 */
export class DshWebRestartManager {
  /** 当前生命周期是否已经安排重启，防止连点竞争端口。 */
  private scheduled = false
  private readonly argv: string[]
  private readonly env: NodeJS.ProcessEnv
  private readonly platform: NodeJS.Platform
  private readonly executable: string
  private readonly spawnProcess: (command: string, args: string[], options: SpawnOptions) => { unref: () => void; pid?: number | undefined }
  private readonly scheduleExit: (run: () => void, delayMs: number) => void
  private readonly logFile: string
  private readonly bootstrapScript: string

  constructor(deps: DshRestartDeps = {}) {
    const env = deps.env ?? process.env
    this.argv = deps.argv ?? process.argv.slice(1)
    this.env = env
    this.platform = deps.platform ?? process.platform
    this.executable = deps.executable ?? process.execPath
    this.spawnProcess = deps.spawnProcess ?? ((command, args, options) => spawn(command, args, options))
    this.scheduleExit = deps.scheduleExit ?? ((run, delayMs) => {
      const timer = setTimeout(run, delayMs)
      timer.unref()
    })
    const home = env.DSH_HOME ?? homedir()
    this.logFile = deps.logFile ?? join(home, 'logs', 'dsh-web-restart.log')
    this.bootstrapScript = deps.bootstrapScript ?? join(home, 'devforge', 'restart-bootstrap.cjs')
  }

  /** 当前运行模式。 */
  get mode(): DshRestartMode {
    return isDesktopManagedHost(this.argv, this.env) ? 'desktop' : 'cli'
  }

  /** 当前重启端口。 */
  get port(): number {
    return resolveRestartPort(this.argv, this.env)
  }

  /** 当前采用的引导策略。 */
  get strategy(): DshRestartStrategy {
    return this.mode === 'desktop' ? 'desktop-shell-handoff' : 'cli-sequential-bootstrap'
  }

  /** 只读体检：端口占用者、孤儿判定与处置建议。 */
  async diagnose(): Promise<DshRestartDiagnosis> {
    const port = this.port
    const listening = await probePort(port)
    const rawOwners = listening ? listPortOwners(port, this.platform) : []
    const described = describeProcesses(rawOwners.map(owner => owner.pid), this.platform)
    const owners = rawOwners.map(owner => described.get(owner.pid) ?? owner)
    const mine = owners.find(owner => owner.pid === process.pid) !== undefined
    // 孤儿判定：端口监听者不是本进程，且它的父进程已经消失。
    const orphanSuspected = owners.some(owner => owner.pid !== process.pid && owner.parentPid !== undefined && owner.parentAlive === false)
    const hints: string[] = []
    if (this.mode === 'desktop') {
      hints.push('桌面版：宿主由 DeepSeek Harness 壳托管，重启时只请求宿主退出，新宿主由壳拉起，插件不再自行拉起第二个宿主。')
    } else {
      hints.push('CLI 模式：引导进程会先等 ' + String(port) + ' 端口真正释放再拉起新宿主。')
    }
    if (listening && !mine) {
      hints.push(String(port) + ' 当前已被 PID ' + owners.map(owner => String(owner.pid)).join('、') + ' 监听；若这些进程无窗口且父进程已消失，即为旧版重启遗留的孤儿宿主。')
      if (orphanSuspected) {
        hints.push('检测到疑似孤儿宿主：结束该进程后重新启动即可恢复（面板诊断给出的 PID 可直接用于 Stop-Process）。')
      }
    }
    if (listening && mine) hints.push(String(port) + ' 由当前宿主自己监听，属于正常状态。')
    if (!listening) hints.push(String(port) + ' 当前空闲，可直接拉起宿主。')
    return {
      mode: this.mode,
      port,
      portListening: listening,
      owners,
      orphanSuspected,
      selfPid: process.pid,
      selfOwnsPort: mine,
      bootstrapScript: this.bootstrapScript,
      logFile: this.logFile,
      hints,
    }
  }

  /**
   * 安排一次重启。
   *
   * 桌面版把宿主生命周期交还桌面壳（引导进程只做看门狗与兜底），CLI 模式由引导进程
   * 等端口释放后顺序拉起。当前宿主在 HTTP 响应返回后退出，GUI 会短暂断开。
   */
  requestRestart(): DshRestartResult {
    const mode = this.mode
    const strategy = this.strategy
    const port = this.port
    if (this.scheduled) {
      return { scheduled: true, mode, port, strategy, message: 'DSH 已在重启中，请等待服务恢复。' }
    }

    this.scheduled = true
    try {
      this.writeBootstrapScript()
      this.launchBootstrap(mode, port)
      this.appendLog({ stage: 'restart-requested', mode, port, strategy, argv: this.argv })
    } catch (error) {
      this.scheduled = false
      this.appendLog({ stage: 'restart-request-failed', mode, port, error: error instanceof Error ? error.message : String(error) })
      throw error
    }
    console.info('[dsh-devforge] 已安排 DSH Web 重启（' + mode + ' 模式，端口 ' + String(port) + '）。')

    this.scheduleExit(() => {
      if (this.platform === 'win32') {
        process.exit(0)
      }
      process.kill(process.pid, 'SIGTERM')
    }, SHUTDOWN_DELAY_MS)

    return {
      scheduled: true,
      mode,
      port,
      strategy,
      message: mode === 'desktop'
        ? '桌面版正在重启：已请求宿主退出，DeepSeek Harness 会自动拉起新宿主（引导进程仅做兜底看门狗）。'
        : 'DSH 正在重启，服务恢复后页面将自动刷新。',
    }
  }

  /** 写入留痕日志（JSON 行，失败不影响重启）。 */
  private appendLog(entry: Record<string, unknown>): void {
    try {
      mkdirSync(dirname(this.logFile), { recursive: true })
      appendFileSync(this.logFile, JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n')
    } catch {
      // 留痕失败不影响重启。
    }
  }

  /** 生成引导脚本：桌面版只做看门狗，CLI 版等端口释放后顺序拉起。 */
  private writeBootstrapScript(): void {
    mkdirSync(dirname(this.bootstrapScript), { recursive: true })
    writeFileSync(this.bootstrapScript, BOOTSTRAP_SCRIPT, 'utf8')
  }

  /** 启动与当前宿主分离的引导进程，保留原始启动命令用于兜底。 */
  private launchBootstrap(mode: DshRestartMode, port: number): void {
    if (this.argv.length === 0) throw new Error('无法确定当前 DSH Web 的启动参数，已取消重启。')
    const options = {
      mode,
      port,
      logFile: this.logFile,
      maxAttempts: MAX_BOOT_ATTEMPTS,
      stableWindowMs: STARTUP_STABLE_WINDOW_MS,
      firstActionDelayMs: FIRST_ACTION_DELAY_MS,
      shellWaitMs: DESKTOP_SHELL_WAIT_MS,
      waitFreeMs: CLI_WAIT_FREE_MS,
    }
    const bootstrap = this.spawnProcess(
      this.executable,
      [this.bootstrapScript, this.executable, JSON.stringify(this.argv), JSON.stringify(options)],
      { detached: true, stdio: 'ignore', env: this.env, windowsHide: true },
    )
    bootstrap.unref()
  }
}

/**
 * 引导脚本（写入 DSH_HOME/devforge/restart-bootstrap.cjs）。
 *
 * 参数：argv[2]=宿主可执行文件，argv[3]=原始启动参数 JSON，argv[4]=选项 JSON。
 * 桌面模式先等桌面壳把宿主拉起来（预算内探到端口即收工），只有壳明显没恢复时才兜底；
 * CLI 模式先等端口释放再拉起，失败按退避重试，并记录端口占用者 PID。
 */
const BOOTSTRAP_SCRIPT = `'use strict'
// 由 dsh-devforge 在重启时生成，请勿手工修改。
const { spawn, spawnSync } = require('node:child_process')
const { appendFileSync, mkdirSync, openSync } = require('node:fs')
const { dirname } = require('node:path')
const net = require('node:net')

const executable = process.argv[2]
const args = JSON.parse(process.argv[3])
const options = JSON.parse(process.argv[4])
const logFile = options.logFile

function log(stage, detail) {
  try {
    mkdirSync(dirname(logFile), { recursive: true })
    appendFileSync(logFile, JSON.stringify({ at: new Date().toISOString(), stage, detail: detail || {} }) + '\\n')
  } catch {}
}

function probe(port) {
  return new Promise(function (resolve) {
    const socket = net.connect({ host: '127.0.0.1', port: port })
    let settled = false
    function finish(value) { if (settled) return; settled = true; socket.destroy(); resolve(value) }
    socket.once('connect', function () { finish(true) })
    socket.once('error', function () { finish(false) })
    setTimeout(function () { finish(false) }, 700)
  })
}

function ownersOf(port) {
  try {
    const result = spawnSync('netstat', ['-ano'], { encoding: 'utf8', windowsHide: true })
    const pids = []
    const lines = String(result.stdout || '').split(/\\r?\\n/)
    for (const line of lines) {
      if (line.indexOf(':' + port) === -1) continue
      if (!/LISTENING/i.test(line)) continue
      const parts = line.trim().split(/\\s+/)
      const last = parts[parts.length - 1]
      if (/^\\d+$/.test(last) && pids.indexOf(last) === -1) pids.push(last)
    }
    return pids
  } catch { return [] }
}

function delay(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms) }) }

function waitPort(port, budgetMs, wantListening) {
  return (async function () {
    const deadline = Date.now() + budgetMs
    for (;;) {
      const listening = await probe(port)
      if (listening === wantListening) return true
      if (Date.now() >= deadline) return false
      await delay(1000)
    }
  })()
}

function startHost() {
  return (async function () {
    for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
      if (await probe(options.port)) {
        log('port-already-served', { attempt: attempt })
        return true
      }
      const logFd = openSync(logFile, 'a')
      const child = spawn(executable, args, { detached: true, stdio: ['ignore', logFd, logFd], env: process.env, windowsHide: true })
      log('host-spawn', { attempt: attempt, pid: child.pid })
      const outcome = await new Promise(function (resolve) {
        let settled = false
        function finish(value) { if (settled) return; settled = true; resolve(value) }
        const stableTimer = setTimeout(function () { finish('stable') }, options.stableWindowMs)
        stableTimer.unref && stableTimer.unref()
        child.once('error', function (error) { clearTimeout(stableTimer); finish('error:' + (error && error.message ? error.message : error)) })
        child.once('exit', function (code) { clearTimeout(stableTimer); finish('exit:' + code) })
      })
      if (outcome === 'stable') {
        child.unref()
        log('host-stable', { attempt: attempt, pid: child.pid })
        return true
      }
      const owners = ownersOf(options.port)
      log('host-attempt-failed', { attempt: attempt, outcome: outcome, portOwners: owners })
      if (owners.length > 0) {
        log('abort-port-occupied', { owners: owners })
        return false
      }
      await delay(1500)
    }
    log('host-attempts-exhausted', { attempts: options.maxAttempts })
    return false
  })()
}

;(async function main() {
  log('bootstrap-start', { mode: options.mode, port: options.port, pid: process.pid })
  await delay(options.firstActionDelayMs)
  if (options.mode === 'desktop') {
    const recovered = await waitPort(options.port, options.shellWaitMs, true)
    if (recovered) {
      log('desktop-shell-recovered', { portOwners: ownersOf(options.port) })
      return
    }
    log('desktop-shell-timeout', { afterMs: options.shellWaitMs, portOwners: ownersOf(options.port) })
  } else {
    const free = await waitPort(options.port, options.waitFreeMs, false)
    log(free ? 'port-released' : 'port-still-busy', { portOwners: ownersOf(options.port) })
  }
  const started = await startHost()
  log('bootstrap-done', { started: started })
})()
`
