/**
 * 服务工厂面板页签图标（内联 SVG，stroke 跟随 currentColor，
 * 自动适配 DSH 浅色/深色主题；统一 14px 视觉尺寸）。
 */
import type { JSX } from 'react'

interface IconProps {
  size?: number
}

function base(size: number | undefined): { width: number; height: number; viewBox: string; fill: string; stroke: string; strokeWidth: number; strokeLinecap: 'round'; strokeLinejoin: 'round' } {
  const s = size ?? 14
  return { width: s, height: s, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }
}

/** 开发规范：文档/书页。 */
export function IconStandards({ size }: IconProps): JSX.Element {
  return (
    <svg {...base(size)} aria-hidden="true">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </svg>
  )
}

/** 浏览器：地球。 */
export function IconBrowser({ size }: IconProps): JSX.Element {
  return (
    <svg {...base(size)} aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <path d="M2 12h20" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  )
}

/** Coding Plan：柱状图。 */
export function IconChart({ size }: IconProps): JSX.Element {
  return (
    <svg {...base(size)} aria-hidden="true">
      <path d="M18 20V10" />
      <path d="M12 20V4" />
      <path d="M6 20v-6" />
    </svg>
  )
}

/** 远程运维：服务器机架。 */
export function IconServer({ size }: IconProps): JSX.Element {
  return (
    <svg {...base(size)} aria-hidden="true">
      <rect x="2" y="2" width="20" height="8" rx="2" />
      <rect x="2" y="14" width="20" height="8" rx="2" />
      <path d="M6 6h.01M6 18h.01" />
    </svg>
  )
}

/** 代码仓库：Git 分支。 */
export function IconRepo({ size }: IconProps): JSX.Element {
  return (
    <svg {...base(size)} aria-hidden="true">
      <circle cx="6" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="6" r="3" />
      <path d="M18 9a9 9 0 0 1-9 9" />
      <path d="M6 9v6" />
    </svg>
  )
}

/** 飞书：纸飞机。 */
export function IconFeishu({ size }: IconProps): JSX.Element {
  return (
    <svg {...base(size)} aria-hidden="true">
      <path d="M22 2 11 13" />
      <path d="M22 2 15 22l-4-9-9-4 20-7z" />
    </svg>
  )
}

/** 服务工厂标题图标：工厂/齿轮（面板头使用）。 */
export function IconFactory({ size }: IconProps): JSX.Element {
  return (
    <svg {...base(size)} aria-hidden="true">
      <path d="M2 20h20" />
      <path d="M4 20V8l6 4V8l6 4V6l4 2v12" />
    </svg>
  )
}
