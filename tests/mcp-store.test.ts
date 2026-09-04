/**
 * MCP 服务器配置存储测试 —— 校验、脱敏、映射与 store.db 读写往返。
 * 全部使用临时目录隔离库文件，不触碰真实 ~/.dsh。
 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import {
  deleteMcpServer,
  fingerprintOf,
  listMcpServers,
  mergeSecretInputs,
  McpConfigError,
  recordMcpTestResult,
  saveMcpServer,
  summarizeServer,
  toMcpClientConfig,
} from '../src/mcp/store.ts'
import { closeDb, getDb } from '../src/store/db.ts'

describe('MCP 配置存储', () => {
  let home: string

  before(() => {
    // 隔离 DSH_HOME：getDb() 的库文件落在临时目录，不碰真实数据。
    home = mkdtempSync(join(tmpdir(), 'dsh-devforge-mcp-test-'))
    process.env.DSH_HOME = home
  })

  after(() => {
    closeDb()
    rmSync(home, { recursive: true, force: true })
    delete process.env.DSH_HOME
  })

  it('新增 stdio 服务器：必填校验与默认值', () => {
    const record = saveMcpServer(getDb(), {
      serverName: 'github',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
      env: [{ key: 'GITHUB_TOKEN', value: 'gh-token-1' }],
    })
    assert.equal(record.serverName, 'github')
    assert.equal(record.enabled, true)
    assert.equal(record.toolCallTimeoutMs, 60000)
    assert.equal(record.env['GITHUB_TOKEN'], 'gh-token-1')
    assert.equal(record.name, 'github')
  })

  it('serverName 非法字符被拒绝', () => {
    assert.throws(() => saveMcpServer(getDb(), { serverName: 'has space', transport: 'stdio', command: 'x' }), McpConfigError)
    assert.throws(() => saveMcpServer(getDb(), { serverName: '', transport: 'stdio', command: 'x' }), McpConfigError)
  })

  it('serverName 全库唯一', () => {
    saveMcpServer(getDb(), { serverName: 'unique-a', transport: 'stdio', command: 'x' })
    assert.throws(() => saveMcpServer(getDb(), { serverName: 'unique-a', transport: 'stdio', command: 'y' }), /已被「unique-a」占用/)
  })

  it('stdio 缺 command、http 缺/坏 URL 被拒绝', () => {
    assert.throws(() => saveMcpServer(getDb(), { serverName: 'no-cmd', transport: 'stdio' }), /必须填写启动命令/)
    assert.throws(() => saveMcpServer(getDb(), { serverName: 'no-url', transport: 'streamable-http' }), /必须填写/)
    assert.throws(() => saveMcpServer(getDb(), { serverName: 'bad-url', transport: 'streamable-http', url: 'not-a-url' }), /合法的绝对地址/)
    assert.throws(() => saveMcpServer(getDb(), { serverName: 'ftp-url', transport: 'streamable-http', url: 'ftp://x/mcp' }), /http\/https/)
  })

  it('超时钳制到允许范围', () => {
    const low = saveMcpServer(getDb(), { serverName: 'timeout-low', transport: 'stdio', command: 'x', toolCallTimeoutMs: 100 })
    const high = saveMcpServer(getDb(), { serverName: 'timeout-high', transport: 'stdio', command: 'x', toolCallTimeoutMs: 999999 })
    assert.equal(low.toolCallTimeoutMs, 5000)
    assert.equal(high.toolCallTimeoutMs, 600000)
  })

  it('密钥空值 = 保留已存值（编辑不回传明文）', () => {
    const created = saveMcpServer(getDb(), { serverName: 'secret-keep', transport: 'stdio', command: 'x', env: [{ key: 'K1', value: 'v1' }, { key: 'K2', value: 'v2' }] })
    const updated = saveMcpServer(getDb(), { id: created.id, env: [{ key: 'K1', value: '' }, { key: 'K2', value: 'new' }, { key: 'K3', value: 'v3' }] })
    assert.equal(updated.env['K1'], 'v1') // 空值保留
    assert.equal(updated.env['K2'], 'new') // 新值覆盖
    assert.equal(updated.env['K3'], 'v3') // 新增键
  })

  it('mergeSecretInputs：空值/缺省跳过，空键名丢弃', () => {
    assert.deepEqual(mergeSecretInputs({ A: '1' }, [{ key: 'A' }, { key: 'B', value: '' }, { key: '  ', value: 'x' }, { key: 'C', value: '3' }]), { A: '1', C: '3' })
  })

  it('摘要脱敏：env/headers 只含键与 configured 标记', () => {
    const created = saveMcpServer(getDb(), { serverName: 'mask', transport: 'streamable-http', url: 'https://example.com/mcp', headers: [{ key: 'Authorization', value: 'Bearer secret' }] })
    const summary = summarizeServer(created)
    assert.equal('headers' in summary, false)
    assert.deepEqual(summary.headerEntries, [{ key: 'Authorization', configured: true }])
  })

  it('stdio/http 映射到官方桥 Config，指纹稳定', () => {
    const stdio = toMcpClientConfig({ id: '1', name: 'n', serverName: 's1', transport: 'stdio', enabled: true, command: 'npx', args: ['-y', 'pkg'], cwd: '', env: { A: '1' }, url: '', headers: {}, toolCallTimeoutMs: 30000, createdAt: 0, updatedAt: 0 })
    assert.deepEqual(stdio, { transport: 'stdio', serverName: 's1', toolCallTimeoutMs: 30000, failOnStartupError: false, command: 'npx', args: ['-y', 'pkg'], env: { A: '1' }, cwd: '' })
    const http = toMcpClientConfig({ id: '2', name: 'n', serverName: 's2', transport: 'streamable-http', enabled: true, command: '', args: [], cwd: '', env: {}, url: 'https://e/mcp', headers: { H: '1' }, toolCallTimeoutMs: 60000, createdAt: 0, updatedAt: 0 })
    assert.deepEqual(http, { transport: 'streamable-http', serverName: 's2', toolCallTimeoutMs: 60000, failOnStartupError: false, url: 'https://e/mcp', headers: { H: '1' } })
    // 指纹：不随 enabled/时间戳/测试结果变化
    const record = { id: '3', name: 'n', serverName: 's3', transport: 'stdio' as const, enabled: true, command: 'c', args: [], cwd: '', env: {}, url: '', headers: {}, toolCallTimeoutMs: 60000, createdAt: 1, updatedAt: 2 }
    assert.equal(fingerprintOf(record), fingerprintOf({ ...record, enabled: false, updatedAt: 99, lastTest: { ok: true, at: 5, toolCount: 1 } }))
  })

  it('测试结果回写与删除往返', () => {
    const created = saveMcpServer(getDb(), { serverName: 'roundtrip', transport: 'stdio', command: 'x' })
    recordMcpTestResult(getDb(), created.id, { ok: true, toolCount: 3 })
    const listed = listMcpServers(getDb())
    const found = listed.find((server) => server.id === created.id)
    assert.ok(found !== undefined)
    assert.equal(found.lastTest?.ok, true)
    assert.equal(found.lastTest?.toolCount, 3)
    // 删除
    assert.equal(deleteMcpServer(getDb(), created.id), true)
    assert.equal(deleteMcpServer(getDb(), created.id), false)
    assert.equal(listMcpServers(getDb()).some((server) => server.id === created.id), false)
  })
})
