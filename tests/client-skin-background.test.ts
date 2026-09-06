/**
 * 主题默认背景与用户自定义壁纸优先级的运行时回归测试。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { SKINS } from '../src/client/theme/skins.ts'
import { createSkinRuntime } from '../src/client/theme/skin-runtime.ts'

test('主题背景随切换更新，自定义壁纸优先且清除后回退主题图', () => {
  const root = globalThis as unknown as { window?: unknown }
  const hadWindow = Object.prototype.hasOwnProperty.call(root, 'window')
  const previousWindow = root.window
  const values = new Map<string, string>()
  Object.defineProperty(root, 'window', {
    configurable: true,
    value: { localStorage: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) }, removeItem: (key: string) => { values.delete(key) } } },
  })
  const themeListeners = new Set<() => void>()
  let activeId = 'system'
  const emitThemeChange = (): void => { for (const listener of [...themeListeners]) listener() }
  const theme = {
    register: () => () => {},
    getTheme: () => ({ active: { id: activeId, colorScheme: 'light', tokens: {} } }),
    setTheme: (id: string) => { activeId = id; emitThemeChange() },
    overrideTokens: () => () => {},
  }
  const ctx = { theme, on: (_event: string, listener: () => void) => { themeListeners.add(listener); return () => { themeListeners.delete(listener) } } }
  const first = SKINS[0]!
  const second = SKINS[1]!
  try {
    const runtime = createSkinRuntime(ctx as never)
    assert.equal(runtime.applySkin(first.id), true)
    assert.equal(runtime.getState().wallpaperSource, 'skin')
    assert.equal(runtime.getState().wallpaper, first.backgroundImage)

    const custom = 'data:image/jpeg;base64,custom-wallpaper'
    assert.equal(runtime.setWallpaper(custom), true)
    assert.equal(runtime.getState().wallpaperSource, 'custom')
    assert.equal(runtime.applySkin(second.id), true)
    assert.equal(runtime.getState().wallpaper, custom, '自定义壁纸不应被主题切换覆盖')

    assert.equal(runtime.setWallpaper(null), true)
    assert.equal(runtime.getState().wallpaperSource, 'skin')
    assert.equal(runtime.getState().wallpaper, second.backgroundImage)
    assert.equal(values.has('dsh-devforge:skin:wallpaper'), false, '主题默认图不应写入 localStorage')

    assert.equal(runtime.applySkin(null), true)
    assert.equal(runtime.getState().wallpaper, null)
    runtime.dispose()
  } finally {
    if (hadWindow) Object.defineProperty(root, 'window', { configurable: true, value: previousWindow })
    else Reflect.deleteProperty(root, 'window')
  }
})
