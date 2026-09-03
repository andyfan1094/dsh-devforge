/**
 * 内置记忆知识图谱单测：关键词抽取、图谱节点/边派生与共现阈值。
 * 纯函数测试，不落库；条目用内存对象直接构造。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildMemoryGraph, extractEntryKeywords } from '../src/memory/graph.ts'
import type { NativeMemoryEntry } from '../src/memory/protocol.ts'

/** 构造测试条目：只填图谱派生需要的字段。 */
function makeEntry(id: string, content: string, tags: string[] = [], category: NativeMemoryEntry['category'] = 'general'): NativeMemoryEntry {
  return { id, content, category, tags, source: 'test', importance: 3, createdAt: 1, updatedAt: 1 }
}

test('关键词抽取：过滤停用词/单字/纯数字，按词频与长度排序', () => {
  const keywords = extractEntryKeywords('暂存实例必须用隔离 HOME 暂存验证，暂存通过后才能重启生产', 3)
  assert.ok(keywords.every((term) => term.length >= 2), '不得出现单字关键词')
  assert.ok(keywords.every((term) => !/^\d+$/u.test(term)), '不得出现纯数字')
  assert.ok(keywords.includes('暂存'), '高频词「暂存」应入选')
})

test('图谱：条目-关键词-分类节点与边正确派生', () => {
  const graph = buildMemoryGraph([
    makeEntry('a', '服务工厂对接 CNB 代码托管', ['CNB'], 'decision'),
    makeEntry('b', 'CNB 备份走加密推送', ['CNB'], 'fact'),
  ])
  const kinds = new Map(graph.nodes.map((node) => [node.id, node.kind]))
  assert.equal(kinds.get('entry:a'), 'entry')
  assert.equal(kinds.get('term:cnb'), 'tag')
  assert.equal(kinds.get('category:decision'), 'category')
  const hasEdge = (source: string, target: string): boolean =>
    graph.edges.some((edge) => (edge.source === source && edge.target === target) || (edge.source === target && edge.target === source))
  assert.ok(hasEdge('entry:a', 'category:decision'), '条目必须连到分类枢纽')
  assert.ok(hasEdge('entry:a', 'term:cnb'), '显式标签必须成边')
  // 两条记忆共享关键词 CNB（同属标签），但只有 1 个共享词，不满足 ≥2 共现阈值
  assert.ok(!hasEdge('entry:a', 'entry:b'), '共享不足 2 词不得连共现边')
})

test('图谱：共享 ≥2 关键词的条目建立共现边且权重为共享数', () => {
  const graph = buildMemoryGraph([
    makeEntry('x', '暂存实例禁用飞书桥避免双连', ['暂存', '飞书']),
    makeEntry('y', '暂存 overlay 禁飞书桥防双弹窗', ['暂存', '飞书']),
  ])
  const co = graph.edges.find((edge) => edge.source === 'entry:x' && edge.target === 'entry:y')
  assert.ok(co !== undefined, '两条共享 暂存+飞书 的记忆应有共现边')
  assert.equal(co?.weight, 2)
})

test('图谱：节点 weight 为连接度，空输入返回空图', () => {
  const empty = buildMemoryGraph([])
  assert.deepEqual(empty, { nodes: [], edges: [], generatedAt: empty.generatedAt })
  const graph = buildMemoryGraph([makeEntry('only', '孤立的一条记忆没有标签', [], 'insight')])
  const entry = graph.nodes.find((node) => node.id === 'entry:only')
  assert.ok((entry?.weight ?? 0) >= 1, '孤立条目至少连分类枢纽，连接度 ≥1')
})
