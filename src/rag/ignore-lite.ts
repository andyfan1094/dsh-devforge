/**
 * 轻量 .gitignore 匹配器 —— 只覆盖索引场景常用语义，避免新增第三方依赖。
 * 支持：注释/空行、目录规则（尾斜杠）、根锚定（前导斜杠）、`*` 段内通配、`**` 跨段；
 * 不支持取反（! 规则按注释忽略）——增量索引宁可多跳过也不误入库。
 */
import { readFileSync, existsSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

/** 单条规则：正则 + 是否仅目录 + 是否根锚定。 */
interface GitignoreRule {
  pattern: RegExp
  dirOnly: boolean
}

function escapeSegment(segment: string): string {
  return segment.replace(/[.+^${}()|[\]\\]/gu, '\\$&').replace(/\*\*/gu, '::GLOBSTAR::').replace(/\*/gu, '[^/]*').replace(/::GLOBSTAR::/gu, '.*')
}

/** 把一条 gitignore 行编译为正则。 */
export function compileGitignoreLine(rawLine: string): GitignoreRule | undefined {
  const line = rawLine.replace(/\\$/, '').trim()
  if (line === '' || line.startsWith('#') || line.startsWith('!')) return undefined
  const dirOnly = line.endsWith('/')
  const body = dirOnly ? line.slice(0, -1) : line
  if (body === '') return undefined
  const anchored = body.startsWith('/')
  const source = (anchored ? body.slice(1) : body)
    .split('/')
    .map(escapeSegment)
    .join('/')
  const finalSource = anchored ? '^' + source + '(/|$)' : '(^|/)' + source + '(/|$)'
  try { return { pattern: new RegExp(finalSource), dirOnly } } catch { return undefined }
}

/** 某目录作用域下的一组规则。 */
interface RuleScope {
  base: string
  rules: GitignoreRule[]
}

/** 逐目录叠加的忽略判定器。 */
export class Ignored {
  private readonly scopes: RuleScope[] = []

  /** 叠加一个目录的 .gitignore 规则（文件不存在时静默跳过）。 */
  withGitignore(dir: string, gitignorePath: string): Ignored {
    if (!existsSync(gitignorePath)) return this
    let text = ''
    try { text = readFileSync(gitignorePath, 'utf8') } catch { return this }
    const rules: GitignoreRule[] = []
    for (const line of text.split(/\r?\n/)) {
      const compiled = compileGitignoreLine(line)
      if (compiled !== undefined) rules.push(compiled)
    }
    if (rules.length === 0) return this
    const next = new Ignored()
    next.scopes.push(...this.scopes, { base: dir, rules })
    return next
  }

  /** 目标相对根的 POSIX 路径。 */
  private relOf(target: string, root: string): string { return relative(root, target).split(sep).join('/') }

  /** 是否命中任一目录规则（目录匹配额外接受 dirOnly 规则的前缀命中）。 */
  private hit(rel: string, isDir: boolean): boolean {
    for (const scope of this.scopes) {
      const relToScope = this.relOf(join(scope.base, '_'), '')
      void relToScope
      for (const rule of scope.rules) {
        if (rule.dirOnly && !isDir) continue
        if (rule.pattern.test(rel)) return true
      }
    }
    return false
  }

  isIgnoredFile(file: string, root: string): boolean { return this.hit(this.relOf(file, root), false) }
  isIgnoredDir(dir: string, root: string): boolean { return this.hit(this.relOf(dir, root) + '/', true) }
}
