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
import { StandardsStore } from './standards.ts'
import { devforgeJobsTool, devforgeStandardsTool } from './tools.ts'

/** cordis 插件名（稳定 id）。 */
export const name = 'devforge'

/**
 * 前置服务：核心工厂使用路由、工具和子代理；飞书接管还依赖模型目录、会话持久化、
 * 标题和附件服务。这里必须保持与原 dsh-feishu 注入集合一致，避免能力延迟到运行时才报错。
 */
export const inject = [
  'webServer', 'tools', 'systemPrompt', 'agents', 'agentDefaultModel', 'llm', 'agentPresets',
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
  /** GitHub 能力（兼容接管）子配置。 */
  github?: GithubCapabilityConfig
  /** 飞书能力（兼容接管）子配置；bootstrap 字段与旧 dsh-feishu patch 行一致。 */
  feishu?: FeishuCapabilityConfig
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
  github: z.object({
    enabled: z.boolean().default(true).description('GitHub 能力（兼容接管）开关'),
  }).description('GitHub 配置'),
  feishu: z.object({
    enabled: z.boolean().default(true).description('飞书能力（兼容接管）开关；启用前必须停用旧 dsh-feishu'),
  }).description('飞书配置'),
}).description('dsh-devforge 配置')

/** 系统提示通报顺序（靠后，避免抢核心指令位置）。 */
const SECTION_ORDER = 500

/** 向 agent 通报的能力说明文本。 */
const DEVFORGE_GUIDANCE = [
  '本机安装了 dsh-devforge 插件（规范驱动服务生成）：',
  '- devforge_standards 工具：列出/读取内置开发规范（写代码前先查对应规范）。',
  '- devforge_jobs 工具：一键按规范创建服务生成子代理（action=create，需 templateId+targetDir）。',
  '- 用户说"一键生成服务/按规范建服务"时即指本插件；生成任务进度见 Web 面板（devforge 侧边栏入口）。',
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
      github: { enabled: value.github?.enabled ?? false },
      feishu: { enabled: value.feishu?.enabled ?? false },
    }
  }

  // ---- 核心对象 ----
  // 规范库根目录 = 本文件上级的 standards/（lib/index.js → ../standards）
  const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
  const standards = new StandardsStore(join(pluginRoot, 'standards'))
  // 第一阶段只读桥接旧 SSH/WinRM store；不搬运、不回写任何凭据。
  const remoteRegistry = new LegacyRemoteRegistry()
  const engine = new ForgeEngine(ctx, ctx as unknown as ForgeHostServices, standards, join(pluginRoot, '.devforge'))
  ctx.effect(() => () => { engine.dispose() }, 'dsh-devforge: engine')

  // ---- 可重挂表面（路由/工具/系统提示）----
  const routes = [...makeRoutes(engine, standards), ...makeRemoteRoutes(remoteRegistry)]
  const tools = [devforgeJobsTool(engine), devforgeStandardsTool(standards)]
  let disposeRoutes: (() => void) | undefined
  let disposeTools: (() => void) | undefined
  let disposeSection: (() => void) | undefined
  let disposeRemote: (() => void) | undefined
  let disposeGithub: (() => void) | undefined
  let disposeFeishu: (() => void) | undefined

  const sync = (): void => {
    // 先卸旧（热更新安全）
    disposeSection?.(); disposeSection = undefined
    disposeRoutes?.(); disposeRoutes = undefined
    disposeTools?.(); disposeTools = undefined
    disposeRemote?.(); disposeRemote = undefined
    disposeGithub?.(); disposeGithub = undefined
    disposeFeishu?.(); disposeFeishu = undefined
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
    disposeRemote = activateRemote(ctx, resolve().remote ?? { enabled: false }).dispose
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
        const value = raw() as Config & { remote?: { enabled?: boolean | null }; github?: { enabled?: boolean | null }; feishu?: { enabled?: boolean | null } }
        return {
          enabled: value.enabled ?? undefined,
          announceToAgent: value.announceToAgent ?? undefined,
          // 子能力开关：未配置一律 false（安全默认），与 resolve() 兜底一致。
          remote: { enabled: value.remote?.enabled === true },
          github: { enabled: value.github?.enabled === true },
          feishu: { enabled: value.feishu?.enabled === true },
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
