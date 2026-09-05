/**
 * 天工造梦面板页签图标（内联 SVG，stroke 跟随 currentColor，
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

export function IconWorkflow({ size }: IconProps): JSX.Element {
  return (
    <svg {...base(size)} aria-hidden="true">
      <path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z" />
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

/** 项目面板：文件夹。 */
export function IconProject({ size }: IconProps): JSX.Element {
  return (
    <svg {...base(size)} aria-hidden="true">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
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

/** 天工造梦标题图标：开口玉璧环（天工/巧夺天工）内嵌四角星（造梦/灵感），与侧边栏入口和品牌 logo 同构。 */
export function IconTiangong({ size }: IconProps): JSX.Element {
  return (
    <svg {...base(size)} aria-hidden="true">
      <path d="M18.2 7.6A7.6 7.6 0 1 1 14 4.7" />
      <path d="M12 7.4c.6 2.4 1.5 3.3 4.6 4.6-3.1 1.3-4 2.2-4.6 4.6-.6-2.4-1.5-3.3-4.6-4.6 3.1-1.3 4-2.2 4.6-4.6z" fill="currentColor" stroke="none" />
    </svg>
  )
}

/** 教程：书页中的问号，表达帮助与上手指南。 */
export function IconGuide({ size }: IconProps): JSX.Element {
  return (
    <svg {...base(size)} aria-hidden="true">
      <path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v18H6.5A2.5 2.5 0 0 0 4 22.5z" />
      <path d="M4 4.5v18" />
      <path d="M10 8.5a2.2 2.2 0 1 1 3.8 1.5c-.8.8-1.8 1-1.8 2.5" />
      <path d="M12 16.5h.01" />
    </svg>
  )
}

/** 插件更新：循环升级箭头。 */
export function IconUpdate({ size }: IconProps): JSX.Element {
  return (
    <svg {...base(size)} aria-hidden="true">
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v6h-6" />
    </svg>
  )
}

/** 皮肤：调色板（半圆 + 三色滴），表达换肤 + 强调色。 */
export function IconSkin({ size }: IconProps): JSX.Element {
  return (
    <svg {...base(size)} aria-hidden="true">
      <path d="M12 3a9 9 0 1 0 0 18c1.1 0 2-.9 2-2v-.5c0-.55.45-1 1-1H16a4 4 0 0 0 4-4 8 8 0 0 0-8-7.5z" />
      <circle cx="7.5" cy="11" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="11" cy="7" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="15.5" cy="9" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="8" cy="15.5" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  )
}

/** MCP 服务器接入：插头（外部工具服务器接入宿主）。 */
export function IconMcp({ size }: IconProps): JSX.Element {
  return (
    <svg {...base(size)} aria-hidden="true">
      <path d="M9 7V3" />
      <path d="M15 7V3" />
      <path d="M6.5 7h11v4a5.5 5.5 0 0 1-11 0z" />
      <path d="M12 16.5V22" />
    </svg>
  )
}
