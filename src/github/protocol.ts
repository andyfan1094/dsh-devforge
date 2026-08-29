// Vendored from dsh-github 0.1.2 (Apache-2.0, andyfan1094/dsh-github).
// dsh-devforge consolidation modification: relative import paths adjusted to the
// devforge module layout; runtime behavior preserved. See THIRD_PARTY_NOTICES.md.
export const GITHUB_API_BASE = '/api/dsh-github'
export const GITHUB_API = {
  accounts: GITHUB_API_BASE + '/accounts',
  accountTest: GITHUB_API_BASE + '/account-test',
  repos: GITHUB_API_BASE + '/repos',
  config: GITHUB_API_BASE + '/config',
  git: GITHUB_API_BASE + '/git',
} as const

export interface AccountSummary {
  alias: string
  apiUrl: string
  username?: string
  tokenConfigured: boolean
  createdAt: number
  updatedAt: number
}
export interface RepoSummary {
  id: number
  name: string
  fullName: string
  private: boolean
  htmlUrl: string
  cloneUrl: string
  defaultBranch: string
  description?: string
  updatedAt?: string
}
export interface GitHubSettings {
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
export interface GitHubConfigPayload {
  apiUrl?: string
  gitExecutable?: string
  defaultAccount?: string
  defaultRepoDir?: string
  defaultBranch?: string
  autoFetchOnOpen?: boolean
  allowPush?: boolean
  allowForcePush?: boolean
}
