/**
 * 负记忆层（0.43.0 P1-5，契约移植自灵枢 dsh-memory）。
 *
 * 被人工拒绝、被证伪、被推翻的说法显式落 `memory.rejected` 域。它**不参与**正常召回注入
 * （它不是可用的知识），只在召回命中相似内容时回吐警示，防止已被否定的错误说法继续冒充答案。
 *
 * 归一化口径与治理层的重复判定保持一致（空白折叠为单空格 + 去标点 + trim）：
 * 口径一旦不一致，就会出现「写入判为重复、负覆盖却匹配不上」这种自相矛盾。
 * 此处**不复用** `sediment.ts` 的 `normalizeMemoryText`——那个只压空白、不去标点，
 * 两边标点写法略有差异就会漏掉负覆盖，等于该提示不存在。
 */
import type { RagStore } from '../rag/rag-store.ts'
import type { MemoryNegativeKind, MemoryScopeContext, RejectedMemory } from './protocol.ts'
import { memoryScopeMatches } from './scope.ts'

export const MEMORY_REJECTED_DOMAIN = 'memory.rejected'

const KINDS = new Set<MemoryNegativeKind>(['rejected', 'falsified', 'superseded'])
const VALID_SCOPES = new Set<MemoryScopeContext['kind']>(['global', 'project', 'workspace'])

/**
 * 负覆盖的最小重合度。否定串通常很短（如「不要用 pnpm」），若只按「包含」判定，
 * 它会命中所有含该串的长内容，把正常记忆全部标成已被否定——因此要求较短一方
 * 至少占较长一方 60% 的长度。
 */
const MIN_MATCH_RATIO = 0.6

/** 与治理层同口径的归一化：小写、空白折叠为单空格、去中英文标点。 */
function normalizeForMatch(value: string): string {
  return value.toLocaleLowerCase().replace(/\s+/gu, ' ').replace(/[，。！？、,.!?;；:：'"“”‘’`()（）\[\]{}]/gu, '').trim()
}

/** 两条说法是否构成同一 claim（相等，或互相包含且长度不过分悬殊）。 */
export function sameNarrative(a: string, b: string, minRatio = 0): boolean {
  const left = normalizeForMatch(a)
  const right = normalizeForMatch(b)
  if (left === '' || right === '') return false
  if (left === right) return true
  const shorter = left.length <= right.length ? left : right
  const longer = left.length <= right.length ? right : left
  if (minRatio > 0 && shorter.length < longer.length * minRatio) return false
  return longer.includes(shorter)
}

/** 把存储行还原为负记忆；字段不合法时丢弃（旧数据/损坏数据不得污染召回）。 */
function parseRejected(data: unknown, fallbackId: string): RejectedMemory | undefined {
  if (typeof data !== 'object' || data === null) return undefined
  const value = data as Partial<RejectedMemory>
  const content = typeof value.content === 'string' ? value.content : ''
  if (content === '') return undefined
  const scope = value.scope !== undefined && typeof value.scope === 'object' && VALID_SCOPES.has(value.scope.kind) ? value.scope : { kind: 'global' as const }
  return {
    id: typeof value.id === 'string' && value.id !== '' ? value.id : fallbackId,
    content,
    reason: typeof value.reason === 'string' ? value.reason : '',
    kind: value.kind !== undefined && KINDS.has(value.kind) ? value.kind : 'rejected',
    scope,
    rejectedAt: typeof value.rejectedAt === 'number' ? value.rejectedAt : 0,
    actor: typeof value.actor === 'string' ? value.actor : 'unknown',
    ...(typeof value.sourceId === 'string' && value.sourceId !== '' ? { sourceId: value.sourceId } : {}),
  }
}

/**
 * 在已取出的负记忆集合里找覆盖给定说法的第一条。
 * 召回侧一次取回负层后在内存里比对，避免每条命中都回库全量解析一次。
 */
export function pickNegativeCoverage(items: RejectedMemory[], content: string): RejectedMemory | undefined {
  for (const item of items) {
    if (sameNarrative(content, item.content, MIN_MATCH_RATIO)) return item
  }
  return undefined
}

/** 负记忆存储：落层、按作用域读取、为召回做相似比对。 */
export class MemoryNegativeStore {
  private readonly rag: RagStore

  constructor(rag: RagStore) { this.rag = rag }

  /** 记录一条负记忆（按 id 就地覆盖，重复调用不产生多条）。 */
  record(input: { id: string; content: string; reason: string; kind: MemoryNegativeKind; scope: MemoryScopeContext; actor: string; sourceId?: string }): RejectedMemory {
    const item: RejectedMemory = {
      id: input.id,
      content: input.content,
      reason: input.reason,
      kind: input.kind,
      scope: input.scope,
      rejectedAt: Date.now(),
      actor: input.actor,
      ...(input.sourceId === undefined ? {} : { sourceId: input.sourceId }),
    }
    this.rag.putDomainDoc(MEMORY_REJECTED_DOMAIN, item.id, item)
    return item
  }

  /** 读取负记忆；默认只取全局与调用方作用域的（跨项目不得互相否定）。 */
  list(options?: { limit?: number; scope?: MemoryScopeContext; isolateScope?: boolean }): RejectedMemory[] {
    const limit = Math.max(1, Math.min(2000, Math.floor(options?.limit ?? 500)))
    const scope = options?.scope
    const out: RejectedMemory[] = []
    for (const row of this.rag.listDomainDocs(MEMORY_REJECTED_DOMAIN)) {
      const item = parseRejected(row.data, row.id)
      if (item === undefined) continue
      if (scope !== undefined && !memoryScopeMatches(item, scope, options?.isolateScope === true)) continue
      out.push(item)
    }
    return out.sort((a, b) => b.rejectedAt - a.rejectedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).slice(0, limit)
  }

  /** 为一条候选说法找负覆盖：命中返回负记忆，否则 undefined（取最新的那条）。 */
  match(content: string, options?: { scope?: MemoryScopeContext; isolateScope?: boolean }): RejectedMemory | undefined {
    return pickNegativeCoverage(this.list({ scope: options?.scope, isolateScope: options?.isolateScope }), content)
  }

  /** 负记忆条数（工作台展示用）。 */
  count(): number {
    return this.list({ limit: 2000 }).length
  }
}
