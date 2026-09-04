/**
 * 项目一键发布 —— 对登记项目的发布目标逐台执行 deployCommand（0.19.x）。
 *
 * 设计与安全边界：
 * - deployCommand 是用户在面板里自己登记的命令（设计上就是「要在服务器上跑的东西」），
 *   不做命令内容审查；但项目路径由本模块统一加引号拼接，避免路径空格破坏命令。
 * - 复用远程运维激活后的同一引擎实例（同一连接池，不另开连接）。
 * - 多目标逐台执行、单台失败不中断其余，结果逐台返回；绝不回显凭据。
 */
import type { SshEngine } from '../remote/ssh/engine.ts'
import type { WinRmEngine } from '../remote/winrm/engine.ts'
import type { DeployTargetResult, ProjectDeployResult, ProjectEntry } from './protocol.ts'

/** 单台输出上限（字节），超出截断防刷屏。 */
const MAX_OUTPUT_CHARS = 4000

/** 默认单台执行超时（毫秒）：部署可能较久，给足 2 分钟。 */
const DEPLOY_TIMEOUT_MS = 120_000

/** POSIX 单引号包裹（路径里的单引号按 shell 规则转义）。 */
function shellQuote(value: string): string {
  return "'" + value.replace(/'/g, "'\\''") + "'"
}

/** PowerShell 单引号包裹（内部单引号翻倍转义）。 */
function psQuote(value: string): string {
  return "'" + value.replace(/'/g, "''") + "'"
}

/** 发布前的可执行性检查；返回错误消息或 undefined。 */
export function checkDeployable(entry: ProjectEntry): string | undefined {
  const command = (entry.deployCommand ?? '').trim()
  if (command === '') return '项目未登记发布命令（deployCommand），请先在「编辑」中填写。'
  if (entry.deployTargets.length === 0) return '项目未关联发布服务器，请先在「编辑」中勾选远程运维主机。'
  if (entry.pathExists === false) return '本机项目路径失效，请先重定位到本机实际路径。'
  return undefined
}

/** 组装单台命令：ssh 走 POSIX shell（cd 后执行）；winrm 走 PowerShell（Set-Location 后执行）。 */
export function buildRemoteCommand(entry: ProjectEntry, transport: 'ssh' | 'winrm', remotePath?: string): string {
  const command = (entry.deployCommand ?? '').trim()
  // 执行目录优先用该台目标自己的 remotePath（远程机上的路径），缺省回退项目本机路径。
  const workDir = remotePath !== undefined && remotePath.trim() !== '' ? remotePath.trim() : entry.path
  if (transport === 'ssh') return 'cd ' + shellQuote(workDir) + ' && ' + command
  return 'Set-Location -LiteralPath ' + psQuote(workDir) + '; ' + command
}

/** 引擎的最小形状（便于测试注入桩件，不耦合完整引擎类型）。 */
export interface DeployEngines {
  ssh?: { exec(alias: string, command: string, timeoutMs?: number): Promise<{ code?: number; stdout?: string; stderr?: string }> }
  winrm?: { exec(alias: string, command: string, timeoutMs?: number): Promise<{ code?: number; stdout?: string; stderr?: string }> }
}

/** 截断输出摘要。 */
function clampOutput(value: string | undefined): string | undefined {
  const text = (value ?? '').trim()
  if (text === '') return undefined
  return text.length > MAX_OUTPUT_CHARS ? text.slice(0, MAX_OUTPUT_CHARS) + '…（已截断）' : text
}

/**
 * 执行一键发布：逐台调用对应通道的 exec，单台失败收敛为该台结果；
 * 全部成功时整体 ok，否则整体失败但结果仍逐台完整返回。
 */
export async function runProjectDeploy(entry: ProjectEntry, engines: DeployEngines): Promise<ProjectDeployResult> {
  const notRunnable = checkDeployable(entry)
  if (notRunnable !== undefined) return { ok: false, results: [], error: notRunnable }
  if (engines.ssh === undefined && engines.winrm === undefined) {
    return { ok: false, results: [], error: '远程运维未启用（remote.enabled=false），无法执行发布。' }
  }

  const results: DeployTargetResult[] = []
  for (const target of entry.deployTargets) {
    const engine = target.transport === 'ssh' ? engines.ssh : engines.winrm
    if (engine === undefined) {
      results.push({ transport: target.transport, alias: target.alias, ok: false, error: '该通道引擎不可用（remote 未启用或类型不符）。' })
      continue
    }
    const command = buildRemoteCommand(entry, target.transport, target.remotePath)
    try {
      const outcome = await engine.exec(target.alias, command, DEPLOY_TIMEOUT_MS)
      const code = outcome.code ?? 0
      const output = clampOutput([outcome.stdout, outcome.stderr].filter((part) => part !== undefined && part !== '').join('\n'))
      results.push({
        transport: target.transport,
        alias: target.alias,
        ok: code === 0,
        exitCode: code,
        ...(output !== undefined ? { output } : {}),
        ...(code !== 0 ? { error: '远程命令退出码 ' + code } : {}),
      })
    } catch (cause) {
      results.push({
        transport: target.transport,
        alias: target.alias,
        ok: false,
        error: cause instanceof Error ? cause.message : String(cause),
      })
    }
  }
  return { ok: results.every((item) => item.ok), results }
}
