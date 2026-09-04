/**
 * MCP 连接测试 —— 用内嵌的最小 stdio MCP 服务器做真实握手验证。
 * 覆盖：initialize + tools/list 成功路径、stdio 启动失败路径、按 id 测试时回写 lastTest。
 * 全部使用临时目录隔离库文件，不触碰真实 ~/.dsh。
 */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { McpService } from '../src/mcp/service.ts'
import { listMcpServers, saveMcpServer } from '../src/mcp/store.ts'
import { closeDb, getDb } from '../src/store/db.ts'

/**
 * 最小 stdio MCP 服务器：按行读 JSON-RPC，回应 initialize / tools-list。
 * 只实现握手与工具发现所需的最小协议面（足够 SDK Client 完成连接）。
 */
const MINI_SERVER = `
const readline = require('node:readline')
const rl = readline.createInterface({ input: process.stdin })
rl.on('line', (line) => {
  let msg
  try { msg = JSON.parse(line) } catch { return }
  if (msg.method === 'initialize') {
    respond(msg.id, { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'mini-mcp', version: '1.0.0' } })
  } else if (msg.method === 'tools/list') {
    respond(msg.id, { tools: [
      { name: 'echo', description: '回显文本', inputSchema: { type: 'object', properties: { text: { type: 'string' } } } },
      { name: 'add', description: '两数相加', inputSchema: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } } } },
    ] })
  } else if (msg.id !== undefined) {
    respond(msg.id, {})
  }
})
function respond(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\\n')
}
`

describe('MCP 连接测试（真实 stdio 握手）', () => {
  let home: string
  let serverScript: string
  let service: McpService

  before(() => {
    home = mkdtempSync(join(tmpdir(), 'dsh-devforge-mcp-conn-'))
    process.env.DSH_HOME = home
    const scriptDir = join(home, 'bin')
    mkdirSync(scriptDir, { recursive: true })
    serverScript = join(scriptDir, 'mini-mcp-server.cjs')
    writeFileSync(serverScript, MINI_SERVER)
    // 最小 ctx 桩：service 的日志路径对缺失 logger 容错。
    service = new McpService({} as never, () => true)
  })

  after(() => {
    closeDb()
    rmSync(home, { recursive: true, force: true })
    delete process.env.DSH_HOME
  })

  it('内联 stdio 配置：握手成功并发现 2 个工具（公开名带命名空间前缀）', async () => {
    const result = await service.test({
      server: {
        serverName: 'mini',
        transport: 'stdio',
        command: process.execPath,
        args: [serverScript],
      },
    })
    assert.equal(result.ok, true, '测试应成功：' + (result.error ?? ''))
    assert.equal(result.serverInfo, 'mini-mcp 1.0.0')
    assert.deepEqual(result.tools?.map((tool) => tool.name), ['echo', 'add'])
    assert.deepEqual(result.tools?.map((tool) => tool.publicName), ['mcp__mini__echo', 'mcp__mini__add'])
    assert.ok(result.ms >= 0)
  })

  it('不存在的命令：返回可读失败而不抛出', async () => {
    const result = await service.test({
      server: { serverName: 'ghost', transport: 'stdio', command: '/nonexistent/mcp-binary-xyz' },
    })
    assert.equal(result.ok, false)
    assert.ok((result.error ?? '').length > 0, '失败必须带原因')
  })

  it('按已存 id 测试：结果回写 lastTest', async () => {
    const created = saveMcpServer(getDb(), {
      serverName: 'saved',
      transport: 'stdio',
      command: process.execPath,
      args: [serverScript],
    })
    const result = await service.test({ id: created.id })
    assert.equal(result.ok, true, '测试应成功：' + (result.error ?? ''))
    const stored = listMcpServers(getDb()).find((server) => server.id === created.id)
    assert.equal(stored?.lastTest?.ok, true)
    assert.equal(stored?.lastTest?.toolCount, 2)
  })

  it('不存在的 id：返回明确失败', async () => {
    const result = await service.test({ id: 'no-such-id' })
    assert.equal(result.ok, false)
    assert.match(result.error ?? '', /不存在/)
  })

  it('内联密钥空值回填已存值：二次测试无需明文回传', async () => {
    const created = saveMcpServer(getDb(), {
      serverName: 'secrecy',
      transport: 'stdio',
      command: process.execPath,
      args: [serverScript],
      env: [{ key: 'MINI_TOKEN', value: 'tok-1' }],
    })
    // 表单只回传键 + 空值（浏览器不持有明文）；Host 端应回填 tok-1。
    // 最小服务器不校验 env，这里验证的是「回填后仍能正常握手」的路径一致性。
    const result = await service.test({
      server: { id: created.id, serverName: 'secrecy', transport: 'stdio', command: process.execPath, args: [serverScript], env: [{ key: 'MINI_TOKEN', value: '' }] },
    })
    assert.equal(result.ok, true, '测试应成功：' + (result.error ?? ''))
  })
})
