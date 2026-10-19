/**
 * 截图小工具配置的落库读写。
 *
 * 配置单独占一个 settings 域（win-snip.settings），与其它能力互不影响；
 * 读取时逐字段收敛类型，避免历史版本或手工改库把脏值带进运行逻辑。
 */
import { homedir } from 'node:os'
import { join } from 'node:path'
import { getDb, getSettings, putSettings } from '../store/db.ts'
import {
  parseHotkey,
  WIN_SNIP_CLIPBOARD_DAYS,
  type WinSnipSettings,
  type WinSnipSettingsPatch,
  type WinSnipTranslateTarget,
} from './protocol.ts'

/** 设置域键名。 */
const SETTINGS_DOMAIN = 'win-snip.settings'

/** 默认配置：默认不随启动拉起（用户显式开启后才常驻）。 */
export const DEFAULT_WIN_SNIP_SETTINGS: WinSnipSettings = {
  enabled: false,
  hotkey: 'Alt+A',
  saveDir: '',
  copyOnFinish: true,
  translateTarget: 'auto',
  ocrModel: '',
  // 热键先弹功能选择框：默认开，保留"直达截图"作为可选项。
  hotkeyMenu: true,
  // 剪贴板历史默认记录：用户既然装了截图工具，复制内容能回溯是低风险的高价值能力。
  clipboardEnabled: true,
  clipboardDays: 15,
}

/**
 * 把任意输入收敛成合法的保留天数（1–90 的整数）。
 *
 * 为什么夹取而不是报错：面板数字框、手工改库、老版本迁移都可能给出越界值，
 * 这种情况下"就近取边界"比让整个设置页保存失败更符合用户预期；
 * 非有限数（NaN / Infinity / 字符串）没有可用的"就近"，回落调用方给的原值
 * （不传时用默认值）。
 *
 * @param value 待收敛的值。
 * @param fallback 无法收敛时使用的原值/默认值。
 */
export function clampClipboardDays(value: unknown, fallback: number = DEFAULT_WIN_SNIP_SETTINGS.clipboardDays): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  const rounded = Math.trunc(value)
  if (rounded < WIN_SNIP_CLIPBOARD_DAYS.min) return WIN_SNIP_CLIPBOARD_DAYS.min
  if (rounded > WIN_SNIP_CLIPBOARD_DAYS.max) return WIN_SNIP_CLIPBOARD_DAYS.max
  return rounded
}


/** 允许的翻译目标取值。 */
const TARGETS: readonly WinSnipTranslateTarget[] = ['auto', 'zh', 'en']

/**
 * 解析实际保存目录。
 *
 * 空值回落到系统图片目录下的「DSH截图」，避免默认把截图丢进插件数据目录
 * （用户找不到自己的图片）。
 *
 * @param settings 当前配置。
 */
export function resolveSaveDir(settings: WinSnipSettings): string {
  const configured = settings.saveDir.trim()
  if (configured !== '') return configured
  return join(homedir(), 'Pictures', 'DSH截图')
}

/** 读取配置；库不可用或字段异常时回落到默认值，绝不抛给调用方。 */
export function readWinSnipSettings(): WinSnipSettings {
  let stored: Partial<WinSnipSettings> | undefined
  try {
    stored = getSettings<Partial<WinSnipSettings>>(getDb(), SETTINGS_DOMAIN)
  } catch {
    stored = undefined
  }
  if (stored === undefined || stored === null) return { ...DEFAULT_WIN_SNIP_SETTINGS }
  const hotkey = parseHotkey(stored.hotkey)?.label ?? DEFAULT_WIN_SNIP_SETTINGS.hotkey
  return {
    enabled: stored.enabled === true,
    hotkey,
    saveDir: typeof stored.saveDir === 'string' ? stored.saveDir : DEFAULT_WIN_SNIP_SETTINGS.saveDir,
    copyOnFinish: stored.copyOnFinish !== false,
    translateTarget: TARGETS.includes(stored.translateTarget as WinSnipTranslateTarget)
      ? stored.translateTarget as WinSnipTranslateTarget
      : DEFAULT_WIN_SNIP_SETTINGS.translateTarget,
    // 模型 id 不做白名单校验：模型目录会变，存个字符串，用时找不到会明确报错。
    ocrModel: typeof stored.ocrModel === 'string' ? stored.ocrModel.trim().slice(0, 120) : DEFAULT_WIN_SNIP_SETTINGS.ocrModel,
    // 老库没有这三个字段：一律取默认（新功能默认开），不能当成"用户关了"。
    hotkeyMenu: stored.hotkeyMenu !== false,
    clipboardEnabled: stored.clipboardEnabled !== false,
    // 天数允许夹取：历史版本/手工改库给出的 0 或 999 都收敛到 1–90。
    clipboardDays: clampClipboardDays(stored.clipboardDays, DEFAULT_WIN_SNIP_SETTINGS.clipboardDays),
  }
}

/** 保存配置（调用方负责先做字段校验）。 */
export function writeWinSnipSettings(settings: WinSnipSettings): void {
  putSettings(getDb(), SETTINGS_DOMAIN, settings)
}

/**
 * 合并面板补丁（纯函数，可测）。
 *
 * 只接受已知字段并逐个收敛类型；热键非法时保留原值，
 * 由路由层单独判断是否需要给用户报错。
 *
 * @param current 当前配置。
 * @param patch 面板提交的增量。
 */
export function mergeWinSnipSettings(current: WinSnipSettings, patch: WinSnipSettingsPatch): WinSnipSettings {
  const next: WinSnipSettings = { ...current }
  if (typeof patch.enabled === 'boolean') next.enabled = patch.enabled
  if (typeof patch.hotkey === 'string') {
    const parsed = parseHotkey(patch.hotkey)
    if (parsed !== undefined) next.hotkey = parsed.label
  }
  if (typeof patch.saveDir === 'string') next.saveDir = patch.saveDir.trim().slice(0, 512)
  if (typeof patch.copyOnFinish === 'boolean') next.copyOnFinish = patch.copyOnFinish

  if (typeof patch.ocrModel === 'string') next.ocrModel = patch.ocrModel.trim().slice(0, 120)
  if (typeof patch.translateTarget === 'string' && TARGETS.includes(patch.translateTarget as WinSnipTranslateTarget)) {
    next.translateTarget = patch.translateTarget as WinSnipTranslateTarget
  }
  // 新开关与前两个布尔字段同语义：只接受真正的布尔值，脏值忽略并保留原值。
  if (typeof patch.hotkeyMenu === 'boolean') next.hotkeyMenu = patch.hotkeyMenu
  if (typeof patch.clipboardEnabled === 'boolean') next.clipboardEnabled = patch.clipboardEnabled
  if (patch.clipboardDays !== undefined) {
    // 越界夹取到 1–90（0→1、999→90）；非数字保持原值，别把 NaN 落库。
    next.clipboardDays = clampClipboardDays(patch.clipboardDays, current.clipboardDays)
  }
  return next
}
