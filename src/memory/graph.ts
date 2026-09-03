/**
 * 内置记忆知识图谱构建 —— 从长期记忆条目派生「条目-关键词/标签-分类」只读关联图。
 *
 * - 图谱不落库：每次请求由 memory.entry 现算，条目增删后图谱即时跟随（69 条规模毫秒级）；
 * - 关键词 = 显式标签（全保留）+ 内容词频 Top3（复用 RAG 分词器，停用词/单字/纯数字过滤）；
 * - 边：条目-分类、条目-关键词各记 1；条目-条目共享 ≥2 个关键词才建共现边（强度=共享数），
 *   阈值避免两两全连导致图谱糊成一团；
 * - 节点 weight 统一输出为连接度（degree），前端只用它定半径，不回传条目正文。
 */
import { tokenizeWithFrequency } from '../rag/segmenter.ts'
import type { MemoryGraph, MemoryGraphEdge, MemoryGraphNode, NativeMemoryEntry } from './protocol.ts'

/** 每条记忆最多派生的关键词数（显式标签不占该名额）。 */
const MAX_KEYWORDS_PER_ENTRY = 3

/** 条目-条目共现边所需的最少共享关键词数。 */
const MIN_SHARED_FOR_CO_OCCURRENCE = 2

/** 中文虚词停用表：只滤无信息量的功能词，领域词（配置/模型/暂存等）一律保留。 */
const STOPWORDS = new Set([
  '的了', '是在', '我有', '和就', '都不', '一也', '这那', '你要', '他要', '会被', '跟对', '让向', '往于', '以及', '或者', '但是',
  '因为', '所以', '如果', '虽然', '然而', '因此', '于是', '并且', '而且', '然后', '已经', '正在', '没有', '不能', '可以', '应该',
  '需要', '觉得', '可能', '我们', '你们', '他们', '它们', '自己', '什么', '怎么', '如何', '哪些', '这个', '那个', '这些', '那些',
  '一个', '一些', '每次', '所有', '任何', '其他', '关于', '通过', '对于', '由于', '还是', '除了', '之前', '以后', '时候', '地方',
])

/** 分类枢纽的中文展示名。 */
const CATEGORY_LABELS: Record<string, string> = { preference: '偏好', decision: '决策', fact: '事实', insight: '洞察', context: '上下文', general: '通用' }

/** 条目节点标签：压空白后截 18 字，完整正文点开条目看。 */
function clipLabel(content: string): string {
  const text = content.replace(/\s+/gu, ' ').trim()
  return text.length <= 18 ? text : text.slice(0, 18) + '…'
}

/**
 * 从单条记忆内容提取词频 Top 关键词（导出供单测）。
 * 排序：词频降序 → 长词优先（词典词比 bigram 噪音低）→ 字典序稳定输出。
 */
export function extractEntryKeywords(content: string, limit = MAX_KEYWORDS_PER_ENTRY): string[] {
  return [...tokenizeWithFrequency(content).entries()]
    .filter(([term]) => term.length >= 2 && !STOPWORDS.has(term) && !/^\d+$/u.test(term))
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length || (a[0] < b[0] ? -1 : 1))
    .slice(0, limit)
    .map(([term]) => term)
}

/** 单条记忆参与图谱的关键词：显式标签在前全保留，关键词补足到 上限+标签数。 */
function entryTerms(entry: NativeMemoryEntry): string[] {
  const tags = [...new Set(entry.tags.map((tag) => tag.trim().toLowerCase()).filter((tag) => tag.length >= 2 && !STOPWORDS.has(tag)))]
  return [...tags, ...extractEntryKeywords(entry.content)].slice(0, tags.length + MAX_KEYWORDS_PER_ENTRY)
}

/** 构建内置记忆知识图谱（只读现算，无副作用）。 */
export function buildMemoryGraph(entries: readonly NativeMemoryEntry[]): MemoryGraph {
  const nodes = new Map<string, MemoryGraphNode>()
  const edgeWeights = new Map<string, number>()
  const termsOf = new Map<string, string[]>()

  // 边以「无序对」聚合权重：图谱语义只关心谁和谁有关，不分方向
  const bumpEdge = (source: string, target: string, weight: number): void => {
    const key = source < target ? source + '\u0000' + target : target + '\u0000' + source
    edgeWeights.set(key, (edgeWeights.get(key) ?? 0) + weight)
  }
  const ensureNode = (node: MemoryGraphNode): void => {
    const existing = nodes.get(node.id)
    if (existing === undefined) nodes.set(node.id, node)
  }

  for (const entry of entries) {
    const entryNodeId = 'entry:' + entry.id
    nodes.set(entryNodeId, { id: entryNodeId, kind: 'entry', label: clipLabel(entry.content), weight: entry.importance, entryId: entry.id })
    const categoryNode = 'category:' + entry.category
    ensureNode({ id: categoryNode, kind: 'category', label: CATEGORY_LABELS[entry.category] ?? entry.category, weight: 1 })
    bumpEdge(entryNodeId, categoryNode, 1)
    const terms = entryTerms(entry)
    termsOf.set(entry.id, terms)
    for (const term of terms) {
      const termNode = 'term:' + term
      ensureNode({ id: termNode, kind: 'tag', label: term, weight: 1 })
      bumpEdge(entryNodeId, termNode, 1)
    }
  }

  // 条目-条目共现边：共享关键词达到阈值才连，控制边数保证可读性
  const ids = [...termsOf.keys()]
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const termsJ = termsOf.get(ids[j]) ?? []
      const shared = (termsOf.get(ids[i]) ?? []).filter((term) => termsJ.includes(term)).length
      if (shared >= MIN_SHARED_FOR_CO_OCCURRENCE) bumpEdge('entry:' + ids[i], 'entry:' + ids[j], shared)
    }
  }

  // 节点 weight = 连接度（边权求和），前端按它定半径
  const degree = new Map<string, number>()
  for (const [key, weight] of edgeWeights) {
    const split = key.split('\u0000')
    degree.set(split[0], (degree.get(split[0]) ?? 0) + weight)
    degree.set(split[1], (degree.get(split[1]) ?? 0) + weight)
  }
  for (const node of nodes.values()) node.weight = degree.get(node.id) ?? 1

  const edges: MemoryGraphEdge[] = [...edgeWeights.entries()].map(([key, weight]) => {
    const split = key.split('\u0000')
    return { source: split[0], target: split[1], weight }
  })
  return { nodes: [...nodes.values()], edges, generatedAt: Date.now() }
}
