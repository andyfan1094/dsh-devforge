/**
 * 会话消息来源（producer-owned kind）登记。
 *
 * dsh 会话格式 **v4** 的契约（见 `@deepseek-ai/dsh-llm` 的 `MessageSourceMap`）：
 * 每个生产者在自己模块里声明专属 `kind`，**不存在通用的 `plugin` kind**。
 * 旧的 v3 写法 `{ kind: 'plugin', plugin: '<包名>' }` 会被 v4 准入直接拒绝：
 *
 *   format v4 message requires a producer-owned source kind
 *
 * 表现是整轮运行失败（`本轮运行失败`），因为注入发生在每一步之前。
 *
 * 本文件用**声明合并**把天工造梦及其内置飞书桥的 kind 登记进去，
 * 之后消息按两个正交的语义轴书写：`kind` 说明**谁产生的**，
 * `form` 说明**产生的是什么**（snapshot / notice / instructions / …）。
 *
 * 注：编译期依赖 @deepseek-ai/dsh-llm 的类型（本地 0.1.2-rc.1 仍有 plugin 兜底，
 * 运行时的 0.1.7-rc.2 已移除）—— 这里登记自己的 kind 对两端都成立。
 */

import type { ContextFormed } from '@deepseek-ai/dsh-llm/message'

declare module '@deepseek-ai/dsh-llm/message' {
  interface MessageSourceMap {
    /** 天工造梦本体：记忆快照注入、内部 LLM 调用等。 */
    'dsh-devforge': { kind: 'dsh-devforge' } & ContextFormed
    /** 天工造梦内置的飞书桥（与本体区分生产者身份，便于按来源展示）。 */
    'dsh-feishu': { kind: 'dsh-feishu' } & ContextFormed
    /** 天工造梦内置的企业微信智能机器人桥。 */
    'dsh-wecom': { kind: 'dsh-wecom' } & ContextFormed
  }
}

/** 天工造梦本体的消息生产者标识。 */
export const DEVFORGE_SOURCE_KIND = 'dsh-devforge' as const

/** 天工造梦内置飞书桥的消息生产者标识。 */
export const FEISHU_SOURCE_KIND = 'dsh-feishu' as const

/** 天工造梦内置企微桥的消息生产者标识。 */
export const WECOM_SOURCE_KIND = 'dsh-wecom' as const

/** 迁移前缀：宿主把 v3 的 `{ kind: 'plugin', plugin: X }` 重写成 `plugin:X` 形态的 kind。 */
const LEGACY_PLUGIN_PREFIX = 'plugin:'

/**
 * 历史会话里的旧 kind 判定：v3 的通用 `plugin`，
 * 以及宿主 v3→v4 迁移对第三方插件产出的 `plugin:<包名>`。
 * 新写入的消息已不用这两种形态，但读取历史时必须继续认。
 */
export function isLegacyInjectedKind(kind: unknown): boolean {
  return typeof kind === 'string' && (kind === 'plugin' || kind.startsWith(LEGACY_PLUGIN_PREFIX))
}

/**
 * source 是否属于给定生产者集合，同时覆盖三种历史形态：
 * 新 kind、迁移产物 `plugin:<名>`、未迁移的 v3 写法 `kind='plugin' + plugin='<名>'`。
 */
function sourceBelongsTo(source: unknown, names: readonly string[]): boolean {
  if (source === null || typeof source !== 'object') return false
  const record = source as { kind?: unknown; plugin?: unknown }
  const kind = record.kind
  if (typeof kind === 'string' && names.includes(kind)) return true
  if (typeof kind === 'string' && kind.startsWith(LEGACY_PLUGIN_PREFIX)) {
    return names.includes(kind.slice(LEGACY_PLUGIN_PREFIX.length))
  }
  return kind === 'plugin' && typeof record.plugin === 'string' && names.includes(record.plugin)
}

/** 是否为本插件**本体**产生的消息（不含内置飞书桥）。 */
export function isDevforgeSource(source: unknown): boolean {
  return sourceBelongsTo(source, [DEVFORGE_SOURCE_KIND])
}

/** 是否为本插件**家族**（本体 + 内置飞书桥/企微桥）产生的消息。 */
export function isDevforgeFamilySource(source: unknown): boolean {
  return sourceBelongsTo(source, [DEVFORGE_SOURCE_KIND, FEISHU_SOURCE_KIND, WECOM_SOURCE_KIND])
}
