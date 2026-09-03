/**
 * RAG 中文分词器 —— Intl.Segmenter（Node 内置 ICU，零第三方依赖）+ CJK bigram 增强。
 *
 * 背景（阶段0冒烟实证）：Orama 默认 tokenizer 对中文无效；且 ICU 词典粒度偏细
 * （"暂存"切成"暂"+"存"），单字 token 噪音大。本模块两层策略：
 *   1) Segmenter 词元（isWordLike 过滤标点/空白，英文小写化）；
 *   2) CJK 连续串的字符级 bigram（相邻字配对），让"暂存""套件"这类复合词
 *      作为整体可命中——索引与查询走同一函数，分词一致性保证匹配成立。
 */

/** 进程级单例：Segmenter 构造成本不低，复用。 */
const zhSegmenter = new Intl.Segmenter('zh', { granularity: 'word' })

/** CJK 统一表意文字连续串（含扩展A与兼容区），用于 bigram 生成。 */
const CJK_RUN = /[\u3400-\u9fff\uf900-\ufaff]+/g

/** 分词（索引/检索共用）：词典词元 + CJK bigram，去重返回。 */
export function tokenizeForIndex(text: string): string[] {
  const tokens = new Set<string>()
  // 第一层：词典分词；isWordLike=false 的段是标点/空白，直接丢弃
  for (const { segment, isWordLike } of zhSegmenter.segment(text)) {
    if (isWordLike !== true) continue
    const token = segment.trim().toLowerCase()
    if (token !== '') tokens.add(token)
  }
  // 第二层：CJK 连续串字符级 bigram，弥补词典粒度不足
  for (const run of text.match(CJK_RUN) ?? []) {
    for (let i = 0; i + 1 < run.length; i++) {
      tokens.add(run.slice(i, i + 2))
    }
  }
  return [...tokens]
}

/**
 * 分词并统计词频（知识图谱关键词用）：与 tokenizeForIndex 完全同一两层策略，
 * 区别仅在保留出现次数不去重——图谱按词频挑 Top 关键词，必须有频次信息。
 */
export function tokenizeWithFrequency(text: string): Map<string, number> {
  const counts = new Map<string, number>()
  const bump = (token: string): void => {
    const t = token.trim().toLowerCase()
    if (t !== '') counts.set(t, (counts.get(t) ?? 0) + 1)
  }
  for (const { segment, isWordLike } of zhSegmenter.segment(text)) {
    if (isWordLike === true) bump(segment)
  }
  for (const run of text.match(CJK_RUN) ?? []) {
    for (let i = 0; i + 1 < run.length; i++) {
      bump(run.slice(i, i + 2))
    }
  }
  return counts
}
