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

/** ThemeRuntime 主题注册租约：客户端重组时多个 runtime 共用同一组主题注册。 */
interface ThemeRegistrationService {
  register(definition: { id: string; colorScheme: 'light' | 'dark'; tokens: Record<string, string> }): () => void
}

interface ThemeLease {
  users: number
  disposers: Array<() => void>
}

const themeLeases = new WeakMap<object, ThemeLease>()

/**
 * 获取一份主题注册租约。模型设置刷新可能触发插件 client 重组，
 * 引用计数保证旧 runtime 销毁时不会卸掉新 runtime 仍在使用的主题。
 */
function acquireThemeLease(themeSvc: ThemeRegistrationService): () => void {
  const key = themeSvc as object
  let lease = themeLeases.get(key)
  if (lease === undefined) {
    lease = { users: 0, disposers: [] }
    for (const skin of SKINS) {
      try {
        lease.disposers.push(themeSvc.register({
          id: skin.id,
          colorScheme: skin.colorScheme,
          tokens: skin.tokens as Record<string, string>,
        }))
      } catch (error) {
        // 已由宿主或另一个兼容 runtime 注册时保留现有主题，不重复接管其生命周期。
        console.warn('[dsh-devforge:skin] 注册皮肤 ' + skin.id + ' 失败：', error)
      }
    }
    themeLeases.set(key, lease)
  }
  lease.users += 1
  let released = false
  return () => {
    if (released) return
    released = true
    lease!.users -= 1
    if (lease!.users > 0) return
    for (const dispose of lease!.disposers.splice(0).reverse()) {
      try { dispose() } catch { /* 主题服务销毁时忽略重复清理 */ }
    }
    themeLeases.delete(key)
  }
}

/** 界面遮罩滑杆下限：0 表示完全显示主题背景图。 */
export const MIN_WALLPAPER_OPACITY = 0

/** 默认值。 */
const DEFAULT_WALLPAPER_OPACITY = 0.82
const DEFAULT_WALLPAPER_BLUR = 0
const DEFAULT_WALLPAPER_FIT: WallpaperFit = 'cover'

/** Data URL 软上限：留出 localStorage 余量（约 5MB 配额），单图 1.8MB 几乎稳定。 */
const MAX_DATA_URL = 1_800_000

/** 壁纸显示方式枚举。 */
export type WallpaperFit = 'cover' | 'contain' | 'stretch' | 'tile'

export const WALLPAPER_FITS: readonly WallpaperFit[] = ['cover', 'contain', 'stretch', 'tile']

/** 壁纸来源：主题默认背景，或用户主动选择的自定义壁纸。 */
export type WallpaperSource = 'skin' | 'custom'

/** 用户态快照（订阅者使用）。 */
export interface SkinState {
  /**
   * 当前选中的内置皮肤 id；未选为 null（跟随 system）。
   * 正常状态与 ctx.theme.getTheme().active.id 保持一致；外部设置刷新造成短暂
   * 回退时，以本插件 localStorage 中的持久化目标为准并自动恢复。
   */
  skinId: string | null
  /** 当前强调色（#rrggbb）；未选为 null。 */
  accent: string | null
  /** 当前壁纸地址（http(s)/data）；未选为 null。 */
  wallpaper: string | null
  /** 当前壁纸来源：主题背景会随皮肤切换，自定义壁纸覆盖主题默认值。 */
  wallpaperSource: WallpaperSource
  /** 遮罩浓度 0..1（保留 0..1 不动）。 */
  opacity: number
  /** 模糊 px（0..24）。 */
  blur: number
  /** 显示方式。 */
  fit: WallpaperFit
  /**
   * 最近一次 localStorage 写入失败的描述（配额耗尽/被浏览器策略禁用等）。
   * SkinTab 会在 UI 顶部展示一条 banner；写入成功时为 undefined。
   * 任意一次 set* 调用成功后会自动清除。
   */
  error?: string
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
  /** 自定义壁纸：地址或 null；传 null 回退到当前主题背景。返回 false 表示未生效。 */
  setWallpaper(url: string | null): boolean
  setWallpaperOpacity(opacity: number): void
  setWallpaperBlur(blur: number): void
  setWallpaperFit(fit: WallpaperFit): void
  /** 一键恢复（皮肤/强调色/壁纸全部清除）。 */
  resetAll(): void
  /** 订阅状态变更；每次回调收到全新的快照对象（React 友好）。返回取消订阅函数。 */
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

/** 安全写入 localStorage；返回是否成功（full / quota exceeded / 隐私模式仅警告）。 */
function writeStorage(key: string, value: string | null): boolean {
  try {
    if (value === null) window.localStorage.removeItem(key)
    else window.localStorage.setItem(key, value)
    return true
  } catch (e) {
    console.warn('[dsh-devforge:skin] localStorage 写入失败：', e)
    return false
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
    wallpaperSource: 'skin',
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
  let applyingTheme = false
  let restoreTimer: ReturnType<typeof setTimeout> | undefined
  let desiredSkinId: string | null = null

  const themeSvc = ctx.theme
  if (themeSvc === undefined) {
    console.warn('[dsh-devforge:skin] ctx.theme 不可用，换肤功能降级')
  }
  const savedSkin = readStorage(KEY_SKIN)
  if (savedSkin !== null && findSkin(savedSkin) !== undefined) desiredSkinId = savedSkin
  const savedWallpaper = readStorage(KEY_WALLPAPER)
  if (savedWallpaper !== null && savedWallpaper.length > 0) {
    state.wallpaperSource = 'custom'
    state.wallpaper = savedWallpaper
  } else if (desiredSkinId !== null) {
    // 内置背景不写入 localStorage，只由已持久化的主题选择推导出来。
    state.wallpaper = findSkin(desiredSkinId)?.backgroundImage ?? null
  }
  const releaseThemeLease = themeSvc === undefined ? undefined : acquireThemeLease(themeSvc)

  /** 读取官方 runtime 当前激活的内置皮肤 id；system/light/dark 返回 null。 */
  function activeSkinId(): string | null {
    if (themeSvc === undefined) return null
    try {
      const candidate = themeSvc.getTheme().active.id
      return typeof candidate === 'string' && findSkin(candidate) !== undefined ? candidate : null
    } catch { return null }
  }

  /** 从 ctx.theme 同步状态；持久化目标存在时优先保留目标，避免外部设置刷新闪回原皮。 */
  function syncFromTheme(): void {
    if (themeSvc === undefined) return
    const activeId = activeSkinId()
    // 主题服务可能在模型设置刷新后短暂恢复为 system；本地持久化目标才是本插件皮肤的权威选择。
    const nextId = desiredSkinId !== null && activeId !== desiredSkinId ? desiredSkinId : activeId
    if (nextId !== state.skinId) state.skinId = nextId
  }

  /** 主题未被用户壁纸覆盖时，按当前皮肤切换默认背景。 */
  function syncSkinWallpaper(): void {
    if (state.wallpaperSource !== 'skin') return
    const next = state.skinId === null ? null : (findSkin(state.skinId)?.backgroundImage ?? null)
    if (state.wallpaper === next) return
    state.wallpaper = next
    whenBodyReady(applyWallpaper)
  }

  function bump(): void {
    syncFromTheme()
    syncSkinWallpaper()
    state.revision += 1
    // 关键：推给订阅者的是浅拷贝快照，绝不是可变的 state 本体。
    // React 的 useState setter 对 Object.is 相同的引用会直接跳过重渲染，
    // 若推送 state 本体，SkinTab 的选中高亮会冻结在上一次渲染的皮肤上。
    const snapshot = { ...state }
    for (const l of listeners) l(snapshot)
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
    el.style.backgroundRepeat = 'no-repeat'
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

  // 主题注册由 acquireThemeLease 统一持有，避免 client 重组时旧 runtime 抢先卸载主题。

  /** 引导恢复：皮肤。
   *
   * 关键风险：ThemeRuntime 的 host settings 持久化只接 light/dark/system，
   * 因此插件侧 setTheme('devforge-xxx') 在 in-memory 切换 OK，但 settings
   * 写入会被 schema 拒掉。reload 时 ThemeRuntime 会从 settings 恢复默认
   * preference，把插件侧的选择覆盖。本地 localStorage 才是稳定真相源，
   * 所以引导恢复必须主动 setTheme 并在 ThemeRuntime 初始化完成窗口内
   * 做多次重试，确保 GUI presenter 拿到的是用户选择的皮肤。
   */
  /**
   * 恢复持久化皮肤。模型选择会触发 Host 设置刷新，ThemeRuntime 可能随后把偏好
   * 重新采纳为 system；每次恢复都带上短重试，并由 theme/change 继续兜底。
   */
  function restoreDesiredSkin(attempt: number): void {
    if (themeSvc === undefined || desiredSkinId === null) return
    const target = desiredSkinId
    if (activeSkinId() === target) {
      syncFromTheme()
      bump()
      return
    }
    applyingTheme = true
    try {
      themeSvc.setTheme(target)
    } catch (error) {
      console.warn('[dsh-devforge:skin] 恢复皮肤失败（第 ' + attempt + ' 次）：', error)
    } finally {
      applyingTheme = false
    }
    syncFromTheme()
    if (activeSkinId() === target) {
      bump()
      return
    }
    if (attempt >= 12) {
      console.warn('[dsh-devforge:skin] 主题服务未接受持久化皮肤：' + target)
      bump()
      return
    }
    restoreTimer = setTimeout(() => {
      restoreTimer = undefined
      restoreDesiredSkin(attempt + 1)
    }, 200)
  }

  /** 延迟一次恢复，合并同一批主题刷新事件，避免 setTheme 重入。 */
  function scheduleSkinRestore(): void {
    if (themeSvc === undefined || desiredSkinId === null || applyingTheme || restoreTimer !== undefined) return
    restoreTimer = setTimeout(() => {
      restoreTimer = undefined
      restoreDesiredSkin(1)
    }, 0)
  }

  if (themeSvc !== undefined && desiredSkinId !== null) restoreDesiredSkin(1)

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
  }

  /** 监听主题变更：同步 state + 必要时重铺壁纸遮罩。 */
  if (typeof ctx.on === 'function') {
    const off = ctx.on('theme/change', () => {
      const prevSkinId = state.skinId
      syncFromTheme()
      syncSkinWallpaper()
      if (state.wallpaper !== null) applyWallpaperShade()
      // 模型选择或设置刷新导致回到 system 时，重新应用本地持久化皮肤。
      if (!applyingTheme && desiredSkinId !== null && activeSkinId() !== desiredSkinId) scheduleSkinRestore()
      // 仅在有效皮肤 id 发生变化时通知订阅者，避免壁纸遮罩重铺产生噪声。
      if (state.skinId !== prevSkinId) bump()
    })
    if (typeof off === 'function') disposeThemeListen = off
  }

  /** 引导挂载壁纸（body 可能尚未生成）。 */
  if (state.wallpaper !== null) whenBodyReady(applyWallpaper)

  function applySkin(id: string | null): boolean {
    if (themeSvc === undefined) return false
    if (id === null) {
      // 清除目标后，后续 Host 设置刷新不再自动抢回自定义皮肤。
      desiredSkinId = null
      try { themeSvc.setTheme('system') } catch (e) { console.warn('[dsh-devforge:skin] 恢复系统主题失败：', e); state.error = 'setTheme 抛错：' + (e instanceof Error ? e.message : String(e)); bump(); return false }
      if (!writeStorage(KEY_SKIN, null)) { state.error = 'localStorage 写入失败（配额已满或浏览器策略禁用）'; bump(); return false }
      state.error = undefined
      bump()
      return true
    }
    if (findSkin(id) === undefined) return false
    // 先更新目标，再调用 ThemeRuntime；setTheme 同步发出 theme/change 时也能看到正确目标。
    desiredSkinId = id
    try { themeSvc.setTheme(id) } catch (e) { console.warn('[dsh-devforge:skin] 切换皮肤失败：', e); state.error = 'setTheme 抛错：' + (e instanceof Error ? e.message : String(e)); bump(); return false }
    if (!writeStorage(KEY_SKIN, id)) { state.error = 'localStorage 写入失败（配额已满或浏览器策略禁用）'; bump(); return false }
    state.error = undefined
    bump()
    return true
  }

  function setAccent(hex: string | null): boolean {
    if (hex === null) {
      disposeAccentLayer?.()
      disposeAccentLayer = null
      state.accent = null
      if (!writeStorage(KEY_ACCENT, null)) { state.error = 'localStorage 写入失败（配额已满或浏览器策略禁用）'; bump(); return false }
      state.error = undefined
      bump()
      return true
    }
    const normalized = normalizeHex(hex)
    if (normalized === null) return false
    applyAccentLayer(normalized)
    state.accent = normalized
    if (!writeStorage(KEY_ACCENT, normalized)) { state.error = 'localStorage 写入失败（配额已满或浏览器策略禁用）'; bump(); return false }
    state.error = undefined
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
      // 清除用户壁纸后回到当前主题的默认背景，而不是让主题永久变成无背景。
      state.wallpaperSource = 'skin'
      state.wallpaper = null
      syncSkinWallpaper()
      if (!writeStorage(KEY_WALLPAPER, null)) { state.error = 'localStorage 写入失败（配额已满或浏览器策略禁用）'; bump(); return false }
      state.error = undefined
      whenBodyReady(applyWallpaper)
      bump()
      return true
    }
    if (!isValidWallpaperUrl(url)) return false
    state.wallpaperSource = 'custom'
    state.wallpaper = url
    if (!writeStorage(KEY_WALLPAPER, url)) { state.error = 'localStorage 写入失败（配额已满或浏览器策略禁用）'; bump(); return false }
    state.error = undefined
    whenBodyReady(applyWallpaper)
    bump()
    return true
  }

  function setWallpaperOpacity(opacity: number): void {
    const v = Math.max(0, Math.min(1, opacity))
    state.opacity = v
    if (!writeStorage(KEY_WALLPAPER_OPACITY, String(v))) { state.error = 'localStorage 写入失败（配额已满或浏览器策略禁用）' }
    else { state.error = undefined }
    applyWallpaper()
    bump()
  }

  function setWallpaperBlur(blur: number): void {
    const v = Math.max(0, Math.min(24, Math.round(blur)))
    state.blur = v
    if (!writeStorage(KEY_WALLPAPER_BLUR, String(v))) { state.error = 'localStorage 写入失败（配额已满或浏览器策略禁用）' }
    else { state.error = undefined }
    if (state.wallpaper !== null) updateWallpaperEl()
    bump()
  }

  function setWallpaperFit(fit: WallpaperFit): void {
    if (!(WALLPAPER_FITS as readonly string[]).includes(fit)) return
    state.fit = fit
    if (!writeStorage(KEY_WALLPAPER_FIT, fit)) { state.error = 'localStorage 写入失败（配额已满或浏览器策略禁用）' }
    else { state.error = undefined }
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
    if (restoreTimer !== undefined) {
      clearTimeout(restoreTimer)
      restoreTimer = undefined
    }
    if (wallpaperEl !== null) {
      wallpaperEl.remove()
      wallpaperEl = null
    }
    releaseThemeLease?.()
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

