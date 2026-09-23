/**
 * 数据管理面板协议 —— 库表浏览与敏感配置查看的 API 常量与类型。
 *
 * 设计边界（辉哥 2026-09-23 定稿）：
 * - 数据透明化：库表结构与数据行全量可看；
 * - 密钥保护：凭据/密钥类值默认掩码展示（只露尾 4 位），「复制」按钮经 reveal
 *   端点取明文直达剪贴板，明文永不出现在页面 DOM 中（防旁观、防录屏）；
 * - 本文件类型同时被 Host 路由与浏览器面板引用，只放纯类型与常量，禁止引 node 模块。
 */

/** 数据管理 API 路径族（loopback-only，见 dbadmin-routes.ts）。 */
export const DB_ADMIN_API = {
  /** GET：表清单 + 行数 + 列结构 + 域统计。 */
  tables: '/api/dsh-devforge/dbadmin/tables',
  /** GET：表数据分页（table/page/pageSize/search/full）。 */
  rows: '/api/dsh-devforge/dbadmin/rows',
  /** GET：凭据镜像 ref 清单（值只回掩码）。 */
  credentialRefs: '/api/dsh-devforge/dbadmin/credential-refs',
  /** POST：按 ref 取明文（复制按钮专用，走审计日志）。 */
  credentialReveal: '/api/dsh-devforge/dbadmin/credential-reveal',
  /** GET：库外配置文件清单（白名单三项）。 */
  configFiles: '/api/dsh-devforge/dbadmin/config-files',
  /** POST：按 name 取配置明文（复制按钮专用，走审计日志）。 */
  configReveal: '/api/dsh-devforge/dbadmin/config-reveal',
} as const

/** 库外配置白名单名称。 */
export type DbAdminConfigName = 'feishu' | 'backup-secret' | 'credentials-yaml'

/** 表概要（清单视图）。 */
export interface DbAdminTableSummary {
  /** 表名。 */
  name: string
  /** 建表 SQL（sqlite_master 原文）。 */
  ddl: string
  /** 近似行数。 */
  rowCount: number
}

/** 域统计（docs/settings 通用文档模式的域清单）。 */
export interface DbAdminDomainSummary {
  /** 域名。 */
  domain: string
  /** 该域文档行数。 */
  count: number
}

/** 表清单响应。 */
export interface DbAdminTablesResult {
  tables: DbAdminTableSummary[]
  /** docs 域清单（按行数降序）。 */
  docsDomains: DbAdminDomainSummary[]
  /** settings 域清单（按行数降序）。 */
  settingsDomains: DbAdminDomainSummary[]
  /** credential 镜像 ref 总数。 */
  credentialCount: number
}

/** 列结构。 */
export interface DbAdminColumn {
  name: string
  type: string
}

/** 表数据分页响应。 */
export interface DbAdminRowsResult {
  table: string
  columns: DbAdminColumn[]
  /** 数据行（键为列名；超长单元格已按 full 参数截断）。 */
  rows: Array<Record<string, unknown>>
  /** 过滤后总行数（分页用）。 */
  total: number
  page: number
  pageSize: number
  /** 本次是否有单元格被截断。 */
  truncated: boolean
}

/** 凭据 ref 清单项（值只回掩码）。 */
export interface DbAdminCredentialRefItem {
  ref: string
  /** 掩码值（•••• + 尾 4 位；长度不足 8 全掩码）。 */
  masked: string
  updatedAt: number
}

/** 凭据清单响应。 */
export interface DbAdminCredentialRefsResult {
  refs: DbAdminCredentialRefItem[]
}

/** 明文响应（reveal 端点；浏览器只进剪贴板不进 DOM）。 */
export interface DbAdminRevealResult {
  ok: boolean
  /** ref 或配置名。 */
  target: string
  /** 明文值。 */
  value: string
}

/** 库外配置文件概要。 */
export interface DbAdminConfigFileItem {
  name: DbAdminConfigName
  /** 展示名。 */
  label: string
  exists: boolean
  /** 顶层键清单（feishu JSON 有；yaml/secret 文件为空）。 */
  keys: string[]
  /** 掩码后的敏感值预览（backup-secret 的密码掩码；yaml 无）。 */
  maskedPreview?: string
}

/** 配置清单响应。 */
export interface DbAdminConfigFilesResult {
  files: DbAdminConfigFileItem[]
}
