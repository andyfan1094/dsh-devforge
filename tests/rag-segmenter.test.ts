/**
 * RAG 中文分词器测试：词典词元 + bigram、小写化、标点过滤、空输入。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { tokenizeForIndex } from '../src/rag/segmenter.ts'

test('复合词经 bigram 整体可命中（阶段0冒烟问题的回归测试）', () => {
  const tokens = tokenizeForIndex('天工造梦暂存实例需要隔离HOME启动')
  assert.ok(tokens.includes('暂存'), 'bigram 应产出「暂存」：' + JSON.stringify(tokens))
  assert.ok(tokens.includes('实例'), '词典应产出「实例」：' + JSON.stringify(tokens))
  assert.ok(tokens.includes('天工'), '应包含「天工」：' + JSON.stringify(tokens))
  assert.ok(tokens.includes('造梦'), 'bigram 应产出「造梦」：' + JSON.stringify(tokens))
})

test('英文小写化，中英混合不丢词', () => {
  const tokens = tokenizeForIndex('RAG套件使用Orama引擎')
  assert.ok(tokens.includes('rag'))
  assert.ok(tokens.includes('orama'))
  assert.ok(tokens.includes('套件'), 'bigram 应产出「套件」：' + JSON.stringify(tokens))
})

test('标点与空白被过滤（含 ASCII 与全角）', () => {
  const tokens = tokenizeForIndex('你好，世界！  Hello, world?')
  for (const punc of ['，', '！', ',', '?', '.']) {
    assert.ok(!tokens.includes(punc), '标点混入：' + punc)
  }
  assert.ok(tokens.includes('你好'))
  assert.ok(tokens.includes('hello'))
  assert.ok(tokens.includes('world'))
})

test('空串与纯标点返回空数组', () => {
  assert.deepEqual(tokenizeForIndex(''), [])
  assert.deepEqual(tokenizeForIndex('，。！？'), [])
})
