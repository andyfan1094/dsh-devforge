/**
 * 剪贴板历史 + 热键功能选择框：配置契约、补丁合并与路由常量。
 *
 * 为什么单独一个测试：这三件事都是"面板能点、宿主会存、原生要读"的跨层契约，
 * 任何一层改名或漏字段，表现都是"面板上勾了却没反应"——用户现场无从判断。
 * 所以把默认值、类型收敛、天数夹取与路由路径钉在这里，先失败再实现。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { WIN_SNIP_API } from '../src/win-snip/protocol.ts'
import { DEFAULT_WIN_SNIP_SETTINGS, mergeWinSnipSettings } from '../src/win-snip/store.ts'

test('默认配置：热键先弹功能选择框、后台记录剪贴板、保留 15 天', () => {
  assert.equal(DEFAULT_WIN_SNIP_SETTINGS.hotkeyMenu, true)
  assert.equal(DEFAULT_WIN_SNIP_SETTINGS.clipboardEnabled, true)
  assert.equal(DEFAULT_WIN_SNIP_SETTINGS.clipboardDays, 15)
})

test('默认配置：既有字段保持不变（新功能不得改动老行为）', () => {
  assert.equal(DEFAULT_WIN_SNIP_SETTINGS.enabled, false)
  assert.equal(DEFAULT_WIN_SNIP_SETTINGS.hotkey, 'Alt+A')
  assert.equal(DEFAULT_WIN_SNIP_SETTINGS.saveDir, '')
  assert.equal(DEFAULT_WIN_SNIP_SETTINGS.copyOnFinish, true)
  assert.equal(DEFAULT_WIN_SNIP_SETTINGS.translateTarget, 'auto')
  assert.equal(DEFAULT_WIN_SNIP_SETTINGS.ocrModel, '')
})

test('补丁合并：三个新字段都能改，且不动其它字段', () => {
  const next = mergeWinSnipSettings(
    { ...DEFAULT_WIN_SNIP_SETTINGS, hotkey: 'Ctrl+Shift+S', copyOnFinish: false },
    { hotkeyMenu: false, clipboardEnabled: false, clipboardDays: 30 },
  )
  assert.equal(next.hotkeyMenu, false)
  assert.equal(next.clipboardEnabled, false)
  assert.equal(next.clipboardDays, 30)
  assert.equal(next.hotkey, 'Ctrl+Shift+S')
  assert.equal(next.copyOnFinish, false)
  assert.equal(next.translateTarget, 'auto')
})

test('补丁合并：非法类型忽略，保留原值（不写 NaN 进库）', () => {
  const current = {
    ...DEFAULT_WIN_SNIP_SETTINGS,
    hotkeyMenu: false,
    clipboardEnabled: false,
    clipboardDays: 30,
  }
  const next = mergeWinSnipSettings(current, {
    // 面板/手工改库都可能塞进这些脏值：字符串、数字冒充布尔、null。
    hotkeyMenu: 'yes' as unknown as boolean,
    clipboardEnabled: 1 as unknown as boolean,
    clipboardDays: 'abc' as unknown as number,
  })
  assert.equal(next.hotkeyMenu, false)
  assert.equal(next.clipboardEnabled, false)
  assert.equal(next.clipboardDays, 30)
  assert.equal(Number.isFinite(next.clipboardDays), true)
})

test('保留天数：越界夹取到 1–90，不做静默丢弃', () => {
  assert.equal(mergeWinSnipSettings(DEFAULT_WIN_SNIP_SETTINGS, { clipboardDays: 0 }).clipboardDays, 1)
  assert.equal(mergeWinSnipSettings(DEFAULT_WIN_SNIP_SETTINGS, { clipboardDays: -7 }).clipboardDays, 1)
  assert.equal(mergeWinSnipSettings(DEFAULT_WIN_SNIP_SETTINGS, { clipboardDays: 999 }).clipboardDays, 90)
  assert.equal(mergeWinSnipSettings(DEFAULT_WIN_SNIP_SETTINGS, { clipboardDays: 1 }).clipboardDays, 1)
  assert.equal(mergeWinSnipSettings(DEFAULT_WIN_SNIP_SETTINGS, { clipboardDays: 90 }).clipboardDays, 90)
  // NaN / Infinity 属于"不可用数值"，按原值保留，避免算出一个越界天数。
  assert.equal(mergeWinSnipSettings(DEFAULT_WIN_SNIP_SETTINGS, { clipboardDays: Number.NaN }).clipboardDays, 15)
  assert.equal(mergeWinSnipSettings(DEFAULT_WIN_SNIP_SETTINGS, { clipboardDays: Number.POSITIVE_INFINITY }).clipboardDays, 15)
})

test('路由常量：剪贴板路由路径固定，面板与宿主逐字一致', () => {
  assert.equal(WIN_SNIP_API.clipboard, '/api/dsh-devforge/win-snip/clipboard')
  // 既有路由不能被这次改动挤掉或改名。
  assert.equal(WIN_SNIP_API.capture, '/api/dsh-devforge/win-snip/capture')
  assert.equal(WIN_SNIP_API.settings, '/api/dsh-devforge/win-snip/settings')
})
