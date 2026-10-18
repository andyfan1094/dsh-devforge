/**
 * 把模型输出的结构化识别结果渲染成"等宽排版文本"。
 *
 * 为什么不让模型直接吐空格对齐的文本（2026-10-18 实测结论）：
 * 让模型自己数空格时，同一张图的表格里会出现某几行多一个空格的情况，
 * 而且经常混用全角空格，列宽根本稳不住。改为让模型只负责"认字 + 分格"，
 * 由这里按显示宽度计算填充，列就一定对得齐。
 *
 * 宽度约定与结果窗的等宽字体一致：一个汉字（全角）占 2 列，半角占 1 列，
 * 这也正是中日韩等宽字体（本机 MS Gothic）实测的比例：中文 15px、西文 7.5px。
 */

/** 识别结果里的一行：普通文本、表格或列表。 */
export type SnipLayoutLine =
  | { type: 'text'; text: string; indent?: number }
  | { type: 'list'; text: string; marker?: string; indent?: number }
  | { type: 'table'; rows: string[][] }

/** 模型输出的整体结构。 */
export interface SnipLayoutDocument {
  lines: SnipLayoutLine[]
}

/** 目标渲染宽度（列数）；表格列总宽不足时按内容自适应。 */
const TABLE_MAX_COLUMNS = 3

/**
 * 计算字符串在等宽字体下的显示列数。
 *
 * 全角字符（汉字、全角标点、假名、韩文等）按 2 列计，其余按 1 列。
 * 组合符号与零宽字符不占列，避免把表情或变音符算成 2 列导致错位。
 *
 * @param text 待测量文本。
 * @returns 显示列数。
 */
export function displayWidth(text: string): number {
  let width = 0
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0
    if (code === 0x200b || code === 0xfeff || (code >= 0x0300 && code <= 0x036f)) continue
    width += isFullWidth(code) ? 2 : 1
  }
  return width
}

/** 判断码点是否按全角（双列）显示。 */
function isFullWidth(code: number): boolean {
  return (
    (code >= 0x1100 && code <= 0x115f)
    || (code >= 0x2e80 && code <= 0x303e)
    || (code >= 0x3041 && code <= 0x33ff)
    || (code >= 0x3400 && code <= 0x4dbf)
    || (code >= 0x4e00 && code <= 0x9fff)
    || (code >= 0xa000 && code <= 0xa4cf)
    || (code >= 0xac00 && code <= 0xd7a3)
    || (code >= 0xf900 && code <= 0xfaff)
    || (code >= 0xfe30 && code <= 0xfe4f)
    || (code >= 0xff00 && code <= 0xff60)
    || (code >= 0xffe0 && code <= 0xffe6)
    || (code >= 0x1f300 && code <= 0x1f64f)
    || (code >= 0x1f900 && code <= 0x1f9ff)
    || (code >= 0x20000 && code <= 0x3fffd)
  )
}

/** 用空格把文本补齐到指定显示宽度（已超宽则原样返回）。 */
function padTo(text: string, width: number): string {
  const current = displayWidth(text)
  return current >= width ? text : text + ' '.repeat(width - current)
}

/** 缩进转成空格；一层缩进 2 列。 */
function indentOf(level: number | undefined): string {
  const safe = Number.isFinite(level) ? Math.max(0, Math.min(8, Math.trunc(level as number))) : 0
  return '  '.repeat(safe)
}

/**
 * 渲染表格：按列内最宽的内容定列宽，列间留 2 个空格。
 *
 * 这样同一列的文字起始位置必然一致，和原图是否对齐无关——
 * 原图本来就没对齐的表格，渲染出来反而更整齐。
 *
 * @param rows 二维单元格文本。
 * @returns 每行一个字符串。
 */
function renderTable(rows: string[][]): string[] {
  const widths: number[] = []
  for (const row of rows) {
    row.forEach((cell, index) => {
      if (index >= TABLE_MAX_COLUMNS * 4) return
      widths[index] = Math.max(widths[index] ?? 0, displayWidth(cell))
    })
  }
  return rows.map((row) => {
    const cells = row.map((cell, index) => (index === row.length - 1 ? cell : padTo(cell, widths[index] ?? 0)))
    return cells.join('  ').replace(/[ ]+$/, '')
  })
}

/**
 * 把结构化识别结果渲染成等宽文本。
 *
 * @param document 模型给出的结构。
 * @returns 可直接显示与复制的多行文本。
 */
export function renderLayout(document: SnipLayoutDocument): string {
  const out: string[] = []
  for (const line of document.lines ?? []) {
    if (line.type === 'table') {
      const rows = (line.rows ?? []).filter((row) => Array.isArray(row) && row.length > 0)
      if (rows.length > 0) out.push(...renderTable(rows.map((row) => row.map((cell) => String(cell ?? '').trim()))))
      continue
    }
    const indent = indentOf(line.indent)
    if (line.type === 'list') {
      const marker = line.marker === undefined || line.marker === '' ? '-' : line.marker
      out.push(indent + marker + ' ' + line.text)
      continue
    }
    out.push(indent + line.text)
  }
  // 去掉整体首尾空行，中间空行保留（空行也是排版的一部分）。
  while (out.length > 0 && out[0].trim() === '') out.shift()
  while (out.length > 0 && out[out.length - 1].trim() === '') out.pop()
  return out.join('\n')
}

/**
 * 从模型输出里解析结构化识别结果；不是合法结构时返回 undefined。
 *
 * 模型偶尔会加 ```json 围栏或前后废话，这里做一次宽松提取：
 * 先尝试整体解析，再尝试截取第一个 { 到最后一个 }。
 *
 * @param raw 模型原始输出。
 */
export function parseLayoutDocument(raw: string): SnipLayoutDocument | undefined {
  const candidates: string[] = []
  const trimmed = raw.trim()
  candidates.push(trimmed)
  const fenced = /```(?:json)?\s*([\s\S]*?)\s*```/i.exec(trimmed)
  if (fenced !== null) candidates.push(fenced[1])
  const first = trimmed.indexOf('{')
  const last = trimmed.lastIndexOf('}')
  if (first >= 0 && last > first) candidates.push(trimmed.slice(first, last + 1))

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as { lines?: unknown }
      if (!Array.isArray(parsed.lines)) continue
      const lines: SnipLayoutLine[] = []
      for (const item of parsed.lines) {
        if (item === null || typeof item !== 'object') continue
        const record = item as Record<string, unknown>
        const type = record['type']
        if (type === 'table') {
          const rows = Array.isArray(record['rows']) ? record['rows'] : []
          const clean = rows
            .filter((row): row is unknown[] => Array.isArray(row))
            .map((row) => row.map((cell) => String(cell ?? '').trim()))
            .filter((row) => row.some((cell) => cell !== ''))
          if (clean.length > 0) lines.push({ type: 'table', rows: clean })
          continue
        }
        const text = typeof record['text'] === 'string' ? record['text'] : ''
        if (text.trim() === '') continue
        const indent = typeof record['indent'] === 'number' ? record['indent'] : 0
        if (type === 'list') {
          const marker = typeof record['marker'] === 'string' ? record['marker'] : '-'
          lines.push({ type: 'list', text, marker, indent })
          continue
        }
        lines.push({ type: 'text', text, indent })
      }
      return lines.length > 0 ? { lines } : undefined
    } catch {
      // 换下一个候选继续。
    }
  }
  return undefined
}
