/**
 * 原生截图助手（PowerShell 常驻进程）的生命周期管理与请求队列。
 *
 * 通信方式：文件队列即 RPC。助手把识别/翻译请求连同 PNG 写进 requests/，
 * 宿主轮询处理并回写 responses/；这样助手既不需要知道 Web 端口，也拿不到任何凭据。
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { readFileSync, readdirSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { join, resolve as resolvePath, sep } from 'node:path'
import type { WinSnipHeartbeat, WinSnipSettings, WinSnipStatus, WinSnipVisionRequest, WinSnipVisionResponse } from './protocol.ts'
import { isWinSnipSupported, parseHotkey } from './protocol.ts'
import { ensureWinSnipPaths, resolveNativeScript, winSnipPaths, type WinSnipPaths } from './paths.ts'
import { resolveSaveDir } from './store.ts'
import type { WinSnipVision } from './vision.ts'

/** 轮询请求队列的间隔（毫秒）。 */
const POLL_INTERVAL_MS = 200

/** 心跳超过该时长视为进程已失联（毫秒）。 */
const HEARTBEAT_STALE_MS = 30000

/** 请求 id 白名单：只允许字母数字与短横线，防止路径穿越。 */
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/

/** 助手激活依赖。 */
export interface WinSnipAssistantDeps {
  /** 读取当前配置。 */
  settings: () => WinSnipSettings
  /** 识别/翻译通道。 */
  vision: WinSnipVision
  /** 日志输出（宿主 logger）。 */
  log: (message: string, ...args: unknown[]) => void
}

/**
 * 助手进程管理。
 *
 * 一个进程同时承载热键、遮罩编辑器与浮窗；插件卸载或用户关闭开关时整体结束，
 * 不在系统里留下常驻后台进程。
 */
export class WinSnipAssistant {
  private readonly deps: WinSnipAssistantDeps
  private child: ChildProcess | undefined
  private poller: NodeJS.Timeout | undefined
  private busy = false
  private lastMessage: string | undefined

  constructor(deps: WinSnipAssistantDeps) {
    this.deps = deps
  }

  /** 运行目录（按当前 DSH_HOME 解析，保证暂存实例隔离）。 */
  private paths(): WinSnipPaths {
    return winSnipPaths()
  }

  /** 启动助手；已在运行时直接返回。 */
  start(): void {
    if (!isWinSnipSupported()) {
      this.lastMessage = '当前平台不是 Windows，截图小工具不可用。'
      return
    }
    if (this.child !== undefined && this.child.exitCode === null) return
    const script = resolveNativeScript('win-snip-assistant.ps1')
    if (script === undefined) {
      this.lastMessage = '缺少原生脚本（lib/native/win-snip-assistant.ps1），请重新构建插件。'
      this.deps.log('[dsh-devforge] win-snip: %s', this.lastMessage)
      return
    }
    const settings = this.deps.settings()
    const hotkey = parseHotkey(settings.hotkey)
    if (hotkey === undefined) {
      this.lastMessage = '热键配置无效，无法启动截图助手：' + settings.hotkey
      this.deps.log('[dsh-devforge] win-snip: %s', this.lastMessage)
      return
    }
    let paths: WinSnipPaths
    try {
      paths = this.paths()
      ensureWinSnipPaths(paths)
    } catch (error) {
      this.lastMessage = '无法创建截图工作目录：' + describe(error)
      this.deps.log('[dsh-devforge] win-snip: %s', this.lastMessage)
      return
    }
    // 启动前清掉上一次运行留下的心跳与未完成请求，避免误判存活或重复处理。
    try { unlinkSync(paths.statusFile) } catch { /* 文件不存在属正常 */ }
    this.pruneQueue(paths)

    const args = [
      '-NoProfile',
      '-ExecutionPolicy', 'Bypass',
      '-WindowStyle', 'Hidden',
      '-File', script,
      '-Modifiers', String(hotkey.modifiers),
      '-VirtualKey', String(hotkey.virtualKey),
      '-HotkeyLabel', hotkey.label,
      '-BaseDir', paths.root,
      '-SaveDir', resolveSaveDir(settings),
      '-CopyOnFinish', settings.copyOnFinish ? '1' : '0',
    ]
    try {
      this.child = spawn('powershell.exe', args, { windowsHide: true, stdio: 'ignore' })
    } catch (error) {
      this.lastMessage = '启动截图助手失败：' + describe(error)
      this.deps.log('[dsh-devforge] win-snip: %s', this.lastMessage)
      return
    }
    this.child.on('exit', (code) => {
      this.deps.log('[dsh-devforge] win-snip: 助手进程退出（code=%s）', String(code))
      this.child = undefined
    })
    this.child.on('error', (error) => {
      this.lastMessage = '截图助手进程异常：' + describe(error)
      this.deps.log('[dsh-devforge] win-snip: %s', this.lastMessage)
    })
    this.lastMessage = undefined
    this.startPoller(paths)
    this.deps.log('[dsh-devforge] win-snip: 已启动助手 pid=%s 热键=%s', String(this.child.pid ?? ''), hotkey.label)
  }

  /** 停止助手（连同其子窗口）。 */
  stop(): void {
    this.stopPoller()
    const child = this.child
    this.child = undefined
    if (child === undefined) return
    const pid = child.pid
    if (pid === undefined) return
    // Windows 上 taskkill /T 能一并回收消息循环派生出的窗口进程；失败再兜底 kill。
    try {
      spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
    } catch {
      try { child.kill() } catch { /* 进程可能已退出 */ }
    }
    this.deps.log('[dsh-devforge] win-snip: 已请求停止助手 pid=%s', String(pid))
  }

  /** 按配置重启（热键或保存目录变化后调用）。 */
  restart(): void {
    this.stop()
    if (this.deps.settings().enabled) this.start()
  }

  /** 触发一次截图（写入命令文件，由助手消费）。 */
  requestCapture(): void {
    if (!this.isRunning()) throw new Error('截图助手未运行，请先在面板启动。')
    const paths = this.paths()
    ensureWinSnipPaths(paths)
    const commandPath = join(paths.commands, 'capture-' + String(Date.now()) + '.json')
    writeFileSync(commandPath, JSON.stringify({ action: 'capture' }), 'utf8')
  }

  /** 进程是否存活（以子进程状态为准）。 */
  isRunning(): boolean {
    return this.child !== undefined && this.child.exitCode === null
  }

  /** 汇总状态给面板。 */
  status(): WinSnipStatus {
    const settings = this.deps.settings()
    const supported = isWinSnipSupported()
    const heartbeat = this.readHeartbeat()
    const running = this.isRunning() && heartbeat !== undefined
    const message = supported ? this.lastMessage ?? heartbeat?.error : '当前平台不是 Windows，截图小工具不可用。'
    return {
      supported,
      enabled: settings.enabled,
      running,
      ...(running && heartbeat !== undefined ? { pid: heartbeat.pid, startedAt: heartbeat.startedAt } : {}),
      hotkey: settings.hotkey,
      ...(heartbeat?.lastCaptureAt !== undefined ? { lastCaptureAt: heartbeat.lastCaptureAt } : {}),
      captures: heartbeat?.captures ?? 0,
      saveDir: resolveSaveDir(settings),
      ...(message === undefined ? {} : { message }),
    }
  }

  /** 插件卸载时整体回收。 */
  dispose(): void {
    this.stop()
  }

  /** 读取心跳文件；进程号不符或过旧都视为无效。 */
  private readHeartbeat(): WinSnipHeartbeat | undefined {
    const paths = this.paths()
    try {
      const info = statSync(paths.statusFile)
      if (Date.now() - info.mtimeMs > HEARTBEAT_STALE_MS) return undefined
      const raw = JSON.parse(readFileSync(paths.statusFile, 'utf8')) as Partial<WinSnipHeartbeat>
      if (typeof raw.pid !== 'number' || typeof raw.startedAt !== 'string') return undefined
      return {
        pid: raw.pid,
        hotkey: typeof raw.hotkey === 'string' ? raw.hotkey : '',
        startedAt: raw.startedAt,
        ...(typeof raw.lastCaptureAt === 'string' ? { lastCaptureAt: raw.lastCaptureAt } : {}),
        captures: typeof raw.captures === 'number' ? raw.captures : 0,
        ...(typeof raw.error === 'string' && raw.error !== '' ? { error: raw.error } : {}),
      }
    } catch {
      return undefined
    }
  }

  /** 开始轮询请求队列。 */
  private startPoller(paths: WinSnipPaths): void {
    this.stopPoller()
    this.poller = setInterval(() => { void this.drainOnce(paths) }, POLL_INTERVAL_MS)
    // 轮询不应拖住宿主退出。
    this.poller.unref?.()
  }

  /** 停止轮询。 */
  private stopPoller(): void {
    if (this.poller !== undefined) {
      clearInterval(this.poller)
      this.poller = undefined
    }
  }

  /** 处理一轮队列；同一时刻只跑一个请求，避免并发打爆模型通道。 */
  private async drainOnce(paths: WinSnipPaths): Promise<void> {
    if (this.busy) return
    let names: string[]
    try {
      names = readdirSync(paths.requests)
    } catch {
      return
    }
    const pending = names.filter((name) => name.endsWith('.json'))
    if (pending.length === 0) return
    this.busy = true
    try {
      for (const name of pending) await this.handleRequest(paths, join(paths.requests, name))
    } finally {
      this.busy = false
    }
  }

  /** 处理单个请求：校验 → 调模型 → 回写 → 清理。 */
  private async handleRequest(paths: WinSnipPaths, requestPath: string): Promise<void> {
    let request: WinSnipVisionRequest
    try {
      request = JSON.parse(readFileSync(requestPath, 'utf8')) as WinSnipVisionRequest
    } catch {
      try { unlinkSync(requestPath) } catch { /* 已删除 */ }
      return
    }
    const id = typeof request.id === 'string' && SAFE_ID.test(request.id) ? request.id : ''
    if (id === '') {
      try { unlinkSync(requestPath) } catch { /* 已删除 */ }
      return
    }
    const responsePath = join(paths.responses, id + '.json')
    try {
      const imagePath = this.assertInsideRequests(paths, request.imagePath)
      if (request.kind !== 'ocr' && request.kind !== 'translate') throw new Error('未知的处理类型。')
      // 直接走 DSH 的模型服务：把图片字节登记为附件后交给当前默认模型，
      // 用户不需要为识别/翻译单独配置任何 Key。
      const imageBytes = readFileSync(imagePath)
      const result = await this.deps.vision.run({
        kind: request.kind,
        imageBytes,
        ...(request.targetLang !== undefined ? { targetLang: request.targetLang } : {}),
      })
      const response: WinSnipVisionResponse = {
        id,
        ok: true,
        ...(result.text !== '' ? { text: result.text } : {}),
        ...(result.translation !== undefined ? { translation: result.translation } : {}),
      }
      writeFileSync(responsePath, JSON.stringify(response), 'utf8')
      this.deps.log('[dsh-devforge] win-snip: 处理完成 %s（%s）', id, request.kind)
    } catch (error) {
      const response: WinSnipVisionResponse = { id, ok: false, error: describe(error) }
      writeFileSync(responsePath, JSON.stringify(response), 'utf8')
      this.deps.log('[dsh-devforge] win-snip: 处理失败 %s：%s', id, describe(error))
    } finally {
      try { unlinkSync(requestPath) } catch { /* 已删除 */ }
      try { rmSync(join(paths.requests, id + '.png'), { force: true }) } catch { /* 已删除 */ }
    }
  }

  /** 只允许读取 requests 目录内的图片，防止被当成任意文件读取器。 */
  private assertInsideRequests(paths: WinSnipPaths, imagePath: unknown): string {
    if (typeof imagePath !== 'string' || imagePath === '') throw new Error('请求缺少图片路径。')
    const full = resolvePath(imagePath)
    const root = resolvePath(paths.requests)
    if (full !== root && !full.startsWith(root + sep)) throw new Error('图片路径不在截图队列目录内，已拒绝。')
    return full
  }

  /** 清理过旧的历史文件（超过一天），避免目录无限膨胀。 */
  private pruneQueue(paths: WinSnipPaths): void {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000
    for (const dir of [paths.requests, paths.responses, paths.commands]) {
      let names: string[] = []
      try { names = readdirSync(dir) } catch { continue }
      for (const name of names) {
        const full = join(dir, name)
        try {
          if (statSync(full).mtimeMs < cutoff) unlinkSync(full)
        } catch { /* 单个文件清理失败不影响启动 */ }
      }
    }
  }
}

/** 把任意异常收敛成一句可读中文。 */
function describe(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}
