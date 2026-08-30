/** 闲鱼消息服务纯函数与副作用边界测试。 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { findConversationTarget, findMessageInputTarget, findSendButtonTarget, findXianyuMessagesTabIndex, XIANYU_MESSAGES_URL, XianyuMessageService, type XianyuBrowser } from '../src/browser/xianyu.ts'

const LIST_SNAPSHOT = `### Snapshot
\`\`\`yaml
- generic [ref=e73]:
  - generic [ref=e78]:
    - generic [ref=e86] [cursor=pointer]:
      - generic [ref=e87]: 晓风DL
      - generic [ref=e90] [cursor=pointer]: 快给ta一个评价吧～
  - generic [ref=e179]:
    - generic [ref=e180] [cursor=pointer]: 阿码的软件铺
    - generic [ref=e182] [cursor=pointer]: 刚有点事
\`\`\`
`

const DETAIL_SNAPSHOT = `### Snapshot
\`\`\`yaml
- main [ref=e34]:
  - generic [ref=e200]: 阿码的软件铺
  - textbox "输入消息" [ref=e260]
  - button "发送" [ref=e261] [cursor=pointer]: 发送
\`\`\`
`

class FakeBrowser implements XianyuBrowser {
  readonly calls: Array<{ name: string; args: unknown[] }> = []
  private readonly snapshots: string[]

  constructor(snapshots: string[]) { this.snapshots = [...snapshots] }

  async navigate(url: string): Promise<string> { this.calls.push({ name: 'navigate', args: [url] }); return '' }
  async snapshot(): Promise<string> { this.calls.push({ name: 'snapshot', args: [] }); return this.snapshots.shift() ?? '' }
  async click(ref: string): Promise<string> { this.calls.push({ name: 'click', args: [ref] }); return '' }
  async type(ref: string, text: string, submit = false): Promise<string> { this.calls.push({ name: 'type', args: [ref, text, submit] }); return '' }
}

test('findXianyuMessagesTabIndex 从多标签页清单定位消息页', () => {
  const tabs = '### Result\n- 0: [闲鱼](https://www.goofish.com/)\n- 1: (current) [聊天](https://www.goofish.com/im)'
  assert.equal(findXianyuMessagesTabIndex(tabs), 1)
})

test('findConversationTarget 支持直接可点击联系人节点', () => {
  assert.equal(findConversationTarget(LIST_SNAPSHOT, '阿码的软件铺'), 'e180')
})

test('findConversationTarget 支持联系人名称位于可点击父节点内', () => {
  assert.equal(findConversationTarget(LIST_SNAPSHOT, '晓风DL'), 'e86')
})

test('findConversationTarget 精确匹配联系人名称', () => {
  assert.equal(findConversationTarget(LIST_SNAPSHOT, '阿码'), undefined)
})

test('findMessageInputTarget 只选择主对话区最后一个输入框', () => {
  const snapshot = '- textbox "搜索" [ref=e10]\n- main [ref=e34]:\n  - textbox "输入消息" [ref=e260]'
  assert.equal(findMessageInputTarget(snapshot), 'e260')
})

test('findSendButtonTarget 只接受唯一发送按钮', () => {
  assert.equal(findSendButtonTarget(DETAIL_SNAPSHOT), 'e261')
})

test('findConversationTarget 遇到重名联系人时拒绝猜测', () => {
  const duplicated = LIST_SNAPSHOT + '\n- generic [ref=e300] [cursor=pointer]: 阿码的软件铺'
  assert.equal(findConversationTarget(duplicated, '阿码的软件铺'), undefined)
})

test('list 固定打开闲鱼消息中心', async () => {
  const browser = new FakeBrowser([LIST_SNAPSHOT])
  const service = new XianyuMessageService(browser)
  assert.equal(await service.list(), LIST_SNAPSHOT)
  assert.deepEqual(browser.calls[0], { name: 'navigate', args: [XIANYU_MESSAGES_URL] })
})

test('read 按联系人点击并读取详情', async () => {
  const browser = new FakeBrowser([LIST_SNAPSHOT, DETAIL_SNAPSHOT])
  const service = new XianyuMessageService(browser)
  assert.equal(await service.read('阿码的软件铺'), DETAIL_SNAPSHOT)
  assert.ok(browser.calls.some(call => call.name === 'click' && call.args[0] === 'e180'))
})

test('reply 未明确确认时不触发任何浏览器动作', async () => {
  const browser = new FakeBrowser([LIST_SNAPSHOT, DETAIL_SNAPSHOT])
  const service = new XianyuMessageService(browser)
  await assert.rejects(service.reply('阿码的软件铺', '测试回复', '未确认'), /确认发送/)
  assert.equal(browser.calls.length, 0)
})

test('reply 明确确认后填写输入框并回车发送', async () => {
  const browser = new FakeBrowser([LIST_SNAPSHOT, DETAIL_SNAPSHOT])
  const service = new XianyuMessageService(browser, () => 1000)
  assert.deepEqual(await service.reply('阿码的软件铺', ' 测试回复 ', '确认发送给“阿码的软件铺”'), { contact: '阿码的软件铺', sent: true })
  assert.ok(browser.calls.some(call => call.name === 'type' && call.args[0] === 'e260' && call.args[1] === '测试回复' && call.args[2] === false))
  assert.ok(browser.calls.some(call => call.name === 'click' && call.args[0] === 'e261'))
})

test('read 遇到重名联系人时不点击任何会话', async () => {
  const duplicated = LIST_SNAPSHOT + '\n- generic [ref=e300] [cursor=pointer]: 阿码的软件铺'
  const browser = new FakeBrowser([duplicated])
  const service = new XianyuMessageService(browser)
  await assert.rejects(service.read('阿码的软件铺'), /多个同名联系人/)
  assert.equal(browser.calls.filter(call => call.name === 'click').length, 0)
})

test('reply 五分钟内阻止同一联系人和内容重复发送', async () => {
  const browser = new FakeBrowser([LIST_SNAPSHOT, DETAIL_SNAPSHOT])
  const service = new XianyuMessageService(browser, () => 1000)
  await service.reply('阿码的软件铺', '测试回复', '确认发送给“阿码的软件铺”')
  await assert.rejects(service.reply('阿码的软件铺', '测试回复', '确认发送给“阿码的软件铺”'), /禁止重复发送/)
  assert.equal(browser.calls.filter(call => call.name === 'type').length, 1)
})
