/**
 * CNB Git 执行器 —— 令牌通过临时 http.extraheader 注入，绝不写入 URL 或远端配置。
 * CNB Git HTTP 认证为 Basic（用户名固定 cnb、密码为访问令牌），与
 * docs.cnb.cool/zh/guide/git-access.html 一致；stdout/stderr/command 全部脱敏。
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { CNB_GIT_USERNAME, type GitResult } from './protocol.ts'
import type { CnbStore, StoredAccount } from './store.ts'

export type GitRun = GitResult & { command: string }

export class GitRunner {
  private readonly store: CnbStore
  constructor(store: CnbStore) { this.store = store }

  async run(args: string[], cwd?: string, account?: StoredAccount, timeoutMs = 120000): Promise<GitRun> {
    if (cwd !== undefined && !existsSync(cwd)) throw new Error('仓库路径不存在：' + cwd)
    const executable = this.store.settings().gitExecutable || 'git'
    const env: NodeJS.ProcessEnv = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' }
    // Basic 凭据 = base64('cnb:<token>')，经临时 header 注入；base64 形态一并纳入脱敏。
    const basic = account === undefined ? '' : Buffer.from(CNB_GIT_USERNAME + ':' + account.token).toString('base64')
    if (account !== undefined) {
      env.GIT_CONFIG_COUNT = '1'
      env.GIT_CONFIG_KEY_0 = 'http.extraheader'
      env.GIT_CONFIG_VALUE_0 = 'Authorization: Basic ' + basic
    }
    const started = Date.now()
    return await new Promise<GitRun>((resolveResult, reject) => {
      const child = spawn(executable, args, { cwd, env, windowsHide: true })
      let stdout = ''
      let stderr = ''
      let timedOut = false
      const timer = setTimeout(() => { timedOut = true; child.kill() }, timeoutMs)
      child.stdout.on('data', chunk => { stdout += String(chunk) })
      child.stderr.on('data', chunk => { stderr += String(chunk) })
      child.on('error', error => { clearTimeout(timer); reject(new Error('无法启动 git：' + error.message)) })
      child.on('close', code => {
        clearTimeout(timer)
        const clean = (value: string): string => account === undefined ? value : value.split(account.token).join('[redacted-token]').split(basic).join('[redacted-token]')
        const result: GitRun = { ok: code === 0 && !timedOut, action: 'git', exitCode: timedOut ? null : code, stdout: clean(stdout).trim(), stderr: clean(stderr).trim(), durationMs: Date.now() - started, command: clean([executable, ...args].join(' ')) }
        if (timedOut) result.error = 'git 命令超时（' + timeoutMs + ' ms）'
        resolveResult(result)
      })
    })
  }
}
