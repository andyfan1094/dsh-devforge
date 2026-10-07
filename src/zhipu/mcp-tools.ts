/** 智谱官方 MCP 工具通道——2026-10-07 辉哥定稿：全量下架。
 * 沿革：0.40.1 搜索类下架（zhipu_web_search / zhipu_zread_search 不再注册）；
 * 0.41.17 读取类一并下架（zhipu_web_reader / zhipu_zread_read_file / zhipu_zread_repo_structure）。
 * 模型侧联网检索一律走天工造梦官网渠道 modagentai_web_search，本文件仅保留空实现兼容既有激活链与配置热更新。 */
import type { Context } from '@deepseek-ai/cordis'

/** 激活配置（保留类型兼容旧配置文件；enabled/timeoutMs 已无实际效果）。 */
export interface ZhipuMcpActivationConfig {
  /** 历史开关，保留兼容，不再生效。 */
  enabled: boolean
  /** 历史超时，保留兼容，不再生效。 */
  timeoutMs: number
}

/** 不再注册任何智谱工具；保留空实现使 index.ts 激活链与热更新逻辑无需感知下架。 */
export function activateZhipuMcpTools(_ctx: Context, _config: ZhipuMcpActivationConfig, _resolveApiKey: (attempt: number) => Promise<string>): { dispose: () => void } {
  return { dispose: () => undefined }
}
