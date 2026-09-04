/**
 * MCP 服务器接入协议 —— host 与 client 共享的类型与 API 路径常量（纯类型，无 Node 依赖）。
 *
 * 设计：
 * - 服务器配置存 store.db（docs 域 mcp.server），由 Web 面板管理，保存后即时挂载/卸载，
 *   不依赖 cordis.yml 重启；
 * - 实际的 MCP 连接与工具注册复用官方 @deepseek-ai/dsh-mcp-client 桥（每台服务器一个
 *   fiber），工具以 `mcp__<serverName>__<rawName>` 名称注册，模型可直接调用；
 * - env/headers 属密钥型数据：存储明文仅限 host 侧，任何接口返回浏览器只带
 *   「键 + 是否已配置」，保存时空值表示「保留已存值」（对齐 GitHub Token 的脱敏纪律）。
 */

/** MCP 面板路由族（挂在 dsh-devforge 路由前缀下，统一 loopback 围栏）。 */
export const MCP_API = {
  /** 服务器配置清单（GET）与保存（POST）。 */
  servers: '/api/dsh-devforge/mcp/servers',
  /** 连接测试（POST）：支持按已存 id 或内联表单配置。 */
  test: '/api/dsh-devforge/mcp/test',
  /** 运行时状态（GET）：fiber 挂载情况与实际注册到模型的 mcp__ 工具。 */
  status: '/api/dsh-devforge/mcp/status',
  /** 全量重载（POST）：断开全部 fiber 后按当前配置重建。 */
  reload: '/api/dsh-devforge/mcp/reload',
} as const

/** 传输类型：stdio 本地子进程 / Streamable HTTP 远端服务。 */
export type McpTransport = 'stdio' | 'streamable-http'

/** serverName 约束（与官方 mcp-client 一致，同时是模型可见工具名的命名空间）。 */
export const MCP_SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/

/** 密钥型键值对返回浏览器的形态：只含键与是否已配置，值绝不外发。 */
export interface McpSecretEntry {
  /** 键名（如 GITHUB_TOKEN / Authorization）。 */
  key: string
  /** 是否已配置了值。 */
  configured: boolean
}

/** 保存/测试请求里的密钥型键值对：value 空串或缺省表示「保留该键已存值」。 */
export interface McpSecretInput {
  /** 键名；空键名在保存时被丢弃。 */
  key: string
  /** 新值；空串 = 保留已存值（删除键请整行移除）。 */
  value?: string
}

/** MCP 服务器配置（存储态；env/headers 明文仅限 host 侧持有）。 */
export interface McpServerRecord {
  /** 稳定 id（crypto.randomUUID）。 */
  id: string
  /** 显示名。 */
  name: string
  /** 工具命名空间（mcp__<serverName>__<tool>），全库唯一。 */
  serverName: string
  /** 传输类型。 */
  transport: McpTransport
  /** 启用开关：关闭即卸载其全部工具。 */
  enabled: boolean
  /** stdio：可执行文件（如 npx / uvx）。 */
  command: string
  /** stdio：参数（原样传递，不做 shell 插值）。 */
  args: string[]
  /** stdio：工作目录（空串 = 继承宿主进程）。 */
  cwd: string
  /** stdio：额外环境变量（合并到脱敏后的宿主环境之上）。 */
  env: Record<string, string>
  /** http：MCP 端点 URL。 */
  url: string
  /** http：附加请求头（如 Authorization）。 */
  headers: Record<string, string>
  /** 单次工具调用超时（毫秒），与官方桥语义一致。 */
  toolCallTimeoutMs: number
  createdAt: number
  updatedAt: number
  /** 最近一次连接测试结果（host 端维护，保存时清空）。 */
  lastTest?: { ok: boolean; at: number; toolCount?: number; error?: string }
}

/** 返回给浏览器的服务器摘要（env/headers 值已脱敏）。 */
export interface McpServerSummary {
  id: string
  name: string
  serverName: string
  transport: McpTransport
  enabled: boolean
  command: string
  args: string[]
  cwd: string
  url: string
  toolCallTimeoutMs: number
  createdAt: number
  updatedAt: number
  /** 环境变量键清单（只含键与是否已配置）。 */
  envEntries: McpSecretEntry[]
  /** 请求头键清单（只含键与是否已配置）。 */
  headerEntries: McpSecretEntry[]
  /** 最近一次连接测试结果。 */
  lastTest?: { ok: boolean; at: number; toolCount?: number; error?: string }
}

/** 保存请求（id 缺省 = 新增）。 */
export interface McpServerSaveRequest {
  id?: string
  name?: string
  serverName?: string
  transport?: McpTransport
  enabled?: boolean
  command?: string
  args?: string[]
  cwd?: string
  url?: string
  toolCallTimeoutMs?: number
  /** 环境变量键值对；value 空串 = 保留已存值。 */
  env?: McpSecretInput[]
  /** 请求头键值对；value 空串 = 保留已存值。 */
  headers?: McpSecretInput[]
}

/** 连接测试的单个工具发现结果。 */
export interface McpTestTool {
  /** 服务器上的原始工具名。 */
  name: string
  /** 工具描述。 */
  description: string
  /** 注册到模型后的公开名（mcp__<serverName>__<rawName>，展示用）。 */
  publicName: string
}

/** 连接测试结果。 */
export interface McpTestResult {
  ok: boolean
  /** 服务器自报的名称与版本（远端数据，仅展示不可信）。 */
  serverInfo?: string
  /** 发现的工具清单。 */
  tools?: McpTestTool[]
  /** 失败原因（人类可读）。 */
  error?: string
  /** 测试耗时（毫秒）。 */
  ms: number
}

/** 运行时状态里单台服务器的视图。 */
export interface McpServerRuntimeStatus {
  id: string
  serverName: string
  /** fiber 是否已挂载（启用且连接桥已加载）。 */
  mounted: boolean
  /** fiber 生命周期状态（便于诊断，如 pending/error）。 */
  state?: string
  /** 实际注册到模型的全局工具（从工具注册表实时读取）。 */
  tools: Array<{ name: string; description: string }>
}

/** 运行时状态（MCP 页签状态卡数据源）。 */
export interface McpRuntimeStatus {
  /** 能力总开关是否开启。 */
  enabled: boolean
  /** 已挂载 fiber 数。 */
  mountedCount: number
  /** 实际注册到模型的 mcp__ 工具总数。 */
  toolCount: number
  servers: McpServerRuntimeStatus[]
}
