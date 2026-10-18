/**
 * 截图小工具的运行目录与原生脚本定位。
 *
 * 目录落在 DSH_HOME 下（`<DSH_HOME>/devforge/win-snip`），随实例隔离：
 * 暂存实例用独立 HOME 时，其截图队列、心跳与日志不会与生产互相干扰。
 */
import { existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 一组运行时目录与文件路径。 */
export interface WinSnipPaths {
  /** 根目录。 */
  root: string
  /** 宿主 → 助手 命令队列目录。 */
  commands: string
  /** 助手 → 宿主 识别/翻译请求目录。 */
  requests: string
  /** 宿主 → 助手 处理结果目录。 */
  responses: string
  /** 助手心跳文件。 */
  statusFile: string
  /** 助手日志文件。 */
  logFile: string
}

/** 解析 DSH 主目录：优先环境变量（暂存实例靠它隔离），否则用户主目录下的 .dsh。 */
export function dshHomeDir(): string {
  const overridden = process.env.DSH_HOME?.trim()
  return overridden !== undefined && overridden !== '' ? overridden : join(homedir(), '.dsh')
}

/** 计算标准路径（不做任何磁盘写入）。 */
export function winSnipPaths(baseDir: string = dshHomeDir()): WinSnipPaths {
  const root = join(baseDir, 'devforge', 'win-snip')
  return {
    root,
    commands: join(root, 'commands'),
    requests: join(root, 'requests'),
    responses: join(root, 'responses'),
    statusFile: join(root, 'status.json'),
    logFile: join(root, 'logs', 'assistant.log'),
  }
}

/** 确保目录存在（幂等）；失败抛出，由调用方决定如何提示。 */
export function ensureWinSnipPaths(paths: WinSnipPaths): void {
  for (const dir of [paths.root, paths.commands, paths.requests, paths.responses, dirname(paths.logFile)]) {
    mkdirSync(dir, { recursive: true })
  }
}

/** 宿主这份代码所在目录（构建产物在 lib/，源码在 src/）。 */
function moduleDir(): string {
  return dirname(fileURLToPath(import.meta.url))
}

/**
 * 定位原生脚本目录。
 *
 * 依次尝试：产物同级 `native/`、包根 `lib/native/`、源码树 `src/win-snip/native/`。
 * 这样开发态（直接跑源码）与安装态（跑 lib/index.js）都能找到脚本。
 *
 * @returns 找到的目录绝对路径；都没找到时返回 undefined。
 */
export function resolveNativeDir(): string | undefined {
  const here = moduleDir()
  const candidates = [
    join(here, 'native'),
    join(here, '..', 'lib', 'native'),
    join(here, '..', 'src', 'win-snip', 'native'),
  ]
  for (const candidate of candidates) {
    if (existsSync(join(candidate, 'win-snip-assistant.ps1'))) return candidate
  }
  return undefined
}

/** 取某个原生脚本的绝对路径；目录缺失或脚本缺失时返回 undefined。 */
export function resolveNativeScript(name: string): string | undefined {
  const dir = resolveNativeDir()
  if (dir === undefined) return undefined
  const full = join(dir, name)
  return existsSync(full) ? full : undefined
}
