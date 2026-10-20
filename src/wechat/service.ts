/**
 * wx-auto 控制台进程管理 —— 让插件自己把后台管起来。
 *
 * 之前 wx-auto 是手工 `python server.py` 起的独立服务，DSH 一重启或机器一重启
 * 就成了「控制台离线」。这里改成插件内置运行：插件激活时自动拉起子进程，
 * 插件卸载/退出时杀掉，面板上也能手动启停。
 *
 * 只做进程托管，不碰 wx-auto 的业务代码；控制台仍是那个 Python 服务，
 * 监听 127.0.0.1:8765。
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createConnection } from 'node:net'

/** wx-auto 项目目录。 */
const WX_AUTO_DIR = 'D:/项目/projects/wx-auto'

/** 控制台脚本。 */
const WX_AUTO_SCRIPT = 'server.py'

/** 控制台端口。 */
export const WX_AUTO_PORT = 8765

let child: ChildProcess | null = null
let lastError = ''
let startedAt = 0

/** 子进程是否还活着。 */
export function isRunning(): boolean {
  return child !== null && child.exitCode === null && !child.killed
}

/** 进程拥有的 PID（未运行时为 null）。 */
export function pid(): number | null {
  return isRunning() ? (child?.pid ?? null) : null
}

/** 上次启动错误。 */
export function lastStartError(): string {
  return lastError
}

/** 启动时间戳（毫秒，0 表示未运行）。 */
export function launchedAt(): number {
  return isRunning() ? startedAt : 0
}

/** 用 TCP 连接探测端口（比 fetch 稳：不会因服务未就绪而挂起）。 */
function probePort(timeoutMs = 800): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port: WX_AUTO_PORT })
    let settled = false
    const done = (ok: boolean): void => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(ok)
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => done(true))
    socket.once('timeout', () => done(false))
    socket.once('error', () => done(false))
  })
}

/** 先探一下端口是否有响应，避免重复拉起。 */
async function probeHttp(): Promise<boolean> {
  return probePort()
}

/**
 * 启动 wx-auto 控制台。已在运行（本插件拉起或外部已有响应）时直接复用。
 * 返回 (ok, message) 供面板展示。
 */
export async function startWxAuto(): Promise<{ ok: boolean; message: string }> {
  if (isRunning()) return { ok: true, message: '控制台已在运行（插件托管）' }
  if (await probeHttp()) {
    return { ok: true, message: '控制台已在运行（外部进程，插件不接管）' }
  }
  if (!existsSync(`${WX_AUTO_DIR}/${WX_AUTO_SCRIPT}`)) {
    lastError = `找不到 ${WX_AUTO_DIR}/${WX_AUTO_SCRIPT}`
    return { ok: false, message: lastError }
  }
  lastError = ''
  try {
    // Windows 下 spawn('python') 不经过 shell，某些环境解析不到命令，
    // 这里显式走 shell 并保留工作目录；输出接管道以便失败时回传原因。
    child = spawn('python', ['-u', WX_AUTO_SCRIPT], {
      cwd: WX_AUTO_DIR,
      windowsHide: true,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1' },
    })
    let output = ''
    child.stdout?.on('data', (chunk: Buffer) => {
      output = (output + chunk.toString('utf-8')).slice(-2000)
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      output = (output + chunk.toString('utf-8')).slice(-2000)
    })
    child.on('exit', (code) => {
      if (code !== 0 && code !== null) {
        lastError = `控制台进程退出（code ${code}）：${output.trim().slice(-300) || '无输出'}`
      }
      child = null
    })
    child.on('error', (err) => {
      lastError = err.message
      child = null
    })
    startedAt = Date.now()
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error)
    return { ok: false, message: lastError }
  }
  // 给服务一点启动时间再回报（Python 首次导入较慢，最多等 25 秒）
  for (let i = 0; i < 50; i += 1) {
    if (await probeHttp()) return { ok: true, message: `控制台已启动（PID ${child?.pid ?? '—'}）` }
    if (lastError !== '') return { ok: false, message: lastError }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  lastError = '进程已拉起但端口 8765 无响应（检查 wx-auto 是否报错）'
  return { ok: false, message: lastError }
}

/** 停止插件托管的控制台；外部进程不动。 */
export function stopWxAuto(): { ok: boolean; message: string } {
  if (!isRunning()) return { ok: true, message: '控制台未在运行（插件托管范围内）' }
  const p = child
  child = null
  startedAt = 0
  try {
    p?.kill()
    return { ok: true, message: '已停止插件托管的控制台' }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    lastError = message
    return { ok: false, message }
  }
}

/** 插件退出时兜底杀进程。 */
export function disposeWxAuto(): void {
  if (child !== null) {
    try {
      child.kill()
    } catch {
      /* 忽略 */
    }
    child = null
    startedAt = 0
  }
}
