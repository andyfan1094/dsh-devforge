/**
 * 远程运维旧配置只读注册表。
 *
 * 迁移第一阶段只把 dsh-ssh.json / dsh-winrm.json 投影为统一主机摘要，绝不回写、
 * 重命名或迁移凭据文件。这样天工造梦可先建立统一视图，而旧插件保持可回滚运行。
 */
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import type { RemoteHostSummary, RemoteTransport } from '../protocol.ts'

/** 旧 SSH / WinRM store 只需要的无密字段最小形状。 */
interface LegacyHost {
  alias?: unknown
  host?: unknown
  port?: unknown
  user?: unknown
  auth?: { kind?: unknown; keyPath?: unknown } | undefined
  transport?: unknown
  rejectUnauthorized?: unknown
  proxyJump?: unknown
  description?: unknown
  environment?: unknown
  tags?: unknown
  location?: unknown
  createdAt?: unknown
  updatedAt?: unknown
}

/** 读取 DSH_HOME，兼容 SSH 原插件的环境变量覆盖。 */
function dshHome(): string {
  const configured = process.env.DSH_HOME?.trim()
  return configured === undefined || configured === '' ? join(homedir(), '.dsh') : resolve(configured)
}

/** 不信任的 JSON 字段转安全字符串；仅用于脱敏摘要。 */
function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

/** 不信任标签字段转字符串数组，过滤非字符串和空项。 */
function tags(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean) : []
}

/** 安全读取 legacy store；解析错误仅视作空列表，绝不触碰原文件。 */
function legacyHosts(path: string): LegacyHost[] {
  if (!existsSync(path)) return []
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as { hosts?: unknown }
    return Array.isArray(parsed.hosts) ? parsed.hosts.filter((item): item is LegacyHost => typeof item === 'object' && item !== null) : []
  } catch {
    return []
  }
}

/** 统一投影共用字段；任何 auth.password / passphrase 均不读取。 */
function common(entry: LegacyHost, transport: RemoteTransport, fallbackPort: number): Omit<RemoteHostSummary, 'id' | 'transport' | 'capabilities'> | undefined {
  const alias = text(entry.alias)
  const host = text(entry.host)
  const user = text(entry.user)
  if (alias === undefined || host === undefined || user === undefined) return undefined
  const port = typeof entry.port === 'number' && Number.isInteger(entry.port) && entry.port > 0 && entry.port <= 65535 ? entry.port : fallbackPort
  const authKind = text(entry.auth?.kind) ?? 'password'
  return {
    alias,
    host,
    port,
    user,
    auth: authKind,
    ...(text(entry.description) !== undefined ? { description: text(entry.description) } : {}),
    ...(text(entry.environment) !== undefined ? { environment: text(entry.environment) } : {}),
    tags: tags(entry.tags),
    ...(text(entry.location) !== undefined ? { location: text(entry.location) } : {}),
    createdAt: typeof entry.createdAt === 'number' ? entry.createdAt : 0,
    updatedAt: typeof entry.updatedAt === 'number' ? entry.updatedAt : 0,
  }
}

/**
 * 天工造梦远程主机注册表。当前为只读桥接层；后续 adapter 接入完成后再提供显式、
 * 可回滚的导入动作，不能在用户未确认时搬运任何明文凭据。
 */
export class LegacyRemoteRegistry {
  private readonly sshPath: string
  private readonly winrmPath: string

  constructor(home = dshHome()) {
    this.sshPath = join(home, 'dsh-ssh.json')
    this.winrmPath = join(home, 'dsh-winrm.json')
  }

  /** 返回 SSH 和 WinRM 的无密统一主机摘要，id 用 transport:alias 避免跨协议别名冲突。 */
  list(): RemoteHostSummary[] {
    const ssh = legacyHosts(this.sshPath).flatMap((entry) => {
      const host = common(entry, 'ssh', 22)
      if (host === undefined) return []
      return [{
        ...host,
        id: 'ssh:' + host.alias,
        transport: 'ssh' as const,
        capabilities: { terminal: true, transfer: true, tunnel: true, services: false, processes: false, cluster: true },
      }]
    })
    const winrm = legacyHosts(this.winrmPath).flatMap((entry) => {
      const transport: 'http' | 'https' = entry.transport === 'https' ? 'https' : 'http'
      const host = common(entry, 'winrm', transport === 'https' ? 5986 : 5985)
      if (host === undefined) return []
      return [{
        ...host,
        id: 'winrm:' + host.alias,
        transport: 'winrm' as const,
        winrmTransport: transport,
        capabilities: { terminal: true, transfer: true, tunnel: false, services: true, processes: true, cluster: true },
      }]
    })
    return [...ssh, ...winrm].sort((left, right) => left.transport.localeCompare(right.transport) || left.alias.localeCompare(right.alias))
  }
}
