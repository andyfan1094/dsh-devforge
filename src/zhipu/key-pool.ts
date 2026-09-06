/** 智谱 Coding Plan Key 池：主 Key + 固定槽位附加 Key 的统一枚举、按序解析与失败切换判定。 */
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { ZhipuServiceError } from './errors.ts'
import type { ZhipuPoolKey } from './protocol.ts'

export type { ZhipuPoolKey }

/** 主 Key 之后的附加 Key 槽位数量（引用名固定为 <主Key>_2 … _<N+1>）。 */
export const ZHIPU_KEY_POOL_SLOTS = 5

/** 生成主 Key 之后的固定槽位引用名列表（与主 Key 是否配置无关）。 */
export function poolSlotNames(primary: string, slots = ZHIPU_KEY_POOL_SLOTS): string[] {
  const names: string[] = []
  for (let index = 2; index < 2 + slots; index += 1) names.push(primary + '_' + index)
  return names
}

/** 池的完整引用顺序：主 Key 在前，槽位按序跟随；主 Key 与槽位重名时去重保持首次出现。 */
export function poolReferenceOrder(primary: string): string[] {
  const order = [primary, ...poolSlotNames(primary)]
  const seen = new Set<string>()
  const unique: string[] = []
  for (const name of order) {
    if (seen.has(name)) continue
    seen.add(name)
    unique.push(name)
  }
  return unique
}

/** 按引用顺序规整池清单：全部槽位都列出（供面板管理），configured 标记是否可用。 */
export function normalizePoolKeys(primary: string, configuredByName: Record<string, boolean>): ZhipuPoolKey[] {
  return poolReferenceOrder(primary).map((env) => ({ env, configured: configuredByName[env] === true, primary: env === primary }))
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

/** 智谱 Key 池：所有官方调用的 Key 来源。 */
export class ZhipuKeyPool {
  private readonly credentials: ZhipuCredentialLike
  /** 主 Key 引用名提供者（聊天路由 provider.apiKeyEnv 优先，回落插件配置）。 */
  private readonly primaryName: () => Promise<string>

  constructor(credentials: ZhipuCredentialLike, primaryName: () => Promise<string>) {
    this.credentials = credentials
    this.primaryName = primaryName
  }

  /** 当前主 Key 引用名。 */
  async primary(): Promise<string> {
    return await this.primaryName()
  }

  /** 枚举池内全部引用（含未配置槽位，供面板管理）；Key 永不出现。 */
  async list(): Promise<ZhipuPoolKey[]> {
    const primary = await this.primary()
    const names = poolReferenceOrder(primary)
    const configuredByName: Record<string, boolean> = {}
    // 逐个 describe（凭据文件读取很快；并发竞态只会带来一次刷新延迟，不影响正确性）。
    for (const name of names) {
      try {
        const info = await this.credentials.describe(credentialRef(name))
        configuredByName[name] = info.configured === true
      } catch {
        // 单个引用描述失败按未配置处理，不让一把异常 Key 拖垮整个池。
        configuredByName[name] = false
      }
    }
    return normalizePoolKeys(primary, configuredByName)
  }

  /** 按序解析全部已配置 Key（主 Key 在前）；一把都没有时抛 400，消息可直呈面板。 */
  async ordered(): Promise<ZhipuResolvedKey[]> {
    const primary = await this.primary()
    const resolved: ZhipuResolvedKey[] = []
    for (const name of poolReferenceOrder(primary)) {
      const value = await this.resolveValue(name)
      if (value !== null) resolved.push({ env: name, value })
    }
    if (resolved.length === 0) {
      throw new ZhipuServiceError('尚未配置智谱 Coding Plan API Key（主 Key 与附加 Key 槽位均为空）。', 400)
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

  /** 按引用名解析一把 Key；未配置或不在池内抛 400（面板按 Key 查用量时先经过这里校验）。 */
  async resolveByEnv(env: string): Promise<ZhipuResolvedKey> {
    const primary = await this.primary()
    if (!poolReferenceOrder(primary).includes(env)) {
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
