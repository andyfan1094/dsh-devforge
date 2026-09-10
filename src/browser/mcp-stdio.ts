/**
 * 本地 Playwright MCP Server 轻量客户端（stdio 传输，官方协议直连，无第三方依赖）。
 *
 * 协议约定：JSON-RPC 2.0，按行分帧；initialize 握手后才能 tools/call。
 * 子进程由本类负责拉起和回收，stderr 只用于错误摘要，绝不透传给模型。
 */
import { spawn, type ChildProcess } from 'node:child_process'

/** 单条待决请求的回调与超时句柄。 */
interface PendingEntry {
  resolve: (value: any) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

/** MCP 内容块的最小视图。 */
export interface McpContentBlock {
  type?: unknown
  text?: unknown
  data?: unknown
  mimeType?: unknown
}

/** MCP tools/call 规整结果。 */
export interface McpCallResult {
  isError: boolean
  text: string
  image?: { data: string; mimeType: string }
}

/** 把 MCP 内容块数组规整为安全结果；文本拼接、只取首张图片。 */
export function normalizeMcpCallResult(rawContent: unknown, isError: boolean): McpCallResult {
  const blocks = Array.isArray(rawContent) ? rawContent : []
  let text = ''
  let image: McpCallResult['image'] | undefined
  for (const block of blocks) {
    const record = (block ?? {}) as McpContentBlock
    if (record.type === 'text' && typeof record.text === 'string') {
      text = text === '' ? record.text : text + '\n' + record.text
    } else if (record.type === 'image' && typeof record.data === 'string' && image === undefined) {
      image = { data: record.data, mimeType: typeof record.mimeType === 'string' ? record.mimeType : 'image/png' }
    }
  }
  return image === undefined ? { isError, text } : { isError, text, image }
}

/** 已验证的 Playwright MCP 版本；固定版本避免工具参数在无人值守时漂移。 */
export const PLAYWRIGHT_MCP_PACKAGE = '@playwright/mcp@0.0.79'

/** 由配置生成 playwright-mcp 启动参数（纯函数，供测试）。 */
export function buildPlaywrightArgs(options: { headless: boolean; channel: string; profileDir: string; outputDir: string }): string[] {
  const args = ['-y', PLAYWRIGHT_MCP_PACKAGE, '--browser', options.channel, '--output-dir', options.outputDir]
  if (options.headless) args.push('--headless')
  args.push('--user-data-dir', options.profileDir)
  return args
}

/** 把 JSON-RPC error 规整成短句。 */
export function describeRpcError(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    const record = error as { message?: unknown; code?: unknown }
    const message = typeof record.message === 'string' ? record.message : JSON.stringify(error)
    return typeof record.code === 'number' ? message + '（code ' + record.code + '）' : message
  }
  return String(error)
}

/** 单客户端绑定一个 playwright-mcp 子进程；未启动或已退出时按需重建。 */
export class PlaywrightMcpStdio {
  private child: ChildProcess | undefined
  private stderrTail = ''
  private buffer = ''
  private pending = new Map<number, PendingEntry>()
  private nextId = 1
  private initialized = false
  private starting: Promise<void> | undefined

  /** 启动命令（默认 npx）。 */
  private readonly command: string
  /** 启动参数。 */
  private readonly args: string[]
  /** 单请求超时（毫秒）。 */
  private readonly timeoutMs: number

  constructor(command: string, args: string[], timeoutMs = 45000) {
    this.command = command
    this.args = args
    this.timeoutMs = timeoutMs
  }

  /** 子进程是否存活。 */
  get running(): boolean {
    return this.child !== undefined && this.child.exitCode === null
  }

  /** 停止子进程并拒绝全部待决请求。 */
  stop(): void {
    this.initialized = false
    this.starting = undefined
    const child = this.child
    this.child = undefined
    if (child !== undefined && child.exitCode === null) {
      try {
        if (process.platform === 'win32' && child.pid !== undefined) {
          // Windows 经 shell 启动时 kill 只能杀到 cmd.exe 外壳，用 taskkill 连整棵子进程树一起结束。
          const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
          killer.on('error', () => { /* taskkill 不可用时退回默认行为，避免未处理异常 */ })
        } else {
          child.kill('SIGTERM')
        }
      } catch { /* 进程已退出时忽略 */ }
    }
    const entries = [...this.pending.values()]
    this.pending.clear()
    for (const entry of entries) {
      clearTimeout(entry.timer)
      entry.reject(new Error('浏览器 MCP 会话已停止'))
    }
  }

  /** 确保子进程存活且完成握手；并发调用共享同一次启动。 */
  async ensureReady(): Promise<void> {
    if (this.running && this.initialized) return
    if (this.starting !== undefined) return await this.starting
    this.starting = this.start().finally(() => { this.starting = undefined })
    return await this.starting
  }

  /** 启动子进程并完成 initialize 握手。 */
  private async start(): Promise<void> {
    this.stop()
    await new Promise<void>((resolve, reject) => {
      // Windows 下 npx 实为 npx.cmd，Node 强制 .cmd 必须经 shell 启动；含空格的参数需补引号防止被 shell 拆散。
      const useShell = process.platform === 'win32'
      const command = useShell && !/\.[a-zA-Z]+$/.test(this.command) ? this.command + '.cmd' : this.command
      const args = useShell
        ? this.args.map((item) => (/[\s"]/.test(item) ? '"' + item.replace(/"/g, '\\"') + '"' : item))
        : this.args
      const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'], shell: useShell })
      this.child = child
      this.buffer = ''
      this.stderrTail = ''
      child.stdout?.setEncoding('utf8')
      child.stdout?.on('data', (chunk: string) => { this.handleStdout(chunk, resolve) })
      child.stderr?.setEncoding('utf8')
      child.stderr?.on('data', (chunk: string) => { this.stderrTail = (this.stderrTail + chunk).slice(-800) })
      child.on('exit', () => { this.failAll(new Error('浏览器 MCP 进程已退出：' + this.stderrTail.trim().split('\n').pop())) })
      // spawn 失败（如 ENOENT）只触发 error 不触发 exit；不接住会变成未处理异常击穿整个 Host 进程。
      child.on('error', (error: Error) => {
        this.failAll(new Error('浏览器 MCP 进程启动失败：' + (error?.message ?? String(error))))
      })
      // 握手超时：放宽到 120 秒，覆盖 npx 首次下载 @playwright/mcp 包的耗时。
      const bootTimer = setTimeout(() => { reject(new Error('浏览器 MCP 启动超时：' + this.stderrTail.trim().split('\n').pop())) }, Math.max(this.timeoutMs, 120000))
      void this.rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'dsh-devforge', version: '0.5.0' } })
        .then(async () => {
          this.notify('notifications/initialized', {})
          this.initialized = true
          clearTimeout(bootTimer)
          resolve()
        })
        .catch((error: unknown) => {
          clearTimeout(bootTimer)
          this.stop()
          reject(error instanceof Error ? error : new Error(String(error)))
        })
    })
  }

  /** 解析 stdout 行帧并派发响应。 */
  private handleStdout(chunk: string, onFirstResponse?: () => void): void {
    this.buffer += chunk
    let index = this.buffer.indexOf('\n')
    while (index >= 0) {
      const line = this.buffer.slice(0, index).trim()
      this.buffer = this.buffer.slice(index + 1)
      if (line !== '') this.dispatchLine(line, onFirstResponse)
      index = this.buffer.indexOf('\n')
    }
  }

  /** 按请求 id 派发单条 JSON-RPC 消息；通知直接忽略。 */
  private dispatchLine(line: string, onFirstResponse?: () => void): void {
    let payload: any
    try { payload = JSON.parse(line) } catch { return }
    if (typeof payload?.id !== 'number') return
    const entry = this.pending.get(payload.id)
    if (entry === undefined) return
    this.pending.delete(payload.id)
    clearTimeout(entry.timer)
    if (payload.error !== undefined) entry.reject(new Error('MCP 调用失败：' + describeRpcError(payload.error)))
    else { onFirstResponse?.(); entry.resolve(payload.result) }
  }

  /** 拒绝全部待决请求（进程退出时）。 */
  private failAll(error: Error): void {
    const entries = [...this.pending.values()]
    this.pending.clear()
    for (const entry of entries) {
      clearTimeout(entry.timer)
      entry.reject(error)
    }
    this.initialized = false
  }

  /** 发送一个 JSON-RPC 请求并等待匹配响应。 */
  private async rpc(method: string, params: Record<string, unknown>): Promise<any> {
    const child = this.child
    const stdin = child?.stdin
    if (child === undefined || stdin === null || stdin === undefined) throw new Error('浏览器 MCP 进程未启动')
    const id = this.nextId++
    const message = JSON.stringify({ jsonrpc: '2.0', id, method, params })
    await new Promise<void>((resolve, reject) => {
      stdin.write(message + '\n', (error) => { error === null ? resolve() : reject(error) })
    })
    return await new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('浏览器 MCP 请求超时：' + method))
      }, this.timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
    })
  }

  /** 发送一条通知（无 id，无响应）。 */
  private notify(method: string, params: Record<string, unknown>): void {
    const stdin = this.child?.stdin
    if (stdin === null || stdin === undefined) return
    try { stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n') } catch { /* 进程退出时忽略 */ }
  }

  /** 调用一个 MCP 工具；未就绪自动补握手。 */
  async callTool(name: string, args: Record<string, unknown>): Promise<McpCallResult> {
    await this.ensureReady()
    const result = await this.rpc('tools/call', { name, arguments: args })
    return normalizeMcpCallResult(result?.content, result?.isError === true)
  }
}
