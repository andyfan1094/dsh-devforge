/**
 * 模型删除墓碑（tombstones）与模型删除的公共服务端校验。
 *
 * 业务目的：设置页各 Coding Plan 供应商的 provider.models 支持「只增不减」合并补齐，
 * 用户在面板删除模型后，下一次启动自动补齐（scheduleAutoEnsureModels 的 ensure*）会把
 * 内置默认模型池原样合并回来，刚删掉的模型「复活」。墓碑把「用户删过这个模型」的意图
 * 持久化到 store.db 设置域（deleted-models），启动合并时跳过这些 id。
 *
 * 语义边界（必须与调用方约定一致）：
 * - 墓碑只约束「启动自动补齐」：ensure* 的 restore=false 路径合并时跳过墓碑模型；
 * - 面板手动同步/补齐（restore=true，用户主动点击）视为全量恢复：正常合并全部模型，
 *   成功后清除对应墓碑——用户明确的恢复意图优先于墓碑；
 * - 手动拉取官方清单（fetchModelsFromOfficial / fetchOfficialModels 等）同样视为全量恢复；
 * - OpenAI 中转站端点模型不落墓碑：其模型目录由端点 /v1/models 同步驱动，启动链路
 *   只迁移档案不会复活被删模型，落墓碑反而会干扰后续同步语义。
 */
import type { DatabaseSync } from 'node:sqlite'
import type { Context } from '@deepseek-ai/cordis'
import { SettingsConflictError } from '@deepseek-ai/dsh-settings'
import { settingsNamespace } from './settings-compat.ts'
import { deepEqualJson } from './provider-settings.ts'
import { getDb, getSettings, putSettings } from './store/db.ts'

/** 墓碑在 store.db 设置域的键名（getSettings/putSettings 的 domain）。 */
const DELETED_MODELS_DOMAIN = 'deleted-models'

/** 墓碑存储形状：provider id → 被删除的模型 id 清单。 */
export interface DeletedModelsSettings {
  providers: Record<string, string[]>
}

/** 从 store.db 读取墓碑并做防御式规整（坏数据一律视为空墓碑，不让历史脏数据炸掉启动链路）。 */
function readTombstones(db: DatabaseSync): DeletedModelsSettings {
  const stored = getSettings<unknown>(db, DELETED_MODELS_DOMAIN)
  if (stored === null || typeof stored !== 'object') return { providers: {} }
  const providers = (stored as { providers?: unknown }).providers
  if (providers === null || typeof providers !== 'object' || Array.isArray(providers)) return { providers: {} }
  const result: Record<string, string[]> = {}
  for (const [providerId, ids] of Object.entries(providers as Record<string, unknown>)) {
    if (!Array.isArray(ids)) continue
    const valid = [...new Set(ids.filter((id): id is string => typeof id === 'string' && id !== ''))]
    if (valid.length > 0) result[providerId] = valid
  }
  return { providers: result }
}

/** 读取某 provider 的墓碑清单；无记录返回空数组。 */
export function listDeletedModels(db: DatabaseSync, providerId: string): string[] {
  return readTombstones(db).providers[providerId] ?? []
}

/** 合并写入墓碑：去重、trim；没有新增时不落盘（避免无意义的 store.db 写放大）。 */
export function addDeletedModels(db: DatabaseSync, providerId: string, ids: readonly string[]): void {
  const wanted = [...new Set(ids.map((id) => id.trim()).filter((id) => id !== ''))]
  if (wanted.length === 0) return
  const stored = readTombstones(db)
  const current = stored.providers[providerId] ?? []
  const merged = [...new Set([...current, ...wanted])]
  if (merged.length === current.length) return
  stored.providers[providerId] = merged
  putSettings(db, DELETED_MODELS_DOMAIN, stored)
}

/** 从墓碑移除若干 id：不存在时静默；provider 清单清空后整键移除，保持存储干净。 */
export function removeDeletedModels(db: DatabaseSync, providerId: string, ids: readonly string[]): void {
  const drop = new Set(ids)
  if (drop.size === 0) return
  const stored = readTombstones(db)
  const current = stored.providers[providerId]
  if (current === undefined) return
  const next = current.filter((id) => !drop.has(id))
  if (next.length === current.length) return
  if (next.length === 0) delete stored.providers[providerId]
  else stored.providers[providerId] = next
  putSettings(db, DELETED_MODELS_DOMAIN, stored)
}

/**
 * restore（手动全量恢复）成功后清除「实际已恢复回来」的模型的墓碑。
 * candidateIds 是该 provider 的内置默认模型池 id；只清 merged 结果里真实存在的 id，
 * 防止上游目录已下线的模型（如硅基流动精选清单）墓碑被误清后又被其它链路复活。
 */
export function clearRestoredTombstones(db: DatabaseSync, providerId: string, candidateIds: readonly string[], mergedProvider: unknown): void {
  const present = new Set(collectModelIds(mergedProvider))
  removeDeletedModels(db, providerId, candidateIds.filter((id) => present.has(id)))
}

/** 从 provider 记录或 models 数组中收集模型 id（防御式，坏形状忽略）。 */
function collectModelIds(value: unknown): string[] {
  const models = Array.isArray(value)
    ? value
    : value !== null && typeof value === 'object' && Array.isArray((value as { models?: unknown }).models)
      ? (value as { models: unknown[] }).models
      : []
  const ids: string[] = []
  for (const item of models) {
    if (item === null || typeof item !== 'object') continue
    const id = (item as { id?: unknown }).id
    if (typeof id === 'string' && id !== '') ids.push(id)
  }
  return ids
}

/**
 * 规整删除请求的 ids：必须为非空数组、每项 trim 后非空、去重；
 * 任一不满足即抛 400「ids 不能为空」（errorFactory 由各 service 注入自家错误类型）。
 */
export function normalizeDeleteIds(raw: unknown, errorFactory: (message: string, status: number) => Error): string[] {
  if (!Array.isArray(raw) || raw.length === 0) throw errorFactory('ids 不能为空', 400)
  const result: string[] = []
  for (const item of raw) {
    if (typeof item !== 'string') throw errorFactory('ids 不能为空', 400)
    const trimmed = item.trim()
    if (trimmed === '') throw errorFactory('ids 不能为空', 400)
    if (!result.includes(trimmed)) result.push(trimmed)
  }
  if (result.length === 0) throw errorFactory('ids 不能为空', 400)
  return result
}

/**
 * 删除前的引用保护：主脑路由开启、工人模型命中待删 id 且工人 provider 就是当前 provider 时
 * 拒绝删除，提示先到主脑路由页签更换工人模型（brain-router 命名空间未注册时按未开启处理）。
 */
export function assertModelsNotReferencedByBrainRouter(
  ctx: Pick<Context, 'settings'>,
  providerId: string,
  ids: ReadonlySet<string>,
  errorFactory: (message: string, status: number) => Error,
): void {
  const section = ctx.settings.get(settingsNamespace('brain-router')) as
    | { enabled?: unknown; workerProvider?: unknown; workerModel?: unknown }
    | undefined
  if (section?.enabled !== true) return
  const workerModel = typeof section.workerModel === 'string' ? section.workerModel.trim() : ''
  const workerProvider = typeof section.workerProvider === 'string' ? section.workerProvider.trim() : ''
  if (workerModel === '' || workerProvider !== providerId || !ids.has(workerModel)) return
  throw errorFactory('模型正被主脑路由的工人模型引用，请先在主脑路由页签更换工人模型', 400)
}

/**
 * 墓碑式删除的公共实现（zhipu zai / zhipu official / minimax / ark agent / ark coding /
 * siliconflow 六条路由共用），顺序固定：
 * 1) 主脑路由引用保护 → 2) 保留保护（至少保留一个模型）→
 * 3) 先立碑（设置写回失败时墓碑已就位，防启动复活；重删幂等，restore 会清碑）→
 * 4) mutate 写回 models（沿用 SettingsConflictError 重试 2 次范式）。
 * 成功后由调用方自行回读 status 返回。
 */
export async function deleteProviderModelsWithTombstone(options: {
  ctx: Pick<Context, 'settings'>
  providerId: string
  ids: string[]
  errorFactory: (message: string, status: number) => Error
}): Promise<void> {
  const { ctx, providerId, ids, errorFactory } = options
  const namespace = settingsNamespace('llm-pi-ai')
  const idSet = new Set(ids)
  assertModelsNotReferencedByBrainRouter(ctx, providerId, idSet, errorFactory)
  const readModels = (): Array<Record<string, unknown>> => {
    const section = ctx.settings.get(namespace) as { providers?: Record<string, { models?: unknown }> } | undefined
    const models = section?.providers?.[providerId]?.models
    return Array.isArray(models) ? models as Array<Record<string, unknown>> : []
  }
  const withoutDeleted = (models: Array<Record<string, unknown>>): Array<Record<string, unknown>> =>
    models.filter((model) => !(model !== null && typeof model === 'object' && typeof model.id === 'string' && idSet.has(model.id)))
  // 保留保护：删完为空说明用户想清空目录，直接拒绝且不落任何墓碑。
  if (withoutDeleted(readModels()).length === 0) throw errorFactory('至少保留一个模型', 400)
  // 先立碑后动土：此刻起该模型即使设置写回失败也不会被启动补齐复活。
  addDeletedModels(getDb(), providerId, ids)
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const descriptor = ctx.settings.describe().find((item) => item.ns === namespace)
    if (descriptor === undefined) throw errorFactory('DSH 模型设置服务尚未注册 llm-pi-ai。', 409)
    const current = readModels()
    const next = withoutDeleted(current)
    if (next.length === 0) throw errorFactory('至少保留一个模型', 400)
    try {
      // 待删 id 已不在目录（例如上一轮已删或本来就不在）时跳过写入，避免空转 bump revision。
      if (!deepEqualJson(next, current)) {
        await ctx.settings.mutate(namespace, [{ op: 'set', path: ['providers', providerId, 'models'], value: next }], descriptor.revision)
      }
      return
    } catch (error) {
      if (error instanceof SettingsConflictError) {
        if (attempt === 1) throw errorFactory('模型设置并发更新，请重试。', 409)
        continue
      }
      throw error
    }
  }
  throw errorFactory('模型设置并发更新，请重试。', 409)
}
