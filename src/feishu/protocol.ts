/** 飞书兼容路由与浏览器侧数据契约；Host 不通过这些接口返回任何明文密钥。 */
export const FEISHU_API_BASE = '/api/dsh-feishu'

/** 飞书配置面板可见配置。 */
export interface FeishuPanelConfig {
  enabled: boolean
  appId: string
  appSecretConfigured: boolean
  appSecretMask: string
  /** 机器人列表（多机器人 0.47.0 起）；Secret 脱敏。 */
  bots: FeishuBotView[]
  /** 通知机器人 id（空 = 自动选首个含通知角色的启用机器人）。 */
  notifyBotId: string
  domain: string
  cwd: string
  allowUsers: string[]
  ack: boolean
  ackReaction: string
  provider: string
  model: string
  reasoningEffort: string
  agentPreset: string
  groupMode: 'all' | 'mention'
  welcomeText: string
  chatCwds: Record<string, string>
  asrBaseUrlConfigured: boolean
  asrApiKeyConfigured: boolean
  asrModel: string
  syncCatchUp: boolean
  /** 电脑端任务完成时通过飞书卡片通知。 */
  notifyOnComplete: boolean
  /** 通知目标 chat_id（群或单人）。 */
  notifyChatId: string
}

/** 飞书配置更新载荷；App Secret 留空时 Host 保留旧值。 */
export interface FeishuConfigPatch {
  enabled?: boolean
  appId?: string
  appSecret?: string
  /** 机器人列表（多机器人 0.47.0 起）；项内 appSecret 留空时 Host 保留同 id 旧值。 */
  bots?: FeishuBotPatch[]
  /** 通知机器人 id；留空时 Host 自动选首个含通知角色的启用机器人。 */
  notifyBotId?: string
  domain?: string
  cwd?: string
  allowUsers?: string[]
  ack?: boolean
  ackReaction?: string
  provider?: string
  model?: string
  reasoningEffort?: string
  agentPreset?: string
  groupMode?: 'all' | 'mention'
  welcomeText?: string
  syncCatchUp?: boolean
  notifyOnComplete?: boolean
  notifyChatId?: string
}

/** 机器人角色：chat 只聊天 / notify 只通知 / both 聊天兼可作通知出口。 */
export type FeishuBotRole = 'chat' | 'notify' | 'both'

/** 面板可见的机器人条目（Secret 脱敏）。 */
export interface FeishuBotView {
  id: string
  name: string
  appId: string
  role: FeishuBotRole
  enabled: boolean
  appSecretConfigured: boolean
  appSecretMask: string
}

/** 机器人配置补丁。 */
export interface FeishuBotPatch {
  id?: string
  name?: string
  appId?: string
  /** 留空时 Host 保留同 id 机器人的旧值。 */
  appSecret?: string
  role?: FeishuBotRole
  enabled?: boolean
}

/** 一个独立飞书聊天会话的运行摘要。 */
export interface FeishuSessionSummary {
  chatId: string
  /** 归属机器人 id（多机器人 0.47.0 起）。 */
  botId?: string
  sessionId: string
  status: string
  createdAt: number
  provider: string
  model: string
  effort: string
  preset: string
}

/** 单机器人连接状态。 */
export interface FeishuBotStatus {
  id: string
  name: string
  appId: string
  role: FeishuBotRole
  state: string
  connected: boolean
  lastError?: string
}

/** 当前飞书桥状态。 */
export interface FeishuStatus {
  state: string
  connected: boolean
  lastError?: string
  lastCardError?: string
  lastSessionError?: string
  /** 逐机器人连接状态（多机器人 0.47.0 起）。 */
  bots?: FeishuBotStatus[]
  model?: {
    provider?: string
    model?: string
    effort?: string
    reasoningEffort?: string
    preset?: string
    agentPreset?: string
    followDefault?: boolean
  }
  independentSessions?: FeishuSessionSummary[]
}

/** 推理级别选项。 */
export interface FeishuReasoningEffort {
  id: string
  name?: string
}

/** Provider 选项。 */
export interface FeishuProviderOption {
  provider: string
  name: string
}

/** Model 选项。 */
export interface FeishuModelOption {
  provider: string
  model: string
  name: string
  reasoningEfforts: FeishuReasoningEffort[]
  defaultReasoningEffort?: string
}

/** Agent 预设选项。 */
export interface FeishuPresetOption {
  id: string
  name: string
  description?: string
  broken?: string
}

/** 飞书模型与预设目录。 */
export interface FeishuModelOptions {
  current: {
    provider: string
    model: string
    reasoningEffort: string
    agentPreset: string
    followDefault: boolean
    error?: string
  }
  providers: FeishuProviderOption[]
  models: FeishuModelOption[]
  presets: FeishuPresetOption[]
}
