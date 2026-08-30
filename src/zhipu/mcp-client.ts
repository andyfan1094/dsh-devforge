/** 智谱官方 MCP Server 轻量客户端（Streamable HTTP，官方协议直连，无第三方依赖）。 */
import type { ZhipuMcpToolDescriptor } from './protocol.ts'

/** MCP 调用失败（消息已脱敏，可直接返回给模型）。 */
export class ZhipuMcpError extends Error {
  /** HTTP 状态码（握手/网络层失败时存在）。 */
  status?: number
  constructor(message: string, status?: number) {
    super(message)
    this.name = 'ZhipuMcpError'
    this.status = status
  }
}

/** 脱敏错误文本：绝不把 Bearer Key 带进错误消息或日志。 */
export function safeMcpError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  return raw.replace(/Bearer\s+[^\s]+/gi, 'Bearer [redacted]').slice(0, 300)
}

/** MCP tools/call 结果（文本内容拼接）。 */
export interface ZhipuMcpCallResult {
  /** 官方是否标记为错误结果。 */
  isError: boolean
  /** 全部 text 内容块按序拼接。 */
  text: string
}

/** 单客户端绑定一个官方 MCP Server 端点；会话懒建立，失效自动重建。 */
export class ZhipuMcpClient {
  /** 官方 MCP 端点。 */
  private endpoint: string
  /** 每次请求重新解析受管凭据，Key 更新无需重启。 */
  private resolveApiKey: () => Promise<string>
  /** 单请求超时（毫秒）。 */
  private timeoutMs: number
  /** 当前 MCP 会话 id（initialize 响应头下发）。 */
  private sessionId: string | undefined
  /** JSON-RPC 请求 id 自增。 */
  private nextId = 1

  constructor(endpoint: string, resolveApiKey: () => Promise<string>, timeoutMs = 30000) {
    this.endpoint = endpoint
    this.resolveApiKey = resolveApiKey
    this.timeoutMs = timeoutMs
  }

  /** 丢弃当前会话（404 或协议错误后调用，下次请求重新握手）。 */
  reset(): void {
    this.sessionId = undefined
  }

  /** 拉取工具清单（懒握手）。 */
  async listTools(): Promise<ZhipuMcpToolDescriptor[]> {
    const result = await this.rpc('tools/list', {})
    const tools = Array.isArray(result?.tools) ? result.tools : []
    return tools.map((tool: { name?: unknown; description?: unknown }) => ({
      name: typeof tool.name === 'string' ? tool.name : '',
      description: typeof tool.description === 'string' ? tool.description : '',
    })).filter((tool: ZhipuMcpToolDescriptor) => tool.name !== '')
  }

  /** 调用一个工具；会话失效自动重建并重试一次。 */
  async call(rawName: string, args: Record<string, unknown>): Promise<ZhipuMcpCallResult> {
    try {
      return await this.callOnce(rawName, args)
    } catch (error) {
      // 会话过期在官方实现上表现为 404；重置会话重试一次。
      if (error instanceof ZhipuMcpError && error.status === 404) {
        this.reset()
        return await this.callOnce(rawName, args)
      }
      throw error
    }
  }

  /** 单次 tools/call（不含重试）。 */
  private async callOnce(rawName: string, args: Record<string, unknown>): Promise<ZhipuMcpCallResult> {
    const result = await this.rpc('tools/call', { name: rawName, arguments: args })
    const blocks = Array.isArray(result?.content) ? result.content : []
    const text = blocks.map((block: { type?: unknown; text?: unknown }) => (block.type === 'text' && typeof block.text === 'string' ? block.text : '')).filter((part: string) => part !== '').join('\n')
    return { isError: result?.isError === true, text }
  }

  /** JSON-RPC 请求：缺会话先 initialize，再发业务方法。 */
  private async rpc(method: string, params: Record<string, unknown>): Promise<any> {
    if (this.sessionId === undefined) await this.initialize()
    return await this.request(method, params, true)
  }

  /** MCP 握手：initialize → notifications/initialized。 */
  private async initialize(): Promise<void> {
    const response = await this.post({ jsonrpc: '2.0', id: this.nextId++, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'dsh-devforge', version: '0.2.0' } } }, undefined)
    const payload = await this.readPayload(response)
    if (payload.error !== undefined) throw new ZhipuMcpError(`智谱 MCP 握手被拒绝：${describeRpcError(payload.error)}`, response.status)
    this.sessionId = response.headers.get('mcp-session-id') ?? undefined
    if (this.sessionId === undefined) throw new ZhipuMcpError('智谱 MCP 握手未返回会话 id。', response.status)
    // initialized 通知：官方返回 202 空 body，读掉即可。
    await this.post({ jsonrpc: '2.0', method: 'notifications/initialized' }, this.sessionId).then((r) => r.body?.cancel()).catch(() => undefined)
  }

  /** 发一个（业务）请求；retriable 表示 404 时由调用方决定重建会话。 */
  private async request(method: string, params: Record<string, unknown>, allowReset: boolean): Promise<any> {
    const response = await this.post({ jsonrpc: '2.0', id: this.nextId++, method, params }, this.sessionId)
    if (response.status === 404 && allowReset) {
      this.reset()
      await this.initialize()
      return await this.request(method, params, false)
    }
    const payload = await this.readPayload(response)
    if (payload.error !== undefined) throw new ZhipuMcpError(`智谱 MCP 调用失败：${describeRpcError(payload.error)}`, response.status)
    return payload.result
  }

  /** POST 一个 JSON-RPC 消息。 */
  private async post(body: Record<string, unknown>, sessionId: string | undefined): Promise<Response> {
    const apiKey = await this.resolveApiKey()
    let response: Response
    try {
      response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
          'Authorization': `Bearer ${apiKey}`,
          ...(sessionId !== undefined ? { 'mcp-session-id': sessionId } : {}),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch (error) {
      throw new ZhipuMcpError(`智谱 MCP 服务不可达：${safeMcpError(error)}`)
    }
    if (!response.ok && response.status !== 202) {
      const text = safeMcpError(await response.text().catch(() => ''))
      await response.body?.cancel().catch(() => undefined)
      throw new ZhipuMcpError(`智谱 MCP HTTP ${response.status}：${text || '无响应体'}`, response.status)
    }
    return response
  }

  /** 解析响应体：纯 JSON 或 SSE（data: 行）。 */
  private async readPayload(response: Response): Promise<any> {
    const text = await response.text().catch(() => '')
    if (text.trim() === '') return {}
    const dataLine = text.split('\n').find((line) => line.startsWith('data:'))
    const raw = dataLine !== undefined ? dataLine.slice(5).trim() : text
    try {
      return JSON.parse(raw)
    } catch {
      throw new ZhipuMcpError(`智谱 MCP 响应不是 JSON：${safeMcpError(raw.slice(0, 120))}`, response.status)
    }
  }
}

/** 把 JSON-RPC error 规整成短句。 */
function describeRpcError(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    const record = error as { message?: unknown; code?: unknown }
    const message = typeof record.message === 'string' ? record.message : JSON.stringify(error)
    return typeof record.code === 'number' ? `${message}（code ${record.code}）` : message
  }
  return String(error)
}
