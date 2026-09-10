/**
 * dsh-devforge —— 宿主半边入口。
 *
 * 职责（全部走官方 SDK，无 dsh 源码改动）：
 *   1. StandardsStore：加载插件内置开发规范库（standards/）；
 *   2. ForgeEngine：一键子代理服务生成（ctx.agents.create + followup）；
 *   3. /api/dsh-devforge 路由族（loopback 围栏）；
 *   4. devforge_jobs / devforge_standards 两个 Agent 工具；
 *   5. systemPrompt 常驻节：向每个 agent 通报规范库与一键生成入口；
 *   6. 已安装插件功能总览注入（0.12.0）：自动枚举 Loader 用户插件注入功能说明。
 *
 * 浏览器半边（./client）负责侧边栏入口 + 仿 SSH 面板。
 * 生命周期：所有注册都包 ctx.effect，配置热更新时先卸旧再挂新（sync 模式）。
 */

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import { installSettingsSection, settingsNamespace } from './settings-compat.ts'
import z from 'schemastery'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-tools'
import { ForgeEngine, type ForgeHostServices } from './forge.ts'
import { isLoopbackRequest } from './loopback.ts'
import { activateFeishu, type FeishuCapabilityConfig } from './feishu/activate.ts'
import { activateGithub, type GithubCapabilityConfig } from './github/activate.ts'
import { activateCnb, type CnbCapabilityConfig } from './cnb/activate.ts'
import { activateRemote, type RemoteConfig } from './remote/activate.ts'
import { getDb, getSettings, putSettings } from './store/db.ts'
import { migrateFromLegacyFiles } from './store/migrate.ts'
import { LegacyRemoteRegistry } from './remote/legacy-registry.ts'
import { makeRemoteRoutes } from './remote/routes.ts'
import { makeBackupRoutes } from './backup/routes.ts'
import { BackupScheduler } from './backup/scheduler.ts'
import { backupNowTool, backupStatusTool } from './backup/tools.ts'
import { HostStore as SshHostStore } from './remote/ssh/store.ts'
import { HostStore as WinrmHostStore } from './remote/winrm/store.ts'
import { makeRoutes } from './routes.ts'
import { makeBrainRouterRoutes } from './brain-router/routes.ts'
import { installBrainRouterSection, installBrainRouterWrapper, listBrainRouterCatalog, writeBrainRouterSettings } from './brain-router/service.ts'
import { BRAIN_ROUTER_DEFAULTS, type BrainRouterSettings } from './brain-router/protocol.ts'
import { BRAIN_ROUTER_DISCIPLINE_SECTION_NAME, BRAIN_ROUTER_DISCIPLINE_SECTION_ORDER, BRAIN_ROUTER_DISCIPLINE_TEXT } from './brain-router/discipline.ts'
import { RagService } from './rag/service.ts'
import { RagStore } from './rag/rag-store.ts'
import { RagEmbeddingError, ZhipuEmbedder } from './rag/embedder.ts'
import { ZhipuReranker } from './rag/rerank.ts'
import { MemoryDreamService } from './memory/dream.ts'
import { MemorySedimentService } from './memory/sediment.ts'
import { MemoryStatsStore } from './memory/stats.ts'
import { MemoryInjectionService } from './memory/inject.ts'
import { MemoryGovernanceService } from './memory/governance.ts'
import { MemoryRecallService } from './memory/recall.ts'
import { resolveMemoryScope } from './memory/scope.ts'
import { NativeMemoryStore } from './memory/native.ts'
import { memoryManageTool } from './memory/tools.ts'
import { UserProfileInjectionService, DEFAULT_USER_PROFILE, normalizeUserProfile, type MemoryUserProfile } from './memory/profile.ts'
import { DEFAULT_MEMORY_SETTINGS, makeMemoryRoutes, normalizeMemorySettings, type MemorySettings } from './memory/routes.ts'
import { WorkflowEngine } from './workflow/engine.ts'
import { makeWorkflowRoutes } from './workflow/routes.ts'
import { ragRunTool } from './workflow/tools.ts'
import { McpService } from './mcp/service.ts'
import { makeMcpRoutes } from './mcp/routes.ts'
import { DouyinLiveService } from './douyin-live/service.ts'
import { DouyinReceiverProcess } from './douyin-live/receiver.ts'
import { makeDouyinLiveRoutes } from './douyin-live/routes.ts'
import { douyinLiveStore } from './douyin-live/store.ts'
import { SiliconFlowService, type SiliconFlowCapabilityConfig } from './siliconflow/service.ts'
import { makeSiliconFlowRoutes } from './siliconflow/routes.ts'
import { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { RagSettings as RagSettingsPartial } from './rag/protocol.ts'
import { makeRagRoutes } from './rag/routes.ts'
import { ragSearchTool } from './rag/tools.ts'
import { activateBrowser, type BrowserActivation } from './browser/activate.ts'
import type { BrowserStatus } from './browser/protocol.ts'
import { makeBrowserRoutes } from './browser/routes.ts'
import type { BrowserRoutesService } from './browser/service.ts'
import { makeZhipuRoutes } from './zhipu/routes.ts'
import { ZhipuCodingPlanService, resolveZhipuPrimaryKeyName, type ZhipuCapabilityConfig } from './zhipu/service.ts'
import { activateZhipuMcpTools } from './zhipu/mcp-tools.ts'
import { ZhipuKeyPool, type ZhipuKeyEntry } from './zhipu/key-pool.ts'
import { makeMiniMaxRoutes } from './minimax/routes.ts'
import { MiniMaxService, type MiniMaxCapabilityConfig } from './minimax/service.ts'
import { activateMiniMaxTools, activateMiniMaxHubTools } from './minimax/tools.ts'
import { makeArkRoutes } from './ark/routes.ts'
import { ArkCodingPlanService, type ArkCapabilityConfig } from './ark/service.ts'
import { makeOpenAiRoutes } from './openai/routes.ts'
import { OpenAiGatewayService, type OpenAiCapabilityConfig } from './openai/service.ts'
import { activateOpenAiGenerateImage } from './openai/tools.ts'
import { makeCredentialsRoutes } from './credentials-routes.ts'
import { DshWebRestartManager } from './restart.ts'
import { StandardsStore } from './standards.ts'
import { devforgeJobsTool, devforgeRestartTool, devforgeStandardsTool } from './tools.ts'
import { devforgeProjectTool } from './projects/tools.ts'
import { runProjectDeploy } from './projects/deploy.ts'
import { devforgeWorkspaceTool } from './workspace/tools.ts'
import { getConvention, renderConventionSummary } from './workspace/convention.ts'
import { listProjects } from './projects/store.ts'
import { CONSTRAINTS_DEFAULT_PATHS, ConstraintInjectionService, type ConstraintsConfig } from './constraints.ts'
import { SANDBOX_DISCIPLINE_SECTION_NAME, SANDBOX_DISCIPLINE_SECTION_ORDER, SANDBOX_DISCIPLINE_TEXT } from './sandbox-discipline.ts'
import { activatePluginBrief, emptyDiagnostics, type PluginBriefConfig } from './plugin-brief.ts'
import { createDefaultInstalledReader, PluginUpdateService, PLUGIN_UPDATE_DEFAULT_SOURCES } from './plugin-update.ts'
import { checkHarnessUpdate, createDefaultHarnessVersionReader, type HarnessUpdateCheckItem } from './harness-update.ts'

/** cordis 插件名（稳定 id）。 */
export const name = 'devforge'

/**
 * 前置服务：核心工厂使用路由、工具和子代理；飞书接管还依赖模型目录、会话持久化、
 * 标题和附件服务。这里必须保持与原 dsh-feishu 注入集合一致，避免能力延迟到运行时才报错。
 */
export const inject = [
  'webServer', 'tools', 'systemPrompt', 'credentials', 'settings', 'agents', 'agentDefaultModel', 'llm', 'agentPresets',
  'workspaceRegistry', 'sessionPersistence', 'sessionTitle', 'attachments',
  // 插件能力总览需要枚举 Loader 条目（0.12.0）；cordis 规定 ctx 上访问未声明服务会抛
  // "cannot get property ... without inject"，所以 loader 必须显式声明（宿主核心服务，恒可用）。
  'loader',
]

/** 设置命名空间。 */
export const DEVFORGE_SETTINGS_NAMESPACE = settingsNamespace('dsh-devforge')

/** 读取 store.db 里的 openai 配置副本；宿主设置段异常时的兜底来源。 */
function readStoreDbOpenAi(): Partial<OpenAiCapabilityConfig> {
  try {
    const stored = getSettings(getDb(), 'openai.settings')
    return stored && typeof stored === 'object' ? stored as Partial<OpenAiCapabilityConfig> : {}
  } catch { return {} }
}

/** 单个能力激活失败不拖垮整段注册/热更新。 */
function safeActivate(ctx: Context, label: string, fn: () => void): void {
  try { fn() } catch (error) { ctx.logger?.warn?.('[dsh-devforge] %s 激活失败（已跳过，不影响其他能力）：%s', label, error instanceof Error ? error.message : String(error)) }
}

/** 设置段就绪自检：宿主竞态导致注册缺失时重试观察并醒目降级日志。 */
function scheduleSectionReadinessCheck(ctx: Context, tries = 8): void {
  const timer = setTimeout(() => {
    try {
      const ready = ctx.settings.describe().some((item) => item.ns === DEVFORGE_SETTINGS_NAMESPACE)
      if (ready) ctx.logger?.info?.('[dsh-devforge] 设置段已就绪')
      else if (tries > 0) scheduleSectionReadinessCheck(ctx, tries - 1)
      else ctx.logger?.error?.('[dsh-devforge] 设置段注册缺失：openai 配置读写已降级为 store.db 模式（宿主设置面板暂不可写）')
    } catch {
      if (tries > 0) scheduleSectionReadinessCheck(ctx, tries - 1)
    }
  }, 2500)
  timer.unref?.()
}

/** 插件配置（schemastery 校验）。 */
export interface Config {
  /** 总开关：关闭后不挂路由/工具/通报（默认开）。 */
  enabled?: boolean
  /** 是否向 agent 系统提示通报本插件能力（默认开）。 */
  announceToAgent?: boolean
  /** 远程运维（SSH/WinRM 兼容接管）子配置。 */
  remote?: RemoteConfig
  /** 本地浏览器（Playwright MCP）子配置。 */
  browser?: { enabled?: boolean; headless?: boolean; channel?: string; profileDir?: string; timeoutMs?: number }
  /** GitHub 能力（兼容接管）子配置。 */
  github?: GithubCapabilityConfig
  /** CNB 代码托管（cnb.cool）子配置。 */
  cnb?: CnbCapabilityConfig
  /** 飞书能力（兼容接管）子配置；bootstrap 字段与旧 dsh-feishu patch 行一致。 */
  feishu?: FeishuCapabilityConfig
  /** 智谱 Coding Plan 官方模型与额度能力。 */
  zhipu?: ZhipuCapabilityConfig & { mcpTools?: boolean }
  /** MiniMax Coding Plan 官方模型与工具能力。 */
  minimax?: MiniMaxCapabilityConfig
  /** 火山方舟 Agent Plan 模型池、推理档位与控制面用量看板。 */
  ark?: ArkCapabilityConfig
  /** OpenAI 兼容中转站、聊天模型目录与全局生图工具。 */
  openai?: OpenAiCapabilityConfig
  /** 项目约束上下文注入子配置。 */
  constraints?: Partial<ConstraintsConfig>
  /** 已安装插件功能总览注入子配置。 */
  pluginBrief?: Partial<PluginBriefConfig>
  /** 插件更新子配置。 */
  pluginUpdate?: { enabled?: boolean; profile?: string; sources?: Array<{ packageName: string; indexUrl?: string; repo?: string }> }
  /** 会话记忆层子配置（设置项存 store.db，此处仅总开关兜底）。 */
  memory?: { enabled?: boolean }
  /** 硅基流动 Provider 子配置。 */
  siliconflow?: { enabled?: boolean; apiKeyEnv?: string; timeoutMs?: number }
  /** MCP 服务器接入子配置（服务器明细存 store.db 面板管理，此处仅总开关）。 */
  mcp?: { enabled?: boolean }
}

/** 配置默认值。 */
const DEFAULTS = { enabled: true, announceToAgent: true }

/** schemastery 配置模式（设置面板自动生成）。 */
export const Config = z.object({
  enabled: z.boolean().default(true).description('插件总开关'),
  announceToAgent: z.boolean().default(true).description('向 Agent 通报插件能力'),
  remote: z.object({
    enabled: z.boolean().default(true).description('远程运维（SSH/WinRM 兼容接管）开关'),
  }).description('远程运维配置'),
  browser: z.object({
    enabled: z.boolean().default(false).description('本地浏览器控制开关'),
    headless: z.boolean().default(false).description('无头模式（默认关闭，操作实时可见）'),
    channel: z.string().default('chrome').description('浏览器通道：chrome / msedge / chromium'),
    profileDir: z.string().default('').description('持久化用户档案目录（留空使用默认路径，保存登录状态）'),
    timeoutMs: z.number().min(5000).max(120000).default(45000).description('浏览器操作超时（毫秒）'),
  }).description('本地浏览器配置（Playwright MCP，不含任何凭据）'),
  github: z.object({
    enabled: z.boolean().default(true).description('GitHub 能力（兼容接管）开关'),
  }).description('GitHub 配置'),
  cnb: z.object({
    enabled: z.boolean().default(true).description('CNB 代码托管（cnb.cool）开关'),
  }).description('CNB 配置'),
  feishu: z.object({
    enabled: z.boolean().default(true).description('飞书能力（兼容接管）开关；启用前必须停用旧 dsh-feishu'),
  }).description('飞书配置'),
  zhipu: z.object({
    enabled: z.boolean().default(true).description('智谱 Coding Plan 模型与官方额度看板'),
    apiKeyEnv: z.string().default('ZAI_CODING_CN_API_KEY').description('智谱受管凭据引用'),
    timeoutMs: z.number().min(1000).max(60000).default(15000).description('智谱官方接口超时（毫秒）'),
    mcpTools: z.boolean().default(true).description('官方 MCP 工具：联网搜索/网页读取/Zread'),
    officialApiKeyEnv: z.string().default('ZHIPU_OFFICIAL_API_KEY').description('智谱官方 API（开放平台直调）受管凭据引用'),
  }).description('智谱 Coding Plan 配置'),
  minimax: z.object({
    enabled: z.boolean().default(true).description('MiniMax Coding Plan 模型路由与官方工具'),
    apiKeyEnv: z.string().default('MINIMAX_CN_API_KEY').description('MiniMax 受管凭据引用'),
    timeoutMs: z.number().min(1000).max(120000).default(30000).description('MiniMax 官方接口超时（毫秒）'),
    tools: z.boolean().default(true).description('官方工具：联网搜索/图像理解'),
  }).description('MiniMax Coding Plan 配置'),
  ark: z.object({
    enabled: z.boolean().default(true).description('火山方舟 Agent Plan 模型、推理档位与用量看板'),
    apiKeyEnv: z.string().default('ARK_CODING_PLAN_API_KEY').description('方舟 Agent Plan 数据面凭据引用'),
    usageAccessKeyEnv: z.string().default('VOLC_ACCESS_KEY').description('火山控制面 Access Key 凭据引用'),
    usageSecretKeyEnv: z.string().default('VOLC_SECRET_KEY').description('火山控制面 Secret Key 凭据引用'),
    usageTimeoutMs: z.number().min(1000).max(60000).default(15000).description('火山用量 OpenAPI 超时（毫秒）'),
  }).description('火山方舟 Agent Plan 配置'),
  openai: z.object({
    enabled: z.boolean().default(true).description('OpenAI 兼容中转站模型与生图工具'),
    baseURL: z.string().default('').description('OpenAI 兼容中转站地址（裸主机或 /v1 API 根路径）'),
    apiKeyEnv: z.string().default('OPENAI_GATEWAY_API_KEY').description('OpenAI 中转站受管凭据引用'),
    imageModel: z.string().default('').description('主端点的 generate_image 生图模型'),
    endpoints: z.array(z.object({
      id: z.string().description('端点稳定标识'),
      name: z.string().description('端点显示名称'),
      baseURL: z.string().description('端点地址（裸主机或 /v1）'),
      apiKeyEnv: z.string().description('端点受管凭据引用'),
      imageModel: z.string().default('').description('该端点的生图模型'),
    })).default([]).description('OpenAI 兼容中转端点列表；为空时兼容旧版 baseURL 配置'),
    timeoutMs: z.number().min(1000).max(600000).default(300000).description('中转站生图请求超时（毫秒）'),
  }).description('OpenAI 兼容中转站配置'),
  constraints: z.object({
    enabled: z.boolean().default(true).description('项目约束注入总开关'),
    fullTextPaths: z.array(z.string()).default(CONSTRAINTS_DEFAULT_PATHS).description('开发仓库路径清单：会话工作目录命中任一前缀即从首轮回注约束全文'),
  }).description('项目约束上下文注入配置（三层：常驻摘要保底/仓库信号全文/开发动作升级全文）'),
  pluginBrief: z.object({
    enabled: z.boolean().default(true).description('已安装插件功能总览注入开关'),
  }).description('插件能力总览：自动枚举本机安装的插件并把功能说明注入模型上下文'),
  memory: z.object({
    enabled: z.boolean().default(true).description('会话记忆层（自动沉淀+主动注入）总开关；细项在「记忆工作台」页配置'),
  }).description('会话记忆层配置'),
  siliconflow: z.object({
    enabled: z.boolean().default(true).description('硅基流动 Provider（模型目录+免费向量）'),
    apiKeyEnv: z.string().default('SILICONFLOW_API_KEY').description('硅基流动受管凭据引用'),
    timeoutMs: z.number().min(1000).max(60000).default(15000).description('硅基流动接口超时（毫秒）'),
  }).description('硅基流动配置'),
  mcp: z.object({
    enabled: z.boolean().default(true).description('MCP 服务器接入总开关：按 store.db 配置把外部 MCP 服务器的工具注册给模型（明细在天工造梦「MCP」页管理）'),
  }).description('MCP 服务器接入配置'),
  pluginUpdate: z.object({
    enabled: z.boolean().default(true).description('插件更新检查与一键升级开关'),
    profile: z.string().default('web').description('执行 dsh plugin add 的目标 profile 名'),
    sources: z.array(z.object({
      packageName: z.string().description('npm 包名'),
      indexUrl: z.string().default('').description('官网版本清单地址（downloads/index.json，含 sha256），留空则走 GitHub 兜底'),
      repo: z.string().default('').description('GitHub 仓库（owner/repo），官网清单不可用时兜底'),
    })).default([{ packageName: 'dsh-devforge', indexUrl: 'https://modagentai.com/downloads/index.json', repo: 'andyfan1094/dsh-devforge' }]).description('更新源登记表：只允许升级登记过的包'),
  }).description('插件更新：官网清单优先，GitHub 兜底'),
}).description('dsh-devforge 配置')

/** 系统提示通报顺序（靠后，避免抢核心指令位置）。 */
const SECTION_ORDER = 500

/** 向 agent 通报的能力说明文本。 */
const DEVFORGE_GUIDANCE = [
  '本机安装了 dsh-devforge 插件（规范驱动服务生成）：',
  '- devforge_standards 工具：列出/读取内置开发规范（写代码前先查对应规范）。',
  '- devforge_jobs 工具：一键按规范创建服务生成子代理（action=create，需 templateId+targetDir）。',
  '- devforge_restart 工具：仅在用户明确要求时，安全重启本机 DSH Web Host。',
  '- 用户说"一键生成服务/按规范建服务"时即指本插件；生成任务进度见 Web 面板（devforge 侧边栏入口）。',
  '- zhipu_web_search / zhipu_web_reader / zhipu_zread_search / zhipu_zread_read_file / zhipu_zread_repo_structure：智谱 GLM Coding Plan 官方 MCP 工具（联网搜索/网页读取/开源仓库解读），消耗套餐每月 MCP 额度；Coding Plan 页支持多把 Key（主 Key + 附加槽位），官方调用遇 Key 失效/限流/额度耗尽自动切换。',
  '- minimax_web_search / minimax_understand_image / minimax_image_generation / minimax_text_to_speech / minimax_video_generation：MiniMax Coding Plan 官方工具（联网搜索/图像理解/图像生成/语音合成/视频生成，图片支持本机路径与 http(s) URL），消耗 MiniMax 套餐额度。',
  '- 火山方舟 Agent Plan：天工造梦的 Coding Plan 页内支持 Plan API Key、官方文本模型池、推理档位，以及用控制面 AK/SK 查询的 5 小时/周/月用量看板。',
  '- OpenAI 中转站：Coding Plan 页内支持多个中转端点、受管 API Key、GET /v1/models 模型发现与聊天路由，并由所选生图模型提供全局 generate_image 工具。',
  '- 硅基流动：Coding Plan 页内支持 API Key、按系列精选最新版对话模型目录同步；记忆中枢可直接使用 BAAI/bge-m3 向量模型，不依赖余额接口。',
  '- CNB 代码托管（cnb.cool，国内）：cnb_auth_add / cnb_auth_list / cnb_auth_test / cnb_repo_list / cnb_clone / cnb_pull / cnb_push / cnb_commit / cnb_status / cnb_auth_remove；平台仅支持 HTTPS+访问令牌（Git 用户名固定 cnb），令牌经临时 HTTP 头注入绝不进 URL，推送默认关闭需在天工造梦设置打开。',
  '- browser_tabs / browser_upload：管理同一可见 Chrome 的多标签页，并安全上传本机图片；多个会话共用持久登录档案。',
  '- xianyu_messages_list / xianyu_conversation_read：在独立消息标签页读取当前登录闲鱼账号的会话与消息；打开未读会话会触发已读状态。',
  '- xianyu_reply：仅在用户明确确认联系人和完整正文后真实发送，confirmation 必须绑定联系人，例如“确认发送给‘张三’”。',
  '- xianyu_publish：在独立发布标签页上传图片、填写商品信息并核验发布结果；真实发布必须传入“确认发布”。',
  '- MCP 服务器接入：外部 MCP 服务器在天工造梦面板「MCP」页配置；启用的服务器其工具以 mcp__<serverName>__<tool> 名称注册（如 mcp__github__create_issue），可直接调用，调用失败如实报错。',
].join('\n')

/** 插件挂载（mountOnce 防重复挂载，dsh-winrm 同款）。 */
let mounted = false
export function apply(ctx: Context, config?: Config): void {
  if (mounted) return
  mounted = true

  // ---- 配置解析 ----
  let current: () => Config = () => config ?? {}
  const resolve = (): Config => {
    const value = current()
    const storedOpenAi = readStoreDbOpenAi()
    return {
      enabled: value.enabled ?? DEFAULTS.enabled,
      announceToAgent: value.announceToAgent ?? DEFAULTS.announceToAgent,
      remote: { enabled: value.remote?.enabled ?? false },
      browser: {
        enabled: value.browser?.enabled ?? false,
        headless: value.browser?.headless === true,
        channel: value.browser?.channel ?? 'chrome',
        profileDir: value.browser?.profileDir ?? '',
        timeoutMs: value.browser?.timeoutMs ?? 45000,
      },
      github: { enabled: value.github?.enabled ?? false },
      cnb: { enabled: value.cnb?.enabled ?? false },
      feishu: { enabled: value.feishu?.enabled ?? false },
      zhipu: {
        enabled: value.zhipu?.enabled ?? true,
        apiKeyEnv: value.zhipu?.apiKeyEnv ?? 'ZAI_CODING_CN_API_KEY',
        timeoutMs: value.zhipu?.timeoutMs ?? 15000,
        mcpTools: value.zhipu?.mcpTools !== false,
        officialApiKeyEnv: value.zhipu?.officialApiKeyEnv ?? 'ZHIPU_OFFICIAL_API_KEY',
      },
      minimax: {
        enabled: value.minimax?.enabled ?? true,
        apiKeyEnv: value.minimax?.apiKeyEnv ?? 'MINIMAX_CN_API_KEY',
        timeoutMs: value.minimax?.timeoutMs ?? 30000,
        tools: value.minimax?.tools !== false,
      },
      ark: {
        enabled: value.ark?.enabled ?? true,
        apiKeyEnv: value.ark?.apiKeyEnv ?? 'ARK_CODING_PLAN_API_KEY',
        usageAccessKeyEnv: value.ark?.usageAccessKeyEnv ?? 'VOLC_ACCESS_KEY',
        usageSecretKeyEnv: value.ark?.usageSecretKeyEnv ?? 'VOLC_SECRET_KEY',
        usageTimeoutMs: value.ark?.usageTimeoutMs ?? 15000,
      },
      openai: {
        enabled: value.openai?.enabled ?? storedOpenAi.enabled ?? true,
        baseURL: value.openai?.baseURL ?? storedOpenAi.baseURL ?? '',
        apiKeyEnv: value.openai?.apiKeyEnv ?? storedOpenAi.apiKeyEnv ?? 'OPENAI_GATEWAY_API_KEY',
        imageModel: value.openai?.imageModel ?? storedOpenAi.imageModel ?? '',
        endpoints: value.openai?.endpoints?.length ? value.openai.endpoints : storedOpenAi.endpoints ?? [],
        timeoutMs: value.openai?.timeoutMs ?? storedOpenAi.timeoutMs ?? 300000,
      },
      constraints: {
        enabled: value.constraints?.enabled ?? true,
        fullTextPaths: value.constraints?.fullTextPaths?.length ? value.constraints.fullTextPaths : CONSTRAINTS_DEFAULT_PATHS,
      },
      pluginBrief: {
        enabled: value.pluginBrief?.enabled ?? true,
      },
      pluginUpdate: {
        enabled: value.pluginUpdate?.enabled ?? true,
        profile: value.pluginUpdate?.profile ?? 'web',
        sources: value.pluginUpdate?.sources?.length ? value.pluginUpdate.sources : PLUGIN_UPDATE_DEFAULT_SOURCES,
      },
      memory: { enabled: value.memory?.enabled ?? true },
      siliconflow: {
        enabled: value.siliconflow?.enabled ?? true,
        apiKeyEnv: value.siliconflow?.apiKeyEnv ?? 'SILICONFLOW_API_KEY',
        timeoutMs: value.siliconflow?.timeoutMs ?? 15000,
      },
      mcp: { enabled: value.mcp?.enabled ?? true },
    }
  }

  // ---- 核心对象 ----
  // 规范库根目录 = 本文件上级的 standards/（lib/index.js → ../standards）
  const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
  const standards = new StandardsStore(join(pluginRoot, 'standards'))
  const restartManager = new DshWebRestartManager()
  // 第一阶段只读桥接旧 SSH/WinRM store；不搬运、不回写任何凭据。
  const remoteRegistry = new LegacyRemoteRegistry()
  const engine = new ForgeEngine(ctx, ctx as unknown as ForgeHostServices, standards, join(pluginRoot, '.devforge'))
  ctx.effect(() => () => { engine.dispose() }, 'dsh-devforge: engine')

  // ---- 常驻面板路由的活能力句柄：开关状态按请求判断，避免“前端在、后端 404”。----
  const zhipuConfig = { enabled: true, apiKeyEnv: 'ZAI_CODING_CN_API_KEY', timeoutMs: 15000, mcpTools: true, officialApiKeyEnv: 'ZHIPU_OFFICIAL_API_KEY' }
  const minimaxConfig = { enabled: true, apiKeyEnv: 'MINIMAX_CN_API_KEY', timeoutMs: 30000, tools: true }
  const arkConfig: ArkCapabilityConfig = { enabled: true, apiKeyEnv: 'ARK_CODING_PLAN_API_KEY', usageAccessKeyEnv: 'VOLC_ACCESS_KEY', usageSecretKeyEnv: 'VOLC_SECRET_KEY', usageTimeoutMs: 15000 }
  const openAiConfig: OpenAiCapabilityConfig = { enabled: true, baseURL: '', apiKeyEnv: 'OPENAI_GATEWAY_API_KEY', imageModel: '', timeoutMs: 300000 }
  const DISABLED_BROWSER: BrowserStatus = { enabled: false, running: false, ready: false, profileDir: '', message: '浏览器能力未启用，请在天工造梦设置中开启' }
  let browserApi: Pick<BrowserRoutesService, 'status' | 'navigate' | 'snapshot' | 'screenshot' | 'stop'> | undefined
  const browserHolder: BrowserRoutesService = {
    enabled: false,
    status: async (): Promise<BrowserStatus> => browserApi === undefined ? DISABLED_BROWSER : await browserApi.status(),
    navigate: async (url: string) => {
      if (browserApi === undefined) throw new Error('浏览器能力未启用，请在天工造梦设置中开启')
      return await browserApi.navigate(url)
    },
    snapshot: async () => {
      if (browserApi === undefined) throw new Error('浏览器能力未启用，请在天工造梦设置中开启')
      return await browserApi.snapshot()
    },
    screenshot: async () => {
      if (browserApi === undefined) throw new Error('浏览器能力未启用，请在天工造梦设置中开启')
      return await browserApi.screenshot()
    },
    stop: async () => {
      if (browserApi === undefined) throw new Error('浏览器能力未启用，请在天工造梦设置中开启')
      return await browserApi.stop()
    },
  }

  // ---- 常驻套餐能力服务：路由与启动自动补齐共用同一实例。----
  // 智谱 Key 池：独立命名列表持久化在 store.db 设置域（随 CNB 备份）；
  // 主 Key 仅是聊天路由 provider.apiKeyEnv 当前指向，切换主 Key 不增删池成员。
  const zhipuKeys = new ZhipuKeyPool(ctx.credentials, async () => {
    const section = ctx.settings.get(settingsNamespace('llm-pi-ai')) as { providers?: Record<string, { apiKeyEnv?: unknown }> } | undefined
    return resolveZhipuPrimaryKeyName(section, zhipuConfig.apiKeyEnv)
  }, {
    load: () => getSettings<{ keys: ZhipuKeyEntry[] }>(getDb(), 'zhipu-key-pool')?.keys,
    save: (entries) => putSettings(getDb(), 'zhipu-key-pool', { keys: entries }),
  }, [zhipuConfig.apiKeyEnv])
  const zhipuService = new ZhipuCodingPlanService(ctx, zhipuConfig, zhipuKeys)
  const minimaxService = new MiniMaxService(ctx, minimaxConfig)
  const arkService = new ArkCodingPlanService(ctx, arkConfig)
  const openAiService = new OpenAiGatewayService(ctx, openAiConfig)
  const siliconFlowConfig: SiliconFlowCapabilityConfig = { enabled: true, apiKeyEnv: 'SILICONFLOW_API_KEY', timeoutMs: 15000 }
  const siliconFlowService = new SiliconFlowService(ctx, siliconFlowConfig)
  // MCP 服务器接入：官方 dsh-mcp-client 桥的挂载管理者（fiber 集随 store.db 配置 reconcile）。
  const mcpService = new McpService(ctx, () => resolve().mcp?.enabled !== false)

  // ---- 启动自动补齐：llm-pi-ai 就绪后把官方模型与推理档位写入设置；无变化时不产生写入。----
  let autoEnsureToken = 0
  const scheduleAutoEnsureModels = (): void => {
    const token = ++autoEnsureToken
    void (async () => {
      const ensureProviders = [
        () => openAiService.ensureProvider(),
        () => arkService.ensureModels(),
        () => zhipuService.ensureModels(),
        () => zhipuService.ensureOfficialModels(),
        () => minimaxService.ensureModels(),
        () => siliconFlowService.ensureModels(),
      ]
      for (let attempt = 0; attempt < 3; attempt += 1) {
        if (token !== autoEnsureToken) return
        // 各服务商独立结算：某一家无凭据或设置冲突时，不能阻塞其它 Provider 的迁移与补齐。
        const results = await Promise.allSettled(ensureProviders.map(async (ensure) => await ensure()))
        if (results.every((result) => result.status === 'fulfilled')) return
        await new Promise((resolve) => setTimeout(resolve, 5_000))
      }
    })()
  }

  /** 插件更新服务：check 面板数据源 + apply 一键升级（重启仍走 devforge_restart 确认红线）。 */
  const pluginUpdateService = new PluginUpdateService({
    getConfig: () => {
      const value = resolve().pluginUpdate
      return {
        enabled: value?.enabled ?? true,
        profile: value?.profile ?? 'web',
        sources: value?.sources?.length ? value.sources : PLUGIN_UPDATE_DEFAULT_SOURCES,
      }
    },
    readInstalled: createDefaultInstalledReader(),
  })

  /**
   * DSH 本体检查：本机真实安装版本 vs 官方 GitHub Tags（含预发布版本比较）。
   * 只返回检查结果与升级命令引导，绝不代为升级运行中的宿主本体。
   */
  const harnessEntryPath = process.argv[1] ?? ''
  const harnessCheck = (): Promise<HarnessUpdateCheckItem> => {
    return checkHarnessUpdate({ readInstalled: createDefaultHarnessVersionReader(harnessEntryPath), entryPath: harnessEntryPath })
  }

  /** 插件能力总览活表面：sync() 按开关挂/卸，验收路由读取当前注入文本与诊断。 */
  let pluginBriefSurface: ReturnType<typeof activatePluginBrief> = {
    dispose: () => {},
    currentText: () => '',
    diagnostics: () => emptyDiagnostics(),
  }

  // ---- RAG 记忆中枢：三渠道向量化器（凭据每次解析，面板设置即切即用）----
  const ragCredential = (env: string, missing: string) => async (): Promise<string> => {
    const resolved = await ctx.credentials.resolve(credentialRef(env))
    const value = resolved?.value.trim()
    if (value === undefined || value === '') throw new RagEmbeddingError(missing, 400)
    return value
  }
  // 智谱 RAG 凭据：按 Key 池取第一把已配置 Key（主 Key 优先；embeddings/rerank 不做请求级失败切换，见 README 边界）。
  const zhipuPoolCredential = (missing: string) => async (): Promise<string> => {
    try {
      const ordered = await zhipuKeys.ordered()
      return ordered[0].value
    } catch {
      throw new RagEmbeddingError(missing, 400)
    }
  }
  const ragOpenAiCredential = async (): Promise<string> => {
    const openai = resolve().openai
    const env = openai?.endpoints?.[0]?.apiKeyEnv ?? openai?.apiKeyEnv ?? 'OPENAI_GATEWAY_API_KEY'
    return await ragCredential(env, '尚未配置 OpenAI 中转站主端点 API Key（受管凭据引用：' + env + '）。')()
  }
  const ragOpenAiBaseURL = (): string => {
    const openai = resolve().openai
    const baseURL = openai?.endpoints?.[0]?.baseURL ?? openai?.baseURL ?? ''
    // ZhipuEmbedder 的 path 固定为 /v1/embeddings，避免用户填写 /v1 时重复拼接。
    return baseURL.replace(/\/v1\/?$/i, '')
  }
  const ragEmbedders = {
    zhipu: new ZhipuEmbedder(zhipuPoolCredential('尚未配置智谱 API Key（Key 池为空），RAG 向量化不可用。')),
    ark: new ZhipuEmbedder(ragCredential('ARK_CODING_PLAN_API_KEY', '尚未配置方舟 API Key（ARK_CODING_PLAN_API_KEY）。'), { baseURL: 'https://ark.cn-beijing.volces.com/api/v3', path: '/embeddings', model: 'doubao-embedding' }),
    'openai-gateway': new ZhipuEmbedder(ragOpenAiCredential, { baseURLProvider: ragOpenAiBaseURL, path: '/v1/embeddings', model: 'text-embedding-3-small' }),
    // 本地 Ollama：零额度免费无限用（bge-m3 中文 1024 维）；key 占位不影响（Ollama 不校验）。
    ollama: new ZhipuEmbedder(async () => 'ollama-local', { baseURL: 'http://localhost:11434', path: '/v1/embeddings', model: 'bge-m3' }),
    // 自定义 OpenAI 兼容渠道（硅基流动/智谱开放平台/百炼等）：地址与凭据引用名存 rag.settings，
    // 每次请求动态解析（面板即改即用）；凭据本体走受管凭据表，绝不落明文。
    siliconflow: new ZhipuEmbedder(ragCredential('SILICONFLOW_API_KEY', '尚未配置硅基流动 API Key（SILICONFLOW_API_KEY）。'), { baseURL: 'https://api.siliconflow.cn/v1', path: '/embeddings', model: 'BAAI/bge-m3' }),
    custom: new ZhipuEmbedder(
      async () => {
        const stored = (() => { try { return getSettings<RagSettingsPartial>(getDb(), 'rag.settings') } catch { return undefined } })()
        const env = stored?.embedding?.apiKeyEnv?.trim() || 'RAG_CUSTOM_EMBEDDING_API_KEY'
        const resolved = await ctx.credentials.resolve(credentialRef(env))
        const value = resolved?.value.trim()
        if (value === undefined || value === '') throw new RagEmbeddingError('自定义向量渠道未配置 API Key（受管凭据引用：' + env + '）。可在天工造梦面板或凭据写入接口配置。', 400)
        return value
      },
      {
        baseURLProvider: () => { try { return (getSettings<RagSettingsPartial>(getDb(), 'rag.settings')?.embedding?.baseURL ?? '').replace(/\/+$/, '') } catch { return '' } },
        path: '/embeddings',
        model: 'BAAI/bge-m3',
      },
    ),
  }
  const ragStore = new RagStore()
  const ragService = new RagService(ragStore, ragEmbedders)
  const nativeMemory = new NativeMemoryStore(ragStore)
  const memoryGovernance = new MemoryGovernanceService(ragStore, nativeMemory)
  const memoryRecall = new MemoryRecallService(nativeMemory, ragService, ragStore)
  /** 会话 cwd 是作用域唯一可信来源；项目 id 来自 Host 项目登记表。 */
  const memoryScopeOfSession = (session: unknown) => {
    const cwd = (session as { header?: { cwd?: unknown } } | null)?.header?.cwd
    return resolveMemoryScope(typeof cwd === 'string' ? cwd : undefined, listProjects())
  }
  const memoryScopeOfAgent = (agent: unknown) => memoryScopeOfSession((agent as { session?: unknown } | null)?.session)
  // 精排：智谱 rerank 首选，LLM 打分兜底（跟随默认模型路由）；凭据同样走 Key 池第一把。
  ragService.setReranker(new ZhipuReranker(zhipuPoolCredential('尚未配置智谱 API Key（Key 池为空），RAG 精排不可用。')))

  /** 默认模型路由文本生成（记忆提炼/重排打分/工作流共用；凭据由宿主 Provider 体系承载）。
   *  `onFinish` 回传宿主结束原因：只有它能把「被 token 上限截断」和「真的调用失败」区分开，
   *  提炼侧据此自动扩容重试，否则截断中止会被当成模型故障白等下一轮。 */
  const generateText = async (input: { system: string; user: string; maxTokens?: number; provider?: string; model?: string; onFinish?: (reason: string) => void }): Promise<string> => {
    const selectionHost = ctx as unknown as { agentDefaultModel?: { currentSelection?: () => { provider: string; model: string } } }
    const selection = selectionHost.agentDefaultModel?.currentSelection?.()
    const provider = input.provider ?? selection?.provider ?? ''
    const model = input.model ?? selection?.model ?? ''
    if (provider === '' || model === '') throw new Error('无可用模型路由：请先在 DSH 设置中选择默认模型')
    const assembler = new BlockAssembler()
    for await (const chunk of ctx.llm.stream({
      provider,
      model,
      messages: [createUserMessage({ content: [{ type: 'text', text: input.user }], source: { kind: 'plugin', plugin: 'dsh-devforge' } })],
      system: input.system,
      maxTokens: input.maxTokens ?? 800,
    })) assembler.push(chunk)
    const finish = assembler.finish
    input.onFinish?.(finish.kind)
    if (finish.kind === 'error' || finish.kind === 'aborted') {
      const failure = (finish as { failure?: { message?: string } }).failure
      throw new Error('模型调用失败：' + String(failure?.message ?? finish.kind))
    }
    return assembler.blocks().filter((block) => block.type === 'text').map((block) => (block as { text: string }).text).join('')
  }
  ragService.setRerankLlm((system, user) => generateText({ system, user, maxTokens: 500 }))

  /** 记忆提炼单次输出预算（候选 5 条 + task 复盘 JSON）。 */
  const REFLECT_BASE_TOKENS = 700
  /** 被 token 上限截断时的自动扩容倍数：700 → 1600 → 3200，都用满仍失败才交给批次重试。 */
  const REFLECT_TOKEN_STEPS = [1, 2, 4] as const

  /**
   * 记忆提炼/复盘生成：截断自动扩容重试。
   *
   * 硬教训（2026-09-11 生产实况）：MiniMax 等思考型模型输出被 maxTokens 截断时，宿主以
   * "stream ended without a stop reason" 收尾——与真实故障同形。此前写法直接抛错，
   * 沉淀 12 次全失败、任务复盘一条都落不下来。现在按宿主结束原因识别截断并扩容重试，
   * 复盘链路自动恢复，不需要人工换模型。
   */
  const generateReflectionText = async (input: { system: string; user: string; provider?: string; model?: string }): Promise<string> => {
    let lastError: unknown
    for (const step of REFLECT_TOKEN_STEPS) {
      let finishReason = ''
      try {
        return await generateText({ ...input, maxTokens: REFLECT_BASE_TOKENS * step, onFinish: (reason) => { finishReason = reason } })
      } catch (error) {
        lastError = error
        // 只有「被 token 上限截断」才值得扩容重试；真实调用故障直接交给批次重试，避免三倍空跑。
        if (finishReason !== '' && finishReason !== 'max-tokens' && finishReason !== 'length') throw error
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError))
  }

  // ---- 会话记忆层：沉淀（turn/end）+ 主动注入（agent/pre-step）----
  const memorySettingsRead = (): MemorySettings => {
    try {
      const stored = getSettings(getDb(), 'memory.settings')
      return normalizeMemorySettings(stored, DEFAULT_MEMORY_SETTINGS)
    } catch { return DEFAULT_MEMORY_SETTINGS }
  }
  const memorySettingsWrite = (next: MemorySettings): void => { putSettings(getDb(), 'memory.settings', next) }
  // 用户身份卡（settings 域 memory.profile）：常驻注入的动态数据源，面板保存即时生效。
  const memoryProfileRead = (): MemoryUserProfile => {
    try {
      const stored = getSettings(getDb(), 'memory.profile')
      return normalizeUserProfile(stored, DEFAULT_USER_PROFILE)
    } catch { return DEFAULT_USER_PROFILE }
  }
  const memoryProfileWrite = (next: MemoryUserProfile): void => { putSettings(getDb(), 'memory.profile', next) }
  const memoryKbId = (): string => {
    const existing = ragService.listKbs().find((kb) => kb.source === 'memory')
    if (existing !== undefined) return existing.id
    return ragService.createKb('会话记忆库', { source: 'memory', description: '会话自动沉淀的记忆条目（turn/end 驱动提炼）' }).id
  }
  // 持久化统计：沉淀/注入累计口径跨重启，修复"计数器内存态重启清零"的可观测缺陷。
  const memoryStats = new MemoryStatsStore(ragService, memoryKbId)
  const sediment = new MemorySedimentService(ragService, memoryKbId, (system, user) => {
    // 沉淀路由可独立配置（0.26.6）：全局默认路由故障（503 等）时，面板指到健康模型即可，不再被聊天路由绑架。
    const route = memorySettingsRead()
    // token 预算与截断扩容重试都在 generateReflectionText 内部（0.29.4）：复盘不能因一次截断整批作废。
    return generateReflectionText({ system, user, ...(route.sedimentProvider !== '' ? { provider: route.sedimentProvider } : {}), ...(route.sedimentModel !== '' ? { model: route.sedimentModel } : {}) })
  }, () => {
    const settings = memorySettingsRead()
    return { ...settings, enabled: settings.enabled && resolve().memory?.enabled !== false }
  }, nativeMemory, memoryStats, { governance: memoryGovernance, scopeOf: memoryScopeOfSession })
  const injection = new MemoryInjectionService(ragService, () => {
    const settings = memorySettingsRead()
    return { ...settings, enabled: settings.enabled && resolve().memory?.enabled !== false }
  }, nativeMemory, memoryStats, { recall: memoryRecall, governance: memoryGovernance, scopeOfAgent: memoryScopeOfAgent })

  // ---- 记忆库做梦整理：静默窗口触发的合并/归档，审计落 store.db memory.dreamrun 域 ----
  const dream = new MemoryDreamService({
    native: nativeMemory,
    // generateText 已支持 provider/model 覆盖：做梦路由可独立于会话默认模型（裁决不被聊天路由牵连）。
    generate: generateText,
    config: () => {
      const settings = memorySettingsRead()
      return { ...settings, enabled: settings.enabled && resolve().memory?.enabled !== false }
    },
    log: (message) => ctx.logger.info(message),
    listDomain: (domain) => ragStore.listDomainDocs(domain),
    putDomain: (domain, id, data) => ragStore.putDomainDoc(domain, id, data),
    deleteDomain: (domain, id) => ragStore.deleteDomainDoc(domain, id),
    // 做梦只生成治理建议；模型不能直接改写、合并或归档可信事实。
    proposalOnly: true,
  })
  // 运行完成回写持久化统计（面板做梦卡片展示口径；含失败，便于发现"做梦一直失败"）。
  dream.onRunFinished = (run) => {
    const summary = run.status === 'failed'
      ? '失败：' + (run.error ?? '未知原因')
      : run.status === 'skipped'
        ? (run.error ?? '未达触发条件')
        : run.proposals !== undefined
          ? '快照 ' + run.snapshot + ' 条，产生治理建议 ' + run.proposals.length + ' 条（仅建议不落库，等待人工审核）' + (run.retried === true ? '（解析重试后成功）' : '')
          : '快照 ' + run.snapshot + ' 条，归档 ' + run.archived + '，合并 ' + run.merged + ' 组，修订 ' + run.updated + '，跳过 ' + run.skipped.length + (run.retried === true ? '（解析重试后成功）' : '')
    memoryStats.update((prev) => ({ ...prev, dreamTotal: prev.dreamTotal + 1, lastDreamAt: run.finishedAt, lastDreamStatus: run.status, lastDreamSummary: summary.slice(0, 200) }))
  }
  dream.start()
  ctx.effect(() => () => dream.dispose(), 'dsh-devforge: memory dream')

  // ---- 工作流引擎（rag.workflow / rag.workflow_run 域存储 + 默认模型生成）----
  const workflowEngine = new WorkflowEngine(ragService, {
    listDomain: (domain) => ragStore.listDomainDocs(domain),
    putDomain: (domain, id, data) => ragStore.putDomainDoc(domain, id, data),
    deleteDomain: (domain, id) => ragStore.deleteDomainDoc(domain, id),
  }, (input) => generateText({ system: input.system, user: input.user, ...(input.maxTokens !== undefined ? { maxTokens: input.maxTokens } : {}), ...(input.provider !== undefined ? { provider: input.provider } : {}), ...(input.model !== undefined ? { model: input.model } : {}) }))

  // ---- 主脑路由（0.26.0）：GPT 系列主模型只当大脑，其委派的子代理改道工人模型 ----
  // 设置节与委派拦截只装一次（拦截器每次委派实时读设置，改面板设置即时生效，
  // 与 sync 热更新解耦）；safeActivate 兜底保证单点失败不拖垮插件其余能力。
  let brainRouterRead: () => BrainRouterSettings = () => ({ ...BRAIN_ROUTER_DEFAULTS })
  let brainRouterWrapperInstalled = false
  safeActivate(ctx, '主脑路由设置节', () => { brainRouterRead = installBrainRouterSection(ctx) })
  safeActivate(ctx, '主脑路由拦截', () => { brainRouterWrapperInstalled = installBrainRouterWrapper(ctx, brainRouterRead) })
  // 主脑纪律（0.26.2）：路由启用时注入分工约定——主模型只规划/指挥/验收，
  // 实现类操作一律委派 subagent。text 动态求值：面板开关路由即时生效，无需重启。
  safeActivate(ctx, '主脑纪律注入', () => {
    ctx.systemPrompt.section({
      name: BRAIN_ROUTER_DISCIPLINE_SECTION_NAME,
      order: BRAIN_ROUTER_DISCIPLINE_SECTION_ORDER,
      text: () => (brainRouterRead().enabled ? BRAIN_ROUTER_DISCIPLINE_TEXT : ''),
    })
  })

  // ---- 可重挂表面（路由/工具/系统提示）----
  // 远程引擎引用（activateRemote 赋值；一键发布请求时经闭包延迟解引用，复用同一连接池）。
  let remoteActivation: ReturnType<typeof activateRemote> | undefined
  const douyinLive = new DouyinLiveService({
    store: douyinLiveStore,
    log: (message) => ctx.logger.info(message),
    receiver: new DouyinReceiverProcess({ log: (message) => ctx.logger.info(message) }),
  })
  ctx.effect(() => () => douyinLive.dispose(), 'dsh-devforge: douyin live')
  const routes = [
    ...makeDouyinLiveRoutes(douyinLive),
    ...makeRoutes(engine, standards, restartManager, () => ({
      enabled: resolve().pluginBrief?.enabled ?? true,
      text: pluginBriefSurface.currentText(),
      diag: pluginBriefSurface.diagnostics(),
    }), {
      check: () => pluginUpdateService.check(),
      apply: (packageName: string) => pluginUpdateService.apply(packageName),
      harnessCheck: () => harnessCheck(),
    }, {
      run: async (id: string) => {
        const entry = listProjects().find((project) => project.id === id)
        if (entry === undefined) return { ok: false, results: [], error: 'unknown project: ' + id }
        return runProjectDeploy(entry, { ssh: remoteActivation?.sshEngine, winrm: remoteActivation?.winrmEngine })
      },
    }),
    ...makeRemoteRoutes(remoteRegistry, new SshHostStore(), new WinrmHostStore()),
    // 智谱、MiniMax、火山方舟与运营浏览器的面板路由常驻基础路由组；未启用的能力返回明确 JSON 提示。
    ...makeZhipuRoutes(zhipuService),
    ...makeMiniMaxRoutes(minimaxService),
    ...makeArkRoutes(arkService),
    ...makeOpenAiRoutes(openAiService),
    ...makeSiliconFlowRoutes(siliconFlowService),
    ...makeCredentialsRoutes(),
    ...makeBackupRoutes(),
    ...makeBrowserRoutes(browserHolder),
    ...makeRagRoutes(ragService, ragEmbedders),
    ...makeMemoryRoutes({ rag: ragService, sediment, injection, stats: memoryStats, getSettings: memorySettingsRead, putSettings: memorySettingsWrite, getProfile: memoryProfileRead, putProfile: memoryProfileWrite, native: nativeMemory, governance: memoryGovernance, dream }),
    ...makeWorkflowRoutes(workflowEngine),
    ...makeMcpRoutes(mcpService),
    // 主脑路由（0.26.0）：面板读写设置 + 模型目录；委派拦截在 apply 阶段一次性挂载。
    ...makeBrainRouterRoutes({
      read: () => brainRouterRead(),
      write: (value) => writeBrainRouterSettings(ctx, value),
      catalog: () => listBrainRouterCatalog(ctx),
      wrapperInstalled: () => brainRouterWrapperInstalled,
    }),
  ]
  const tools = [devforgeJobsTool(engine), devforgeStandardsTool(standards), devforgeRestartTool(restartManager), backupNowTool(), backupStatusTool(), ragSearchTool(ragService), ragRunTool(workflowEngine), memoryManageTool(nativeMemory, { governance: memoryGovernance, scopeOfAgent: memoryScopeOfAgent }), devforgeProjectTool(), devforgeWorkspaceTool()]
  let disposeRoutes: (() => void) | undefined
  let disposeTools: (() => void) | undefined
  let disposeSection: (() => void) | undefined
  let disposeRemote: (() => void) | undefined
  let disposeGithub: (() => void) | undefined
  let disposeCnb: (() => void) | undefined
  let disposeFeishu: (() => void) | undefined
  let disposeZhipuMcp: (() => void) | undefined
  let disposeMiniMaxTools: (() => void) | undefined
  let disposeMiniMaxHubTools: (() => void) | undefined
  let disposeOpenAiTools: (() => void) | undefined
  let disposeBrowser: (() => void) | undefined
  let disposeConstraints: (() => void) | undefined
  let disposeSandboxDiscipline: (() => void) | undefined
  let disposeUserProfile: (() => void) | undefined
  /** CNB 备份定时调度器（配置保存时经 restart() 重载节拍）。 */
  const backupScheduler = new BackupScheduler({ log: ctx.logger })

  const sync = (): void => {
    autoEnsureToken += 1 // 取消尚未完成的自动补齐，避免与最新配置竞争。
    // 先卸旧（热更新安全）
    disposeSection?.(); disposeSection = undefined
    disposeRoutes?.(); disposeRoutes = undefined
    disposeTools?.(); disposeTools = undefined
    disposeRemote?.(); disposeRemote = undefined
    disposeGithub?.(); disposeGithub = undefined
    disposeCnb?.(); disposeCnb = undefined
    disposeFeishu?.(); disposeFeishu = undefined
    disposeZhipuMcp?.(); disposeZhipuMcp = undefined
    disposeMiniMaxTools?.(); disposeMiniMaxTools = undefined
    disposeMiniMaxHubTools?.(); disposeMiniMaxHubTools = undefined
    disposeOpenAiTools?.(); disposeOpenAiTools = undefined
    disposeBrowser?.(); disposeBrowser = undefined
    disposeConstraints?.(); disposeConstraints = undefined
    disposeSandboxDiscipline?.(); disposeSandboxDiscipline = undefined
    disposeUserProfile?.(); disposeUserProfile = undefined
    pluginBriefSurface.dispose()
    pluginBriefSurface = {
      dispose: () => {},
      currentText: () => '',
      diagnostics: () => emptyDiagnostics(),
    }
    backupScheduler.stop()
    // 本地浏览器能力随每次同步重建，先断开常驻路由的句柄。
    browserApi = undefined
    const value = resolve()
    if (!value.enabled) { douyinLive.dispose(); return }
    // 统一 SQLite 存储：一次性把旧 JSON 数据文件迁入 devforge/store.db（幂等；
    // 旧文件归档为 *.migrated.bak 可回滚），并把 coding plan 凭据镜像进库供整体备份。
    try {
      const migration = migrateFromLegacyFiles(getDb())
      if (migration.imported.length > 0) {
        ctx.logger.info('[dsh-devforge] 旧数据文件已迁入 SQLite：%s（已归档 .migrated.bak）', migration.imported.join(', '))
      }
    } catch (error) {
      // 迁移失败不阻塞插件启动：store 仍会从空库开始，旧文件保留待下次重试。
      ctx.logger.warn('[dsh-devforge] SQLite 迁移失败（不影响启动，旧文件保留）：%s', error instanceof Error ? error.message : String(error))
    }
    // CNB 备份调度：enabled 才启动；含启动补跑（距上次推送超间隔立即执行）
    safeActivate(ctx, 'CNB 备份调度', () => backupScheduler.restart())
    if (value.announceToAgent) {
      disposeSection = ctx.systemPrompt.section({ name: 'plugin:dsh-devforge', order: SECTION_ORDER, text: DEVFORGE_GUIDANCE })
    }
    // 沙箱升级纪律常驻节（0.20.0）：OpenAI 兼容模型误用 sandbox_permissions /
    // justification 会触发 "not strictly wider"/"invalid justification" 死循环，
    // 把宿主沙箱的精确规则（升级阶梯/成对校验/拒绝即终局）注入全部会话。始终开启。
    disposeSandboxDiscipline = ctx.systemPrompt.section({
      name: SANDBOX_DISCIPLINE_SECTION_NAME,
      order: SANDBOX_DISCIPLINE_SECTION_ORDER,
      text: SANDBOX_DISCIPLINE_TEXT,
    })
    // 项目约束三层注入：常驻摘要保底；cwd 命中开发仓库或出现开发动作时升级全文（0.11.0）。
    // 0.19.0 起同一节追加产出公约摘要与当前项目卡（数据源带 5s TTL 缓存，避免每次装配读库）。
    if (value.constraints?.enabled) {
      disposeConstraints = ctx.effect(() => {
        const service = new ConstraintInjectionService()
        // 项目清单与公约摘要的 5 秒缓存：系统提示装配频繁，库读 KB 级但无需每次进行。
        let projectsCache: { at: number; value: ReturnType<typeof listProjects> } | undefined
        let conventionCache: { at: number; value: string } | undefined
        const sources = {
          getProjects: () => {
            if (projectsCache === undefined || Date.now() - projectsCache.at > 5000) {
              projectsCache = { at: Date.now(), value: listProjects() }
            }
            return projectsCache.value
          },
          getConventionText: () => {
            if (conventionCache === undefined || Date.now() - conventionCache.at > 5000) {
              conventionCache = { at: Date.now(), value: renderConventionSummary(getConvention()) }
            }
            return conventionCache.value
          },
        }
        safeActivate(ctx, '项目约束注入', () => service.start(ctx, () => {
          // 每次装配动态求值：配置热更新即时生效；局部变量保证可选链收窄。
          const constraints = resolve().constraints
          return {
            enabled: constraints?.enabled ?? true,
            fullTextPaths: constraints?.fullTextPaths?.length ? constraints.fullTextPaths : CONSTRAINTS_DEFAULT_PATHS,
          }
        }, sources))
        return () => service.dispose()
      }, 'dsh-devforge: constraints')
    }
    // 用户身份卡常驻注入（0.17.10）：身份/称呼/习惯挂每轮系统提示，先于项目约束（order 50 < 80）；
    // section 文本动态求值，面板保存身份卡即时生效，无需重启。
    disposeUserProfile = ctx.effect(() => {
      const service = new UserProfileInjectionService()
      safeActivate(ctx, '用户身份卡注入', () => service.start(ctx, memoryProfileRead))
      return () => service.dispose()
    }, 'dsh-devforge: user-profile')
    // 已安装插件功能总览：自动枚举 Loader 用户插件并把功能说明注入上下文（0.12.0）。
    safeActivate(ctx, '插件能力总览注入', () => {
      pluginBriefSurface = activatePluginBrief(ctx, () => {
        const brief = resolve().pluginBrief
        return { enabled: brief?.enabled ?? true }
      })
    })
    disposeRoutes = ctx.effect(() => {
      const disposers = routes.map((route) => ctx.webServer.register(route))
      return () => { for (const dispose of disposers) dispose() }
    }, 'dsh-devforge: routes')
    disposeTools = ctx.effect(() => {
      const disposers = tools.map((tool) => ctx.tools.register(tool))
      return () => { for (const dispose of disposers) dispose() }
    }, 'dsh-devforge: tools')
    // 远程运维兼容接管：注册 ssh_*/winrm_* 工具与 /api/dsh-ssh、/api/dsh-winrm 前缀。
    // 切换窗口期与旧插件互斥（同一路由前缀/工具名重复注册会冲突），切换前保持关闭。
    // 本地浏览器能力独立于远程运维，直接挂载在宿主进程。
    // capability 开关同步到常驻路由的活配置；智谱凭据按请求解析，不缓存 Key。
    Object.assign(zhipuConfig, value.zhipu)
    Object.assign(minimaxConfig, value.minimax)
    Object.assign(arkConfig, value.ark)
    Object.assign(openAiConfig, value.openai)
    Object.assign(siliconFlowConfig, value.siliconflow)
    // 必须等所有能力配置同步完成后再异步迁移/补齐；提前启动会被本段默认值覆盖。
    scheduleAutoEnsureModels()
    // OpenAI 中转站只注册一个全局 generate_image；聊天协议继续由 llm-pi-ai 承载。
    safeActivate(ctx, 'OpenAI 生图工具', () => { disposeOpenAiTools = activateOpenAiGenerateImage(ctx, { enabled: value.enabled === true && value.openai?.enabled !== false }, openAiService).dispose })
    // MiniMax 官方工具：联网搜索/图像理解，凭据走受管引用，绝不落明文。
    safeActivate(ctx, 'MiniMax 官方工具', () => {
      disposeMiniMaxTools = activateMiniMaxTools(ctx, {
        enabled: value.enabled === true && value.minimax?.tools !== false,
        apiKeyEnv: value.minimax?.apiKeyEnv ?? 'MINIMAX_CN_API_KEY',
        timeoutMs: Math.max(value.minimax?.timeoutMs ?? 30000, 10000),
      }, async () => {
        const resolved = await ctx.credentials.resolve(credentialRef(value.minimax?.apiKeyEnv ?? 'MINIMAX_CN_API_KEY'))
        const apiKeyValue = resolved?.value.trim() ?? ''
        if (apiKeyValue === '') throw new Error('尚未配置 MiniMax Coding Plan API Key，无法调用官方工具。')
        return apiKeyValue
      }).dispose
    })
    // MiniMax Hub 桌面端 Gateway 工具：调用视频/图像，复用 Hub 客户端已登录账号，无需受管凭据。
    safeActivate(ctx, 'MiniMax Hub 工具', () => {
      disposeMiniMaxHubTools = activateMiniMaxHubTools(ctx, {
        enabled: value.enabled === true && value.minimax?.hub !== false,
        ...(typeof value.minimax?.hubGatewayURL === 'string' && value.minimax.hubGatewayURL !== ''
          ? { gatewayURL: value.minimax.hubGatewayURL }
          : {}),
      }).dispose
    })
    // 智谱官方 MCP 工具：联网搜索/网页读取/Zread，凭据走 Key 池（401/403/429 自动换下一把），绝不落明文。
    safeActivate(ctx, '智谱 MCP 工具', () => {
      disposeZhipuMcp = activateZhipuMcpTools(ctx, { enabled: value.enabled === true && value.zhipu?.mcpTools !== false, timeoutMs: Math.max(value.zhipu?.timeoutMs ?? 15000, 30000) }, async (attempt) => {
        const picked = await zhipuKeys.resolveByAttempt(attempt)
        return picked.value
      }).dispose
    })
    safeActivate(ctx, '远程运维', () => {
      remoteActivation = activateRemote(ctx, value.remote ?? { enabled: false })
      disposeRemote = remoteActivation.dispose
    })
    // 本地浏览器：独立于远程运维，启用即注册 browser_* 工具。
    safeActivate(ctx, '本地浏览器', () => {
      const browserActivation = activateBrowser(ctx, {
        enabled: value.enabled === true && value.browser?.enabled === true,
        headless: value.browser?.headless === true,
        channel: value.browser?.channel ?? 'chrome',
        profileDir: value.browser?.profileDir ?? '',
        timeoutMs: value.browser?.timeoutMs ?? 45000,
      })
      browserApi = browserActivation.browser
      disposeBrowser = browserActivation.dispose
    })
    // GitHub 兼容接管：注册 github_* 工具与 /api/dsh-github 前缀；与旧插件互斥。
    safeActivate(ctx, 'GitHub 托管', () => { disposeGithub = activateGithub(ctx, resolve().github ?? { enabled: false }).dispose })
    // CNB 代码托管：注册 cnb_* 工具与 /api/dsh-cnb 前缀（与 GitHub 能力并列，互不影响）。
    safeActivate(ctx, 'CNB 托管', () => { disposeCnb = activateCnb(ctx, resolve().cnb ?? { enabled: false }).dispose })
    // 飞书兼容接管：单 WSClient 铁律——切换期间旧 dsh-feishu 必须先禁用再启用这里。
    safeActivate(ctx, '飞书桥', () => { disposeFeishu = activateFeishu(ctx, resolve().feishu ?? { enabled: false }).dispose })
    // MCP 服务器接入：按 store.db 配置对齐官方桥 fiber（关闭即全部卸载；reconcile 幂等，热更新不打断在用连接）。
    safeActivate(ctx, 'MCP 服务器接入', () => { mcpService.activateHandle() })
  }

  // ---- 设置面板接线（改配置即热更新）----
  scheduleSectionReadinessCheck(ctx)
  installSettingsSection(ctx, DEVFORGE_SETTINGS_NAMESPACE, Config, config ?? {}, {
    // schemastery 嵌套 object 的快照含 null 字段；规整成 Config 视图（?? 兜底）再交给 resolve()。
    setSource: (raw) => {
      const source = (): Config => {
        const value = raw() as Config & { remote?: { enabled?: boolean | null }; browser?: { enabled?: boolean | null; headless?: boolean | null; channel?: string | null; profileDir?: string | null; timeoutMs?: number | null }; github?: { enabled?: boolean | null }; cnb?: { enabled?: boolean | null }; feishu?: { enabled?: boolean | null }; zhipu?: { enabled?: boolean | null; apiKeyEnv?: string | null; timeoutMs?: number | null; officialApiKeyEnv?: string | null } }
        return {
          enabled: value.enabled ?? undefined,
          announceToAgent: value.announceToAgent ?? undefined,
          // 子能力开关：未配置一律 false（安全默认），与 resolve() 兜底一致。
          remote: { enabled: value.remote?.enabled === true },
          browser: {
            enabled: value.browser?.enabled === true,
            headless: value.browser?.headless === true,
            channel: value.browser?.channel ?? 'chrome',
            profileDir: value.browser?.profileDir ?? '',
            timeoutMs: value.browser?.timeoutMs ?? 45000,
          },
          github: { enabled: value.github?.enabled === true },
          cnb: { enabled: value.cnb?.enabled === true },
          feishu: { enabled: value.feishu?.enabled === true },
          zhipu: {
            enabled: value.zhipu?.enabled !== false,
            apiKeyEnv: value.zhipu?.apiKeyEnv ?? 'ZAI_CODING_CN_API_KEY',
            timeoutMs: value.zhipu?.timeoutMs ?? 15000,
            mcpTools: value.zhipu?.mcpTools !== false,
            officialApiKeyEnv: value.zhipu?.officialApiKeyEnv ?? 'ZHIPU_OFFICIAL_API_KEY',
          },
          minimax: {
            enabled: value.minimax?.enabled !== false,
            apiKeyEnv: value.minimax?.apiKeyEnv ?? 'MINIMAX_CN_API_KEY',
            timeoutMs: value.minimax?.timeoutMs ?? 30000,
            tools: value.minimax?.tools !== false,
          },
          ark: {
            enabled: value.ark?.enabled !== false,
            apiKeyEnv: value.ark?.apiKeyEnv ?? 'ARK_CODING_PLAN_API_KEY',
            usageAccessKeyEnv: value.ark?.usageAccessKeyEnv ?? 'VOLC_ACCESS_KEY',
            usageSecretKeyEnv: value.ark?.usageSecretKeyEnv ?? 'VOLC_SECRET_KEY',
            usageTimeoutMs: value.ark?.usageTimeoutMs ?? 15000,
          },
          openai: {
            enabled: value.openai?.enabled !== false,
            baseURL: value.openai?.baseURL ?? '',
            apiKeyEnv: value.openai?.apiKeyEnv ?? 'OPENAI_GATEWAY_API_KEY',
            imageModel: value.openai?.imageModel ?? '',
            endpoints: value.openai?.endpoints ?? [],
            timeoutMs: value.openai?.timeoutMs ?? 300000,
          },
        }
      }
      current = source
      sync()
    },
    onChange: sync,
  })

  // 会话记忆层：事件监听一次挂载；配置开关在每次事件时动态求值（store.db settings）。
  safeActivate(ctx, '会话记忆层', () => {
    sediment.attach(ctx)
    const offInject = injection.attach(ctx)
    ctx.effect(() => () => { sediment.dispose(); offInject() }, 'dsh-devforge: memory')
  })

  // 首次挂载
  sync()

  // 事件订阅兜底（engine 内部也订阅，这里幂等安全）
  ctx.effect(() => () => { /* 预留全局清理 */ }, 'dsh-devforge: lifecycle')

  // 导出围栏工具供测试（非公开 API）
  void isLoopbackRequest
}
