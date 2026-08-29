/**
 * 浏览器侧 API 客户端 —— 服务工厂面板组件唯一的数据通道（同源 fetch）。
 * 关键边界：只访问服务工厂路由及其接管后的兼容路由；Token 等凭据绝不返回浏览器。
 */

import { DEVFORGE_API, type ForgeJob, ForgeJobCreateRequest, ForgeTemplate, type RemoteHostSummary, StandardDetail, StandardSummary } from '../protocol.ts'
import { GITHUB_API, type AccountSummary, type GitAction, type GitHubSettings, type GitResult, type RepoSummary } from '../github/protocol.ts'
import { FEISHU_API_BASE, type FeishuConfigPatch, type FeishuModelOptions, type FeishuPanelConfig, type FeishuStatus } from '../feishu/protocol.ts'

/** API 错误（带 HTTP 状态）。 */
export class DevforgeApiError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DevforgeApiError'
  }
}

/** 解析 JSON 响应或抛错。 */
async function readJson<T>(response: Response): Promise<T> {
  let body: unknown
  try { body = await response.json() } catch {
    throw new DevforgeApiError('HTTP ' + response.status + ': 响应不是 JSON')
  }
  const payload = body as { ok?: boolean; error?: string }
  if (!response.ok || payload?.ok === false) {
    throw new DevforgeApiError(payload?.error ?? 'HTTP ' + response.status)
  }
  return body as T
}

/** 生成查询字符串；空值不发送，避免覆盖 Host 端默认选择。 */
function buildQuery(params: Record<string, string | undefined>): string {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') query.set(key, value)
  }
  const text = query.toString()
  return text === '' ? '' : '?' + text
}

/** dsh-devforge 面板 API 集合。 */
export class DevforgeApi {
  /** 规范清单。 */
  async listStandards(): Promise<StandardSummary[]> {
    const data = await readJson<{ standards: StandardSummary[] }>(await fetch(DEVFORGE_API.standards))
    return data.standards
  }

  /** 规范正文。 */
  async getStandard(id: string): Promise<StandardDetail> {
    const data = await readJson<{ standard: StandardDetail }>(await fetch(DEVFORGE_API.standard + '?id=' + encodeURIComponent(id)))
    return data.standard
  }

  /** 模板清单。 */
  async listTemplates(): Promise<ForgeTemplate[]> {
    const data = await readJson<{ templates: ForgeTemplate[] }>(await fetch(DEVFORGE_API.templates))
    return data.templates
  }

  /** 任务清单。 */
  async listJobs(): Promise<ForgeJob[]> {
    const data = await readJson<{ jobs: ForgeJob[] }>(await fetch(DEVFORGE_API.jobs))
    return data.jobs
  }

  /** 远程运维统一主机摘要（不含任何凭据字段）。 */
  async listRemoteHosts(): Promise<RemoteHostSummary[]> {
    const data = await readJson<{ hosts: RemoteHostSummary[] }>(await fetch(DEVFORGE_API.remoteHosts))
    return data.hosts
  }

  /** 创建生成任务（一键按钮）。 */
  async createJob(req: ForgeJobCreateRequest): Promise<ForgeJob> {
    const data = await readJson<{ job: ForgeJob }>(await fetch(DEVFORGE_API.jobs, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(req),
    }))
    return data.job
  }

  /** 取消任务。 */
  async cancelJob(id: string): Promise<ForgeJob> {
    const data = await readJson<{ job: ForgeJob }>(await fetch(DEVFORGE_API.job, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id, action: 'cancel' }),
    }))
    return data.job
  }

  /** GitHub 账号摘要；Host 只返回 tokenConfigured，不返回 Token 原文。 */
  async listGithubAccounts(): Promise<AccountSummary[]> {
    const data = await readJson<{ accounts: AccountSummary[] }>(await fetch(GITHUB_API.accounts))
    return data.accounts
  }

  /** 新增或更新 GitHub 账号。Token 留空时由 Host 保留旧值。 */
  async saveGithubAccount(payload: { alias: string; token?: string; apiUrl?: string }): Promise<AccountSummary> {
    const data = await readJson<{ account: AccountSummary }>(await fetch(GITHUB_API.accounts, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    }))
    return data.account
  }

  /** 删除指定 GitHub 账号。 */
  async deleteGithubAccount(alias: string): Promise<void> {
    await readJson(await fetch(GITHUB_API.accounts, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ alias }),
    }))
  }

  /** 验证账号 Token，并刷新对应的 GitHub 用户名。 */
  async testGithubAccount(alias?: string): Promise<{ ok: boolean; alias: string; username?: string; error?: string }> {
    const data = await readJson<{ result: { ok: boolean; alias: string; username?: string; error?: string } }>(await fetch(GITHUB_API.accountTest, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ alias }),
    }))
    return data.result
  }

  /** 获取当前账号可见的 GitHub 仓库。 */
  async listGithubRepos(account?: string, query?: string): Promise<RepoSummary[]> {
    const data = await readJson<{ repos: RepoSummary[] }>(await fetch(GITHUB_API.repos + buildQuery({ account, query })))
    return data.repos
  }

  /** 读取 GitHub/Git 设置；Push 权限也由此返回。 */
  async getGithubSettings(): Promise<GitHubSettings> {
    const data = await readJson<{ config: GitHubSettings }>(await fetch(GITHUB_API.config))
    return data.config
  }

  /** 保存 GitHub/Git 设置。Push 与 Force Push 必须由用户显式开启。 */
  async saveGithubSettings(patch: Partial<GitHubSettings>): Promise<GitHubSettings> {
    const data = await readJson<{ config: GitHubSettings }>(await fetch(GITHUB_API.config, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    }))
    return data.config
  }

  /** 执行受 Host 端路径校验与 Push 安全开关约束的 Git 操作。 */
  async runGithubGit(action: GitAction): Promise<GitResult> {
    const data = await readJson<{ result: GitResult }>(await fetch(GITHUB_API.git, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(action),
    }))
    return data.result
  }

  /** 读取脱敏后的飞书配置；App Secret 只返回掩码和是否已配置。 */
  async getFeishuConfig(): Promise<FeishuPanelConfig> {
    const data = await readJson<{ config: FeishuPanelConfig }>(await fetch(FEISHU_API_BASE + '/config'))
    return data.config
  }

  /** 读取飞书 WebSocket、模型与独立会话状态。 */
  async getFeishuStatus(): Promise<FeishuStatus> {
    const data = await readJson<{ status: FeishuStatus }>(await fetch(FEISHU_API_BASE + '/status'))
    return data.status
  }

  /** 读取当前 DSH 可用的 Provider、Model、推理级别和 Agent 预设。 */
  async getFeishuModelOptions(): Promise<FeishuModelOptions> {
    return await readJson<FeishuModelOptions>(await fetch(FEISHU_API_BASE + '/models'))
  }

  /** 保存飞书配置；密钥留空时 Host 保留旧值，并重新建立连接。 */
  async saveFeishuConfig(patch: FeishuConfigPatch): Promise<{ config: FeishuPanelConfig; status: FeishuStatus }> {
    return await readJson<{ config: FeishuPanelConfig; status: FeishuStatus }>(await fetch(FEISHU_API_BASE + '/config', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    }))
  }

  /** 使用当前表单值测试飞书 App ID 与 App Secret，不持久化配置。 */
  async testFeishuConnection(patch: FeishuConfigPatch): Promise<unknown> {
    const data = await readJson<{ result: unknown }>(await fetch(FEISHU_API_BASE + '/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    }))
    return data.result
  }
}
