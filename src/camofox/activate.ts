/** Camofox capability 激活：复用服务工厂唯一 SSH 引擎，统一管理工具、面板路由和隧道。 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-tools'
import type { SshEngine } from '../remote/ssh/engine.ts'
import { makeCamofoxRoutes } from './routes.ts'
import { CamofoxService, type CamofoxCapabilityConfig } from './service.ts'
import { camofoxClickTool, camofoxCloseTool, camofoxListTabsTool, camofoxNavigateTool, camofoxOpenTool, camofoxScrollTool, camofoxSnapshotTool, camofoxStatusTool, camofoxTypeTool } from './tools.ts'

export interface CamofoxActivation { dispose(): void }

/** 启用时注册原生浏览器工具；卸载时先收回 Camofox 隧道，再由调用方释放 SSH 引擎。 */
export function activateCamofox(ctx: Context, ssh: SshEngine, config: CamofoxCapabilityConfig): CamofoxActivation {
  if (!config.enabled) return { dispose() {} }
  const service = new CamofoxService(ssh, config)
  const routes = makeCamofoxRoutes(service)
  const routeGroup = ctx.effect(() => {
    const disposers = routes.map(route => ctx.webServer.register(route))
    return () => { for (const dispose of disposers) dispose() }
  }, 'dsh-devforge: camofox routes')
  const toolGroup = ctx.effect(() => {
    const tools = [camofoxStatusTool(service), camofoxOpenTool(service), camofoxListTabsTool(service), camofoxSnapshotTool(service), camofoxNavigateTool(service), camofoxClickTool(service), camofoxTypeTool(service), camofoxScrollTool(service), camofoxCloseTool(service)]
    const disposers = tools.map(tool => ctx.tools.register(tool))
    return () => { for (const dispose of disposers) dispose() }
  }, 'dsh-devforge: camofox tools')
  return { dispose(): void { try { routeGroup() } finally { try { toolGroup() } finally { service.dispose() } } } }
}
