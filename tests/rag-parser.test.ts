/**
 * RAG 解析器测试：格式分发纯函数 + 文本直读。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseFile, pickParserKind, RagParserError } from '../src/rag/parser.ts'

test('格式分发：常见扩展名映射正确', () => {
  assert.equal(pickParserKind('报告.pdf'), 'pdf')
  assert.equal(pickParserKind('WORD.DOCX'), 'docx')
  assert.equal(pickParserKind('笔记.md'), 'text')
  assert.equal(pickParserKind('脚本.ts'), 'text')
  assert.equal(pickParserKind('无扩展名'), 'text')
})

test('文本直读：UTF-8 内容完整返回（含中文）', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'rag-parser-'))
  const file = join(dir, '测试文档.md')
  writeFileSync(file, '# 标题\n中文正文内容。')
  const text = await parseFile(file)
  assert.ok(text.includes('中文正文内容。'))
})

test('不存在的文件抛 RagParserError（消息脱敏可呈现）', async () => {
  await assert.rejects(() => parseFile('/tmp/rag-不存在的文件.pdf'), RagParserError)
})
