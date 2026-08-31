/** 小红书图文笔记发布流程：复用服务工厂的可见浏览器与当前登录态。 */
import type { BrowserService } from './service.ts'

/** 小红书创作服务平台发布页地址。 */
export const XHS_PUBLISH_URL = 'https://creator.xiaohongshu.com/publish/publish?source=official'
/** 真实发布所需的精确确认短语。 */
export const XHS_PUBLISH_CONFIRMATION = '确认发布'

/** 小红书图文笔记草稿。 */
export interface XhsNoteDraft {
  imagePath: string
  title: string
  content: string
  tags: string[]
}

/** 发布成功后的脱敏结果。 */
export interface XhsPublishResult {
  published: boolean
  noteUrl?: string
  title: string
  tags: string[]
}

type XhsPublishBrowser = Pick<BrowserService, 'snapshot' | 'click' | 'type' | 'upload' | 'tabs' | 'withExclusive' | 'clickAndUpload' | 'evaluate' | 'pressKey'>

/** 从快照中按可见文本取一个稳定元素引用。 */
function findRef(snapshot: string, visibleText: string): string | undefined {
  const line = snapshot.split('\n').find((value) => value.includes(visibleText))
  return line?.match(/\[ref=([^\]]+)\]/)?.[1]
}

/** 从快照中取所有含指定文本的引用；同名节点可能有多个，需逐个尝试。 */
function findAllRefs(snapshot: string, visibleText: string): string[] {
  return snapshot
    .split('\n')
    .filter((value) => value.includes(visibleText))
    .map((value) => value.match(/\[ref=([^\]]+)\]/)?.[1])
    .filter((value): value is string => value !== undefined)
}

/** 从标记文本行向上找最近的输入框引用；避开把占位提示段落当作可输入元素。 */
function findTextboxBefore(snapshot: string, marker: string): string | undefined {
  const lines = snapshot.split('\n')
  const index = lines.findIndex((value) => value.includes(marker))
  for (let cursor = index; cursor >= 0; cursor -= 1) {
    if (lines[cursor]!.includes('textbox')) return lines[cursor]!.match(/\[ref=([^\]]+)\]/)?.[1]
  }
  return undefined
}

/** 从页面摘要中取当前地址。 */
function findPageUrl(snapshot: string): string | undefined {
  return snapshot.match(/^- Page URL: (\S+)/m)?.[1]
}

/** 把光标移到正文编辑器末尾的页面脚本。 */
export const CURSOR_TO_END_SCRIPT = '() => { const editors = [...document.querySelectorAll(\'[contenteditable="true"]\')].filter(e => e.offsetParent !== null); const editor = editors.at(-1); if (!editor) return \'no-editor\'; editor.focus(); const selection = window.getSelection(); const range = document.createRange(); range.selectNodeContents(editor); range.collapse(false); selection.removeAllRanges(); selection.addRange(range); return \'ok\'; }'

/** 在当前光标处插入文本的页面脚本。 */
export function insertTextScript(text: string): string {
  return '() => { const ok = document.execCommand(\'insertText\', false, ' + JSON.stringify(text) + '); return ok ? \'inserted\' : \'insert-failed\'; }'
}

/** 点击「发布」按钮的页面脚本：精确匹配叶子文本，避开「定时发布」「发布笔记」。 */
export const CLICK_PUBLISH_SCRIPT = '() => { const leaves = [...document.querySelectorAll(\'button, div[role="button"], span, div\')].filter(n => n.childElementCount === 0 && (n.textContent || \'\').trim() === \'发布\' && n.offsetParent !== null); const target = leaves.at(-1); if (!target) return \'not-found\'; const clickable = target.closest(\'button\') ?? target; clickable.click(); return \'clicked\'; }'

/** 读取发布成功页上的笔记链接；拿不到时退回当前地址。 */
export const NOTE_URL_SCRIPT = '() => { const link = [...document.querySelectorAll(\'a\')].find(a => /xiaohongshu\\.com\\/(explore|discovery\\/item)\\//.test(a.href)); return link ? link.href : window.location.href; }'

/** 小红书笔记发布服务：草稿校验、可见填写、话题插入与发布结果核验。 */
export class XiaohongshuPublishService {
  private readonly browser: XhsPublishBrowser

  /** 注入现有浏览器服务，禁止创建第二个用户档案。 */
  constructor(browser: XhsPublishBrowser) {
    this.browser = browser
  }

  /** 用户确认后执行一次发布；与其它浏览器操作共享同一互斥锁。 */
  async publish(draft: XhsNoteDraft, confirmation: string): Promise<XhsPublishResult> {
    this.validateDraft(draft)
    if (confirmation !== XHS_PUBLISH_CONFIRMATION) throw new Error('真实发布前必须由用户明确确认，并传入“确认发布”')
    return await this.browser.withExclusive(() => this.publishUnlocked(draft))
  }

  /** 在互斥区内按小红书真实页面顺序执行发布。 */
  private async publishUnlocked(draft: XhsNoteDraft): Promise<XhsPublishResult> {
    // 每篇笔记使用独立标签页，其它任务页面保持原状。
    await this.browser.tabs('new', undefined, XHS_PUBLISH_URL)
    const initial = await this.waitForSnapshot((value) => value.includes('上传图文') || value.includes('短信登录'), 15)
    if (initial.includes('短信登录') && !initial.includes('上传图文')) throw new Error('小红书创作平台未登录，请在前台浏览器完成扫码或短信登录后重试')

    // 默认落在“上传视频”页签；同名页签节点可能有隐藏副本，逐个尝试直到切到图文上传。
    let page = ''
    for (const ref of findAllRefs(initial, '上传图文')) {
      try {
        page = await this.browser.click(ref)
        if (page.includes('上传图片，或写文字生成图片')) break
      } catch { /* 隐藏副本点击会超时，换下一个同名节点 */ }
    }
    if (!page.includes('上传图片，或写文字生成图片')) throw new Error('未能切换到小红书图文上传页签，未执行发布')

    // 点击上传入口并在同一原子操作内完成图片上传。
    const uploadRef = findRef(page, 'button "上传图片"') ?? findRef(page, '上传图片')
    if (uploadRef === undefined) throw new Error('未找到小红书图片上传入口，未执行发布')
    await this.browser.clickAndUpload(uploadRef, draft.imagePath)

    const editorSnapshot = await this.waitForSnapshot((value) => value.includes('填写标题'), 20)
    const titleRef = findTextboxBefore(editorSnapshot, '填写标题')
    if (titleRef === undefined) throw new Error('未找到小红书标题输入框，未执行发布')
    await this.browser.type(titleRef, draft.title)

    const contentRef = findTextboxBefore(editorSnapshot, '输入正文描述')
    if (contentRef === undefined) throw new Error('未找到小红书正文输入框，未执行发布')
    await this.browser.type(contentRef, draft.content)

    const appliedTags: string[] = []
    for (const tag of draft.tags) {
      if (await this.appendTag(tag)) appliedTags.push(tag)
    }

    const clickResult = await this.browser.evaluate(CLICK_PUBLISH_SCRIPT)
    if (!clickResult.includes('clicked')) throw new Error('未找到小红书发布按钮，未执行发布；页面内容已保留，可人工检查后重试')

    const finalSnapshot = await this.waitForSnapshot((value) => value.includes('发布成功') || value.includes('查看笔记') || (findPageUrl(value) ?? '').includes('success'), 20)
    if (!finalSnapshot.includes('发布成功') && !finalSnapshot.includes('查看笔记') && !(findPageUrl(finalSnapshot) ?? '').includes('success')) {
      throw new Error('发布后未核验到成功标志，请在浏览器中确认发布状态后重试')
    }

    let noteUrl: string | undefined
    try {
      const raw = await this.browser.evaluate(NOTE_URL_SCRIPT)
      noteUrl = raw.trim().split('\n').at(-1)?.trim().replace(/^"|"$/g, '') || undefined
    } catch { /* 链接读取失败不影响发布结论 */ }
    return { published: true, noteUrl, title: draft.title, tags: appliedTags }
  }

  /** 在正文末尾插入一个话题标签；联想列表没有该话题时回退删掉 # 并返回 false。 */
  private async appendTag(tag: string): Promise<boolean> {
    await this.browser.evaluate(CURSOR_TO_END_SCRIPT)
    await this.browser.evaluate(insertTextScript('#'))
    const tooltip = await this.waitForSnapshot((value) => value.includes('万浏览') || value.includes('亿浏览'), 5)
    const tagRef = findRef(tooltip, '"#' + tag + '"')
    if (tagRef === undefined) {
      await this.browser.pressKey('Backspace')
      return false
    }
    await this.browser.click(tagRef)
    return true
  }

  /** 等待动态页面出现目标内容，避免只读取到空壳 DOM。 */
  private async waitForSnapshot(predicate: (snapshot: string) => boolean, attempts = 12): Promise<string> {
    let latest = await this.browser.snapshot()
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (predicate(latest)) return latest
      await new Promise((resolve) => setTimeout(resolve, 1000))
      latest = await this.browser.snapshot()
    }
    return latest
  }

  /** 前置校验路径、文本长度和话题数量，避免错误页面操作。 */
  private validateDraft(draft: XhsNoteDraft): void {
    if (!draft.imagePath.trim() || !draft.imagePath.startsWith('/')) throw new Error('笔记配图必须是本机绝对路径')
    const title = draft.title.trim()
    if (!title || title.length > 20) throw new Error('笔记标题不能为空且不能超过 20 个字符')
    if (!draft.content.trim() || draft.content.length > 1000) throw new Error('笔记正文不能为空且不能超过 1000 个字符')
    if (draft.tags.length > 10) throw new Error('话题标签不能超过 10 个')
    for (const tag of draft.tags) {
      const clean = tag.trim().replace(/^#/, '')
      if (!clean || clean.length > 30) throw new Error('每个话题标签长度必须在 1 到 30 个字符之间')
    }
  }
}
