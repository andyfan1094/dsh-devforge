/**
 * 项目自动探测测试：关键词提取、探测命令组装、nginx/IIS 输出解析、
 * 保守回填（为空且唯一命中才绑定，绝不覆盖手填）。
 * 库操作走独立临时目录（DSH_HOME 覆盖），桩引擎不触网。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SAVED_HOME = process.env.DSH_HOME
const home = mkdtempSync(join(tmpdir(), 'projects-probe-'))
process.env.DSH_HOME = home

const { closeDb, getDb } = await import('../src/store/db.ts')
const { saveProject } = await import('../src/projects/store.ts')
const { buildSshProbeCommand, buildWinrmProbeCommand, parseSshProbeOutput, parseWinrmProbeOutput, projectKeywords, runProjectProbe } = await import('../src/projects/probe.ts')
import type { ProjectEntry } from '../src/projects/protocol.ts'

test.after(() => {
  closeDb()
  if (SAVED_HOME === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = SAVED_HOME
  rmSync(home, { recursive: true, force: true })
})

/** 构造登记条目（按需覆盖字段）。 */
function mkEntry(over: Partial<ProjectEntry>): ProjectEntry {
  return {
    id: 'p1', name: 'modagentai-site', path: 'D:/projects/modagentai-site', machinePaths: {}, description: '',
    repoKind: 'none', repoUrl: '', repoBranch: '', siteUrl: '', deployTargets: [],
    createdAt: 0, updatedAt: 0, ...over,
  }
}

test('关键词提取：目录名与项目名分词、去常见后缀、短词过滤', () => {
  const words = projectKeywords(mkEntry({}))
  assert.ok(words.includes('modagentai'), '应含去后缀核心词 modagentai，实际：' + words.join(','))
  assert.ok(!words.includes('site'), '后缀词 site 不应独立出现')
  assert.ok(projectKeywords(mkEntry({ name: 'ab', path: '/x/ab' })).length === 0, '过短词全滤掉')
})

test('探测命令组装：ssh 带 grep 模式与正则转义，winrm 固定 IIS 清单', () => {
  const cmd = buildSshProbeCommand(['modagentai', 'my.app'])
  assert.ok(cmd.includes('modagentai|my\\.app'), '正则特殊字符须转义：' + cmd)
  assert.ok(cmd.includes('/etc/nginx/sites-enabled'))
  assert.ok(cmd.includes('---DIRS---'))
  assert.ok(buildWinrmProbeCommand().includes('Get-Website'))
})

test('nginx 输出解析：域名/端口/https/root/测试标识/目录服务线索', () => {
  const stdout = [
    '/etc/nginx/sites-enabled/modagentai:5: server_name modagentai.com;',
    '/etc/nginx/sites-enabled/modagentai:6: listen 443 ssl;',
    '/etc/nginx/sites-enabled/modagentai:7: ssl_certificate /etc/letsencrypt/live/modagentai.com/fullchain.pem;',
    '/etc/nginx/sites-enabled/modagentai:8: root /var/www/modagentai;',
    '/etc/nginx/sites-enabled/modagentai-test:3: server_name test.modagentai.com;',
    '/etc/nginx/sites-enabled/modagentai-test:4: listen 8082;',
    '/etc/nginx/sites-enabled/modagentai-test:5: root /var/www/modagentai-test;',
    '---DIRS---',
    '/opt/modagentai-site',
    '---SVC---',
    'modagentai-site.service',
    'nginx.service',
  ].join('\n')
  const hits = parseSshProbeOutput(['modagentai'], stdout)
  const prod = hits.find((hit) => hit.domain === 'modagentai.com')
  assert.ok(prod !== undefined, '正式站命中')
  assert.equal(prod?.siteUrl, 'https://modagentai.com')
  assert.equal(prod?.deployDir, '/var/www/modagentai')
  assert.equal(prod?.testUrl, undefined, '正式站不带测试标识')
  const test = hits.find((hit) => hit.domain === 'test.modagentai.com')
  assert.ok(test !== undefined, '测试站命中')
  assert.equal(test?.testUrl, 'http://test.modagentai.com:8082')
  assert.equal(prod?.serviceName, 'modagentai-site.service', '服务线索并入首个命中')
  assert.ok(prod?.evidence.some((line) => line.includes('server_name')), '证据行保留原文')
})

test('nginx 解析：无关文件不误报，localhost/_ 域名剔除', () => {
  const stdout = [
    '/etc/nginx/sites-enabled/default:2: server_name _;',
    '/etc/nginx/sites-enabled/default:3: root /var/www/html;',
    '/etc/nginx/sites-enabled/other:2: server_name other.example.com;',
    '/etc/nginx/sites-enabled/other:3: root /var/www/other;',
  ].join('\n')
  assert.equal(parseSshProbeOutput(['modagentai'], stdout).length, 0, '关键词不命中则无结果')
})

test('IIS 输出解析：站点名/物理路径命中，绑定抽域名端口，测试标识', () => {
  const stdout = [
    'modagentai|Started|C:\\www\\modagentai|modagentai.com:80:*',
    'modagentai-test|Started|C:\\www\\modagentai_test|test.modagentai.com:8082:*',
    'other-site|Stopped|C:\\www\\other|other.example.com:80:*',
  ].join('\n')
  const hits = parseWinrmProbeOutput(['modagentai'], stdout)
  assert.equal(hits.length, 2)
  const prod = hits.find((hit) => hit.domain === 'modagentai.com')
  assert.equal(prod?.siteUrl, 'http://modagentai.com')
  assert.equal(prod?.deployDir, 'C:\\www\\modagentai')
  const test = hits.find((hit) => hit.domain === 'test.modagentai.com')
  assert.equal(test?.testUrl, 'http://test.modagentai.com:8082')
})

test('保守回填：为空且唯一命中才回填；已有值不覆盖；多候选跳过；发布目标自动绑定', async () => {
  getDb()
  const sshEngine = {
    async exec(alias: string, _command: string) {
      // my2 未部署该项目：只返回服务清单，不返回站点命中（贴近真实镜像环境）
      if (alias === 'my2') {
        return { success: true, exitCode: 0, stdout: '---DIRS---\n---SVC---\nnginx.service\n' }
      }
      return {
        success: true,
        exitCode: 0,
        stdout: [
          '/etc/nginx/sites-enabled/modagentai:1: server_name modagentai.com;',
          '/etc/nginx/sites-enabled/modagentai:2: listen 443 ssl;',
          '/etc/nginx/sites-enabled/modagentai:3: root /var/www/modagentai;',
          '---DIRS---',
          '/opt/modagentai-site',
          '---SVC---',
          'modagentai-site.service',
        ].join('\n'),
      }
    },
  }
  const allHosts = [{ transport: 'ssh' as const, alias: 'my' }, { transport: 'ssh' as const, alias: 'my2' }]

  // 空项目：唯一命中 → 回填 siteUrl + 绑定主机（带远程路径）
  const saved = saveProject({ name: 'modagentai-site', path: 'D:/projects/modagentai-site' })
  const result = await runProjectProbe(saved as ProjectEntry, { ssh: sshEngine }, allHosts)
  assert.equal(result.ok, true)
  assert.equal(result.hits.length, 1)
  assert.ok(result.applied.some((item) => item.includes('线上地址 https://modagentai.com')), '回填线上地址：' + result.applied.join(';'))
  assert.ok(result.applied.some((item) => item.includes('ssh:my')), '自动绑定主机：' + result.applied.join(';'))
  const refreshed = await import('../src/projects/store.ts')
  const entry = refreshed.getProject(saved.id)
  assert.equal(entry?.siteUrl, 'https://modagentai.com')
  assert.equal(entry?.deployTargets[0]?.alias, 'my')
  assert.equal(entry?.deployTargets[0]?.remotePath, '/var/www/modagentai')

  // 已有 siteUrl：不覆盖，skipped 说明
  saveProject({ id: saved.id, siteUrl: 'https://manual.example.com' })
  const again = await runProjectProbe(refreshed.getProject(saved.id)!, { ssh: sshEngine }, allHosts)
  assert.ok(again.applied.every((item) => !item.includes('线上地址')), '不覆盖手填')
  assert.equal(refreshed.getProject(saved.id)?.siteUrl, 'https://manual.example.com')

  // 多候选：不回填
  const multiEngine = {
    async exec() {
      return {
        success: true,
        exitCode: 0,
        stdout: [
          '/etc/nginx/conf.d/a.conf:1: server_name modagentai.com;',
          '/etc/nginx/conf.d/a.conf:2: listen 80;',
          '/etc/nginx/conf.d/b.conf:1: server_name mirror.modagentai.com;',
          '/etc/nginx/conf.d/b.conf:2: listen 80;',
        ].join('\n'),
      }
    },
  }
  const multi = saveProject({ name: 'modagentai-site-2', path: 'D:/projects/modagentai-site-2' })
  const multiResult = await runProjectProbe(multi as ProjectEntry, { ssh: multiEngine }, [{ transport: 'ssh', alias: 'my' }])
  assert.ok(multiResult.skipped.some((item) => item.includes('候选多个')), '多候选跳过：' + multiResult.skipped.join(';'))
  assert.equal(refreshed.getProject(multi.id)?.siteUrl, '', '多候选不写库')
})

test('边界：无关键词、远程未启用、探测失败各自给出可读错误', async () => {
  const blank = await runProjectProbe(mkEntry({ name: 'ab', path: '/x/ab' }), { ssh: { async exec() { return { success: true, exitCode: 0, stdout: '' } } } }, [])
  assert.ok(blank.error?.includes('关键词'))
  const noEngine = await runProjectProbe(mkEntry({}), {}, [])
  assert.ok(noEngine.error?.includes('远程运维未启用'))
  const failHost = await runProjectProbe(mkEntry({ deployTargets: [{ transport: 'ssh', alias: 'bad' }] }), { ssh: { async exec() { return { success: false, exitCode: 255 } } } }, [])
  assert.equal(failHost.ok, true)
  assert.ok(failHost.skipped[0]?.includes('bad'), '失败主机进 skipped：' + failHost.skipped.join(';'))
})
