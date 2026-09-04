/**
 * MCP 服务器配置存储 —— store.db docs 域 mcp.server 的 CRUD、校验与映射。
 *
 * 职责边界：
 * - 本文件只管「配置怎么存、怎么校验、怎么映射成官方桥的 Config」；
 * - 连接生命周期（挂载/卸载/重连）在 service.ts，由官方 @deepseek-ai/dsh-mcp-client 承担；
 * - 密钥纪律：env/headers 明文只在 host 侧流转，summarize 输出一律脱敏；
 *   保存时空串值 = 保留已存值（mergeSecretInputs），与 GitHub Token 保存语义一致。
 */

import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { listDocs, replaceDocs } from '../store/db.ts'
import {
  MCP_SERVER_NAME_PATTERN,
  type McpSecretInput,
  type McpServerRecord,
  type McpServerSaveRequest,
  type McpServerSummary,
  type McpTransport,
} from './protocol.ts'

/** docs 存储域（与 memory.entry、rag.* 等域并列，互不干扰）。 */
export const MCP_DOCS_DOMAIN = 'mcp.server'

/** 工具调用超时允许范围（毫秒）：下限防抖动误伤，上限对齐面板数字输入上限。 */
export const MCP_TIMEOUT_MIN = 5000
export const MCP_TIMEOUT_MAX = 600000
/** 工具调用超时默认值（与官方桥默认一致）。 */
export const MCP_TIMEOUT_DEFAULT = 60000

/** 读取全部服务器配置（按库内稳定顺序）。 */
export function listMcpServers(db: DatabaseSync): McpServerRecord[] {
  return listDocs(db, MCP_DOCS_DOMAIN).map((doc) => JSON.parse(doc.data) as McpServerRecord)
}

/** 删除一台服务器配置；返回是否确实删除了。 */
export function deleteMcpServer(db: DatabaseSync, id: string): boolean {
  const servers = listMcpServers(db)
  const kept = servers.filter((server) => server.id !== id)
  if (kept.length === servers.length) return false
  replaceDocs(db, MCP_DOCS_DOMAIN, kept.map((server) => ({ id: server.id, data: server })))
  return true
}

/** 更新某台服务器的最近测试结果（不影响其余字段；服务器不存在时静默忽略）。 */
export function recordMcpTestResult(
  db: DatabaseSync,
  id: string,
  result: { ok: boolean; toolCount?: number; error?: string },
): void {
  const servers = listMcpServers(db)
  const target = servers.find((server) => server.id === id)
  if (target === undefined) return
  target.lastTest = { ok: result.ok, at: Date.now(), ...(result.toolCount !== undefined ? { toolCount: result.toolCount } : {}), ...(result.error !== undefined ? { error: result.error } : {}) }
  replaceDocs(db, MCP_DOCS_DOMAIN, servers.map((server) => ({ id: server.id, data: server })))
}

/**
 * 合并密钥型键值对：空串/缺省 value = 保留已存值。
 * 边界约定：env/headers 的值不存在「合法的空值」，要清空请删除整行（键）。
 */
export function mergeSecretInputs(existing: Record<string, string>, inputs: McpSecretInput[] | undefined): Record<string, string> {
  const merged: Record<string, string> = { ...existing }
  for (const input of inputs ?? []) {
    const key = typeof input.key === 'string' ? input.key.trim() : ''
    if (key === '') continue
    const value = typeof input.value === 'string' ? input.value : ''
    if (value === '') continue // 空值 = 保留原值；新键配空值则等于没配，直接跳过
    merged[key] = value
  }
  return merged
}

/** 校验可读性错误（消息直接面向面板用户）。 */
export class McpConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'McpConfigError'
  }
}

/** 规整字符串字段：非字符串一律按空串处理，前后空白裁剪。 */
function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * 保存（新增或更新）一台服务器配置；通过校验返回存储记录。
 * 校验项：serverName 格式与唯一性、transport 字段齐备、超时范围、键名非空唯一。
 */
export function saveMcpServer(db: DatabaseSync, input: McpServerSaveRequest): McpServerRecord {
  const servers = listMcpServers(db)
  const existing = input.id !== undefined ? servers.find((server) => server.id === input.id) : undefined
  if (input.id !== undefined && existing === undefined) throw new McpConfigError('要编辑的 MCP 服务器不存在（可能已被删除），请刷新后重试。')

  // --- serverName：工具命名空间，格式与唯一性双卡 ---
  const serverName = text(input.serverName ?? existing?.serverName)
  if (!MCP_SERVER_NAME_PATTERN.test(serverName)) {
    throw new McpConfigError('命名空间 serverName 只允许字母/数字/下划线/中划线，长度 1-32（它决定工具名 mcp__<serverName>__<tool>）。')
  }
  const duplicate = servers.find((server) => server.serverName === serverName && server.id !== existing?.id)
  if (duplicate !== undefined) throw new McpConfigError(`命名空间 serverName「${serverName}」已被「${duplicate.name}」占用，请换一个。`)

  // --- transport：字段按类型齐备性校验 ---
  const transport: McpTransport = input.transport ?? existing?.transport ?? 'stdio'
  if (transport !== 'stdio' && transport !== 'streamable-http') throw new McpConfigError('传输类型只支持 stdio 或 streamable-http。')

  const command = text(input.command ?? existing?.command)
  const url = text(input.url ?? existing?.url)
  if (transport === 'stdio' && command === '') throw new McpConfigError('stdio 传输必须填写启动命令（如 npx、uvx 或本机可执行文件路径）。')
  if (transport === 'streamable-http') {
    if (url === '') throw new McpConfigError('Streamable HTTP 传输必须填写 MCP 端点 URL。')
    let parsed: URL
    try { parsed = new URL(url) } catch { throw new McpConfigError('MCP 端点 URL 不是合法的绝对地址（需含协议，如 http://127.0.0.1:3000/mcp）。') }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new McpConfigError('MCP 端点 URL 只支持 http/https 协议。')
  }

  // --- args：字符串数组（UI 按行拆分传入） ---
  const args = (input.args ?? existing?.args ?? []).map((arg) => String(arg))

  // --- toolCallTimeoutMs：范围钳制 ---
  const rawTimeout = input.toolCallTimeoutMs ?? existing?.toolCallTimeoutMs ?? MCP_TIMEOUT_DEFAULT
  const toolCallTimeoutMs = Math.min(Math.max(Math.round(Number(rawTimeout) || MCP_TIMEOUT_DEFAULT), MCP_TIMEOUT_MIN), MCP_TIMEOUT_MAX)

  // --- env/headers：脱敏合并（空值保留旧值） ---
  const env = mergeSecretInputs(existing?.env ?? {}, input.env)
  const headers = mergeSecretInputs(existing?.headers ?? {}, input.headers)

  const name = text(input.name ?? existing?.name) || serverName
  const enabled = input.enabled ?? existing?.enabled ?? true
  const now = Date.now()
  const record: McpServerRecord = {
    id: existing?.id ?? randomUUID(),
    name,
    serverName,
    transport,
    enabled,
    command: transport === 'stdio' ? command : '',
    args: transport === 'stdio' ? args : [],
    cwd: transport === 'stdio' ? text(input.cwd ?? existing?.cwd) : '',
    env: transport === 'stdio' ? env : {},
    url: transport === 'streamable-http' ? url : '',
    headers: transport === 'streamable-http' ? headers : {},
    toolCallTimeoutMs,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
  const next = existing === undefined ? [...servers, record] : servers.map((server) => (server.id === record.id ? record : server))
  replaceDocs(db, MCP_DOCS_DOMAIN, next.map((server) => ({ id: server.id, data: server })))
  return record
}

/** 存储记录 → 面板摘要（env/headers 值脱敏，只回键与是否已配置）。 */
export function summarizeServer(record: McpServerRecord): McpServerSummary {
  const entries = (values: Record<string, string>) => Object.keys(values).sort().map((key) => ({ key, configured: values[key] !== '' }))
  return {
    id: record.id,
    name: record.name,
    serverName: record.serverName,
    transport: record.transport,
    enabled: record.enabled,
    command: record.command,
    args: record.args,
    cwd: record.cwd,
    url: record.url,
    toolCallTimeoutMs: record.toolCallTimeoutMs,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    envEntries: entries(record.env),
    headerEntries: entries(record.headers),
    ...(record.lastTest !== undefined ? { lastTest: record.lastTest } : {}),
  }
}

/**
 * 存储记录 → 官方 @deepseek-ai/dsh-mcp-client 的 Config。
 * 键序固定，保证 fingerprint 稳定；failOnStartupError 恒为 false：
 * 单台服务器连不上不能拖垮宿主启动（官方桥会自行重连并在日志中留痕）。
 */
export function toMcpClientConfig(record: McpServerRecord): Record<string, unknown> {
  const common = {
    serverName: record.serverName,
    toolCallTimeoutMs: record.toolCallTimeoutMs,
    failOnStartupError: false,
  }
  if (record.transport === 'stdio') {
    return { transport: 'stdio', ...common, command: record.command, args: record.args, env: record.env, cwd: record.cwd }
  }
  return { transport: 'streamable-http', ...common, url: record.url, headers: record.headers }
}

/**
 * 配置指纹：决定 reconcile 时是否需要重建 fiber。
 * 不含 enabled（启停由 service 层按 desired 集合处理）与时间戳/测试结果（不属于连接语义）。
 */
export function fingerprintOf(record: McpServerRecord): string {
  return JSON.stringify(toMcpClientConfig(record))
}
