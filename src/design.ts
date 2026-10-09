/**
 * 设计资产库 —— 从插件 design/ 目录加载"设计方法论与资产"，供 Agent 在
 * 视觉、界面、演示稿类任务里按需检索、读取与注入。
 *
 * 与 StandardsStore 的分工：standards/ 管"怎么写代码"，design/ 管"怎么做好看、
 * 好用、有品味"。两者共用同一注入通道（systemPrompt.section），互不干扰。
 *
 * 资产分层（design/ 下的一级子目录名即资产类型）：
 *   craft/      工艺规则：反 AI 味、UX 定律、排版层级、无障碍、动效纪律……
 *   standards/  外部权威规范：Vercel Web Interface Guidelines 等
 *   skills/     技能：一套可执行的设计工作法（目录 + SKILL.md）
 *   systems/    设计系统：目录 + DESIGN.md（意图）+ tokens.css + design-tokens.json
 *   templates/  渲染模板：原型、演示稿骨架
 *   prompts/    提示词库：可直接复用的提示词片段
 *
 * 边界纪律（与 StandardsStore 一致）：只读 design/ 目录，绝不写文件；
 * 目录缺失、单文件损坏都安静降级，不影响插件其余能力。
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { DesignAssetDetail, DesignAssetKind, DesignAssetSummary } from './protocol.ts'

/** 受支持的资产类型白名单；design/ 下的其他目录一律忽略。 */
export const DESIGN_KINDS: readonly DesignAssetKind[] = ['craft', 'standards', 'skills', 'systems', 'templates', 'prompts']

/** 各类型的主文件名：目录型资产靠它定位入口文档。 */
const KIND_ENTRY_FILE: Record<string, string[]> = {
  // SKILL.src.md 是 impeccable 系列的源文件命名；不识别会导致整目录漏索引。
  skills: ['SKILL.md', 'SKILL.src.md', 'README.md'],
  systems: ['DESIGN.md', 'README.md'],
  templates: ['README.md', 'index.html', 'template.html'],
}

/** 设计系统目录里值得一并带进上下文的附属文件（按重要性排序）。 */
const SYSTEM_SIDECARS = ['tokens.css', 'design-tokens.json', 'USAGE.md']

/** frontmatter 解析结果。 */
interface Frontmatter {
  /** 显式名称（缺省回退到目录名/文件名）。 */
  name?: string
  /** 一句话描述（支持 YAML 块标量）。 */
  description?: string
  /** 触发词：Agent 检索技能的主要线索。 */
  triggers: string[]
  /** 分类（OpenDesign 用 od.category 表达）。 */
  category?: string
  /** 正文（去掉 frontmatter 后的 markdown）。 */
  body: string
}

/**
 * 解析 markdown 头部的 YAML frontmatter（只认本项目资产实际用到的子集）。
 *
 * 支持：`name`、`description`（含 `|` 块标量）、`triggers` 列表、
 * `od.category` 嵌套键。不引入 YAML 依赖——资产字段可控，手写解析更透明。
 * 没有 frontmatter 时把全文当正文，不报错。
 */
export function parseFrontmatter(text: string): Frontmatter {
  const result: Frontmatter = { triggers: [], body: text }
  if (!text.startsWith('---')) return result

  // frontmatter 结束位置：偏移 3 之后的第一个独立 `---` 行
  const endMatch = /\n---\s*\n/.exec(text.slice(3))
  if (endMatch === null) return result
  const head = text.slice(3, 3 + endMatch.index)
  result.body = text.slice(3 + endMatch.index + endMatch[0].length)

  const lines = head.split(/\r?\n/)

  let index = 0
  while (index < lines.length) {
    const line = lines[index] ?? ''
    index += 1
    const match = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line)
    if (match === null) continue
    const key = match[1] ?? ''
    const inline = (match[2] ?? '').trim()

    // 块标量：description: | 后接缩进正文
    if (inline === '|' || inline === '>' || inline === '|-') {
      const block: string[] = []
      while (index < lines.length && (/^\s+\S/.test(lines[index] ?? '') || (lines[index] ?? '').trim() === '')) {
        block.push((lines[index] ?? '').replace(/^\s{2}/, ''))
        index += 1
      }
      const value = block.join('\n').trim()
      if (key === 'description') result.description = value
      continue
    }

    // 列表项：triggers: 后接若干 "- 词"
    if (inline === '') {
      const items: string[] = []
      while (index < lines.length) {
        const next = lines[index] ?? ''
        const item = /^\s+-\s*(.+)$/.exec(next)
        if (item === null) break
        items.push((item[1] ?? '').trim().replace(/^["']|["']$/g, ''))
        index += 1
      }
      if (key === 'triggers') result.triggers = items
      continue
    }

    const value = inline.replace(/^["']|["']$/g, '')
    if (key === 'name') result.name = value
    else if (key === 'description') result.description = value
  }

  // od.category 单独扫一遍（嵌套键，简单匹配即可）
  const category = /^\s+category:\s*(.+)$/m.exec(head)?.[1]?.trim()
  if (category !== undefined && category !== '') result.category = category
  return result
}

/** 从 markdown 里取一级标题；没有则回退到给定默认值。 */
function firstHeading(text: string, fallback: string): string {
  return /^#\s+(.+)$/m.exec(text)?.[1]?.trim() ?? fallback
}

/** 安全读文件；失败返回 undefined（单文件损坏不影响其余资产）。 */
function readTextIfExists(file: string): string | undefined {
  try {
    return readFileSync(file, 'utf8')
  } catch {
    return undefined
  }
}

/** 设计资产库：内存索引 + 按需读正文。 */
export class DesignStore {
  /** 资产根目录（插件包内 design/）。 */
  private readonly root: string
  /** 内存摘要索引（key = 资产 id，如 "craft/anti-ai-slop"）。 */
  private readonly index = new Map<string, DesignAssetSummary>()

  /**
   * @param designDir 插件包内 design/ 目录绝对路径（apply 时传入）。
   */
  constructor(designDir: string) {
    this.root = designDir
    this.reload()
  }

  /** 重新扫描目录构建索引；目录缺失时安静降级为空库。 */
  reload(): void {
    this.index.clear()
    for (const kind of DESIGN_KINDS) {
      const dir = join(this.root, kind)
      let entries: import('node:fs').Dirent[] = []
      try {
        entries = readdirSync(dir, { withFileTypes: true })
      } catch {
        continue // 该类型目录缺失：跳过，其余类型照常加载
      }
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue
        if (entry.isFile() && entry.name.endsWith('.md')) {
          this.addFileAsset(kind, entry.name.slice(0, -3), join(dir, entry.name))
        } else if (entry.isDirectory()) {
          this.addDirAsset(kind, entry.name, join(dir, entry.name))
        }
      }
    }
  }

  /** 登记单文件资产（craft/standards/prompts 形态）。 */
  private addFileAsset(kind: DesignAssetKind, name: string, file: string): void {
    const text = readTextIfExists(file)
    if (text === undefined) return
    const fm = parseFrontmatter(text)
    let bytes = 0
    let updatedAt = 0
    try {
      const stat = statSync(file)
      bytes = stat.size
      updatedAt = stat.mtimeMs
    } catch {
      updatedAt = Date.now()
    }
    this.index.set(kind + '/' + name, {
      id: kind + '/' + name,
      kind,
      name: fm.name ?? firstHeading(text, name),
      description: fm.description ?? '',
      category: fm.category ?? '',
      triggers: fm.triggers,
      bytes,
      updatedAt,
    })
  }

  /** 登记目录型资产（skills/systems/templates 形态，入口文件按 KIND_ENTRY_FILE 探测）。 */
  private addDirAsset(kind: DesignAssetKind, name: string, dir: string): void {
    const candidates = KIND_ENTRY_FILE[kind] ?? ['README.md']
    let entryFile: string | undefined
    for (const candidate of candidates) {
      const file = join(dir, candidate)
      if (readTextIfExists(file) !== undefined) {
        entryFile = file
        break
      }
    }
    if (entryFile === undefined) return // 没有入口文档的目录不构成资产
    const text = readTextIfExists(entryFile) ?? ''
    const fm = parseFrontmatter(text)
    let bytes = 0
    let updatedAt = 0
    try {
      bytes = statSync(entryFile).size
      updatedAt = statSync(entryFile).mtimeMs
    } catch {
      updatedAt = Date.now()
    }
    this.index.set(kind + '/' + name, {
      id: kind + '/' + name,
      kind,
      name: fm.name ?? firstHeading(text, name),
      description: fm.description ?? '',
      category: fm.category ?? '',
      triggers: fm.triggers,
      bytes,
      updatedAt,
    })
  }

  /** 全部资产摘要；可按类型过滤、按关键词过滤，结果按 id 排序。 */
  list(kind?: DesignAssetKind, query?: string): DesignAssetSummary[] {
    const all = [...this.index.values()]
    const filtered = all.filter((asset) => {
      if (kind !== undefined && asset.kind !== kind) return false
      if (query !== undefined && query.trim() !== '' && !matches(asset, query)) return false
      return true
    })
    return filtered.sort((a, b) => a.id.localeCompare(b.id))
  }

  /** 关键词检索（覆盖 id/名称/描述/分类/触发词），按相关度排序后截断。 */
  search(query: string, kind?: DesignAssetKind, limit = 12): DesignAssetSummary[] {
    const hits = this.list(kind, query)
    const scored = hits.map((asset) => ({ asset, score: scoreOf(asset, query) }))
    scored.sort((a, b) => b.score - a.score || a.asset.id.localeCompare(b.asset.id))
    return scored.slice(0, limit).map((row) => row.asset)
  }

  /** 单个资产详情；不存在返回 undefined。设计系统会附带 tokens 等关键文件。 */
  get(id: string): DesignAssetDetail | undefined {
    const summary = this.index.get(id)
    if (summary === undefined) return undefined
    const slash = id.indexOf('/')
    const kind = slash === -1 ? '' : id.slice(0, slash)
    const name = slash === -1 ? id : id.slice(slash + 1)
    const base = join(this.root, kind, name)

    // 单文件资产：正文即该 md 文件
    const flat = readTextIfExists(base + '.md')
    if (flat !== undefined && (KIND_ENTRY_FILE[kind] === undefined)) {
      return { ...summary, content: parseFrontmatter(flat).body }
    }

    // 目录型资产：入口文档 + 关键附属文件
    const candidates = KIND_ENTRY_FILE[kind] ?? ['README.md']
    for (const candidate of candidates) {
      const entry = readTextIfExists(join(base, candidate))
      if (entry === undefined) continue
      const parts = [parseFrontmatter(entry).body.trim()]
      if (kind === 'systems') {
        for (const sidecar of SYSTEM_SIDECARS) {
          const extra = readTextIfExists(join(base, sidecar))
          if (extra !== undefined) parts.push('### ' + sidecar + '\n\n```\n' + extra.trim() + '\n```')
        }
      }
      return { ...summary, content: parts.join('\n\n') }
    }

    // 兜底：单文件形态（含 craft/standards/prompts 之外的自定义类型）
    if (flat !== undefined) return { ...summary, content: parseFrontmatter(flat).body }
    return undefined
  }

  /**
   * 按 id 列表拼合"设计资产包"文本（Agent 上下文注入用）。
   *
   * @param ids 资产 id 列表
   * @param budgetChars 总字符预算（默认 24000，防止撑爆上下文）
   * @param perAssetChars 单篇上限（默认 12000）
   */
  composeForAgent(ids: string[], budgetChars = 24_000, perAssetChars = 12_000): string {
    const parts: string[] = []
    let used = 0
    for (const id of ids) {
      const detail = this.get(id)
      if (detail === undefined) continue
      const chunk = '---\n# 设计资产：' + detail.name + '（' + detail.id + '）\n' + detail.content.slice(0, perAssetChars)
      if (used + chunk.length > budgetChars) break
      parts.push(chunk)
      used += chunk.length
    }
    return parts.join('\n\n')
  }

  /** 资产总览：给 Agent 的"入口目录"，用于判断有哪些能力可查。 */
  catalog(): string {
    const lines: string[] = []
    for (const kind of DESIGN_KINDS) {
      const items = this.list(kind)
      if (items.length === 0) continue
      lines.push('【' + kind + '】共 ' + items.length + ' 项')
      for (const item of items.slice(0, 40)) {
        const brief = item.description !== '' ? ' —— ' + item.description.split('\n')[0]?.slice(0, 80) : ''
        lines.push('  · ' + item.id + '（' + item.name + '）' + brief)
      }
      if (items.length > 40) lines.push('  · …其余 ' + (items.length - 40) + ' 项，用 query 检索')
    }
    return lines.length > 0 ? lines.join('\n') : '（设计资产库为空）'
  }

  /** 资产总数（面板与工具展示用）。 */
  count(): number {
    return this.index.size
  }
}

/** 关键词是否命中该资产（覆盖 id/名称/描述/分类/触发词）。 */
function matches(asset: DesignAssetSummary, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (needle === '') return true
  const haystack = [asset.id, asset.name, asset.description, asset.category, asset.triggers.join(' ')]
    .join(' ')
    .toLowerCase()
  return needle.split(/\s+/).every((word) => haystack.includes(word))
}

/** 相关度打分：命中触发词权重最高，其次分类与名称，最后描述。 */
function scoreOf(asset: DesignAssetSummary, query: string): number {
  const needle = query.trim().toLowerCase()
  if (needle === '') return 0
  let score = 0
  for (const word of needle.split(/\s+/)) {
    if (asset.triggers.some((trigger) => trigger.toLowerCase().includes(word))) score += 5
    if (asset.category.toLowerCase().includes(word)) score += 3
    if (asset.name.toLowerCase().includes(word)) score += 3
    if (asset.id.toLowerCase().includes(word)) score += 2
    if (asset.description.toLowerCase().includes(word)) score += 1
  }
  return score
}
