/** 小红书笔记发布流程测试：确认门、登录检测、页签切换、话题回退与发布核验。 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseTagList } from '../src/browser/xhs-publish-tools.ts'
import { XHS_PUBLISH_URL, XiaohongshuPublishService } from '../src/browser/xhs-publish.ts'

class FakeXhsBrowser {
  readonly calls: Array<{ name: string; args: unknown[] }> = []
  private readonly snapshots: string[]
  private readonly clickResults: string[]
  private readonly evaluateResults: string[]
  private readonly tabList: string

  constructor(snapshots: string[], clickResults: string[], evaluateResults: string[], tabList = '') {
    this.snapshots = [...snapshots]
    this.clickResults = [...clickResults]
    this.evaluateResults = [...evaluateResults]
    this.tabList = tabList
  }

  async withExclusive<T>(operation: () => Promise<T>): Promise<T> { this.calls.push({ name: 'exclusive', args: [] }); return await operation() }
  async tabs(action: string, index?: number, url?: string, origin?: string): Promise<string> { this.calls.push({ name: 'tabs', args: [action, index, url, origin] }); return action === 'list' ? this.tabList : '' }
  async closeCurrentTaskTab(urlHint?: string): Promise<{ closed: boolean; url?: string; reason?: string }> {
    this.calls.push({ name: 'closeCurrentTaskTab', args: [urlHint] })
    if (urlHint !== undefined && !this.tabList.includes(urlHint)) return { closed: false, reason: '当前页与任务不符，跳过关闭' }
    return { closed: true }
  }
  async snapshot(): Promise<string> { this.calls.push({ name: 'snapshot', args: [] }); return this.snapshots.shift() ?? '' }
  async click(ref: string): Promise<string> { this.calls.push({ name: 'click', args: [ref] }); return this.clickResults.shift() ?? '' }
  async type(ref: string, text: string, submit = false): Promise<string> { this.calls.push({ name: 'type', args: [ref, text, submit] }); return '' }
  async upload(path: string): Promise<string> { this.calls.push({ name: 'upload', args: [path] }); return '' }
  async clickAndUpload(ref: string, path: string): Promise<string> { this.calls.push({ name: 'clickAndUpload', args: [ref, path] }); return '' }
  async evaluate(fn: string): Promise<string> { this.calls.push({ name: 'evaluate', args: [fn] }); return this.evaluateResults.shift() ?? '' }
  async pressKey(key: string): Promise<string> { this.calls.push({ name: 'pressKey', args: [key] }); return '' }
}

const lines = (...values: string[]): string => values.join(String.fromCharCode(10))
const INITIAL = lines('### Snapshot', '- generic: 上传视频', '- generic [ref=e20] [cursor=pointer]: 上传图文', '- generic [ref=e21]: 上传图文')
const INITIAL_HIDDEN_FIRST = lines('### Snapshot', '- generic: 上传视频', '- generic [ref=e20]: 上传图文', '- generic [ref=e21] [cursor=pointer]: 上传图文')
const SWITCHED = lines('### Snapshot', '- button "上传图片" [ref=e30]', '- paragraph [ref=e31]: 上传图片，或写文字生成图片')
const EDITOR = lines('### Snapshot', '- textbox "填写标题会有更多赞哦" [ref=e41]', '- textbox [ref=e42]:', '  - paragraph [ref=e43]: 输入正文描述，真诚有价值的分享予人温暖')
const TOOLTIP_HIT = lines('### Snapshot', '- generic [ref=e51] [cursor=pointer]: "#人工智能"', '- generic [ref=e52]: 59.6亿浏览')
const TOOLTIP_MISS = lines('### Snapshot', '- generic [ref=e61] [cursor=pointer]: "#智能体"', '- generic [ref=e62]: 4.6亿浏览')
const SUCCESS = lines('### Page', '- Page URL: https://creator.xiaohongshu.com/publish/success?code=abc', '### Snapshot', '- generic: 发布成功')
const LOGIN = lines('### Snapshot', '- generic: 短信登录', '- textbox: 手机号')

test('发布前必须精确确认且不触发浏览器动作', async () => {
  const browser = new FakeXhsBrowser([], [], [])
  const service = new XiaohongshuPublishService(browser)
  await assert.rejects(
    service.publish({ imagePath: '/tmp/c.png', title: '标题', content: '正文', tags: [] }, '未确认'),
    /确认发布/,
  )
  assert.equal(browser.calls.length, 0)
})

test('草稿校验拦截超长标题与非绝对路径图片', async () => {
  const browser = new FakeXhsBrowser([], [], [])
  const service = new XiaohongshuPublishService(browser)
  await assert.rejects(service.publish({ imagePath: '/tmp/c.png', title: '一'.repeat(21), content: '正文', tags: [] }, '确认发布'), /20 个字符/)
  await assert.rejects(service.publish({ imagePath: 'c.png', title: '标题', content: '正文', tags: [] }, '确认发布'), /绝对路径/)
  await assert.rejects(service.publish({ imagePath: '/tmp/c.png', title: '标题', content: '正文', tags: ['一'.repeat(31)] }, '确认发布'), /30 个字符/)
  assert.equal(browser.calls.length, 0)
})

test('未登录时明确报错且不继续页面操作', async () => {
  const browser = new FakeXhsBrowser([LOGIN], [], [])
  const service = new XiaohongshuPublishService(browser)
  await assert.rejects(service.publish({ imagePath: '/tmp/c.png', title: '标题', content: '正文', tags: [] }, '确认发布'), /未登录/)
  assert.ok(browser.calls.some((call) => call.name === 'tabs' && call.args[2] === XHS_PUBLISH_URL && call.args[3] === 'xhs-publish'))
  assert.ok(browser.calls.every((call) => call.name !== 'closeCurrentTaskTab'))
})

test('确认后独立标签页填写图文并核验发布成功', async () => {
  const tabList = '- 0: (current) [发布成功](https://creator.xiaohongshu.com/publish/success?code=abc)'
  const browser = new FakeXhsBrowser(
    [INITIAL, EDITOR, TOOLTIP_HIT, TOOLTIP_MISS, SUCCESS],
    [SWITCHED, ''],
    ['ok', 'inserted', 'ok', 'inserted', 'clicked', 'https://www.xiaohongshu.com/explore/note1'],
    tabList,
  )
  const service = new XiaohongshuPublishService(browser)
  const result = await service.publish({ imagePath: '/tmp/c.png', title: 'AI编程羊毛', content: '正文内容', tags: ['人工智能', 'AI工具'] }, '确认发布')
  assert.equal(result.published, true)
  assert.equal(result.noteUrl, 'https://www.xiaohongshu.com/explore/note1')
  assert.deepEqual(result.tags, ['人工智能'])
  assert.ok(browser.calls.some((call) => call.name === 'tabs' && call.args[0] === 'new' && call.args[2] === XHS_PUBLISH_URL && call.args[3] === 'xhs-publish'))
  assert.ok(browser.calls.some((call) => call.name === 'clickAndUpload' && call.args[1] === '/tmp/c.png'))
  assert.ok(browser.calls.some((call) => call.name === 'type' && call.args[0] === 'e41' && call.args[1] === 'AI编程羊毛'))
  assert.ok(browser.calls.some((call) => call.name === 'type' && call.args[0] === 'e42' && call.args[1] === '正文内容'))
  assert.ok(browser.calls.some((call) => call.name === 'click' && call.args[0] === 'e51'))
  assert.ok(browser.calls.some((call) => call.name === 'pressKey' && call.args[0] === 'Backspace'))
  assert.ok(browser.calls.some((call) => call.name === 'evaluate' && String(call.args[0]).includes("'发布'")))
  // 发布成功即关闭本次任务标签页，避免闲置标签页堆积。
  assert.ok(browser.calls.some((call) => call.name === 'closeCurrentTaskTab' && call.args[0] === 'xiaohongshu.com'))
})

test('点击隐藏页签副本超时后换下一个同名节点', async () => {
  const browser = new FakeXhsBrowser(
    [INITIAL_HIDDEN_FIRST, EDITOR, SUCCESS],
    ['', SWITCHED],
    ['clicked', 'https://creator.xiaohongshu.com/publish/success'],
  )
  const service = new XiaohongshuPublishService(browser)
  const result = await service.publish({ imagePath: '/tmp/c.png', title: '标题', content: '正文', tags: [] }, '确认发布')
  assert.equal(result.published, true)
  const clicks = browser.calls.filter((call) => call.name === 'click')
  assert.deepEqual(clicks.map((call) => call.args[0]), ['e20', 'e21'])
})

test('话题串规整去重并去掉井号', () => {
  assert.deepEqual(parseTagList('人工智能, #AI工具，#人工智能 '), ['人工智能', 'AI工具'])
  assert.deepEqual(parseTagList(undefined), [])
  assert.deepEqual(parseTagList('  '), [])
})
