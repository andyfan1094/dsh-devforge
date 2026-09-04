/**
 * MCP 服务器接入服务 —— fiber 生命周期管理与一次性连接测试。
 *
 * 职责边界：
 * - 连接/工具注册的实际工作全部由官方 @deepseek-ai/dsh-mcp-client 承担：本服务只负责
 *   「把 N 台已启用服务器映射成 N 个官方桥 fiber，并在配置变化时对齐」（reconcile 幂等）；
 * - fiber 挂在 devforge 自身 ctx 之下：devforge 停止/升级时 cordis 自动回收全部子 fiber，
 *   无需本服务额外兜底；
 * - 连接测试（test）不复用 fiber：一次性 SDK 连接，initialize + tools/list 后立即关闭，
 *   供面板在保存前验证配置；
 * - 状态读取（status）从工具注册表实时取 `mcp__` 前缀工具，所见即模型所得。
 */

import type { Context, Fiber } from '@deepseek-ai/cordis'
import * as mcpClientModule from '@deepseek-ai/dsh-mcp-client'
import { scrubbedParentEnv } from '@deepseek-ai/dsh-subprocess'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { getDb } from '../store/db.ts'
import {
  fingerprintOf,
  listMcpServers,
  mergeSecretInputs,
  recordMcpTestResult,
  toMcpClientConfig,
} from './store.ts'
import {
  type McpRuntimeStatus,
  type McpServerRecord,
  type McpServerSaveRequest,
  type McpTestResult,
  type McpTestTool,
} from './protocol.ts'

/**
 * 显式组装官方桥插件对象（命名空间插件：apply + name + inject + Config 四要素）。
 * 不直接传模块命名空间对象，避免 ESM 额外导出进入插件注册表。
 */
const mcpClientPlugin = {
  name: mcpClientModule.name,
  inject: mcpClientModule.inject,
  Config: mcpClientModule.Config,
  apply: mcpClientModule.apply,
}

/** 一个已挂载的官方桥 fiber 及其配置指纹（指纹变化即重建）。 */
interface McpFiberEntry {
  fiber: Fiber
  fingerprint: string
}

/** 带超时的 Promise 竞速；超时抛出可读错误（调用方负责 finally 释放资源）。 */
async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(label + '超时（' + Math.round(timeoutMs / 1000) + ' 秒）')), timeoutMs)
        timer.unref?.()
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/** 单项服务（devforge）下的 MCP 接入服务。 */
export class McpService {
  /** 已挂载的官方桥 fiber（serverId → entry）。 */
  private readonly fibers = new Map<string, McpFiberEntry>()
  /** devforge 宿主 ctx：fiber 的父作用域与日志来源。 */
  private readonly ctx: Context
  /** 能力总开关（动态求值：设置热更新即时生效）。 */
  private readonly isEnabled: () => boolean

  constructor(ctx: Context, isEnabled: () => boolean) {
    this.ctx = ctx
    this.isEnabled = isEnabled
  }

  /**
   * 对齐 fiber 集与当前配置（幂等，可反复调用）：
   * 已删除/已禁用/配置变化的 fiber 卸载重建，其余保持不动（不打断在用连接）。
   * 挂载失败只记日志，不抛出——单台服务器的问题不能影响面板其余能力。
   */
  reconcile(): void {
    let servers: McpServerRecord[] = []
    try {
      servers = listMcpServers(getDb())
    } catch (error) {
      this.log('warn', '读取 MCP 服务器配置失败（按空清单处理）：%s', error instanceof Error ? error.message : String(error))
    }
    const desired = new Map<string, McpServerRecord>()
    if (this.isEnabled()) {
      for (const server of servers) {
        if (server.enabled) desired.set(server.id, server)
      }
    }

    // 先卸载：已删除、已禁用或配置指纹变化的 fiber。
    for (const [id, entry] of this.fibers) {
      const server = desired.get(id)
      if (server === undefined || fingerprintOf(server) !== entry.fingerprint) {
        this.fibers.delete(id)
        void entry.fiber.dispose().catch((error: unknown) => {
          this.log('warn', '卸载 MCP fiber 失败（%s）：%s', id, error instanceof Error ? error.message : String(error))
        })
      }
    }

    // 再挂载：新增或配置变化（旧 fiber 已在上面卸掉）的服务器。
    for (const [id, server] of desired) {
      if (this.fibers.has(id)) continue
      try {
        const fiber = this.ctx.plugin(mcpClientPlugin, toMcpClientConfig(server) as never)
        this.fibers.set(id, { fiber, fingerprint: fingerprintOf(server) })
        this.log('info', 'MCP 服务器「%s」已挂载（%s：%s），工具将以 mcp__%s__<tool> 注册', server.name, server.transport, server.transport === 'stdio' ? server.command : server.url, server.serverName)
      } catch (error) {
        this.log('warn', '挂载 MCP 服务器「%s」失败：%s', server.name, error instanceof Error ? error.message : String(error))
      }
    }
  }

  /** 全量重载：断开全部 fiber 后按当前配置重建（面板「重载全部」按钮）。 */
  reloadAll(): void {
    for (const [id, entry] of this.fibers) {
      this.fibers.delete(id)
      void entry.fiber.dispose().catch((error: unknown) => {
        this.log('warn', '重载卸载 MCP fiber 失败（%s）：%s', id, error instanceof Error ? error.message : String(error))
      })
    }
    this.reconcile()
  }

  /** 能力句柄：sync() 热更新每次调用。关闭时卸全部；开启时对齐（reconcile 幂等，不重建在用连接）。 */
  activateHandle(): { dispose(): void } {
    if (!this.isEnabled()) {
      this.disposeAll()
      return { dispose: () => {} }
    }
    this.reconcile()
    // 热更新 dispose 故意不卸 fiber：配置数据源在 store.db，不随 devforge 配置快照变化；
    // 真正的回收由 cordis 在 devforge 停止时对子 fiber 兜底。
    return { dispose: () => {} }
  }

  /**
   * 运行时状态：fiber 挂载情况 + 工具注册表里实际可见的 mcp__ 工具。
   * 工具清单实时读注册表（全局视图），与模型实际可见集合一致。
   */
  status(): McpRuntimeStatus {
    const enabled = this.isEnabled()
    const byServer = new Map<string, Array<{ name: string; description: string }>>()
    let toolCount = 0
    try {
      const schemas = this.ctx.tools.schemas().filter((schema) => schema.name.startsWith('mcp__'))
      toolCount = schemas.length
      for (const schema of schemas) {
        // 公开名形如 mcp__<serverName>__<rawName>；按命名空间前缀分组（命中过规范化加哈希的极端
        // 情况归入最近的下划线前，仅影响分组展示，不影响功能）。
        const rest = schema.name.slice('mcp__'.length)
        const separator = rest.indexOf('__')
        const serverName = separator > 0 ? rest.slice(0, separator) : rest
        const bucket = byServer.get(serverName) ?? []
        bucket.push({ name: schema.name, description: schema.description })
        byServer.set(serverName, bucket)
      }
    } catch (error) {
      this.log('warn', '读取工具注册表失败（状态将缺少工具清单）：%s', error instanceof Error ? error.message : String(error))
    }

    const servers: McpRuntimeStatus['servers'] = []
    try {
      for (const server of listMcpServers(getDb())) {
        const entry = this.fibers.get(server.id)
        servers.push({
          id: server.id,
          serverName: server.serverName,
          mounted: entry !== undefined,
          ...(entry !== undefined ? { state: String(entry.fiber.state) } : {}),
          tools: byServer.get(server.serverName) ?? [],
        })
      }
    } catch { /* 配置库读失败时返回空清单，status 不抛 */ }
    return { enabled, mountedCount: this.fibers.size, toolCount, servers }
  }

  /**
   * 连接测试：一次性连接目标服务器，initialize + tools/list 后立即关闭。
   * 输入二选一：`id` 用已存配置（含已存密钥）；`server` 用面板内联表单
   * （密钥空值回填已存同键值，见 store.mergeSecretInputs）。
   * 按服务器 id 测试成功/失败都会写回 lastTest 供清单展示。
   */
  async test(input: { id?: string; server?: McpServerSaveRequest }): Promise<McpTestResult> {
    const started = Date.now()
    const fail = (error: string): McpTestResult => ({ ok: false, error, ms: Date.now() - started })

    // --- 解析生效配置 ---
    let effective: McpServerRecord | undefined
    try {
      const servers = listMcpServers(getDb())
      if (input.id !== undefined && input.id !== '') {
        effective = servers.find((server) => server.id === input.id)
        if (effective === undefined) return fail('要测试的 MCP 服务器不存在，请刷新后重试。')
      } else if (input.server !== undefined) {
        // 内联表单：基于现值合成一条「不落库」的临时记录；密钥空值回填已存值。
        const existing = input.server.id !== undefined ? servers.find((server) => server.id === input.server?.id) : undefined
        const draft = {
          ...(existing ?? { id: 'draft', name: '', serverName: '', transport: 'stdio' as const, enabled: true, command: '', args: [] as string[], cwd: '', env: {} as Record<string, string>, url: '', headers: {} as Record<string, string>, toolCallTimeoutMs: 60000, createdAt: 0, updatedAt: 0 }),
        } as McpServerRecord
        const form = input.server
        effective = {
          ...draft,
          serverName: typeof form.serverName === 'string' && form.serverName.trim() !== '' ? form.serverName.trim() : draft.serverName,
          transport: form.transport ?? draft.transport,
          command: typeof form.command === 'string' ? form.command.trim() : draft.command,
          args: Array.isArray(form.args) ? form.args.map(String) : draft.args,
          cwd: typeof form.cwd === 'string' ? form.cwd.trim() : draft.cwd,
          url: typeof form.url === 'string' ? form.url.trim() : draft.url,
        }
        // 密钥合并必须走 store 的同一套语义，保证测试与保存行为一致。
        effective.env = effective.transport === 'stdio' ? mergeSecretInputs(draft.env, form.env) : {}
        effective.headers = effective.transport === 'streamable-http' ? mergeSecretInputs(draft.headers, form.headers) : {}
      } else {
        return fail('缺少测试目标：请传入服务器 id 或表单配置。')
      }
    } catch (error) {
      return fail('读取配置失败：' + (error instanceof Error ? error.message : String(error)))
    }

    // --- 基础齐备性（与保存校验同口径，快速失败） ---
    if (effective.transport === 'stdio' && effective.command.trim() === '') return fail('stdio 传输必须填写启动命令。')
    if (effective.transport === 'streamable-http') {
      if (effective.url.trim() === '') return fail('Streamable HTTP 传输必须填写 MCP 端点 URL。')
      try { new URL(effective.url) } catch { return fail('MCP 端点 URL 不是合法的绝对地址。') }
    }
    if (effective.serverName === '' || !/^[A-Za-z0-9_-]{1,32}$/.test(effective.serverName)) return fail('命名空间 serverName 非法（字母/数字/下划线/中划线，1-32 位）。')

    // --- 建立一次性连接 ---
    let transport
    try {
      transport = effective.transport === 'stdio'
        ? new StdioClientTransport({
            command: effective.command,
            args: effective.args,
            env: { ...scrubbedParentEnv(), ...effective.env },
            cwd: effective.cwd,
          })
        : new StreamableHTTPClientTransport(new URL(effective.url), { requestInit: { headers: effective.headers } })
    } catch (error) {
      return fail('传输配置无效：' + (error instanceof Error ? error.message : String(error)))
    }

    const client = new Client({ name: 'dsh-devforge-mcp-test', version: '0.0.0' }, { capabilities: {} })
    let tools: McpTestTool[] | undefined
    let serverInfo: string | undefined
    try {
      await withTimeout(client.connect(transport), 20000, '连接')
      const version = client.getServerVersion()
      serverInfo = version !== undefined ? `${version.name} ${version.version}` : undefined
      const listed = await withTimeout(client.listTools(), 30000, '工具发现')
      tools = (listed.tools ?? []).map((tool) => ({
        name: tool.name,
        description: typeof tool.description === 'string' ? tool.description : '',
        publicName: 'mcp__' + effective.serverName + '__' + tool.name,
      }))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (input.id !== undefined && input.id !== '') recordMcpTestResult(getDb(), input.id, { ok: false, error: message })
      return fail(message)
    } finally {
      // close 会终止 stdio 子进程/HTTP 会话；失败不影响结果返回。
      try { await client.close() } catch { /* 已断开则忽略 */ }
    }

    if (input.id !== undefined && input.id !== '') recordMcpTestResult(getDb(), input.id, { ok: true, toolCount: tools.length })
    return { ok: true, ...(serverInfo !== undefined ? { serverInfo } : {}), tools, ms: Date.now() - started }
  }

  /** 卸载全部 fiber（能力关闭/销毁路径）。 */
  private disposeAll(): void {
    for (const [id, entry] of this.fibers) {
      this.fibers.delete(id)
      void entry.fiber.dispose().catch((error: unknown) => {
        this.log('warn', '卸载 MCP fiber 失败（%s）：%s', id, error instanceof Error ? error.message : String(error))
      })
    }
  }

  /** 统一日志出口（ctx.logger 缺失时静默降级，测试环境无宿主日志）。 */
  private log(level: 'info' | 'warn', message: string, ...args: unknown[]): void {
    try { this.ctx.logger?.[level]?.('[dsh-devforge] ' + message, ...args) } catch { /* 日志失败不影响业务 */ }
  }
}
