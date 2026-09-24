/**
 * 模型目录 —— 全 provider 模型清单与推理档位（原主脑路由 catalog 能力的中立迁移，
 * 2026-09-23 主脑路由下线后由记忆工作台等面板继续使用）。
 *
 * 职责边界：枚举已注册 LLM provider 及其声明模型，逐模型附带推理档位元数据；
 * 单个 provider 目录失败不拖垮整体（模型列表为空）；llm 缺失时返回空目录。
 */
import type { Context } from '@deepseek-ai/cordis'

/** 单个推理档位。 */
export interface ModelCatalogEffort {
  id: string
  name: string
}

/** 单个 provider 的模型目录。 */
export interface ModelCatalogProvider {
  id: string
  name: string
  models: Array<{ id: string; name: string; efforts: ModelCatalogEffort[]; defaultEffort?: string }>
}

/** 模型目录路由路径（loopback-only）。 */
export const MODEL_CATALOG_API = {
  /** GET：全 provider 模型目录（含推理档位）。 */
  catalog: '/api/dsh-devforge/model-catalog',
} as const

/** 目录读取所需的 llm 服务最小形状（与宿主 LlmService 的可选方法对齐）。 */
interface LlmServiceLike {
  listProviders?: () => Array<{ id: string; name?: string }>
  listModels?: (providerId: string) => Promise<Array<{ id: string; name?: string }>>
  resolveModelInfo?: (providerId: string, modelId: string) => Promise<{ reasoning?: { efforts?: Array<{ id: string; name?: string; description?: string }>; defaultEffort?: string } }>
}

/** 单模型档位解析的兜底结果（元数据不可读时不提供档位下拉）。 */
const EMPTY_EFFORTS: { efforts: ModelCatalogEffort[]; defaultEffort?: string } = { efforts: [] }

/**
 * 读取单个模型的推理档位元数据。
 * @param llm - llm 服务（resolveModelInfo 缺失时直接回落空档位）。
 * @returns 档位清单与默认档位；任何失败（含 5 秒超时）都回落空档位，不拖垮目录。
 */
async function resolveModelEfforts(llm: LlmServiceLike, providerId: string, modelId: string): Promise<{ efforts: ModelCatalogEffort[]; defaultEffort?: string }> {
  if (llm.resolveModelInfo === undefined) return EMPTY_EFFORTS
  try {
    const timeout = new Promise<never>((_, reject) => { setTimeout(() => { reject(new Error('模型元数据读取超时')) }, 5000) })
    const info = await Promise.race([llm.resolveModelInfo(providerId, modelId), timeout])
    const raw = info?.reasoning?.efforts
    if (!Array.isArray(raw)) return EMPTY_EFFORTS
    const efforts = raw
      .filter((effort) => typeof effort?.id === 'string' && effort.id !== '')
      .map((effort) => ({ id: effort.id, name: effort.name ?? effort.id }))
    return { efforts, ...(typeof info?.reasoning?.defaultEffort === 'string' ? { defaultEffort: info.reasoning.defaultEffort } : {}) }
  } catch {
    return EMPTY_EFFORTS
  }
}

/**
 * 读取模型目录（面板模型下拉数据源）：枚举全部已注册 provider 及其声明模型，
 * 并逐模型附带推理档位（档位下拉的数据源）。单个 provider 目录失败不拖垮
 * 整体（返回空模型列表）；llm 缺失时返回空目录。
 */
export async function listModelCatalog(ctx: Context): Promise<ModelCatalogProvider[]> {
  const llm = ctx.get('llm') as LlmServiceLike | undefined
  if (llm?.listProviders === undefined || llm?.listModels === undefined) return []
  const providers = llm.listProviders()
  return Promise.all(providers.map(async (provider) => {
    try {
      const models = await llm.listModels!(provider.id)
      const entries = await Promise.all(models.map(async (model) => {
        const meta = await resolveModelEfforts(llm, provider.id, model.id)
        return { id: model.id, name: model.name ?? model.id, efforts: meta.efforts, ...(meta.defaultEffort !== undefined ? { defaultEffort: meta.defaultEffort } : {}) }
      }))
      return {
        id: provider.id,
        name: provider.name ?? provider.id,
        models: entries,
      }
    } catch {
      // 该提供方目录暂不可读（密钥/网络等）：面板仍可看到 provider，模型列表为空。
      return { id: provider.id, name: provider.name ?? provider.id, models: [] }
    }
  }))
}

/** 组装模型目录路由族（单条 GET；loopback 围栏与面板路由族同款）。 */
export function makeModelCatalogRoute(ctx: Context): import('@deepseek-ai/dsh-host-webserver').WebRoute {
  return {
    kind: 'exact',
    path: MODEL_CATALOG_API.catalog,
    handler: async (_req, res) => {
      const body = JSON.stringify({ ok: true, providers: await listModelCatalog(ctx) })
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'content-length': Buffer.byteLength(body) })
      res.end(body)
    },
  }
}
