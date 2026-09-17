/**
 * 硅基流动 SiliconFlow 协议 —— 类型与 API 路径常量（纯类型，无 Node 依赖）。
 */

/** 硅基流动路由族。 */
export const SILICONFLOW_API = {
  status: '/api/dsh-devforge/siliconflow/status',
  ensure: '/api/dsh-devforge/siliconflow/ensure',
  models: '/api/dsh-devforge/siliconflow/models',
} as const

/** 硅基流动状态（面板卡片）。 */
export interface SiliconFlowStatus {
  enabled: boolean
  credentialConfigured: boolean
  credentialWritable: boolean
  providerConfigured: boolean
  /** 只嵌入模式：true=同步对话模型目录；false=目录冻结，仅保留向量用途（bge-m3 走 /embeddings，不依赖本列表）。 */
  syncChatModels: boolean
  /** 已配置进 DSH 模型目录的模型 id。 */
  models: Array<{ id: string; configured: boolean; free: boolean }>
}
