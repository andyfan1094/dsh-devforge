/**
 * 孤儿宿主守卫（0.64.3）。
 *
 * 背景：DSH 桌面壳（Electron 主进程）把宿主（dsh-desktop-host）作为 detached 子进程
 * 拉起；壳退出或重启时不会结束该子进程，旧宿主继续持有飞书长连接与 store.db。
 * 结果：同一 appId 出现多路长连接抢同一飞书事件，面板设置只写进其中一个实例的内存，
 * 表现为「通知和聊天时好时坏、设置没效果」（2026-10-19/20 线上实录：15:45、16:47、
 * 次日 8:47 各遗留一个孤儿宿主）。
 *
 * 守卫策略（只做一件事，宁可漏杀不可误杀）：
 *   1. 仅在桌面托管模式（argv 含 dsh-desktop-host）且 Windows 上启用；
 *   2. 只认命令行同时含 dsh-desktop-host 与当前 profile 目录的进程；
 *   3. 只结束「父进程已退出」的进程——父进程存活的多窗口/正常重启实例一律不碰；
 *   4. 永不结束自己；结束失败只记 failed，不中断插件启动；
 *   5. 每次清扫写 JSON 行到 ~/.dsh/logs/devforge-orphan-sweep.log 留痕。
 */
import { spawnSync } from 'node:child_process'
import { appendFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { isDesktopManagedHost } from './restart.ts'

/** 进程快照：守卫只需要这四个字段。 */
export interface HostProcessSnapshot {
  pid: number
  parentPid: number
  name: string
  commandLine: string
}

/** 一次清扫的结果；skipped 表示因条件不满足而未执行。 */
export interface OrphanSweepResult {
  scanned: number
  sameProfileHosts: number
  orphans: number[]
  killed: number[]
  failed: number[]
  skipped?: string
}

/** 清扫依赖：全部可注入，单测不需要真实进程。 */
export interface OrphanSweepDeps {
  /** 读取本机进程快照。 */
  collect: () => HostProcessSnapshot[]
  /** 判断 pid 是否存活；无法判定时按存活处理（保守不杀）。 */
  isAlive: (pid: number) => boolean
  /** 结束进程；失败抛错由调用方记账。 */
  kill: (pid: number) => void
  /** 留痕日志写入（每次清扫一行 JSON）。 */
  log: (line: string) => void
  /** 当前宿主 pid（永不结束自己）。 */
  selfPid: number
  /** 当前 profile 目录（例如 C:\Users\Ada\.dsh\profiles\desktop）。 */
  profileHint: string
}

/** 统一路径分隔符与大小写，避免 Windows 反斜杠/大小写差异导致漏判。 */
function normalizePath(value: string): string {
  return String(value ?? '').replace(/\\/g, '/').toLowerCase()
}

/** 该进程是否是「本 profile 的桌面宿主」。 */
export function isDesktopHostOfProfile(processSnapshot: HostProcessSnapshot, profileHint: string): boolean {
  const commandLine = normalizePath(processSnapshot.commandLine)
  return commandLine.includes('dsh-desktop-host') && commandLine.includes(normalizePath(profileHint))
}

/**
 * 从进程快照里挑出孤儿宿主：同 profile 的桌面宿主、不是自己、父进程已退出。
 * 纯函数，单测可直接构造快照验证判定边界。
 */
export function findOrphanHosts(
  processes: HostProcessSnapshot[],
  selfPid: number,
  profileHint: string,
  isAlive: (pid: number) => boolean,
): HostProcessSnapshot[] {
  const orphans: HostProcessSnapshot[] = []
  for (const processSnapshot of processes) {
    if (processSnapshot.pid === selfPid) continue
    if (!isDesktopHostOfProfile(processSnapshot, profileHint)) continue
    if (!Number.isInteger(processSnapshot.parentPid) || processSnapshot.parentPid <= 0) continue
    // 自己的父进程是桌面壳，正常情况下存活；显式排除防御异常数据。
    if (processSnapshot.parentPid === selfPid) continue
    if (isAlive(processSnapshot.parentPid)) continue
    orphans.push(processSnapshot)
  }
  return orphans
}

/** 执行一次清扫：先收集、再判定、最后逐个结束并记账。 */
export function runOrphanSweep(deps: OrphanSweepDeps): OrphanSweepResult {
  const processes = deps.collect()
  const sameProfileHosts = processes.filter((processSnapshot) => isDesktopHostOfProfile(processSnapshot, deps.profileHint))
  const orphans = findOrphanHosts(processes, deps.selfPid, deps.profileHint, deps.isAlive)
  const killed: number[] = []
  const failed: number[] = []
  for (const orphan of orphans) {
    try {
      deps.kill(orphan.pid)
      killed.push(orphan.pid)
    } catch {
      // 结束失败（权限、进程刚好退出等）只记账，不影响其它孤儿与插件启动。
      failed.push(orphan.pid)
    }
  }
  const result: OrphanSweepResult = {
    scanned: processes.length,
    sameProfileHosts: sameProfileHosts.length,
    orphans: orphans.map((orphan) => orphan.pid),
    killed,
    failed,
  }
  deps.log(JSON.stringify({
    at: new Date().toISOString(),
    event: 'orphan-sweep',
    selfPid: deps.selfPid,
    profile: deps.profileHint,
    ...result,
  }))
  return result
}

/** 默认存活判定：EPERM 说明进程存在但无权限，按存活处理（保守不杀）。 */
function defaultIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** Windows 进程快照查询：一次 CIM 查询取回桌面宿主进程。 */
const PROCESS_SNAPSHOT_SCRIPT = 'Get-CimInstance Win32_Process -Filter "Name=\'DeepSeek Harness.exe\'" | Select-Object ProcessId,ParentProcessId,Name,CommandLine | ConvertTo-Json -Compress'

/**
 * 读取本机桌面壳/宿主进程快照。
 * 只查询 DeepSeek Harness.exe：CLI 宿主（node.exe）不在守卫范围，非桌面模式也不会调用。
 */
export function collectHostProcesses(platform: NodeJS.Platform = process.platform): HostProcessSnapshot[] {
  if (platform !== 'win32') return []
  let stdout = ''
  try {
    const result = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', PROCESS_SNAPSHOT_SCRIPT], {
      encoding: 'utf8',
      timeout: 15000,
      windowsHide: true,
    })
    stdout = String(result.stdout ?? '').trim()
  } catch {
    return []
  }
  if (stdout === '') return []
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout)
  } catch {
    return []
  }
  const rows = Array.isArray(parsed) ? parsed : [parsed]
  const snapshots: HostProcessSnapshot[] = []
  for (const row of rows) {
    if (row === null || typeof row !== 'object') continue
    const record = row as { ProcessId?: unknown; ParentProcessId?: unknown; Name?: unknown; CommandLine?: unknown }
    if (typeof record.ProcessId !== 'number' || typeof record.ParentProcessId !== 'number') continue
    snapshots.push({
      pid: record.ProcessId,
      parentPid: record.ParentProcessId,
      name: String(record.Name ?? ''),
      commandLine: String(record.CommandLine ?? ''),
    })
  }
  return snapshots
}

/** 从命令行里解析当前 desktop profile 目录；解析不到返回空串。 */
export function resolveProfileHint(argv: string[]): string {
  for (const value of argv) {
    const text = String(value ?? '').trim()
    if (text === '') continue
    if (/[\\/]profiles[\\/][^\\/]+[\\/]?$/.test(text)) return text.replace(/[\\/]+$/, '')
  }
  return ''
}

/** 启动入口可注入项（单测注入 sweep，避免真实进程操作）。 */
export interface OrphanSweepStartupOptions {
  argv?: string[]
  env?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
  logFile?: string
  /** 替身清扫函数（单测用）；缺省为 runOrphanSweep。 */
  sweep?: (deps: OrphanSweepDeps) => OrphanSweepResult
}

/** 构造一个空结果，用于条件不满足或清扫异常时返回。 */
function emptyResult(skipped: string): OrphanSweepResult {
  return { scanned: 0, sameProfileHosts: 0, orphans: [], killed: [], failed: [], skipped }
}

/**
 * 桌面宿主启动时调用一次：条件不满足直接跳过，任何异常都不向上抛，
 * 保证守卫本身不会拖垮插件启动。
 */
export function sweepOnDesktopStartup(options: OrphanSweepStartupOptions = {}): OrphanSweepResult {
  try {
    const argv = options.argv ?? process.argv
    const env = options.env ?? process.env
    const platform = options.platform ?? process.platform
    if (platform !== 'win32') return emptyResult('非 Windows 平台')
    if (!isDesktopManagedHost(argv, env)) return emptyResult('非桌面托管模式')
    const profileHint = resolveProfileHint(argv)
    if (profileHint === '') return emptyResult('未识别桌面 profile 路径')
    const logFile = options.logFile ?? join(env.DSH_HOME ?? homedir(), 'logs', 'devforge-orphan-sweep.log')
    const log = (line: string): void => {
      try {
        mkdirSync(dirname(logFile), { recursive: true })
        appendFileSync(logFile, line + '\n', 'utf8')
      } catch {
        // 留痕失败不影响清扫。
      }
    }
    const deps: OrphanSweepDeps = {
      collect: () => collectHostProcesses(platform),
      isAlive: defaultIsAlive,
      kill: (pid) => { process.kill(pid) },
      log,
      selfPid: process.pid,
      profileHint,
    }
    const sweep = options.sweep ?? runOrphanSweep
    return sweep(deps)
  } catch (error) {
    return emptyResult('清扫异常：' + (error instanceof Error ? error.message : String(error)))
  }
}
