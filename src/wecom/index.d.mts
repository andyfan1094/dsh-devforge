/**
 * 企微智能机器人桥（dsh-wecom）的最小类型面。
 *
 * 运行时实现保持 .mjs（与 feishu/ 同策略：不进 strict 类型检查，避免为类型化重写行为），
 * 这里只声明主入口真正消费的导出，保证 index.ts 在 strict 下可编译。
 */

/** 企微桥启动配置（与 store.mjs 的归一化字段同形）。 */
export interface WecomCapabilityConfig {
  /** 总开关；false 时不读配置、不建连接。 */
  enabled: boolean
  /** 智能机器人 BotID（可由环境变量 DSH_WECOM_BOT_ID 覆盖）。 */
  botId?: string
  /** 长连接 Secret（可由环境变量 DSH_WECOM_SECRET 覆盖；绝不落日志）。 */
  secret?: string
  /** 会话工作目录。 */
  cwd?: string
  /** Agent 预设 id，默认 cordis。 */
  agentPreset?: string
  /** 群聊 @ 前缀剥离用的机器人显示名。 */
  botName?: string
  /** 进入会话时的欢迎语，空串表示不发。 */
  welcomeText?: string
  /** 配置文件路径（默认 ~/.dsh/dsh-wecom.json）。 */
  storePath?: string
}

/** 企微桥实例：ready 表示启动流程结束（成功或失败均已落日志）。 */
export interface WecomCapability {
  ready: Promise<void>
  status(): Record<string, unknown>
  dispose(): Promise<void>
}

export declare function createWecomCapability(ctx: unknown, config?: WecomCapabilityConfig): WecomCapability
