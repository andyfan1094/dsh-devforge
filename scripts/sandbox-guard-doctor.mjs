#!/usr/bin/env node
/**
 * 沙箱提权参数清洗 · 一键自检（dsh-devforge 0.33.1+）
 *
 * 背景：0.33.0 的清洗钩子曾因 "resolve 解构调用丢 this" 静默失效 ——
 * 表面无异常、日志无记录，一个参数都没剥，现象与未修复完全一致。
 * 所以自检必须回答三个问题，缺一不可：
 *   1) 运行中的实例装的是哪个版本？钩子标记在不在？
 *   2) 各个 profile 里安装的包，版本与钩子标记是否一致？
 *   3) 宿主日志里到底有没有"剥离线"这个反面证据？
 *
 * 用法：node scripts/sandbox-guard-doctor.mjs
 * 退出码：0 = 正常；1 = 发现问题（详见输出结论）
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import http from 'node:http'

const HOME = homedir()
const PROBLEMS = []
const NOTICES = []

const c = {
  reset: '\u001b[0m', dim: '\u001b[2m', red: '\u001b[31m',
  green: '\u001b[32m', yellow: '\u001b[33m', bold: '\u001b[1m',
}
const head = (text) => console.log(`\n${c.bold}${text}${c.reset}`)
const ok = (text) => console.log(`  ${c.green}✓${c.reset} ${text}`)
const bad = (text) => { PROBLEMS.push(text); console.log(`  ${c.red}✗${c.reset} ${text}`) }
const warn = (text) => { NOTICES.push(text); console.log(`  ${c.yellow}!${c.reset} ${text}`) }
const info = (text) => console.log(`  ${c.dim}·${c.reset} ${text}`)

/** 读取运行中实例报告的版本（失败返回 undefined）。 */
function runtimeVersion() {
  return new Promise((resolve) => {
    const request = http.get(
      { host: '127.0.0.1', port: 3080, path: '/api/dsh-devforge/meta', timeout: 3000 },
      (response) => {
        let body = ''
        response.on('data', (chunk) => { body += chunk })
        response.on('end', () => {
          try { resolve(JSON.parse(body).version ?? undefined) } catch { resolve(undefined) }
        })
      },
    )
    request.on('timeout', () => { request.destroy(); resolve(undefined) })
    request.on('error', () => resolve(undefined))
  })
}

/** 检查一个已安装的 dsh-devforge 包：版本 + 钩子标记。 */
function inspectPackage(dir) {
  const manifest = join(dir, 'package.json')
  const bundle = join(dir, 'lib', 'index.js')
  const report = { dir, version: '(未知)', hasBundle: existsSync(bundle), hasGuard: false, hasResolver: false, hasKeepTrace: false }
  try { report.version = JSON.parse(readFileSync(manifest, 'utf8')).version ?? '(未知)' } catch { /* 用默认值 */ }
  if (report.hasBundle) {
    const text = readFileSync(bundle, 'utf8')
    report.hasGuard = text.includes('tools/pre-execute') && text.includes('已剥离非法沙箱提权参数')
    report.hasResolver = text.includes('createEffectiveModeResolver')
    report.hasKeepTrace = text.includes('沙箱提权参数放行')
  }
  return report
}

/** 收集每个 profile 下已安装的 dsh-devforge。 */
function installedPackages() {
  const profilesDir = join(HOME, '.dsh', 'profiles')
  if (!existsSync(profilesDir)) return []
  return readdirSync(profilesDir)
    .map((name) => join(profilesDir, name, 'node_modules', 'dsh-devforge'))
    .filter((dir) => existsSync(dir))
    .map(inspectPackage)
}

/** 读取独立留痕文件：0.33.2 起的第二路证据，独立于宿主日志路由。 */
function scanTrace() {
  const base = process.env.DSH_HOME ?? join(HOME, '.dsh')
  const file = join(base, 'storages', 'dsh-devforge', 'sandbox-guard-trace.jsonl')
  const result = { file, exists: existsSync(file), strips: [], keeps: [] }
  if (!result.exists) return result
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (line.trim().length === 0) continue
    let entry
    try { entry = JSON.parse(line) } catch { continue }
    if (entry && entry.action === 'strip') result.strips.push(entry)
    else if (entry && entry.action === 'keep') result.keeps.push(entry)
  }
  return result
}

/** 从宿主日志里数剥离/放行记录。 */
function scanLog() {
  const candidates = [
    join(HOME, 'logs', 'dsh-web-restart.log'),
    join(HOME, '.dsh', 'logs', 'dsh-web.log'),
  ].filter((path) => existsSync(path))
  const result = { path: candidates[0] ?? '(未找到日志)', strips: [], keeps: [], mtime: undefined }
  if (candidates.length === 0) return result
  // 取最新的那个日志
  const path = candidates.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0]
  result.path = path
  result.mtime = statSync(path).mtime
  const lines = readFileSync(path, 'utf8').split('\n')
  for (const line of lines) {
    if (line.includes('已剥离非法沙箱提权参数')) result.strips.push(line.trim())
    else if (line.includes('沙箱提权参数放行')) result.keeps.push(line.trim())
  }
  return result
}

const runtime = await runtimeVersion()
const packages = installedPackages()
const log = scanLog()
const trace = scanTrace()

head('一、运行中的实例')
if (runtime === undefined) {
  warn('拿不到 127.0.0.1:3080 的版本（实例没起，或不是 web profile）')
} else {
  ok(`运行中版本：${runtime}`)
}

head('二、已安装的包（各个 profile）')
if (packages.length === 0) {
  bad('没有找到任何已安装的 dsh-devforge（profiles 下每个 profile 的 node_modules）')
}
// 只有「版本与运行中实例一致」的 profile 才是当前生效的那份，硬问题只对它报；
// 其余（暂存/历史遗留 profile）只提示，避免把老包误判成故障。
const active = runtime === undefined ? undefined : packages.find((pkg) => pkg.version === runtime)
for (const pkg of packages) {
  const where = pkg.dir.replace(HOME, '~')
  const isActive = active !== undefined && pkg.dir === active.dir
  const marks = [pkg.hasGuard ? '钩子✓' : '钩子✗', pkg.hasResolver ? 'resolver✓' : 'resolver✗', pkg.hasKeepTrace ? '留痕✓' : '留痕✗'].join(' ')
  const label = `${where} → ${pkg.version}  ${marks}${isActive ? '  ← 当前运行' : ''}`
  if (!pkg.hasBundle) {
    if (isActive) bad(`${label}（缺少 lib/index.js：未构建就装了）`)
    else warn(`${label}（缺少 lib/index.js）`)
    continue
  }
  const complete = pkg.hasGuard && pkg.hasResolver && pkg.hasKeepTrace
  if (complete) ok(label)
  else if (isActive) bad(`${label}（0.33.1 起三个标记都应存在）`)
  else warn(`${label}（非当前运行 profile；如需用它起暂存实例，请先升级到 0.33.1+）`)
}

head('三、反面证据（两路交叉验证）')
const showEntry = (entry, action) => {
  const where = action === 'strip' ? `reason=${entry.reason}` : 'keep'
  return `${entry.time} [${entry.tool}] ${where} session=${entry.sessionId ?? '-'} requested=${entry.requestedMode ?? '-'} effective=${entry.effectiveMode ?? 'unknown'}`
}
info(`留痕文件：${trace.file}${trace.exists ? '' : '（尚未生成：还没有带提权字段的调用，或版本早于 0.33.2）'}`)
if (trace.strips.length > 0) {
  ok(`留痕记录：剥离 ${trace.strips.length} 条 —— 这是端到端生效的决定性证据`)
  for (const entry of trace.strips.slice(-3)) console.log(`      ${c.dim}${showEntry(entry, 'strip')}${c.reset}`)
} else if (trace.exists) {
  warn('留痕文件已生成，但还没有剥离记录（尚无必然失败的提权调用发生）')
}
const unknownKeeps = trace.keeps.filter((entry) => entry.effectiveMode === undefined)
if (unknownKeeps.length > 0) {
  warn(`留痕里 ${unknownKeeps.length} 条放行记录缺有效模式（危险信号：保守放行档，检查模式解析）`)
  console.log(`      ${c.dim}${showEntry(unknownKeeps[unknownKeeps.length - 1], 'keep')}${c.reset}`)
} else if (trace.keeps.length > 0) {
  info(`留痕记录：放行 ${trace.keeps.length} 条（模式均可判定，属正常放行）`)
}

info(`宿主日志：${log.path}${log.mtime ? `（最后写入 ${log.mtime.toLocaleString()}）` : ''}`)
if (log.strips.length > 0) {
  ok(`日志里剥离记录 ${log.strips.length} 条，最近 1 条：`)
  console.log(`      ${c.dim}${log.strips[log.strips.length - 1].slice(0, 160)}${c.reset}`)
} else if (trace.strips.length === 0) {
  warn('宿主日志里也没有剥离线 —— 只能说明"还没有带提权字段的调用发生过"，或两路留痕都没生效')
} else {
  warn('留痕文件有记录但宿主日志没有：留痕走的是 console 兜底（ctx.logger 未注入），功能正常')
}
const suspicious = log.keeps.filter((line) => line.includes('effective=unknown') || line.includes('effective=-'))
if (suspicious.length > 0) {
  warn(`日志里 ${suspicious.length} 条"放行且模式未知"记录（危险信号：保守放行档）`)
  console.log(`      ${c.dim}${suspicious[suspicious.length - 1].slice(0, 160)}${c.reset}`)
} else if (log.keeps.length > 0) {
  info(`日志里放行记录 ${log.keeps.length} 条（模式均可解析，属正常放行）`)
}

head('结论')
if (PROBLEMS.length === 0) {
  const evidence = trace.strips.length > 0
    ? `已有 ${trace.strips.length} 条剥离留痕，端到端闭环成立`
    : '尚无剥离留痕，等带提权字段的调用产生一条即可确认端到端生效'
  console.log(`  ${c.green}自检通过${c.reset}：钩子已装载；${evidence}。`)
  if (runtime !== undefined && packages.some((p) => p.hasResolver) && runtime !== undefined) {
    console.log(`  ${c.dim}提示：运行中版本若低于已安装版本，重启后才会加载新代码。${c.reset}`)
  }
  process.exit(0)
}
console.log(`  ${c.red}发现 ${PROBLEMS.length} 个问题${c.reset}：`)
for (const problem of PROBLEMS) console.log(`   - ${problem}`)
console.log(`\n  处置：见 docs/沙箱提权参数清洗排障手册.md 的 §3 三步定位与 §4 根因清单。`)
if (runtime !== undefined) console.log(`  ${c.dim}（运行中版本 ${runtime}：如需加载新装的包，重启 DSH 后复查本自检。）${c.reset}`)
process.exit(1)
