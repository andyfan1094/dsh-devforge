/**
 * 停机安全定时器单测（0.41.14）。
 *
 * 契约：插件里任何「可能跨进程停机仍在等待」的定时器都必须
 *   1) unref —— 不阻止 Node 进程退出；
 *   2) 可取消 —— 插件卸载/停机时能清掉。
 *
 * 为什么值得单测：DSH 桌面端安装更新要求 Host 在收到 shutdown 后 10 秒内真正退出，否则强杀并拒绝
 * 安装更新（用户可见报错「未能安全停止任务，更新未安装」）。内核停机正常路径只置 process.exitCode、
 * 不调 process.exit()，所以一个 ref 的 5 秒重试等待就能把退出时间拖到 10 秒量级、正好越线。
 * 本用例通过**子进程真实退出耗时**来验证 unref 契约，而不是只看代码字面。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { spawn } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { CanceledWaitError, createTimerScope } from '../src/shutdown-timers.ts'

// Windows 下 ESM 动态 import 必须是 file:// URL，直接给盘符路径会被加载器拒绝。
const moduleUrl = pathToFileURL(fileURLToPath(new URL('../src/shutdown-timers.ts', import.meta.url))).href

test('wait() 到期后 resolve，settled() 变真', async () => {
  const scope = createTimerScope()
  const wait = scope.wait(20)
  assert.equal(wait.settled(), false)
  await wait.done
  assert.equal(wait.settled(), true)
})

test('cancel() 让挂起的等待以 CanceledWaitError 结束，重复取消安全', async () => {
  const scope = createTimerScope()
  const wait = scope.wait(60_000)
  wait.cancel()
  await assert.rejects(() => wait.done, CanceledWaitError)
  assert.equal(wait.settled(), true)
  wait.cancel() // 幂等：不应抛错
})

test('cancelAll() 取消域内全部等待并返回数量', async () => {
  const scope = createTimerScope()
  const first = scope.wait(60_000)
  const second = scope.wait(60_000)
  assert.equal(scope.cancelAll(), 2)
  await assert.rejects(() => first.done, CanceledWaitError)
  await assert.rejects(() => second.done, CanceledWaitError)
  // 已到期/已取消的等待不应被重复统计。
  assert.equal(scope.cancelAll(), 0)
})

test('等待不阻止进程退出：12 秒等待下子进程仍在 1 秒内退出（unref 契约）', async () => {
  const source = [
    `import { createTimerScope } from ${JSON.stringify(moduleUrl)}`,
    'const scope = createTimerScope()',
    // 复刻内核停机语义：只置退出码，不调用 process.exit()；
    // 若定时器未 unref，进程将被迫存活 12 秒，等不到 1 秒就退出这一步就会失败。
    'void scope.wait(12_000).done.catch(() => {})',
    'process.exitCode = 0',
  ].join('\n')
  const started = Date.now()
  const child = spawn(process.execPath, ['--experimental-strip-types', '--input-type=module', '--eval', source], {
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  let stderr = ''
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString()
  })
  const code = await new Promise<number | null>((resolve) => child.on('close', resolve))
  const elapsed = Date.now() - started
  assert.equal(code, 0, `子进程应正常退出，stderr=${stderr}`)
  assert.ok(
    elapsed < 1_000,
    `unref 后等待不得阻止退出：实测 ${elapsed}ms（若未 unref 会接近 12000ms）`,
  )
})

test('对照：未 unref 的等长等待会把进程拖住（证明该用例有区分度）', async () => {
  const source = [
    'const timer = setTimeout(() => {}, 12_000)',
    // 故意不 unref：这是修复前的行为，进程只能等定时器到点。
    'void timer',
    'process.exitCode = 0',
  ].join('\n')
  const started = Date.now()
  const child = spawn(process.execPath, ['--eval', source], { stdio: ['ignore', 'ignore', 'ignore'] })
  await new Promise<void>((resolve) => child.on('close', () => resolve()))
  const elapsed = Date.now() - started
  assert.ok(
    elapsed >= 10_000,
    `对照组应被拖住 ≥10 秒（越过桌面端窗口），实测 ${elapsed}ms；若这里变快说明用例失效`,
  )
  assert.ok(elapsed < 20_000, `对照组应在定时器到点后退出，实测 ${elapsed}ms`)
})
