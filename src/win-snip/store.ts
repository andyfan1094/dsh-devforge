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
  return next
}
