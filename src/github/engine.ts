// Vendored from dsh-github 0.1.2 (Apache-2.0, andyfan1094/dsh-github).
// dsh-devforge consolidation modification: relative import paths adjusted to the
// devforge module layout; runtime behavior preserved. See THIRD_PARTY_NOTICES.md.
// dsh-devforge 修复（0.49.4）：clone/pull/push 增加远端主机护栏，避免把 GitHub 令牌
// 发给 origin 指向的其它平台（实测 origin 指向 cnb.cool，令牌被 CNB 服务端收到）。
import { dirname, isAbsolute, resolve } from 'node:path'
import { existsSync } from 'node:fs'
import { GithubApi } from './github-api.ts'
import { GitRunner } from './git.ts'
import { assertGithubRemoteHost, githubGitHost, isGithubHost } from './host-guard.ts'
import type { AccountSummary, GitAction, GitHubConfigPayload, GitHubSettings, GitResult, RepoSummary } from './protocol.ts'
import type { StoredAccount } from './store.ts'
import { GithubStore } from './store.ts'

export class GithubEngine {
  readonly api: GithubApi
  readonly git: GitRunner
  readonly store: GithubStore
  // 显式字段而非构造函数参数属性：Node 的 --experimental-strip-types 不支持参数属性。
  constructor(store: GithubStore) { this.store = store; this.api = new GithubApi(store); this.git = new GitRunner(store) }
  settings(): GitHubSettings { return this.store.settings() }
  updateSettings(patch: GitHubConfigPayload): GitHubSettings { return this.store.updateSettings(patch) }
  listAccounts(): AccountSummary[] { return this.store.listAccounts() }
  async testAccount(alias?: string) { return await this.api.test(alias) }
  async listRepos(alias?: string, query?: string): Promise<RepoSummary[]> { return await this.api.listRepos(alias, query) }
  async action(input: GitAction): Promise<GitResult> {
    if (input.action === 'clone') return await this.clone(input)
    const repoPath = this.requireRepoPath(input.repoPath)
    if (input.action === 'pull') return await this.pull(repoPath, input, this.store.findAccount(input.account))
    if (input.action === 'push') return await this.push(repoPath, input, this.store.findAccount(input.account))
    if (input.action === 'commit') return await this.commit(repoPath, input, this.store.findAccount(input.account))
    const result = await this.git.run(['status', '--short', '--branch'], repoPath, undefined, input.timeoutMs); result.action = 'status'; return this.withStatus(result, repoPath)
  }
  private async clone(input: GitAction): Promise<GitResult> {
    const destination = this.requireRepoPath(input.destination); const rawSource = input.remoteUrl?.trim()
    if (!rawSource) throw new Error('remoteUrl is required for clone')
    if (existsSync(destination)) throw new Error('clone destination already exists: ' + destination)
    const source = /^[^:/\s]+\/[^/\s]+(?:\.git)?$/.test(rawSource) ? 'https://github.com/' + rawSource.replace(/\.git$/, '') + '.git' : rawSource
    const settings = this.store.settings()
    const account = this.store.findAccount(input.account)
    // 主机护栏：克隆目标不是 GitHub 时不注入令牌（公开仓库匿名克隆即可），并说明原因。
    let effectiveAccount: StoredAccount | undefined = account
    let guardWarning: string | undefined
    if (account !== undefined && !isGithubHost(source, settings.apiUrl)) {
      effectiveAccount = undefined
      guardWarning = '克隆目标 ' + source + ' 不是 GitHub 主机（' + githubGitHost(settings.apiUrl) + '），本次未发送 GitHub 令牌。'
    }
    const args = ['clone']
    const branch = input.branch?.trim() || settings.defaultBranch
    if (branch) args.push('--branch', branch)
    args.push(source, destination)
    const result = await this.git.run(args, dirname(destination), effectiveAccount, input.timeoutMs); result.action = 'clone'; result.repoPath = destination
    result.warning = [result.warning, guardWarning].filter(value => value !== undefined && value !== '').join(' ') || undefined
    return result
  }
  private async pull(repoPath: string, input: GitAction, account: StoredAccount): Promise<GitResult> {
    const remote = input.remote?.trim() || 'origin'
    await this.assertGithubRemote(repoPath, remote, input.timeoutMs)
    const args = ['pull', '--ff-only', remote]; const branch = input.branch?.trim() || this.store.settings().defaultBranch; if (branch) args.push(branch)
    const result = await this.git.run(args, repoPath, account, input.timeoutMs); result.action = 'pull'; return this.withStatus(result, repoPath)
  }
  private async push(repoPath: string, input: GitAction, account: StoredAccount): Promise<GitResult> {
    const settings = this.store.settings(); if (!settings.allowPush) throw new Error('push is disabled in GitHub settings; enable Allow push in the panel first')
    if (input.force && !settings.allowForcePush) throw new Error('force push is disabled in GitHub settings')
    const remote = input.remote?.trim() || 'origin'
    await this.assertGithubRemote(repoPath, remote, input.timeoutMs)
    const args = ['push']; if (input.force) args.push('--force-with-lease'); args.push(remote); const branch = input.branch?.trim() || this.store.settings().defaultBranch; if (branch) args.push(branch)
    const result = await this.git.run(args, repoPath, account, input.timeoutMs); result.action = 'push'; return this.withStatus(result, repoPath)
  }
  /**
   * 读取远端地址并校验主机：push/pull 必须携带令牌，因此远端不是 GitHub 时直接中止，
   * 宁可报错也不能把 GitHub 令牌发送给其它平台。
   */
  private async assertGithubRemote(repoPath: string, remote: string, timeoutMs?: number): Promise<void> {
    const probe = await this.git.run(['remote', 'get-url', remote], repoPath, undefined, timeoutMs ?? 30000)
    if (!probe.ok) {
      throw new Error('无法读取远端「' + remote + '」的地址：' + (probe.stderr || probe.error || ('exit ' + String(probe.exitCode)))
        + '；若该仓库没有这个远端，请先 git remote add 添加指向 GitHub 的远端。')
    }
    const url = probe.stdout.split(/\r?\n/).map(line => line.trim()).find(line => line !== '') ?? ''
    assertGithubRemoteHost(url, this.store.settings().apiUrl, remote)
  }
  private async commit(repoPath: string, input: GitAction, account: StoredAccount): Promise<GitResult> {
    if (!input.message?.trim()) throw new Error('commit message is required')
    if (input.all) { const added = await this.git.run(['add', '-A'], repoPath, account, input.timeoutMs); if (!added.ok) { added.action = 'commit'; added.repoPath = repoPath; return added } }
    const result = await this.git.run(['commit', '-m', input.message.trim()], repoPath, account, input.timeoutMs); result.action = 'commit'; return this.withStatus(result, repoPath)
  }
  private withStatus(result: GitResult, repoPath: string): GitResult { result.repoPath = repoPath; const branch = result.stdout.split(/\r?\n/).find(line => line.startsWith('## ')); result.branch = branch?.slice(3).split('...')[0] || undefined; result.dirty = result.stdout.split(/\r?\n/).some(line => line !== '' && !line.startsWith('## ')); return result }
  private requireRepoPath(value?: string): string { const path = value?.trim(); if (!path) throw new Error('repository path is required'); if (!isAbsolute(path)) throw new Error('repository path must be absolute'); return resolve(path) }
}
