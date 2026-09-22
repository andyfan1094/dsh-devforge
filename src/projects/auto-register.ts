/**
 * 项目自动登记 —— 会话落到未登记的项目目录时自动补登记（辉哥 2026-09-21 定稿：
 * 项目系统要自动化，任何用户装上插件即生效，不依赖用户手动登记）。
 *
 * 触发：agent/created + 存量 roots 采纳（仿 ConstraintInjectionService 模式）。
 * 判定：会话 cwd 存在任一项目标志文件（.git/package.json/pyproject.toml 等）才登记，
 * 裸工作区/临时目录天然跳过；已登记路径幂等跳过；进程内已探测过的路径不再重复 stat。
 * 登记：复用 registerProjectFromPath（自动检测 Git 远端/分支/托管类型，同路径幂等更新）。
 * 全程静默：失败只留调试日志，绝不阻塞会话。
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { resolveAgentCwd } from '../constraints.ts'
import { listProjects, registerProjectFromPath } from './store.ts'

/** 项目标志文件：任一存在即视为项目目录（.git 是最强信号）。 */
const PROJECT_MARKERS = ['.git', 'package.json', 'pyproject.toml', 'go.mod', 'Cargo.toml', 'pom.xml', 'build.gradle', 'composer.json', 'requirements.txt', 'Cargo.lock', 'poetry.lock']

/** 进程内已探测路径（含未登记的）：避免每次开代理都重复 stat 同一目录。 */
const probed = new Set<string>()

/** 探测缓存上限：超限整体清空（极端场景下重新探测一次无副作用）。 */
const PROBED_LIMIT = 512

/** 探测结果（自检与测试用）。 */
export interface AutoRegisterResult {
  cwd: string
  outcome: 'skipped-empty' | 'probed-before' | 'no-marker' | 'already-registered' | 'registered' | 'register-failed' | 'error'
  message?: string
}

/**
 * 按会话 cwd 自动登记项目（幂等、静默）。
 * 单独导出便于测试；agent/created 监听只做解包与 try/catch。
 */
export function autoRegisterProjectAt(cwd: string | undefined): AutoRegisterResult {
  const dir = typeof cwd === 'string' && cwd.trim() !== '' ? cwd.trim() : ''
  if (dir === '') return { cwd: '', outcome: 'skipped-empty' }
  try {
    // 已登记优先检查（自愈友好）：用户手动删除登记后，下次会话仍能自动补登记。
    if (listProjects().some((entry) => entry.path === dir)) return { cwd: dir, outcome: 'already-registered' }
    // 进程内探测缓存：无项目标志的目录不反复 stat（有标志的目录不会进缓存）。
    if (probed.has(dir)) return { cwd: dir, outcome: 'probed-before' }
    if (probed.size >= PROBED_LIMIT) probed.clear()
    probed.add(dir)
    if (!existsSync(dir)) return { cwd: dir, outcome: 'no-marker' }
    const hasMarker = PROJECT_MARKERS.some((marker) => {
      try { return existsSync(join(dir, marker)) } catch { return false }
    })
    if (!hasMarker) return { cwd: dir, outcome: 'no-marker' }
    // 有标志目录不进缓存：登记表已保证幂等，删除登记后下次会话可自愈补登记。
    probed.delete(dir)
    const result = registerProjectFromPath({ path: dir })
    return { cwd: dir, outcome: result.ok ? 'registered' : 'register-failed', message: result.message }
  } catch (error) {
    return { cwd: dir, outcome: 'error', message: error instanceof Error ? error.message : String(error) }
  }
}

/** 从 agent 形状解包 cwd 并自动登记（事件监听用；任何异常吞掉）。 */
export function autoRegisterFromAgent(agent: unknown): AutoRegisterResult | undefined {
  try {
    if (agent === null || typeof agent !== 'object') return undefined
    const session = (agent as { session?: unknown }).session
    return autoRegisterProjectAt(resolveAgentCwd(session))
  } catch {
    return undefined
  }
}

/**
 * 启动自动登记：挂 agent/created + 采纳存量根代理。
 * 返回卸载函数（插件 effect 管理生命周期）。
 */
export function startProjectAutoRegister(ctx: unknown): () => void {
  const holder = ctx as { on?: (event: string, listener: (payload: unknown) => void) => unknown; agents?: { roots?: () => unknown } } | null
  if (holder === null || typeof holder !== 'object') return () => { /* 宿主不可用：无事可卸 */ }
  const disposers: Array<() => void> = []
  try {
    const offCreated = holder.on?.('agent/created', (payload: unknown) => {
      const agent = (payload as { agent?: unknown } | null)?.agent
      autoRegisterFromAgent(agent)
    })
    if (typeof offCreated === 'function') disposers.push(offCreated as () => void)
  } catch { /* 事件不可用时仅靠存量采纳 */ }
  try {
    const roots = holder.agents?.roots?.()
    if (Array.isArray(roots)) for (const agent of roots) autoRegisterFromAgent(agent)
  } catch { /* 注册表不可用时仅靠 agent/created */ }
  return () => { for (const dispose of disposers) { try { dispose() } catch { /* 忽略 */ } } }
}
