/**
 * CNB 版本控制引擎 —— clone/pull/push/status/commit 编排。
 * 与 vendored GitHub 引擎同构；差异点：
 *   1. clone 源支持 owner/repo slug（自动拼 https://cnb.cool/<slug>）；
 *   2. clone/pull 匿名可用（公开仓库无需令牌），push 必须有已配置账号；
 *   3. push/force-push 默认关闭，需在设置中显式开启。
 */
import { dirname, isAbsolute, resolve } from 'node:path'
import { existsSync } from 'node:fs'
import { CNB_WEB_BASE, type AccountSummary, type CnbConfigPayload, type CnbSettings, type GitAction, type GitResult, type RepoSummary } from './protocol.ts'
import type { StoredAccount } from './store.ts'
import { CnbStore } from './store.ts'
import { CnbApi } from './cnb-api.ts'
import { GitRunner } from './git.ts'

/** 把用户输入规整为可克隆地址：slug（支持多段嵌套路径）→ https://cnb.cool/<slug>；完整 URL 原样；cnb.cool/... 补协议。 */
export function toCloneUrl(rawSource: string): string {
  const source = rawSource.trim().replace(/\.git$/, '')
  if (/^https?:\/\//i.test(source)) return source
  if (/^(?:[\w.-]+\.)?cnb\.cool\//i.test(source)) return 'https://' + source
  if (/^[\w.-]+(?:\/[\w.-]+)+$/.test(source)) return CNB_WEB_BASE + '/' + source
  throw new Error('无法识别的仓库地址：' + rawSource + '（支持 owner/repo、cnb.cool/… 或完整 https URL）')
}

export class CnbEngine {
  readonly store: CnbStore
  readonly api: CnbApi
  readonly git: GitRunner
  constructor(store: CnbStore) { this.store = store; this.api = new CnbApi(store); this.git = new GitRunner(store) }
  settings(): CnbSettings { return this.store.settings() }
  updateSettings(patch: CnbConfigPayload): CnbSettings { return this.store.updateSettings(patch) }
  listAccounts(): AccountSummary[] { return this.store.listAccounts() }
  async testAccount(alias?: string) { return await this.api.test(alias) }
  async listRepos(alias?: string, query?: string): Promise<RepoSummary[]> { return await this.api.listRepos(alias, query) }
  async action(input: GitAction): Promise<GitResult> {
    if (input.action === 'clone') return await this.clone(input)
    const repoPath = this.requireRepoPath(input.repoPath)
    if (input.action === 'pull') return await this.pull(repoPath, input)
    if (input.action === 'push') return await this.push(repoPath, input)
    if (input.action === 'commit') return await this.commit(repoPath, input)
    const result = await this.git.run(['status', '--short', '--branch'], repoPath, undefined, input.timeoutMs); result.action = 'status'; return this.withStatus(result, repoPath)
  }
  private async clone(input: GitAction): Promise<GitResult> {
    const destination = this.requireRepoPath(input.destination); const rawSource = input.remoteUrl?.trim()
    if (!rawSource) throw new Error('clone 需要 remoteUrl（支持 owner/repo 或完整地址）')
    if (existsSync(destination)) throw new Error('克隆目标目录已存在：' + destination)
    const source = toCloneUrl(rawSource)
    // 公开仓库可匿名克隆：没有可用账号时不注入认证头。
    const account = this.store.findOptionalAccount(input.account)
    const args = ['clone']
    const branch = input.branch?.trim() || this.store.settings().defaultBranch
    if (branch) args.push('--branch', branch)
    args.push(source, destination)
    const result = await this.git.run(args, dirname(destination), account, input.timeoutMs); result.action = 'clone'; result.repoPath = destination; result.remoteUrl = source; return result
  }
  private async pull(repoPath: string, input: GitAction): Promise<GitResult> {
    const account = this.store.findOptionalAccount(input.account)
    const args = ['pull', '--ff-only']; args.push(input.remote?.trim() || 'origin'); const branch = input.branch?.trim() || this.store.settings().defaultBranch; if (branch) args.push(branch)
    const result = await this.git.run(args, repoPath, account, input.timeoutMs); result.action = 'pull'; return this.withStatus(result, repoPath)
  }
  private async push(repoPath: string, input: GitAction): Promise<GitResult> {
    const settings = this.store.settings(); if (!settings.allowPush) throw new Error('推送默认关闭：请先在天工造梦设置的 CNB 配置里打开 Allow push')
    if (input.force && !settings.allowForcePush) throw new Error('强制推送默认关闭：请先打开 Allow force push')
    // push 必须认证：没有可用账号直接报可读错误。
    const account: StoredAccount = this.store.findAccount(input.account)
    const args = ['push']; if (input.force) args.push('--force-with-lease'); args.push(input.remote?.trim() || 'origin'); const branch = input.branch?.trim() || this.store.settings().defaultBranch; if (branch) args.push(branch)
    const result = await this.git.run(args, repoPath, account, input.timeoutMs); result.action = 'push'; return this.withStatus(result, repoPath)
  }
  private async commit(repoPath: string, input: GitAction): Promise<GitResult> {
    if (!input.message?.trim()) throw new Error('提交说明不能为空')
    if (input.all) { const added = await this.git.run(['add', '-A'], repoPath, undefined, input.timeoutMs); if (!added.ok) { added.action = 'commit'; added.repoPath = repoPath; return added } }
    const result = await this.git.run(['commit', '-m', input.message.trim()], repoPath, undefined, input.timeoutMs); result.action = 'commit'; return this.withStatus(result, repoPath)
  }
  private withStatus(result: GitResult, repoPath: string): GitResult { result.repoPath = repoPath; const branch = result.stdout.split(/\r?\n/).find(line => line.startsWith('## ')); result.branch = branch?.slice(3).split('...')[0] || undefined; result.dirty = result.stdout.split(/\r?\n/).some(line => line !== '' && !line.startsWith('## ')); return result }
  private requireRepoPath(value?: string): string { const path = value?.trim(); if (!path) throw new Error('需要仓库绝对路径'); if (!isAbsolute(path)) throw new Error('仓库路径必须是绝对路径'); return resolve(path) }
}
