/** 本地浏览器 capability 激活：注册原生工具，卸载时回收 playwright-mcp 子进程。 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-tools'
import { BrowserService, type BrowserCapabilityConfig } from './service.ts'
import { browserClickTool, browserCloseTool, browserOpenTool, browserSnapshotTool, browserStatusTool, browserTabsTool, browserTypeTool, browserUploadTool } from './tools.ts'
import { XianyuMessageService } from './xianyu.ts'
import { xianyuConversationReadTool, xianyuMessagesListTool, xianyuReplyTool } from './xianyu-tools.ts'
import { XianyuPublishService } from './xianyu-publish.ts'
import { xianyuPublishTool } from './xianyu-publish-tools.ts'
import { XiaohongshuPublishService } from './xhs-publish.ts'
import { xiaohongshuPublishTool } from './xhs-publish-tools.ts'

/** 一次激活产生的浏览器服务与清理钩子。 */
export interface BrowserActivation {
  /** 交给基础路由组使用的脱敏浏览器服务；未启用时为 undefined。 */
  browser?: BrowserService
  dispose(): void
}

/**
 * 启用时注册原生浏览器工具；未启用时返回空激活。
 *
 * 工具分两档（2026-09-28 辉哥定，修「新装用户浏览器工具没启用也没地方启用」）：
 * - 基础浏览器工具（browser_*）随 `enabled` 注册，该开关默认开启，新装用户开箱即用；
 * - 闲鱼/小红书发布类工具随 `publish` 注册，默认关闭——这类工具会把内容真实发出去，
 *   属于不可撤销动作，必须由用户在面板「本地浏览器」页显式开启。
 * 发布类服务实例只在开关打开时才创建，关闭状态下不产生任何额外会话状态。
 */
export function activateBrowser(ctx: Context, config: BrowserCapabilityConfig): BrowserActivation {
  if (!config.enabled) return { dispose() {} }
  const service = new BrowserService(config)
  const publishEnabled = config.publish === true
  const xianyu = publishEnabled ? new XianyuMessageService(service) : undefined
  const xianyuPublish = publishEnabled ? new XianyuPublishService(service) : undefined
  const xiaohongshuPublish = publishEnabled ? new XiaohongshuPublishService(service) : undefined
  const toolGroup = ctx.effect(() => {
    const tools = [
      browserStatusTool(service), browserOpenTool(service), browserSnapshotTool(service), browserClickTool(service), browserTypeTool(service), browserTabsTool(service), browserUploadTool(service), browserCloseTool(service),
    ]
    if (xianyu !== undefined && xianyuPublish !== undefined && xiaohongshuPublish !== undefined) {
      tools.push(
        xianyuMessagesListTool(xianyu), xianyuConversationReadTool(xianyu), xianyuReplyTool(xianyu),
        xianyuPublishTool(xianyuPublish), xiaohongshuPublishTool(xiaohongshuPublish),
      )
    }
    const disposers = tools.map(tool => ctx.tools.register(tool))
    return () => { for (const dispose of disposers) dispose() }
  }, 'dsh-devforge: browser tools')
  return { browser: service, dispose(): void { try { toolGroup() } finally { service.dispose() } } }
}
