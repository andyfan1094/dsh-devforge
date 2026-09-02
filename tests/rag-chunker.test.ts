/**
 * RAG 切块器测试：标题路径、行边界窗口、重叠、代码行不切断。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chunkDocument } from '../src/rag/chunker.ts'

test('Markdown 标题感知：标题路径随层级变化', () => {
  const md = [
    '# 部署',
    '部署总述。',
    '## 暂存实例',
    '用隔离 HOME 启动。',
    '### 端口',
    '固定 3081。',
    '',
    '# 其他',
    '另一节。',
  ].join('\n')
  const chunks = chunkDocument(md)
  assert.ok(chunks.length >= 2)
  const paths = chunks.map(c => c.headingPath)
  assert.ok(paths.includes('部署'), JSON.stringify(paths))
  assert.ok(paths.includes('部署 > 暂存实例'), JSON.stringify(paths))
  assert.ok(paths.includes('部署 > 暂存实例 > 端口'), JSON.stringify(paths))
  assert.ok(paths.includes('其他'), JSON.stringify(paths))
})

test('小文档单块完整保留（含标题原文）', () => {
  const md = '# 标题\n正文内容。'
  const chunks = chunkDocument(md)
  assert.equal(chunks.length, 1)
  assert.equal(chunks[0].headingPath, '标题')
  assert.ok(chunks[0].text.includes('正文内容。'))
})

test('长文档按行边界窗口切，重叠生效，不斩断行', () => {
  const lines: string[] = ['# 长文']
  for (let i = 1; i <= 60; i++) lines.push('第' + i + '行内容，每行大约二十个字符左右的长度。')
  const chunks = chunkDocument(lines.join('\n'), { maxSize: 200, overlap: 30 })
  assert.ok(chunks.length >= 2, '应切出多块：' + chunks.length)
  // 每块都是完整行的拼接（不出现半行）
  for (const c of chunks) {
    for (const line of c.text.split('\n')) {
      assert.ok(line === '# 长文' || /^第\d+行内容/.test(line), '行被斩断：' + line)
    }
  }
  // 相邻块有重叠：第二块开头应出现在第一块结尾附近
  const overlapHit = chunks.slice(1).some((c, i) => {
    const prev = chunks[i].text.split('\n')
    return prev.slice(-3).some(l => c.text.includes(l))
  })
  assert.ok(overlapHit, '相邻块应有行级重叠')
})

test('纯文本（无标题）走窗口路径', () => {
  const text = Array.from({ length: 40 }, (_, i) => '纯文本行' + i).join('\n')
  const chunks = chunkDocument(text, { maxSize: 120, overlap: 0 })
  assert.ok(chunks.length >= 2)
  assert.equal(chunks[0].headingPath, '')
})

test('空文本返回空数组', () => {
  assert.deepEqual(chunkDocument(''), [])
  assert.deepEqual(chunkDocument('\n\n\n'), [])
})
