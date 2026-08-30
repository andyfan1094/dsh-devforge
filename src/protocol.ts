/**
 * dsh-devforge 协议定义 —— host 与 client 共享的类型与 API 路径常量。
 *
 * 入口说明：本文件是浏览器半边（client/）与宿主半边（routes.ts/forge.ts）
 * 的唯一契约来源；两边都从这里 import，保证字段改名时编译期即报错。
 */

/** /api/dsh-devforge 路由族前缀（与 routes.ts 的注册路径保持一致）。 */
export const DEVFORGE_API = {
  /** 规范清单（分版本）。 */
  standards: '/api/dsh-devforge/standards',
  /** 单篇规范正文。 */
  standard: '/api/dsh-devforge/standards/item',
  /** 服务生成任务列表。 */
  jobs: '/api/dsh-devforge/jobs',
  /** 单任务操作（取消）。 */
  job: '/api/dsh-devforge/jobs/item',
  /** 服务模板清单。 */
  templates: '/api/dsh-devforge/templates',
  /** 本机 DSH Web 重启请求。 */
  restart: '/api/dsh-devforge/restart',
  /** 远程运维统一主机摘要（SSH / WinRM 只读桥接）。 */
  remoteHosts: '/api/dsh-devforge/remote/hosts',
} as const

/** 远程运维 transport。 */
export type RemoteTransport = 'ssh' | 'winrm'

/** 统一主机可用能力位；浏览器据此避免展示不适配 transport 的操作。 */
export interface RemoteHostCapabilities {
  terminal: boolean
  transfer: boolean
  tunnel: boolean
  services: boolean
  processes: boolean
  cluster: boolean
}

/** 旧 SSH / WinRM 配置投影出的统一无密主机摘要。 */
export interface RemoteHostSummary {
  /** transport:alias，避免跨 transport 的别名冲突。 */
  id: string
  transport: RemoteTransport
  alias: string
  host: string
  port: number
  user: string
  /** 认证种类，仅用于展示；绝不包含密码、口令或私钥路径。 */
  auth: string
  description?: string
  environment?: string
  tags: string[]
  location?: string
  createdAt: number
  updatedAt: number
  /** WinRM 使用的 HTTP/HTTPS 传输；SSH 条目不带该字段。 */
  winrmTransport?: 'http' | 'https'
  capabilities: RemoteHostCapabilities
}

/** 一篇开发规范的摘要（列表用，不含正文）。 */
export interface StandardSummary {
  /** 文件名内唯一 id（如 v1/common）。 */
  id: string
  /** 规范标题（取自 markdown 一级标题）。 */
  title: string
  /** 适用范围标签（common/api/frontend/service 等）。 */
  tags: string[]
  /** 更新时间（epoch ms）。 */
  updatedAt: number
}

/** 一篇开发规范的完整内容。 */
export interface StandardDetail extends StandardSummary {
  /** markdown 正文。 */
  content: string
}

/** 服务生成任务状态机：queued → running → succeeded/failed/cancelled。 */
export type ForgeJobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'

/** 服务生成任务（面板与工具共用的展示形态）。 */
export interface ForgeJob {
  /** 任务 id（job-<时间戳>-<随机>）。 */
  id: string
  /** 任务名（用户可读）。 */
  name: string
  /** 服务模板 id。 */
  templateId: string
  /** 目标工作目录（服务落地位置）。 */
  targetDir: string
  /** 挂载的规范 id 列表（子代理系统提示注入顺序）。 */
  standardIds: string[]
  /** 追加需求描述（拼进首条消息）。 */
  requirements: string
  /** 状态。 */
  status: ForgeJobStatus
  /** 创建时间（epoch ms）。 */
  createdAt: number
  /** 最近更新时间（epoch ms）。 */
  updatedAt: number
  /** 关联的 DSH 会话 id（面板"打开会话"用）。 */
  sessionId?: string
  /** 子代理最近一条进度/错误信息。 */
  lastMessage?: string
}

/** 服务模板：预约束的一键生成流水线。 */
export interface ForgeTemplate {
  /** 模板 id。 */
  id: string
  /** 显示名。 */
  name: string
  /** 一句话说明。 */
  description: string
  /** 默认挂载的规范 id 列表。 */
  defaultStandardIds: string[]
  /** 首条消息模板（{requirements}/{targetDir} 占位符）。 */
  promptTemplate: string
  /** 是否内置。 */
  builtin: boolean
}

/** 创建任务的请求体。 */
export interface ForgeJobCreateRequest {
  /** 任务名。 */
  name: string
  /** 模板 id。 */
  templateId: string
  /** 目标目录。 */
  targetDir: string
  /** 覆盖默认规范列表（可选）。 */
  standardIds?: string[]
  /** 追加需求（可选）。 */
  requirements?: string
}
