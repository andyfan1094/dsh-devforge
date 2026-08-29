/**
 * 开发规范库 —— 从插件 standards/ 目录加载分版本的 markdown 规范。
 *
 * 入口说明：StandardsStore 在插件 apply 时创建；列表/正文供面板展示，
 * 拼合文本（composeForAgent）供一键生成的子代理系统提示注入。
 * 关键边界：只读 standards 目录，不写任何文件；缺文件安静降级为空库。
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { StandardDetail, StandardSummary } from './protocol.ts'

/** 规范库存储：内存索引 + 按需读正文。 */
export class StandardsStore {
  /** 规范根目录（插件包内 standards/）。 */
  private readonly root: string
  /** 内存摘要索引（key = 规范 id，如 "v1/common"）。 */
  private readonly index = new Map<string, StandardSummary>()

  /**
   * @param standardsDir 插件包内 standards/ 目录绝对路径（apply 时传入）。
   */
  constructor(standardsDir: string) {
    this.root = standardsDir
    this.reload()
  }

  /** 重新扫描目录构建索引（版本目录/*.md 两层结构）。 */
  reload(): void {
    this.index.clear()
    let versionDirs: string[] = []
    try {
      versionDirs = readdirSync(this.root, { withFileTypes: true })
        .filter((e: import('node:fs').Dirent) => e.isDirectory())
        .map((e) => e.name)
    } catch {
      return // 目录缺失：空库，插件其余功能不受影响
    }
    for (const version of versionDirs) {
      const dir = join(this.root, version)
      let files: string[] = []
      try {
        files = readdirSync(dir).filter((f: string) => f.endsWith('.md'))
      } catch {
        continue
      }
      for (const file of files) {
        const id = version + '/' + file.replace(/\.md$/, '')
        try {
          const full = join(dir, file)
          const stat = statSync(full)
          const head = readFileSync(full, 'utf8').slice(0, 4000)
          const title = /^#\s+(.+)$/m.exec(head)?.[1]?.trim() ?? id
          const tags = /^tags:\s*(.+)$/m.exec(head)?.[1]?.split(/[,，]/).map((t) => t.trim()).filter(Boolean) ?? []
          this.index.set(id, { id, title, tags, updatedAt: stat.mtimeMs })
        } catch {
          // 单文件读取失败不影响其余规范
        }
      }
    }
  }

  /** 全部规范摘要（按 id 排序）。 */
  list(): StandardSummary[] {
    return [...this.index.values()].sort((a, b) => a.id.localeCompare(b.id))
  }

  /** 单篇规范正文；不存在返回 undefined。 */
  get(id: string): StandardDetail | undefined {
    const summary = this.index.get(id)
    if (!summary) return undefined
    const [version, ...rest] = id.split('/')
    const file = join(this.root, version, rest.join('/') + '.md')
    try {
      return { ...summary, content: readFileSync(file, 'utf8') }
    } catch {
      return undefined
    }
  }

  /**
   * 按 id 列表拼合"规范包"文本（子代理系统提示注入用）。
   * 安全边界：单篇上限 8000 字符，防止超长规范撑爆系统提示。
   */
  composeForAgent(ids: string[]): string {
    const parts: string[] = ['你必须严格遵循以下开发规范（dsh-devforge 注入）：']
    for (const id of ids) {
      const detail = this.get(id)
      if (!detail) continue
      parts.push('---\n# 规范：' + detail.title + '（' + id + '）\n' + detail.content.slice(0, 8000))
    }
    return parts.join('\n\n')
  }
}
