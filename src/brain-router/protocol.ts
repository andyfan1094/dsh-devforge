/**
 * 主脑路由协议 —— 面板与宿主共用的类型与默认值。
 *
 * 功能语义（0.26.0）：会话主模型命中匹配规则（默认 GPT 系列）时，该主模型
 * 委派的子代理统一改道「工人模型」执行——主模型只负责做计划、找关键问题、
 * 指挥（项目管理员角色），具体干活交给便宜的工人模型，压低 GPT 系列模型
 * 的 token 开销。主模型未命中时保持内核默认行为（子代理继承主模型路由）。
 *
 * 设置持久化：宿主 settings 服务的 brain-router 命名空间（settings.yaml
 * 的 brain-router 节，热更新）；委派拦截点在子代理运行时入口（见 core.ts）。
 */

/** 主脑路由设置（settings.yaml 的 brain-router 节）。 */
export interface BrainRouterSettings {
  /** 总开关：关闭时子代理一律保持内核默认继承行为。 */
  enabled: boolean
  /** 主模型匹配正则（不区分大小写，匹配 "provider/model" 字符串，默认匹配 GPT 系列）。 */
  mainModelPattern: string
  /** 工人模型 provider id（留空 = 未配置，路由不生效）。 */
  workerProvider: string
  /** 工人模型 model id（留空 = 未配置，路由不生效）。 */
  workerModel: string
  /** 工人模型推理档位（留空 = 使用工人模型自己的默认档）。 */
  workerReasoningEffort: string
  /** 不参与改道的子代理 provider 清单（fork 复用主模型会话缓存，必须保持排除）。 */
  excludeProviders: string[]
  /** 主模型显式为子代理指定模型时是否仍强制改道（默认尊重显式选择）。 */
  overrideExplicit: boolean
}

/** 默认设置：默认匹配 GPT 系列；工人默认 GLM-5.3-Flash（本机 zai-coding-cn 提供方，辉哥指定）。 */
export const BRAIN_ROUTER_DEFAULTS: BrainRouterSettings = {
  enabled: false,
  mainModelPattern: 'gpt',
  workerProvider: 'zai-coding-cn',
  workerModel: 'glm-5.3-flash',
  workerReasoningEffort: '',
  excludeProviders: ['fork'],
  overrideExplicit: false,
}

/** 推理档位条目（面板档位下拉数据源）。 */
export interface BrainRouterCatalogEffort {
  /** 档位 id（写入 workerReasoningEffort 的值）。 */
  id: string
  /** 档位显示名。 */
  name: string
}

/** 模型目录条目（面板工人模型下拉数据源）。 */
export interface BrainRouterCatalogModel {
  /** 模型 id（写入 workerModel 的值）。 */
  id: string
  /** 模型显示名。 */
  name: string
  /** 该模型支持的推理档位清单（来自模型元数据；读取失败为空数组）。 */
  efforts: BrainRouterCatalogEffort[]
  /** 模型默认档位 id（面板标注「默认」）。 */
  defaultEffort?: string
}

/** 模型目录提供方（按 llm 注册的 provider 分组）。 */
export interface BrainRouterCatalogProvider {
  /** 提供方 id（写入 workerProvider 的值）。 */
  id: string
  /** 提供方显示名。 */
  name: string
  /** 该提供方下的模型清单；目录读取失败时为空数组。 */
  models: BrainRouterCatalogModel[]
}

/** 主脑路由状态（面板 GET 响应；settings 之外的运行时诊断一并下发）。 */
export interface BrainRouterStatus {
  /** 当前设置。 */
  settings: BrainRouterSettings
  /** 路由是否已生效（enabled 且工人模型已配置且拦截器已挂载）。 */
  active: boolean
  /** 匹配正则是否可编译；非法时路由永不命中，面板需标红提示。 */
  patternValid: boolean
  /** 委派拦截器是否已挂上子代理运行时（未挂载时 enabled 也不生效）。 */
  wrapperInstalled: boolean
}

/** brain-router 路由族路径（与 /api/dsh-devforge 前缀拼接后使用）。 */
export const BRAIN_ROUTER_API = {
  /** 读取/保存主脑路由设置。 */
  status: '/api/dsh-devforge/brain-router',
  /** 模型目录（工人模型下拉数据源）。 */
  catalog: '/api/dsh-devforge/brain-router/catalog',
} as const
