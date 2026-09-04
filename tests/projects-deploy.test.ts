/**
 * 项目一键发布测试：可执行性检查、双通道命令组装（引号转义）、
 * 逐台执行与失败收敛（桩引擎，不触网、不依赖库文件）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildRemoteCommand, checkDeployable, judgeOutcome, runProjectDeploy } from '../src/projects/deploy.ts'
import type { ProjectEntry } from '../src/projects/protocol.ts'

/** 构造登记条目（按需覆盖字段）。 */
function mkEntry(over: Partial<ProjectEntry>): ProjectEntry {
  return {
    id: 'p1', name: '甲项目', path: '/repo/demo', machinePaths: {}, description: '',
    repoKind: 'none', repoUrl: '', repoBranch: '', siteUrl: '', deployTargets: [],
    createdAt: 0, updatedAt: 0, ...over,
  }
}

test('可执行性检查：缺命令、缺目标、路径失效分别给出可读原因', () => {
  assert.ok((checkDeployable(mkEntry({})) ?? '').includes('发布命令'))
  assert.ok((checkDeployable(mkEntry({ deployCommand: 'make deploy' })) ?? '').includes('发布服务器'))
  assert.equal(
    checkDeployable(mkEntry({ deployCommand: 'make deploy', deployTargets: [{ transport: 'ssh', alias: 'my' }], pathExists: false })),
    '本机项目路径失效，请先重定位到本机实际路径。',
  )
  assert.equal(checkDeployable(mkEntry({ deployCommand: 'make deploy', deployTargets: [{ transport: 'ssh', alias: 'my' }] })), undefined)
})

test('命令组装：ssh 走 POSIX 引号转义，winrm 走 PowerShell', () => {
  const entry = mkEntry({ deployCommand: 'make deploy', deployTargets: [{ transport: 'ssh', alias: 'my' }] })
  assert.equal(buildRemoteCommand(entry, 'ssh'), "cd '/repo/demo' && make deploy")
  const tricky = mkEntry({ path: "/repo/it's demo", deployCommand: 'pnpm run deploy' })
  assert.equal(buildRemoteCommand(tricky, 'ssh'), "cd '/repo/it'\\''s demo' && pnpm run deploy")
  assert.equal(buildRemoteCommand(tricky, 'winrm'), "Set-Location -LiteralPath '/repo/it''s demo'; pnpm run deploy")
})

test('逐台执行：单台失败不中断其余，整体结果按台收敛', async () => {
  const entry = mkEntry({
    deployCommand: 'make deploy',
    deployTargets: [
      { transport: 'ssh', alias: 'good' },
      { transport: 'ssh', alias: 'bad-exit' },
      { transport: 'winrm', alias: 'good-win' },
    ],
  })
  const engines = {
    ssh: {
      async exec(alias: string) {
        if (alias === 'bad-exit') return { success: false, exitCode: 2, stdout: '', stderr: 'make: *** deploy failed' }
        return { success: true, exitCode: 0, stdout: 'deployed ok' }
      },
    },
    winrm: {
      async exec() { throw new Error('主机不可达') },
    },
  }
  const result = await runProjectDeploy(entry, engines)
  assert.equal(result.ok, false)
  assert.equal(result.results.length, 3)
  assert.equal(result.results[0]?.ok, true)
  assert.equal(result.results[0]?.output, 'deployed ok')
  assert.equal(result.results[1]?.ok, false)
  assert.ok((result.results[1]?.error ?? '').includes('退出码'))
  assert.equal(result.results[2]?.ok, false)
  assert.equal(result.results[2]?.error, '主机不可达')
})

test('全部成功时整体 ok；通道引擎缺失时该台失败并给出原因', async () => {
  const entry = mkEntry({ deployCommand: 'make deploy', deployTargets: [{ transport: 'ssh', alias: 'a' }] })
  const ok = await runProjectDeploy(entry, { ssh: { async exec() { return { success: true, exitCode: 0, stdout: 'ok' } } } })
  assert.equal(ok.ok, true)
  // winrm 目标但未启用 winrm 引擎 → 该台失败提示。
  const winOnly = mkEntry({ deployCommand: 'make deploy', deployTargets: [{ transport: 'winrm', alias: 'w1' }] })
  const partial = await runProjectDeploy(winOnly, { ssh: { async exec() { return { success: true, exitCode: 0 } } } })
  assert.equal(partial.ok, false)
  assert.ok((partial.results[0]?.error ?? '').includes('不可用'))
  // 双引擎都没有 → 整体报错。
  const none = await runProjectDeploy(winOnly, {})
  assert.equal(none.ok, false)
  assert.ok((none.error ?? '').includes('remote.enabled'))
})

test('remotePath：目标自有路径优先于项目本机路径，缺省回退', () => {
  const entry = mkEntry({
    path: '/local/repo',
    deployCommand: 'make deploy',
    deployTargets: [
      { transport: 'ssh', alias: 'prod', remotePath: '/srv/app' },
      { transport: 'ssh', alias: 'dev' },
    ],
  })
  assert.equal(buildRemoteCommand(entry, 'ssh', '/srv/app'), "cd '/srv/app' && make deploy")
  assert.equal(buildRemoteCommand(entry, 'ssh', undefined), "cd '/local/repo' && make deploy")
})

test('结果判定：退出码缺失不误报成功，超时与引擎错误各归其位', () => {
  assert.equal(judgeOutcome({ exitCode: 0 }).ok, true)
  assert.equal(judgeOutcome({ exitCode: 127 }).ok, false)
  assert.equal(judgeOutcome({ exitCode: null }).ok, false)
  assert.equal(judgeOutcome({ exitCode: null, success: true }).ok, true)
  assert.equal(judgeOutcome({ timedOut: true }).ok, false)
  assert.ok((judgeOutcome({ timedOut: true }).error ?? '').includes('超时'))
  assert.equal(judgeOutcome({ error: 'alias not found' }).ok, false)
  assert.ok((judgeOutcome({ error: 'alias not found' }).error ?? '').includes('alias'))
})
