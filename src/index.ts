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
import { getDb, getSettings } from './store/db.ts'
import { migrateFromLegacyFiles } from './store/migrate.ts'
import { LegacyRemoteRegistry } from './remote/legacy-registry.ts'
import { makeRemoteRoutes } from './remote/routes.ts'
import { makeBackupRoutes } from './backup/routes.ts'
import { BackupScheduler } from './backup/scheduler.ts'
import { backupNowTool, backupStatusTool } from './backup/tools.ts'
import { HostStore as SshHostStore } from './remote/ssh/store.ts'
import { HostStore as WinrmHostStore } from './remote/winrm/store.ts'
import { makeRoutes } from './routes.ts'
import { activateBrowser, type BrowserActivation } from './browser/activate.ts'
import type { BrowserStatus } from './browser/protocol.ts'
import { makeBrowserRoutes } from './browser/routes.ts'
import type { BrowserRoutesService } from './browser/service.ts'
import { makeZhipuRoutes } from './zhipu/routes.ts'
import { ZhipuCodingPlanService, type ZhipuCapabilityConfig } from './zhipu/service.ts'
import { activateZhipuMcpTools } from './zhipu/mcp-tools.ts'
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
import { CONSTRAINTS_DEFAULT_PATHS, ConstraintInjectionService, type ConstraintsConfig } from './constraints.ts'
import { activatePluginBrief, type PluginBriefConfig } from './plugin-brief.ts'

/** cordis 插件名（稳定 id）。 */
export const name = 'devforge'

/**
 * 前置服务：核心工厂使用路由、工具和子代理；飞书接管还依赖模型目录、会话持久化、
 * 标题和附件服务。这里必须保持与原 dsh-feishu 注入集合一致，避免能力延迟到运行时才报错。
 */
export const inject = [
  'webServer', 'tools', 'systemPrompt', 'credentials', 'settings', 'agents', 'agentDefaultModel', 'llm', 'agentPresets',
  'workspaceRegistry', 'sessionPersistence', 'sessionTitle', 'attachments',
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
    imageModel: z.string().default('').description('generate_image 使用的生图模型'),
    timeoutMs: z.number().min(1000).max(600000).default(300000).description('中转站生图请求超时（毫秒）'),
  }).description('OpenAI 兼容中转站配置'),
  constraints: z.object({
    enabled: z.boolean().default(true).description('项目约束注入总开关'),
    fullTextPaths: z.array(z.string()).default(CONSTRAINTS_DEFAULT_PATHS).description('开发仓库路径清单：会话工作目录命中任一前缀即从首轮回注约束全文'),
  }).description('项目约束上下文注入配置（三层：常驻摘要保底/仓库信号全文/开发动作升级全文）'),
  pluginBrief: z.object({
    enabled: z.boolean().default(true).description('已安装插件功能总览注入开关'),
  }).description('插件能力总览：自动枚举本机安装的插件并把功能说明注入模型上下文'),
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
  '- zhipu_web_search / zhipu_web_reader / zhipu_zread_search / zhipu_zread_read_file / zhipu_zread_repo_structure：智谱 GLM Coding Plan 官方 MCP 工具（联网搜索/网页读取/开源仓库解读），消耗套餐每月 MCP 额度。',
  '- minimax_web_search / minimax_understand_image / minimax_image_generation / minimax_text_to_speech / minimax_video_generation：MiniMax Coding Plan 官方工具（联网搜索/图像理解/图像生成/语音合成/视频生成，图片支持本机路径与 http(s) URL），消耗 MiniMax 套餐额度。',
  '- 火山方舟 Agent Plan：天工造梦的 Coding Plan 页内支持 Plan API Key、官方文本模型池、推理档位，以及用控制面 AK/SK 查询的 5 小时/周/月用量看板。',
  '- OpenAI 中转站：Coding Plan 页内支持中转站地址、受管 API Key、GET /v1/models 模型发现与聊天路由，并由所选生图模型提供全局 generate_image 工具。',
  '- CNB 代码托管（cnb.cool，国内）：cnb_auth_add / cnb_auth_list / cnb_auth_test / cnb_repo_list / cnb_clone / cnb_pull / cnb_push / cnb_commit / cnb_status / cnb_auth_remove；平台仅支持 HTTPS+访问令牌（Git 用户名固定 cnb），令牌经临时 HTTP 头注入绝不进 URL，推送默认关闭需在天工造梦设置打开。',
  '- browser_tabs / browser_upload：管理同一可见 Chrome 的多标签页，并安全上传本机图片；多个会话共用持久登录档案。',
  '- xianyu_messages_list / xianyu_conversation_read：在独立消息标签页读取当前登录闲鱼账号的会话与消息；打开未读会话会触发已读状态。',
  '- xianyu_reply：仅在用户明确确认联系人和完整正文后真实发送，confirmation 必须绑定联系人，例如“确认发送给‘张三’”。',
  '- xianyu_publish：在独立发布标签页上传图片、填写商品信息并核验发布结果；真实发布必须传入“确认发布”。',
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
        timeoutMs: value.openai?.timeoutMs ?? storedOpenAi.timeoutMs ?? 300000,
      },
      constraints: {
        enabled: value.constraints?.enabled ?? true,
        fullTextPaths: value.constraints?.fullTextPaths?.length ? value.constraints.fullTextPaths : CONSTRAINTS_DEFAULT_PATHS,
      },
      pluginBrief: {
        enabled: value.pluginBrief?.enabled ?? true,
      },
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
  const zhipuConfig = { enabled: true, apiKeyEnv: 'ZAI_CODING_CN_API_KEY', timeoutMs: 15000, mcpTools: true }
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
  const zhipuService = new ZhipuCodingPlanService(ctx, zhipuConfig)
  const minimaxService = new MiniMaxService(ctx, minimaxConfig)
  const arkService = new ArkCodingPlanService(ctx, arkConfig)
  const openAiService = new OpenAiGatewayService(ctx, openAiConfig)

  // ---- 启动自动补齐：llm-pi-ai 就绪后把官方模型与推理档位写入设置；无变化时不产生写入。----
  let autoEnsureToken = 0
  const scheduleAutoEnsureModels = (): void => {
    const token = ++autoEnsureToken
    void (async () => {
      const ensureProviders = [
        () => openAiService.ensureProvider(),
        () => arkService.ensureModels(),
        () => zhipuService.ensureModels(),
        () => minimaxService.ensureModels(),
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

  /** 插件能力总览活表面：sync() 按开关挂/卸，验收路由读取当前注入文本。 */
  let pluginBriefSurface: { dispose: () => void; currentText: () => string } = { dispose: () => {}, currentText: () => '' }

  // ---- 可重挂表面（路由/工具/系统提示）----
  const routes = [
    ...makeRoutes(engine, standards, restartManager, () => ({ enabled: resolve().pluginBrief?.enabled ?? true, text: pluginBriefSurface.currentText() })),
    ...makeRemoteRoutes(remoteRegistry, new SshHostStore(), new WinrmHostStore()),
    // 智谱、MiniMax、火山方舟与运营浏览器的面板路由常驻基础路由组；未启用的能力返回明确 JSON 提示。
    ...makeZhipuRoutes(zhipuService),
    ...makeMiniMaxRoutes(minimaxService),
    ...makeArkRoutes(arkService),
    ...makeOpenAiRoutes(openAiService),
    ...makeCredentialsRoutes(),
    ...makeBackupRoutes(),
    ...makeBrowserRoutes(browserHolder),
  ]
  const tools = [devforgeJobsTool(engine), devforgeStandardsTool(standards), devforgeRestartTool(restartManager), backupNowTool(), backupStatusTool()]
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
    pluginBriefSurface.dispose()
    pluginBriefSurface = { dispose: () => {}, currentText: () => '' }
    backupScheduler.stop()
    // 本地浏览器能力随每次同步重建，先断开常驻路由的句柄。
    browserApi = undefined
    const value = resolve()
    if (!value.enabled) return
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
    // 项目约束三层注入：常驻摘要保底；cwd 命中开发仓库或出现开发动作时升级全文（0.11.0）。
    if (value.constraints?.enabled) {
      disposeConstraints = ctx.effect(() => {
        const service = new ConstraintInjectionService()
        safeActivate(ctx, '项目约束注入', () => service.start(ctx, () => {
          // 每次装配动态求值：配置热更新即时生效；局部变量保证可选链收窄。
          const constraints = resolve().constraints
          return {
            enabled: constraints?.enabled ?? true,
            fullTextPaths: constraints?.fullTextPaths?.length ? constraints.fullTextPaths : CONSTRAINTS_DEFAULT_PATHS,
          }
        }))
        return () => service.dispose()
      }, 'dsh-devforge: constraints')
    }
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
    // 智谱官方 MCP 工具：联网搜索/网页读取/Zread，凭据走受管引用，绝不落明文。
    safeActivate(ctx, '智谱 MCP 工具', () => {
      disposeZhipuMcp = activateZhipuMcpTools(ctx, { enabled: value.enabled === true && value.zhipu?.mcpTools !== false, apiKeyEnv: value.zhipu?.apiKeyEnv ?? 'ZAI_CODING_CN_API_KEY', timeoutMs: Math.max(value.zhipu?.timeoutMs ?? 15000, 30000) }, async () => {
        const resolved = await ctx.credentials.resolve(credentialRef(value.zhipu?.apiKeyEnv ?? 'ZAI_CODING_CN_API_KEY'))
        const apiKeyValue = resolved?.value.trim() ?? ''
        if (apiKeyValue === '') throw new Error('尚未配置智谱 Coding Plan API Key，无法调用官方 MCP 工具。')
        return apiKeyValue
      }).dispose
    })
    safeActivate(ctx, '远程运维', () => {
      const remoteActivation = activateRemote(ctx, value.remote ?? { enabled: false })
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
  }

  // ---- 设置面板接线（改配置即热更新）----
  scheduleSectionReadinessCheck(ctx)
  installSettingsSection(ctx, DEVFORGE_SETTINGS_NAMESPACE, Config, config ?? {}, {
    // schemastery 嵌套 object 的快照含 null 字段；规整成 Config 视图（?? 兜底）再交给 resolve()。
    setSource: (raw) => {
      const source = (): Config => {
        const value = raw() as Config & { remote?: { enabled?: boolean | null }; browser?: { enabled?: boolean | null; headless?: boolean | null; channel?: string | null; profileDir?: string | null; timeoutMs?: number | null }; github?: { enabled?: boolean | null }; cnb?: { enabled?: boolean | null }; feishu?: { enabled?: boolean | null }; zhipu?: { enabled?: boolean | null; apiKeyEnv?: string | null; timeoutMs?: number | null } }
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
            timeoutMs: value.openai?.timeoutMs ?? 300000,
          },
        }
      }
      current = source
      sync()
    },
    onChange: sync,
  })

  // 首次挂载
  sync()

  // 事件订阅兜底（engine 内部也订阅，这里幂等安全）
  ctx.effect(() => () => { /* 预留全局清理 */ }, 'dsh-devforge: lifecycle')

  // 导出围栏工具供测试（非公开 API）
  void isLoopbackRequest
}
