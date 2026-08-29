/**
 * 飞书能力激活 —— vendored dsh-feishu 桥接为 devforge 内部表面。
 *
 * 关键边界：飞书 apply() 内部自带 ctx.effect(dispose) 注册与 WS 长连接生命周期；
 * 本激活层只透传配置（storePath 原样指向 ~/.dsh/dsh-feishu.json，凭据零迁移）。
 * 铁律：同一 appId 只允许一个 WSClient——切换期间旧 dsh-feishu 必须先禁用。
 */
import { apply as feishuApply } from './index.mjs'

/** 飞书子配置。 */
export interface FeishuCapabilityConfig {
  /** 总开关：true 时启动飞书 WS 桥与配置/状态路由。 */
  enabled: boolean
  /** 透传给飞书桥的启动配置（与旧 cordis.patch.yml 行同字段）。 */
  bootstrap?: Record<string, unknown>
}

/** 激活飞书 capability；返回同步 disposer（内部 await 收尾，与 cordis 卸载兼容）。 */
export function activateFeishu(ctx: import('@deepseek-ai/cordis').Context, config: FeishuCapabilityConfig): { dispose(): void } {
  if (!config.enabled) return { dispose() {} }

  // 飞书 apply 会自行 ctx.effect 注册卸载钩子；为让 devforge sync() 能主动卸旧，
  // 这里把它的返回/注册统一收进自己的 dispose（apply 内部幂等，双保险无害）。
  let disposed = false
  let innerDispose: (() => void) | undefined
  const result = feishuApply(ctx, { ...(config.bootstrap ?? {}) })
  if (typeof result === 'function') innerDispose = result as () => void

  return {
    dispose(): void {
      if (disposed) return
      disposed = true
      try { innerDispose?.() } catch { /* 单点失败不阻断 */ }
    },
  }
}
