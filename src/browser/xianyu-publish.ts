/** 闲鱼商品发布流程：复用服务工厂的可见浏览器与当前登录态。 */
import { TAB_ORIGIN_XIANYU_PUBLISH, type BrowserService } from './service.ts'

/** 闲鱼商品发布页地址。 */
export const XIANYU_PUBLISH_URL = 'https://www.goofish.com/publish'
/** 真实发布所需的精确确认短语。 */
export const XIANYU_PUBLISH_CONFIRMATION = '确认发布'

/** 发布草稿；标题会写入描述首行，由闲鱼页面生成商品标题。 */
export interface XianyuPublishDraft {
  imagePath: string
  title: string
  description: string
  price: number
}

/** 发布成功后的脱敏结果。 */
export interface XianyuPublishResult {
  published: boolean
  itemUrl?: string
  title: string
  price: number
}

type XianyuPublishBrowser = Pick<BrowserService, 'snapshot' | 'click' | 'type' | 'upload' | 'tabs' | 'withExclusive' | 'closeCurrentTaskTab'>

/** 从快照中按可见文本取一个稳定元素引用。 */
function findRef(snapshot: string, visibleText: string, requiredRole?: string): string | undefined {
  const line = snapshot.split('\n').find((value) => value.includes(visibleText) && (requiredRole === undefined || value.includes(requiredRole)))
  return line?.match(/\[ref=([^\]]+)\]/)?.[1]
}

/** 找到价格区域中的第一个价格输入框，避免误填原价。 */
function findPriceRef(snapshot: string): string | undefined {
  const lines = snapshot.split('\n')
  const priceIndex = lines.findIndex((line) => line.trim() === '- generic [ref=' || line.includes('价格'))
  const start = priceIndex >= 0 ? priceIndex : 0
  for (let index = start; index < lines.length; index += 1) {
    if (!lines[index]!.includes('textbox') || !lines[index]!.includes('0.00')) continue
    return lines[index]!.match(/\[ref=([^\]]+)\]/)?.[1]
  }
  return undefined
}

/** 从页面摘要中取当前地址。 */
function findPageUrl(snapshot: string): string | undefined {
  return snapshot.match(/^- Page URL: (\S+)/m)?.[1]
}

/** 闲鱼商品发布服务：草稿校验、可见填写、平台结果核验。 */
export class XianyuPublishService {
  private readonly browser: XianyuPublishBrowser

  /** 注入现有浏览器服务，禁止创建第二个用户档案。 */
  constructor(browser: XianyuPublishBrowser) {
    this.browser = browser
  }

  /** 用户确认后执行一次发布；发布与消息操作共享同一浏览器互斥锁。 */
  async publish(draft: XianyuPublishDraft, confirmation: string): Promise<XianyuPublishResult> {
    this.validateDraft(draft)
    if (confirmation !== XIANYU_PUBLISH_CONFIRMATION) throw new Error('真实发布前必须由用户明确确认，并传入“确认发布”')
    return await this.browser.withExclusive(() => this.publishUnlocked(draft))
  }

  /** 在互斥区内按闲鱼真实页面顺序执行发布。 */
  private async publishUnlocked(draft: XianyuPublishDraft): Promise<XianyuPublishResult> {
    // 每个发布任务使用独立标签页并标记来源，消息页与其它任务页面保持原状。
    await this.browser.tabs('new', undefined, XIANYU_PUBLISH_URL, TAB_ORIGIN_XIANYU_PUBLISH)
    let snapshot = await this.waitForSnapshot((value) => value.includes('添加首图'))
    const addImageRef = findRef(snapshot, '添加首图')
    if (addImageRef === undefined) throw new Error('未找到闲鱼“添加首图”入口，未执行发布')

    await this.browser.click(addImageRef)
    await this.browser.upload(draft.imagePath)
    snapshot = await this.waitForSnapshot((value) => value.includes('描述一下'))
    const descriptionRef = findRef(snapshot, '描述一下')
    const priceRef = findPriceRef(snapshot)
    if (descriptionRef === undefined) throw new Error('未找到闲鱼宝贝描述输入区域，未执行发布')
    if (priceRef === undefined) throw new Error('未找到闲鱼价格输入框，未执行发布')

    const fullDescription = draft.title + '\n' + draft.description
    await this.browser.type(descriptionRef, fullDescription, false)
    await this.browser.type(priceRef, draft.price.toFixed(2), false)
    snapshot = await this.waitForSnapshot((value) => value.includes('button "发布"'))
    const publishRef = findRef(snapshot, '发布', 'button')
    if (publishRef === undefined) throw new Error('未找到闲鱼发布按钮，未执行发布')

    await this.browser.click(publishRef)
    snapshot = await this.waitForSnapshot((value) => findPageUrl(value)?.includes('/item?id=') === true || value.includes('完成认证才可继续发布'))
    if (snapshot.includes('完成认证才可继续发布')) throw new Error('闲鱼要求在前台完成手机认证，请完成认证后重新发布')
    const itemUrl = findPageUrl(snapshot)
    if (itemUrl === undefined || !itemUrl.includes('/item?id=')) throw new Error('发布后未核验到商品详情页，未确认发布结果')

    // 发布成功即用完：关闭本次任务标签页，避免闲置标签页堆积。
    try { await this.browser.closeCurrentTaskTab('goofish.com') } catch { /* 清理失败不影响发布结果 */ }
    return { published: true, itemUrl, title: draft.title, price: draft.price }
  }

  /** 等待动态页面出现目标内容，避免只读取到空壳 DOM。 */
  private async waitForSnapshot(predicate: (snapshot: string) => boolean): Promise<string> {
    let latest = ''
    for (let attempt = 0; attempt < 12; attempt += 1) {
      latest = await this.browser.snapshot()
      if (predicate(latest)) return latest
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
    return latest
  }

  /** 前置校验路径、文本长度和价格范围，避免错误页面操作。 */
  private validateDraft(draft: XianyuPublishDraft): void {
    if (!draft.imagePath.trim() || !draft.imagePath.startsWith('/')) throw new Error('商品图片必须是本机绝对路径')
    if (!draft.title.trim() || draft.title.trim().length > 80) throw new Error('商品标题不能为空且不能超过 80 个字符')
    if (!draft.description.trim() || draft.description.length > 1400) throw new Error('商品描述不能为空且不能超过 1400 个字符')
    if (!Number.isFinite(draft.price) || draft.price <= 0 || draft.price > 100000) throw new Error('商品价格必须大于 0 且不超过 100000 元')
  }
}
