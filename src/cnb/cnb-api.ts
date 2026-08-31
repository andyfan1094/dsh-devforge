/**
 * CNB OpenAPI 客户端 —— 手写 fetch，零第三方依赖。
 * 认证：Authorization: Bearer <访问令牌>；Accept: application/json。
 * 关键接口：GET /user（验证令牌）、GET /user/repos（我的仓库，page/page_size/search）。
 */
import { CNB_WEB_BASE, type RepoSummary } from './protocol.ts'
import type { CnbStore, StoredAccount } from './store.ts'

/** CNB /user 返回的用户字段（path 为主键用户名）。 */
interface CnbUser { path?: string; username?: string; name?: string }

/** CNB 仓库列表条目（dto.Repos4User 的裁剪视图）。 */
interface CnbRepo {
  id: string
  name: string
  /** 完整仓库路径（slug）。 */
  path: string
  description?: string | null
  web_url?: string
  /** 可见性枚举：Private / Public / Secret。 */
  visibility_level?: string
  updated_at?: string | null
}

export class CnbApi {
  private readonly store: CnbStore
  constructor(store: CnbStore) { this.store = store }

  /** 验证账号令牌：GET /user 并回填用户名。 */
  async test(alias?: string): Promise<{ ok: boolean; alias: string; username?: string; error?: string }> {
    const account = this.store.findAccount(alias)
    try {
      const user = await this.request<CnbUser>(account, '/user')
      const username = user.path || user.username || user.name || ''
      if (username !== '') this.store.setUsername(account.alias, username)
      return { ok: true, alias: account.alias, ...(username !== '' ? { username } : {}) }
    } catch (error) {
      return { ok: false, alias: account.alias, error: error instanceof Error ? error.message : String(error) }
    }
  }

  /** 分页拉取我的仓库并本地过滤；最多 20 页，防止异常响应导致死循环。 */
  async listRepos(alias?: string, query?: string): Promise<RepoSummary[]> {
    const account = this.store.findAccount(alias)
    const repos: CnbRepo[] = []
    for (let page = 1; page <= 20; page += 1) {
      const batch = await this.request<CnbRepo[]>(account, '/user/repos?page=' + page + '&page_size=100')
      if (!Array.isArray(batch) || batch.length === 0) break
      repos.push(...batch)
      if (batch.length < 100) break
    }
    const summaries = repos.map(repo => this.toSummary(repo))
    const needle = query?.trim().toLowerCase()
    return needle === undefined || needle === '' ? summaries : summaries.filter(repo => (repo.name + ' ' + repo.fullName + ' ' + (repo.description ?? '')).toLowerCase().includes(needle))
  }

  /** 统一请求：注入 Bearer 令牌；非 2xx 抛出带状态码的可读错误。 */
  async request<T>(account: StoredAccount, path: string): Promise<T> {
    const response = await fetch(account.apiUrl + path, {
      headers: { accept: 'application/json', authorization: 'Bearer ' + account.token, 'user-agent': 'dsh-devforge-cnb' },
    })
    return await this.parseResponse<T>(response)
  }

  /** 带请求体的写请求（POST 等）；创建仓库等写操作使用。 */
  async writeRequest<T>(account: StoredAccount, path: string, payload: unknown): Promise<{ status: number; body: T }> {
    const response = await fetch(account.apiUrl + path, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        authorization: 'Bearer ' + account.token,
        'content-type': 'application/json',
        'user-agent': 'dsh-devforge-cnb',
      },
      body: JSON.stringify(payload),
    })
    const body = await this.parseResponse<T>(response)
    return { status: response.status, body }
  }

  /** 统一响应解析：非 2xx 抛带状态码的可读错误。 */
  private async parseResponse<T>(response: Response): Promise<T> {
    const text = await response.text()
    let body: unknown
    try { body = JSON.parse(text) } catch { body = text }
    if (!response.ok) {
      const message = typeof body === 'object' && body !== null && typeof (body as { message?: unknown }).message === 'string'
        ? (body as { message: string }).message
        : 'CNB API HTTP ' + response.status
      throw new Error(message + ' (' + response.status + ')')
    }
    return body as T
  }

  /** 仓库列表条目 → 摘要；Private/Secret 均按非公开处理。 */
  private toSummary(repo: CnbRepo): RepoSummary {
    const fullName = repo.path || repo.name
    const htmlUrl = repo.web_url || CNB_WEB_BASE + '/' + fullName
    const visibility = String(repo.visibility_level ?? '')
    return {
      id: repo.id,
      name: repo.name,
      fullName,
      private: /private|secret/i.test(visibility),
      htmlUrl,
      cloneUrl: CNB_WEB_BASE + '/' + fullName,
      ...(repo.description ? { description: repo.description } : {}),
      ...(repo.updated_at ? { updatedAt: repo.updated_at } : {}),
    }
  }
}
