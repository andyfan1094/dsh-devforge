import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-settings'
import { makeZhipuRoutes } from './routes.ts'
import { ZhipuCodingPlanService, type ZhipuCapabilityConfig } from './service.ts'

/** 激活智谱 capability；关闭时不注册路由。 */
export function activateZhipu(ctx: Context, config: ZhipuCapabilityConfig): { dispose(): void } {
  if (!config.enabled) return { dispose() {} }
  const service = new ZhipuCodingPlanService(ctx, config)
  const routes = makeZhipuRoutes(service)
  const dispose = ctx.effect(() => {
    const registered = routes.map((route) => ctx.webServer.register(route))
    return () => { for (const unregister of registered) unregister() }
  }, 'dsh-devforge: zhipu routes')
  return { dispose }
}
