/** Camofox capability 激活：复用服务工厂唯一 SSH 引擎，统一管理工具和隧道。面板路由常驻基础路由组。 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-tools'
import type { SshEngine } from '../remote/ssh/engine.ts'
import { CamofoxService, type CamofoxCapabilityConfig } from './service.ts'
import { camofoxClickTool, camofoxCloseTool, camofoxListTabsTool, camofoxNavigateTool, camofoxOpenTool, camofoxScrollTool, camofoxSnapshotTool, camofoxStatusTool, camofoxTypeTool } from './tools.ts'

/** 一次激活产生的浏览器服务与清理钩子。 */
export interface CamofoxActivation {
  /** 交给基础路由组使用的脱敏浏览器服务；未启用时为 undefined。 */
  camofox?: CamofoxService
  dispose(): void
}

/** 启用时注册原生浏览器工具；卸载时先收回 Camofox 隧道，再由调用方释放 SSH 引擎。 */
export function activateCamofox(ctx: Context, ssh: SshEngine, config: CamofoxCapabilityConfig): CamofoxActivation {
  if (!config.enabled) return { dispose() {} }
  const service = new CamofoxService(ssh, config)
  const toolGroup = ctx.effect(() => {
    const tools = [camofoxStatusTool(service), camofoxOpenTool(service), camofoxListTabsTool(service), camofoxSnapshotTool(service), camofoxNavigateTool(service), camofoxClickTool(service), camofoxTypeTool(service), camofoxScrollTool(service), camofoxCloseTool(service)]
    const disposers = tools.map(tool => ctx.tools.register(tool))
    return () => { for (const dispose of disposers) dispose() }
  }, 'dsh-devforge: camofox tools')
  return { camofox: service, dispose(): void { try { toolGroup() } finally { service.dispose() } } }
}
