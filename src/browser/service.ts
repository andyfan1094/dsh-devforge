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
  /** 打开来源：通用工具或某个专用流程；用于闲置评估与定向清理。 */
  origin: string
  /** 最后一次被快照或操作的时间；闲置评估的依据。 */
  lastActivityAt: number
}

/** 天工造梦作用域元素引用。 */
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

/** 解析天工造梦作用域引用；普通原始引用用于内部兼容。 */
export function parseScopedElementRef(ref: string): ScopedElementRef | undefined {
  const match = ref.match(/^t(\d+)g(\d+):(.+)$/)
  if (match === null) return undefined
  return { tabId: Number(match[1]), generation: Number(match[2]), rawRef: match[3]! }
}

/** 标签页打开来源：通用工具、专用发布流程与闲鱼消息常驻页。 */
export const TAB_ORIGIN_GENERAL = 'general'
export const TAB_ORIGIN_XHS_PUBLISH = 'xhs-publish'
export const TAB_ORIGIN_XIANYU_PUBLISH = 'xianyu-publish'
export const TAB_ORIGIN_XIANYU_MESSAGE = 'xianyu-message'

/** 发布类任务标签页：用完即关，流程失败残留的可被 close_idle 回收。 */
export const TASK_TAB_ORIGINS = [TAB_ORIGIN_XHS_PUBLISH, TAB_ORIGIN_XIANYU_PUBLISH]
/** 常驻标签页来源：跨会话复用，close_idle 永不自动关闭。 */
export const PROTECTED_TAB_ORIGINS = [TAB_ORIGIN_XIANYU_MESSAGE]
/** 闲置评估默认阈值：超过 10 分钟未操作才建议关闭。 */
export const DEFAULT_TAB_IDLE_MS = 10 * 60_000
/** pendingOrigin 的有效窗口：防止失败流程遗留的来源标记污染后续标签页。 */
const PENDING_ORIGIN_TTL_MS = 30_000

/** 与当前标签页清单对上的绑定记录（评估建议的输入）。 */
export interface TabRecord {
  index: number
  url: string
  origin: string
  lastActivityAt: number
}

/** 单个标签页的清理建议。 */
export type TabSuggestion = 'keep' | 'review' | 'clean' | 'unknown'

/** 评估结果里单个标签页的展示条目。 */
export interface TabAdviceItem {
  index: number
  current: boolean
  title: string
  url: string
  origin: string | undefined
  idleSeconds: number | undefined
  suggestion: TabSuggestion
  note: string
}

/** 一次标签页清理评估：展示建议 + 可安全关闭的序号（降序）。 */
export interface TabCleanupEvaluation {
  advice: TabAdviceItem[]
  closeIndexes: number[]
}

/** 把来源标记翻译成面板与快照建议里的中文名称。 */
export function describeTabOrigin(origin: string | undefined): string {
  switch (origin) {
    case TAB_ORIGIN_GENERAL: return '通用'
    case TAB_ORIGIN_XHS_PUBLISH: return '小红书发布'
    case TAB_ORIGIN_XIANYU_PUBLISH: return '闲鱼发布'
    case TAB_ORIGIN_XIANYU_MESSAGE: return '闲鱼消息'
    default: return '未知'
  }
}

/** 评估每个标签页是否该关闭：未知来源只提示、常驻页保留、任务残留可清理、通用页交模型评估。 */
export function evaluateTabCleanup(tabs: BrowserTabEntry[], records: TabRecord[], options: { now: number; minIdleMs: number; includeGeneral?: boolean }): TabCleanupEvaluation {
  const advice: TabAdviceItem[] = []
  for (const tab of tabs) {
    const record = records.find(candidate => candidate.index === tab.index && candidate.url === tab.url)
    const idleSeconds = record === undefined ? undefined : Math.max(0, Math.floor((options.now - record.lastActivityAt) / 1000))
    const idle = idleSeconds === undefined ? Infinity : idleSeconds
    let suggestion: TabSuggestion
    let note: string
    if (record === undefined) {
      suggestion = 'unknown'
      note = '未跟踪（可能是手动打开），关闭前请先与用户确认'
    } else if (PROTECTED_TAB_ORIGINS.includes(record.origin)) {
      suggestion = 'keep'
      note = '常驻保留'
    } else if (TASK_TAB_ORIGINS.includes(record.origin)) {
      if (idle >= options.minIdleMs / 1000) {
        suggestion = 'clean'
        note = '任务残留：可用 browser_tabs action=close_idle 一键清理'
      } else {
        suggestion = 'keep'
        note = '任务进行中'
      }
    } else if (idle >= options.minIdleMs / 1000) {
      suggestion = 'review'
      note = '建议评估：本任务用完请关闭（browser_tabs action=close index=' + tab.index + '）'
    } else {
      suggestion = 'keep'
      note = '近期仍在使用'
    }
    advice.push({ index: tab.index, current: tab.current, title: tab.title, url: tab.url, origin: record?.origin, idleSeconds, suggestion, note })
  }
  const closeIndexes = advice
    .filter(item => item.suggestion === 'clean' || (options.includeGeneral === true && item.suggestion === 'review'))
    .map(item => item.index)
    .sort((left, right) => right - left)
  return { advice, closeIndexes }
}

/** 把评估结果渲染成附加在 browser_tabs list 输出后的中文建议；无标签页时返回空串。 */
export function renderTabAdvice(advice: TabAdviceItem[]): string {
  if (advice.length === 0) return ''
  const lines = advice.map(item => {
    const idle = item.idleSeconds === undefined ? '空闲=未知' : '空闲=' + item.idleSeconds + '秒'
    const origin = item.origin === undefined ? '来源=未知' : '来源=' + describeTabOrigin(item.origin)
    return '- ' + item.index + ':' + (item.current ? ' (current) ' : ' ') + '[' + item.title + '](' + item.url + ') ' + origin + ' ' + idle + ' → ' + item.note
  })
  return ['### 标签页评估', ...lines].join('\n')
}

/** 本地浏览器服务：启动/停止 playwright-mcp 并映射安全页面操作。 */
export class BrowserService {
  private client: PlaywrightMcpStdio | undefined
  private operationTail: Promise<void> = Promise.resolve()
  private readonly tabBindings = new Map<number, TabBinding>()
  private nextTabId = 1
  /** 下一次创建绑定时采用的来源标记；由 tabs('new') 设置，首个快照消费。 */
  private pendingOrigin: { origin: string; at: number } | undefined
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
    if (!this.resolved.enabled) return { enabled: false, running: false, ready: false, profileDir: this.resolved.profileDir, message: '浏览器能力未启用，请在天工造梦设置中开启' }
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

  /** 管理同一可见浏览器中的标签页。关闭标签后清理已消失的绑定，避免索引漂移误操作。 */
  async tabs(action: 'list' | 'new' | 'close' | 'select', index?: number, url?: string, origin?: string): Promise<string> {
    const args: Record<string, unknown> = { action }
    if (index !== undefined) args.index = index
    if (url !== undefined) {
      if (!isSafeHttpUrl(url)) throw new Error('新标签页只允许打开 http(s) 地址')
      args.url = url
    }
    if (action === 'new') {
      const normalizedOrigin = typeof origin === 'string' && origin.trim() !== '' ? origin.trim() : TAB_ORIGIN_GENERAL
      this.pendingOrigin = { origin: normalizedOrigin, at: Date.now() }
    }
    const result = await this.ensureClient().callTool('browser_tabs', args)
    if (result.isError) throw new Error(this.safeError(result.text))
    if (action === 'close') await this.pruneDeadBindings()
    return result.text
  }

  /** 列出标签页并附上来源与闲置评估建议，供 browser_tabs list 使用。 */
  async listTabsWithAdvice(): Promise<string> {
    const raw = await this.tabs('list')
    const tabs = parseBrowserTabs(raw)
    const records = this.resolveTabRecords(tabs)
    const { advice } = evaluateTabCleanup(tabs, records, { now: Date.now(), minIdleMs: DEFAULT_TAB_IDLE_MS })
    const rendered = renderTabAdvice(advice)
    return rendered === '' ? raw : raw + '\n' + rendered
  }

  /** 关闭闲置标签页：默认只清发布类任务残留，includeGeneral 时连同闲置通用页一起关闭。 */
  async closeIdleTabs(options: { minIdleMs?: number; includeGeneral?: boolean } = {}): Promise<string> {
    const minIdleMs = typeof options.minIdleMs === 'number' && options.minIdleMs > 0 ? options.minIdleMs : DEFAULT_TAB_IDLE_MS
    const tabs = await this.currentTabs()
    const records = this.resolveTabRecords(tabs)
    const { advice, closeIndexes } = evaluateTabCleanup(tabs, records, { now: Date.now(), minIdleMs, includeGeneral: options.includeGeneral === true })
    if (closeIndexes.length === 0) return '没有满足清理条件的闲置标签页'
    const closed: string[] = []
    for (const index of closeIndexes) {
      const item = advice.find(candidate => candidate.index === index)
      try {
        await this.tabs('close', index)
        closed.push(index + ':[' + (item?.title ?? '未知') + ']')
      } catch (error) {
        const done = closed.length === 0 ? '未关闭任何标签页' : '已关闭 ' + closed.join('、')
        return done + '；剩余清理中断：' + this.safeError(error)
      }
    }
    return '已关闭 ' + closed.length + ' 个闲置标签页：' + closed.join('、')
  }

  /** 关闭当前标签页（专用流程收尾用）；urlHint 不匹配时跳过，避免误关其它页面。 */
  async closeCurrentTaskTab(urlHint?: string): Promise<{ closed: boolean; url?: string; reason?: string }> {
    const tabs = await this.currentTabs()
    const current = tabs.find(tab => tab.current) ?? tabs[0]
    if (current === undefined) return { closed: false, reason: '没有可关闭的标签页' }
    if (urlHint !== undefined && !current.url.includes(urlHint)) {
      return { closed: false, url: current.url, reason: '当前页与任务不符，跳过关闭' }
    }
    await this.tabs('close', current.index)
    return { closed: true, url: current.url }
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

  /** 在当前页执行一段 JS 函数并返回文本结果；仅供插件专用流程做精确光标与控件控制，不作为通用工具暴露。 */
  async evaluate(fn: string): Promise<string> {
    const result = await this.ensureClient().callTool('browser_evaluate', { function: fn })
    if (result.isError) throw new Error(this.safeError(result.text))
    return result.text
  }

  /** 模拟单个键盘按键；仅供插件专用流程做删除、光标微调等页面修正。 */
  async pressKey(key: string): Promise<string> {
    const result = await this.ensureClient().callTool('browser_press_key', { key })
    if (result.isError) throw new Error(this.safeError(result.text))
    return result.text
  }

  /** 停止浏览器会话；持久档案保留，全部旧引用失效。 */
  async stop(): Promise<void> {
    this.client?.stop()
    this.client = undefined
    this.tabBindings.clear()
    this.pendingOrigin = undefined
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
      binding = { id: this.nextTabId++, index: current.index, url: current.url, generation: 0, origin: this.consumePendingOrigin(), lastActivityAt: Date.now() }
      this.tabBindings.set(binding.id, binding)
    } else {
      binding.lastActivityAt = Date.now()
    }
    binding.generation += 1
    return scopeSnapshotRefs(snapshot, binding.id, binding.generation)
  }

  /** 消费一次性的来源标记；过期或缺失时按通用来源处理。 */
  private consumePendingOrigin(): string {
    const pending = this.pendingOrigin
    this.pendingOrigin = undefined
    if (pending === undefined || Date.now() - pending.at > PENDING_ORIGIN_TTL_MS) return TAB_ORIGIN_GENERAL
    return pending.origin
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
    binding.lastActivityAt = Date.now()
    if (!target!.current) await this.tabs('select', target!.index)
    return scoped.rawRef
  }

  /** 读取当前标签清单。 */
  private async currentTabs(): Promise<BrowserTabEntry[]> {
    const result = await this.ensureClient().callTool('browser_tabs', { action: 'list' })
    if (result.isError) throw new Error(this.safeError(result.text))
    return parseBrowserTabs(result.text)
  }

  /** 把绑定落到当前标签页清单上；只保留索引与地址都完全匹配的记录。 */
  private resolveTabRecords(tabs: BrowserTabEntry[]): TabRecord[] {
    const records: TabRecord[] = []
    for (const binding of this.tabBindings.values()) {
      const alive = tabs.some(tab => tab.index === binding.index && tab.url === binding.url)
      if (alive) records.push({ index: binding.index, url: binding.url, origin: binding.origin, lastActivityAt: binding.lastActivityAt })
    }
    return records
  }

  /** 关闭标签页后清理已消失的绑定；索引与地址不再完全匹配的一律失效，防止引用漂移误点。 */
  private async pruneDeadBindings(): Promise<void> {
    try {
      const tabs = await this.currentTabs()
      for (const [id, binding] of [...this.tabBindings]) {
        const alive = tabs.some(tab => tab.index === binding.index && tab.url === binding.url)
        if (!alive) this.tabBindings.delete(id)
      }
    } catch { /* 清理失败不影响关闭主流程 */ }
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
