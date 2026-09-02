/**
 * 天工造梦强调色 —— 纯函数层（无 DOM、无 node 依赖）。
 *
 * 输入一个用户自选色（#rrggbb / #rgb），派生 Token 叠加层需要的
 * { light, dark } 值对，按 DSH Web GUI 现有 token 体系覆盖品牌与交互
 * 通道，但不触背景/文字层（背景与文字仍跟随选中皮肤）。
 *
 * 设计原则：
 *   - brand-text 自动按主色亮度切换（亮底色配深字，深底色配浅字），
 *     保证按钮文字与品牌色对比度合规；
 *   - hover 在浅色系压暗、在深色系提亮，符合系统级交互反馈习惯；
 *   - dimmed/tertiary 不写死十六值，而用 rgba 主色 + 低不透明度，
 *     在叠加深浅皮肤时仍能透出底层质感，避免色块过于实心；
 *   - 全部输出值经过 normalize 与闭区间钳制，可放心交给浏览器解析。
 */

import type { ThemeTokenOverrides } from '@deepseek-ai/dsh-client-ui-theme/client'
import type { DevforgeKey } from '../locales.ts'

/** 把 #rgb / #rrggbb 规整成 #rrggbb；非法返回 null。 */
export function normalizeHex(input: string): string | null {
  const v = input.trim()
  const short = /^#([0-9a-f]{3})$/i.exec(v)
  if (short !== null) {
    const c = short[1]!
    return '#' + c[0]! + c[0]! + c[1]! + c[1]! + c[2]! + c[2]!
  }
  const full = /^#([0-9a-f]{6})$/i.exec(v)
  if (full !== null) return '#' + full[1]!.toLowerCase()
  return null
}

/** 把 #rrggbb 解码成 [r,g,b]，非法返回 null。 */
export function hexToRgb(hex: string): [number, number, number] | null {
  const v = normalizeHex(hex)
  if (v === null) return null
  return [
    parseInt(v.slice(1, 3), 16),
    parseInt(v.slice(3, 5), 16),
    parseInt(v.slice(5, 7), 16),
  ]
}

/** 把 [r,g,b] 编回 #rrggbb。 */
export function rgbToHex(r: number, g: number, b: number): string {
  const c = (n: number): string => Math.round(n).toString(16).padStart(2, '0')
  return '#' + c(r) + c(g) + c(b)
}

/**
 * 把两个 hex 按 sRGB 通道线性混合（不做 gamma 校正，视觉足够稳）。
 * @param a 主色
 * @param b 混入色
 * @param ratio b 的权重 0..1
 */
export function mixHex(a: string, b: string, ratio: number): string {
  const ar = hexToRgb(a)
  const br = hexToRgb(b)
  if (ar === null || br === null) return a
  const t = Math.max(0, Math.min(1, ratio))
  return rgbToHex(ar[0] * (1 - t) + br[0] * t, ar[1] * (1 - t) + br[1] * t, ar[2] * (1 - t) + br[2] * t)
}

/** 调整亮度：amount 在 -1..1 之间，>0 提亮、<0 压暗。 */
export function adjustHex(hex: string, amount: number): string {
  const rgb = hexToRgb(hex)
  if (rgb === null) return hex
  const t = Math.max(-1, Math.min(1, amount))
  if (t >= 0) return mixHex(hex, '#ffffff', t)
  return mixHex(hex, '#000000', -t)
}

/** 输出 rgba() 字符串。 */
export function rgbaStr(hex: string, alpha: number): string {
  const rgb = hexToRgb(hex)
  if (rgb === null) return hex
  const a = Math.max(0, Math.min(1, alpha))
  return 'rgba(' + rgb[0] + ', ' + rgb[1] + ', ' + rgb[2] + ', ' + a + ')'
}

/** WCAG 相对亮度估算（近似 sRGB）。 */
export function relativeLuminance(hex: string): number {
  const rgb = hexToRgb(hex)
  if (rgb === null) return 0
  const ch = (n: number): number => {
    const v = n / 255
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * ch(rgb[0]) + 0.7152 * ch(rgb[1]) + 0.0722 * ch(rgb[2])
}

/**
 * 选择与品牌色对比度合适的按钮文字色。
 * 亮度阈值 0.55：高于阈值用深字、低于阈值用浅字，保证 AAA 字号小的情况下也合规。
 */
export function pickTextOn(hex: string): string {
  return relativeLuminance(hex) >= 0.55 ? '#0b0e14' : '#ffffff'
}

/** 输入强调色，返回 ctxThemeOverrideTokens 兼容的叠加层定义。 */
export function deriveAccentOverrides(accentHex: string): ThemeTokenOverrides {
  const accent = normalizeHex(accentHex)
  if (accent === null) return {}
  // 浅色系：hover 略压暗、dimmed 用主色 + 12% 透明。
  const light = {
    '--dsw-alias-brand-primary': accent,
    '--dsw-alias-brand-text': pickTextOn(accent),
    '--dsw-alias-button-primary-hover': adjustHex(accent, -0.12),
    '--dsw-alias-button-primary-dimmed': rgbaStr(accent, 0.12),
    '--dsw-alias-state-business-primary': accent,
    '--dsw-alias-state-business-tertiary': rgbaStr(accent, 0.12),
    '--dsw-alias-interactive-bg-hover': rgbaStr(accent, 0.08),
    '--dsw-alias-interactive-bg-active': rgbaStr(accent, 0.14),
  }
  // 深色系：hover 略提亮、dimmed 改用主色 + 16% 透明（深底上更明显）。
  const dark = {
    '--dsw-alias-brand-primary': accent,
    '--dsw-alias-brand-text': pickTextOn(accent),
    '--dsw-alias-button-primary-hover': adjustHex(accent, 0.16),
    '--dsw-alias-button-primary-dimmed': rgbaStr(accent, 0.16),
    '--dsw-alias-state-business-primary': accent,
    '--dsw-alias-state-business-tertiary': rgbaStr(accent, 0.16),
    '--dsw-alias-interactive-bg-hover': rgbaStr(accent, 0.12),
    '--dsw-alias-interactive-bg-active': rgbaStr(accent, 0.2),
  }
  const out: ThemeTokenOverrides = {}
  for (const key of Object.keys(light) as (keyof typeof light)[]) {
    const lv = light[key]
    const dv = dark[key]
    if (lv !== undefined && dv !== undefined) {
      out[key] = { light: lv, dark: dv }
    }
  }
  return out
}

/** 强调色预设 —— 8 色圆点，配 locale key。 */
export interface AccentPreset {
  /** locale key（命中 zhDict/en，单测断言） */
  labelKey: DevforgeKey
  /** 颜色（#rrggbb） */
  hex: string
}

export const ACCENT_PRESETS: readonly AccentPreset[] = [
  { labelKey: 'accent.blue', hex: '#2f6fed' },
  { labelKey: 'accent.purple', hex: '#7c3aed' },
  { labelKey: 'accent.pink', hex: '#db2777' },
  { labelKey: 'accent.red', hex: '#dc2626' },
  { labelKey: 'accent.orange', hex: '#ea580c' },
  { labelKey: 'accent.green', hex: '#16a34a' },
  { labelKey: 'accent.cyan', hex: '#0891b2' },
  { labelKey: 'accent.gold', hex: '#d97706' },
]
