/**
 * CNB 代码托管模块协议 —— 路由常量与数据结构。
 *
 * 平台事实（docs.cnb.cool）：CNB 仅支持 HTTPS + 访问令牌，Git 认证用户名固定为
 * cnb、密码为访问令牌；OpenAPI 认证为 Authorization: Bearer <令牌>；不支持 SSH。
 */

/** 本模块 HTTP 路由前缀（仅回环访问）。 */
export const CNB_API_BASE = '/api/dsh-cnb'

/** CNB 站点根地址（仓库 Web/克隆地址都以其拼接）。 */
export const CNB_WEB_BASE = 'https://cnb.cool'

/** CNB Git HTTP 认证的固定用户名。 */
export const CNB_GIT_USERNAME = 'cnb'

/** CNB OpenAPI 默认服务地址。 */
export const CNB_API_DEFAULT = 'https://api.cnb.cool'

export const CNB_API = {
  accounts: CNB_API_BASE + '/accounts',
  accountTest: CNB_API_BASE + '/account-test',
  repos: CNB_API_BASE + '/repos',
  config: CNB_API_BASE + '/config',
  git: CNB_API_BASE + '/git',
} as const

/** 账号摘要（绝不包含令牌明文）。 */
export interface AccountSummary {
  alias: string
  apiUrl: string
  username?: string
  tokenConfigured: boolean
  createdAt: number
  updatedAt: number
}

/** 仓库摘要（面向 Agent 与面板的字段裁剪）。 */
export interface RepoSummary {
  id: string
  name: string
  /** 完整仓库路径（slug），例如 andyfan1094/dsh-devforge。 */
  fullName: string
  private: boolean
  htmlUrl: string
  cloneUrl: string
  defaultBranch?: string
  description?: string
  updatedAt?: string
}

export interface CnbSettings {
  apiUrl: string
  gitExecutable: string
  defaultAccount?: string
  defaultRepoDir?: string
  defaultBranch?: string
  autoFetchOnOpen: boolean
  allowPush: boolean
  allowForcePush: boolean
}

export interface GitAction {
  action: 'clone' | 'pull' | 'push' | 'status' | 'commit'
  account?: string
  repoPath?: string
  remote?: string
  branch?: string
  remoteUrl?: string
  destination?: string
  message?: string
  all?: boolean
  force?: boolean
  timeoutMs?: number
}

export interface GitResult {
  ok: boolean
  action: string
  exitCode: number | null
  stdout: string
  stderr: string
  durationMs: number
  repoPath?: string
  branch?: string
  remoteUrl?: string
  dirty?: boolean
  error?: string
}

export interface CnbConfigPayload {
  apiUrl?: string
  gitExecutable?: string
  defaultAccount?: string
  defaultRepoDir?: string
  defaultBranch?: string
  autoFetchOnOpen?: boolean
  allowPush?: boolean
  allowForcePush?: boolean
}
