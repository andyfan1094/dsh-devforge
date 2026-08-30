/**
 * dsh-devforge —— 宿主半边入口。
 *
 * 职责（全部走官方 SDK，无 dsh 源码改动）：
 *   1. StandardsStore：加载插件内置开发规范库（standards/）；
 *   2. ForgeEngine：一键子代理服务生成（ctx.agents.create + followup）；
 *   3. /api/dsh-devforge 路由族（loopback 围栏）；
 *   4. devforge_jobs / devforge_standards 两个 Agent 工具；
 *   5. systemPrompt 常驻节：向每个 agent 通报规范库与一键生成入口。
 *
 * 浏览器半边（./client）负责侧边栏入口 + 仿 SSH 面板。
 * 生命周期：所有注册都包 ctx.effect，配置热更新时先卸旧再挂新（sync 模式）。
 */

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import z from 'schemastery'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-tools'
import { ForgeEngine, type ForgeHostServices } from './forge.ts'
import { isLoopbackRequest } from './loopback.ts'
import { activateFeishu, type FeishuCapabilityConfig } from './feishu/activate.ts'
import { activateGithub, type GithubCapabilityConfig } from './github/activate.ts'
import { activateRemote, type RemoteConfig } from './remote/activate.ts'
import { LegacyRemoteRegistry } from './remote/legacy-registry.ts'
import { makeRemoteRoutes } from './remote/routes.ts'
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
import { activateMiniMaxTools } from './minimax/tools.ts'
import { DshWebRestartManager } from './restart.ts'
import { StandardsStore } from './standards.ts'
import { devforgeJobsTool, devforgeRestartTool, devforgeStandardsTool } from './tools.ts'

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
  /** 飞书能力（兼容接管）子配置；bootstrap 字段与旧 dsh-feishu patch 行一致。 */
  feishu?: FeishuCapabilityConfig
  /** 智谱 Coding Plan 官方模型与额度能力。 */
  zhipu?: ZhipuCapabilityConfig & { mcpTools?: boolean }
  /** MiniMax Coding Plan 官方模型与工具能力。 */
  minimax?: MiniMaxCapabilityConfig
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
  '- minimax_web_search / minimax_understand_image：MiniMax Coding Plan 官方工具（联网搜索/图像理解，图片支持本机路径与 http(s) URL），消耗 MiniMax 套餐额度。',
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
  const DISABLED_BROWSER: BrowserStatus = { enabled: false, running: false, ready: false, profileDir: '', message: '浏览器能力未启用，请在服务工厂设置中开启' }
  let browserApi: Pick<BrowserRoutesService, 'status' | 'navigate' | 'snapshot' | 'screenshot' | 'stop'> | undefined
  const browserHolder: BrowserRoutesService = {
    enabled: false,
    status: async (): Promise<BrowserStatus> => browserApi === undefined ? DISABLED_BROWSER : await browserApi.status(),
    navigate: async (url: string) => {
      if (browserApi === undefined) throw new Error('浏览器能力未启用，请在服务工厂设置中开启')
      return await browserApi.navigate(url)
    },
    snapshot: async () => {
      if (browserApi === undefined) throw new Error('浏览器能力未启用，请在服务工厂设置中开启')
      return await browserApi.snapshot()
    },
    screenshot: async () => {
      if (browserApi === undefined) throw new Error('浏览器能力未启用，请在服务工厂设置中开启')
      return await browserApi.screenshot()
    },
    stop: async () => {
      if (browserApi === undefined) throw new Error('浏览器能力未启用，请在服务工厂设置中开启')
      return await browserApi.stop()
    },
  }

  // ---- 可重挂表面（路由/工具/系统提示）----
  const routes = [
    ...makeRoutes(engine, standards, restartManager),
    ...makeRemoteRoutes(remoteRegistry),
    // 智谱、MiniMax 与运营浏览器的面板路由常驻基础路由组；未启用的能力返回明确 JSON 提示。
    ...makeZhipuRoutes(new ZhipuCodingPlanService(ctx, zhipuConfig)),
    ...makeMiniMaxRoutes(new MiniMaxService(ctx, minimaxConfig)),
    ...makeBrowserRoutes(browserHolder),
  ]
  const tools = [devforgeJobsTool(engine), devforgeStandardsTool(standards), devforgeRestartTool(restartManager)]
  let disposeRoutes: (() => void) | undefined
  let disposeTools: (() => void) | undefined
  let disposeSection: (() => void) | undefined
  let disposeRemote: (() => void) | undefined
  let disposeGithub: (() => void) | undefined
  let disposeFeishu: (() => void) | undefined
  let disposeZhipuMcp: (() => void) | undefined
  let disposeMiniMaxTools: (() => void) | undefined
  let disposeBrowser: (() => void) | undefined

  const sync = (): void => {
    // 先卸旧（热更新安全）
    disposeSection?.(); disposeSection = undefined
    disposeRoutes?.(); disposeRoutes = undefined
    disposeTools?.(); disposeTools = undefined
    disposeRemote?.(); disposeRemote = undefined
    disposeGithub?.(); disposeGithub = undefined
    disposeFeishu?.(); disposeFeishu = undefined
    disposeZhipuMcp?.(); disposeZhipuMcp = undefined
    disposeMiniMaxTools?.(); disposeMiniMaxTools = undefined
    disposeBrowser?.(); disposeBrowser = undefined
    // 本地浏览器能力随每次同步重建，先断开常驻路由的句柄。
    browserApi = undefined
    const value = resolve()
    if (!value.enabled) return
    if (value.announceToAgent) {
      disposeSection = ctx.systemPrompt.section({ name: 'plugin:dsh-devforge', order: SECTION_ORDER, text: DEVFORGE_GUIDANCE })
    }
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
    // MiniMax 官方工具：联网搜索/图像理解，凭据走受管引用，绝不落明文。
    disposeMiniMaxTools = activateMiniMaxTools(ctx, {
      enabled: value.enabled && value.minimax?.tools !== false,
      apiKeyEnv: value.minimax?.apiKeyEnv ?? 'MINIMAX_CN_API_KEY',
      timeoutMs: Math.max(value.minimax?.timeoutMs ?? 30000, 10000),
    }, async () => {
      const resolved = await ctx.credentials.resolve(credentialRef(value.minimax?.apiKeyEnv ?? 'MINIMAX_CN_API_KEY'))
      const apiKeyValue = resolved?.value.trim() ?? ''
      if (apiKeyValue === '') throw new Error('尚未配置 MiniMax Coding Plan API Key，无法调用官方工具。')
      return apiKeyValue
    }).dispose
    // 智谱官方 MCP 工具：联网搜索/网页读取/Zread，凭据走受管引用，绝不落明文。
    disposeZhipuMcp = activateZhipuMcpTools(ctx, { enabled: value.enabled && value.zhipu?.mcpTools !== false, apiKeyEnv: value.zhipu?.apiKeyEnv ?? 'ZAI_CODING_CN_API_KEY', timeoutMs: Math.max(value.zhipu?.timeoutMs ?? 15000, 30000) }, async () => {
      const resolved = await ctx.credentials.resolve(credentialRef(value.zhipu?.apiKeyEnv ?? 'ZAI_CODING_CN_API_KEY'))
      const apiKeyValue = resolved?.value.trim() ?? ''
      if (apiKeyValue === '') throw new Error('尚未配置智谱 Coding Plan API Key，无法调用官方 MCP 工具。')
      return apiKeyValue
    }).dispose
    const remoteActivation = activateRemote(ctx, value.remote ?? { enabled: false })
    disposeRemote = remoteActivation.dispose
    // 本地浏览器：独立于远程运维，启用即注册 browser_* 工具。
    const browserActivation = activateBrowser(ctx, {
      enabled: value.enabled && value.browser?.enabled === true,
      headless: value.browser?.headless === true,
      channel: value.browser?.channel ?? 'chrome',
      profileDir: value.browser?.profileDir ?? '',
      timeoutMs: value.browser?.timeoutMs ?? 45000,
    })
    browserApi = browserActivation.browser
    disposeBrowser = browserActivation.dispose
    // GitHub 兼容接管：注册 github_* 工具与 /api/dsh-github 前缀；与旧插件互斥。
    disposeGithub = activateGithub(ctx, resolve().github ?? { enabled: false }).dispose
    // 飞书兼容接管：单 WSClient 铁律——切换期间旧 dsh-feishu 必须先禁用再启用这里。
    disposeFeishu = activateFeishu(ctx, resolve().feishu ?? { enabled: false }).dispose
  }

  // ---- 设置面板接线（改配置即热更新）----
  installSettingsSection(ctx, DEVFORGE_SETTINGS_NAMESPACE, Config, config ?? {}, {
    // schemastery 嵌套 object 的快照含 null 字段；规整成 Config 视图（?? 兜底）再交给 resolve()。
    setSource: (raw) => {
      const source = (): Config => {
        const value = raw() as Config & { remote?: { enabled?: boolean | null }; browser?: { enabled?: boolean | null; headless?: boolean | null; channel?: string | null; profileDir?: string | null; timeoutMs?: number | null }; github?: { enabled?: boolean | null }; feishu?: { enabled?: boolean | null }; zhipu?: { enabled?: boolean | null; apiKeyEnv?: string | null; timeoutMs?: number | null } }
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
