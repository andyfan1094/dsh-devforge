/**
 * 重启管理器测试。
 *
 * 起因（2026-10-15 实测）：桌面版宿主由 Electron 壳托管，旧实现仍用
 * `spawn(process.execPath, process.argv.slice(1))` 再拉起一个宿主，与壳的宿主抢
 * 127.0.0.1:19387，输的一方写 EADDRINUSE 崩溃日志，赢的一方成为父进程消失的孤儿。
 * 这些用例锁定：桌面模式只做壳接管（不自行拉起宿主）、CLI 模式走顺序引导、
 * 端口解析与端口占用探测正确。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:net'
import type { AddressInfo } from 'node:net'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DshWebRestartManager,
  isDesktopManagedHost,
  listPortOwners,
  probePort,
  resolveRestartPort,
} from '../src/restart.ts'

const DESKTOP_ARGV = [
  '--expose-internals',
  'C:\\Program Files\\DeepSeek Harness\\resources\\app.asar\\dsh\\node_modules\\@deepseek-ai\\dsh-desktop-host\\lib\\index.js',
  'C:\\Program Files\\DeepSeek Harness\\resources\\app.asar\\dsh',
  'C:\\Users\\Administrator\\.dsh\\profiles\\desktop',
]

const CLI_ARGV = ['web', '--profile', 'web', '--port', '3081']

test('isDesktopManagedHost：识别桌面壳宿主与 CLI 宿主', () => {
  assert.equal(isDesktopManagedHost(DESKTOP_ARGV, {}), true)
  assert.equal(isDesktopManagedHost(CLI_ARGV, {}), false)
  assert.equal(isDesktopManagedHost([], { DSH_DESKTOP: '1', ELECTRON_RUN_AS_NODE: '1' }), true)
  assert.equal(isDesktopManagedHost([], { DSH_DESKTOP: '1' }), false)
})

test('resolveRestartPort：命令行优先于环境变量，最后回退 19387', () => {
  assert.equal(resolveRestartPort(['web', '--port', '3081'], {}), 3081)
  assert.equal(resolveRestartPort(['web', '--port=4100'], {}), 4100)
  assert.equal(resolveRestartPort(['web', '--web-port=4200'], {}), 4200)
  assert.equal(resolveRestartPort([], { DSH_PORT: '5000' }), 5000)
  assert.equal(resolveRestartPort([], { DSH_WEB_URL: 'http://127.0.0.1:6000/?token=x' }), 6000)
  assert.equal(resolveRestartPort([], {}), 19387)
})

test('probePort：空闲端口为 false，被监听时为 true', async () => {
  const server = createServer()
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  try {
    assert.equal(await probePort(port), true)
    assert.deepEqual(listPortOwners(port).length > 0 || process.platform !== 'win32', true)
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
  assert.equal(await probePort(port), false)
})

test('requestRestart：桌面模式只交给壳，不自行拉起宿主', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'restart-desktop-'))
  const spawned: string[][] = []
  try {
    const manager = new DshWebRestartManager({
      argv: DESKTOP_ARGV,
      env: { DSH_HOME: dir },
      platform: 'win32',
      executable: 'DeepSeek Harness.exe',
      logFile: join(dir, 'logs', 'dsh-web-restart.log'),
      bootstrapScript: join(dir, 'devforge', 'restart-bootstrap.cjs'),
      spawnProcess: (_command, args) => { spawned.push(args); return { unref: () => undefined } },
      scheduleExit: () => undefined,
    })
    assert.equal(manager.mode, 'desktop')
    assert.equal(manager.strategy, 'desktop-shell-handoff')
    assert.equal(manager.port, 19387)

    const result = manager.requestRestart()
    assert.equal(result.scheduled, true)
    assert.equal(result.mode, 'desktop')
    assert.match(result.message, /桌面版/)

    // 只启动一个引导进程，且引导进程的参数里带 original argv 与 desktop 模式选项。
    assert.equal(spawned.length, 1)
    const bootstrapArgs = spawned[0]
    assert.equal(bootstrapArgs[0], join(dir, 'devforge', 'restart-bootstrap.cjs'))
    assert.equal(bootstrapArgs[1], 'DeepSeek Harness.exe')
    const reused = JSON.parse(bootstrapArgs[2]) as string[]
    assert.deepEqual(reused, DESKTOP_ARGV)
    const options = JSON.parse(bootstrapArgs[3]) as { mode: string; port: number }
    assert.equal(options.mode, 'desktop')
    assert.equal(options.port, 19387)

    // 留痕日志写入 JSON 行。
    const log = await readFile(join(dir, 'logs', 'dsh-web-restart.log'), 'utf8')
    assert.match(log, /"stage":"restart-requested"/)
    assert.match(log, /"mode":"desktop"/)

    // 连点只调度一次。
    const again = manager.requestRestart()
    assert.equal(again.scheduled, true)
    assert.equal(spawned.length, 1)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('requestRestart：CLI 模式走顺序引导并在消息中说明', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'restart-cli-'))
  const spawned: string[][] = []
  try {
    const manager = new DshWebRestartManager({
      argv: CLI_ARGV,
      env: { DSH_HOME: dir },
      platform: 'win32',
      executable: 'C:\\Program Files\\nodejs\\node.exe',
      logFile: join(dir, 'logs', 'dsh-web-restart.log'),
      bootstrapScript: join(dir, 'devforge', 'restart-bootstrap.cjs'),
      spawnProcess: (_command, args) => { spawned.push(args); return { unref: () => undefined } },
      scheduleExit: () => undefined,
    })
    assert.equal(manager.mode, 'cli')
    assert.equal(manager.strategy, 'cli-sequential-bootstrap')
    assert.equal(manager.port, 3081)

    const result = manager.requestRestart()
    assert.equal(result.mode, 'cli')
    assert.equal(result.port, 3081)
    assert.match(result.message, /正在重启/)
    const options = JSON.parse(spawned[0][3]) as { mode: string; port: number }
    assert.equal(options.mode, 'cli')
    assert.equal(options.port, 3081)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('requestRestart：缺少启动参数时抛错且不写 scheduled', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'restart-noargv-'))
  try {
    const manager = new DshWebRestartManager({
      argv: [],
      env: { DSH_HOME: dir },
      platform: 'win32',
      logFile: join(dir, 'logs', 'dsh-web-restart.log'),
      bootstrapScript: join(dir, 'devforge', 'restart-bootstrap.cjs'),
      spawnProcess: () => ({ unref: () => undefined }),
      scheduleExit: () => undefined,
    })
    assert.throws(() => manager.requestRestart(), /无法确定当前 DSH Web 的启动参数/)
    const log = await readFile(join(dir, 'logs', 'dsh-web-restart.log'), 'utf8')
    assert.match(log, /"stage":"restart-request-failed"/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('diagnose：报告端口/模式/留痕路径，且不产生副作用', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'restart-diagnose-'))
  try {
    const manager = new DshWebRestartManager({
      argv: CLI_ARGV,
      env: { DSH_HOME: dir },
      platform: process.platform,
      logFile: join(dir, 'logs', 'dsh-web-restart.log'),
      bootstrapScript: join(dir, 'devforge', 'restart-bootstrap.cjs'),
      spawnProcess: () => { throw new Error('diagnose 不应派生子进程') },
      scheduleExit: () => { throw new Error('diagnose 不应安排退出') },
    })
    const diagnosis = await manager.diagnose()
    assert.equal(diagnosis.mode, 'cli')
    assert.equal(diagnosis.port, 3081)
    assert.equal(diagnosis.selfPid, process.pid)
    assert.equal(diagnosis.logFile, join(dir, 'logs', 'dsh-web-restart.log'))
    assert.equal(Array.isArray(diagnosis.hints), true)
    assert.equal(diagnosis.hints.length > 0, true)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
