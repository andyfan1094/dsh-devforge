/**
 * 天工造梦皮肤运行时 —— 浏览器胶水层。
 *
 * 职责：
 *   1. 把 SKINS 注册到官方 ThemeRuntime（ctx.theme.register）；
 *   2. 引导期从 localStorage 恢复皮肤 / 强调色 / 壁纸；
 *   3. 对外暴露稳定的 applySkin / setAccent / setWallpaper* API，
 *      每次状态变化按 (revision, listeners) 模式通知订阅者；
 *   4. 处理 theme/change 回调时自身的 re-entrancy（因 overrideTokens
 *      自身会触发 theme/change，需要避免无限循环）。
 *
 * 设计边界：
 *   - 全部副作用收口在本文件，skins.ts 与 accent.ts 保持纯函数，便于单测；
 *   - 任何 DOM / localStorage 异常都只降级警告，不抛错影响宿主；
 *   - 皮肤选择 / 强调色 / 壁纸 都按用户浏览器本地状态持久化
 *     （Host 设置对第三方 namespace 答 settings-not-exposed）。
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'
import type { ThemeTokenOverrides } from '@deepseek-ai/dsh-client-ui-theme/client'

import { deriveAccentOverrides, normalizeHex } from './accent.ts'
import { findSkin, SKINS } from './skins.ts'

/** localStorage key 命名空间。 */
const NS = 'dsh-devforge:skin'
const KEY_SKIN = NS + ':selected'
const KEY_ACCENT = NS + ':accent'
const KEY_WALLPAPER = NS + ':wallpaper'
const KEY_WALLPAPER_OPACITY = NS + ':wallpaper-opacity'
const KEY_WALLPAPER_BLUR = NS + ':wallpaper-blur'
const KEY_WALLPAPER_FIT = NS + ':wallpaper-fit'

/** overrideTokens 来源标识（命名归本插件）。 */
const ACCENT_SOURCE = 'dsh-devforge:accent'
const WALLPAPER_SOURCE = 'dsh-devforge:wallpaper'

/** 默认值。 */
const DEFAULT_WALLPAPER_OPACITY = 0.82
const DEFAULT_WALLPAPER_BLUR = 0
const DEFAULT_WALLPAPER_FIT: WallpaperFit = 'cover'

/** Data URL 软上限：留出 localStorage 余量（约 5MB 配额），单图 1.8MB 几乎稳定。 */
const MAX_DATA_URL = 1_800_000

/** 壁纸显示方式枚举。 */
export type WallpaperFit = 'cover' | 'contain' | 'stretch' | 'tile'

export const WALLPAPER_FITS: readonly WallpaperFit[] = ['cover', 'contain', 'stretch', 'tile']

/** 用户态快照（订阅者使用）。 */
export interface SkinState {
  /** 当前选中的内置皮肤 id；未选为 null（跟随 system）。 */
  skinId: string | null
  /** 当前强调色（#rrggbb）；未选为 null。 */
  accent: string | null
  /** 当前壁纸地址（http(s)/data）；未选为 null。 */
  wallpaper: string | null
  /** 遮罩浓度 0..1（保留 0..1 不动）。 */
  opacity: number
  /** 模糊 px（0..24）。 */
  blur: number
  /** 显示方式。 */
  fit: WallpaperFit
  /** 变更计数（订阅者用 useEffect 依赖）。 */
  revision: number
}

type Listener = (state: SkinState) => void

/** 订阅者对外契约。 */
export interface SkinRuntimeApi {
  /** 读取当前状态（同一引用直到下次变更）。 */
  getState(): SkinState
  /** 选中皮肤：id=null 恢复系统默认；非法 id 返回 false。 */
  applySkin(id: string | null): boolean
  /** 强调色：hex 形如 #rrggbb；非法或 null 清除叠加层。 */
  setAccent(hex: string | null): boolean
  /** 壁纸：地址或 null。校验格式与大小。返回 false 表示未生效。 */
  setWallpaper(url: string | null): boolean
  setWallpaperOpacity(opacity: number): void
  setWallpaperBlur(blur: number): void
  setWallpaperFit(fit: WallpaperFit): void
  /** 一键恢复（皮肤/强调色/壁纸全部清除）。 */
  resetAll(): void
  /** 订阅状态变更。返回取消订阅函数。 */
  subscribe(listener: Listener): () => void
  /** 释放所有注册与监听。 */
  dispose(): void
  /** 内置皮肤目录（供 UI 渲染）。 */
  readonly skins: typeof SKINS
}

/** 安全读取 localStorage（私有存储失败仅警告）。 */
function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

/** 安全写入 localStorage（full / quota exceeded 仅警告）。 */
function writeStorage(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key)
    else window.localStorage.setItem(key, value)
  } catch (e) {
    console.warn('[dsh-devforge:skin] localStorage 写入失败：', e)
  }
}

/** 等到 body 出现（apply 早于 GUI shell 时轮询）。 */
function whenBodyReady(cb: () => void): void {
  if (typeof document === 'undefined') return
  const body = document.body
  if (body !== null) {
    cb()
    return
  }
  let raf = 0
  const tick = (): void => {
    if (document.body !== null) {
      cancelAnimationFrame(raf)
      cb()
      return
    }
    raf = requestAnimationFrame(tick)
  }
  raf = requestAnimationFrame(tick)
  // 30s 兜底，避免死循环。
  setTimeout(() => { cancelAnimationFrame(raf) }, 30_000)
}

/**
 * 把透明度按 scheme 与基础色合成成 rgba(base, alpha)。
 * 优先取当前激活皮肤的对应 scheme 的 bg-base；找不到再用兜底。
 */
function resolveBase(active: { colorScheme?: 'light' | 'dark', tokens: Record<string, string> } | null, scheme: 'light' | 'dark'): string {
  if (active !== null && active.colorScheme === scheme) {
    const t = active.tokens['--dsw-alias-bg-base']
    if (typeof t === 'string' && t.length > 0) return t
  }
  return scheme === 'light' ? '#ffffff' : '#151517'
}

/**
 * 创建皮肤运行时。失败一律降级（warn + 返回最小可用对象）。
 * 引导期即应用持久化选择，无须打开面板即生效。
 */
export function createSkinRuntime(ctx: ClientContext): SkinRuntimeApi {
  const state: SkinState = {
    skinId: null,
    accent: null,
    wallpaper: null,
    opacity: DEFAULT_WALLPAPER_OPACITY,
    blur: DEFAULT_WALLPAPER_BLUR,
    fit: DEFAULT_WALLPAPER_FIT,
    revision: 0,
  }
  const listeners = new Set<Listener>()

  let disposeThemeListen: (() => void) | null = null
  let disposeAccentLayer: (() => void) | null = null
  let disposeWallpaperLayer: (() => void) | null = null
  let wallpaperEl: HTMLDivElement | null = null
  let applyingShade = false
  const disposers: Array<() => void> = []

  const themeSvc = ctx.theme
  if (themeSvc === undefined) {
    console.warn('[dsh-devforge:skin] ctx.theme 不可用，换肤功能降级')
  }

  function bump(): void {
    state.revision += 1
    for (const l of listeners) l(state)
  }

  function subscribe(listener: Listener): () => void {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  }

  /** 应用强调色层。 */
  function applyAccentLayer(hex: string | null): void {
    disposeAccentLayer?.()
    disposeAccentLayer = null
    if (themeSvc === undefined || hex === null) return
    const overrides = deriveAccentOverrides(hex)
    if (Object.keys(overrides).length === 0) return
    disposeAccentLayer = themeSvc.overrideTokens(ACCENT_SOURCE, overrides)
  }

  /** 写入/更新覆盖层，让 bg-base 与 sidebar-fill 半透，透出壁纸。 */
  function applyWallpaperShade(): void {
    if (themeSvc === undefined) return
    if (applyingShade) return
    applyingShade = true
    try {
      const snap = themeSvc.getTheme()
      const alpha = Math.max(0, Math.min(1, state.opacity))
      const sidebarAlpha = Math.max(0, Math.min(1, Math.min(1, alpha + 0.08)))
      const lightBase = resolveBase(snap.active, 'light')
      const darkBase = resolveBase(snap.active, 'dark')
      const overrides: ThemeTokenOverrides = {
        '--dsw-alias-bg-base': { light: withAlpha(lightBase, alpha), dark: withAlpha(darkBase, alpha) },
        '--dsw-specific-sidebar-fill': { light: withAlpha(lightBase, sidebarAlpha), dark: withAlpha(darkBase, sidebarAlpha) },
      }
      disposeWallpaperLayer?.()
      disposeWallpaperLayer = themeSvc.overrideTokens(WALLPAPER_SOURCE, overrides)
    } finally {
      applyingShade = false
    }
  }

  /** 同步壁纸 DOM。 */
  function ensureWallpaperEl(): HTMLDivElement | null {
    if (typeof document === 'undefined') return null
    if (wallpaperEl !== null && wallpaperEl.isConnected) return wallpaperEl
    const el = document.createElement('div')
    el.dataset.dshDevforgeSkinWallpaper = ''
    el.style.position = 'fixed'
    el.style.inset = '0'
    el.style.zIndex = '-1'
    el.style.pointerEvents = 'none'
    el.style.backgroundRepeat = 'no-repeat'
    el.style.backgroundPosition = 'center center'
    document.body.prepend(el)
    wallpaperEl = el
    return el
  }

  function updateWallpaperEl(): void {
    const el = ensureWallpaperEl()
    if (el === null) return
    if (state.wallpaper === null) {
      el.style.backgroundImage = ''
      el.style.filter = ''
      el.style.transform = ''
      el.style.backgroundSize = ''
      return
    }
    el.style.backgroundImage = 'url("' + state.wallpaper.replace(/"/g, '%22') + '")'
    const blur = state.blur
    if (blur > 0) {
      el.style.filter = 'blur(' + blur + 'px)'
      el.style.transform = 'scale(1.05)'
    } else {
      el.style.filter = ''
      el.style.transform = ''
    }
    switch (state.fit) {
      case 'cover':
        el.style.backgroundSize = 'cover'
        break
      case 'contain':
        el.style.backgroundSize = 'contain'
        break
      case 'stretch':
        el.style.backgroundSize = '100% 100%'
        break
      case 'tile':
        el.style.backgroundSize = 'auto'
        el.style.backgroundRepeat = 'repeat'
        break
    }
  }

  function applyWallpaper(): void {
    updateWallpaperEl()
    if (state.wallpaper === null) {
      disposeWallpaperLayer?.()
      disposeWallpaperLayer = null
    } else {
      applyWallpaperShade()
    }
  }

  /** 注册全部皮肤（重复 id 由 ThemeRuntime 内部抛错）。 */
  for (const skin of SKINS) {
    if (themeSvc === undefined) break
    try {
      const d = themeSvc.register({
        id: skin.id,
        colorScheme: skin.colorScheme,
        tokens: skin.tokens as Record<string, string>,
      })
      disposers.push(d)
    } catch (e) {
      console.warn('[dsh-devforge:skin] 注册皮肤 ' + skin.id + ' 失败：', e)
    }
  }

  /** 引导恢复：皮肤。 */
  if (themeSvc !== undefined) {
    const savedSkin = readStorage(KEY_SKIN)
    if (savedSkin !== null && findSkin(savedSkin) !== undefined) {
      try {
        themeSvc.setTheme(savedSkin)
        state.skinId = savedSkin
      } catch (e) {
        console.warn('[dsh-devforge:skin] 恢复皮肤失败：', e)
      }
    }
  }

  /** 引导恢复：强调色。 */
  {
    const savedAccent = readStorage(KEY_ACCENT)
    if (savedAccent !== null) {
      const normalized = normalizeHex(savedAccent)
      if (normalized !== null) {
        state.accent = normalized
        applyAccentLayer(normalized)
      } else {
        writeStorage(KEY_ACCENT, null)
      }
    }
  }

  /** 引导恢复：壁纸参数。 */
  {
    const op = parseFloat(readStorage(KEY_WALLPAPER_OPACITY) ?? '')
    if (Number.isFinite(op) && op >= 0 && op <= 1) state.opacity = op
    const bl = Number(readStorage(KEY_WALLPAPER_BLUR))
    if (Number.isFinite(bl) && bl >= 0 && bl <= 24) state.blur = bl
    const fit = readStorage(KEY_WALLPAPER_FIT)
    if (fit !== null && (WALLPAPER_FITS as readonly string[]).includes(fit)) state.fit = fit as WallpaperFit
    const wp = readStorage(KEY_WALLPAPER)
    if (wp !== null && wp.length > 0) state.wallpaper = wp
  }

  /** 监听主题变更（重新铺壁纸遮罩）。 */
  if (typeof ctx.on === 'function') {
    const off = ctx.on('theme/change', () => {
      if (state.wallpaper !== null) applyWallpaperShade()
    })
    if (typeof off === 'function') disposeThemeListen = off
  }

  /** 引导挂载壁纸（body 可能尚未生成）。 */
  if (state.wallpaper !== null) whenBodyReady(applyWallpaper)

  function applySkin(id: string | null): boolean {
    if (themeSvc === undefined) return false
    if (id === null) {
      try { themeSvc.setTheme('system') } catch (e) { console.warn('[dsh-devforge:skin] 恢复系统主题失败：', e); return false }
      state.skinId = null
      writeStorage(KEY_SKIN, null)
      bump()
      return true
    }
    if (findSkin(id) === undefined) return false
    try { themeSvc.setTheme(id) } catch (e) { console.warn('[dsh-devforge:skin] 切换皮肤失败：', e); return false }
    state.skinId = id
    writeStorage(KEY_SKIN, id)
    bump()
    return true
  }

  function setAccent(hex: string | null): boolean {
    if (hex === null) {
      disposeAccentLayer?.()
      disposeAccentLayer = null
      state.accent = null
      writeStorage(KEY_ACCENT, null)
      bump()
      return true
    }
    const normalized = normalizeHex(hex)
    if (normalized === null) return false
    applyAccentLayer(normalized)
    state.accent = normalized
    writeStorage(KEY_ACCENT, normalized)
    bump()
    return true
  }

  function isValidWallpaperUrl(url: string): boolean {
    if (url.length === 0) return false
    if (url.length > MAX_DATA_URL) return false
    if (url.startsWith('http://') || url.startsWith('https://')) return true
    if (url.startsWith('data:image/')) return true
    if (url.startsWith('data:video/')) return true
    return false
  }

  function setWallpaper(url: string | null): boolean {
    if (url === null) {
      state.wallpaper = null
      writeStorage(KEY_WALLPAPER, null)
      whenBodyReady(applyWallpaper)
      bump()
      return true
    }
    if (!isValidWallpaperUrl(url)) return false
    state.wallpaper = url
    writeStorage(KEY_WALLPAPER, url)
    whenBodyReady(applyWallpaper)
    bump()
    return true
  }

  function setWallpaperOpacity(opacity: number): void {
    const v = Math.max(0, Math.min(1, opacity))
    state.opacity = v
    writeStorage(KEY_WALLPAPER_OPACITY, String(v))
    applyWallpaper()
    bump()
  }

  function setWallpaperBlur(blur: number): void {
    const v = Math.max(0, Math.min(24, Math.round(blur)))
    state.blur = v
    writeStorage(KEY_WALLPAPER_BLUR, String(v))
    if (state.wallpaper !== null) updateWallpaperEl()
    bump()
  }

  function setWallpaperFit(fit: WallpaperFit): void {
    if (!(WALLPAPER_FITS as readonly string[]).includes(fit)) return
    state.fit = fit
    writeStorage(KEY_WALLPAPER_FIT, fit)
    if (state.wallpaper !== null) updateWallpaperEl()
    bump()
  }

  function resetAll(): void {
    applySkin(null)
    setAccent(null)
    setWallpaper(null)
  }

  function dispose(): void {
    disposeThemeListen?.()
    disposeThemeListen = null
    disposeAccentLayer?.()
    disposeAccentLayer = null
    disposeWallpaperLayer?.()
    disposeWallpaperLayer = null
    if (wallpaperEl !== null) {
      wallpaperEl.remove()
      wallpaperEl = null
    }
    for (const d of disposers.splice(0)) d()
    listeners.clear()
  }

  return {
    getState: () => state,
    applySkin,
    setAccent,
    setWallpaper,
    setWallpaperOpacity,
    setWallpaperBlur,
    setWallpaperFit,
    resetAll,
    subscribe,
    dispose,
    skins: SKINS,
  }
}

/** 把 hex / rgb 颜色加透明度。优先走 hex/rgba 解析。 */
function withAlpha(color: string, alpha: number): string {
  const a = Math.max(0, Math.min(1, alpha))
  const hex = /^#([0-9a-f]{6})$/i.exec(color.trim())
  if (hex !== null) {
    const n = parseInt(hex[1]!, 16)
    return 'rgba(' + ((n >> 16) & 255) + ', ' + ((n >> 8) & 255) + ', ' + (n & 255) + ', ' + a + ')'
  }
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*[\d.]+)?\s*\)$/i.exec(color.trim())
  if (rgb !== null) return 'rgba(' + rgb[1] + ', ' + rgb[2] + ', ' + rgb[3] + ', ' + a + ')'
  return color
}

