/**
 * 本地浏览器服务：一个可见 Chrome、一个持久档案、多标签页安全复用。
 *
 * 所有快照引用都会绑定标签页身份与快照代次。智能体后续点击或输入时，服务先校验
 * 引用是否仍有效，再自动切回所属标签页，避免多个会话交叉操作时点击落到错误页面。
 */
import { copyFile, mkdir, stat, unlink } from 'node:fs/promises'
import { basename, extname, isAbsolute, join } from 'node:path'
import { homedir } from 'node:os'
import { BROWSER_API, isSafeHttpUrl, type BrowserStatus } from './protocol.ts'
import { buildPlaywrightArgs, PlaywrightMcpStdio } from './mcp-stdio.ts'

/** Playwright MCP 当前版本的元素参数。 */
export function buildElementTargetArgs(ref: string): { element: string; target: string } {
  return { element: '快照元素 ' + ref, target: ref }
}

/** 浏览器 capability 的可配置项。 */
export interface BrowserCapabilityConfig {
  enabled: boolean
  /** 无头模式默认关闭：操作过程必须在用户屏幕实时可见。 */
  headless: boolean
  /** 浏览器通道：chrome / msedge / chromium。 */
  channel: string
  /** 持久化用户档案目录；留空时使用默认路径。 */
  profileDir: string
  timeoutMs: number
}

/** Playwright MCP 标签页清单的一项。 */
export interface BrowserTabEntry {
  index: number
  current: boolean
  title: string
  url: string
}

/** 标签页内部绑定；id 不随普通标签切换变化。 */
interface TabBinding {
  id: number
  index: number
  url: string
  generation: number
}

/** 服务工厂作用域元素引用。 */
export interface ScopedElementRef {
  tabId: number
  generation: number
  rawRef: string
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

/** 解析 Playwright MCP 0.0.79 的多标签页清单。 */
export function parseBrowserTabs(lines: string): BrowserTabEntry[] {
  const tabs: BrowserTabEntry[] = []
  for (const line of lines.split('\n')) {
    const match = line.trim().match(/^- (\d+):\s*(\(current\)\s*)?\[([^\]]*)\]\(([^)]+)\)$/)
    if (match === null) continue
    tabs.push({ index: Number(match[1]), current: match[2] !== undefined, title: match[3]!.trim(), url: match[4]!.trim() })
  }
  return tabs
}

/** 从页面清单中取当前页信息；兼容历史 browser_tab_list 文本。 */
export function pickCurrentTab(lines: string): { currentUrl?: string; pageTitle?: string } {
  const tabs = parseBrowserTabs(lines)
  const current = tabs.find((tab) => tab.current) ?? tabs[0]
  if (current !== undefined) return { pageTitle: current.title, currentUrl: current.url }
  for (const line of lines.split('\n')) {
    const legacy = line.match(/- \d+\.\s*\[([^\]]*)\]\s*(\S+)(?:\s+\(.*\))?/)
    if (legacy !== null) return { pageTitle: legacy[1]!.trim(), currentUrl: legacy[2]!.trim() }
  }
  return {}
}

/** 给 MCP 原始引用增加标签页与快照代次。 */
export function scopeSnapshotRefs(snapshot: string, tabId: number, generation: number): string {
  return snapshot.replace(/\[ref=([^\]]+)\]/g, (whole, ref: string) => {
    if (/^t\d+g\d+:/.test(ref)) return whole
    return '[ref=t' + tabId + 'g' + generation + ':' + ref + ']'
  })
}

/** 解析服务工厂作用域引用；普通原始引用用于内部兼容。 */
export function parseScopedElementRef(ref: string): ScopedElementRef | undefined {
  const match = ref.match(/^t(\d+)g(\d+):(.+)$/)
  if (match === null) return undefined
  return { tabId: Number(match[1]), generation: Number(match[2]), rawRef: match[3]! }
}

/** 本地浏览器服务：启动/停止 playwright-mcp 并映射安全页面操作。 */
export class BrowserService {
  private client: PlaywrightMcpStdio | undefined
  private operationTail: Promise<void> = Promise.resolve()
  private readonly tabBindings = new Map<number, TabBinding>()
  private nextTabId = 1
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

  /** Host 级互斥队列：所有智能体共用，防止“切页 + 操作”交叉。 */
  async withExclusive<T>(operation: () => Promise<T>): Promise<T> {
    let release: (() => void) | undefined
    const previous = this.operationTail
    this.operationTail = new Promise<void>((resolve) => { release = resolve })
    await previous
    try { return await operation() }
    finally { release?.() }
  }

  /** 被动读取状态：不拉起浏览器进程。 */
  async status(): Promise<BrowserStatus> {
    if (!this.resolved.enabled) return { enabled: false, running: false, ready: false, profileDir: this.resolved.profileDir, message: '浏览器能力未启用，请在服务工厂设置中开启' }
    if (this.client === undefined || !this.client.running) {
      return { enabled: true, running: false, ready: false, profileDir: this.resolved.profileDir, message: '浏览器未启动；使用打开/导航等操作时会自动拉起' }
    }
    try {
      const tabs = await this.client.callTool('browser_tabs', { action: 'list' })
      return { enabled: true, running: true, ready: true, profileDir: this.resolved.profileDir, ...pickCurrentTab(tabs.text) }
    } catch (error) {
      return { enabled: true, running: true, ready: false, profileDir: this.resolved.profileDir, message: this.safeError(error) }
    }
  }

  /** 在当前标签页跳转；高层通用工具默认使用 openTab，避免覆盖其它任务页面。 */
  async navigate(url: string): Promise<string> {
    if (!isSafeHttpUrl(url)) throw new Error('只允许打开 http(s) 地址')
    const result = await this.ensureClient().callTool('browser_navigate', { url })
    if (result.isError) throw new Error(this.safeError(result.text))
    return await this.scopeCurrentSnapshot(result.text)
  }

  /** 新建独立标签页并返回带标签身份的快照。 */
  async openTab(url: string): Promise<string> {
    await this.tabs('new', undefined, url)
    return await this.snapshot()
  }

  /** 读取当前页或指定作用域引用所属页的快照。 */
  async snapshot(scopedRef?: string): Promise<string> {
    if (scopedRef !== undefined) await this.selectScopedRef(scopedRef)
    const result = await this.ensureClient().callTool('browser_snapshot', {})
    if (result.isError) throw new Error(this.safeError(result.text))
    return await this.scopeCurrentSnapshot(result.text)
  }

  /** 点击引用所属标签页的元素；过期或失配时拒绝操作。 */
  async click(ref: string): Promise<string> {
    const rawRef = await this.selectScopedRef(ref)
    const result = await this.ensureClient().callTool('browser_click', buildElementTargetArgs(rawRef))
    if (result.isError) throw new Error(this.safeError(result.text))
    const snapshot = await this.ensureClient().callTool('browser_snapshot', {})
    if (snapshot.isError) throw new Error(this.safeError(snapshot.text))
    return await this.scopeCurrentSnapshot(snapshot.text)
  }

  /** 向引用所属标签页输入文本。 */
  async type(ref: string, text: string, submit = false): Promise<string> {
    const rawRef = await this.selectScopedRef(ref)
    const result = await this.ensureClient().callTool('browser_type', { ...buildElementTargetArgs(rawRef), text, submit })
    if (result.isError) throw new Error(this.safeError(result.text))
    return result.text
  }

  /** 管理同一可见浏览器中的标签页。关闭标签时全部旧引用失效，避免索引漂移误操作。 */
  async tabs(action: 'list' | 'new' | 'close' | 'select', index?: number, url?: string): Promise<string> {
    const args: Record<string, unknown> = { action }
    if (index !== undefined) args.index = index
    if (url !== undefined) {
      if (!isSafeHttpUrl(url)) throw new Error('新标签页只允许打开 http(s) 地址')
      args.url = url
    }
    const result = await this.ensureClient().callTool('browser_tabs', args)
    if (result.isError) throw new Error(this.safeError(result.text))
    if (action === 'close') this.tabBindings.clear()
    return result.text
  }

  /** 点击指定上传入口并在同一原子操作内上传图片。 */
  async clickAndUpload(ref: string, filePath: string): Promise<string> {
    const rawRef = await this.selectScopedRef(ref)
    const clickResult = await this.ensureClient().callTool('browser_click', buildElementTargetArgs(rawRef))
    if (clickResult.isError) throw new Error(this.safeError(clickResult.text))
    return await this.upload(filePath)
  }

  /** 将本机图片安全暂存后上传；可选引用用于先切回文件选择器所属标签页。 */
  async upload(filePath: string, scopedRef?: string): Promise<string> {
    if (scopedRef !== undefined) await this.selectScopedRef(scopedRef)
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

  /** 截取当前页或指定引用所属页的 PNG。 */
  async screenshot(scopedRef?: string): Promise<string> {
    if (scopedRef !== undefined) await this.selectScopedRef(scopedRef)
    const result = await this.ensureClient().callTool('browser_take_screenshot', { type: 'png' })
    if (result.isError) throw new Error(this.safeError(result.text))
    if (result.image === undefined) throw new Error('浏览器未返回截图数据')
    return 'data:' + result.image.mimeType + ';base64,' + result.image.data
  }

  /** 停止浏览器会话；持久档案保留，全部旧引用失效。 */
  async stop(): Promise<void> {
    this.client?.stop()
    this.client = undefined
    this.tabBindings.clear()
  }

  /** 卸载钩子。 */
  dispose(): void { void this.stop() }

  /** 为当前页创建或刷新绑定，并将所有原始引用改写为作用域引用。 */
  private async scopeCurrentSnapshot(snapshot: string): Promise<string> {
    const tabs = await this.currentTabs()
    const current = tabs.find((tab) => tab.current) ?? tabs[0]
    if (current === undefined) return snapshot
    let binding = [...this.tabBindings.values()].find((candidate) => candidate.index === current.index && candidate.url === current.url)
    if (binding === undefined) {
      binding = { id: this.nextTabId++, index: current.index, url: current.url, generation: 0 }
      this.tabBindings.set(binding.id, binding)
    }
    binding.generation += 1
    return scopeSnapshotRefs(snapshot, binding.id, binding.generation)
  }

  /** 校验作用域引用并选择其标签页；普通引用仅供同一原子流程内部兼容。 */
  private async selectScopedRef(ref: string): Promise<string> {
    const scoped = parseScopedElementRef(ref)
    if (scoped === undefined) return ref
    const binding = this.tabBindings.get(scoped.tabId)
    if (binding === undefined || binding.generation !== scoped.generation) throw new Error('浏览器元素引用已失效，请重新读取该标签页快照')

    const tabs = await this.currentTabs()
    let target = tabs.find((tab) => tab.index === binding.index && tab.url === binding.url)
    if (target === undefined) {
      const sameUrl = tabs.filter((tab) => tab.url === binding.url)
      if (sameUrl.length !== 1) throw new Error('浏览器标签页已关闭或发生变化，请重新打开页面并读取快照')
      target = sameUrl[0]
      binding.index = target!.index
    }
    if (!target!.current) await this.tabs('select', target!.index)
    return scoped.rawRef
  }

  /** 读取当前标签清单。 */
  private async currentTabs(): Promise<BrowserTabEntry[]> {
    const result = await this.ensureClient().callTool('browser_tabs', { action: 'list' })
    if (result.isError) throw new Error(this.safeError(result.text))
    return parseBrowserTabs(result.text)
  }

  /** 懒建立客户端；同一个 BrowserService 永远只维护一个 MCP 进程。 */
  private ensureClient(): PlaywrightMcpStdio {
    if (this.client === undefined || !this.client.running) {
      this.tabBindings.clear()
      this.client = new PlaywrightMcpStdio('npx', buildPlaywrightArgs({ headless: this.resolved.headless, channel: this.resolved.channel, profileDir: this.resolved.profileDir, outputDir: this.resolved.outputDir }), this.resolved.timeoutMs)
    }
    return this.client
  }

  /** 对外错误摘要不包含路径、Cookie 或进程参数。 */
  private safeError(error: unknown): string {
    const text = error instanceof Error ? error.message : String(error)
    return text.replace(/\s+/g, ' ').slice(0, 300)
  }
}

/** 面板路由使用的最小服务面。 */
export type BrowserRoutesService = Pick<BrowserService, 'status' | 'navigate' | 'snapshot' | 'screenshot' | 'stop'> & { enabled: boolean }

export { BROWSER_API }
