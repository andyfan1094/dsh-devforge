/**
 * Git 远端主机护栏：避免把 GitHub 令牌发送给非 GitHub 平台。
 *
 * 背景（2026-10-15 实测暴露）：本机 dsh-devforge 仓库同时配置了 cnb 与 github 两个远端，
 * origin 指向 cnb.cool。github_push 的 remote 默认取 'origin'，于是把 GitHub 个人访问令牌
 * 随 Authorization 头发给了 cnb.cool 服务器（CNB 服务端在错误里回显了该令牌）。
 * 令牌一旦离开本机就应按泄露处理，因此在推送/拉取这类必须携带令牌的操作前，
 * 必须先确认远端主机确实属于 GitHub。
 */

/** 解析 Git 远端地址的主机名；支持 https/ssh/http/git 与 scp-like（git@host:owner/repo.git）。 */
export function parseGitRemoteHost(remoteUrl: string): string | undefined {
  const value = remoteUrl.trim()
  if (value === '') return undefined
  // scp-like 形式不含 "://"，形如 [user@]host:path
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(value)) {
    const scpLike = /^(?:[^@/\s]+@)?([^:/\s]+):/.exec(value)
    if (scpLike !== null) return scpLike[1].toLowerCase()
    return undefined
  }
  try {
    const host = new URL(value).hostname
    return host === '' ? undefined : host.toLowerCase()
  } catch {
    return undefined
  }
}

/** 由 GitHub API 地址推导对应的 Git 主机名（官方 api.github.com → github.com，企业版保留其主机）。 */
export function githubGitHost(apiUrl: string): string {
  try {
    const host = new URL(apiUrl).hostname.toLowerCase()
    if (host === 'api.github.com' || host === 'github.com') return 'github.com'
    return host.startsWith('api.') ? host.slice(4) : host
  } catch {
    return 'github.com'
  }
}

/** 远端主机是否属于 GitHub（无法解析主机时返回 false，交由调用方决定策略）。 */
export function isGithubHost(remoteUrl: string, apiUrl: string): boolean {
  const host = parseGitRemoteHost(remoteUrl)
  return host !== undefined && host === githubGitHost(apiUrl)
}

/**
 * 强校验：远端主机不是 GitHub 时抛出可操作的中文错误。
 * 用于 push/pull —— 这类操作必须带令牌，宁可失败也不能把令牌发给别的平台。
 */
export function assertGithubRemoteHost(remoteUrl: string, apiUrl: string, remote: string): void {
  const expected = githubGitHost(apiUrl)
  const actual = parseGitRemoteHost(remoteUrl)
  if (actual === undefined) {
    throw new Error('无法解析远端「' + remote + '」的地址：' + remoteUrl + '；为避免 GitHub 令牌泄露给第三方，已中止操作。')
  }
  if (actual !== expected) {
    throw new Error('远端「' + remote + '」指向 ' + actual + '，不是 GitHub 主机 ' + expected
      + '；GitHub 令牌只应发送给 ' + expected + '，因此已中止操作。'
      + '请指定指向 GitHub 的远端（例如 remote 传 "github"），或先用 git remote add 添加 GitHub 远端。')
  }
}
