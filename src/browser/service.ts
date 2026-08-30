/**
 * 本地浏览器服务 —— 封装 playwright-mcp 子进程，向面板与 Agent 提供无密浏览器操作。
 *
 * 边界：浏览器进程运行在本机用户会话中，操作实时可见；固定用户档案目录
 * 保存登录状态；所有方法只返回页面快照文本或截图数据，不暴露进程参数之外的任何系统信息。
 */
import { copyFile, mkdir, stat, unlink } from 'node:fs/promises'
import { basename, extname, isAbsolute, join } from 'node:path'
import { homedir } from 'node:os'
import { BROWSER_API, isSafeHttpUrl, type BrowserStatus } from './protocol.ts'
import { buildPlaywrightArgs, PlaywrightMcpStdio } from './mcp-stdio.ts'

/**
 * 把 DSH 快照引用转换为 Playwright MCP 当前版本的元素参数。
 * Playwright MCP 0.0.79 起使用 target，旧版 ref 字段会导致点击与输入失败。
 */
export function buildElementTargetArgs(ref: string): { element: string; target: string } {
  return { element: '快照元素 ' + ref, target: ref }
}

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
export function pickCurrentTab(lines: string): { currentUrl?: string; pageTitle?: string } {
  const tabLines = lines.split('\n').filter((line) => /^- \d+:/.test(line.trim()))
  const selected = tabLines.find((line) => line.includes('(current)')) ?? tabLines[0]
  if (selected !== undefined) {
    const current = selected.match(/- \d+:\s*(?:\(current\)\s*)?\[([^\]]*)\]\(([^)]+)\)/)
    if (current !== null) return { pageTitle: current[1]!.trim(), currentUrl: current[2]!.trim() }
  }
  for (const line of lines.split('\n')) {
    const legacy = line.match(/- \d+\.\s*\[([^\]]*)\]\s*(\S+)(?:\s+\(.*\))?/)
    if (legacy !== null) return { pageTitle: legacy[1]!.trim(), currentUrl: legacy[2]!.trim() }
  }
  return {}
}

/** 本地浏览器服务：启动/停止 playwright-mcp 并映射常用页面操作。 */
export class BrowserService {
  private client: PlaywrightMcpStdio | undefined
  private operationTail: Promise<void> = Promise.resolve()
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

  /**
   * 将跨页面操作串行化；多个会话可以排队，但不能同时操控同一个可见页面。
   */
  async withExclusive<T>(operation: () => Promise<T>): Promise<T> {
    let release: (() => void) | undefined
    const previous = this.operationTail
    this.operationTail = new Promise<void>((resolve) => { release = resolve })
    await previous
    try {
      return await operation()
    } finally {
      release?.()
    }
  }

  /** 被动读取状态：不拉起浏览器进程。 */
  async status(): Promise<BrowserStatus> {
    if (!this.resolved.enabled) return { enabled: false, running: false, ready: false, profileDir: this.resolved.profileDir, message: '浏览器能力未启用，请在服务工厂设置中开启' }
    if (this.client === undefined || !this.client.running) {
      return { enabled: true, running: false, ready: false, profileDir: this.resolved.profileDir, message: '浏览器未启动；使用打开/导航等操作时会自动拉起' }
    }
    try {
      const tabs = await this.client.callTool('browser_tabs', { action: 'list' })
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
    const result = await this.ensureClient().callTool('browser_click', buildElementTargetArgs(ref))
    if (result.isError) throw new Error(this.safeError(result.text))
    return result.text
  }

  /** 向快照元素输入文本，可选回车提交。 */
  async type(ref: string, text: string, submit = false): Promise<string> {
    const result = await this.ensureClient().callTool('browser_type', { ...buildElementTargetArgs(ref), text, submit })
    if (result.isError) throw new Error(this.safeError(result.text))
    return result.text
  }

  /** 管理同一可见浏览器中的标签页；调用方必须在互斥区内切换和操作。 */
  async tabs(action: 'list' | 'new' | 'close' | 'select', index?: number, url?: string): Promise<string> {
    const args: Record<string, unknown> = { action }
    if (index !== undefined) args.index = index
    if (url !== undefined) {
      if (!isSafeHttpUrl(url)) throw new Error('新标签页只允许打开 http(s) 地址')
      args.url = url
    }
    const result = await this.ensureClient().callTool('browser_tabs', args)
    if (result.isError) throw new Error(this.safeError(result.text))
    return result.text
  }

  /**
   * 将本机图片暂存到 MCP 允许的输出目录后上传；不把任意路径直接交给浏览器进程。
   */
  async upload(filePath: string): Promise<string> {
    if (!isAbsolute(filePath)) throw new Error('商品图片必须是本机绝对路径')
    const extension = extname(filePath).toLowerCase()
    if (!['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(extension)) throw new Error('商品图片仅支持 png、jpg、jpeg、webp 或 gif')
    const file = await stat(filePath)
    if (!file.isFile()) throw new Error('商品图片不是普通文件')
    if (file.size > 20 * 1024 * 1024) throw new Error('商品图片不能超过 20 MB')
    await mkdir(this.resolved.outputDir, { recursive: true })
    const safeName = basename(filePath).replace(/[^a-zA-Z0-9._-]/g, '_') || 'image' + extension
    const stagedPath = join(this.resolved.outputDir, 'upload-' + Date.now() + '-' + safeName)
    await copyFile(filePath, stagedPath)
    try {
      const result = await this.ensureClient().callTool('browser_file_upload', { paths: [stagedPath] })
      if (result.isError) throw new Error(this.safeError(result.text))
      return result.text
    } finally {
      try { await unlink(stagedPath) } catch { /* 临时文件已被移除时忽略 */ }
    }
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
