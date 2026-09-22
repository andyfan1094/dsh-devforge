/**
 * 项目事实与自动登记测试（0.34.18）：
 * - facts 载荷校验、追加去重、上限裁剪、删除；
 * - 自动登记：项目标志目录自动补登记、无标志跳过、已登记幂等、进程内探测缓存。
 * 使用独立临时目录（DSH_HOME 覆盖），不触碰生产 ~/.dsh。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SAVED_HOME = process.env.DSH_HOME
const home = mkdtempSync(join(tmpdir(), 'projects-facts-'))
process.env.DSH_HOME = home

const { closeDb, getDb } = await import('../src/store/db.ts')
const { appendProjectFact, listProjects, removeProject, removeProjectFact, saveProject, validateProjectPayload } = await import('../src/projects/store.ts')
const { autoRegisterProjectAt } = await import('../src/projects/auto-register.ts')

test.after(() => {
  closeDb()
  if (SAVED_HOME === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = SAVED_HOME
  rmSync(home, { recursive: true, force: true })
})

test('facts 载荷校验：形状与来源枚举', () => {
  assert.equal(validateProjectPayload({ name: 'x', path: '/a', facts: 'nope' }), 'facts 必须是数组')
  assert.equal(validateProjectPayload({ name: 'x', path: '/a', facts: [42] }), 'facts 元素必须是对象')
  assert.equal(validateProjectPayload({ name: 'x', path: '/a', facts: [{ text: '', at: 1, source: 'user' }] }), 'facts.text 必须是非空字符串')
  assert.equal(validateProjectPayload({ name: 'x', path: '/a', facts: [{ text: 'a', at: 'x', source: 'user' }] }), 'facts.at 必须是数字时间戳')
  assert.equal(validateProjectPayload({ name: 'x', path: '/a', facts: [{ text: 'a', at: 1, source: 'bot' }] }), 'facts.source 只能是 agent 或 user')
  assert.equal(validateProjectPayload({ name: 'x', path: '/a', facts: [{ text: '数据库在 my 服务器', at: 1, source: 'agent' }] }), undefined)
  assert.equal(validateProjectPayload({ name: 'x', path: '/a', facts: [] }), undefined)
})

test('facts 追加：去重、来源标记、上限保留最新', () => {
  getDb() // 初始化库
  const saved = saveProject({ name: '事实项目', path: '/tmp/facts-project' })
  const first = appendProjectFact(saved.id, '数据库在 my 服务器  /var/lib/mysql', 'agent')
  assert.equal(first.ok, true)
  // 归一化空白后去重：同文本不重复记录。
  const dup = appendProjectFact(saved.id, '数据库在 my 服务器 /var/lib/mysql', 'agent')
  assert.equal(dup.ok, true)
  assert.match(dup.message, /已存在/)
  const user = appendProjectFact(saved.id, '发布走 my 服务器 nginx', 'user')
  assert.equal(user.ok, true)
  const entry = listProjects().find((p) => p.id === saved.id)
  assert.equal(entry?.facts?.length, 2)
  assert.equal(entry?.facts?.[0]?.source, 'agent')
  assert.equal(entry?.facts?.[1]?.source, 'user')
  // 上限裁剪：写入 102 条只留最新 100 条（最早的 2 条被裁掉）。
  for (let i = 0; i < 100; i += 1) appendProjectFact(saved.id, '批量事实 ' + String(i).padStart(3, '0'), 'agent')
  const trimmed = listProjects().find((p) => p.id === saved.id)
  assert.equal(trimmed?.facts?.length, 100)
  assert.equal(trimmed?.facts?.[0]?.text, '批量事实 000')
  assert.equal(trimmed?.facts?.at(-1)?.text, '批量事实 099')
  // 空文本与超长拒绝。
  assert.equal(appendProjectFact(saved.id, '   ', 'agent').ok, false)
  assert.equal(appendProjectFact(saved.id, 'x'.repeat(301), 'agent').ok, false)
})

test('facts 删除：按文本匹配移除', () => {
  const saved = saveProject({ name: '删除事实项目', path: '/tmp/facts-remove' })
  appendProjectFact(saved.id, '测试事实甲', 'user')
  appendProjectFact(saved.id, '测试事实乙', 'user')
  const removed = removeProjectFact(saved.id, '测试事实甲')
  assert.equal(removed.ok, true)
  const entry = listProjects().find((p) => p.id === saved.id)
  assert.deepEqual(entry?.facts?.map((f) => f.text), ['测试事实乙'])
  assert.equal(removeProjectFact(saved.id, '不存在的事实').ok, false)
})

test('自动登记：标志目录补登记、无标志跳过、已登记幂等', () => {
  // 项目目录：有 package.json 标志。
  const projectDir = mkdtempSync(join(tmpdir(), 'auto-reg-'))
  writeFileSync(join(projectDir, 'package.json'), '{"name":"auto-reg"}')
  const result = autoRegisterProjectAt(projectDir)
  assert.equal(result.outcome, 'registered')
  const registered = listProjects().find((entry) => entry.path === projectDir)
  assert.ok(registered !== undefined)
  assert.equal(registered.name, projectDir.split(/[\\/]/u).at(-1))
  // 再次探测：已登记幂等。
  assert.equal(autoRegisterProjectAt(projectDir).outcome, 'already-registered')
  // 自愈：删除登记后再探测，重新自动补登记（有标志目录不进缓存）。
  removeProject(registered.id)
  assert.equal(autoRegisterProjectAt(projectDir).outcome, 'registered')
  // 自愈后重复删除清理。
  const reRegistered = listProjects().find((entry) => entry.path === projectDir)
  if (reRegistered !== undefined) removeProject(reRegistered.id)
  // 无标志目录（新路径未探测过）：跳过并进缓存；同目录第二次探测直接 probed-before。
  const plainDir = mkdtempSync(join(tmpdir(), 'auto-plain-'))
  assert.equal(autoRegisterProjectAt(plainDir).outcome, 'no-marker')
  assert.equal(autoRegisterProjectAt(plainDir).outcome, 'probed-before')
  // 空路径：跳过。
  assert.equal(autoRegisterProjectAt('').outcome, 'skipped-empty')
  rmSync(projectDir, { recursive: true, force: true })
  rmSync(plainDir, { recursive: true, force: true })
})
