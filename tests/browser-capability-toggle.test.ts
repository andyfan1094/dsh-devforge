/**
 * 本地浏览器能力开关交付验证（2026-09-28）。
 *
 * 背景：新装用户此前拿到的是「浏览器工具未启用，且面板里没有地方启用」——
 * 默认值是全插件唯一一个 false，面板 BrowserTab 又只显示状态、没有开关。
 * 本文件锁住修复后的三条契约：
 * ① 默认值：基础工具开、发布类工具关（源码级锚点，见文末说明）；
 * ② 工具分组：publish 关时闲鱼/小红书工具不得注册；
 * ③ 面板补丁合并：只认布尔字段、缺省保持原值、不改动入参。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import { activateBrowser } from '../src/browser/activate.ts'
import { normalizeBrowserConfig } from '../src/browser/service.ts'
import { mergeBrowserSettings } from '../src/browser/routes.ts'

/** 假宿主上下文：只提供 activateBrowser 用到的 effect 与 tools.register，并记录注册到的工具名。 */
function makeFakeCtx(): { ctx: Context; registered: string[] } {
  const registered: string[] = []
  const ctx = {
    effect: (setup: () => () => void) => setup(),
    tools: { register: (tool: { name: string }) => { registered.push(tool.name); return () => {} } },
  } as unknown as Context
  return { ctx, registered }
}

/** 一份启用态的最小配置（publish 由各用例覆盖）。 */
function configOf(publish: boolean, enabled = true): { enabled: boolean; publish: boolean; headless: boolean; channel: string; profileDir: string; timeoutMs: number } {
  return { enabled, publish, headless: false, channel: 'chrome', profileDir: '', timeoutMs: 45000 }
}

test('开关默认值：基础浏览器工具默认开、发布类工具默认关', () => {
  // 为什么扫源码而不是 import：src/index.ts 含 node --experimental-strip-types 不支持的语法，
  // 项目内所有测试都只 import 独立模块（见 browser-mcp / sandbox-discipline 等），
  // 因此这里以源码文本作为回归锚点——任何人把默认值改回 false 都会立刻挂掉本用例。
  const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'index.ts'), 'utf8')
  assert.ok(source.includes("enabled: z.boolean().default(true).description('本地浏览器控制开关"), '浏览器基础工具默认值必须是 true（新装用户开箱可用）')
  assert.ok(source.includes("publish: z.boolean().default(false).description('闲鱼/小红书发布类工具开关"), '发布类工具默认值必须是 false（会真实发布内容）')
})

test('normalizeBrowserConfig 透传 publish，非 true 一律收敛为 false', () => {
  const base = { enabled: true, headless: false, channel: 'chrome', profileDir: '', timeoutMs: 45000 }
  assert.equal(normalizeBrowserConfig({ ...base, publish: true }).publish, true)
  assert.equal(normalizeBrowserConfig({ ...base, publish: false }).publish, false)
})

test('enabled 关时注册零工具，且不对外暴露浏览器服务', () => {
  const { ctx, registered } = makeFakeCtx()
  const activation = activateBrowser(ctx, configOf(true, false))
  assert.equal(activation.browser, undefined)
  assert.deepEqual(registered, [])
  activation.dispose()
})

test('publish 关时只注册基础浏览器工具，发布类工具一个都不出现', () => {
  const { ctx, registered } = makeFakeCtx()
  const activation = activateBrowser(ctx, configOf(false))
  assert.ok(registered.includes('browser_open'))
  assert.ok(registered.includes('browser_snapshot'))
  assert.ok(registered.includes('browser_click'))
  assert.ok(!registered.includes('xianyu_messages_list'))
  assert.ok(!registered.includes('xianyu_reply'))
  assert.ok(!registered.includes('xianyu_publish'))
  assert.ok(!registered.includes('xiaohongshu_publish'))
  activation.dispose()
})

test('publish 开时基础工具与发布类工具一并注册', () => {
  const { ctx, registered } = makeFakeCtx()
  const activation = activateBrowser(ctx, configOf(true))
  assert.ok(registered.includes('browser_open'))
  assert.ok(registered.includes('xianyu_messages_list'))
  assert.ok(registered.includes('xianyu_reply'))
  assert.ok(registered.includes('xianyu_publish'))
  assert.ok(registered.includes('xiaohongshu_publish'))
  activation.dispose()
})

test('mergeBrowserSettings：缺省字段保持原值', () => {
  const current = { enabled: true, publish: false }
  assert.deepEqual(mergeBrowserSettings(current, {}), current)
  assert.deepEqual(mergeBrowserSettings(current, { publish: true }), { enabled: true, publish: true })
  assert.deepEqual(mergeBrowserSettings(current, { enabled: false }), { enabled: false, publish: false })
})

test('mergeBrowserSettings：非布尔与未知字段被忽略，且不改动入参对象', () => {
  const current = { enabled: true, publish: false }
  const merged = mergeBrowserSettings(current, { enabled: 'yes', publish: 1, extra: true } as never)
  assert.deepEqual(merged, current)
  assert.deepEqual(current, { enabled: true, publish: false })
})
