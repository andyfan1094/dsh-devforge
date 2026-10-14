/**
 * openai 能力配置的兜底合并。
 *
 * 抽成独立纯函数模块（不依赖 cordis Context），既让配置来源只有一条链路，
 * 也便于用 node --experimental-strip-types 直接单测（index.ts 含参数属性，strip-only 加载不了）。
 *
 * 背景：面板里的「官网生图」等设置只写 store.db（openai.settings），插件配置段（profile）
 * 通常没有 openai 子段。若只读配置段，siteImage 会永远取不到——重启后设置丢失，
 * generate_image 回落到中转端点并报「尚未配置 OpenAI 中转站 API Key」（0.49.1 修复）。
 */
import type { OpenAiCapabilityConfig } from './service.ts'

/** openai 配置段输入：面板快照里可能带 null，统一按缺省处理。 */
export type OpenAiConfigInput = { [K in keyof OpenAiCapabilityConfig]?: OpenAiCapabilityConfig[K] | null }

/** 合并 openai 配置：插件配置段（profile）优先，缺失项回落到 store.db 副本。 */
export function mergeOpenAiConfig(
  value: OpenAiConfigInput | undefined,
  stored: Partial<OpenAiCapabilityConfig>,
): OpenAiCapabilityConfig {
  const siteImage = value?.siteImage ?? stored.siteImage
  return {
    enabled: value?.enabled ?? stored.enabled ?? true,
    baseURL: value?.baseURL ?? stored.baseURL ?? '',
    apiKeyEnv: value?.apiKeyEnv ?? stored.apiKeyEnv ?? 'OPENAI_GATEWAY_API_KEY',
    imageModel: value?.imageModel ?? stored.imageModel ?? '',
    endpoints: value?.endpoints?.length ? value.endpoints : stored.endpoints ?? [],
    timeoutMs: value?.timeoutMs ?? stored.timeoutMs ?? 300000,
    ...(siteImage !== undefined && siteImage !== null ? { siteImage } : {}),
  }
}
