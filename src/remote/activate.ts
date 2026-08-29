/**
 * 远程运维能力激活 —— 把 vendored 的 SSH / WinRM 引擎注册为 devforge 内部表面。
 *
 * 兼容契约（切换旧插件时零破坏）：
 *   - 工具名沿用 ssh_* / winrm_*（旧系统提示与会话脚本锚定这些名字）；
 *   - 路由前缀沿用 /api/dsh-ssh、/api/dsh-winrm（旧面板代码与浏览器缓存目标）；
 *   - WebSocket upgrade 原样迁移（SSH terminal 与 WinRM console 帧协议互不相同）。
 * 安全边界：全部表面由 config.remote.enabled 总闸控制；loopback 围栏在各自
 * routes.ts 内已有，这里不重复实现。
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-tools'
import { SshEngine } from './ssh/engine.ts'
import { makeRoutes as makeSshRoutes } from './ssh/routes.ts'
import { HostStore as SshHostStore } from './ssh/store.ts'
import { sshClusterTool, sshDownloadTool, sshExecTool, sshListTool, sshTunnelTool, sshUploadTool } from './ssh/tools.ts'
import { WinRmEngine } from './winrm/engine.ts'
import { makeRoutes as makeWinrmRoutes } from './winrm/routes.ts'
import { HostStore as WinrmHostStore } from './winrm/store.ts'
import { winrmClusterTool, winrmDownloadTool, winrmExecTool, winrmListTool, winrmProcessTool, winrmServiceTool, winrmUploadTool } from './winrm/tools.ts'

/** 远程运维子配置。 */
export interface RemoteConfig {
  /** 总开关：true 时 devforge 注册 ssh_* / winrm_* 工具与旧路由前缀。 */
  enabled: boolean
}

/** 一次激活产生的全部 disposer（路由/upgrade/工具）。 */
export interface RemoteActivation {
  dispose(): void
}

/** 激活远程运维能力；调用方负责在 sync() 卸载时调用 dispose()。 */
export function activateRemote(ctx: Context, config: RemoteConfig): RemoteActivation {
  if (!config.enabled) return { dispose() {} }

  // SSH：store 直接读旧 ~/.dsh/dsh-ssh.json（凭据零迁移），引擎用持久连接池。
  const sshStore = new SshHostStore()
  const sshEngine = new SshEngine(sshStore)
  const ssh = makeSshRoutes({ store: sshStore, engine: sshEngine })
  const sshTools = [
    sshListTool(sshEngine),
    sshExecTool(sshEngine),
    sshUploadTool(sshEngine),
    sshDownloadTool(sshEngine),
    sshTunnelTool(sshEngine),
    sshClusterTool(sshEngine),
  ]

  // WinRM：store 直接读旧 ~/.dsh/dsh-winrm.json；pywinrm 桥按需 spawn，无持久资源。
  const winrmStore = new WinrmHostStore()
  const winrmEngine = new WinRmEngine(winrmStore)
  const winrm = makeWinrmRoutes({ store: winrmStore, engine: winrmEngine })
  const winrmTools = [
    winrmListTool(winrmEngine),
    winrmExecTool(winrmEngine),
    winrmServiceTool(winrmEngine),
    winrmProcessTool(winrmEngine),
    winrmUploadTool(winrmEngine),
    winrmDownloadTool(winrmEngine),
    winrmClusterTool(winrmEngine),
  ]

  const disposers: Array<() => void> = []
  disposers.push(() => { sshEngine.dispose() })
  disposers.push(() => { winrmEngine.dispose() })

  const routeGroup = ctx.effect(() => {
    const registered = [...ssh.routes, ...winrm.routes].map((route) => ctx.webServer.register(route))
    const sshUpgrade = ctx.webServer.registerUpgrade(ssh.upgrade)
    const winrmUpgrade = ctx.webServer.registerUpgrade(winrm.upgrade)
    return () => {
      for (const dispose of registered) dispose()
      sshUpgrade()
      winrmUpgrade()
    }
  }, 'dsh-devforge: remote routes')
  disposers.push(routeGroup)

  const toolGroup = ctx.effect(() => {
    const registered = [...sshTools, ...winrmTools].map((tool) => ctx.tools.register(tool))
    return () => { for (const dispose of registered) dispose() }
  }, 'dsh-devforge: remote tools')
  disposers.push(toolGroup)

  return {
    dispose(): void {
      for (const dispose of disposers.splice(0)) {
        try { dispose() } catch { /* 卸载期单点失败不阻断其余清理 */ }
      }
    },
  }
}
