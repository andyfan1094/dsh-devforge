/**
 * GitHub 能力激活 —— vendored dsh-github 引擎注册为 devforge 内部表面。
 * 兼容契约：8 个 github_* 工具原名注册；/api/dsh-github 路由前缀保留。
 * 安全边界：模块自带 loopback 围栏；Token 只存 ~/.dsh/dsh-github.json（0600），
 * 引擎对 stdout/stderr 做脱敏，本激活层不触碰任何凭据值。
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-tools'
import { GithubEngine } from './engine.ts'
import { makeRoutes } from './routes.ts'
import { GithubStore } from './store.ts'
import {
  githubAuthListTool,
  githubAuthTestTool,
  githubCloneTool,
  githubCommitTool,
  githubPullTool,
  githubPushTool,
  githubRepoListTool,
  githubStatusTool,
} from './tools.ts'

/** GitHub 子配置。 */
export interface GithubCapabilityConfig {
  /** 总开关：true 时注册 github_* 工具与 /api/dsh-github 路由。 */
  enabled: boolean
}

/** 激活 GitHub capability；调用方在 sync() 卸载时执行 dispose()。 */
export function activateGithub(ctx: Context, config: GithubCapabilityConfig): { dispose(): void } {
  if (!config.enabled) return { dispose() {} }

  // store 直接读旧 ~/.dsh/dsh-github.json（凭据零迁移、零回写格式变化）。
  const engine = new GithubEngine(new GithubStore())
  const routes = makeRoutes(engine)
  const tools = [
    githubAuthListTool(engine),
    githubAuthTestTool(engine),
    githubRepoListTool(engine),
    githubCloneTool(engine),
    githubPullTool(engine),
    githubPushTool(engine),
    githubStatusTool(engine),
    githubCommitTool(engine),
  ]

  const disposers: Array<() => void> = []
  disposers.push(ctx.effect(() => {
    const registered = routes.map((route) => ctx.webServer.register(route))
    return () => { for (const dispose of registered) dispose() }
  }, 'dsh-devforge: github routes'))
  disposers.push(ctx.effect(() => {
    const registered = tools.map((tool) => ctx.tools.register(tool))
    return () => { for (const dispose of registered) dispose() }
  }, 'dsh-devforge: github tools'))

  return {
    dispose(): void {
      for (const dispose of disposers.splice(0)) {
        try { dispose() } catch { /* 卸载期单点失败不阻断其余清理 */ }
      }
    },
  }
}
