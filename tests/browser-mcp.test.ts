/** 本地浏览器能力纯函数回归测试：启动参数、内容规整、URL 校验与配置收敛。 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { buildPlaywrightArgs, normalizeMcpCallResult } from '../src/browser/mcp-stdio.ts'
import { isSafeHttpUrl } from '../src/browser/protocol.ts'
import { normalizeBrowserConfig } from '../src/browser/service.ts'

test('buildPlaywrightArgs 默认有头并固定用户档案目录', () => {
  const args = buildPlaywrightArgs({ headless: false, channel: 'chrome', profileDir: '/tmp/profile', outputDir: '/tmp/out' })
  assert.equal(args[0], '-y')
  assert.ok(args.includes('@playwright/mcp@latest'))
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
