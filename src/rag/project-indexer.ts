/**
 * 项目知识库增量索引器 —— 目录扫描 + 内容哈希增量入库。
 *
 * - 尊重 .gitignore（ignore 包，逐目录叠加规则）与固定排除目录（.git/node_modules/dist 等）；
 * - 只收文本型扩展名，单文件与总量双上限，防止误扫巨型目录；
 * - 以「相对路径」为文件名幂等入库：内容 sha256 未变直接跳过（零嵌入调用），
 *   变化即重嵌，消失即删除；结果返回结构化统计供面板展示。
 */
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { Ignored } from './ignore-lite.ts'
import type { RagService } from './service.ts'

/** 固定排除目录名（与 .gitignore 无关，恒跳过）。 */
const ALWAYS_SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', '.next', 'target', '.venv', '__pycache__', '.pnpm-store', 'coverage'])

/** 允许入库的文本扩展名（小写含点）。 */
const ALLOWED_EXT = new Set(['.md', '.txt', '.csv', '.json', '.yaml', '.yml', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.py', '.go', '.rs', '.java', '.sh', '.css', '.html'])

/** 单文件字节上限（超出跳过）。 */
const MAX_FILE_BYTES = 256 * 1024
/** 单次索引文件总数上限。 */
const MAX_FILES = 2000

/** 扫描结果统计。 */
export interface ProjectIndexReport {
  root: string
  scanned: number
  added: number
  updated: number
  removed: number
  skipped: number
  errors: string[]
}

/** 递归收集候选文件（相对路径）。导出供单测验证 ignore 语义。 */
export function collectFiles(root: string, limits?: { maxFiles?: number }): string[]
{
  const maxFiles = limits?.maxFiles ?? MAX_FILES
  const out: string[] = []
  const walk = (dir: string, ignored: Ignored): void => {
    if (out.length >= maxFiles) return
    let entries: Array<{ name: string; isDirectory: boolean }> = []
    try {
      entries = readdirSync(dir, { withFileTypes: true }).map((e) => ({ name: e.name, isDirectory: e.isDirectory() }))
    } catch { return }
    const gitignore = entries.find((e) => e.name === '.gitignore' && !e.isDirectory)
    const next = gitignore === undefined ? ignored : ignored.withGitignore(dir, join(dir, '.gitignore'))
    for (const entry of entries) {
      if (entry.isDirectory) {
        if (ALWAYS_SKIP_DIRS.has(entry.name)) continue
        const child = join(dir, entry.name)
        if (next.isIgnoredDir(child, root)) continue
        walk(child, next)
      } else {
        if (out.length >= maxFiles) return
        const file = join(dir, entry.name)
        const ext = entry.name.slice(entry.name.lastIndexOf('.')).toLowerCase()
        if (entry.name.lastIndexOf('.') < 0 || !ALLOWED_EXT.has(ext)) continue
        if (next.isIgnoredFile(file, root)) continue
        out.push(relative(root, file).split(sep).join('/'))
      }
    }
  }
  walk(root, new Ignored())
  return out.slice(0, maxFiles)
}

/** 项目索引器（持有目标知识库 id，可反复 run 做增量）。 */
export class ProjectIndexer {
  private readonly rag: RagService
  private readonly kbId: string

  constructor(rag: RagService, kbId: string) {
    this.rag = rag
    this.kbId = kbId
  }

  /** 执行一次增量索引；任何单文件失败只记录，不中断整体。 */
  async run(root: string): Promise<ProjectIndexReport> {
    const report: ProjectIndexReport = { root, scanned: 0, added: 0, updated: 0, removed: 0, skipped: 0, errors: [] }
    const trimmed = root.trim()
    if (trimmed === '' || !trimmed.startsWith('/')) { report.errors.push('路径必须是本机绝对路径'); return report }
    if (!existsSync(trimmed) || !statSync(trimmed).isDirectory()) { report.errors.push('路径不存在或不是目录：' + trimmed); return report }
    const files = collectFiles(trimmed)
    const existing = this.rag.listDocs(this.kbId)
    const byName = new Map(existing.map((doc) => [doc.fileName, doc]))
    const seen = new Set<string>()
    for (const rel of files) {
      report.scanned += 1
      const abs = join(trimmed, rel)
      let text: string
      try {
        const buf = readFileSync(abs)
        if (buf.length > MAX_FILE_BYTES) { report.skipped += 1; continue }
        text = buf.toString('utf8')
        if (text.trim() === '') { report.skipped += 1; continue }
      } catch (error) {
        report.errors.push(rel + '：' + (error instanceof Error ? error.message : String(error)))
        continue
      }
      const hash = createHash('sha256').update(text).digest('hex')
      const prev = byName.get(rel)
      if (prev !== undefined && prev.contentHash === hash && prev.status === 'ready') { report.skipped += 1; seen.add(rel); continue }
      try {
        await this.rag.ingestText(this.kbId, rel, text, { sourcePath: abs })
        seen.add(rel)
        if (prev === undefined) report.added += 1; else report.updated += 1
      } catch (error) {
        report.errors.push(rel + '：' + (error instanceof Error ? error.message : String(error)).slice(0, 160))
      }
    }
    // 上轮存在、本轮未见的文档视为已删除（增量清理）。
    for (const doc of existing) {
      if (seen.has(doc.fileName)) continue
      try { this.rag.deleteDoc(doc.id); report.removed += 1 } catch { /* 删除失败不中断 */ }
    }
    return report
  }
}
