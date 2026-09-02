/**
 * 浏览器侧 API 客户端 —— 天工造梦面板组件唯一的数据通道（同源 fetch）。
 * 关键边界：只访问天工造梦路由及其接管后的兼容路由；Token 等凭据绝不返回浏览器。
 */

import { DEVFORGE_API, type BackupStatus, type BackupSyncResult, type ForgeJob, ForgeJobCreateRequest, ForgeTemplate, type RemoteHostSummary, StandardDetail, StandardSummary } from '../protocol.ts'
import type { TokenUsageReport } from '../usage/types.ts'
import { BROWSER_API, type BrowserStatus } from '../browser/protocol.ts'
import { GITHUB_API, type AccountSummary, type GitAction, type GitHubSettings, type GitResult, type RepoSummary } from '../github/protocol.ts'
import { CNB_API, type AccountSummary as CnbAccountSummary, type CnbSettings, type GitAction as CnbGitAction, type GitResult as CnbGitResult, type RepoSummary as CnbRepoSummary } from '../cnb/protocol.ts'
import { FEISHU_API_BASE, type FeishuConfigPatch, type FeishuModelOptions, type FeishuPanelConfig, type FeishuStatus } from '../feishu/protocol.ts'
import { ZHIPU_API, type ZhipuDashboard, type ZhipuStatus, type ZhipuUsageWindow } from '../zhipu/protocol.ts'
import { MINIMAX_API, type MiniMaxDashboard, type MiniMaxStatus } from '../minimax/protocol.ts'
import { ARK_API, type ArkStatus, type ArkUsageCredentialsResult, type ArkUsageDashboard } from '../ark/protocol.ts'
import { OPENAI_GATEWAY_API, type OpenAiGatewayConfigPatch, type OpenAiGatewayEndpointConfig, type OpenAiGatewayFetchModelsResult, type OpenAiGatewayStatus } from '../openai/protocol.ts'
import { SILICONFLOW_API, type SiliconFlowStatus } from '../siliconflow/protocol.ts'
import { CREDENTIALS_API } from '../credentials-routes.ts'
import { PROJECTS_API, type ProjectDetectResult, type ProjectEntry } from '../projects/protocol.ts'
import type { PluginUpdateApplyResult, UpdateCheckItem } from '../plugin-update.ts'

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

  /** 新增远程主机（SSH 或 WinRM；密码等凭据字段由后端 store 校验并保存）。 */
  async createRemoteHost(req: { transport: 'ssh' | 'winrm' } & Record<string, unknown>): Promise<void> {
    const data = await readJson<{ ok: boolean; error?: string }>(await fetch(DEVFORGE_API.remoteHosts, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(req),
    }))
    if (!data.ok) throw new Error(data.error ?? '新增主机失败。')
  }

  /** 删除一台远程主机（transport + alias 定位）。 */
  async deleteRemoteHost(transport: 'ssh' | 'winrm', alias: string): Promise<void> {
    const data = await readJson<{ ok: boolean; error?: string }>(
      await fetch(DEVFORGE_API.remoteHosts + '?transport=' + encodeURIComponent(transport) + '&alias=' + encodeURIComponent(alias), { method: 'DELETE' }),
    )
    if (!data.ok) throw new Error(data.error ?? '删除主机失败。')
  }

  /** CNB 备份：读取状态与配置。 */
  async backupStatus(): Promise<BackupStatus> {
    return await readJson<BackupStatus>(await fetch(DEVFORGE_API.backupStatus))
  }

  /** CNB 备份：保存配置（password 传入时同步更新本机密码文件）。 */
  async backupConfig(req: { enabled?: boolean; accountAlias?: string; repo?: string; interval?: string; password?: string }): Promise<{ ok: boolean; error?: string; settings: { enabled: boolean; accountAlias: string; repo: string; interval: string } }> {
    return await readJson(await fetch(DEVFORGE_API.backupConfig, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(req),
    }))
  }

  /** CNB 备份：立即备份一次（force 跳过内容无变化检查）。 */
  async backupNow(force = false): Promise<{ ok: boolean; size?: number; skipped?: string; error?: string }> {
    return await readJson(await fetch(DEVFORGE_API.backupNow, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ force }),
    }))
  }

  /** CNB 备份：恢复预览（解密远端最新备份，不落盘）。 */
  async backupPreview(password: string): Promise<{ ok: boolean; machine: string; createdAt: number; files: string[] }> {
    return await readJson(await fetch(DEVFORGE_API.backupRestore, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password, dryRun: true }),
    }))
  }

  /** CNB 备份：从远端同步（dryRun 预览清单；实跑覆盖本机并需重启 DSH）。 */
  async backupSync(password: string, dryRun = false): Promise<BackupSyncResult> {
    return await readJson<BackupSyncResult>(await fetch(DEVFORGE_API.backupSync, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password, dryRun }),
    }))
  }

  /** CNB 备份：执行恢复（confirm 必须为「确认恢复」；完成后需重启 Host）。 */
  async backupRestore(password: string): Promise<{ ok: boolean; restoredFiles: string[]; machine: string; restartRequired: boolean }> {
    return await readJson(await fetch(DEVFORGE_API.backupRestore, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password, confirm: '确认恢复' }),
    }))
  }

  /** CNB 备份：远端备份文件清单。 */
  async backupList(): Promise<{ ok: boolean; backups: Array<{ path: string; size: number; modifiedAt?: number }> }> {
    return await readJson(await fetch(DEVFORGE_API.backupList))
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

  /** 项目面板：项目清单。 */
  async listProjects(): Promise<ProjectEntry[]> {
    const data = await readJson<{ projects: ProjectEntry[] }>(await fetch(PROJECTS_API.projects))
    return data.projects
  }

  /** 项目面板：保存（新增或更新）一个项目。 */
  async saveProject(entry: Record<string, unknown>): Promise<ProjectEntry> {
    const data = await readJson<{ project: ProjectEntry }>(await fetch(PROJECTS_API.projects, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(entry),
    }))
    return data.project
  }

  /** 项目面板：删除一个项目。 */
  async deleteProject(id: string): Promise<void> {
    await readJson(await fetch(PROJECTS_API.projectItem + '?id=' + encodeURIComponent(id), { method: 'DELETE' }))
  }

  /** 项目面板：检测项目路径（Git 仓库、远端与分支）。 */
  async detectProject(path: string): Promise<ProjectDetectResult> {
    const data = await readJson<{ detect: ProjectDetectResult }>(
      await fetch(PROJECTS_API.projectDetect + '?path=' + encodeURIComponent(path)),
    )
    return data.detect
  }

  /** 请求本机 DSH Web 重启；成功后当前连接会短暂断开。 */
  async restartDsh(): Promise<{ scheduled: boolean; message: string }> {
    const data = await readJson<{ result: { scheduled: boolean; message: string } }>(await fetch(DEVFORGE_API.restart, { method: 'POST' }))
    return data.result
  }

  /** 插件更新：检查全部登记源（对比 GitHub Latest Release）。 */
  async checkPluginUpdates(): Promise<{ enabled: boolean; items: UpdateCheckItem[] }> {
    return await readJson(await fetch(DEVFORGE_API.pluginUpdateCheck))
  }

  /** 插件更新：一键升级指定包（白名单内），返回需重启标记。 */
  async applyPluginUpdate(packageName: string): Promise<PluginUpdateApplyResult> {
    const data = await readJson<{ result: PluginUpdateApplyResult }>(await fetch(DEVFORGE_API.pluginUpdateApply, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ packageName }),
    }))
    return data.result
  }

  /** 读取本地浏览器脱敏状态（不拉起浏览器进程）。 */
  async getBrowserStatus(): Promise<BrowserStatus> {
    const data = await readJson<{ status: BrowserStatus }>(await fetch(BROWSER_API.status))
    return data.status
  }

  /** 面板导航：打开 http(s) 地址并返回页面快照。 */
  async browserNavigate(url: string): Promise<{ ok: boolean; snapshot: string }> {
    return await readJson(await fetch(BROWSER_API.navigate, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url }) }))
  }

  /** 面板读取当前页快照。 */
  async getBrowserSnapshot(): Promise<{ ok: boolean; snapshot: string }> {
    return await readJson(await fetch(BROWSER_API.snapshot))
  }

  /** 面板截图：返回可直接显示的 data URL。 */
  async browserScreenshot(): Promise<{ ok: boolean; image: string }> {
    return await readJson(await fetch(BROWSER_API.screenshot, { method: 'POST' }))
  }

  /** 停止本地浏览器会话；用户档案保留，登录状态不丢失。 */
  async browserStop(): Promise<void> {
    await readJson(await fetch(BROWSER_API.stop, { method: 'POST' }))
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

  /** CNB 账号摘要；Host 只返回 tokenConfigured，不返回令牌原文。 */
  async listCnbAccounts(): Promise<CnbAccountSummary[]> {
    const data = await readJson<{ accounts: CnbAccountSummary[] }>(await fetch(CNB_API.accounts))
    return data.accounts
  }

  /** 新增或更新 CNB 账号。令牌留空时由 Host 保留旧值。 */
  async saveCnbAccount(payload: { alias: string; token?: string; apiUrl?: string }): Promise<CnbAccountSummary> {
    const data = await readJson<{ account: CnbAccountSummary }>(await fetch(CNB_API.accounts, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    }))
    return data.account
  }

  /** 删除指定 CNB 账号。 */
  async deleteCnbAccount(alias: string): Promise<void> {
    await readJson(await fetch(CNB_API.accounts, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ alias }),
    }))
  }

  /** 验证账号令牌，并刷新对应的 CNB 用户名。 */
  async testCnbAccount(alias?: string): Promise<{ ok: boolean; alias: string; username?: string; error?: string }> {
    const data = await readJson<{ result: { ok: boolean; alias: string; username?: string; error?: string } }>(await fetch(CNB_API.accountTest, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ alias }),
    }))
    return data.result
  }

  /** 获取当前账号可见的 CNB 仓库。 */
  async listCnbRepos(account?: string, query?: string): Promise<CnbRepoSummary[]> {
    const data = await readJson<{ repos: CnbRepoSummary[] }>(await fetch(CNB_API.repos + buildQuery({ account, query })))
    return data.repos
  }

  /** 读取 CNB/Git 设置；推送权限也由此返回。 */
  async getCnbSettings(): Promise<CnbSettings> {
    const data = await readJson<{ config: CnbSettings }>(await fetch(CNB_API.config))
    return data.config
  }

  /** 保存 CNB/Git 设置。推送与强制推送必须由用户显式开启。 */
  async saveCnbSettings(patch: Partial<CnbSettings>): Promise<CnbSettings> {
    const data = await readJson<{ config: CnbSettings }>(await fetch(CNB_API.config, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    }))
    return data.config
  }

  /** 执行受 Host 端路径校验与推送安全开关约束的 CNB Git 操作。 */
  async runCnbGit(action: CnbGitAction): Promise<CnbGitResult> {
    const data = await readJson<{ result: CnbGitResult }>(await fetch(CNB_API.git, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(action),
    }))
    return data.result
  }

  /** 读取 OpenAI 中转站、凭据、聊天路由与生图模型的脱敏状态。 */
  async getOpenAiGatewayStatus(signal?: AbortSignal): Promise<OpenAiGatewayStatus> {
    const data = await readJson<{ status: OpenAiGatewayStatus }>(await fetch(OPENAI_GATEWAY_API.status, { signal }))
    return data.status
  }

  /** 保存 OpenAI 中转站地址和生图模型；API Key 走通用受管凭据接口。 */
  async saveOpenAiGatewayConfig(patch: OpenAiGatewayConfigPatch, signal?: AbortSignal): Promise<OpenAiGatewayStatus> {
    const data = await readJson<{ status: OpenAiGatewayStatus }>(await fetch(OPENAI_GATEWAY_API.config, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
      signal,
    }))
    return data.status
  }

  /** 保存单个 OpenAI 中转端点，不改写其它端点。 */
  async saveOpenAiGatewayEndpoint(endpoint: OpenAiGatewayEndpointConfig, signal?: AbortSignal): Promise<OpenAiGatewayStatus> {
    const data = await readJson<{ status: OpenAiGatewayStatus }>(await fetch(OPENAI_GATEWAY_API.endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ endpoint }), signal }))
    return data.status
  }

  /** 调用中转站 GET /v1/models，并返回端点级成功或失败结果。 */
  async fetchOpenAiGatewayModels(endpointId?: string, signal?: AbortSignal): Promise<OpenAiGatewayFetchModelsResult> {
    return await readJson(await fetch(OPENAI_GATEWAY_API.fetchModels, { method: 'POST', headers: { 'content-type': 'application/json' }, body: endpointId === undefined ? undefined : JSON.stringify({ endpointId }), signal }))
  }

  /** 读取智谱凭据和最新模型的脱敏状态。 */
  async getZhipuStatus(signal?: AbortSignal): Promise<ZhipuStatus> {
    const data = await readJson<{ status: ZhipuStatus }>(await fetch(ZHIPU_API.status, { signal }))
    return data.status
  }

  /** 读取智谱官方额度、模型和 MCP 用量。 */
  async getZhipuDashboard(window: ZhipuUsageWindow, signal?: AbortSignal): Promise<ZhipuDashboard> {
    const data = await readJson<{ dashboard: ZhipuDashboard }>(await fetch(ZHIPU_API.dashboard + '?window=' + encodeURIComponent(window), { signal }))
    return data.dashboard
  }

  /** 补齐 zai-coding-cn 的 GLM-5.3 与 GLM-5.3-Flash。 */
  async setupZhipuModels(signal?: AbortSignal): Promise<ZhipuStatus> {
    const data = await readJson<{ status: ZhipuStatus }>(await fetch(ZHIPU_API.setup, { method: 'POST', signal }))
    return data.status
  }

  /** 读取 MiniMax 凭据和模型路由的脱敏状态。 */
  async getMiniMaxStatus(signal?: AbortSignal): Promise<MiniMaxStatus> {
    const data = await readJson<{ status: MiniMaxStatus }>(await fetch(MINIMAX_API.status, { signal }))
    return data.status
  }

  /** 补齐 minimax-cn 的最新模型路由。 */
  async setupMiniMaxModels(signal?: AbortSignal): Promise<MiniMaxStatus> {
    const data = await readJson<{ status: MiniMaxStatus }>(await fetch(MINIMAX_API.setup, { method: 'POST', signal }))
    return data.status
  }

  /** 读取 MiniMax 订阅用量（5h + 周双窗口）。 */
  async getMiniMaxDashboard(signal?: AbortSignal): Promise<MiniMaxDashboard> {
    const data = await readJson<{ dashboard: MiniMaxDashboard }>(await fetch(MINIMAX_API.dashboard, { signal }))
    return data.dashboard
  }

  /** 拉取智谱官方在售模型清单并合并进 provider。 */
  async fetchZhipuModels(signal?: AbortSignal): Promise<{ status: ZhipuStatus; added: string[]; kept: string[]; total: number }> {
    return await readJson(await fetch(ZHIPU_API.fetchModels, { method: 'POST', signal }))
  }

  /** 拉取 MiniMax 官方在售模型清单并合并进 provider。 */
  async fetchMiniMaxModels(signal?: AbortSignal): Promise<{ status: MiniMaxStatus; added: string[]; kept: string[]; total: number }> {
    return await readJson(await fetch(MINIMAX_API.fetchModels, { method: 'POST', signal }))
  }

  /** 读取硅基流动凭据和模型路由的脱敏状态。 */
  async getSiliconFlowStatus(signal?: AbortSignal): Promise<SiliconFlowStatus> {
    const data = await readJson<{ status: SiliconFlowStatus }>(await fetch(SILICONFLOW_API.status, { signal }))
    return data.status
  }

  /** 拉取并同步硅基流动全部模型到 DSH 模型目录。 */
  async setupSiliconFlowModels(signal?: AbortSignal): Promise<SiliconFlowStatus> {
    const data = await readJson<{ status: SiliconFlowStatus }>(await fetch(SILICONFLOW_API.ensure, { method: 'POST', signal }))
    return data.status
  }

  /** 读取火山方舟 Agent/Coding Plan 的脱敏状态。 */
  async getArkStatus(signal?: AbortSignal): Promise<ArkStatus> {
    const data = await readJson<{ status: ArkStatus }>(await fetch(ARK_API.status, { signal }))
    return data.status
  }

  /** 同步方舟 Agent Plan 官方文本模型池与推理档位。 */
  async setupArkModels(signal?: AbortSignal): Promise<ArkStatus> {
    const data = await readJson<{ status: ArkStatus }>(await fetch(ARK_API.setup, { method: 'POST', signal }))
    return data.status
  }

  /** 读取方舟套餐用量；Host 端使用五分钟缓存。 */
  async getArkDashboard(signal?: AbortSignal): Promise<ArkUsageDashboard> {
    const data = await readJson<{ dashboard: ArkUsageDashboard }>(await fetch(ARK_API.dashboard, { signal }))
    return data.dashboard
  }

  /** 验证并成对保存方舟控制面 AK/SK；验证失败不会落盘。 */
  async saveArkUsageCredentials(accessKey: string, secretKey: string, signal?: AbortSignal): Promise<ArkUsageCredentialsResult> {
    return await readJson<ArkUsageCredentialsResult>(await fetch(ARK_API.usageCredentials, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accessKey, secretKey }),
      signal,
    }))
  }

  /** 跳过缓存并实时刷新方舟套餐用量。 */
  async refreshArkUsage(signal?: AbortSignal): Promise<ArkUsageDashboard> {
    const data = await readJson<{ dashboard: ArkUsageDashboard }>(await fetch(ARK_API.refreshUsage, { method: 'POST', signal }))
    return data.dashboard
  }

  /** 写入受管凭据到 $DSH_HOME/.credentials.yaml（loopback 围栏）。 */
  /** 读取天工造梦插件元信息（版本号供面板标题展示）。 */
  async getDevforgeMeta(signal?: AbortSignal): Promise<{ version: string }> {
    const data = await readJson<{ version?: unknown }>(await fetch('/api/dsh-devforge/meta', { signal }))
    return { version: typeof data.version === 'string' ? data.version : '' }
  }

  /** 读取本机会话库聚合的模型 token 计量报告（今日/本周/全部三窗同返）。 */
  async getTokenUsage(signal?: AbortSignal): Promise<TokenUsageReport> {
    const data = await readJson<{ report: TokenUsageReport }>(await fetch(DEVFORGE_API.tokenUsage, { signal }))
    return data.report
  }

  async setCredential(ref: string, value: string): Promise<{ created: boolean; updated: boolean }> {
    return await readJson(await fetch(CREDENTIALS_API.set, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ref, value }),
    }))
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