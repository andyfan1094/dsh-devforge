/**
 * 产出公约二级形态桶测试（0.61.0 新增能力）。
 *
 * 需求（辉哥 2026-10-19 定）：outputs 的约束太粗（只有一句「交付物：图、文档、报告」），
 * 导致交付物、验收截图、设计稿、客户端包全平铺在一级目录里散落难管。
 * 本文件覆盖新增能力：
 * - outputs 默认分类学带五个形态桶 + 命名硬约束 + 归档规则；
 * - computeConventionPath 纯计算「项目优先」两级落位（不建目录）；
 * - resolveConventionTarget 在建目录前完成项目段安全校验（防目录穿越）；
 * - auditOutputsLayout 对 outputs 内部做秩序体检（结构合规判定 + 落位建议）。
 * 使用独立临时目录（DSH_HOME 覆盖），不触碰生产 ~/.dsh 与真实 outputs。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SAVED_HOME = process.env.DSH_HOME
const home = mkdtempSync(join(tmpdir(), 'outputs-layout-'))
process.env.DSH_HOME = home

const {
  DEFAULT_CONVENTION,
  GENERIC_PROJECT_DIRNAME,
  ARCHIVE_PROJECT_DIRNAME,
  auditOutputsLayout,
  computeConventionPath,
  isValidProjectSegment,
  matchSubdirByExtension,
  renderConventionSummary,
  resolveConventionTarget,
  validateConvention,
} = await import('../src/workspace/convention.ts')
const { closeDb } = await import('../src/store/db.ts')

test.after(() => {
  closeDb()
  if (SAVED_HOME === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = SAVED_HOME
  rmSync(home, { recursive: true, force: true })
})

/** 取 outputs 类别定义。 */
function outputsDir() {
  const dir = DEFAULT_CONVENTION.dirs.find((item) => item.kind === 'outputs')
  assert.ok(dir !== undefined, '默认公约必须含 outputs 类别')
  return dir
}

test('默认分类学：outputs 带五个形态桶与命名硬约束', () => {
  const dir = outputsDir()
  assert.ok(Array.isArray(dir.subdirs), 'outputs 必须定义二级形态桶')
  const dirnames = (dir.subdirs ?? []).map((item) => item.dirname)
  assert.deepEqual(dirnames, ['交付包', '截图', '设计稿', '文档', '数据'])
  // 命名硬约束三要素必须落在配置里（注入摘要据此渲染）。
  assert.ok((dir.naming ?? '').includes('YYYYMMDD'), '命名范式须含日期要素')
  assert.ok((dir.naming ?? '').includes('主题'), '命名范式须含主题要素')
  assert.ok((dir.naming ?? '').includes('状态'), '命名范式须含状态要素')
  assert.ok((dir.naming ?? '').includes('草稿'), '命名范式须声明状态取值')
  // 归档规则必须显式声明 _通用 与 _归档 两个保留一级目录。
  const rules = (dir.rules ?? []).join('\n')
  assert.ok(rules.includes(GENERIC_PROJECT_DIRNAME), '规则须声明 _通用 保留目录')
  assert.ok(rules.includes(ARCHIVE_PROJECT_DIRNAME), '规则须声明 _归档 保留目录')
})

test('形态桶扩展名判据：截图/交付包/设计稿/文档/数据各归其位', () => {
  const dir = outputsDir()
  assert.equal(matchSubdirByExtension(dir, 'a.png')?.key, 'screenshots')
  assert.equal(matchSubdirByExtension(dir, 'a.ZIP')?.key, 'packages')
  assert.equal(matchSubdirByExtension(dir, 'a.html')?.key, 'mockups')
  assert.equal(matchSubdirByExtension(dir, 'a.docx')?.key, 'docs')
  assert.equal(matchSubdirByExtension(dir, 'a.xlsx')?.key, 'data')
  assert.equal(matchSubdirByExtension(dir, 'a.unknown'), undefined)
})

test('校验：形态桶重复键、目录名带分隔符或隐藏目录一律拒绝', () => {
  const base = { kind: 'x', dirname: 'x', label: 'x', purpose: '' }
  const dupSub = { ...base, subdirs: [
    { key: 's', dirname: '甲', label: '甲', purpose: '' },
    { key: 's', dirname: '乙', label: '乙', purpose: '' },
  ] }
  assert.ok((validateConvention({ enabled: true, dirs: [keepProjects(), dupSub] }) ?? '').includes('形态桶'))
  const sepSub = { ...base, subdirs: [{ key: 's', dirname: 'a/b', label: '甲', purpose: '' }] }
  assert.ok((validateConvention({ enabled: true, dirs: [keepProjects(), sepSub] }) ?? '').includes('分隔符'))
  const hidSub = { ...base, subdirs: [{ key: 's', dirname: '.hide', label: '甲', purpose: '' }] }
  assert.ok((validateConvention({ enabled: true, dirs: [keepProjects(), hidSub] }) ?? '').includes('隐藏'))
  // 默认分类学自身必须通过校验。
  assert.equal(validateConvention(DEFAULT_CONVENTION), undefined)
})

/** 校验用例需要一个 projects 一等类别占位。 */
function keepProjects() {
  return { kind: 'projects', dirname: 'projects', label: '项目目录', purpose: '仓库' }
}

test('computeConventionPath：项目优先两级路径纯计算，不建目录', () => {
  const root = mkdtempSync(join(tmpdir(), 'calc-root-'))
  const placed = computeConventionPath(root, 'outputs', { project: '天工造梦', sub: 'screenshots' })
  assert.equal(placed?.path, join(root, 'outputs', '天工造梦', '截图'))
  // 纯计算：不创建任何目录。
  assert.equal(existsSync(join(root, 'outputs')), false)
  // 未给项目时落到 _通用 一级。
  const generic = computeConventionPath(root, 'outputs', { sub: 'docs' })
  assert.equal(generic?.path, join(root, 'outputs', GENERIC_PROJECT_DIRNAME, '文档'))
  // 未给 sub 时退回类别目录本身（向后兼容旧行为）。
  assert.equal(computeConventionPath(root, 'outputs')?.path, join(root, 'outputs'))
  // 未登记桶键拒绝（交由调用方报可用桶）。
  assert.equal(computeConventionPath(root, 'outputs', { sub: 'no-such-bucket' }), undefined)
  rmSync(root, { recursive: true, force: true })
})

test('resolveConventionTarget：合法项目段建目录，非法项目段拒绝且不落盘', () => {
  const root = mkdtempSync(join(tmpdir(), 'target-root-'))
  const target = resolveConventionTarget(root, 'outputs', { project: '波斯通', sub: 'packages' })
  assert.equal(target?.path, join(root, 'outputs', '波斯通', '交付包'))
  assert.ok(existsSync(target?.path ?? ''), 'locate 语义应自动创建目录')
  // 目录穿越与非法段必须拒绝，且不得把任何东西建到 root 之外。
  const escape = resolveConventionTarget(root, 'outputs', { project: '..', sub: 'packages' })
  assert.equal(escape, undefined)
  const slash = resolveConventionTarget(root, 'outputs', { project: 'a/b', sub: 'packages' })
  assert.equal(slash, undefined)
  rmSync(root, { recursive: true, force: true })
})

test('项目段校验：拒绝穿越、隐藏、保留字符与 Windows 设备名', () => {
  assert.equal(isValidProjectSegment('天工造梦'), true)
  assert.equal(isValidProjectSegment(GENERIC_PROJECT_DIRNAME), true)
  assert.equal(isValidProjectSegment('..'), false)
  assert.equal(isValidProjectSegment('.'), false)
  assert.equal(isValidProjectSegment('.hidden'), false)
  assert.equal(isValidProjectSegment('a/b'), false)
  assert.equal(isValidProjectSegment('a\\b'), false)
  assert.equal(isValidProjectSegment('a:b'), false)
  assert.equal(isValidProjectSegment('nul'), false)
  assert.equal(isValidProjectSegment('com1'), false)
  assert.equal(isValidProjectSegment('trail.'), false)
  assert.equal(isValidProjectSegment(''), false)
})

test('注入摘要：含二级布局、形态桶、命名硬约束与归档规则', () => {
  const summary = renderConventionSummary(DEFAULT_CONVENTION)
  assert.ok(summary.includes('outputs/<项目>/<形态桶>'), '摘要须给出项目优先两级布局')
  assert.ok(summary.includes('交付包'), '摘要须列出形态桶')
  assert.ok(summary.includes('截图'))
  assert.ok(summary.includes('YYYYMMDD'), '摘要须含命名硬约束')
  assert.ok(summary.includes(GENERIC_PROJECT_DIRNAME), '摘要须含 _通用 落位规则')
  assert.ok(summary.includes(ARCHIVE_PROJECT_DIRNAME), '摘要须含 _归档 落位规则')
})

test('auditOutputsLayout：识别 outputs 根散落与项目下未入桶文件', () => {
  const root = mkdtempSync(join(tmpdir(), 'outputs-audit-'))
  const out = join(root, 'outputs')
  mkdirSync(out)
  // 1) 堆在 outputs 根下的散落文件 → 应建议落桶。
  writeFileSync(join(out, '散落截图.png'), '')
  // 2) 项目一级下未入桶的文件 → 应建议落桶。
  mkdirSync(join(out, '天工造梦'))
  writeFileSync(join(out, '天工造梦', '报告.md'), '')
  // 3) 已按 <项目>/<桶> 就位 → 合规，不应进建议。
  mkdirSync(join(out, '天工造梦', '截图'))
  writeFileSync(join(out, '天工造梦', '截图', 'ok.png'), '')
  // 4) 归档区不体检。
  mkdirSync(join(out, ARCHIVE_PROJECT_DIRNAME))
  writeFileSync(join(out, ARCHIVE_PROJECT_DIRNAME, 'old.png'), '')

  const report = auditOutputsLayout(root, DEFAULT_CONVENTION)
  assert.equal(report.exists, true)
  assert.equal(report.placedCount, 1)
  assert.equal(report.looseFileCount, 1)
  assert.equal(report.totalMisplaced, 2)
  const byRel = new Map(report.entries.map((item) => [item.relPath, item]))
  assert.equal(byRel.get('散落截图.png')?.suggestedRelPath, GENERIC_PROJECT_DIRNAME + '/截图/散落截图.png')
  assert.equal(byRel.get('天工造梦/报告.md')?.suggestedRelPath, '天工造梦/文档/报告.md')
  // 体检不得创建或移动任何文件。
  assert.equal(existsSync(join(out, GENERIC_PROJECT_DIRNAME)), false)
  rmSync(root, { recursive: true, force: true })
})

test('auditOutputsLayout：outputs 不存在时如实返回 exists=false', () => {
  const root = mkdtempSync(join(tmpdir(), 'outputs-missing-'))
  const report = auditOutputsLayout(root, DEFAULT_CONVENTION)
  assert.equal(report.exists, false)
  assert.equal(report.totalMisplaced, 0)
  assert.deepEqual(report.entries, [])
  rmSync(root, { recursive: true, force: true })
})
