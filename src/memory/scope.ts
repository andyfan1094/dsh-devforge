/**
 * 记忆作用域解析：只信任宿主会话 cwd 和项目登记表，不接受模型自报 projectId。
 * 作用域是召回前的硬过滤条件；登记项目按最长路径命中，避免嵌套仓库误归属父项目。
 */
import { resolve } from 'node:path'
import type { ProjectEntry } from '../projects/protocol.ts'
import type { MemoryScopeContext, NativeMemoryEntry } from './protocol.ts'

/** 统一路径比较格式；Windows 大小写不敏感，Unix 保留原始大小写。 */
function normalizePath(value: string): string {
  const normalized = resolve(value).replace(/\\/gu, '/').replace(/\/+$/gu, '')
  return /^[A-Za-z]:\//u.test(normalized) ? normalized.toLocaleLowerCase() : normalized
}

/** 根据可信 cwd 解析稳定项目作用域；未知 cwd 返回 workspace，绝不猜成 global。 */
export function resolveMemoryScope(cwd: string | undefined, projects: readonly ProjectEntry[]): MemoryScopeContext {
  if (typeof cwd !== 'string' || cwd.trim() === '') return { kind: 'workspace' }
  const target = normalizePath(cwd)
  let best: { entry: ProjectEntry; path: string } | undefined
  for (const entry of projects) {
    const paths = [entry.path, ...Object.values(entry.machinePaths ?? {})]
    for (const raw of paths) {
      if (typeof raw !== 'string' || raw.trim() === '') continue
      const base = normalizePath(raw)
      if (target !== base && !target.startsWith(base + '/')) continue
      if (best === undefined || base.length > best.path.length) best = { entry, path: base }
    }
  }
  if (best !== undefined) return { kind: 'project', id: best.entry.id, label: best.entry.name }
  return { kind: 'workspace', id: target, label: target.split('/').pop() ?? target }
}

/** 判断条目是否允许进入当前会话召回。全局记忆始终可见，项目/工作区必须精确匹配。 */
export function memoryScopeMatches(entry: NativeMemoryEntry, current: MemoryScopeContext, isolate: boolean): boolean {
  if (!isolate) return true
  if (entry.scope.kind === 'global') return true
  if (entry.scope.kind !== current.kind) return false
  return entry.scope.id !== undefined && entry.scope.id === current.id
}

/** 面板与日志使用的短标签，不泄露未登记工作区完整路径。 */
export function memoryScopeLabel(scope: MemoryScopeContext): string {
  if (scope.kind === 'global') return '全局'
  if (scope.kind === 'project') return '项目：' + (scope.label ?? scope.id ?? '未知')
  return '工作区：' + (scope.label ?? '未登记')
}
