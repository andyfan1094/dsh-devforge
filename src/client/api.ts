/**
 * 浏览器侧 API 客户端 —— 天工造梦面板组件唯一的数据通道（同源 fetch）。
 * 关键边界：只访问天工造梦路由及其接管后的兼容路由；Token 等凭据绝不返回浏览器。
 */

import { DEVFORGE_API, type BackupStatus, type BackupSyncResult, type ForgeJob, ForgeJobCreateRequest, ForgeTemplate, type RemoteHostSummary, StandardDetail, StandardSummary } from '../protocol.ts'
import type { TokenUsageReport } from '../usage/types.ts'
import { DOUYIN_LIVE_API, type DouyinLiveSnapshot } from '../douyin-live/protocol.ts'
import { BROWSER_API, type BrowserStatus } from '../browser/protocol.ts'
import { GITHUB_API, type AccountSummary, type GitAction, type GitHubSettings, type GitResult, type RepoSummary } from '../github/protocol.ts'
import { CNB_API, type AccountSummary as CnbAccountSummary, type CnbSettings, type GitAction as CnbGitAction, type GitResult as CnbGitResult, type RepoSummary as CnbRepoSummary } from '../cnb/protocol.ts'
import { FEISHU_API_BASE, type FeishuConfigPatch, type FeishuModelOptions, type FeishuPanelConfig, type FeishuStatus } from '../feishu/protocol.ts'
import { ZHIPU_API, type ZhipuDashboard, type ZhipuKeyUsage, type ZhipuOfficialStatus, type ZhipuStatus, type ZhipuUsageWindow } from '../zhipu/protocol.ts'
import { MINIMAX_API, type MiniMaxDashboard, type MiniMaxStatus } from '../minimax/protocol.ts'
import { ARK_API, type ArkStatus, type ArkUsageCredentialsResult, type ArkUsageDashboard } from '../ark/protocol.ts'
import { OPENAI_GATEWAY_API, type OpenAiGatewayConfigPatch, type OpenAiGatewayEndpointConfig, type OpenAiGatewayFetchModelsResult, type OpenAiGatewayModelPatch, type OpenAiGatewayStatus } from '../openai/protocol.ts'
import { SILICONFLOW_API, type SiliconFlowStatus } from '../siliconflow/protocol.ts'
import { MEMORY_API, type MemoryDreamStatus, type MemoryGraph, type MemorySettings, type MemoryStatus, type MemoryUserProfile, type MirrorSyncResult, type NativeMemoryEntry, type NativeMemoryMigrationResult, type ProjectIndexResult } from '../memory/protocol.ts'
import { MCP_API, type McpRuntimeStatus, type McpServerSaveRequest, type McpServerSummary, type McpTestResult } from '../mcp/protocol.ts'
import { BRAIN_ROUTER_API, type BrainRouterCatalogProvider, type BrainRouterSettings, type BrainRouterStatus } from '../brain-router/protocol.ts'
import type { RagDocument } from '../rag/protocol.ts'
import { CREDENTIALS_API } from '../credentials-routes.ts'
import { PROJECTS_API, type AutomatchSuggestion, type ProjectDeployResult, type ProjectDescribeResult, type ProjectDetectResult, type ProjectEntry, type ProjectRelocateResult, type ProjectScanResult } from '../projects/protocol.ts'
import { WORKSPACE_API, type WorkspaceConvention } from '../workspace/convention.ts'
import type { PluginUpdateApplyResult, UpdateCheckItem } from '../plugin-update.ts'
import type { HarnessUpdateCheckItem } from '../harness-update.ts'

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
  /** 读取直播接收快照；侧栏隐藏或卸载时可取消，不改变 Host 连接。 */
  async getDouyinLiveSnapshot(signal?: AbortSignal): Promise<DouyinLiveSnapshot> {
    const data = await readJson<{ ok: true; snapshot: DouyinLiveSnapshot }>(await fetch(DOUYIN_LIVE_API + '/snapshot', { signal, cache: 'no-store' }))
    return data.snapshot
  }

  /** 连接指定抖音房间；房间解析和上游连接完全由 Host 负责。 */
  async connectDouyinLive(roomInput: string, signal?: AbortSignal): Promise<DouyinLiveSnapshot> {
    const data = await readJson<{ ok: true; snapshot: DouyinLiveSnapshot }>(await fetch(DOUYIN_LIVE_API + '/connect', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ roomInput }), signal,
    }))
    return data.snapshot
  }

  /** 设置 Host 是否自动跟随本机直播伴侣的开播状态。 */
  async setDouyinLiveAutoMonitor(enabled: boolean, signal?: AbortSignal): Promise<DouyinLiveSnapshot> {
    const data = await readJson<{ ok: true; snapshot: DouyinLiveSnapshot }>(await fetch(DOUYIN_LIVE_API + '/auto', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled }), signal,
    }))
    return data.snapshot
  }

  /** 设置本机入场欢迎语音播报。 */
  async setDouyinLiveSpeech(enabled: boolean, signal?: AbortSignal): Promise<DouyinLiveSnapshot> {
    const data = await readJson<{ ok: true; snapshot: DouyinLiveSnapshot }>(await fetch(DOUYIN_LIVE_API + '/speech', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled }), signal,
    }))
    return data.snapshot
  }

  /** 主动断开 Host 的直播接收连接。 */
  async disconnectDouyinLive(signal?: AbortSignal): Promise<DouyinLiveSnapshot> {
    const data = await readJson<{ ok: true; snapshot: DouyinLiveSnapshot }>(await fetch(DOUYIN_LIVE_API + '/disconnect', { method: 'POST', signal }))
    return data.snapshot
  }

  /** 清空 Host 消息缓冲区，不断开接收连接。 */
  async clearDouyinLive(signal?: AbortSignal): Promise<DouyinLiveSnapshot> {
    const data = await readJson<{ ok: true; snapshot: DouyinLiveSnapshot }>(await fetch(DOUYIN_LIVE_API + '/clear', { method: 'POST', signal }))
    return data.snapshot
  }

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

  /** 项目面板：扫描本机目录发现 Git 项目（roots 缺省用服务端默认根）。 */
  async scanProjects(roots?: string[]): Promise<ProjectScanResult> {
    const query = roots !== undefined && roots.length > 0 ? '?roots=' + encodeURIComponent(roots.join(',')) : ''
    const data = await readJson<{ scan: ProjectScanResult }>(await fetch(PROJECTS_API.projectScan + query))
    return data.scan
  }

  /** 项目面板：刷新全部项目的仓库元数据（分支/远端），返回更新后清单。 */
  async refreshProjects(): Promise<ProjectEntry[]> {
    const data = await readJson<{ projects: ProjectEntry[] }>(await fetch(PROJECTS_API.projectRefresh, { method: 'POST' }))
    return data.projects
  }

  /** 项目面板：从 package.json / README 提取描述建议。 */
  async describeProject(path: string): Promise<ProjectDescribeResult> {
    const data = await readJson<{ describe: ProjectDescribeResult }>(
      await fetch(PROJECTS_API.projectDescribe + '?path=' + encodeURIComponent(path)),
    )
    return data.describe
  }

  /** 项目面板：重定位本机路径（跨机恢复后更新 machinePaths 映射）。 */
  async relocateProject(id: string, path: string): Promise<ProjectRelocateResult> {
    const data = await readJson<{ result: ProjectRelocateResult }>(await fetch(PROJECTS_API.projectRelocate, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id, path }),
    }))
    return data.result
  }

  /** 项目面板：为路径失效的登记项目自动匹配本机候选目录。 */
  async automatchProjects(): Promise<AutomatchSuggestion[]> {
    const data = await readJson<{ suggestions: AutomatchSuggestion[] }>(await fetch(PROJECTS_API.projectAutomatch))
    return data.suggestions
  }

  /** 项目面板：一键发布（对全部发布目标逐台执行 deployCommand）。 */
  async deployProject(id: string): Promise<ProjectDeployResult> {
    const data = await readJson<{ result: ProjectDeployResult }>(await fetch(PROJECTS_API.projectDeploy, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id }),
    }))
    return data.result
  }

  /** 产出公约：读取当前配置。 */
  async getConvention(): Promise<WorkspaceConvention> {
    const data = await readJson<{ convention: WorkspaceConvention }>(await fetch(WORKSPACE_API.convention))
    return data.convention
  }

  /** 产出公约：保存配置（目录分类学 + 开关）。 */
  async saveConvention(convention: WorkspaceConvention): Promise<WorkspaceConvention> {
    const data = await readJson<{ convention: WorkspaceConvention }>(await fetch(WORKSPACE_API.convention, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(convention),
    }))
    return data.convention
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

  /** 插件更新：检查 DSH 本体（本机真实版本 vs 官方 GitHub Tags）。 */
  async checkHarnessUpdate(): Promise<HarnessUpdateCheckItem> {
    const data = await readJson<{ harness: HarnessUpdateCheckItem }>(await fetch(DEVFORGE_API.pluginUpdateHarness))
    return data.harness
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

  /** 修改一个端点内单个模型的上下文窗口与输出上限，返回刷新后的脱敏状态。 */
  async saveOpenAiGatewayModel(patch: OpenAiGatewayModelPatch, signal?: AbortSignal): Promise<OpenAiGatewayStatus> {
    const data = await readJson<{ status: OpenAiGatewayStatus }>(await fetch(OPENAI_GATEWAY_API.model, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch), signal }))
    return data.status
  }

  /** 读取智谱凭据和最新模型的脱敏状态。 */
  async getZhipuStatus(signal?: AbortSignal): Promise<ZhipuStatus> {
    const data = await readJson<{ status: ZhipuStatus }>(await fetch(ZHIPU_API.status, { signal }))
    return data.status
  }

  /** 读取智谱官方额度、模型和 MCP 用量；keyEnv 省略时由 Host 按池序自动切换。 */
  async getZhipuDashboard(window: ZhipuUsageWindow, signal?: AbortSignal, keyEnv?: string): Promise<ZhipuDashboard> {
    const params = new URLSearchParams({ window })
    if (keyEnv !== undefined && keyEnv !== '') params.set('key', keyEnv)
    const data = await readJson<{ dashboard: ZhipuDashboard }>(await fetch(ZHIPU_API.dashboard + '?' + params.toString(), { signal }))
    return data.dashboard
  }

  /** 按 Key 批量读取智谱官方用量：池内每把已配置 Key 独立一张卡片数据。 */
  async getZhipuDashboards(window: ZhipuUsageWindow, signal?: AbortSignal): Promise<ZhipuKeyUsage[]> {
    const data = await readJson<{ usages: ZhipuKeyUsage[] }>(await fetch(ZHIPU_API.dashboards + '?window=' + encodeURIComponent(window), { signal }))
    return data.usages
  }

  /** 新增一把 Key：自定义名称 + Key 明文；第一把自动成为主 Key。 */
  async addZhipuKey(input: { label: string; value: string; ref?: string }, signal?: AbortSignal): Promise<ZhipuStatus> {
    const data = await readJson<{ status: ZhipuStatus }>(await fetch(ZHIPU_API.keysAdd, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
      signal,
    }))
    return data.status
  }

  /** 删除一把附加 Key（主 Key 不允许删除）。 */
  async removeZhipuKey(id: string, signal?: AbortSignal): Promise<ZhipuStatus> {
    const data = await readJson<{ status: ZhipuStatus }>(await fetch(ZHIPU_API.keysRemove, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id }),
      signal,
    }))
    return data.status
  }

  /** 重命名一把池内 Key（只改显示名称）。 */
  async renameZhipuKey(id: string, label: string, signal?: AbortSignal): Promise<ZhipuStatus> {
    const data = await readJson<{ status: ZhipuStatus }>(await fetch(ZHIPU_API.keysRename, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id, label }),
      signal,
    }))
    return data.status
  }

  /** 把某把池内 Key 设为主 Key（改写聊天路由 zai-coding-cn 的凭据引用，下一请求生效；池成员不变）。 */
  async setZhipuPrimaryKey(env: string, signal?: AbortSignal): Promise<ZhipuStatus> {
    const data = await readJson<{ status: ZhipuStatus }>(await fetch(ZHIPU_API.setPrimary, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ env }),
      signal,
    }))
    return data.status
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

  /** 补齐智谱官方 API（开放平台）provider 与默认模型。 */
  async setupZhipuOfficialModels(signal?: AbortSignal): Promise<ZhipuOfficialStatus> {
    const data = await readJson<{ status: ZhipuOfficialStatus }>(await fetch(ZHIPU_API.officialSetup, { method: 'POST', signal }))
    return data.status
  }

  /** 保存智谱官方 API Key（先调官方接口验证，失败不落盘）。 */
  async saveZhipuOfficialKey(value: string, signal?: AbortSignal): Promise<ZhipuOfficialStatus> {
    const data = await readJson<{ status: ZhipuOfficialStatus }>(await fetch(ZHIPU_API.officialKeySave, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value }),
      signal,
    }))
    return data.status
  }

  /** 用官方 API Key 拉取开放平台最新模型清单并合并进官方 provider。 */
  async fetchZhipuOfficialModels(signal?: AbortSignal): Promise<{ status: ZhipuOfficialStatus; added: string[]; kept: string[]; total: number }> {
    return await readJson(await fetch(ZHIPU_API.officialFetchModels, { method: 'POST', signal }))
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

  /** 读取记忆工作台状态。 */
  async getMemoryStatus(signal?: AbortSignal): Promise<MemoryStatus> {
    const data = await readJson<{ status: MemoryStatus }>(await fetch(MEMORY_API.status, { signal }))
    return data.status
  }

  /** 读取记忆工作台设置。 */
  async getMemorySettings(signal?: AbortSignal): Promise<MemorySettings> {
    const data = await readJson<{ settings: MemorySettings }>(await fetch(MEMORY_API.settings, { signal }))
    return data.settings
  }

  /** 读取会话记忆条目。 */
  async listMemories(signal?: AbortSignal): Promise<RagDocument[]> {
    const data = await readJson<{ docs: RagDocument[] }>(await fetch(MEMORY_API.memories, { signal }))
    return data.docs
  }

  /** 读取沉淀条目内容预览（首块前 160 字；失败由调用方回退文件名）。 */
  async previewMemoryDoc(id: string, signal?: AbortSignal): Promise<string> {
    const data = await readJson<{ text: string }>(await fetch(MEMORY_API.memoriesPreview + '?id=' + encodeURIComponent(id), { signal }))
    return data.text
  }

  /** 保存记忆工作台设置。 */
  async saveMemorySettings(settings: MemorySettings, signal?: AbortSignal): Promise<MemorySettings> {
    const data = await readJson<{ settings?: MemorySettings }>(await fetch(MEMORY_API.settings, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(settings), signal }))
    return data.settings ?? settings
  }

  /** 删除会话记忆条目。 */
  async deleteMemory(id: string, signal?: AbortSignal): Promise<void> {
    await readJson(await fetch(MEMORY_API.memoryItem + '?id=' + encodeURIComponent(id), { method: 'DELETE', signal }))
  }

  /** 增量索引项目。 */
  async indexMemoryProject(path: string, signal?: AbortSignal): Promise<ProjectIndexResult> {
    const data = await readJson<{ report: ProjectIndexResult }>(await fetch(MEMORY_API.index, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path }), signal }))
    return data.report
  }

  /** 同步 Mnemon/Hindsight 只读镜像。 */
  async syncMemoryMirror(kind: 'mnemon' | 'hindsight', signal?: AbortSignal): Promise<MirrorSyncResult> {
    const data = await readJson<{ report: MirrorSyncResult }>(await fetch(MEMORY_API.mirrorSync, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind }), signal }))
    return data.report
  }

  /** 关键词检索内置长期记忆。 */
  async searchNativeMemories(query: string, limit = 20, signal?: AbortSignal): Promise<NativeMemoryEntry[]> {
    const data = await readJson<{ entries: NativeMemoryEntry[] }>(await fetch(MEMORY_API.search + '?q=' + encodeURIComponent(query) + '&limit=' + limit, { signal }))
    return data.entries
  }

  /** 手动新增一条内置长期记忆。 */
  async saveNativeMemory(input: { content: string; category?: string; tags?: string[]; source?: string }, signal?: AbortSignal): Promise<NativeMemoryEntry> {
    const data = await readJson<{ entry: NativeMemoryEntry }>(await fetch(MEMORY_API.save, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input), signal }))
    return data.entry
  }

  /** 删除一条内置长期记忆。 */
  async deleteNativeMemory(id: string, signal?: AbortSignal): Promise<void> {
    await readJson(await fetch(MEMORY_API.remove, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id }), signal }))
  }

  /** 全量列出内置长期记忆（主存储，最多 200 条）。 */
  async listNativeMemories(signal?: AbortSignal): Promise<NativeMemoryEntry[]> {
    const data = await readJson<{ entries: NativeMemoryEntry[] }>(await fetch(MEMORY_API.nativeList, { signal }))
    return data.entries
  }

  /** 读取内置记忆知识图谱（服务端现算，只读）。 */
  async getMemoryGraph(signal?: AbortSignal): Promise<MemoryGraph> {
    const data = await readJson<{ graph: MemoryGraph }>(await fetch(MEMORY_API.graph, { signal }))
    return data.graph
  }

  /** 读取用户身份卡（常驻注入画像）。 */
  async getUserProfile(signal?: AbortSignal): Promise<MemoryUserProfile> {
    const data = await readJson<{ profile: MemoryUserProfile }>(await fetch(MEMORY_API.profile, { signal }))
    return data.profile
  }

  /** 保存用户身份卡（常驻注入即时生效，无需重启）。 */
  async saveUserProfile(profile: MemoryUserProfile, signal?: AbortSignal): Promise<MemoryUserProfile> {
    const data = await readJson<{ profile: MemoryUserProfile }>(await fetch(MEMORY_API.profile, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(profile), signal }))
    return data.profile
  }

  /** 一键迁移外部记忆（Mnemon/Hindsight → 内置，幂等）。 */
  async migrateExternalMemory(kind: 'mnemon' | 'hindsight' | 'mneme', signal?: AbortSignal): Promise<NativeMemoryMigrationResult> {
    const data = await readJson<{ result: NativeMemoryMigrationResult }>(await fetch(MEMORY_API.migrateExternal, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind }), signal }))
    return data.result
  }

  /** 读取内置记忆迁移状态。 */
  async getMemoryMigrationStatus(signal?: AbortSignal): Promise<{ count: number; migrated: number; lastUpdatedAt: number }> {
    const data = await readJson<{ status: { count: number; migrated: number; lastUpdatedAt: number } }>(await fetch(MEMORY_API.migrationStatus, { signal }))
    return data.status
  }

  /** 读取记忆做梦整理状态与最近运行记录。 */
  async getMemoryDreamStatus(signal?: AbortSignal): Promise<MemoryDreamStatus> {
    const data = await readJson<{ dream: MemoryDreamStatus }>(await fetch(MEMORY_API.dream, { signal }))
    return data.dream
  }

  /** 手动触发一轮记忆做梦整理（异步执行，结果经 getMemoryDreamStatus 轮询）。 */
  async runMemoryDream(signal?: AbortSignal): Promise<{ started: boolean; message: string }> {
    return await readJson<{ started: boolean; message: string }>(await fetch(MEMORY_API.dreamRun, { method: 'POST', signal }))
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

  /** 从受管凭据中删除一个引用（智谱附加 Key 槽位移除时使用；主 Key 不允许在面板删除）。 */
  async removeCredential(ref: string): Promise<{ removed: boolean }> {
    return await readJson(await fetch(CREDENTIALS_API.remove, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ref }),
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

  // ---------------- MCP 服务器接入（0.21.0） ----------------

  /** MCP：读取服务器配置清单（env/headers 值脱敏，只含键与是否已配置）。 */
  async listMcpServers(signal?: AbortSignal): Promise<McpServerSummary[]> {
    const data = await readJson<{ servers: McpServerSummary[] }>(await fetch(MCP_API.servers, { signal }))
    return data.servers
  }

  /** MCP：保存（新增或更新）一台服务器；保存即挂载/卸载生效。 */
  async saveMcpServer(request: McpServerSaveRequest, signal?: AbortSignal): Promise<McpServerSummary> {
    const data = await readJson<{ server: McpServerSummary }>(await fetch(MCP_API.servers, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
      signal,
    }))
    return data.server
  }

  /** MCP：删除一台服务器；删除即卸载其全部工具。 */
  async deleteMcpServer(id: string, signal?: AbortSignal): Promise<void> {
    await readJson(await fetch(MCP_API.servers + '?id=' + encodeURIComponent(id), { method: 'DELETE', signal }))
  }

  /** MCP：连接测试。id = 测已存配置（含已存密钥）；server = 测面板内联表单（密钥空值回填已存值）。 */
  async testMcpServer(input: { id?: string; server?: McpServerSaveRequest }, signal?: AbortSignal): Promise<McpTestResult> {
    const data = await readJson<{ result: McpTestResult }>(await fetch(MCP_API.test, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
      signal,
    }))
    return data.result
  }

  /** MCP：读取运行时状态（fiber 挂载情况 + 实际注册到模型的 mcp__ 工具）。 */
  async getMcpStatus(signal?: AbortSignal): Promise<McpRuntimeStatus> {
    const data = await readJson<{ status: McpRuntimeStatus }>(await fetch(MCP_API.status, { signal }))
    return data.status
  }

  /** MCP：全量重载（断开全部 fiber 后按当前配置重建）。 */
  async reloadMcp(signal?: AbortSignal): Promise<McpRuntimeStatus> {
    const data = await readJson<{ status: McpRuntimeStatus }>(await fetch(MCP_API.reload, { method: 'POST', signal }))
    return data.status
  }

  /** 主脑路由：读取设置与运行时诊断（含拦截器挂载情况）。 */
  async getBrainRouter(signal?: AbortSignal): Promise<BrainRouterStatus> {
    const data = await readJson<BrainRouterStatus>(await fetch(BRAIN_ROUTER_API.status, { signal, cache: 'no-store' }))
    return data
  }

  /** 主脑路由：全量保存设置；服务端校验失败（如开启但未选工人模型）会抛 DevforgeApiError。 */
  async saveBrainRouter(settings: BrainRouterSettings, signal?: AbortSignal): Promise<BrainRouterStatus> {
    const data = await readJson<BrainRouterStatus>(await fetch(BRAIN_ROUTER_API.status, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ settings }),
      signal,
    }))
    return data
  }

  /** 主脑路由：读取模型目录（工人模型下拉数据源；provider 失败时其 models 为空数组）。 */
  async getBrainRouterCatalog(signal?: AbortSignal): Promise<BrainRouterCatalogProvider[]> {
    const data = await readJson<{ ok: true; providers: BrainRouterCatalogProvider[] }>(await fetch(BRAIN_ROUTER_API.catalog, { signal, cache: 'no-store' }))
    return data.providers
  }
}