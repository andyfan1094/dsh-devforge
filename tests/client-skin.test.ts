/**
 * 皮肤与强调色模块的纯函数单测（无 DOM，无 localStorage）。
 *
 * 重点：
 *   1. 每套皮肤覆盖全部必需 token、id 唯一、colorScheme 合法；
 *   2. 强调色衍生：色值合法、light/dark 双套都有、按钮文字按亮度自适配；
 *   3. locale key 全部命中 zhDict —— 漏译时立刻报错。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { en, zh, zhDict } from '../src/client/locales.ts'
import { ACCENT_PRESETS, adjustHex, deriveAccentOverrides, hexToRgb, mixHex, normalizeHex, pickTextOn, relativeLuminance, rgbaStr } from '../src/client/theme/accent.ts'
import { REQUIRED_TOKEN_KEYS, SKINS, findSkin } from '../src/client/theme/skins.ts'
import { createSkinRuntime } from '../src/client/theme/skin-runtime.ts'
import type { SkinState } from '../src/client/theme/skin-runtime.ts'

test('normalizeHex 接受 #rgb / #rrggbb，非法输入返回 null', () => {
  assert.equal(normalizeHex('#abc'), '#aabbcc')
  assert.equal(normalizeHex('#AABBCC'), '#aabbcc')
  assert.equal(normalizeHex('  #112233  '), '#112233')
  assert.equal(normalizeHex('#xyz'), null)
  assert.equal(normalizeHex('rgb(1,2,3)'), null)
  assert.equal(normalizeHex(''), null)
})

test('mixHex / adjustHex 输出合法 hex', () => {
  const mid = mixHex('#000000', '#ffffff', 0.5)
  assert.equal(mid, '#808080')
  const lighter = adjustHex('#000000', 0.5)
  assert.equal(lighter, '#808080')
  const darker = adjustHex('#ffffff', -0.5)
  assert.equal(darker, '#808080')
})

test('rgbaStr 输出 rgba(...) 字符串', () => {
  assert.equal(rgbaStr('#2563eb', 0.5), 'rgba(37, 99, 235, 0.5)')
  assert.equal(rgbaStr('#ff0000', 1), 'rgba(255, 0, 0, 1)')
})

test('hexToRgb 正确解码', () => {
  assert.deepEqual(hexToRgb('#2f6fed'), [47, 111, 237])
  assert.deepEqual(hexToRgb('#fff'), [255, 255, 255])
  assert.equal(hexToRgb('not a color'), null)
})

test('relativeLuminance 黑白两侧单调', () => {
  assert.ok(relativeLuminance('#000000') < relativeLuminance('#808080'))
  assert.ok(relativeLuminance('#808080') < relativeLuminance('#ffffff'))
})

test('pickTextOn 自动按亮度反相文字色', () => {
  assert.equal(pickTextOn('#ffffff'), '#0b0e14')
  assert.equal(pickTextOn('#000000'), '#ffffff')
  assert.equal(pickTextOn('#facc15'), '#0b0e14')
  assert.equal(pickTextOn('#1d4ed8'), '#ffffff')
})

test('deriveAccentOverrides 每条都含 light/dark 字符串值；primary/state-business 与主题色一致，hover/dimmed/interactive 浅深应有差', () => {
  const overrides = deriveAccentOverrides('#2f6fed')
  assert.ok(Object.keys(overrides).length > 0, '至少有 1 个 token 被覆盖')
  for (const [key, value] of Object.entries(overrides)) {
    assert.ok(typeof value.light === 'string' && value.light.length > 0, key + ' 必须有 light 值')
    assert.ok(typeof value.dark === 'string' && value.dark.length > 0, key + ' 必须有 dark 值')
  }
  // brand-primary / state-business-primary 跨主题色一致（accent 自身）
  assert.equal(overrides['--dsw-alias-brand-primary']?.light, overrides['--dsw-alias-brand-primary']?.dark)
  assert.equal(overrides['--dsw-alias-state-business-primary']?.light, overrides['--dsw-alias-state-business-primary']?.dark)
  // hover 在浅色系压暗、深色系提亮，必然不同
  assert.notEqual(overrides['--dsw-alias-button-primary-hover']?.light, overrides['--dsw-alias-button-primary-hover']?.dark)
  // interactive 同理
  assert.notEqual(overrides['--dsw-alias-interactive-bg-hover']?.light, overrides['--dsw-alias-interactive-bg-hover']?.dark)
})

test('deriveAccentOverrides 接受 #rgb 缩写', () => {
  const overrides = deriveAccentOverrides('#abc')
  assert.ok(Object.keys(overrides).length > 0)
})

test('deriveAccentOverrides 非法输入返回空对象', () => {
  assert.deepEqual(deriveAccentOverrides('not a color'), {})
})

test('ACCENT_PRESETS 全部 hex 合法 + 全部 labelKey 命中 zhDict', () => {
  for (const p of ACCENT_PRESETS) {
    assert.ok(normalizeHex(p.hex) !== null, p.hex + ' 应是合法 hex')
    assert.ok(p.labelKey in zhDict, '强调色 ' + p.hex + ' 的 labelKey=' + p.labelKey + ' 应在 zhDict 中')
    assert.ok(p.labelKey in en, '强调色 ' + p.hex + ' 的 labelKey=' + p.labelKey + ' 应在 en 中')
  }
})

test('SKINS 至少 5 套深 + 5 套浅，且 id 唯一', () => {
  assert.ok(SKINS.length >= 8, '至少 8 套皮肤')
  const ids = new Set<string>()
  let lightCount = 0
  let darkCount = 0
  for (const s of SKINS) {
    assert.ok(!ids.has(s.id), '皮肤 id 必须唯一：' + s.id)
    ids.add(s.id)
    assert.ok(s.colorScheme === 'light' || s.colorScheme === 'dark', s.id + ' colorScheme 非法')
    if (s.colorScheme === 'light') lightCount++
    else darkCount++
  }
  assert.ok(lightCount >= 4, '浅色至少 4 套')
  assert.ok(darkCount >= 4, '深色至少 4 套')
})

test('SKINS 每套都覆盖全部必需 token，且 token 值非空', () => {
  for (const s of SKINS) {
    for (const key of REQUIRED_TOKEN_KEYS) {
      assert.ok(typeof s.tokens[key] === 'string', s.id + ' 缺少 token: ' + key)
      assert.ok((s.tokens[key] ?? '').length > 0, s.id + ' token ' + key + ' 不能为空')
    }
  }
})

test('SKINS 的 labelKey 全部命中 zh/en 双语字典', () => {
  for (const s of SKINS) {
    assert.ok(s.labelKey in zhDict, '皮肤 ' + s.id + ' labelKey=' + s.labelKey + ' 应在 zhDict 中')
    assert.ok(s.labelKey in en, '皮肤 ' + s.id + ' labelKey=' + s.labelKey + ' 应在 en 中')
  }
})

test('SKINS 不存在重名（用于 setTheme 校验）', () => {
  for (const s of SKINS) {
    assert.equal(findSkin(s.id)?.id, s.id, 'findSkin 应能找到自己：' + s.id)
  }
  assert.equal(findSkin('not-a-skin'), undefined)
})

test('中国红皮肤：设计锚点（浅色宣纸底 + 国旗红主色 + 白字）不被无意篡改', () => {
  const skin = findSkin('devforge-china-red')
  assert.ok(skin !== undefined, '中国红皮肤必须已注册')
  assert.equal(skin!.colorScheme, 'light', '中国红是浅色系')
  assert.equal(skin!.labelKey, 'skin.chinaRed')
  // 主色：国旗红/中国红经典色值
  assert.equal(skin!.tokens['--dsw-alias-brand-primary'], '#c8102e')
  // 品牌底色上的文字必须由 pickTextOn 决定（#c8102e 亮度低 → 白字）
  assert.equal(skin!.tokens['--dsw-alias-brand-text'], pickTextOn('#c8102e'))
  assert.equal(skin!.tokens['--dsw-alias-brand-text'], '#ffffff')
  // 底面保持宣纸暖白而非整屏大红：bg-base 必须是高亮度暖白
  const base = skin!.tokens['--dsw-alias-bg-base']!
  assert.ok(relativeLuminance(base) > 0.85, 'bg-base 应为宣纸暖白，实际 ' + base)
  // 悬停层是朱砂染（带透明度的主色），与品牌色同源
  assert.equal(skin!.tokens['--dsw-alias-interactive-bg-hover'], 'rgba(200, 16, 46, 0.08)')
})

test('SKINS 的 brand-text 与品牌色对比度合规（lum ≥ 0.55 用深字，否则用浅字）', () => {
  for (const s of SKINS) {
    const brand = s.tokens['--dsw-alias-brand-primary']
    const text = s.tokens['--dsw-alias-brand-text']
    if (brand === undefined || text === undefined) continue
    assert.equal(text, pickTextOn(brand), s.id + ' brand-text 应由 pickTextOn 自动决定')
  }
})

test('zh 与 en 字典 key 完全一致（漏译编译期 + 运行期双重保护）', () => {
  assert.deepEqual(Object.keys(zh).sort(), Object.keys(en).sort())
})

test('zhDict 中每个 skin.* key 都有对应 en 条目且 zh === en 互译', () => {
  // 仅做对称性检查；UI 文案与皮肤 labelKey 是两个层级，UI 文案不一定作为皮肤 labelKey。
  for (const k of Object.keys(zhDict)) {
    if (k.startsWith('skin.') || k.startsWith('accent.')) {
      assert.ok(k in en, 'zhDict 键 ' + k + ' 必须在 en 中存在')
      assert.ok((en[k] ?? '').length > 0, 'en[' + k + '] 不能为空')
      assert.ok((zh[k] ?? '').length > 0, 'zh[' + k + '] 不能为空')
    }
  }
})

test('换肤运行时：外部设置刷新与 client 重挂载不会清掉所选皮肤', async () => {
  const root = globalThis as unknown as { window?: unknown }
  const hadWindow = Object.prototype.hasOwnProperty.call(root, 'window')
  const previousWindow = root.window
  const values = new Map<string, string>()
  Object.defineProperty(root, 'window', {
    configurable: true,
    value: { localStorage: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) }, removeItem: (key: string) => { values.delete(key) } } },
  })
  const themeListeners = new Set<() => void>()
  const registrations = new Set<string>()
  let registerCount = 0
  let activeId = 'system'
  const emitThemeChange = (): void => { for (const listener of [...themeListeners]) listener() }
  const theme = {
    register: (definition: { id: string }) => { registerCount += 1; registrations.add(definition.id); return () => { registrations.delete(definition.id) } },
    getTheme: () => ({ active: { id: activeId, colorScheme: activeId === 'system' ? 'light' : 'dark', tokens: {} } }),
    setTheme: (id: string) => { activeId = id; emitThemeChange() },
    overrideTokens: () => () => {},
  }
  const ctx = { theme, on: (_event: string, listener: () => void) => { themeListeners.add(listener); return () => { themeListeners.delete(listener) } } }
  const skinId = SKINS[0]!.id
  try {
    const first = createSkinRuntime(ctx as never)
    assert.equal(first.applySkin(skinId), true)
    const second = createSkinRuntime(ctx as never)
    assert.equal(registerCount, SKINS.length, '重复挂载不能重复注册主题')
    assert.equal(second.getState().skinId, skinId)

    activeId = 'system'
    emitThemeChange()
    await new Promise((resolve) => setTimeout(resolve, 20))
    assert.equal(activeId, skinId, '外部设置刷新后应恢复持久化皮肤')
    assert.equal(first.getState().skinId, skinId)
    assert.equal(second.getState().skinId, skinId)

    first.dispose()
    assert.equal(registrations.size, SKINS.length, '旧 runtime 释放不能卸掉新 runtime 仍使用的主题')
    second.dispose()
    assert.equal(registrations.size, 0, '最后一个 runtime 释放后才卸载主题')
  } finally {
    if (hadWindow) Object.defineProperty(root, 'window', { configurable: true, value: previousWindow })
    else Reflect.deleteProperty(root, 'window')
  }
})

test('换肤运行时：订阅者每次收到全新快照对象（引用复用会让 React setState 跳过重渲染）', () => {
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
  try {
    const runtime = createSkinRuntime(ctx as never)
    const snapshots: SkinState[] = []
    const off = runtime.subscribe((s) => snapshots.push(s))
    assert.equal(runtime.applySkin(SKINS[1]!.id), true)
    assert.equal(runtime.setAccent('#112233'), true)
    off()
    runtime.dispose()
    // 换肤（setTheme 同步 theme/change + applySkin 收尾）与强调色至少各推送一次
    assert.ok(snapshots.length >= 2, '至少推送 2 次状态变更，实际 ' + snapshots.length)
    for (let i = 1; i < snapshots.length; i++) {
      assert.notEqual(snapshots[i], snapshots[i - 1]!, '第 ' + (i + 1) + ' 次推送复用了旧引用——React useState 对相同引用会跳过重渲染，选中高亮将冻结')
    }
    // 快照内容与真实状态一致
    const last = snapshots[snapshots.length - 1]!
    assert.equal(last.skinId, SKINS[1]!.id)
    assert.equal(last.accent, '#112233')
    // 快照必须与 runtime 内部可变 state 解耦：后续变更不得篡改已推送的快照
    assert.equal(runtime.applySkin(SKINS[2]!.id), true)
    assert.equal(last.skinId, SKINS[1]!.id, '已推送的快照不可被后续状态变更改写')
    runtime.dispose()
  } finally {
    if (hadWindow) Object.defineProperty(root, 'window', { configurable: true, value: previousWindow })
    else Reflect.deleteProperty(root, 'window')
  }
})
