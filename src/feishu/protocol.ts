/** 飞书兼容路由与浏览器侧数据契约；Host 不通过这些接口返回任何明文密钥。 */
export const FEISHU_API_BASE = '/api/dsh-feishu'

/** 飞书面板可见配置。 */
export interface FeishuPanelConfig {
  enabled: boolean
  appId: string
  appSecretConfigured: boolean
  appSecretMask: string
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

/** 一个独立飞书聊天会话的运行摘要。 */
export interface FeishuSessionSummary {
  chatId: string
  sessionId: string
  status: string
  createdAt: number
  provider: string
  model: string
  effort: string
  preset: string
}

/** 当前飞书桥状态。 */
export interface FeishuStatus {
  state: string
  connected: boolean
  lastError?: string
  lastCardError?: string
  lastSessionError?: string
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
