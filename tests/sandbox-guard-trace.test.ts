/**
 * 沙箱清洗留痕通道单测（0.33.2）。
 *
 * 背景：0.33.1 的留痕写 `ctx.logger`，而该插件未 inject logger，
 * 访问即抛错并被钩子吞掉 —— 剥离生效却零日志。留痕必须独立于宿主日志路由，
 * 且自身绝不抛错、可被外部脚本读取。
 */

import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  GUARD_TRACE_MAX_BYTES,
  createGuardTracer,
  defaultGuardTraceFile,
  readGuardTrace,
} from '../src/sandbox-guard-trace.ts'

function withTempDir<T>(run: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'guard-trace-'))
  try {
    return run(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('留痕：追加写入 JSONL 且字段完整', () => {
  withTempDir((dir) => {
    const file = join(dir, 'nested', 'trace.jsonl')
    const trace = createGuardTracer(file)
    trace({ time: '2026-09-12T11:01:45.000Z', action: 'strip', tool: 'edit', callId: 'c1', sessionId: 'sess-A', reason: 'not-strictly-wider', requestedMode: 'danger-full-access', effectiveMode: 'danger-full-access' })
    trace({ time: '2026-09-12T11:01:46.000Z', action: 'keep', tool: 'bash', sessionId: 'sess-B', requestedMode: 'danger-full-access', effectiveMode: 'read-only' })

    const lines = readFileSync(file, 'utf8').split('\n').filter((line) => line.length > 0)
    assert.equal(lines.length, 2)
    const first = JSON.parse(lines[0])
    assert.equal(first.action, 'strip')
    assert.equal(first.sessionId, 'sess-A')
    assert.equal(first.reason, 'not-strictly-wider')

    const entries = readGuardTrace(file)
    assert.equal(entries.length, 2)
    assert.equal(entries[1].action, 'keep')
  })
})

test('留痕：目录不存在时自动创建，写入失败也不抛错', () => {
  withTempDir((dir) => {
    const file = join(dir, 'a', 'b', 'c', 'trace.jsonl')
    assert.doesNotThrow(() => createGuardTracer(file)({ time: 'now', action: 'strip', tool: 'bash' }))
    assert.equal(readGuardTrace(file).length, 1)

    // 把父路径变成文件：mkdir 必然失败，但仍不得抛错
    const blocked = join(dir, 'blocker')
    writeFileSync(blocked, 'x')
    assert.doesNotThrow(() => createGuardTracer(join(blocked, 'sub', 'trace.jsonl'))({ time: 'now', action: 'strip', tool: 'bash' }))
  })
})

test('留痕：超过体积上限时保留后半段而非无限增长', () => {
  withTempDir((dir) => {
    const file = join(dir, 'trace.jsonl')
    const trace = createGuardTracer(file, 400)
    for (let index = 0; index < 40; index += 1) {
      trace({ time: `t${index}`, action: 'strip', tool: 'bash', reason: 'not-strictly-wider' })
    }
    const size = readFileSync(file).byteLength
    assert.ok(size <= GUARD_TRACE_MAX_BYTES)
    const entries = readGuardTrace(file, 0)
    assert.ok(entries.length > 0 && entries.length < 40, `裁剪后应少于 40 条，实际 ${entries.length}`)
    // 尾部必须是最新的记录
    assert.equal(entries[entries.length - 1].time, 't39')
  })
})

test('留痕：损坏行被跳过，文件缺失返回空数组', () => {
  withTempDir((dir) => {
    const file = join(dir, 'trace.jsonl')
    writeFileSync(file, `${JSON.stringify({ time: 't1', action: 'strip', tool: 'bash' })}\n{ 坏行\n`)
    const entries = readGuardTrace(file)
    assert.equal(entries.length, 1)
    assert.equal(readGuardTrace(join(dir, 'missing.jsonl')).length, 0)
  })
})

test('留痕：默认路径尊重 DSH_HOME（暂存实例天然隔离）', () => {
  const previous = process.env.DSH_HOME
  try {
    process.env.DSH_HOME = '/tmp/dsh-home-x'
    // 期望值经 path.join 生成：产品在 Windows 用反斜杠、POSIX 用正斜杠都是正确行为，断言只关心 DSH_HOME 前缀被尊重。
    assert.equal(defaultGuardTraceFile(), join('/tmp/dsh-home-x', 'storages', 'dsh-devforge', 'sandbox-guard-trace.jsonl'))
    assert.equal(defaultGuardTraceFile('/custom'), join('/custom', 'storages', 'dsh-devforge', 'sandbox-guard-trace.jsonl'))
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
  }
})
