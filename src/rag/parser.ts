/**
 * RAG 文档解析器 —— 按扩展名分发，统一产出纯文本。
 *
 * 分发规则：md/txt/代码等一切 UTF-8 文本直读；pdf 走 unpdf（pdfjs 内核，
 * 动态加载避免拖慢插件启动）；docx 走 mammoth（extractRawText，纯文本无样式）。
 * 二进制或未知格式抛 RagParserError，由上层落 RagDocStatus=failed。
 */
import { readFile } from 'node:fs/promises'

/** 解析失败（可直接呈现给面板，含文件名不含路径细节）。 */
export class RagParserError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RagParserError'
  }
}

/** 解析器类别。 */
export type ParserKind = 'text' | 'pdf' | 'docx'

/** 按扩展名判定解析类别（测试可独立验证的分发纯函数）。 */
export function pickParserKind(fileName: string): ParserKind {
  const dot = fileName.lastIndexOf('.')
  const ext = dot >= 0 ? fileName.slice(dot + 1).toLowerCase() : ''
  if (ext === 'pdf') return 'pdf'
  if (ext === 'docx') return 'docx'
  // 其余一律按 UTF-8 文本：md/txt/log/csv/json/yaml/ts/js/py/go/rs/java/sh…
  return 'text'
}

/** 解析入口：读文件并按类别抽取纯文本。 */
export async function parseFile(path: string, displayName?: string): Promise<string> {
  const name = displayName ?? path
  const kind = pickParserKind(name)
  try {
    if (kind === 'pdf') {
      // 动态加载：pdfjs 内核较重，仅 PDF 文档入库时才加载
      const { extractText, getDocumentProxy } = await import('unpdf')
      const buffer = await readFile(path)
      const pdf = await getDocumentProxy(new Uint8Array(buffer))
      const { text } = await extractText(pdf, { mergePages: true })
      const clean = text.trim()
      if (clean === '') throw new RagParserError('PDF 未抽取到文本（可能是扫描件或纯图片）')
      return clean
    }
    if (kind === 'docx') {
      const mammoth = (await import('mammoth')).default
      const result = await mammoth.extractRawText({ path })
      const clean = result.value.trim()
      if (clean === '') throw new RagParserError('DOCX 未抽取到文本')
      return clean
    }
    return await readFile(path, 'utf8')
  } catch (error) {
    if (error instanceof RagParserError) throw error
    const reason = error instanceof Error ? error.message : String(error)
    throw new RagParserError('解析失败（' + kind + '）：' + reason.slice(0, 200))
  }
}
