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

/**
 * 合并 openai 配置：面板/补丁显式配置优先，缺失项回落到 store.db 副本。
 * 唯一例外是官网生图开关 siteImage，见函数内注释。
 */
export function mergeOpenAiConfig(
  value: OpenAiConfigInput | undefined,
  stored: Partial<OpenAiCapabilityConfig>,
): OpenAiCapabilityConfig {
  // 官网生图开关以 store.db 为准（不按配置段优先）：宿主 schemastery 会为缺失字段补出
  // 默认对象 { enabled: false, model: '' }，与「用户显式关闭」在类型上无法区分。若按
  // 配置段优先，登录后开启的线路每次启动都会被这个默认对象顶掉（2026-10-14 生产实证：
  // store.db 里 enabled=true，运行时仍是 false，generate_image 静默回落个人中转）。
  // 该字段由插件自己写（store.db 主写 + 宿主段双写），store.db 才是权威副本；
  // 只有它从未写过时才采用配置段值，兼容用户在补丁里手填显式配置。
  const siteImage = stored.siteImage ?? value?.siteImage
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
