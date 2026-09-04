/**
 * 项目发现测试：目录扫描（两层下钻、隐藏与依赖目录排除、已登记标记）、
 * 跨机自动匹配（名称粗配 + 远端强校验）与描述提取（package.json / README）。
 * 使用独立临时目录（DSH_HOME 覆盖），不触碰生产 ~/.dsh。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SAVED_HOME = process.env.DSH_HOME
const home = mkdtempSync(join(tmpdir(), 'projects-scan-'))
process.env.DSH_HOME = home

const { closeDb } = await import('../src/store/db.ts')
const { automatchProjects, describeProject, scanForProjects } = await import('../src/projects/scan.ts')
const { saveProject } = await import('../src/projects/store.ts')

test.after(() => {
  closeDb()
  if (SAVED_HOME === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = SAVED_HOME
  rmSync(home, { recursive: true, force: true })
})

/** 构造一个最小可检测的假 Git 仓库（.git 目录 + HEAD + 可选 config）。 */
function makeGitRepo(dir: string, options?: { remoteUrl?: string; branch?: string }): void {
  mkdirSync(join(dir, '.git'), { recursive: true })
  writeFileSync(join(dir, '.git', 'HEAD'), 'ref: refs/heads/' + (options?.branch ?? 'main') + '\n')
  if (options?.remoteUrl !== undefined) {
    writeFileSync(join(dir, '.git', 'config'), '[remote "origin"]\n\turl = ' + options.remoteUrl + '\n')
  }
}

test('扫描：发现两层仓库，排除隐藏目录与 node_modules，标记已登记', () => {
  const root = mkdtempSync(join(tmpdir(), 'scan-root-'))
  // 一层仓库 + 聚集目录下的二层仓库。
  const repoA = join(root, 'repo-a')
  const repoB = join(root, 'projects', 'repo-b')
  makeGitRepo(repoA, { remoteUrl: 'https://cnb.cool/o/a.git' })
  makeGitRepo(repoB)
  // 应排除项。
  makeGitRepo(join(root, '.hidden-repo'))
  makeGitRepo(join(root, 'node_modules', 'pkg'))
  mkdirSync(join(root, 'plain-dir'))

  const scan = scanForProjects([root])
  const paths = scan.found.map((item) => item.path)
  assert.ok(paths.includes(repoA))
  assert.ok(paths.includes(repoB))
  assert.ok(!paths.some((path) => path.includes('.hidden')))
  assert.ok(!paths.some((path) => path.includes('node_modules')))
  assert.ok(!paths.some((path) => path.includes('plain-dir')))
  // 远端识别进结果。
  const foundA = scan.found.find((item) => item.path === repoA)
  assert.equal(foundA?.detect.remotes[0]?.kind, 'cnb')

  // 登记 repoA 后再扫：标记 registeredId 且默认勾选集合可排除。
  const saved = saveProject({ name: 'repo-a', path: repoA, repoUrl: 'https://cnb.cool/o/a.git' })
  const again = scanForProjects([root])
  assert.equal(again.found.find((item) => item.path === repoA)?.registeredId, saved.id)

  rmSync(root, { recursive: true, force: true })
})

test('自动匹配：失效项目按目录名 + 归一化远端强校验命中候选', () => {
  const root = mkdtempSync(join(tmpdir(), 'match-root-'))
  const candidate = join(root, 'my-app')
  makeGitRepo(candidate, { remoteUrl: 'https://github.com/andyfan1094/my-app.git' })

  // 登记：路径指向已不存在的旧机目录，但 repoUrl 与候选一致。
  const saved = saveProject({ name: 'my-app', path: '/definitely/old/machine/my-app', repoUrl: 'https://github.com/andyfan1094/my-app' })
  const suggestions = automatchProjects([root])
  const hit = suggestions.find((item) => item.id === saved.id)
  assert.equal(hit?.candidatePath, candidate)

  // 远端不一致的不算命中。
  const other = saveProject({ name: 'my-app', path: '/definitely/old/machine/other', repoUrl: 'https://github.com/other/other' })
  assert.equal(suggestions.find((item) => item.id === other.id), undefined)

  rmSync(root, { recursive: true, force: true })
})

test('描述提取：package.json 优先，README 跳过标题与徽标行，异常路径结构化', () => {
  const withPkg = mkdtempSync(join(tmpdir(), 'desc-pkg-'))
  writeFileSync(join(withPkg, 'package.json'), JSON.stringify({ name: 'x', description: '规范驱动天工造梦' }))
  const fromPkg = describeProject(withPkg)
  assert.equal(fromPkg.ok, true)
  assert.equal(fromPkg.source, 'package.json')
  assert.equal(fromPkg.description, '规范驱动天工造梦')

  const withReadme = mkdtempSync(join(tmpdir(), 'desc-readme-'))
  writeFileSync(join(withReadme, 'README.md'), [
    '# 项目标题',
    '',
    '[![badge](https://example.com/badge.svg)](https://example.com)',
    '<p>html 忽略</p>',
    '',
    '这是首个有意义段落，说明项目用途。',
  ].join('\n'))
  const fromReadme = describeProject(withReadme)
  assert.equal(fromReadme.ok, true)
  assert.equal(fromReadme.source, 'README.md')
  assert.equal(fromReadme.description, '这是首个有意义段落，说明项目用途。')

  // 200 字截断。
  const long = mkdtempSync(join(tmpdir(), 'desc-long-'))
  writeFileSync(join(long, 'README.md'), '# t\n' + '长'.repeat(500))
  const truncated = describeProject(long)
  assert.equal(truncated.description?.length, 200)

  // 异常路径结构化返回。
  assert.equal(describeProject('').ok, false)
  assert.equal(describeProject('/definitely/not/exist-xyz').ok, false)
  const empty = mkdtempSync(join(tmpdir(), 'desc-empty-'))
  assert.equal(describeProject(empty).ok, false)

  rmSync(withPkg, { recursive: true, force: true })
  rmSync(withReadme, { recursive: true, force: true })
  rmSync(long, { recursive: true, force: true })
  rmSync(empty, { recursive: true, force: true })
})
