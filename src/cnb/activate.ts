/**
 * CNB 能力激活 —— 注册 cnb_* 工具与 /api/dsh-cnb 路由前缀。
 * 安全边界：Token 只存 ~/.dsh/dsh-cnb.json（0600）；Git 执行层对输出全量脱敏；
 * 本激活层不触碰任何凭据值；路由仅回环访问。
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-tools'
import { CnbEngine } from './engine.ts'
import { makeRoutes } from './routes.ts'
import { CnbStore } from './store.ts'
import {
  cnbAuthAddTool,
  cnbAuthListTool,
  cnbAuthRemoveTool,
  cnbAuthTestTool,
  cnbCloneTool,
  cnbCommitTool,
  cnbPullTool,
  cnbPushTool,
  cnbRepoListTool,
  cnbStatusTool,
} from './tools.ts'

/** CNB 子配置。 */
export interface CnbCapabilityConfig {
  /** 总开关：true 时注册 cnb_* 工具与 /api/dsh-cnb 路由。 */
  enabled: boolean
}

/** 激活 CNB capability；调用方在 sync() 卸载时执行 dispose()。 */
export function activateCnb(ctx: Context, config: CnbCapabilityConfig): { dispose(): void } {
  if (!config.enabled) return { dispose() {} }

  const engine = new CnbEngine(new CnbStore())
  const routes = makeRoutes(engine)
  const tools = [
    cnbAuthAddTool(engine),
    cnbAuthRemoveTool(engine),
    cnbAuthListTool(engine),
    cnbAuthTestTool(engine),
    cnbRepoListTool(engine),
    cnbCloneTool(engine),
    cnbPullTool(engine),
    cnbPushTool(engine),
    cnbStatusTool(engine),
    cnbCommitTool(engine),
  ]

  const disposers: Array<() => void> = []
  disposers.push(ctx.effect(() => {
    const registered = routes.map((route) => ctx.webServer.register(route))
    return () => { for (const dispose of registered) dispose() }
  }, 'dsh-devforge: cnb routes'))
  disposers.push(ctx.effect(() => {
    const registered = tools.map((tool) => ctx.tools.register(tool))
    return () => { for (const dispose of registered) dispose() }
  }, 'dsh-devforge: cnb tools'))

  return {
    dispose(): void {
      for (const dispose of disposers.splice(0)) {
        try { dispose() } catch { /* 卸载期单点失败不阻断其余清理 */ }
      }
    },
  }
}
