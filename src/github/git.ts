// Vendored from dsh-github 0.1.2 (Apache-2.0, andyfan1094/dsh-github).
// dsh-devforge consolidation modification: relative import paths adjusted to the
// devforge module layout; runtime behavior preserved. See THIRD_PARTY_NOTICES.md.
// dsh-devforge 修复（0.49.4）：
//   ① Git 可执行文件跨平台回退（旧环境迁移来的 macOS 路径会让整族工具 ENOENT）；
//   ② 认证头改为 GitHub git-over-HTTPS 实际接受的 Basic 形态（原 Bearer 会被判 invalid credentials）；
//   ③ spawn 失败与认证失败给出可操作的中文指引。
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import type { GithubStore, StoredAccount } from './store.ts'
import type { GitResult } from './protocol.ts'

export type GitRun = GitResult & { command: string }

/** GitHub git-over-HTTPS 的 Basic 用户名惯例（用户名本身不参与校验，令牌即密码）。 */
const GITHUB_GIT_USERNAME = 'x-access-token'

/** 认证失败特征：GitHub 拒绝令牌、或 git 因禁用交互提示而无法索要凭据。 */
const AUTH_FAILURE_PATTERN = /Authentication failed|invalid credentials|terminal prompts disabled|Password authentication/i

/** Git 可执行文件解析结果。 */
export interface GitExecutableResolution {
  /** 交给 spawn 的值：`git` 表示由系统 PATH 解析，否则是本机绝对路径。 */
  command: string
  /** 配置值不可用、已回退时给出的中文提示；正常时为 undefined。 */
  warning?: string
}

/**
 * 解析本次 Git 调用真正使用的可执行文件。
 *
 * 为什么需要回退：`gitExecutable` 是写入插件设置、并随 store.db 跨机器/跨平台迁移的值。
 * 旧环境（例如 macOS 的 `/Users/<user>/.dsh/bin/dsh-github-git`）留下的绝对路径在本机并不存在，
 * 直接 spawn 只会抛 ENOENT，把 github_* 整族工具锁死，而且错误信息对使用者没有指导意义。
 * 因此这里只把「绝对路径且确实存在」当作有效配置；其余情况退回系统 PATH 上的 git，
 * 并把回退原因作为 warning 回传，供工具输出与设置面板诊断使用。
 */
export function resolveGitExecutable(configured?: string): GitExecutableResolution {
  const value = configured?.trim() ?? ''
  if (value === '' || value === 'git') return { command: 'git' }
  // 不含路径分隔符的写法（如 git.exe）交给 PATH 解析：本机可能确实存在同名命令，
  // 这里不做存在性判断，真找不到时由 describeGitStartFailure 给出可操作提示。
  if (!isAbsolute(value) && !value.includes('/') && !value.includes('\\')) return { command: value }
  if (existsSync(value)) return { command: value }
  return {
    command: 'git',
    warning: '配置的 Git 可执行文件不存在：' + value + '；本次已自动回退到系统 PATH 上的 git。'
      + '请在天工造梦「代码仓库 → GitHub → 设置」中把 Git 可执行文件修正为 git 或本机 git.exe 的绝对路径。',
  }
}

/**
 * 构造 GitHub git-over-HTTPS 的认证头值。
 *
 * 为什么必须是 Basic：GitHub 的 REST API 接受 `Authorization: Bearer <token>`，
 * 但 git 的智能 HTTP 端点不接受——实测 Bearer 会返回 `remote: invalid credentials`
 * （2026-10-15 对照实验：Bearer 失败、basic 成功、无头仅对公开仓库成功）。
 * 因此这里按 Basic + base64('x-access-token:<token>') 注入，与 CNB 模块的既有做法一致。
 * 返回值只用于临时环境变量，绝不写入 URL、远端配置或日志。
 */
export function githubGitAuthHeader(token: string): string {
  return 'Authorization: Basic ' + Buffer.from(GITHUB_GIT_USERNAME + ':' + token).toString('base64')
}

/**
 * 把 spawn 失败翻译成可操作的中文提示；保留原始 message 便于排查。
 * 只做文案补充，不改变子进程失败这一事实（调用方仍按失败处理）。
 */
export function describeGitStartFailure(executable: string, error: Error): string {
  const code = (error as NodeJS.ErrnoException).code
  const head = 'unable to start git: ' + error.message
  if (code === 'ENOENT') {
    return head + '；找不到 Git 可执行文件「' + executable + '」。'
      + '请安装 Git 并确认它在 PATH 上，或把设置里的 Git 可执行文件改为 git（走 PATH）或本机 git.exe 的绝对路径。'
  }
  if (code === 'EACCES' || code === 'EPERM') {
    return head + '；Git 可执行文件「' + executable + '」没有执行权限，请检查文件权限后重试。'
  }
  return head
}

export class GitRunner {
  // 显式字段而非构造函数参数属性：Node 的 --experimental-strip-types（package.json 的 test 脚本）
  // 不支持参数属性，写成参数属性会让本模块的测试无法直接用 test 脚本运行。
  private readonly store: GithubStore
  constructor(store: GithubStore) { this.store = store }

  async run(args: string[], cwd?: string, account?: StoredAccount, timeoutMs = 120000): Promise<GitRun> {
    if (cwd !== undefined && !existsSync(cwd)) throw new Error('repository path does not exist: ' + cwd)
    const resolution = resolveGitExecutable(this.store.settings().gitExecutable)
    const executable = resolution.command
    const env: NodeJS.ProcessEnv = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' }
    // 令牌经临时 header 注入；base64 形态一并纳入脱敏（base64 串不含明文令牌，直接比对明文抓不到）。
    const authHeader = account === undefined ? '' : githubGitAuthHeader(account.token)
    if (account !== undefined) {
      env.GIT_CONFIG_COUNT = '1'; env.GIT_CONFIG_KEY_0 = 'http.extraheader'; env.GIT_CONFIG_VALUE_0 = authHeader
    }
    const started = Date.now(); const command = [executable, ...args].join(' ')
    return await new Promise<GitRun>((resolveResult, reject) => {
      const child = spawn(executable, args, { cwd, env, windowsHide: true })
      let stdout = ''; let stderr = ''; let timedOut = false
      const timer = setTimeout(() => { timedOut = true; child.kill() }, timeoutMs)
      child.stdout.on('data', chunk => { stdout += String(chunk) })
      child.stderr.on('data', chunk => { stderr += String(chunk) })
      child.on('error', error => { clearTimeout(timer); reject(new Error(describeGitStartFailure(executable, error))) })
      child.on('close', code => {
        clearTimeout(timer)
        const clean = (value: string): string => {
          if (account === undefined) return value
          return value.split(account.token).join('[redacted-token]').split(authHeader).join('[redacted-token]')
        }
        const result: GitRun = { ok: code === 0 && !timedOut, action: 'git', exitCode: timedOut ? null : code, stdout: clean(stdout).trim(), stderr: clean(stderr).trim(), durationMs: Date.now() - started, command: clean(command) }
        if (timedOut) result.error = 'git command timed out after ' + timeoutMs + ' ms'
        else if (!result.ok && account !== undefined && AUTH_FAILURE_PATTERN.test(result.stderr)) {
          result.error = 'GitHub 拒绝了当前令牌：它可能已过期、被吊销或权限不足。'
            + '请到「代码仓库 → GitHub → 账号」重新验证或更新令牌；若目标仓库是公开的，可清空账号后直接克隆。'
        }
        if (resolution.warning !== undefined) result.warning = resolution.warning
        resolveResult(result)
      })
    })
  }
}
