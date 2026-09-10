/** 本地浏览器能力纯函数回归测试：启动参数、内容规整、URL 校验与配置收敛。 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { buildPlaywrightArgs, normalizeMcpCallResult, PlaywrightMcpStdio, PLAYWRIGHT_MCP_PACKAGE } from '../src/browser/mcp-stdio.ts'
import { isSafeHttpUrl } from '../src/browser/protocol.ts'
import { buildElementTargetArgs, normalizeBrowserConfig, parseBrowserTabs, parseScopedElementRef, pickCurrentTab, scopeSnapshotRefs } from '../src/browser/service.ts'

test('buildPlaywrightArgs 默认有头并固定用户档案目录', () => {
  const args = buildPlaywrightArgs({ headless: false, channel: 'chrome', profileDir: '/tmp/profile', outputDir: '/tmp/out' })
  assert.equal(args[0], '-y')
  assert.ok(args.includes(PLAYWRIGHT_MCP_PACKAGE))
  assert.equal(args.includes('@playwright/mcp@latest'), false)
  assert.deepEqual(args.slice(args.indexOf('--browser'), args.indexOf('--browser') + 2), ['--browser', 'chrome'])
  assert.equal(args.includes('--headless'), false)
  assert.deepEqual(args.slice(args.indexOf('--user-data-dir'), args.indexOf('--user-data-dir') + 2), ['--user-data-dir', '/tmp/profile'])
})

test('buildPlaywrightArgs 无头模式追加 --headless', () => {
  const args = buildPlaywrightArgs({ headless: true, channel: 'chromium', profileDir: '/p', outputDir: '/o' })
  assert.ok(args.includes('--headless'))
  assert.deepEqual(args.slice(args.indexOf('--browser'), args.indexOf('--browser') + 2), ['--browser', 'chromium'])
})

test('normalizeMcpCallResult 拼接文本并只取首张图片', () => {
  const result = normalizeMcpCallResult([
    { type: 'text', text: '第一段' },
    { type: 'image', data: 'QUJD', mimeType: 'image/png' },
    { type: 'image', data: 'REVG', mimeType: 'image/png' },
    { type: 'text', text: '第二段' },
  ], false)
  assert.equal(result.isError, false)
  assert.equal(result.text, '第一段\n第二段')
  assert.deepEqual(result.image, { data: 'QUJD', mimeType: 'image/png' })
})

test('normalizeMcpCallResult 空内容与非文本块安全兜底', () => {
  const result = normalizeMcpCallResult(undefined, true)
  assert.equal(result.isError, true)
  assert.equal(result.text, '')
  assert.equal(result.image, undefined)
})

test('isSafeHttpUrl 只放行 http(s)', () => {
  assert.equal(isSafeHttpUrl('https://resend.com/signup'), true)
  assert.equal(isSafeHttpUrl('http://localhost:5102/health'), true)
  assert.equal(isSafeHttpUrl('file:///etc/passwd'), false)
  assert.equal(isSafeHttpUrl('javascript:alert(1)'), false)
  assert.equal(isSafeHttpUrl('not a url'), false)
  assert.equal(isSafeHttpUrl(''), false)
  assert.equal(isSafeHttpUrl(123), false)
})

test('normalizeBrowserConfig 收敛非法通道并补默认档案目录', () => {
  const config = normalizeBrowserConfig({ enabled: true, headless: false, channel: 'safari', profileDir: '', timeoutMs: 1 })
  assert.equal(config.channel, 'chrome')
  assert.equal(config.profileDir, join(homedir(), '.dsh', 'devforge', 'browser-profile'))
  assert.equal(config.outputDir, join(homedir(), '.dsh', 'devforge', 'browser-profile') + '-output')
  assert.equal(config.timeoutMs, 5000)
})

test('parseBrowserTabs 保留标签索引、当前状态和地址', () => {
  const tabs = '### Result\n- 0: [首页](https://a.example/)\n- 1: (current) [消息](https://b.example/im)'
  assert.deepEqual(parseBrowserTabs(tabs), [
    { index: 0, current: false, title: '首页', url: 'https://a.example/' },
    { index: 1, current: true, title: '消息', url: 'https://b.example/im' },
  ])
})

test('scopeSnapshotRefs 为相同原始引用绑定不同标签身份', () => {
  assert.equal(scopeSnapshotRefs('- button [ref=e1]', 2, 3), '- button [ref=t2g3:e1]')
  assert.equal(scopeSnapshotRefs('- button [ref=e1]', 5, 1), '- button [ref=t5g1:e1]')
  assert.deepEqual(parseScopedElementRef('t2g3:e1'), { tabId: 2, generation: 3, rawRef: 'e1' })
})

test('pickCurrentTab 解析新版多标签页当前页面', () => {
  const tabs = '### Result\n- 0: [闲鱼](https://www.goofish.com/)\n- 1: (current) [聊天_闲鱼](https://www.goofish.com/im)'
  assert.deepEqual(pickCurrentTab(tabs), { pageTitle: '聊天_闲鱼', currentUrl: 'https://www.goofish.com/im' })
})

test('buildElementTargetArgs 使用新版 Playwright MCP 的 target 参数', () => {
  assert.deepEqual(buildElementTargetArgs('f11e180'), {
    element: '快照元素 f11e180',
    target: 'f11e180',
  })
})

test('PlaywrightMcpStdio 启动失败返回拒绝且不产生未处理异常（Windows ENOENT 回归）', async () => {
  const client = new PlaywrightMcpStdio('definitely-not-exist-cmd-xyz', ['--version'], 5000)
  await assert.rejects(() => client.ensureReady(), /浏览器 MCP/)
  assert.equal(client.running, false)
  // 失败后重复调用应再次走启动流程并同样拒绝，不能卡死或抛未处理异常。
  await assert.rejects(() => client.ensureReady(), /浏览器 MCP/)
})
