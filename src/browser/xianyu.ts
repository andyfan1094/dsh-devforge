/** 闲鱼消息页自动化：只复用服务工厂的可见浏览器与现有登录态。 */
import type { BrowserService } from './service.ts'

/** 闲鱼网页版消息中心。 */
export const XIANYU_MESSAGES_URL = 'https://www.goofish.com/im'
/** 构造绑定具体联系人的真实发送确认短语。 */
export function buildXianyuSendConfirmation(contact: string): string {
  return '确认发送给“' + contact.trim() + '”'
}

/** 闲鱼消息能力依赖的最小浏览器表面，便于隔离测试。 */
export type XianyuBrowser = Pick<BrowserService, 'navigate' | 'snapshot' | 'click' | 'type'> & Partial<Pick<BrowserService, 'tabs' | 'withExclusive'>>

/** 从标签页清单中寻找闲鱼消息页序号。 */
export function findXianyuMessagesTabIndex(tabs: string): number | undefined {
  for (const line of tabs.split('\n')) {
    if (!line.includes('https://www.goofish.com/im')) continue
    const match = line.match(/- (\d+):/)
    if (match !== null) return Number(match[1])
  }
  return undefined
}

/** 一次真实发送的脱敏结果，不回显消息正文。 */
export interface XianyuSendResult {
  contact: string
  sent: boolean
}

interface SnapshotNode {
  indent: number
  ref?: string
  clickable: boolean
  text?: string
}

/** 把快照里的 YAML 标量转换为可比较文本。 */
function normalizeSnapshotText(value: string): string {
  const text = value.trim()
  if (text.startsWith('"') && text.endsWith('"')) {
    try { return JSON.parse(text) as string } catch { return text.slice(1, -1) }
  }
  return text
}

/** 解析一行 Playwright 无障碍快照，只保留定位联系人所需字段。 */
function parseSnapshotNode(line: string): SnapshotNode {
  const indent = line.length - line.trimStart().length
  const ref = line.match(/\[ref=([^\]]+)\]/)?.[1]
  const marker = line.lastIndexOf(']:')
  const text = marker >= 0 ? normalizeSnapshotText(line.slice(marker + 2)) : undefined
  return { indent, ref, clickable: line.includes('[cursor=pointer]'), text: text === '' ? undefined : text }
}

/** 去掉控制台与本机文件路径，仅保留消息页快照并限制单次返回体积。 */
export function sanitizeXianyuSnapshot(snapshot: string): string {
  const snapshotStart = snapshot.indexOf('### Snapshot')
  const relevant = snapshotStart >= 0 ? snapshot.slice(snapshotStart) : snapshot
  const eventsStart = relevant.indexOf('\n### Events')
  const withoutEvents = eventsStart >= 0 ? relevant.slice(0, eventsStart) : relevant
  const maximumLength = 100_000
  return withoutEvents.length <= maximumLength ? withoutEvents : withoutEvents.slice(0, maximumLength) + '\n[快照已截断]'
}

/** 按可见文本查找所有可点击节点，子文本会回溯到最近的可点击父节点。 */
export function findClickableTextTargets(snapshot: string, visibleText: string): string[] {
  const lines = snapshot.split('\n')
  const targets = new Set<string>()
  const normalizedText = visibleText.trim()
  for (let index = 0; index < lines.length; index += 1) {
    const node = parseSnapshotNode(lines[index]!)
    if (node.text !== normalizedText) continue
    if (node.clickable && node.ref !== undefined) { targets.add(node.ref); continue }
    for (let parentIndex = index - 1; parentIndex >= 0; parentIndex -= 1) {
      const parent = parseSnapshotNode(lines[parentIndex]!)
      if (parent.indent >= node.indent) continue
      if (parent.clickable && parent.ref !== undefined) { targets.add(parent.ref); break }
      if (parent.indent === 0) break
    }
  }
  return [...targets]
}

/** 按联系人显示名查找唯一会话入口；重名时返回 undefined，禁止猜测。 */
export function findConversationTarget(snapshot: string, contact: string): string | undefined {
  const targets = findClickableTextTargets(snapshot, contact)
  return targets.length === 1 ? targets[0] : undefined
}

/** 遍历主对话区节点；退出 main 子树后不再接受侧栏或页脚元素。 */
function mainSnapshotNodes(snapshot: string): SnapshotNode[] {
  const nodes: SnapshotNode[] = []
  let insideMain = false
  let mainIndent = -1
  for (const line of snapshot.split('\n')) {
    const node = parseSnapshotNode(line)
    if (/^\s*- main(?:\s|\[|:)/.test(line)) { insideMain = true; mainIndent = node.indent; continue }
    if (insideMain && node.indent <= mainIndent && line.trim() !== '') insideMain = false
    if (insideMain) nodes.push({ ...node, text: node.text ?? line })
  }
  return nodes
}

/** 确认联系人名称确实出现在主对话区，而不只是左侧会话列表。 */
export function mainConversationMatches(snapshot: string, contact: string): boolean {
  const normalizedContact = contact.trim()
  return mainSnapshotNodes(snapshot).some(node => node.text === normalizedContact || node.text?.endsWith(': ' + normalizedContact) === true)
}

/** 从主对话区找到唯一且带消息语义的文本输入框。 */
export function findMessageInputTarget(snapshot: string): string | undefined {
  const targets = new Set<string>()
  for (const node of mainSnapshotNodes(snapshot)) {
    if (node.ref === undefined || node.text === undefined || !node.text.includes('textbox')) continue
    if (/输入|消息|回复|聊天/.test(node.text)) targets.add(node.ref)
  }
  return targets.size === 1 ? [...targets][0] : undefined
}

/** 从对话详情中查找唯一的“发送”按钮；缺失或重复时拒绝猜测。 */
export function findSendButtonTarget(snapshot: string): string | undefined {
  const targets = findClickableTextTargets(snapshot, '发送')
  return targets.length === 1 ? targets[0] : undefined
}

/** 闲鱼消息服务：打开列表、读取指定对话，以及确认后发送回复。 */
export class XianyuMessageService {
  private readonly browser: XianyuBrowser
  private readonly now: () => number
  private readonly recentSends = new Map<string, number>()
  private readonly sending = new Set<string>()

  /** 注入已有浏览器服务，不创建第二份用户档案或隐形浏览器。 */
  constructor(browser: XianyuBrowser, now: () => number = Date.now) {
    this.browser = browser
    this.now = now
  }

  /** 打开闲鱼消息中心并返回完整无障碍快照。 */
  async list(): Promise<string> {
    return await this.runExclusive(() => this.listUnlocked())
  }

  /** 按联系人名称打开会话并返回消息详情快照。 */
  async read(contact: string): Promise<string> {
    const normalizedContact = this.normalizeContact(contact)
    return await this.runExclusive(() => this.readUnlocked(normalizedContact))
  }

  /** 选择已存在的消息页，缺失时创建独立标签页。 */
  private async selectMessagesTabUnlocked(): Promise<void> {
    if (this.browser.tabs === undefined) {
      await this.browser.navigate(XIANYU_MESSAGES_URL)
      return
    }
    const listed = await this.browser.tabs('list')
    const index = findXianyuMessagesTabIndex(listed)
    if (index === undefined) await this.browser.tabs('new', undefined, XIANYU_MESSAGES_URL)
    else await this.browser.tabs('select', index)
  }

  /** 已持有浏览器操作权时读取消息列表。 */
  private async listUnlocked(): Promise<string> {
    await this.selectMessagesTabUnlocked()
    return sanitizeXianyuSnapshot(await this.browser.snapshot())
  }

  /** 已持有浏览器操作权时读取一个指定会话。 */
  private async readUnlocked(normalizedContact: string): Promise<string> {
    const listSnapshot = await this.listUnlocked()
    const targets = findClickableTextTargets(listSnapshot, normalizedContact)
    if (targets.length === 0) {
      throw new Error('未找到联系人“' + normalizedContact + '”，请确认闲鱼已登录且该会话位于当前列表')
    }
    if (targets.length > 1) throw new Error('存在多个同名联系人“' + normalizedContact + '”，为避免发错会话已停止操作')
    await this.browser.click(targets[0]!)
    return sanitizeXianyuSnapshot(await this.browser.snapshot())
  }

  /**
   * 发送回复。confirmation 必须绑定具体联系人；同一内容五分钟内只发送一次。
   */
  async reply(contact: string, message: string, confirmation: string): Promise<XianyuSendResult> {
    const normalizedContact = this.normalizeContact(contact)
    const normalizedMessage = message.trim()
    const expectedConfirmation = buildXianyuSendConfirmation(normalizedContact)
    if (confirmation !== expectedConfirmation) {
      throw new Error('真实发送前必须由用户明确确认，并传入“' + expectedConfirmation + '”')
    }
    if (normalizedMessage === '') throw new Error('回复内容不能为空')
    if (normalizedMessage.length > 500) throw new Error('回复内容不能超过 500 个字符')

    const sendKey = normalizedContact + '\u0000' + normalizedMessage
    const previousSend = this.recentSends.get(sendKey)
    if (this.sending.has(sendKey) || (previousSend !== undefined && this.now() - previousSend < 5 * 60 * 1000)) {
      throw new Error('同一联系人和内容五分钟内禁止重复发送')
    }

    this.sending.add(sendKey)
    try {
      return await this.runExclusive(async () => {
        const detailSnapshot = await this.readUnlocked(normalizedContact)
        if (!mainConversationMatches(detailSnapshot, normalizedContact)) {
          throw new Error('主对话区联系人与目标不一致，未执行发送')
        }
        const inputTarget = findMessageInputTarget(detailSnapshot)
        const sendTarget = findSendButtonTarget(detailSnapshot)
        if (inputTarget === undefined) throw new Error('未找到唯一且可识别的闲鱼消息输入框，未执行发送')
        if (sendTarget === undefined) throw new Error('未找到唯一的闲鱼发送按钮，未执行发送')
        await this.browser.type(inputTarget, normalizedMessage, false)
        this.recentSends.set(sendKey, this.now())
        try { await this.browser.click(sendTarget) }
        catch { throw new Error('发送按钮操作结果不确定，五分钟内不会自动重试，请先人工核对对话') }
        return { contact: normalizedContact, sent: true }
      })
    } finally {
      this.sending.delete(sendKey)
    }
  }

  /** 使用浏览器全局队列；测试替身或旧实现缺失时直接执行。 */
  private async runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    return this.browser.withExclusive === undefined ? await operation() : await this.browser.withExclusive(operation)
  }

  /** 校验联系人名称，避免空值或异常长文本污染页面定位。 */
  private normalizeContact(contact: string): string {
    const normalized = contact.trim()
    if (normalized === '') throw new Error('联系人名称不能为空')
    if (normalized.length > 80) throw new Error('联系人名称不能超过 80 个字符')
    return normalized
  }
}
