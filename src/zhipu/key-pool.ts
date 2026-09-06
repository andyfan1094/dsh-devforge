/** 智谱 Coding Plan Key 池：用户自定义命名的独立 Key 列表、按序解析与失败切换判定。
 *
 * 设计（v0.23.1 重构，修复「切主 Key 后原主 Key 从池中消失」）：
 * - 池成员持久化在 store.db 设置域（随 CNB 加密备份），与「主 Key 指向」解耦；
 *   主 Key 只是聊天路由 zai-coding-cn 当前指向的某个 ref，切换主 Key 不增删池成员。
 * - 每把 Key = { id, label, ref }：label 为用户自定义名称，ref 为受管凭据引用名。
 * - 首次使用时自动播种：主 Key 引用（label「主 Key」）+ 历史派生槽位 _2…_6 中已配置的
 *   旧附加 Key（label「附加 Key N」），老用户升级零感迁移。
 */
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { ZhipuServiceError } from './errors.ts'
import type { ZhipuPoolKey } from './protocol.ts'

export type { ZhipuPoolKey }

/** 历史版本派生槽位的主引用名前缀（仅用于老数据迁移识别）。 */
export const ZHIPU_LEGACY_SLOT_BASE = 'ZAI_CODING_CN_API_KEY'

/** 历史派生槽位范围：_2 … _6。 */
export const ZHIPU_LEGACY_SLOT_MAX = 6

/** 池容量上限：防止面板无限追加导致官方接口压力过大。 */
export const ZHIPU_KEY_POOL_LIMIT = 8

/** 用户名称长度上限（中英文同算字符数）。 */
export const ZHIPU_KEY_LABEL_MAX = 40

/** 凭据引用名格式（与受管凭据写入器保持同一约束）。 */
const REF_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

/** 池条目的存储形状（不含 configured/primary 等派生字段）。 */
export interface ZhipuKeyEntry {
  /** 池内稳定 id。 */
  id: string
  /** 用户自定义名称。 */
  label: string
  /** 受管凭据引用名。 */
  ref: string
}

/** 池持久化抽象（真实实现落 store.db 设置域；测试注入内存版）。 */
export interface ZhipuPoolStoreLike {
  /** 读取已存清单；从未保存过返回 undefined（触发播种）。 */
  load(): ZhipuKeyEntry[] | undefined
  /** 整表覆盖保存。 */
  save(entries: ZhipuKeyEntry[]): void
}

/** 校验一条池条目的完整性与唯一性约束，返回规范化后的条目。 */
export function normalizeKeyEntry(entry: ZhipuKeyEntry, existing: ZhipuKeyEntry[]): ZhipuKeyEntry {
  const label = typeof entry.label === 'string' ? entry.label.trim() : ''
  if (label === '') throw new ZhipuServiceError('Key 名称不能为空。', 400)
  if (label.length > ZHIPU_KEY_LABEL_MAX) throw new ZhipuServiceError('Key 名称不能超过 ' + ZHIPU_KEY_LABEL_MAX + ' 个字符。', 400)
  if (!REF_PATTERN.test(entry.ref)) throw new ZhipuServiceError('凭据引用名格式无效：' + entry.ref, 400)
  if (existing.some((item) => item.id === entry.id)) throw new ZhipuServiceError('Key id 重复：' + entry.id, 400)
  if (existing.some((item) => item.ref === entry.ref)) throw new ZhipuServiceError('该凭据引用已在 Key 池内：' + entry.ref, 400)
  if (existing.length >= ZHIPU_KEY_POOL_LIMIT) throw new ZhipuServiceError('Key 池已满（最多 ' + ZHIPU_KEY_POOL_LIMIT + ' 把）。', 400)
  return { id: entry.id, label, ref: entry.ref }
}

/** 生成一个不与现有引用冲突的附加 Key 引用名（ZAI_CODING_CN_API_KEY_2 起顺延）。 */
export function nextKeyRef(existingRefs: string[]): string {
  const taken = new Set(existingRefs)
  for (let index = 2; index <= ZHIPU_KEY_POOL_LIMIT + 1; index += 1) {
    const candidate = ZHIPU_LEGACY_SLOT_BASE + '_' + index
    if (!taken.has(candidate)) return candidate
  }
  // 理论上池上限 8 时 _2…_9 足够；防御性兜底用随机后缀，保持引用名合法。
  return ZHIPU_LEGACY_SLOT_BASE + '_' + Math.random().toString(36).slice(2, 6).toUpperCase()
}

/** 生成池条目 id（时间相关前缀 + 随机段，仅要求进程内唯一）。 */
export function newKeyId(): string {
  return 'key-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8)
}

/** 失败切换展示顺序：主 Key 在前，其余按池内维护顺序。 */
export function orderEntries(entries: ZhipuKeyEntry[], primaryRef: string): ZhipuKeyEntry[] {
  const primary = entries.find((entry) => entry.ref === primaryRef)
  const rest = entries.filter((entry) => entry !== primary)
  return primary !== undefined ? [primary, ...rest] : rest
}

/**
 * 官方错误中允许切换下一把 Key 的状态码：
 * 401/403 表示 Key 失效或不属于 Coding Plan；429 表示限流或额度耗尽。
 * 其余状态（超时、网关故障等）与 Key 无关，切换无意义，直接向用户呈现。
 */
export function isKeySwitchableStatus(status: number | undefined): boolean {
  return status === 401 || status === 403 || status === 429
}

/**
 * 按序尝试候选 Key：官方返回 401/403/429 时切换下一把，其余错误直接抛出。
 * 全部候选都失败时抛最后一把的可切换错误；只有一个候选时行为与单 Key 完全一致。
 */
export async function firstSuccessful<T, R>(candidates: T[], attempt: (candidate: T) => Promise<R>): Promise<R> {
  let lastError: unknown
  for (const candidate of candidates) {
    try {
      return await attempt(candidate)
    } catch (error) {
      if (error instanceof ZhipuServiceError && isKeySwitchableStatus(error.status)) {
        lastError = error
        continue
      }
      throw error
    }
  }
  throw lastError
}

/** 池依赖的宿主凭据能力（收窄成最小接口，测试可注入假实现）。 */
export interface ZhipuCredentialLike {
  resolve(ref: ReturnType<typeof credentialRef>): Promise<{ value: string } | undefined>
  describe(ref: ReturnType<typeof credentialRef>): Promise<{ configured: boolean }>
}

/** 按序解析出的一把可用 Key（value 只在内存流转，绝不进日志或面板）。 */
export interface ZhipuResolvedKey {
  /** 受管凭据引用名。 */
  env: string
  /** Key 明文。 */
  value: string
}

/** 智谱 Key 池：所有官方调用的 Key 来源（成员与主 Key 指向解耦）。 */
export class ZhipuKeyPool {
  private readonly credentials: ZhipuCredentialLike
  /** 主 Key 引用名提供者（聊天路由 provider.apiKeyEnv 优先，回落插件配置）。 */
  private readonly primaryName: () => Promise<string>
  /** 池成员持久化通道。 */
  private readonly store: ZhipuPoolStoreLike
  /** 历史派生槽位的候选前缀（播种迁移用；始终并集默认前缀）。 */
  private readonly legacyBases: string[]
  /** 内存中的池成员（ensureLoaded 后与存储同步）。 */
  private entries: ZhipuKeyEntry[] = []
  /** 播种/加载只执行一次；并发调用共享同一 Promise。 */
  private loaded: Promise<void> | undefined

  constructor(credentials: ZhipuCredentialLike, primaryName: () => Promise<string>, store: ZhipuPoolStoreLike, legacyBases: string[] = []) {
    this.credentials = credentials
    this.primaryName = primaryName
    this.store = store
    const bases = new Set<string>([...legacyBases, ZHIPU_LEGACY_SLOT_BASE])
    bases.delete('')
    this.legacyBases = [...bases]
  }

  /** 当前主 Key 引用名。 */
  async primary(): Promise<string> {
    return await this.primaryName()
  }

  /** 首次访问时加载或播种池成员；后续读写直接操作内存并整表落盘。 */
  private async ensureLoaded(): Promise<void> {
    if (this.loaded !== undefined) return await this.loaded
    this.loaded = (async () => {
      const stored = this.store.load()
      const primary = await this.primaryName()
      if (stored === undefined || stored.length === 0) {
        // 播种：主 Key 打头；历史派生槽位 _2…_6 中已配置的旧附加 Key 依序并入。
        const seeded: ZhipuKeyEntry[] = [{ id: newKeyId(), label: '主 Key', ref: primary }]
        for (const base of this.legacyBases) {
          for (let index = 2; index <= ZHIPU_LEGACY_SLOT_MAX; index += 1) {
            const legacy = base + '_' + index
            if (legacy === primary || seeded.some((entry) => entry.ref === legacy)) continue
            if (await this.isConfiguredRef(legacy)) seeded.push({ id: newKeyId(), label: '附加 Key ' + index, ref: legacy })
          }
        }
        this.entries = seeded
        this.store.save(seeded)
        return
      }
      const valid = stored.filter((entry) => entry !== null && typeof entry === 'object'
        && typeof entry.id === 'string' && entry.id !== ''
        && typeof entry.label === 'string' && entry.label.trim() !== ''
        && typeof entry.ref === 'string' && REF_PATTERN.test(entry.ref))
      const deduped: ZhipuKeyEntry[] = []
      const seenRefs = new Set<string>()
      for (const entry of valid.slice(0, ZHIPU_KEY_POOL_LIMIT)) {
        if (seenRefs.has(entry.ref)) continue
        seenRefs.add(entry.ref)
        deduped.push({ id: entry.id, label: entry.label.trim(), ref: entry.ref })
      }
      // 防御：主 Key 引用不在清单时补到最前并落盘，保证聊天路由凭据始终可被面板管理。
      if (!deduped.some((entry) => entry.ref === primary)) {
        deduped.unshift({ id: newKeyId(), label: '主 Key', ref: primary })
      }
      this.entries = deduped
      this.store.save(deduped)
    })()
    return await this.loaded
  }

  /** 描述单个引用是否已配置（异常一律按未配置，不让一把坏 Key 拖垮整个池）。 */
  private async isConfiguredRef(ref: string): Promise<boolean> {
    try {
      const info = await this.credentials.describe(credentialRef(ref))
      return info.configured === true
    } catch {
      return false
    }
  }

  /** 枚举池内全部 Key（含未配置条目，供面板管理）；Key 明文永不出现。 */
  async list(): Promise<ZhipuPoolKey[]> {
    await this.ensureLoaded()
    const primary = await this.primaryName()
    const result: ZhipuPoolKey[] = []
    for (const entry of orderEntries(this.entries, primary)) {
      result.push({
        id: entry.id,
        label: entry.label,
        ref: entry.ref,
        configured: await this.isConfiguredRef(entry.ref),
        primary: entry.ref === primary,
      })
    }
    return result
  }

  /** 池内原始成员（供面板重命名/删除按 id 定位；调用前会先确保已加载）。 */
  async entriesView(): Promise<ZhipuKeyEntry[]> {
    await this.ensureLoaded()
    return [...this.entries]
  }

  /** 追加一把 Key；引用与名称唯一性、容量上限在这里统一把关。 */
  async addEntry(entry: ZhipuKeyEntry): Promise<void> {
    await this.ensureLoaded()
    const normalized = normalizeKeyEntry(entry, this.entries)
    this.entries = [...this.entries, normalized]
    this.store.save(this.entries)
  }

  /** 按池内 id 删除一把 Key；主 Key 不允许删除（先切换主 Key 再删）。 */
  async removeEntry(id: string): Promise<void> {
    await this.ensureLoaded()
    const target = this.entries.find((entry) => entry.id === id)
    if (target === undefined) throw new ZhipuServiceError('Key 不在池内，可能已被删除。', 400)
    const primary = await this.primaryName()
    if (target.ref === primary) {
      throw new ZhipuServiceError('主 Key 不能直接删除：请先把其他 Key 设为主 Key。', 400)
    }
    this.entries = this.entries.filter((entry) => entry.id !== id)
    this.store.save(this.entries)
  }

  /** 按池内 id 重命名一把 Key（只改名称，不动凭据引用）。 */
  async renameEntry(id: string, label: string): Promise<void> {
    await this.ensureLoaded()
    const trimmed = typeof label === 'string' ? label.trim() : ''
    if (trimmed === '') throw new ZhipuServiceError('Key 名称不能为空。', 400)
    if (trimmed.length > ZHIPU_KEY_LABEL_MAX) throw new ZhipuServiceError('Key 名称不能超过 ' + ZHIPU_KEY_LABEL_MAX + ' 个字符。', 400)
    const target = this.entries.find((entry) => entry.id === id)
    if (target === undefined) throw new ZhipuServiceError('Key 不在池内，可能已被删除。', 400)
    this.entries = this.entries.map((entry) => entry.id === id ? { ...entry, label: trimmed } : entry)
    this.store.save(this.entries)
  }

  /** 按失败切换顺序解析全部已配置 Key（主 Key 在前）；一把都没有时抛 400。 */
  async ordered(): Promise<ZhipuResolvedKey[]> {
    await this.ensureLoaded()
    const primary = await this.primaryName()
    const resolved: ZhipuResolvedKey[] = []
    for (const entry of orderEntries(this.entries, primary)) {
      const value = await this.resolveValue(entry.ref)
      if (value !== null) resolved.push({ env: entry.ref, value })
    }
    if (resolved.length === 0) {
      throw new ZhipuServiceError('尚未配置智谱 Coding Plan API Key（Key 池为空或全部未配置）。', 400)
    }
    return resolved
  }

  /** 池内已配置 Key 数量（供 MCP 工具确定换 Key 重试上限）。 */
  async usableCount(): Promise<number> {
    return (await this.ordered()).length
  }

  /** 按失败切换顺序取第 attempt 把已配置 Key（attempt 从 0 开始）；越界抛 400。 */
  async resolveByAttempt(attempt: number): Promise<ZhipuResolvedKey> {
    const ordered = await this.ordered()
    const picked = ordered[attempt]
    if (picked === undefined) {
      throw new ZhipuServiceError('智谱 Key 池的 ' + ordered.length + ' 把 Key 均不可用。', 400)
    }
    return picked
  }

  /** 按引用名解析一把 Key；不在池内或未配置抛 400（按 Key 查用量前先经过这里校验）。 */
  async resolveByEnv(env: string): Promise<ZhipuResolvedKey> {
    await this.ensureLoaded()
    if (!this.entries.some((entry) => entry.ref === env)) {
      throw new ZhipuServiceError('引用名不在智谱 Key 池内：' + env, 400)
    }
    const value = await this.resolveValue(env)
    if (value === null) throw new ZhipuServiceError('智谱 Key 未配置：' + env, 400)
    return { env, value }
  }

  /** 解析单个引用；空值与解析失败统一按未配置处理（空值永不算已配置）。 */
  private async resolveValue(name: string): Promise<string | null> {
    try {
      const resolved = await this.credentials.resolve(credentialRef(name))
      const value = resolved?.value.trim()
      return value !== undefined && value !== '' ? value : null
    } catch {
      return null
    }
  }
}
