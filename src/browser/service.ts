/**
 * 本地浏览器服务 —— 封装 playwright-mcp 子进程，向面板与 Agent 提供无密浏览器操作。
 *
 * 边界：浏览器进程运行在本机用户会话中，操作实时可见；固定用户档案目录
 * 保存登录状态；所有方法只返回页面快照文本或截图数据，不暴露进程参数之外的任何系统信息。
 */
import { join } from 'node:path'
import { homedir } from 'node:os'
import { BROWSER_API, isSafeHttpUrl, type BrowserStatus } from './protocol.ts'
import { buildPlaywrightArgs, PlaywrightMcpStdio } from './mcp-stdio.ts'

/** 浏览器 capability 的可配置项。 */
export interface BrowserCapabilityConfig {
  enabled: boolean
  /** 无头模式默认关闭：用户要求操作过程实时可见。 */
  headless: boolean
  /** 浏览器通道：chrome / msedge / chromium。 */
  channel: string
  /** 持久化用户档案目录；留空时使用默认路径。 */
  profileDir: string
  timeoutMs: number
}

/** 解析生效配置：补默认档案目录，收敛非法通道名。 */
export function normalizeBrowserConfig(config: BrowserCapabilityConfig): Required<Omit<BrowserCapabilityConfig, 'profileDir'>> & { profileDir: string; outputDir: string } {
  const channel = ['chrome', 'msedge', 'chromium'].includes(config.channel) ? config.channel : 'chrome'
  const profileDir = config.profileDir.trim() === '' ? join(homedir(), '.dsh', 'devforge', 'browser-profile') : config.profileDir
  return {
    enabled: config.enabled,
    headless: config.headless === true,
    channel,
    profileDir,
    outputDir: profileDir + '-output',
    timeoutMs: Math.min(Math.max(config.timeoutMs, 5000), 120000),
  }
}

/** 从 playwright-mcp 页面清单中取当前页信息；解析失败不视为错误。 */
function pickCurrentTab(lines: string): { currentUrl?: string; pageTitle?: string } {
  for (const line of lines.split('\n')) {
    const match = line.match(/- \d+\.\s*\[([^\]]*)\]\s*(\S+)(?:\s+\(.*\))?/)
    if (match !== null) return { pageTitle: match[1]!.trim(), currentUrl: match[2]!.trim() }
  }
  return {}
}

/** 本地浏览器服务：启动/停止 playwright-mcp 并映射常用页面操作。 */
export class BrowserService {
  private client: PlaywrightMcpStdio | undefined
  private readonly resolved: ReturnType<typeof normalizeBrowserConfig>

  constructor(config: BrowserCapabilityConfig) {
    this.resolved = normalizeBrowserConfig(config)
  }

  /** 生效配置（面板展示用，无敏感字段）。 */
  get config(): { headless: boolean; channel: string; profileDir: string; timeoutMs: number } {
    return { headless: this.resolved.headless, channel: this.resolved.channel, profileDir: this.resolved.profileDir, timeoutMs: this.resolved.timeoutMs }
  }

  /** 是否启用。 */
  get enabled(): boolean { return this.resolved.enabled }

  /** 被动读取状态：不拉起浏览器进程。 */
  async status(): Promise<BrowserStatus> {
    if (!this.resolved.enabled) return { enabled: false, running: false, ready: false, profileDir: this.resolved.profileDir, message: '浏览器能力未启用，请在服务工厂设置中开启' }
    if (this.client === undefined || !this.client.running) {
      return { enabled: true, running: false, ready: false, profileDir: this.resolved.profileDir, message: '浏览器未启动；使用打开/导航等操作时会自动拉起' }
    }
    try {
      const tabs = await this.client.callTool('browser_tab_list', {})
      const current = pickCurrentTab(tabs.text)
      return { enabled: true, running: true, ready: true, profileDir: this.resolved.profileDir, ...current }
    } catch (error) {
      return { enabled: true, running: true, ready: false, profileDir: this.resolved.profileDir, message: this.safeError(error) }
    }
  }

  /** 打开或跳转当前页；playwright-mcp 会随响应返回页面快照。 */
  async navigate(url: string): Promise<string> {
    if (!isSafeHttpUrl(url)) throw new Error('只允许打开 http(s) 地址')
    const result = await this.ensureClient().callTool('browser_navigate', { url })
    if (result.isError) throw new Error(this.safeError(result.text))
    return result.text
  }

  /** 读取当前页无障碍快照（含元素引用）。 */
  async snapshot(): Promise<string> {
    const result = await this.ensureClient().callTool('browser_snapshot', {})
    if (result.isError) throw new Error(this.safeError(result.text))
    return result.text
  }

  /** 点击快照中的元素引用。 */
  async click(ref: string): Promise<string> {
    const result = await this.ensureClient().callTool('browser_click', { element: '快照元素 ' + ref, ref })
    if (result.isError) throw new Error(this.safeError(result.text))
    return result.text
  }

  /** 向快照元素输入文本，可选回车提交。 */
  async type(ref: string, text: string, submit = false): Promise<string> {
    const result = await this.ensureClient().callTool('browser_type', { element: '快照元素 ' + ref, ref, text, submit })
    if (result.isError) throw new Error(this.safeError(result.text))
    return result.text
  }

  /** 截取当前页 PNG，返回面板可直接显示的 data URL。 */
  async screenshot(): Promise<string> {
    const result = await this.ensureClient().callTool('browser_take_screenshot', { type: 'png' })
    if (result.isError) throw new Error(this.safeError(result.text))
    if (result.image === undefined) throw new Error('浏览器未返回截图数据')
    return 'data:' + result.image.mimeType + ';base64,' + result.image.data
  }

  /** 停止浏览器会话；用户档案保留，登录状态不丢失。 */
  async stop(): Promise<void> {
    this.client?.stop()
    this.client = undefined
  }

  /** 卸载钩子：与 stop 一致，档案保留。 */
  dispose(): void { void this.stop() }

  /** 懒建立客户端；npx 首次拉包较慢，启动超时单独放宽。 */
  private ensureClient(): PlaywrightMcpStdio {
    if (this.client === undefined || !this.client.running) {
      this.client = new PlaywrightMcpStdio('npx', buildPlaywrightArgs({ headless: this.resolved.headless, channel: this.resolved.channel, profileDir: this.resolved.profileDir, outputDir: this.resolved.outputDir }), this.resolved.timeoutMs)
    }
    return this.client
  }

  /** 错误安全摘要：换行压成一行并限长，避免污染面板与模型上下文。 */
  private safeError(error: unknown): string {
    const text = error instanceof Error ? error.message : String(error)
    return text.replace(/\s+/g, ' ').slice(0, 300)
  }
}

/** 面板路由使用的服务面。 */
export type BrowserRoutesService = Pick<BrowserService, 'status' | 'navigate' | 'snapshot' | 'screenshot' | 'stop'> & { enabled: boolean }

export { BROWSER_API }
