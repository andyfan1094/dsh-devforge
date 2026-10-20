/**
 * 孤儿宿主守卫单测（0.64.3）。
 *
 * 背景：DSH 桌面壳把宿主（dsh-desktop-host）作为 detached 子进程拉起，壳退出/重启
 * 时不会结束它；旧宿主继续持有飞书长连接与 store.db，多个宿主抢同一飞书事件、
 * 设置只在一个实例生效（2026-10-19/20 实录）。守卫只在「桌面托管 + 同 profile +
 * 父进程已退出」三条同时成立时才结束进程，绝不碰父进程存活的实例。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  findOrphanHosts,
  runOrphanSweep,
  sweepOnDesktopStartup,
  type HostProcessSnapshot,
} from '../src/orphan-sweep.ts'

const PROFILE = 'C:\\Users\\Administrator\\.dsh\\profiles\\desktop'

/** 造一个桌面宿主进程快照。 */
function host(pid: number, parentPid: number, profile = PROFILE, extra = ''): HostProcessSnapshot {
  return {
    pid,
    parentPid,
    name: 'DeepSeek Harness.exe',
    commandLine: `"C:\\...\\DeepSeek Harness.exe" "...\\dsh-desktop-host\\lib\\index.js" "..." "${profile}" ...${extra}`,
  }
}

test('孤儿判定：父进程已退出的同 profile 桌面宿主命中', () => {
  const processes = [host(100, 999), host(200, 888)]
  const alive = new Set<number>([999]) // 999 存活，888 已退出
  const orphans = findOrphanHosts(processes, 100, PROFILE, (pid) => alive.has(pid))
  assert.deepEqual(orphans.map((item) => item.pid), [200], '只有父进程退出的 200 是孤儿')
})

test('孤儿判定：父进程存活的宿主绝不误杀（多窗口/壳正常重启场景）', () => {
  const processes = [host(100, 999), host(200, 888)]
  const alive = new Set<number>([999, 888])
  const orphans = findOrphanHosts(processes, 100, PROFILE, (pid) => alive.has(pid))
  assert.equal(orphans.length, 0)
})

test('孤儿判定：别的 profile、非桌面宿主、自己都不在清扫范围', () => {
  const otherProfile = 'C:\\Users\\Administrator\\.dsh\\profiles\\web'
  const cliHost: HostProcessSnapshot = {
    pid: 300,
    parentPid: 777,
    name: 'node.exe',
    commandLine: 'node "...\\dsh\\lib\\bin.js" --profile web --port 3081 --no-open',
  }
  const processes = [host(100, 999), host(400, 666, otherProfile), cliHost]
  const orphans = findOrphanHosts(processes, 100, PROFILE, () => false)
  assert.equal(orphans.length, 0, '父进程都已退出，但都不该被认领')
})

test('清扫执行：只结束孤儿，失败单独记账且不中断', () => {
  const processes = [host(100, 999), host(200, 888), host(300, 666)]
  const alive = new Set<number>([777]) // 三个父进程都已退出
  const killed: number[] = []
  const logs: string[] = []
  const result = runOrphanSweep({
    collect: () => processes,
    isAlive: (pid) => alive.has(pid),
    kill: (pid) => {
      if (pid === 300) throw new Error('access denied')
      killed.push(pid)
    },
    log: (line) => { logs.push(line) },
    selfPid: 100,
    profileHint: PROFILE,
  })
  assert.deepEqual(result.orphans.sort(), [200, 300])
  assert.deepEqual(killed, [200], '300 结束失败，不能算已清理')
  assert.deepEqual(result.killed, [200])
  assert.deepEqual(result.failed, [300])
  assert.ok(logs.some((line) => line.includes('orphan')), '清扫结果必须留痕')
})

test('启动入口：非桌面托管模式直接跳过，不扫描进程', () => {
  let collected = false
  const result = sweepOnDesktopStartup({
    argv: ['node', 'bin.js', '--profile', 'web', '--port', '3081'],
    env: {},
    platform: 'win32',
    sweep: (options) => {
      collected = true
      return { scanned: 0, sameProfileHosts: 0, orphans: [], killed: [], failed: [] }
    },
  })
  assert.equal(result.skipped, '非桌面托管模式')
  assert.equal(collected, false, '非桌面模式不得扫描/结束任何进程')
})

test('启动入口：桌面托管模式按 profile 提示执行清扫', () => {
  const calls: string[] = []
  const result = sweepOnDesktopStartup({
    argv: ['DeepSeek Harness.exe', '...\\dsh-desktop-host\\lib\\index.js', '...\\dsh', PROFILE],
    env: {},
    platform: 'win32',
    sweep: (options) => {
      calls.push(options.profileHint)
      return { scanned: 3, sameProfileHosts: 2, orphans: [200], killed: [200], failed: [] }
    },
  })
  assert.deepEqual(result.killed, [200])
  assert.equal(calls.length, 1)
  assert.equal(calls[0].toLowerCase(), PROFILE.toLowerCase())
})
