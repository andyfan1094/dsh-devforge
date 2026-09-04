/**
 * 产出公约与项目注入测试：默认分类学、载荷校验（projects 一等类别）、
 * 设置回读、注入摘要渲染、locate 自动建目录、audit 散落文件建议、
 * 会话 cwd 匹配登记项目与项目卡渲染。
 * 使用独立临时目录（DSH_HOME 覆盖），不触碰生产 ~/.dsh。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SAVED_HOME = process.env.DSH_HOME
const home = mkdtempSync(join(tmpdir(), 'convention-'))
process.env.DSH_HOME = home

const { closeDb } = await import('../src/store/db.ts')
const { DEFAULT_CONVENTION, auditWorkspace, getConvention, renderConventionSummary, resolveConventionDir, saveConvention, validateConvention } = await import('../src/workspace/convention.ts')
const { matchProjectByCwd, renderProjectCard } = await import('../src/constraints.ts')
const { matchProject } = await import('../src/projects/tools.ts')

test.after(() => {
  closeDb()
  if (SAVED_HOME === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = SAVED_HOME
  rmSync(home, { recursive: true, force: true })
})

test('默认公约：七类目录齐备且 projects 在首位', () => {
  assert.equal(DEFAULT_CONVENTION.enabled, true)
  assert.equal(DEFAULT_CONVENTION.dirs[0]?.kind, 'projects')
  assert.ok(DEFAULT_CONVENTION.dirs.length >= 7)
})

test('校验：projects 不可删、dirname 禁分隔符与隐藏目录、kind 禁重复', () => {
  const noProjects = { enabled: true, dirs: DEFAULT_CONVENTION.dirs.filter((d) => d.kind !== 'projects') }
  assert.ok((validateConvention(noProjects) ?? '').includes('projects'))
  assert.ok((validateConvention({ enabled: true, dirs: [{ kind: 'x', dirname: 'a/b', label: 'x', purpose: '' }] }) ?? '').includes('分隔符'))
  assert.ok((validateConvention({ enabled: true, dirs: [{ kind: 'x', dirname: '.hid', label: 'x', purpose: '' }] }) ?? '').includes('隐藏'))
  assert.ok((validateConvention({ enabled: true, dirs: [
    { kind: 'tmp', dirname: 'tmp', label: '临时', purpose: '' },
    { kind: 'tmp', dirname: 'tmp2', label: '临时2', purpose: '' },
  ] }) ?? '').includes('重复'))
  assert.equal(validateConvention(DEFAULT_CONVENTION), undefined)
})

test('保存回读：getConvention 缺省回默认，saveConvention 后读回一致', () => {
  assert.equal(getConvention().dirs.length, DEFAULT_CONVENTION.dirs.length)
  const modified = { enabled: false, dirs: [{ kind: 'projects', dirname: 'projects', label: '项目', purpose: '项目仓库' }] }
  const saved = saveConvention(modified)
  assert.equal(saved.enabled, false)
  const readBack = getConvention()
  assert.equal(readBack.enabled, false)
  assert.equal(readBack.dirs.length, 1)
  // 恢复默认，避免影响其他用例。
  saveConvention(DEFAULT_CONVENTION)
})

test('注入摘要：启用时含目录清单与工具指引，停用返回空串', () => {
  const summary = renderConventionSummary(DEFAULT_CONVENTION)
  assert.ok(summary.includes('产出公约'))
  assert.ok(summary.includes('projects/'))
  assert.ok(summary.includes('devforge_workspace'))
  assert.equal(renderConventionSummary({ enabled: false, dirs: DEFAULT_CONVENTION.dirs }), '')
})

test('locate：返回类别目录并在缺失时自动创建', () => {
  const root = mkdtempSync(join(tmpdir(), 'locate-root-'))
  const scripts = resolveConventionDir(root, 'scripts')
  assert.equal(scripts, join(root, 'scripts'))
  assert.ok(existsSync(scripts ?? ''))
  assert.equal(resolveConventionDir(root, 'no-such-kind'), undefined)
  rmSync(root, { recursive: true, force: true })
})

test('audit：散落文件按扩展名建议归类，目录与隐藏项跳过，未匹配不列', () => {
  const root = mkdtempSync(join(tmpdir(), 'audit-root-'))
  mkdirSync(join(root, 'scripts'))
  writeFileSync(join(root, 'v4_decode.py'), '')
  writeFileSync(join(root, 'cover.png'), '')
  writeFileSync(join(root, '.hidden.sh'), '')
  mkdirSync(join(root, 'some-dir'))
  writeFileSync(join(root, 'random.xyz'), '')

  const suggestions = auditWorkspace(root)
  const byName = new Map(suggestions.map((item) => [item.name, item]))
  assert.equal(byName.get('v4_decode.py')?.suggestedKind, 'scripts')
  assert.equal(byName.get('cover.png')?.suggestedKind, 'outputs')
  assert.equal(byName.has('.hidden.sh'), false)
  assert.equal(byName.has('some-dir'), false)
  assert.equal(byName.has('random.xyz'), false)
  // 建议目标在公约目录下。
  assert.equal(byName.get('v4_decode.py')?.targetPath, join(root, 'scripts'))
  rmSync(root, { recursive: true, force: true })
})

test('项目匹配：cwd 等于或位于项目路径（含 machinePaths 映射）之下时命中', () => {
  const entry = {
    id: 'p1',
    name: '甲',
    path: '/repo/current',
    machinePaths: { 'old-machine': '/Users/old/repo' },
    description: '',
    repoKind: 'none' as const,
    repoUrl: '',
    repoBranch: '',
    siteUrl: '',
    deployTargets: [],
    createdAt: 0,
    updatedAt: 0,
  }
  assert.equal(matchProjectByCwd('/repo/current/src/a.ts', [entry])?.id, 'p1')
  assert.equal(matchProjectByCwd('/repo/current', [entry])?.id, 'p1')
  // 旧机映射同样命中（跨机会话回看旧路径场景）。
  assert.equal(matchProjectByCwd('/Users/old/repo/sub', [entry])?.id, 'p1')
  assert.equal(matchProjectByCwd('/repo/other', [entry]), undefined)
  assert.equal(matchProjectByCwd(undefined, [entry]), undefined)
  // 前缀串不能误命中：/repo/current-x 不是 /repo/current 之下。
  assert.equal(matchProjectByCwd('/repo/current-x', [entry]), undefined)
})

test('项目卡渲染：含名称/描述/仓库/发布目标，失效路径有警示', () => {
  const card = renderProjectCard({
    id: 'p1',
    name: '天工造梦',
    path: '/repo',
    machinePaths: {},
    description: '规范驱动',
    repoKind: 'cnb',
    repoUrl: 'https://cnb.cool/o/r',
    repoBranch: 'main',
    siteUrl: '',
    deployTargets: [{ transport: 'ssh', alias: 'my' }],
    createdAt: 0,
    updatedAt: 0,
    pathExists: false,
  })
  assert.ok(card.includes('【当前项目'))
  assert.ok(card.includes('天工造梦'))
  assert.ok(card.includes('cnb https://cnb.cool/o/r · main'))
  assert.ok(card.includes('ssh:my'))
  assert.ok(card.includes('⚠️'))
})

test('devforge_project 关键词匹配：名称精确 > 包含 > 路径 > 仓库地址', () => {
  const a = { ...DEFAULT_CONVENTION, dirs: [] as never[] }
  void a
  const mk = (over: Partial<Parameters<typeof matchProject>[0][number]>): Parameters<typeof matchProject>[0][number] => ({
    id: 'x', name: '', path: '', machinePaths: {}, description: '', repoKind: 'none', repoUrl: '', repoBranch: '', siteUrl: '', deployTargets: [], createdAt: 0, updatedAt: 0, ...over,
  })
  const entries = [
    mk({ id: 'a', name: '天工造梦', path: '/ds/dsh-devforge', repoUrl: 'https://cnb.cool/o/r1' }),
    mk({ id: 'b', name: 'Sub2API', path: '/ds/sub2api-src', repoUrl: 'https://github.com/o/r2' }),
  ]
  assert.equal(matchProject(entries, '天工造梦')?.id, 'a')
  assert.equal(matchProject(entries, '天工')?.id, 'a')
  assert.equal(matchProject(entries, 'sub2api-src')?.id, 'b')
  assert.equal(matchProject(entries, 'github.com')?.id, 'b')
  assert.equal(matchProject(entries, ''), undefined)
})
