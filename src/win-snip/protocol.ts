/**
 * Windows 截图小工具（win-snip）的无密契约。
 *
 * 边界说明：本模块只描述"面板 ↔ 宿主"以及"宿主 ↔ 原生助手"之间的数据形状，
 * 不含任何端口、令牌或模型凭据；模型 Key 只在宿主侧的受管凭据里解析。
 */

/** 面板 API 路由（仅本机 GUI 同源可访问）。 */
export const WIN_SNIP_API = {
  status: '/api/dsh-devforge/win-snip/status',
  settings: '/api/dsh-devforge/win-snip/settings',
  start: '/api/dsh-devforge/win-snip/start',
  stop: '/api/dsh-devforge/win-snip/stop',
  capture: '/api/dsh-devforge/win-snip/capture',
  /** 让面板直接唤起原生侧「剪贴板历史」窗口（等价于热键里选「剪贴板」）。 */
  clipboard: '/api/dsh-devforge/win-snip/clipboard',
} as const

/** 剪贴板历史保留天数的允许区间（含边界）。 */
export const WIN_SNIP_CLIPBOARD_DAYS = { min: 1, max: 90 } as const


/** 翻译目标语言：auto 由模型自行判断中英互译方向。 */
export type WinSnipTranslateTarget = 'auto' | 'zh' | 'en'

/** 面板可编辑的配置。 */
export interface WinSnipSettings {
  /** 是否随插件启动常驻助手（关闭后热键不生效）。 */
  enabled: boolean
  /** 全局热键，形如 `Alt+A`。 */
  hotkey: string
  /** 保存目录；空字符串表示使用系统图片目录下的「DSH截图」。 */
  saveDir: string
  /** 框选完成即复制到剪贴板。 */
  copyOnFinish: boolean

  /** 翻译目标语言。 */
  translateTarget: WinSnipTranslateTarget
  /**
   * 识别/翻译用的模型 id；空字符串表示自动。
   *
   * 自动会挑"快且能看图"的模型（实测 GLM-Flash、gpt-6.1-sol 都在 4~5 秒，
   * 重度推理模型要 10~35 秒，所以不该撞上哪个算哪个）。
   */
  ocrModel: string

  /**
   * 按热键后先弹「功能选择框」（截图 / 剪贴板），而不是直接进遮罩截图。
   *
   * 默认开：多了一个剪贴板入口之后，热键直达截图会让「剪贴板」没有可发现的入口；
   * 习惯直达的用户可以在面板里关掉，回到原行为。
   */
  hotkeyMenu: boolean
  /** 后台记录剪贴板历史（只存本机，按天数自动清理）。 */
  clipboardEnabled: boolean
  /** 剪贴板历史保留天数，取值 1–90，越界在合并补丁时夹取到边界。 */
  clipboardDays: number
}

/** 面板保存用的增量补丁：字段缺省表示保持原值。 */
export type WinSnipSettingsPatch = Partial<WinSnipSettings>

/** 面板与状态接口共用的运行状态视图。 */
export interface WinSnipStatus {
  /** 当前平台是否支持（仅 Windows 支持）。 */
  supported: boolean
  /** 配置里是否启用。 */
  enabled: boolean
  /** 助手进程是否存活。 */
  running: boolean
  /** 助手进程号（存活时存在）。 */
  pid?: number
  /** 实际生效的热键。 */
  hotkey: string
  /** 助手启动时间（ISO 字符串）。 */
  startedAt?: string
  /** 最近一次成功截图时间（ISO 字符串）。 */
  lastCaptureAt?: string
  /** 本次运行累计截图次数。 */
  captures: number
  /** 保存目录（绝对路径）。 */
  saveDir: string
  /** 当前已记录的剪贴板条数（助手未运行或未开启时为 0）。 */
  clipboardItems: number
  /** 最近一次记录到剪贴板内容的时间（ISO 字符串，从未记录时缺省）。 */
  lastClipboardAt?: string
  /** 生效的保留天数（来自配置，供面板显示"保留最近 N 天"）。 */
  clipboardDays: number
  /** 剪贴板历史的存储目录（绝对路径，只在本机）。 */
  clipboardDir: string
  /** 需要用户知道的异常（如热键被占用、脚本缺失、非 Windows 平台）。 */
  message?: string
}

/** 原生助手心跳文件内容（由 PowerShell 写入，宿主只读）。 */
export interface WinSnipHeartbeat {
  /** 助手进程号。 */
  pid: number
  /** 生效的热键文案。 */
  hotkey: string
  /** 启动时间（ISO 字符串）。 */
  startedAt: string
  /** 最近一次截图时间（ISO 字符串，未截图时缺省）。 */
  lastCaptureAt?: string
  /** 累计截图次数。 */
  captures: number
  /** 已记录的剪贴板条数（老版本助手不写该字段）。 */
  clipboardItems?: number
  /** 最近一次记录剪贴板内容的时间（ISO 字符串）。 */
  lastClipboardAt?: string
  /** 助手当前生效的保留天数（用于解释为什么历史条数变少）。 */
  clipboardDays?: number
  /** 最近一次异常（如热键注册失败）。 */
  error?: string
}

/** 原生助手发给宿主的识别/翻译请求。 */
export interface WinSnipVisionRequest {
  /** 请求 id（与文件名一致，宿主原样回写响应）。 */
  id: string
  /** 处理类型：识别文字 或 翻译。 */
  kind: 'ocr' | 'translate'
  /** 被处理图片的绝对路径（必须位于 requests 目录内）。 */
  imagePath: string
  /** 翻译目标语言（kind=translate 时使用）。 */
  targetLang?: WinSnipTranslateTarget
}

/** 宿主回给原生助手的处理结果。 */
export interface WinSnipVisionResponseExtras {
  /** 实际使用的模型名：结果窗要标出来，辉哥问过"用的什么模型"。 */
  model?: string
  /** 模型耗时（毫秒）：同上，慢的时候要一眼看出慢在哪。 */
  elapsedMs?: number
}

/** 宿主回给原生助手的处理结果。 */
export interface WinSnipVisionResponse {
  /** 对应请求 id。 */
  id: string
  /** 是否成功。 */
  ok: boolean
  /** 识别出的原文（kind=ocr 时为结果，kind=translate 时同时给出）。 */
  text?: string
  /** 实际使用的模型名，结果窗标注用。 */
  model?: string
  /** 模型耗时（毫秒），结果窗标注用。 */
  elapsedMs?: number
  /** 译文（kind=translate 时给出）。 */
  translation?: string
  /** 失败原因（中文、已脱敏）。 */
  error?: string
}

/** 热键解析结果：直接对应 Win32 RegisterHotKey 的两个入参。 */
export interface ParsedHotkey {
  /** 修饰键位掩码（MOD_ALT=1、MOD_CONTROL=2、MOD_SHIFT=4、MOD_WIN=8）。 */
  modifiers: number
  /** 虚拟键码。 */
  virtualKey: number
  /** 规范化后的展示文案，如 `Alt+A`。 */
  label: string
}

/** 修饰键位掩码常量（与 Win32 一致）。 */
export const HOTKEY_MODIFIERS = { alt: 0x0001, control: 0x0002, shift: 0x0004, win: 0x0008 } as const

/** 允许作为主键的字符/按键 → 虚拟键码。 */
const VIRTUAL_KEYS: Readonly<Record<string, number>> = {
  ...Object.fromEntries(Array.from({ length: 26 }, (_, index) => [String.fromCharCode(65 + index), 0x41 + index])),
  ...Object.fromEntries(Array.from({ length: 10 }, (_, index) => [String(index), 0x30 + index])),
  ...Object.fromEntries(Array.from({ length: 12 }, (_, index) => ['F' + String(index + 1), 0x70 + index])),
  PrintScreen: 0x2c,
  Space: 0x20,
  Insert: 0x2d,
  Delete: 0x2e,
  Home: 0x24,
  End: 0x23,
  PageUp: 0x21,
  PageDown: 0x22,
}

/** 修饰键别名 → 规范名。 */
const MODIFIER_ALIASES: Readonly<Record<string, keyof typeof HOTKEY_MODIFIERS>> = {
  alt: 'alt',
  ctrl: 'control',
  control: 'control',
  shift: 'shift',
  win: 'win',
  meta: 'win',
}

/** 规范名 → 展示文案。 */
const MODIFIER_LABELS: Readonly<Record<keyof typeof HOTKEY_MODIFIERS, string>> = {
  alt: 'Alt',
  control: 'Ctrl',
  shift: 'Shift',
  win: 'Win',
}

/**
 * 解析并规范化热键文本。
 *
 * 规则：至少一个修饰键 + 恰好一个主键；修饰键顺序统一为 Ctrl → Alt → Shift → Win。
 * 返回 undefined 表示文本不可用（面板应拒绝保存并给出中文提示）。
 *
 * @param value 用户输入的热键文本，例如 `alt+a`、`Ctrl+Shift+S`。
 */
export function parseHotkey(value: unknown): ParsedHotkey | undefined {
  if (typeof value !== 'string') return undefined
  const parts = value.split('+').map((part) => part.trim()).filter((part) => part !== '')
  if (parts.length < 2) return undefined
  const keyPart = parts[parts.length - 1]
  const modifierParts = parts.slice(0, -1)
  const seen = new Set<keyof typeof HOTKEY_MODIFIERS>()
  for (const part of modifierParts) {
    const canonical = MODIFIER_ALIASES[part.toLowerCase()]
    if (canonical === undefined || seen.has(canonical)) return undefined
    seen.add(canonical)
  }
  // 主键允许大小写混写，统一按大写查表；F1..F12 与 PrintScreen 等按规范名查。
  const normalizedKey = keyPart.length === 1 ? keyPart.toUpperCase() : keyPart
  const virtualKey = VIRTUAL_KEYS[normalizedKey]
  if (virtualKey === undefined) return undefined
  let modifiers = 0
  const labels: string[] = []
  for (const canonical of ['control', 'alt', 'shift', 'win'] as const) {
    if (!seen.has(canonical)) continue
    modifiers |= HOTKEY_MODIFIERS[canonical]
    labels.push(MODIFIER_LABELS[canonical])
  }
  labels.push(normalizedKey.length === 1 ? normalizedKey : normalizedKey)
  return { modifiers, virtualKey, label: labels.join('+') }
}

/** 判断运行平台是否受支持（Windows 专用能力）。 */
export function isWinSnipSupported(platform: NodeJS.Platform = process.platform): boolean {
  return platform === 'win32'
}
