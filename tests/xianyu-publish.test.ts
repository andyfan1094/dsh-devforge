/** 闲鱼商品发布流程测试：确认门、独立标签页、字段填写与发布结果核验。 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { XIANYU_PUBLISH_URL, XianyuPublishService } from '../src/browser/xianyu-publish.ts'

class FakePublishBrowser {
  readonly calls: Array<{ name: string; args: unknown[] }> = []
  private readonly snapshots: string[]

  constructor(snapshots: string[]) { this.snapshots = [...snapshots] }

  async withExclusive<T>(operation: () => Promise<T>): Promise<T> { this.calls.push({ name: 'exclusive', args: [] }); return await operation() }
  async tabs(action: string, index?: number, url?: string): Promise<string> { this.calls.push({ name: 'tabs', args: [action, index, url] }); return '' }
  async snapshot(): Promise<string> { this.calls.push({ name: 'snapshot', args: [] }); return this.snapshots.shift() ?? '' }
  async click(ref: string): Promise<string> { this.calls.push({ name: 'click', args: [ref] }); return '' }
  async type(ref: string, text: string, submit = false): Promise<string> { this.calls.push({ name: 'type', args: [ref, text, submit] }); return '' }
  async upload(path: string): Promise<string> { this.calls.push({ name: 'upload', args: [path] }); return '' }
}

const IMAGE_SNAPSHOT = ['### Snapshot', '- generic [ref=e39]: 添加首图'].join(String.fromCharCode(10))
const FORM_SNAPSHOT = ['### Snapshot', '- generic [ref=e55]: 描述一下宝贝', '- generic: 价格', '  - textbox "0.00" [ref=e72]'].join(String.fromCharCode(10))
const PUBLISH_SNAPSHOT = ['### Snapshot', '- button "发布" [ref=e133] [cursor=pointer]'].join(String.fromCharCode(10))
const SUCCESS_SNAPSHOT = ['### Page', '- Page URL: https://www.goofish.com/item?id=123&categoryId=1', '### Snapshot'].join(String.fromCharCode(10))

test('发布前必须精确确认且不触发浏览器动作', async () => {
  const browser = new FakePublishBrowser([])
  const service = new XianyuPublishService(browser)
  await assert.rejects(service.publish({ imagePath: '/tmp/a.png', title: '标题', description: '描述', price: 6 }, '未确认'), /确认发布/)
  assert.equal(browser.calls.length, 0)
})

test('确认后使用独立标签页上传填写并核验详情页', async () => {
  const browser = new FakePublishBrowser([IMAGE_SNAPSHOT, FORM_SNAPSHOT, PUBLISH_SNAPSHOT, SUCCESS_SNAPSHOT])
  const service = new XianyuPublishService(browser)
  const result = await service.publish({ imagePath: '/tmp/a.png', title: '专业标题', description: '专业描述', price: 6 }, '确认发布')
  assert.deepEqual(result, { published: true, itemUrl: 'https://www.goofish.com/item?id=123&categoryId=1', title: '专业标题', price: 6 })
  assert.ok(browser.calls.some(call => call.name === 'tabs' && call.args[0] === 'new' && call.args[2] === XIANYU_PUBLISH_URL))
  assert.ok(browser.calls.some(call => call.name === 'upload' && call.args[0] === '/tmp/a.png'))
  assert.ok(browser.calls.some(call => call.name === 'type' && call.args[0] === 'e55' && call.args[1] === ['专业标题', '专业描述'].join(String.fromCharCode(10))))
  assert.ok(browser.calls.some(call => call.name === 'type' && call.args[0] === 'e72' && call.args[1] === '6.00'))
  assert.ok(browser.calls.some(call => call.name === 'click' && call.args[0] === 'e133'))
})

test('平台要求手机认证时不误报发布成功', async () => {
  const auth = ['### Page', '- Page URL: https://www.goofish.com/publish', '### Snapshot', '- heading "完成认证才可继续发布"'].join(String.fromCharCode(10))
  const browser = new FakePublishBrowser([IMAGE_SNAPSHOT, FORM_SNAPSHOT, PUBLISH_SNAPSHOT, auth])
  const service = new XianyuPublishService(browser)
  await assert.rejects(service.publish({ imagePath: '/tmp/a.png', title: '标题', description: '描述', price: 6 }, '确认发布'), /手机认证/)
})
