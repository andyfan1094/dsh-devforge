/**
 * RAG 切块器 —— Markdown 标题感知 + 行边界固定窗口 + 重叠。
 *
 * 设计要点：
 * - 标题感知：按 #/##/… 层级切段，每块携带"标题路径"（如「部署 > 暂存实例」），
 *   既做检索上下文 enrichment，也做引用溯源展示；
 * - 行边界：窗口按整行累计字符切，绝不拦腰斩断句子或代码行；
 * - 重叠：相邻块从上一块尾部 overlap 字符前的最近行首开始，保住跨块语义。
 */

/** 切块参数。 */
export interface ChunkOptions {
  /** 单块目标最大字符数（软上限，行边界优先，允许少量超出）。 */
  maxSize: number
  /** 相邻块重叠字符数（0 = 不重叠）。 */
  overlap: number
}

/** 单个切块结果。 */
export interface TextChunk {
  /** 块序号（文档内从 0 递增）。 */
  seq: number
  /** 标题路径（用「 > 」连接；非 Markdown 文本为空串）。 */
  headingPath: string
  /** 块正文。 */
  text: string
  /** 块在原文中的起始行（0 基）。 */
  startLine: number
  /** 块在原文中的结束行（不含）。 */
  endLine: number
}

/** 默认切块参数：512 字符 / 64 重叠，实测对中文文档召回友好。 */
export const DEFAULT_CHUNK_OPTIONS: ChunkOptions = { maxSize: 512, overlap: 64 }

/** 按标题层级把全文切成"节"；每个节带标题路径与行范围。 */
function splitByHeadings(lines: string[]): { headingPath: string; lines: string[]; startLine: number }[] {
  const sections: { headingPath: string; lines: string[]; startLine: number }[] = []
  const stack: string[] = [] // 当前标题栈，如 ['# 部署', '## 暂存实例'] 的文本部分
  let current: { headingPath: string; lines: string[]; startLine: number } | null = null

  const flush = () => {
    if (current !== null && current.lines.length > 0) sections.push(current)
    current = null
  }

  for (let i = 0; i < lines.length; i++) {
    const heading = /^(#{1,6})\s+(.*)$/.exec(lines[i])
    if (heading !== null) {
      flush()
      const level = heading[1].length
      const title = heading[2].trim()
      stack.length = level - 1 // 弹出到父级（同级覆盖）
      stack[level - 1] = title
      current = { headingPath: stack.join(' > '), lines: [lines[i]], startLine: i }
    } else if (current === null) {
      current = { headingPath: '', lines: [lines[i]], startLine: i }
    } else {
      current.lines.push(lines[i])
    }
  }
  flush()
  return sections
}

/** 单节内按行边界固定窗口 + 重叠切块。 */
function windowChunks(sectionLines: string[], startLine: number, opts: ChunkOptions): { lines: string[]; from: number; to: number }[] {
  const out: { lines: string[]; from: number; to: number }[] = []
  let from = 0
  while (from < sectionLines.length) {
    let size = 0
    let to = from
    while (to < sectionLines.length && (size < opts.maxSize || to === from)) {
      size += sectionLines[to].length + 1 // +1 补换行
      to++
    }
    out.push({ lines: sectionLines.slice(from, to), from, to })
    if (to >= sectionLines.length) break
    // 重叠：从块尾往回找 overlap 字符前的最近行首
    if (opts.overlap > 0) {
      let back = 0
      let idx = to - 1
      while (idx > from && back < opts.overlap) {
        back += sectionLines[idx].length + 1
        idx--
      }
      from = idx + 1
    } else {
      from = to
    }
    // 防御：极端单行超长导致 from 不前进
    if (from <= out[out.length - 1].from) from = out[out.length - 1].from + 1
  }
  return out
}

/** 文档切块主入口：标题感知（Markdown 自动识别）+ 行边界窗口 + 重叠。 */
export function chunkDocument(text: string, options?: Partial<ChunkOptions>): TextChunk[] {
  const opts = { ...DEFAULT_CHUNK_OPTIONS, ...options }
  const lines = text.split('\n')
  if (lines.length === 0) return []
  const sections = splitByHeadings(lines)
  const chunks: TextChunk[] = []
  for (const section of sections) {
    for (const win of windowChunks(section.lines, section.startLine, opts)) {
      const body = win.lines.join('\n').trim()
      if (body === '') continue
      chunks.push({
        seq: chunks.length,
        headingPath: section.headingPath,
        text: body,
        startLine: section.startLine + win.from,
        endLine: section.startLine + win.to,
      })
    }
  }
  return chunks
}
