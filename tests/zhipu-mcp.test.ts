/** 智谱官方 MCP 工具单测：本地 mock MCP 端点覆盖握手、列表、调用、会话重试与错误。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http'
import { ZhipuMcpClient, ZhipuMcpError } from '../src/zhipu/mcp-client.ts'
import { makeZhipuMcpToolDefinitions, makeZhipuMcpClients } from '../src/zhipu/mcp-tools.ts'

/** 极简 JSON-RPC 应答器：按 method 分派，可注入会话失效与错误。 */
function startMock(handlers: { onInitialize?: (req: IncomingMessage) => void; onCall?: (name: string, args: any, req: IncomingMessage) => any }) {
  const sessions = new Set<string>()
  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let body = ''
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => {
      const message = JSON.parse(body)
      const reply = (payload: unknown): void => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(payload)) }
      if (message.method === 'initialize') {
        handlers.onInitialize?.(req)
        const sid = 'session-' + (sessions.size + 1)
        sessions.add(sid)
        res.setHeader('mcp-session-id', sid)
        return reply({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: '2025-03-26', capabilities: {}, serverInfo: { name: 'mock', version: '0' } } })
      }
      const sid = String(req.headers['mcp-session-id'] ?? '')
      if (sid === '' || !sessions.has(sid)) { res.statusCode = 404; return res.end('session not found') }
      if (message.method === 'tools/list') return reply({ jsonrpc: '2.0', id: message.id, result: { tools: [{ name: 'mock_tool', description: 'mock' }] } })
      if (message.method === 'tools/call') return reply({ jsonrpc: '2.0', id: message.id, result: handlers.onCall?.(message.params.name, message.params.arguments, req) ?? { content: [{ type: 'text', text: 'ok' }] } })
      reply({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'method not found' } })
    })
  })
  return new Promise<{ url: string; close: () => void }>((resolvePromise) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as { port: number }
      resolvePromise({ url: `http://127.0.0.1:${address.port}/mcp`, close: () => server.close() })
    })
  })
}

const keyProvider = async () => 'test-key'

test('智谱 MCP 客户端：握手后拉取工具清单', async () => {
  const mock = await startMock({})
  try {
    const client = new ZhipuMcpClient(mock.url, keyProvider, 5000)
    const tools = await client.listTools()
    assert.deepEqual(tools, [{ name: 'mock_tool', description: 'mock' }])
  } finally { mock.close() }
})

test('智谱 MCP 客户端：tools/call 携带 Bearer 与会话头并返回文本', async () => {
  let sawAuth = ''
  let sawSession = ''
  const mock = await startMock({ onCall: (name, args, req) => {
    sawAuth = String(req.headers.authorization)
    sawSession = String(req.headers['mcp-session-id'] ?? '')
    assert.equal(name, 'mock_tool')
    assert.equal(args.city, '杭州')
    return { content: [{ type: 'text', text: '结果文本' }] }
  } })
  try {
    const client = new ZhipuMcpClient(mock.url, keyProvider, 5000)
    const result = await client.call('mock_tool', { city: '杭州' })
    assert.equal(result.isError, false)
    assert.equal(result.text, '结果文本')
    assert.match(sawAuth, /^Bearer test-key$/)
    assert.match(sawSession, /^session-\d+$/)
  } finally { mock.close() }
})

test('智谱 MCP 客户端：会话失效自动重建并重试成功', async () => {
  const mock = await startMock({ onCall: () => ({ content: [{ type: 'text', text: '重试成功' }] }) })
  try {
    const client = new ZhipuMcpClient(mock.url, keyProvider, 5000)
    await client.listTools()
    // 直接篡改会话 id 模拟服务端会话过期（下一次调用 404 → 重建 → 成功）
    ;(client as unknown as { sessionId: string }).sessionId = 'session-stale'
    const result = await client.call('mock_tool', {})
    assert.equal(result.text, '重试成功')
  } finally { mock.close() }
})

test('智谱 MCP 客户端：JSON-RPC 错误转中文异常且不含 Key', async () => {
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => {
      const message = JSON.parse(body)
      if (message.method === 'initialize') {
        res.setHeader('mcp-session-id', 's1')
        res.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32000, message: 'bad key' } }))
        return
      }
      res.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: {} }))
    })
  })
  await new Promise<void>((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise))
  const port = (server.address() as { port: number }).port
  try {
    const client = new ZhipuMcpClient(`http://127.0.0.1:${port}/mcp`, async () => 'secret-key', 5000)
    await assert.rejects(client.listTools(), (error: unknown) => {
      assert.ok(error instanceof ZhipuMcpError)
      assert.match(error.message, /智谱 MCP 握手被拒绝/)
      assert.ok(!error.message.includes('secret-key'))
      return true
    })
  } finally { server.close() }
})

test('官方工具定义：5 个工具名与参数齐备', () => {
  const clients = makeZhipuMcpClients({ enabled: true, apiKeyEnv: 'X', timeoutMs: 1000 }, keyProvider)
  const tools = makeZhipuMcpToolDefinitions(clients)
  assert.deepEqual(tools.map((tool) => tool.name), ['zhipu_web_search', 'zhipu_web_reader', 'zhipu_zread_search', 'zhipu_zread_read_file', 'zhipu_zread_repo_structure'])
  for (const tool of tools) assert.equal(typeof tool.description, 'string')
})
