/**
 * 记忆管家（curator）：自动评估价值、淘汰无用、合并同类。
 *
 * 与「做梦」(dream) 的分工，这是刻意的：
 *   - 做梦 = 交给 LLM 做语义裁决（合并/修订/归档），能力广但慢、贵、不可预演；
 *   - 管家 = 纯规则、零 LLM、可预演、可解释、可秒级跑全库。
 * 生产实况驱动了这套设计：5194 条活跃记忆里 3282 条（63%）accessCount=0（写完从未被召回），
 * 每天新增 100~340 条而做梦每天只归档 30~60 条——入不敷出必然无限膨胀。
 * 管家的职责就是把「用了没有」这件可量化的事，变成库容的自动调节阀。
 *
 * 三条硬边界（红线，任何配置都改不动）：
 *   1. 只软归档（archive），绝不物理删除；archive(false) 随时可恢复。
 *   2. 钉选（pinned）条目永不淘汰，无论分数多低。
 *   3. 每个决策都带人类可读原因，落 memory.audit 审计，可追溯。
 */

import type { MemoryEntryMeta, MemorySettings, NativeMemoryEntry } from './protocol.ts'
import type { NativeMemoryStore } from './native.ts'

/** 管家执行结果统计（面板与审计共用口径）。 */
export interface CuratorRunSummary {
  /** 运行时间戳。 */
  at: number
  /** 是否为预演（只出计划不落库）。 */
  dryRun: boolean
  /** 扫描的活跃条目总数。 */
  scanned: number
  /** 受保护（钉选/高重要/近期用过/带证据）条数。 */
  protectedCount: number
  /** 淘汰（软归档）条数。 */
  evicted: number
  /** 合并执行的组数。 */
  mergedGroups: number
  /** 因合并被取代的条目数。 */
  mergedEntries: number
  /** 库容上限触发时额外淘汰的条数。 */
  capacityEvicted: number
  /** 执行失败明细（不中断整轮）。 */
  errors: string[]
  /** 是否因库容未超限而跳过淘汰。 */
  capacityOk: boolean
}

/** 单条记忆的价值评估。 */
export interface CuratorScore {
  id: string
  /** 价值分（0~100，越高越该留）。 */
  score: number
  /** 是否受保护（不参与淘汰）。 */
  protected: boolean
  /** 保护/扣分的具体理由，人类可读。 */
  reasons: string[]
  /** 内容摘要（面板展示用）。 */
  preview: string
  category: string
}

/** 一个合并组的计划。 */
export interface CuratorMergeGroup {
  /** 保留的条目（内容最完整/最常被用）。 */
  keeperId: string
  /** 被并入并取代的条目。 */
  loserIds: string[]
  /** 组内相似度（最高一对）。 */
  similarity: number
  /** 合并后内容预览。 */
  preview: string
}

/** 一次预演/执行的完整计划。 */
export interface CuratorPlan {
  at: number
  total: number
  /** 平均价值分。 */
  averageScore: number
  /** 零访问条目数。 */
  zeroAccess: number
  /** 受保护条数。 */
  protectedCount: number
  /** 当前库容（活跃条目数）。 */
  liveCount: number
  /** 配置的库容上限。 */
  maxEntries: number
  /** 因超限需要淘汰的条数（未超限为 0）。 */
  overCapacity: number
  /** 淘汰候选（按分数升序，最该淘汰的在前）。 */
  evict: CuratorScore[]
  /** 合并候选组。 */
  merge: CuratorMergeGroup[]
}

/** 相似度口径：中文 2-gram 词袋 Jaccard。 */
function grams(text: string): Set<string> {
  const clean = String(text ?? '').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '')
  const set = new Set<string>()
  for (let i = 0; i < clean.length - 1; i += 1) set.add(clean.slice(i, i + 2))
  return set
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let inter = 0
  const [small, big] = a.size <= b.size ? [a, b] : [b, a]
  for (const g of small) if (big.has(g)) inter += 1
  return inter / (a.size + b.size - inter)
}

/** 管家所需的最小配置面（从 MemorySettings 取，缺省用兜底值）。 */
function configOf(settings: MemorySettings): {
  maxEntries: number
  evictThreshold: number
  protectDays: number
  mergeSimilarity: number
  maxEvict: number
  maxMerge: number
} {
  const pick = (value: unknown, fallback: number): number =>
    typeof value === 'number' && Number.isFinite(value) ? value : fallback
  return {
    maxEntries: Math.max(0, Math.round(pick(settings.curatorMaxEntries, 8000))),
    evictThreshold: Math.max(0, Math.min(100, pick(settings.curatorEvictThreshold, 30))),
    protectDays: Math.max(0, pick(settings.curatorProtectDays, 14)),
    mergeSimilarity: Math.max(0.3, Math.min(1, pick(settings.curatorMergeSimilarity, 0.55))),
    maxEvict: Math.max(0, Math.round(pick(settings.curatorMaxEvict, 200))),
    maxMerge: Math.max(0, Math.round(pick(settings.curatorMaxMerge, 50))),
  }
}

const DAY_MS = 86_400_000

/**
 * 用户身份自述识别（只用于「保护」，绝不会用于淘汰）。
 *
 * 生产实证：`用户被称为辉哥…`(16 分)、`用户称呼'辉哥'…`(25 分) 这两条没有任何 memoryKey，
 * 靠分数会被稳定误杀。但身份自述由注入链路直供、不经过召回，accessCount 恒为 0，
 * 正是「分数模型最不擅长判断」的一类。宁可多保护几条，也不能把用户的身份设定清掉。
 */
const IDENTITY_PATTERN = /(用户|我)(的)?(称呼|被称为|名字|身份|偏好|喜欢|习惯|要求)/u

export class MemoryCuratorService {
  private readonly native: NativeMemoryStore
  private readonly config: () => MemorySettings
  private readonly log: (message: string) => void
  private readonly audit: (action: string, ids: string[], reason: string) => void
  private running = false

  constructor(options: {
    native: NativeMemoryStore
    config: () => MemorySettings
    log?: (message: string) => void
    audit?: (action: string, ids: string[], reason: string) => void
  }) {
    this.native = options.native
    this.config = options.config
    this.log = options.log ?? (() => {})
    this.audit = options.audit ?? (() => {})
  }

  /**
   * 为单条记忆算价值分。
   *
   * 打分全部可解释：每个加减分都往 reasons 里写一句，面板上能直接看到
   * 「这条为什么被判为无用」——自动化动记忆库，不透明就等于不可信。
   */
  score(entry: NativeMemoryEntry, meta: MemoryEntryMeta | undefined, now: number, cfg: ReturnType<typeof configOf>): CuratorScore {
    const reasons: string[] = []
    let score = 0
    let protectedFlag = false

    const importance = Math.max(1, Math.min(5, entry.importance ?? 3))
    const accessCount = meta?.accessCount ?? 0
    const helpful = meta?.helpfulCount ?? 0
    const harmful = meta?.harmfulCount ?? 0
    const lastAccessedAt = meta?.lastAccessedAt ?? 0
    const ageDays = Math.max(0, Math.floor((now - (entry.createdAt ?? now)) / DAY_MS))
    const idleDays = lastAccessedAt === 0 ? ageDays : Math.max(0, Math.floor((now - lastAccessedAt) / DAY_MS))

    // 基础分：重要性（1→10 分，5→50 分）
    score += importance * 10
    reasons.push('重要度 ' + importance + '（+' + importance * 10 + '）')

    // 使用分：被召回过就有价值（封顶 20 次，避免老条目靠历史次数霸榜）
    if (accessCount > 0) {
      const usage = Math.min(accessCount, 20) * 2
      score += usage
      reasons.push('被召回 ' + accessCount + ' 次（+' + usage + '）')
    } else {
      reasons.push('从未被召回（+0）')
    }

    // 正/负反馈：负反馈直接压倒一切（被用户亲自判错的，留着就是污染）
    if (helpful > 0) {
      score += Math.min(helpful, 5) * 4
      reasons.push('获正反馈 ' + helpful + ' 次（+' + Math.min(helpful, 5) * 4 + '）')
    }
    if (harmful > 0) {
      score -= 100
      reasons.push('被判定有误 ' + harmful + ' 次（−100，立即淘汰候选）')
    }

    // 证据：带原话引用的比凭空写的可信
    const evidenceCount = entry.evidence?.length ?? 0
    if (evidenceCount > 0) {
      score += Math.min(evidenceCount, 3) * 4
      reasons.push('带证据 ' + evidenceCount + ' 条（+' + Math.min(evidenceCount, 3) * 4 + '）')
    }

    // 时效：越老越可疑，但只用温和扣分（老经验也可能长期有效，不能一刀切）
    if (idleDays <= 7) {
      score += 15
      reasons.push('近 7 天用过（+15）')
    } else if (idleDays <= 30) {
      score += 5
      reasons.push('30 天内用过（+5）')
    } else if (idleDays <= 90) {
      reasons.push('已闲置 ' + idleDays + ' 天（+0）')
    } else if (idleDays <= 180) {
      score -= 10
      reasons.push('已闲置 ' + idleDays + ' 天（−10）')
    } else {
      score -= 25
      reasons.push('已闲置 ' + idleDays + ' 天（−25）')
    }

    // 分类加权：偏好与决策是长期资产，上下文是一次性消耗品
    if (entry.category === 'preference') {
      score += 12
      reasons.push('偏好类为长期资产（+12）')
    } else if (entry.category === 'decision') {
      score += 6
      reasons.push('决策类为长期资产（+6）')
    } else if (entry.category === 'context') {
      score -= 8
      reasons.push('上下文类易过期（−8）')
    }

    // 记忆键：带 key 的是"可更新的事实槽位"，会被后续更新覆盖，不宜淘汰
    if (entry.memoryKey !== undefined) {
      score += 8
      reasons.push('有记忆键（可更新事实槽位，+8）')
    }

    // ---- 硬保护（任何分数都压不住）----
    if (entry.pinned === true) {
      protectedFlag = true
      reasons.push('【保护】钉选条目永不淘汰')
    }
    if (importance >= 5) {
      protectedFlag = true
      reasons.push('【保护】最高重要度')
    }
    if (harmful === 0 && helpful > 0) {
      protectedFlag = true
      reasons.push('【保护】获得过用户正反馈')
    }
    if (cfg.protectDays > 0 && lastAccessedAt > 0 && idleDays < cfg.protectDays) {
      protectedFlag = true
      reasons.push('【保护】' + cfg.protectDays + ' 天内被用过')
    }
    if (evidenceCount > 0 && importance >= 4) {
      protectedFlag = true
      reasons.push('【保护】高重要度且有证据')
    }
    // 带记忆键 = 可更新的事实槽位（后续同名写入会覆盖它）。淘汰它等于丢槽位，
    // 而且这类记忆常常不经过召回（身份卡、称呼、常用配置），accessCount 恒为 0，
    // 靠分数判会稳定误杀——实测生产里"用户称呼为辉哥"就差点被 24 分淘掉。
    if (entry.memoryKey !== undefined) {
      protectedFlag = true
      reasons.push('【保护】带记忆键的事实槽位')
    }
    // 身份自述（称呼/偏好/习惯）同样不走召回，一律保护。
    if (IDENTITY_PATTERN.test(String(entry.content ?? ''))) {
      protectedFlag = true
      reasons.push('【保护】用户身份/偏好自述')
    }

    const clamped = Math.max(0, Math.min(100, Math.round(score)))
    return {
      id: entry.id,
      score: clamped,
      protected: protectedFlag,
      reasons,
      preview: String(entry.content ?? '').replace(/\s+/g, ' ').slice(0, 120),
      category: entry.category ?? 'general',
    }
  }

  /** 生成计划（只读，不落库）。 */
  plan(): CuratorPlan {
    const cfg = configOf(this.config())
    const now = Date.now()
    const entries = this.native.listAll({ limit: 100_000 }).filter((entry) => entry.state === 'active')
    const metas = new Map(this.native.listMetas().map((meta) => [meta.entryId, meta]))

    const scored = entries.map((entry) => this.score(entry, metas.get(entry.id), now, cfg))
    const protectedCount = scored.filter((item) => item.protected).length
    const zeroAccess = entries.filter((entry) => (metas.get(entry.id)?.accessCount ?? 0) === 0).length
    const averageScore = scored.length === 0 ? 0 : scored.reduce((sum, item) => sum + item.score, 0) / scored.length

    // 淘汰候选：未受保护且低于阈值，按分数升序（最该淘汰的在前）
    const candidates = scored
      .filter((item) => !item.protected && item.score < cfg.evictThreshold)
      .sort((a, b) => a.score - b.score)

    // 库容口径：超过上限时需要把库压回去的条数。
    const overCapacity = cfg.maxEntries > 0 && entries.length > cfg.maxEntries ? entries.length - cfg.maxEntries : 0
    // 淘汰候选分两种口径，语义不同不能混：
    //   A) 阈值大扫除（人工触发）：只动「分数低于阈值」的，最多 curatorMaxEvict 条；
    //   B) 库容止损（自动触发）：必须把库压回上限，所以从「全部未受保护条目」里按分数
    //      升序取，取够超出量为止——否则所有条目都及格时库容永远收不回来，膨胀管不住。
    const unprotected = scored.filter((item) => !item.protected).sort((a, b) => a.score - b.score)
    const evict = overCapacity > 0
      ? unprotected.slice(0, overCapacity)
      : candidates.slice(0, cfg.maxEvict)

    // 合并候选：同分类 + 高相似（零 LLM，可解释）
    const merge = this.planMerge(entries, cfg)

    return {
      at: now,
      total: entries.length,
      averageScore: Math.round(averageScore * 10) / 10,
      zeroAccess,
      protectedCount,
      liveCount: entries.length,
      maxEntries: cfg.maxEntries,
      overCapacity,
      evict,
      merge,
    }
  }

  /**
   * 合并计划：只在同分类内找高相似组，用并查集连通。
   * 门槛偏高（默认 0.55）是刻意的——宁可漏合并，也不能把两条不同事实揉成一条。
   */
  private planMerge(entries: NativeMemoryEntry[], cfg: ReturnType<typeof configOf>): CuratorMergeGroup[] {
    if (cfg.maxMerge <= 0) return []
    // 钉选条目一律不参与合并：supersede 遇到钉选会直接抛错，而且钉选本身就代表用户要它保持原样。
    const items = entries
      .filter((entry) => entry.pinned !== true)
      .map((entry) => ({ entry, g: grams(entry.content), len: String(entry.content ?? '').length }))
    const index = new Map<string, number[]>()
    items.forEach((item, i) => {
      for (const g of item.g) {
        const bucket = index.get(g)
        if (bucket === undefined) index.set(g, [i])
        else if (bucket.length < 400) bucket.push(i)
      }
    })

    const parent = items.map((_, i) => i)
    const find = (x: number): number => { let cur = x; while (parent[cur] !== cur) { parent[cur] = parent[parent[cur]]; cur = parent[cur] } return cur }
    const union = (a: number, b: number): void => { const ra = find(a); const rb = find(b); if (ra !== rb) parent[rb] = ra }

    const sims = new Map<string, number>()
    const seen = new Set<string>()
    for (const [, bucket] of index) {
      for (let x = 0; x < bucket.length; x += 1) {
        for (let y = x + 1; y < bucket.length; y += 1) {
          const i = bucket[x]
          const j = bucket[y]
          if (items[i].entry.category !== items[j].entry.category) continue
          const key = i < j ? i + ':' + j : j + ':' + i
          if (seen.has(key)) continue
          seen.add(key)
          const sim = jaccard(items[i].g, items[j].g)
          if (sim >= cfg.mergeSimilarity) {
            union(i, j)
            sims.set(key, sim)
          }
        }
      }
    }

    const groups = new Map<number, number[]>()
    for (let i = 0; i < items.length; i += 1) {
      const root = find(i)
      const list = groups.get(root)
      if (list === undefined) groups.set(root, [i])
      else list.push(i)
    }

    const result: CuratorMergeGroup[] = []
    for (const [, indexes] of groups) {
      if (indexes.length < 2) continue
      // 保留者：内容最长（信息最全），同长则更早创建的（稳定性优先，避免每轮换 keeper 反复改写）
      const sorted = [...indexes].sort((a, b) => (items[b].len - items[a].len) || (items[a].entry.createdAt - items[b].entry.createdAt))
      const keeper = items[sorted[0]]
      const losers = sorted.slice(1).map((i) => items[i].entry.id)
      let maxSim = 0
      for (const key of sims.keys()) {
        const [a, b] = key.split(':').map(Number)
        if (sorted.includes(a) && sorted.includes(b)) maxSim = Math.max(maxSim, sims.get(key) ?? 0)
      }
      result.push({
        keeperId: keeper.entry.id,
        loserIds: losers,
        similarity: Math.round(maxSim * 100) / 100,
        preview: String(keeper.entry.content ?? '').replace(/\s+/g, ' ').slice(0, 100),
      })
    }
    return result.sort((a, b) => b.loserIds.length - a.loserIds.length).slice(0, cfg.maxMerge)
  }

  /**
   * 执行计划。
   *
   * @param options.dryRun true=只算不落库（默认），false=真正归档/合并
   * @param options.only 只执行指定 id 的动作（面板勾选式执行）
   * @param options.capacityOnly 只做库容止损：仅淘汰超出上限的那部分，不碰阈值候选。
   *        自动调度走这条路径——库没超限就什么都不做，避免"半夜自己大扫除"。
   * @param options.withMerge 是否执行合并（capacityOnly 模式默认不合并，避免自动改写正文）
   */
  execute(options?: { dryRun?: boolean; only?: { evict?: string[]; merge?: string[] }; capacityOnly?: boolean; withMerge?: boolean }): { plan: CuratorPlan; summary: CuratorRunSummary } {
    const cfg = configOf(this.config())
    const plan = this.plan()
    const dryRun = options?.dryRun !== false
    const capacityOnly = options?.capacityOnly === true
    const withMerge = options?.withMerge ?? !capacityOnly
    const summary: CuratorRunSummary = {
      at: Date.now(),
      dryRun,
      scanned: plan.total,
      protectedCount: plan.protectedCount,
      evicted: 0,
      mergedGroups: 0,
      mergedEntries: 0,
      capacityEvicted: 0,
      errors: [],
      capacityOk: plan.overCapacity === 0,
    }
    if (dryRun) return { plan, summary }
    if (this.running) {
      summary.errors.push('上一轮管家仍在执行，本轮跳过')
      return { plan, summary }
    }

    this.running = true
    try {
      const onlyEvict = options?.only?.evict === undefined ? undefined : new Set(options.only.evict)
      const onlyMerge = options?.only?.merge === undefined ? undefined : new Set(options.only.merge)

      // 1) 合并先做：合并会把旧条目置为 superseded，避免它们继续挤占淘汰额度
      if (withMerge && (onlyMerge === undefined || onlyMerge.size > 0)) {
        for (const group of plan.merge) {
          if (onlyMerge !== undefined && !onlyMerge.has(group.keeperId) && !group.loserIds.some((id) => onlyMerge.has(id))) continue
          if (summary.mergedGroups >= cfg.maxMerge) break
          try {
            const keeper = this.native.get(group.keeperId)
            if (keeper === undefined) continue
            // 合并内容：保留者原文 + 其余条目里 keeper 未覆盖的补充事实（保守策略，只做拼接不去重写）
            const extras: string[] = []
            for (const id of group.loserIds) {
              const loser = this.native.get(id)
              if (loser === undefined) continue
              const text = String(loser.content ?? '').trim()
              if (text !== '' && !keeper.content.includes(text)) extras.push(text)
            }
            const mergedContent = extras.length === 0
              ? keeper.content
              : keeper.content + '\n\n（合并自同类记忆）\n' + extras.join('\n')
            // supersede 的语义是「一次调用建一条新条目 + 把传入的全部旧 id 标记为被取代」。
            // 所以必须把 keeper 也一起传进去，否则每合并一条就会多造一条 keeper 的副本
            // （初版按 loser 逐条调用，生产实测活跃数只减了归档量、完全没减合并量，就是踩了这个）。
            this.native.supersede([group.keeperId, ...group.loserIds], {
              content: mergedContent,
              category: keeper.category,
              tags: keeper.tags,
              importance: keeper.importance,
              scope: keeper.scope,
              source: 'curator-merge',
              ...(keeper.memoryKey === undefined ? {} : { memoryKey: keeper.memoryKey }),
            }, '记忆管家合并同类：原文并入 ' + group.keeperId, 'dream')
            summary.mergedGroups += 1
            summary.mergedEntries += group.loserIds.length
            this.audit('curator-merge', [group.keeperId, ...group.loserIds], '相似度 ' + group.similarity + ' 合并 ' + group.loserIds.length + ' 条')
          } catch (error) {
            summary.errors.push('合并 ' + group.keeperId + ' 失败：' + (error instanceof Error ? error.message : String(error)).slice(0, 120))
          }
        }
      }

      // 2) 淘汰：软归档（可恢复），绝不物理删除
      const evictBudget = capacityOnly ? plan.overCapacity : Math.max(cfg.maxEvict, plan.overCapacity)
      for (const item of plan.evict) {
        if (summary.evicted >= evictBudget) break
        if (onlyEvict !== undefined && !onlyEvict.has(item.id)) continue
        try {
          // 计划是合并前算的：已被合并转为 superseded 的条目不该再归档一次（会污染审计口径）
          const live = this.native.get(item.id)
          if (live === undefined || live.state !== 'active') continue
          this.native.archive(item.id, true)
          summary.evicted += 1
          if (plan.overCapacity > 0) summary.capacityEvicted += 1
          this.audit('curator-evict', [item.id], '价值分 ' + item.score + ' 低于阈值 ' + cfg.evictThreshold + '：' + item.reasons.slice(-3).join('；'))
        } catch (error) {
          summary.errors.push('归档 ' + item.id + ' 失败：' + (error instanceof Error ? error.message : String(error)).slice(0, 120))
        }
      }
      this.log('[dsh-devforge] 记忆管家：扫描 ' + summary.scanned + '，保护 ' + summary.protectedCount + '，归档 ' + summary.evicted + '，合并 ' + summary.mergedGroups + ' 组/' + summary.mergedEntries + ' 条')
    } finally {
      this.running = false
    }
    return { plan, summary }
  }

  /** 从归档恢复（误淘汰的一键救援）。 */
  restore(ids: readonly string[]): number {
    let restored = 0
    for (const id of ids) {
      try {
        const entry = this.native.get(id)
        if (entry === undefined) continue
        this.native.archive(id, false)
        restored += 1
      } catch { /* 单条失败不阻断批量恢复 */ }
    }
    if (restored > 0) this.audit('curator-restore', [...ids], '人工恢复 ' + restored + ' 条')
    return restored
  }
}
