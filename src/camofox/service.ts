/**
 * Camofox 远程浏览器服务。
 *
 * SSH 只负责把固定请求送到 `my` 的回环 API；认证令牌只在远端环境文件中
 * 被 shell 使用，绝不读取、缓存、输出或传递给浏览器半边。
 */
import type { SshEngine } from '../remote/ssh/engine.ts'
import { CAMOFOX_API_PORT, CAMOFOX_DEFAULT_ALIAS, CAMOFOX_VNC_PORT, type CamofoxStatus, type CamofoxTab } from './protocol.ts'

const MAX_TABS = 3

/** 浏览器 capability 的可配置项，禁止覆盖端口及远端认证边界。 */
export interface CamofoxCapabilityConfig {
  enabled: boolean
  alias: string
  userId: string
  sessionKey: string
  timeoutMs: number
}

/** 将 JSON 请求编码后交给远端 shell，避免拼接用户文本。 */
function encodedJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64')
}

/** 只保留远端错误的安全摘要，避免传播响应头、令牌或系统路径。 */
function safeError(value: unknown): string {
  const text = value instanceof Error ? value.message : String(value)
  return text.replace(/Bearer\s+[^\s]+/gi, 'Bearer [redacted]').slice(0, 300)
}

/** 固定 API 请求：远端自行从受限环境文件读取访问令牌。 */
function requestCommand(path: string, method: 'GET' | 'POST' | 'DELETE', body?: unknown): string {
  const encodedPath = Buffer.from(path, 'utf8').toString('base64')
  const encodedBody = body === undefined ? '' : encodedJson(body)
  return [
    'set -eu',
    '. /etc/camofox-browser.env',
    `path=$(printf %s '${encodedPath}' | base64 -d)`,
    `body='${encodedBody}'`,
    'if [ -n "$body" ]; then',
    '  printf %s "$body" | base64 -d | curl -fsS --max-time 45 -X ' + method + ' -H "Authorization: Bearer $CAMOFOX_ACCESS_KEY" -H "content-type: application/json" --data-binary @- "http://127.0.0.1:' + CAMOFOX_API_PORT + '$path"',
    'else',
    '  curl -fsS --max-time 45 -X ' + method + ' -H "Authorization: Bearer $CAMOFOX_ACCESS_KEY" "http://127.0.0.1:' + CAMOFOX_API_PORT + '$path"',
    'fi',
  ].join('\n')
}

/** 远端 Camofox REST 调用与可视隧道管理。 */
export class CamofoxService {
  private apiTunnelId: string | undefined
  private visualTunnelId: string | undefined

  constructor(private readonly ssh: SshEngine, private readonly config: CamofoxCapabilityConfig) {}

  /** 固定运营用户，防止 Agent 越权切换其它登录档案。 */
  private userId(): string { return this.config.userId }

  /** 将远端 JSON 响应解析为对象；服务错误只暴露安全摘要。 */
  private async request<T>(path: string, method: 'GET' | 'POST' | 'DELETE', body?: unknown): Promise<T> {
    const result = await this.ssh.exec(this.config.alias, requestCommand(path, method, body), this.config.timeoutMs)
    if (!result.success) throw new Error('远程浏览器请求失败：' + safeError(result.error ?? result.stderr))
    try { return JSON.parse(result.stdout) as T } catch { throw new Error('远程浏览器返回了无效响应') }
  }

  /** 读取浏览器健康状态，不输出远端内部认证或网络细节。 */
  async status(): Promise<CamofoxStatus> {
    if (!this.config.enabled) return { configured: false, reachable: false, browserRunning: false, activeTabs: 0, activeSessions: 0, visualReady: false, message: '浏览器能力未启用' }
    try {
      const health = await this.request<{ browserRunning?: boolean; activeTabs?: number; activeSessions?: number }>('/health', 'GET')
      return { configured: true, reachable: true, browserRunning: health.browserRunning === true, activeTabs: Number(health.activeTabs ?? 0), activeSessions: Number(health.activeSessions ?? 0), visualReady: true }
    } catch (error) {
      return { configured: true, reachable: false, browserRunning: false, activeTabs: 0, activeSessions: 0, visualReady: false, message: safeError(error) }
    }
  }

  /** 新建标签页，限制服务端资源上限。 */
  async open(url: string): Promise<CamofoxTab> {
    const tabs = await this.listTabs()
    if (tabs.length >= MAX_TABS) throw new Error('当前会话最多保留 3 个标签页，请先关闭不需要的页面')
    const value = await this.request<{ tabId: string; url?: string; title?: string }>('/tabs', 'POST', { userId: this.userId(), sessionKey: this.config.sessionKey, url })
    return { tabId: value.tabId, url: value.url, title: value.title }
  }

  /** 列出当前运营档案的标签页。 */
  async listTabs(): Promise<CamofoxTab[]> {
    const value = await this.request<{ tabs?: Array<{ tabId?: string; id?: string; url?: string; title?: string }> }>('/tabs?userId=' + encodeURIComponent(this.userId()), 'GET')
    return (value.tabs ?? []).flatMap(tab => { const tabId = tab.tabId ?? tab.id; return tabId === undefined ? [] : [{ tabId, url: tab.url, title: tab.title }] })
  }

  /** 获取无密可访问性快照，供 Agent 分析和后续元素操作。 */
  async snapshot(tabId: string): Promise<string> {
    const value = await this.request<string | { snapshot?: string; text?: string }>('/tabs/' + encodeURIComponent(tabId) + '/snapshot?userId=' + encodeURIComponent(this.userId()) + '&format=text', 'GET')
    return typeof value === 'string' ? value : String(value.snapshot ?? value.text ?? '')
  }

  /** 跳转固定标签页。 */
  async navigate(tabId: string, url: string): Promise<void> { await this.request('/tabs/' + encodeURIComponent(tabId) + '/navigate', 'POST', { userId: this.userId(), url, sessionKey: this.config.sessionKey }) }

  /** 点击快照元素引用；不支持模型提供任意坐标。 */
  async click(tabId: string, ref: string): Promise<void> { await this.request('/tabs/' + encodeURIComponent(tabId) + '/click', 'POST', { userId: this.userId(), ref }) }

  /** 向快照元素输入文本。 */
  async type(tabId: string, ref: string, text: string, submit = false): Promise<void> { await this.request('/tabs/' + encodeURIComponent(tabId) + '/type', 'POST', { userId: this.userId(), ref, text, clear: true, submit }) }

  /** 滚动固定标签页。 */
  async scroll(tabId: string, direction: 'up' | 'down', amount: number): Promise<void> { await this.request('/tabs/' + encodeURIComponent(tabId) + '/scroll', 'POST', { userId: this.userId(), direction, amount }) }

  /** 关闭单个标签页；Camofox 会保存用户档案。 */
  async close(tabId: string): Promise<void> { await this.request('/tabs/' + encodeURIComponent(tabId) + '?userId=' + encodeURIComponent(this.userId()), 'DELETE') }

  /** 为服务工厂面板创建 noVNC 隧道，URL 不会由 Agent 工具返回。 */
  async visualUrl(): Promise<string> {
    if (!this.config.enabled) throw new Error('浏览器能力未启用')
    const tunnel = this.visualTunnelId === undefined ? undefined : this.ssh.listTunnels().find(item => item.id === this.visualTunnelId && item.state === 'forwarding')
    if (tunnel === undefined) {
      const opened = await this.ssh.startTunnel(this.config.alias, { remoteHost: '127.0.0.1', remotePort: CAMOFOX_VNC_PORT })
      this.visualTunnelId = opened.id
      return 'http://127.0.0.1:' + opened.localPort + '/vnc.html?autoconnect=true&resize=scale'
    }
    return 'http://127.0.0.1:' + tunnel.localPort + '/vnc.html?autoconnect=true&resize=scale'
  }

  /** 提前建立 API 隧道只用于 Host 检查；Agent 操作仍通过 SSH，避免暴露端口。 */
  async ensureApiTunnel(): Promise<void> {
    if (this.apiTunnelId !== undefined && this.ssh.listTunnels().some(item => item.id === this.apiTunnelId && item.state === 'forwarding')) return
    this.apiTunnelId = (await this.ssh.startTunnel(this.config.alias, { remoteHost: '127.0.0.1', remotePort: CAMOFOX_API_PORT })).id
  }

  /** 配置热更新或插件卸载时立即撤销仅本机视觉入口。 */
  dispose(): void {
    if (this.visualTunnelId !== undefined) this.ssh.stopTunnel(this.visualTunnelId)
    if (this.apiTunnelId !== undefined) this.ssh.stopTunnel(this.apiTunnelId)
    this.visualTunnelId = undefined
    this.apiTunnelId = undefined
  }
}
