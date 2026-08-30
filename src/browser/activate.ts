/** 本地浏览器 capability 激活：注册原生工具，卸载时回收 playwright-mcp 子进程。 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-tools'
import { BrowserService, type BrowserCapabilityConfig } from './service.ts'
import { browserClickTool, browserCloseTool, browserOpenTool, browserSnapshotTool, browserStatusTool, browserTabsTool, browserTypeTool, browserUploadTool } from './tools.ts'
import { XianyuMessageService } from './xianyu.ts'
import { xianyuConversationReadTool, xianyuMessagesListTool, xianyuReplyTool } from './xianyu-tools.ts'
import { XianyuPublishService } from './xianyu-publish.ts'
import { xianyuPublishTool } from './xianyu-publish-tools.ts'

/** 一次激活产生的浏览器服务与清理钩子。 */
export interface BrowserActivation {
  /** 交给基础路由组使用的脱敏浏览器服务；未启用时为 undefined。 */
  browser?: BrowserService
  dispose(): void
}

/** 启用时注册原生浏览器工具；未启用时返回空激活。 */
export function activateBrowser(ctx: Context, config: BrowserCapabilityConfig): BrowserActivation {
  if (!config.enabled) return { dispose() {} }
  const service = new BrowserService(config)
  const xianyu = new XianyuMessageService(service)
  const xianyuPublish = new XianyuPublishService(service)
  const toolGroup = ctx.effect(() => {
    const tools = [
      browserStatusTool(service), browserOpenTool(service), browserSnapshotTool(service), browserClickTool(service), browserTypeTool(service), browserTabsTool(service), browserUploadTool(service), browserCloseTool(service),
      xianyuMessagesListTool(xianyu), xianyuConversationReadTool(xianyu), xianyuReplyTool(xianyu), xianyuPublishTool(xianyuPublish),
    ]
    const disposers = tools.map(tool => ctx.tools.register(tool))
    return () => { for (const dispose of disposers) dispose() }
  }, 'dsh-devforge: browser tools')
  return { browser: service, dispose(): void { try { toolGroup() } finally { service.dispose() } } }
}
