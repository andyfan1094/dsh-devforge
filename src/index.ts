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
import { installSettingsSection, readSettingsSection, settingsNamespace } from './settings-compat.ts'
import z from 'schemastery'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-tools'
import { DEFAULT_FORGE_AGENT_PRESET, ForgeEngine, type ForgeHostServices } from './forge.ts'
import { isLoopbackRequest } from './loopback.ts'
import { activateFeishu, type FeishuCapabilityConfig } from './feishu/activate.ts'
import { activateGithub, type GithubCapabilityConfig } from './github/activate.ts'
import { activateCnb, type CnbCapabilityConfig } from './cnb/activate.ts'
import { activateRemote, type RemoteConfig } from './remote/activate.ts'
import { startRemoteGateway, type RemoteGateway } from './remote-gateway.ts'
import { makeGatewayRoutes, gatewayAccessUrls } from './remote/gateway-routes.ts'
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
import { readAgentPreset250kStatus, setupAgentPreset250k } from './agent-preset-250k.ts'
import { RagService } from './rag/service.ts'
import { RagStore } from './rag/rag-store.ts'
import { RagEmbeddingError, ZhipuEmbedder } from './rag/embedder.ts'
import { ZhipuReranker } from './rag/rerank.ts'
import { MemoryDreamService } from './memory/dream.ts'
import { MemorySedimentService } from './memory/sediment.ts'
import { generateReflectionWithTokenSteps } from './memory/reflect.ts'
import { MemoryStatsStore } from './memory/stats.ts'
import { MemoryInjectionService } from './memory/inject.ts'
import { MemoryGovernanceService } from './memory/governance.ts'
import { MemoryRecallService } from './memory/recall.ts'
import { formatMemoryRoute, MEMORY_ROUTE_NO_DEFAULT, mergeRegisteredCatalog, modelCatalogFromSection, resolveMemoryModelRoute, type MemoryModelRoute } from './memory/model-route.ts'
import { resolveMemoryScope } from './memory/scope.ts'
import { NativeMemoryStore } from './memory/native.ts'
import { memoryManageTool } from './memory/tools.ts'
import { UserProfileInjectionService, DEFAULT_USER_PROFILE, normalizeUserProfile, type MemoryUserProfile } from './memory/profile.ts'
import { DEFAULT_MEMORY_SETTINGS, makeMemoryRoutes, normalizeMemorySettings, type MemorySettings } from './memory/routes.ts'
import { WorkflowEngine } from './workflow/engine.ts'
import { makeWorkflowRoutes } from './workflow/routes.ts'
import { McpService } from './mcp/service.ts'
import { makeMcpRoutes } from './mcp/routes.ts'
import { makeDbAdminRoutes } from './store/dbadmin-routes.ts'
import { devforgeDbTools } from './store/agent-tools.ts'
import { CredentialSyncService } from './store/credential-sync.ts'
import { modagentaiWebTools } from './modagentai/tools.ts'
import { makeModelCatalogRoute } from './model-catalog.ts'
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
import { MirrorSyncScheduler, normalizeMirrorSyncSettings } from './rag/mirror-sync.ts'
import { activateBrowser, type BrowserActivation } from './browser/activate.ts'
import type { BrowserStatus } from './browser/protocol.ts'
import { makeBrowserRoutes, makeBrowserSettingsRoutes } from './browser/routes.ts'
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
import { makeModagentaiRoutes } from './modagentai/routes.ts'
import { ModagentaiService } from './modagentai/service.ts'
import { activateOpenAiGenerateImage } from './openai/tools.ts'
import { makeCredentialsRoutes } from './credentials-routes.ts'
import { DshWebRestartManager } from './restart.ts'
import { DesignStore } from './design.ts'
import { StandardsStore } from './standards.ts'
import { devforgeDesignTool, devforgeJobsTool, devforgeRestartTool, devforgeStandardsTool } from './tools.ts'
import { devforgeProjectTool } from './projects/tools.ts'
import { runProjectDeploy } from './projects/deploy.ts'
import { runProjectProbe } from './projects/probe.ts'
import { devforgeWorkspaceTool } from './workspace/tools.ts'
import { getConvention, renderConventionSummary } from './workspace/convention.ts'
import { listProjects } from './projects/store.ts'
import { startProjectAutoRegister } from './projects/auto-register.ts'
import type { ProjectEntry } from './projects/protocol.ts'
import { CONSTRAINTS_DEFAULT_PATHS, ConstraintInjectionService, type ConstraintsConfig } from './constraints.ts'
import { SANDBOX_DISCIPLINE_SECTION_NAME, SANDBOX_DISCIPLINE_SECTION_ORDER, SANDBOX_DISCIPLINE_TEXT } from './sandbox-discipline.ts'
import { MEMORY_WORKFLOW_SECTION_NAME, MEMORY_WORKFLOW_SECTION_ORDER, MEMORY_WORKFLOW_TEXT } from './memory/workflow-discipline.ts'
import { createEffectiveModeResolver, installSandboxEscalationGuard, type SandboxEscalationGuardContext, type SandboxPolicyContext } from './sandbox-escalation-guard.ts'
import { createGuardTracer, defaultGuardTraceFile, type GuardTraceEntry } from './sandbox-guard-trace.ts'
import { activatePluginBrief, emptyDiagnostics, type PluginBriefConfig } from './plugin-brief.ts'
import { createDefaultInstalledReader, PluginUpdateService, PLUGIN_UPDATE_DEFAULT_SOURCES, PLUGIN_UPDATE_DEFAULT_SITE_API, applySitePatch, toSiteView, type PluginUpdateSiteConfig, type PluginUpdateSitePatch, type PluginUpdateSiteView } from './plugin-update.ts'
// 停机安全定时器：桌面端安装更新要求 Host 在 10 秒内退出，等待必须 unref 且可取消（0.41.14）。
import { createTimerScope, type TimerScope } from './shutdown-timers.ts'
import { applyHarnessUpdate, checkHarnessUpdate, createDefaultHarnessVersionReader, type HarnessUpdateCheckItem } from './harness-update.ts'
import { DEVFORGE_SOURCE_KIND } from './session-source.ts'

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
  /** 服务生成子代理使用的 Agent 预设；默认使用 cordis-250k 压缩预设。 */
  forgeAgentPreset?: string
  /** 远程运维（SSH/WinRM 兼容接管）子配置。 */
  remote?: RemoteConfig
  /** 本地浏览器（Playwright MCP）子配置。 */
  browser?: { enabled?: boolean; publish?: boolean; headless?: boolean; channel?: string; profileDir?: string; timeoutMs?: number }
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
  siliconflow?: { enabled?: boolean; apiKeyEnv?: string; timeoutMs?: number; syncChatModels?: boolean }
  /** MCP 服务器接入子配置（服务器明细存 store.db 面板管理，此处仅总开关）。 */
  mcp?: { enabled?: boolean }
  /** 远程访问网关子配置（0.41.0）：面板配置开关+端口+密码，员工浏览器即可访问本机 DSH Web。 */
  remoteAccess?: { enabled?: boolean; port?: number; host?: string; password?: string; upstreamPort?: number; sessionHours?: number }
}

/** 配置默认值。 */
const DEFAULTS = { enabled: true, announceToAgent: true, forgeAgentPreset: DEFAULT_FORGE_AGENT_PRESET }

/** schemastery 配置模式（设置面板自动生成）。 */
export const Config = z.object({
  enabled: z.boolean().default(true).description('插件总开关'),
  announceToAgent: z.boolean().default(true).description('向 Agent 通报插件能力'),
  forgeAgentPreset: z.string().default('cordis-250k').description('服务生成子代理的 Agent 预设；缺失时回退到 cordis'),
  remote: z.object({
    enabled: z.boolean().default(true).description('远程运维（SSH/WinRM 兼容接管）开关'),
  }).description('远程运维配置'),
  browser: z.object({
    enabled: z.boolean().default(true).description('本地浏览器控制开关（默认开启：新装用户开箱即可用，可在面板「本地浏览器」页关闭）'),
    publish: z.boolean().default(false).description('闲鱼/小红书发布类工具开关（默认关闭：会真实发布内容，需在面板「本地浏览器」页显式开启）'),
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
    mcpTools: z.boolean().default(true).description('官方 MCP 工具：网页读取/Zread（联网搜索类已下架）'),
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
    syncChatModels: z.boolean().default(true).description('同步对话模型目录；关闭后进入只嵌入模式（启动补齐与手动同步全部冻结目录，仅保留 bge-m3 向量用途）'),
  }).description('硅基流动配置'),
  mcp: z.object({
    enabled: z.boolean().default(true).description('MCP 服务器接入总开关：按 store.db 配置把外部 MCP 服务器的工具注册给模型（明细在天工造梦「MCP」页管理）'),
  }).description('MCP 服务器接入配置'),
  remoteAccess: z.object({
    enabled: z.boolean().default(false).description('远程访问网关开关（默认关：关闭时外部完全不可达）'),
    port: z.number().min(1024).max(65535).default(19390).description('网关对外端口（员工浏览器访问端口）'),
    host: z.string().default('0.0.0.0').description('网关监听地址（0.0.0.0=��有网卡；127.0.0.1=仅本机调试）'),
    password: z.string().default('').description('访问密码（留空视为未配置，网关不会启动）'),
    upstreamPort: z.number().min(1024).max(65535).default(3080).description('转发目标：本机 DSH Web 端口'),
    sessionHours: z.number().min(1).max(168).default(12).description('登录会话有效期（小时）'),
  }).description('远程访问网关：员工浏览器输密码即可访问本机 DSH Web（密码连错 5 次锁 1 分钟）'),
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
  '- zhipu_web_reader / zhipu_zread_read_file / zhipu_zread_repo_structure：智谱 GLM Coding Plan 官方 MCP 工具（网页读取/开源仓库解读；联网搜索类已按辉哥 2026-10-07 要求下架，联网检索一律用天工造梦联网搜索 modagentai_web_search），消耗套餐每月 MCP 额度；Coding Plan 页支持多把 Key（主 Key + 附加槽位），官方调用遇 Key 失效/限流/额度耗尽自动切换。',
  '- minimax_understand_image / minimax_image_generation / minimax_text_to_speech / minimax_video_generation：MiniMax Coding Plan 官方工具（图像理解/图像生成/语音合成/视频生成，图片支持本机路径与 http(s) URL；联网搜索类已按辉哥 2026-09-26 要求下架，搜索一律用天工造梦联网搜索），消耗 MiniMax 套餐额度。',
  '- 火山方舟 Agent Plan：天工造梦的 Coding Plan 页内支持 Plan API Key、官方文本模型池、推理档位，以及用控制面 AK/SK 查询的 5 小时/周/月用量看板。',
  '- OpenAI 中转站：Coding Plan 页内支持多个中转端点、受管 API Key、GET /v1/models 模型发现与聊天路由，并由所选生图模型提供全局 generate_image 工具。',
  '- 硅基流动：Coding Plan 页内支持 API Key、按系列精选最新版对话模型目录同步；记忆中枢可直接使用 BAAI/bge-m3 向量模型，不依赖余额接口。',
  '- CNB 代码托管（cnb.cool，国内）：cnb_auth_add / cnb_auth_list / cnb_auth_test / cnb_repo_list / cnb_clone / cnb_pull / cnb_push / cnb_commit / cnb_status / cnb_auth_remove；平台仅支持 HTTPS+访问令牌（Git 用户名固定 cnb），令牌经临时 HTTP 头注入绝不进 URL，推送默认关闭需在天工造梦设置打开。',
  '- browser_tabs / browser_upload：管理同一可见 Chrome 的多标签页，并安全上传本机图片；多个会话共用持久登录档案。',
  '- xianyu_messages_list / xianyu_conversation_read：在独立消息标签页读取当前登录闲鱼账号的会话与消息；打开未读会话会触发已读状态。',
  '- xianyu_reply：仅在用户明确确认联系人和完整正文后真实发送，confirmation 必须绑定联系人，例如“确认发送给‘张三’”。',
  '- xianyu_publish：在独立发布标签页上传图片、填写商品信息并核验发布结果；真实发布必须传入“确认发布”。',
  '- MCP 服务器接入：外部 MCP 服务器在天工造梦面板「MCP」页配置；启用的服务器其工具以 mcp__<serverName>__<tool> 名称注册（如 mcp__github__create_issue），可直接调用，调用失败如实报错。',
  '- devforge_db_*（schema/query/credential/config/backup_read）：天工造梦数据直达口——服务器密码/主机配置/账号令牌/API Key 全在本机 store.db 与配置文件里，需要凭据时**先查库再动手、不要找用户要**：WinRM 主机密码 SELECT data FROM docs WHERE domain = \'winrm.host\'，SSH 主机密码 domain = \'ssh.host\'，API Key 类凭据用 devforge_db_credential，库外配置（飞书 JSON/备份密码/凭据主存）用 devforge_db_config，CNB 加密备份用 devforge_db_backup_read。',
  '- modagentai_web_search：天工造梦官网联网搜索（本插件唯一联网搜索渠道，需要联网检索时一律优先使用；服务端多渠道自动切换，按次扣钻石约 0.1💎/次）；modagentai_search_quota 查剩余次数。',
].join('\n')

/**
 * 装载沙箱提权参数清洗（0.33.0 起，工具层根治）。
 *
 * GPT/Codex 类模型不管提示词怎么写都会惯性携带 sandbox_permissions / justification，
 * 而宿主校验是硬失败：成对缺失、justification 空白、请求模式不严格更宽
 * （danger-full-access 已是最宽，其 WIDER_MODES 为空表 → 该会话里任何提权请求必然失败）。
 * 模型于是连续报错直至会话作废。这里在 tools/pre-execute 阶段把"可证必然失败"的
 * 提权字段整体剥掉，工具体再也看不到它们：不依赖提示词、不改动 dsh 官方包，
 * 宿主升级不会覆盖本插件。安全网与插件 enabled 开关无关，始终装载。
 *
 * 0.33.1：模式解析改由 createEffectiveModeResolver 承担——0.33.0 在此处把
 * `service.resolve` 解构后调用，丢了 this 绑定，异常被吞成 undefined，
 * 钩子静默走"模式未知则保守放行"分支，一个参数都没剥掉（现象与未修复完全一样）。
 * 同时新增 onKeep 留痕：携带提权字段却被放行也会进日志，静默失效不再可能。
 */
/**
 * 构造清洗留痕出口。
 *
 * 血的教训（0.33.1）：该插件的 inject 里**没有** `logger`，而 cordis 规定访问未声明
 * 服务会抛 "cannot get property ... without inject"。0.33.1 的留痕直接写
 * `ctx.logger.warn(...)`，异常被钩子的 try/catch 吞掉 —— 剥离生效了却一条日志都没有，
 * 又变成盲区。因此这里双通道兜底：官方 logger 优先（结构化），失败则落 console
 * （本插件的 restart.ts 一直这么打，宿主日志里可见），并且每次都另写独立留痕文件。
 */
function makeGuardLogger(ctx: Context, traceFile: string): {
  strip: (line: string, entry: Omit<GuardTraceEntry, 'time' | 'action'>) => void
  keep: (line: string, entry: Omit<GuardTraceEntry, 'time' | 'action'>) => void
} {
  const trace = createGuardTracer(traceFile)
  const emit = (level: 'warn' | 'info', line: string): void => {
    let logged = false
    try {
      const logger = (ctx as unknown as { logger?: Record<string, ((message: string) => void) | undefined> }).logger
      const write = logger?.[level]
      if (typeof write === 'function') {
        write(line)
        logged = true
      }
    } catch {
      // 未声明 logger 时访问会抛错：走 console 兜底，绝不静默。
      logged = false
    }
    if (!logged) {
      try {
        if (level === 'warn') console.warn(line)
        else console.info(line)
      } catch {
        // 连 console 都不可用就只剩留痕文件了。
      }
    }
  }
  return {
    strip: (line, entry) => {
      emit('warn', line)
      trace({ time: new Date().toISOString(), action: 'strip', ...entry })
    },
    keep: (line, entry) => {
      emit('info', line)
      trace({ time: new Date().toISOString(), action: 'keep', ...entry })
    },
  }
}

function installsSandboxEscalationGuard(ctx: Context): void {
  const resolveEffectiveMode = createEffectiveModeResolver(ctx as unknown as SandboxPolicyContext)
  const guardLog = makeGuardLogger(ctx, defaultGuardTraceFile())
  ctx.effect(() => installSandboxEscalationGuard(ctx as unknown as SandboxEscalationGuardContext, {
    resolveEffectiveMode,
    onStrip: (info) => {
      guardLog.strip(
        `[dsh-devforge] 已剥离非法沙箱提权参数：tool=${info.tool} callId=${info.callId} session=${info.sessionId ?? '-'} reason=${info.reason} requested=${info.requestedMode ?? '-'} effective=${info.effectiveMode ?? 'unknown'}`,
        {
          tool: info.tool,
          callId: info.callId,
          ...(info.sessionId !== undefined ? { sessionId: info.sessionId } : {}),
          reason: info.reason,
          ...(info.requestedMode !== undefined ? { requestedMode: info.requestedMode } : {}),
          ...(info.effectiveMode !== undefined ? { effectiveMode: info.effectiveMode } : {}),
        },
      )
    },
    onKeep: (info) => {
      // 携带提权字段却放行：合法提权属正常；effective 缺失表示模式没能解析出来，
      // 那一档只可能是保守放行，必须留痕（0.33.0 的静默失效就是死在这里）。
      guardLog.keep(
        `[dsh-devforge] 沙箱提权参数放行：tool=${info.tool} session=${info.sessionId ?? '-'} requested=${info.requestedMode ?? '-'} effective=${info.effectiveMode ?? 'unknown'}`,
        {
          tool: info.tool,
          ...(info.sessionId !== undefined ? { sessionId: info.sessionId } : {}),
          ...(info.requestedMode !== undefined ? { requestedMode: info.requestedMode } : {}),
          ...(info.effectiveMode !== undefined ? { effectiveMode: info.effectiveMode } : {}),
        },
      )
    },
  }))
}

/** 插件挂载（mountOnce 防重复挂载，dsh-winrm 同款）。 */
let mounted = false
/**
 * 启动自动补齐模型清单所用的定时器域（0.41.14）。
 * 该补齐失败时会以 5 秒间隔重试，若等待期间进程停机，ref 定时器会把 Host 退出硬拖到 10 秒量级，
 * 直接导致桌面端「更新未安装」。因此等待一律 unref（不阻止退出），并在插件卸载/重挂时取消。
 */
let autoEnsureTimerScope: TimerScope | undefined
export function apply(ctx: Context, config?: Config): void {
  if (mounted) return
  mounted = true
  installsSandboxEscalationGuard(ctx)

  // ---- 配置解析 ----
  let current: () => Config = () => config ?? {}
  const resolve = (): Config => {
    const value = current()
    const storedOpenAi = readStoreDbOpenAi()
    return {
      enabled: value.enabled ?? DEFAULTS.enabled,
      announceToAgent: value.announceToAgent ?? DEFAULTS.announceToAgent,
      forgeAgentPreset: value.forgeAgentPreset?.trim() || DEFAULTS.forgeAgentPreset,
      remote: { enabled: value.remote?.enabled ?? false },
      // 本地浏览器：面板接管语义与远程访问网关一致——面板保存过的开关优先于组合配置，
      // 重启不丢；从未保存过则落到本兜底：基础工具默认开（新装用户开箱可用）、
      // 发布类工具默认关（闲鱼/小红书会把内容真实发出去，须用户显式开启）。
      browser: (() => {
        const stored = (() => { try { return getSettings<{ enabled?: boolean; publish?: boolean }>(getDb(), 'browser.settings') } catch { return undefined } })()
        return {
          enabled: stored?.enabled ?? value.browser?.enabled ?? true,
          publish: stored?.publish ?? value.browser?.publish ?? false,
          headless: value.browser?.headless === true,
          channel: value.browser?.channel ?? 'chrome',
          profileDir: value.browser?.profileDir ?? '',
          timeoutMs: value.browser?.timeoutMs ?? 45000,
        }
      })(),
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
        syncChatModels: value.siliconflow?.syncChatModels ?? true,
      },
      mcp: { enabled: value.mcp?.enabled ?? true },
      // 远程访问网关（0.41.0）：未配置一律关闭 + 默认端口，安全默认。
      remoteAccess: (() => {
        // 面板接管语义：store.db 的 gateway.settings 一旦有值即优先于组合配置（patch/settings RAW），
        // 用面板改过一次后以面板为准，重启不丢；存储缺失字段逐项回落到组合配置默认。
        const stored = (() => { try { return getSettings<{ enabled?: boolean; port?: number; host?: string; password?: string; upstreamPort?: number; sessionHours?: number }>(getDb(), 'gateway.settings') } catch { return undefined } })()
        return {
          enabled: stored?.enabled ?? value.remoteAccess?.enabled ?? false,
          port: stored?.port ?? value.remoteAccess?.port ?? 19390,
          host: stored?.host ?? value.remoteAccess?.host ?? '0.0.0.0',
          password: stored?.password ?? value.remoteAccess?.password ?? '',
          upstreamPort: stored?.upstreamPort ?? value.remoteAccess?.upstreamPort ?? 3080,
          sessionHours: stored?.sessionHours ?? value.remoteAccess?.sessionHours ?? 12,
        }
      })(),
    }
  }

  // ---- 核心对象 ----
  // 规范库根目录 = 本文件上级的 standards/（lib/index.js → ../standards）
  const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
  const standards = new StandardsStore(join(pluginRoot, 'standards'))
  // 设计资产库（0.42.0）：与规范库同构，但内容面向视觉与体验（craft/standards/skills/systems/templates/prompts）。
  const design = new DesignStore(join(pluginRoot, 'design'))
  const restartManager = new DshWebRestartManager()
  // 第一阶段只读桥接旧 SSH/WinRM store；不搬运、不回写任何凭据。
  const remoteRegistry = new LegacyRemoteRegistry()
  const engine = new ForgeEngine(ctx, ctx as unknown as ForgeHostServices, standards, join(pluginRoot, '.devforge'), () => resolve().forgeAgentPreset)
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
    const section = readSettingsSection(ctx, settingsNamespace('llm-pi-ai')) as { providers?: Record<string, { apiKeyEnv?: unknown }> } | undefined
    return resolveZhipuPrimaryKeyName(section, zhipuConfig.apiKeyEnv)
  }, {
    load: () => getSettings<{ keys: ZhipuKeyEntry[] }>(getDb(), 'zhipu-key-pool')?.keys,
    save: (entries) => putSettings(getDb(), 'zhipu-key-pool', { keys: entries }),
  }, [zhipuConfig.apiKeyEnv])
  const zhipuService = new ZhipuCodingPlanService(ctx, zhipuConfig, zhipuKeys)
  const minimaxService = new MiniMaxService(ctx, minimaxConfig)
  const arkService = new ArkCodingPlanService(ctx, arkConfig)
  const openAiService = new OpenAiGatewayService(ctx, openAiConfig)
const modagentaiService = new ModagentaiService(ctx, openAiService)
  const siliconFlowConfig: SiliconFlowCapabilityConfig = { enabled: true, apiKeyEnv: 'SILICONFLOW_API_KEY', timeoutMs: 15000, syncChatModels: true }
  const siliconFlowService = new SiliconFlowService(ctx, siliconFlowConfig)
  // MCP 服务器接入：官方 dsh-mcp-client 桥的挂载管理者（fiber 集随 store.db 配置 reconcile）。
  const mcpService = new McpService(ctx, () => resolve().mcp?.enabled !== false)

  // ---- 启动自动补齐：llm-pi-ai 就绪后把官方模型与推理档位写入设置；无变化时不产生写入。----
  let autoEnsureToken = 0
  const scheduleAutoEnsureModels = (): void => {
    const token = ++autoEnsureToken
    void (async () => {
      // 启动自动补齐一律 restore=false（默认不传参）：ensure* 会按 deleted-models 墓碑跳过
      // 用户删除过的模型，防止「删掉即复活」；面板手动补齐才传 restore=true 全量恢复并清墓碑。
      const ensureProviders = [
        () => openAiService.ensureProvider(),
        () => arkService.ensureModels(),
        () => arkService.ensureCodingModels(),
        () => zhipuService.ensureModels(),
        () => zhipuService.ensureOfficialModels(),
        () => minimaxService.ensureModels(),
        () => siliconFlowService.ensureModels(),
        () => modagentaiService.migrateLegacyGateway(),
      ]
      // 停机安全：重试等待必须 unref 且可取消。
      // DSH 桌面端要求 Host 在收到 shutdown 后 10 秒内真正退出，否则拒绝安装更新；而内核停机
      // 正常路径只置 process.exitCode、不强制退出进程，一个仍在等待的 ref 定时器就能把退出时间
      // 拖到 10 秒量级（实测 5 秒×2 轮 ≈ 9.9~10.0 秒，正好越线，导致更新安装被拒）。
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const scope = autoEnsureTimerScope
        if (token !== autoEnsureToken || scope === undefined) return
        // 各服务商独立结算：某一家无凭据或设置冲突时，不能阻塞其它 Provider 的迁移与补齐。
        const results = await Promise.allSettled(ensureProviders.map(async (ensure) => await ensure()))
        if (results.every((result) => result.status === 'fulfilled')) return
        if (token !== autoEnsureToken || autoEnsureTimerScope !== scope) return
        try {
          await scope.wait(5_000).done
        } catch {
          // 插件卸载/停机取消了等待：直接结束补齐循环，不再重试。
          return
        }
      }
    })()
  }

  /**
   * 官网账号设置（settings 域 plugin-update.settings 内嵌 site 子对象）。
   * 明文密码仅存本机 store.db（与既有凭据同级敏感度，随 CNB 加密备份）；对外接口一律脱敏视图。
   */
  const pluginUpdateSiteRead = (): PluginUpdateSiteConfig => {
    try {
      const stored = getSettings<{ site?: Partial<PluginUpdateSiteConfig> }>(getDb(), 'plugin-update.settings')
      const site = stored?.site
      return {
        apiUrl: typeof site?.apiUrl === 'string' && site.apiUrl.trim() !== '' ? site.apiUrl : PLUGIN_UPDATE_DEFAULT_SITE_API,
        username: typeof site?.username === 'string' ? site.username : '',
        password: typeof site?.password === 'string' ? site.password : '',
      }
    } catch { return { apiUrl: PLUGIN_UPDATE_DEFAULT_SITE_API, username: '', password: '' } }
  }
  const pluginUpdateSiteWrite = (site: PluginUpdateSiteConfig): void => {
    putSettings(getDb(), 'plugin-update.settings', { site })
  }
  /** 官网账号设置读取（脱敏视图：明文密码不出 Host，浏览器只见 hasPassword + 掩码）。 */
  const pluginUpdateSiteGet = (): PluginUpdateSiteView => {
    return toSiteView(pluginUpdateSiteRead())
  }
  /** 官网账号设置写入（校验与合并下沉 plugin-update.applySitePatch；password 空串 = 不修改已存密码）。 */
  const pluginUpdateSitePut = (patch: PluginUpdateSitePatch): PluginUpdateSiteView => {
    pluginUpdateSiteWrite(applySitePatch(pluginUpdateSiteRead(), patch))
    return pluginUpdateSiteGet()
  }

  /** 插件更新服务：check 面板数据源 + apply 一键升级（下载优先复用面板官网登录态，site 凭据兜底；重启仍走 devforge_restart 确认红线）。 */
  const pluginUpdateService = new PluginUpdateService({
    getConfig: () => {
      const value = resolve().pluginUpdate
      return {
        enabled: value?.enabled ?? true,
        profile: value?.profile ?? 'web',
        sources: value?.sources?.length ? value.sources : PLUGIN_UPDATE_DEFAULT_SOURCES,
        site: pluginUpdateSiteRead(),
      }
    },
    readInstalled: createDefaultInstalledReader(),
    sessionToken: async () => {
      const token = await modagentaiService.readSessionToken()
      return token ?? ''
    },
  })

  /**
   * DSH 本体检查 + 一键升级：本机真实安装版本 vs 官方 GitHub Tags（含预发布版本比较）。
   * 一键升级由 Host 代跑 npm/pnpm 全局安装，目标版本 Host 实时拉取（客户端不可指定）；
   * 完成后仍须辉哥确认重启（devforge_restart 红线不变）。
   */
  const harnessEntryPath = process.argv[1] ?? ''
  const harnessCheck = (): Promise<HarnessUpdateCheckItem> => {
    return checkHarnessUpdate({ readInstalled: createDefaultHarnessVersionReader(harnessEntryPath), entryPath: harnessEntryPath })
  }
  const harnessApply = (): Promise<{ ok: boolean; version: string; output: string; needRestart: boolean }> => {
    return applyHarnessUpdate({ readInstalled: createDefaultHarnessVersionReader(harnessEntryPath), entryPath: harnessEntryPath })
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
    // 方舟 Coding Plan 向量端点（套餐内额度，2026-09-21 实测 doubao-embedding-vision-251215 可调、2048 维；
    // 文本型 doubao-embedding-large-text-* 在套餐网关 404，勿用）。按量付费 /api/v3 会产生额外费用，禁止回切。
    // batchSize=4 教训（2026-09-21）：默认 16 条/批 × 512 字中文会触发方舟 400 InvalidParameter「input limit
    // exceeded」（实测 16 条爆、8 条过、4 条稳，中文 512 字约 500-800 token，4 条留足余量）；
    // 20 篇 mnemon 长文档整批失败即此因。方舟按 token 计费，小批次不增加费用。
    ark: new ZhipuEmbedder(ragCredential('ARK_CODING_PLAN_API_KEY', '尚未配置方舟 API Key（ARK_CODING_PLAN_API_KEY）。'), { baseURL: 'https://ark.cn-beijing.volces.com/api/coding/v3', path: '/embeddings', model: 'doubao-embedding-vision-251215', batchSize: 4 }),
    'openai-gateway': new ZhipuEmbedder(ragOpenAiCredential, { baseURLProvider: ragOpenAiBaseURL, path: '/v1/embeddings', model: 'text-embedding-3-small' }),
    // 本地 Ollama：零额度免费无限用（bge-m3 中文 1024 维）；key 占位不影响（Ollama 不校验）。
    ollama: new ZhipuEmbedder(async () => 'ollama-local', { baseURL: 'http://localhost:11434', path: '/v1/embeddings', model: 'bge-m3' }),
    // 自定义 OpenAI 兼容渠道（硅基流动/智谱开放平台/百炼等）：地址与凭据引用名存 rag.settings，
    // 每次请求动态解析（面板即改即用）；凭据本体走受管凭据表，绝不落明文。
    siliconflow: new ZhipuEmbedder(ragCredential('SILICONFLOW_API_KEY', '尚未配置硅基流动 API Key（SILICONFLOW_API_KEY）。'), { baseURL: 'https://api.siliconflow.cn/v1', path: '/embeddings', model: 'BAAI/bge-m3' }),
    // 官网向量服务（辉哥 2026-09-23 定稿：用户登录后记忆等向量服务对接官网；会话令牌即凭据免 API Key）。
    // 上游同为方舟 Coding Plan 套餐端点，doubao-embedding-vision-251215 与 ark 渠道同名同 2048 维 →
    // vectorKey(model,text) 一致，向量缓存全命中，切渠道零重嵌零重复计费；官网侧计费每万 token 0.01💎。
    modagentai: new ZhipuEmbedder(ragCredential('MODAGENTAI_SESSION_TOKEN', '尚未登录官网账号（MODAGENTAI_SESSION_TOKEN），官网向量服务不可用。'), { baseURL: 'https://modagentai.com/api/gw/v1', path: '/embeddings', model: 'doubao-embedding-vision-251215', batchSize: 4 }),
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
  // 官网账号登录后向量服务自动对接官网（辉哥 2026-09-23 定稿）：已登录且当前渠道非官网时迁移，
  // 幂等（已是 modagentai 跳过）；模型名与 ark 渠道一致（vectorKey 相同）→ 向量缓存全命中零重嵌。
  // 失败静默（启动不阻塞）：面板可手动切。
  void (async () => {
    try {
      const status = await modagentaiService.status()
      if (!status.loggedIn || status.expired) return
      const settings = ragService.getSettings()
      if (settings.embedding.provider === 'modagentai') return
      ragService.putSettings({ ...settings, embedding: { ...settings.embedding, provider: 'modagentai', model: 'doubao-embedding-vision-251215' } })
      ctx.logger?.info?.('[dsh-devforge] RAG 向量渠道已自动切换官网（%s → modagentai）', settings.embedding.provider)
    } catch { /* 迁移失败不阻塞启动 */ }
  })()
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
      messages: [createUserMessage({ content: [{ type: 'text', text: input.user }], source: { kind: DEVFORGE_SOURCE_KIND } })],
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

  /**
   * 记忆模型路由解析（0.43.0「天工造梦一套」）。
   *
   * 登录天工造梦官网后，宿主默认模型即 tiangong 原生 provider；记忆的提炼与做梦裁决缺省跟随它，
   * 用户无需另配服务商（面板上的「裁决/沉淀服务商」只是可选覆盖）。
   * 旧实现会把覆盖值直传 llm.stream——一旦它指向宿主目录里不存在的 provider（存量残留：minimax-cn），
   * 换来 `no adapter registered for provider` 这种离根因很远的报错，整轮整理直接失败、归档长期为 0。
   *
   * 这里统一解析：不可用 → 回退宿主默认 + 中文原因（回退可见，绝不静默、绝不假装成功）。
   */
  /** 宿主真实注册了 adapter 的 provider id 集合（与面板模型目录同口径）。 */
  const registeredProviderIds = (): string[] => {
    const llm = ctx.get('llm') as { listProviders?: () => Array<{ id?: unknown }> } | undefined
    const providers = llm?.listProviders?.()
    if (!Array.isArray(providers)) return []
    return providers.flatMap((item) => typeof item?.id === 'string' && item.id !== '' ? [item.id] : [])
  }

  /**
   * 记忆路由可用性目录（0.43.0）。
   *
   * 权威依据是 **ctx.llm.listProviders()**——宿主真正注册了 adapter 的 provider，与面板模型目录
   * （src/model-catalog.ts）同口径；**不是** llm-pi-ai 的配置声明。
   *
   * 生产踩坑（2026-10-10）：minimax-cn 在配置里声明齐全（apiKeyEnv + 四个模型），但宿主侧没有
   * 注册 adapter，调用直接报 no adapter registered for provider "minimax-cn"。若只看配置声明，
   * 它会被判成「可用」——运行时不回退、自愈不清空，两项修复同时失灵。这是本次最关键的修正。
   *
   * 模型名仍取 llm-pi-ai 的声明（listProviders 只给 id/name）；声明里查不到时该 provider 视为
   * 「无模型」，由路由解析按「服务商下没有可用模型」处理（回退宿主默认，不静默）。
   */
  const memoryRouteCatalog = (): Map<string, string[]> => mergeRegisteredCatalog(
    registeredProviderIds(),
    modelCatalogFromSection(readSettingsSection(ctx, settingsNamespace('llm-pi-ai'))),
  )

  const resolveMemoryRoute = (request: { provider: string; model: string }): MemoryModelRoute => {
    const selectionHost = ctx as unknown as { agentDefaultModel?: { currentSelection?: () => { provider: string; model: string } } }
    const selection = selectionHost.agentDefaultModel?.currentSelection?.()
    return resolveMemoryModelRoute({
      requestedProvider: request.provider,
      requestedModel: request.model,
      catalog: memoryRouteCatalog(),
      fallbackProvider: selection?.provider ?? '',
      fallbackModel: selection?.model ?? '',
    })
  }

  /** 记忆提炼单次输出预算（候选 5 条 + task 复盘 JSON）。 */
  const REFLECT_BASE_TOKENS = 700
  /** 被 token 上限截断时的自动扩容倍数：700 → 1400 → 2800，都用满仍失败才交给批次重试。 */
  const REFLECT_TOKEN_STEPS = [1, 2, 4] as const

  /**
   * 记忆提炼/复盘生成：截断自动扩容重试。
   *
   * 硬教训一（2026-09-11 生产实况）：思考型模型输出被 maxTokens 截断时，宿主曾以
   * "stream ended without a stop reason" 收尾，沉淀 12 次全失败——0.29.4 据此按
   * 结束原因识别截断并扩容重试。
   * 硬教训二（2026-09-10 生产实况）：MiniMax 调通后发现宿主对截断的另一种形态是
   * 「正常返回 + finish.kind='max-tokens'」而不抛错——旧写法在成功返回路径直接
   * return，半截 JSON 交给解析器，沉淀报「提炼输出无法解析为 JSON」。
   * 两种形态统一交给 generateReflectionWithTokenSteps 处理（0.29.8）。
   */
  const generateReflectionText = (input: { system: string; user: string; provider?: string; model?: string }): Promise<string> =>
    generateReflectionWithTokenSteps(
      (call) => generateText({ ...input, maxTokens: call.maxTokens, onFinish: call.onFinish }),
      { system: input.system, user: input.user },
      REFLECT_BASE_TOKENS,
      REFLECT_TOKEN_STEPS,
    )

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
    // 沉淀路由可独立配置（0.26.6）；0.43.0 起统一走路由解析：配的服务商在宿主目录里不可用时
    // 回退宿主默认（登录官网即 tiangong）并留原因，而不是把无效 provider 直传宿主。
    const route = memorySettingsRead()
    const resolved = resolveMemoryRoute({ provider: route.sedimentProvider, model: route.sedimentModel })
    if (resolved.provider === '' || resolved.model === '') throw new Error(MEMORY_ROUTE_NO_DEFAULT)
    if (resolved.fellBack) ctx.logger.info('[dsh-devforge] 记忆沉淀路由回退：%s', resolved.reason)
    // token 预算与截断扩容重试都在 generateReflectionText 内部（0.29.4）：复盘不能因一次截断整批作废。
    return generateReflectionText({ system, user, provider: resolved.provider, model: resolved.model })
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
    // 0.43.0「天工造梦一套」：面板配的服务商/模型在宿主目录里不可用时回退宿主默认并留原因。
    resolveRoute: resolveMemoryRoute,
    config: () => {
      const settings = memorySettingsRead()
      return { ...settings, enabled: settings.enabled && resolve().memory?.enabled !== false }
    },
    log: (message) => ctx.logger.info(message),
    listDomain: (domain) => ragStore.listDomainDocs(domain),
    putDomain: (domain, id, data) => ragStore.putDomainDoc(domain, id, data),
    deleteDomain: (domain, id) => ragStore.deleteDomainDoc(domain, id),
    // 裁决默认只出治理建议（红线：自动化动库必须用户点头）；记忆策略里显式关闭「治理建议自动应用」
    // 即全自动生效（软删除可恢复 + 审计可回滚 + 钉选条目永不触碰）。此构造值只是配置未指定时的兜底，
    // 每轮 run 都会读 memory.settings 最新值，面板改开关热生效。
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
    // 路由回退要出现在面板块上：否则「配错服务商」会被误读成模型故障（0.43.0）。
    const withFallback = run.routeFallback === undefined || run.routeFallback === ''
      ? summary
      : summary + '｜路由回退：' + run.routeFallback
    memoryStats.update((prev) => ({ ...prev, dreamTotal: prev.dreamTotal + 1, lastDreamAt: run.finishedAt, lastDreamStatus: run.status, lastDreamSummary: withFallback.slice(0, 300) }))
  }
  dream.start()
  ctx.effect(() => () => dream.dispose(), 'dsh-devforge: memory dream')

  /**
   * 一次性迁移（0.43.0「天工造梦一套」）：把记忆的模型路由回归官网默认。
   *
   * 背景：旧版本的面板会引导用户把「裁决/沉淀服务商」指到专用路由（典型组合
   * minimax-cn + MiniMax-M2.7-highspeed）。辉哥 2026-10-10 定稿：用户装了插件、登录官网账号
   * 就应该一套走通，记忆的提炼与做梦裁决不该再绑在某个第三方服务商上。
   *
   * 因此升级时把这类存量覆盖清空，回到「跟随宿主默认模型」（登录官网即 tiangong 原生 provider）。
   * 只做一次（标记落 store.db `memory.route-default-migrated`）：之后用户在面板上重新选的服务商
   * 会被尊重，不再被这次迁移覆盖——迁移不是永久规则。
   */
  const migrateMemoryRoutesToDefault = (): void => {
    try {
      if (getSettings(getDb(), 'memory.route-default-migrated') !== undefined) return
      const current = memorySettingsRead()
      const dream = current.dreamProvider.trim()
      const sediment = current.sedimentProvider.trim()
      const hadOverride = dream !== '' || sediment !== ''
      if (hadOverride) {
        memorySettingsWrite({ ...current, dreamProvider: '', dreamModel: '', sedimentProvider: '', sedimentModel: '' })
        ctx.logger.info('[dsh-devforge] 记忆模型路由已回归官网默认：清空旧版专用裁决路由（裁决=%s / 沉淀=%s）——记忆提炼与做梦裁决跟随宿主默认模型。', dream === '' ? '未设' : dream, sediment === '' ? '未设' : sediment)
      }
      putSettings(getDb(), 'memory.route-default-migrated', { at: Date.now(), cleared: hadOverride })
    } catch (error) {
      // 迁移失败绝不影响启动：运行时路由解析仍会回退宿主默认并说明原因。
      ctx.logger.warn?.('[dsh-devforge] 记忆路由迁移失败（不影响使用）：%s', error instanceof Error ? error.message : String(error))
    }
  }

  // ---- 镜像自动同步（0.33.5）：修复「镜像只同步一次后永久脱节」----
  // 生产实况：Mnemon 侧 40 篇、镜像库仅 12 篇且停在 2026-09-02 首次手动同步。
  const mirrorSync = new MirrorSyncScheduler({
    rag: ragService,
    config: () => normalizeMirrorSyncSettings(ragService.getSettings().mirrorSync),
    log: { info: (message, ...args) => ctx.logger.info(message, ...args), warn: (message, ...args) => ctx.logger.warn(message, ...args) },
  })
  mirrorSync.start()
  ctx.effect(() => () => mirrorSync.dispose(), 'dsh-devforge: mirror sync')

  // ---- 工作流引擎（rag.workflow / rag.workflow_run 域存储 + 默认模型生成）----
  const workflowEngine = new WorkflowEngine(ragService, {
    listDomain: (domain) => ragStore.listDomainDocs(domain),
    putDomain: (domain, id, data) => ragStore.putDomainDoc(domain, id, data),
    deleteDomain: (domain, id) => ragStore.deleteDomainDoc(domain, id),
  }, (input) => generateText({ system: input.system, user: input.user, ...(input.maxTokens !== undefined ? { maxTokens: input.maxTokens } : {}), ...(input.provider !== undefined ? { provider: input.provider } : {}), ...(input.model !== undefined ? { model: input.model } : {}) }))

  // ---- 可重挂表面（路由/工具/系统提示）----
  // 远程引擎引用（activateRemote 赋值；一键发布请求时经闭包延迟解引用，复用同一连接池）。
  let remoteActivation: ReturnType<typeof activateRemote> | undefined
  const douyinLive = new DouyinLiveService({
    store: douyinLiveStore,
    log: (message) => ctx.logger.info(message),
    receiver: new DouyinReceiverProcess({ log: (message) => ctx.logger.info(message) }),
  })
  ctx.effect(() => () => douyinLive.dispose(), 'dsh-devforge: douyin live')
  // 250k 一键配置的宿主依赖：settings 已注入声明；agentPresets 用运行时可选读取
  //（类型增强属于 dsh-agent-presets 包，本插件未直接 import）。
  const agentPreset250kDeps = () => ({
    settings: ctx.settings,
    agentPresets: ctx.get('agentPresets') as import('./forge.ts').ForgeHostServices['agentPresets'],
  })
  // 项目探测执行器（0.40.x）：延迟取远程引擎与全部已配置主机清单（deployTargets 为空时兜底全扫）。
  // 路由与 devforge_project 工具共用同一闭包，保证行为一致。
  const runProjectProbeById = async (id: string) => {
    const entry = listProjects().find((project) => project.id === id)
    if (entry === undefined) return { ok: false, hits: [], applied: [], skipped: [], error: 'unknown project: ' + id }
    const allHosts = [
      ...(() => { try { return new SshHostStore().list().map((host) => ({ transport: 'ssh' as const, alias: host.alias, host: host.host })) } catch { return [] } })(),
      ...(() => { try { return new WinrmHostStore().list().map((host) => ({ transport: 'winrm' as const, alias: host.alias, host: host.host })) } catch { return [] } })(),
    ]
    return runProjectProbe(entry, { ssh: remoteActivation?.sshEngine, winrm: remoteActivation?.winrmEngine }, allHosts)
  }
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
      harnessApply: () => harnessApply(),
      siteGet: pluginUpdateSiteGet,
      sitePut: pluginUpdateSitePut,
    }, {
      run: async (id: string) => {
        const entry = listProjects().find((project) => project.id === id)
        if (entry === undefined) return { ok: false, results: [], error: 'unknown project: ' + id }
        return runProjectDeploy(entry, { ssh: remoteActivation?.sshEngine, winrm: remoteActivation?.winrmEngine })
      },
    }, {
      // 项目自动探测执行器（0.40.x）：与工具共用闭包。
      run: runProjectProbeById,
    }, {
      // 250k 压缩预设一键配置：读状态走同步快照；创建/设默认走异步执行器。
      // agentPresets 未进本插件 Context 类型增强，按运行时可选服务读取并断言最小结构。
      status: () => readAgentPreset250kStatus(agentPreset250kDeps()),
      setup: (options) => setupAgentPreset250k(agentPreset250kDeps(), options),
    }),
    ...makeRemoteRoutes(remoteRegistry, new SshHostStore(), new WinrmHostStore()),
    // 远程访问网关（0.41.0）面板路由：GET 脱敏配置+运行状态，PUT 保存并热重建（存储优先于组合配置）。
    ...makeGatewayRoutes({
      readConfig: () => {
        const gateway = resolve().remoteAccess
        return {
          enabled: gateway?.enabled ?? false,
          port: gateway?.port ?? 19390,
          host: gateway?.host ?? '0.0.0.0',
          password: gateway?.password ?? '',
          upstreamPort: gateway?.upstreamPort ?? 3080,
          sessionHours: gateway?.sessionHours ?? 12,
        }
      },
      readRuntime: () => {
        const gateway = activeRemoteGateway
        const port = gateway?.listeningPort
        return {
          running: gateway?.running === true,
          listeningPort: port,
          urls: gateway?.running === true && port !== undefined ? gatewayAccessUrls(resolve().remoteAccess?.host ?? '0.0.0.0', port) : [],
        }
      },
      save: (next) => {
        putSettings(getDb(), 'gateway.settings', next)
        ctx.logger.info('[dsh-devforge] 远程访问网关配置已保存，热重建中（端口 %d，%s）', next.port, next.enabled ? '已启用' : '已停用')
        requestGatewaySync()
      },
    }),
    // 智谱、MiniMax、火山方舟与运营浏览器的面板路由常驻基础路由组；未启用的能力返回明确 JSON 提示。
    ...makeZhipuRoutes(zhipuService),
    ...makeMiniMaxRoutes(minimaxService),
    ...makeArkRoutes(arkService),
    ...makeOpenAiRoutes(openAiService),
  ...makeModagentaiRoutes(modagentaiService),
    ...makeSiliconFlowRoutes(siliconFlowService),
    ...makeCredentialsRoutes(),
    ...makeBackupRoutes(),
    ...makeBrowserRoutes(browserHolder),
    // 本地浏览器开关（2026-09-28）：面板直接开关基础/发布类工具；保存即落 store.db 的
    // browser.settings 域并触发 sync()，工具注册立即跟随，无需重启 DSH。
    // sync 在下方定义、此处只引用：与既有 requestGatewaySync = sync 同构，回调仅在用户点开关时执行，届时已初始化。
    ...makeBrowserSettingsRoutes({
      read: () => {
        const browser = resolve().browser
        return { enabled: browser?.enabled === true, publish: browser?.publish === true }
      },
      save: (next) => {
        putSettings(getDb(), 'browser.settings', next)
        ctx.logger.info('[dsh-devforge] 本地浏览器开关已保存并热重建（浏览器工具 %s，发布类工具 %s）', next.enabled ? '开' : '关', next.publish ? '开' : '关')
        sync()
      },
    }),
    ...makeRagRoutes(ragService, ragEmbedders),
    ...makeMemoryRoutes({ rag: ragService, sediment, injection, stats: memoryStats, getSettings: memorySettingsRead, putSettings: memorySettingsWrite, getProfile: memoryProfileRead, putProfile: memoryProfileWrite, native: nativeMemory, governance: memoryGovernance, dream }),
    ...makeWorkflowRoutes(workflowEngine),
    ...makeMcpRoutes(mcpService),
    // 数据管理（0.39.0）：库表透明浏览 + 密钥掩码/明文复制（reveal 走审计日志，值不入日志）。
    ...makeDbAdminRoutes({ info: (message, ...args) => { try { ctx.logger.info(message, ...args) } catch { /* 日志失败不影响路由 */ } } }),
    // 模型目录（0.39.0）：全 provider 模型与推理档位（记忆工作台等面板下拉数据源；
    // 原主脑路由 catalog 能力的中立迁移，主脑路由已于 0.39.0 下线删除）。
    makeModelCatalogRoute(ctx),
  ]
  // 工作流软下线（0.39.0，辉哥定稿）：rag_run 工具停注、面板页签隐藏；引擎与路由保留，
  // 恢复方法——本行数组重新加回 `ragRunTool(workflowEngine)`（import 恢复 './workflow/tools.ts'）即可。
  // 官网搜索（0.39.0，辉哥定稿）：modagentai.com 联网搜索开放给模型，智谱/MiniMax 限额时的第三条通道。
  const tools = [devforgeJobsTool(engine), devforgeStandardsTool(standards), devforgeDesignTool(design), devforgeRestartTool(restartManager), backupNowTool(), backupStatusTool(), ragSearchTool(ragService, nativeMemory), memoryManageTool(nativeMemory, { governance: memoryGovernance, scopeOfAgent: memoryScopeOfAgent }), devforgeProjectTool({ run: runProjectProbeById }), devforgeWorkspaceTool(), ...devforgeDbTools(), ...modagentaiWebTools(modagentaiService)]
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
  let disposeMemoryWorkflow: (() => void) | undefined
  let disposeUserProfile: (() => void) | undefined
  /** 凭据双向同步服务（yaml 主存 ↔ store.db credential 镜像；0.39.0）。 */
  let credentialSyncService: CredentialSyncService | undefined
  let disposeCredentialSync: (() => void) | undefined
  /** 远程访问网关（0.41.0）：面板配置开关+端口+密码，员工浏览器访问本机 DSH Web。 */
  let disposeRemoteGateway: (() => void) | undefined
  /** 网关运行实例句柄（面板「远程访问」页读运行状态用）。 */
  let activeRemoteGateway: RemoteGateway | undefined
  /** 面板保存网关配置后触发 sync() 热重建；sync 定义前路由先构造，运行时已赋值。 */
  let requestGatewaySync: () => void = () => {}
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
    disposeMemoryWorkflow?.(); disposeMemoryWorkflow = undefined
    disposeUserProfile?.(); disposeUserProfile = undefined
    disposeCredentialSync?.(); disposeCredentialSync = undefined; credentialSyncService = undefined
    disposeRemoteGateway?.(); disposeRemoteGateway = undefined
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
    // 记忆工作流纪律常驻节（0.41.16）：把「先查记忆 → 再核事实 → 回写修正」的
    // 闭环写进全部会话。记忆检索/钉选只解决「记忆在场」，本节点解决「记忆被用起来
    // 且会自我修正」——解决完发现记忆有误必须回写，否则同一条事实每轮重新探索。
    disposeMemoryWorkflow = ctx.systemPrompt.section({
      name: MEMORY_WORKFLOW_SECTION_NAME,
      order: MEMORY_WORKFLOW_SECTION_ORDER,
      text: MEMORY_WORKFLOW_TEXT,
    })
    // 项目约束三层注入：常驻摘要保底；cwd 命中开发仓库或出现开发动作时升级全文（0.11.0）。
    // 0.19.0 起同一节追加产出公约摘要与当前项目卡（数据源带 5s TTL 缓存，避免每次装配读库）。
    if (value.constraints?.enabled) {
      disposeConstraints = ctx.effect(() => {
        const service = new ConstraintInjectionService()
        // 项目清单与公约摘要的 5 秒缓存：系统提示装配频繁，库读 KB 级但无需每次进行。
        let projectsCache: { at: number; value: ReturnType<typeof listProjects> } | undefined
        let conventionCache: { at: number; value: string } | undefined
        // 项目知识手册索引缓存（0.34.19）：RAG 文档名 + 记忆条目首行标题，按项目名或记忆作用域匹配。
        let knowledgeCache: { at: number; value: Array<{ title: string; description: string; projectId?: string }> } | undefined
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
          getProjectKnowledge: (entry: ProjectEntry) => {
            if (knowledgeCache === undefined || Date.now() - knowledgeCache.at > 15000) {
              const items: Array<{ title: string; description: string; projectId?: string }> = []
              for (const doc of ragStore.listDocs()) {
                if (doc.status !== 'ready') continue
                items.push({ title: doc.fileName.replace(/\.(md|markdown|txt)$/iu, '').slice(0, 120), description: doc.sourcePath ?? '' })
              }
              for (const memory of nativeMemory.list({ limit: 1000 })) {
                if (memory.state !== 'active') continue
                const firstLine = memory.content.split('\n').map((line) => line.trim()).find((line) => line !== '' && line !== '---') ?? ''
                const title = firstLine.replace(/^#+\s*/u, '').slice(0, 120)
                if (title === '') continue
                items.push({ title, description: memory.scope.kind === 'project' ? '项目记忆' : '', projectId: memory.scope.kind === 'project' ? memory.scope.id : undefined })
              }
              knowledgeCache = { at: Date.now(), value: items }
            }
            const name = entry.name.trim().toLowerCase()
            if (name === '') return ''
            const seen = new Set<string>()
            const hits = knowledgeCache.value.filter((item) => {
              const matched = item.projectId === entry.id || item.title.toLowerCase().includes(name)
              if (!matched || seen.has(item.title)) return false
              seen.add(item.title)
              return true
            }).slice(0, 8)
            if (hits.length === 0) return ''
            return [
              '【项目知识手册索引（dsh-devforge 注入）】',
              '本项目沉淀了以下权威操作手册/交接文档。执行发布、部署、环境配置、排障等关键操作前，必须先读取对应手册全文并严格按手册执行，禁止凭印象自由发挥：',
              ...hits.map((hit) => '- 《' + hit.title + '》' + (hit.description !== '' ? '：' + hit.description : '')),
            ].join('\n')
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
      // 项目自动登记（0.34.18）：会话落到未登记的项目目录（有 .git/package.json 等标志）
      // 即自动补登记，用户无需手动录入；幂等静默，失败不影响会话。
      ctx.effect(() => startProjectAutoRegister(ctx), 'dsh-devforge: project-auto-register')
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
    // 每次 sync 领取新的定时器域，并取消上一轮仍在等待的重试（避免旧定时器拖住进程退出）。
    const previousTimerScope = autoEnsureTimerScope
    autoEnsureTimerScope = createTimerScope()
    previousTimerScope?.cancelAll()
    // 必须等所有能力配置同步完成后再异步迁移/补齐；提前启动会被本段默认值覆盖。
    scheduleAutoEnsureModels()
    // 记忆路由一次性迁移（0.43.0「官网一套」）：把旧版专用裁决路由覆盖清空，回归宿主默认模型。
    migrateMemoryRoutesToDefault()
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
    // 智谱官方 MCP 工具：网页读取/Zread（联网搜索类已按辉哥 2026-10-07 要求下架），
    // 联网检索一律走天工造梦官网渠道 modagentai_web_search；凭据走 Key 池（401/403/429 自动换下一把），绝不落明文。
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
    // 远程访问网关（0.41.0）：enabled 且密码非空才启动；配置热更新随 sync 重建（换端口/密码即时生效）。
    safeActivate(ctx, '远程访问网关', () => {
      const gateway = value.remoteAccess
      if (gateway?.enabled !== true) return
      const password = (gateway.password ?? '').trim()
      if (password === '') {
        ctx.logger.warn('[dsh-devforge] 远程访问网关已开启但未配置密码，网关未启动')
        return
      }
      activeRemoteGateway = startRemoteGateway({
        port: gateway.port ?? 19390,
        host: gateway.host ?? '0.0.0.0',
        password,
        upstreamPort: gateway.upstreamPort ?? 3080,
        sessionHours: gateway.sessionHours ?? 12,
      }, {
        info: (message, ...args) => { try { ctx.logger.info(message, ...args) } catch { /* 日志失败不影响网关 */ } },
        warn: (message, ...args) => { try { ctx.logger.warn(message, ...args) } catch { /* 日志失败不影响网关 */ } },
      })
      disposeRemoteGateway = () => {
        activeRemoteGateway?.dispose()
        activeRemoteGateway = undefined
      }
    })
    // 本地浏览器：独立于远程运维，启用即注册 browser_* 工具。
    safeActivate(ctx, '本地浏览器', () => {
      const browserActivation = activateBrowser(ctx, {
        enabled: value.enabled === true && value.browser?.enabled === true,
        publish: value.enabled === true && value.browser?.publish === true,
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
    // 凭据双向同步（0.39.0）：启动对账（反向补缺 + 正向镜像）+ 15 分钟定时巡检（正向）；
    // 恢复备份后的覆盖式回写在 restoreFromContainer 内联完成。日志只记 ref 名，绝不记值。
    safeActivate(ctx, '凭据双向同步', () => {
      const service = new CredentialSyncService({
        log: {
          info: (message, ...args) => { try { ctx.logger.info(message, ...args) } catch { /* 日志失败不影响业务 */ } },
          warn: (message, ...args) => { try { ctx.logger.warn(message, ...args) } catch { /* 日志失败不影响业务 */ } },
        },
      })
      credentialSyncService = service
      void service.reconcileOnStartup().catch((error: unknown) => {
        ctx.logger.warn('[dsh-devforge] 凭据启动对账失败（不影响插件启动）：%s', error instanceof Error ? error.message : String(error))
      })
      service.start()
      disposeCredentialSync = () => { service.dispose() }
    })
  }

  // ---- 设置面板接线（改配置即热更新）----
  scheduleSectionReadinessCheck(ctx)
  installSettingsSection(ctx, DEVFORGE_SETTINGS_NAMESPACE, Config, config ?? {}, {
    // schemastery 嵌套 object 的快照含 null 字段；规整成 Config 视图（?? 兜底）再交给 resolve()。
    setSource: (raw) => {
      const source = (): Config => {
        const value = raw() as Config & { forgeAgentPreset?: string | null; remote?: { enabled?: boolean | null }; browser?: { enabled?: boolean | null; publish?: boolean | null; headless?: boolean | null; channel?: string | null; profileDir?: string | null; timeoutMs?: number | null }; github?: { enabled?: boolean | null }; cnb?: { enabled?: boolean | null }; feishu?: { enabled?: boolean | null }; zhipu?: { enabled?: boolean | null; apiKeyEnv?: string | null; timeoutMs?: number | null; officialApiKeyEnv?: string | null }; siliconflow?: { enabled?: boolean | null; apiKeyEnv?: string | null; timeoutMs?: number | null; syncChatModels?: boolean | null } }
        return {
          enabled: value.enabled ?? undefined,
          announceToAgent: value.announceToAgent ?? undefined,
          forgeAgentPreset: value.forgeAgentPreset?.trim() || DEFAULTS.forgeAgentPreset,
          // 子能力开关：未配置一律 false（安全默认），与 resolve() 兜底一致。
          // 例外：browser 两个开关有自己的默认（基础开、发布关），见下方注释。
          remote: { enabled: value.remote?.enabled === true },
          browser: {
            // 浏览器基础工具默认开（新装用户开箱可用）；发布类工具默认关（会真实发布内容）。
            enabled: value.browser?.enabled !== false,
            publish: value.browser?.publish === true,
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
          // 0.33.3 修复：source 此前遗漏 siliconflow 段，patch overlay 配置的
          // syncChatModels=false 在启动规整时被丢弃（默认 true 兜底），只嵌入模式失效。
          siliconflow: {
            enabled: value.siliconflow?.enabled !== false,
            apiKeyEnv: value.siliconflow?.apiKeyEnv ?? 'SILICONFLOW_API_KEY',
            timeoutMs: value.siliconflow?.timeoutMs ?? 15000,
            syncChatModels: value.siliconflow?.syncChatModels !== false,
          },
          // 远程访问网关（0.41.0）：未配置一律关闭 + 默认端口，安全默认。
          remoteAccess: {
            enabled: value.remoteAccess?.enabled === true,
            port: value.remoteAccess?.port ?? 19390,
            host: value.remoteAccess?.host ?? '0.0.0.0',
            password: value.remoteAccess?.password ?? '',
            upstreamPort: value.remoteAccess?.upstreamPort ?? 3080,
            sessionHours: value.remoteAccess?.sessionHours ?? 12,
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

  // 面板保存网关配置 → sync 热重建（sync 已定义，接通面板路由的保存触发）。
  requestGatewaySync = sync

  // 首次挂载
  sync()

  // 事件订阅兜底（engine 内部也订阅，这里幂等安全）
  ctx.effect(() => () => {
    // 停机/卸载：清掉启动自动补齐仍在等待的重试定时器，避免拖住 Host 退出。
    autoEnsureTimerScope?.cancelAll()
  }, 'dsh-devforge: lifecycle')

  // 导出围栏工具供测试（非公开 API）
  void isLoopbackRequest
}
