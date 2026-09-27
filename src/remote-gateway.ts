/**
 * 远程访问网关（0.41.0）—— 天工造梦面板配置「开关 + 端口 + 密码」，员工浏览器输密码即可访问本机 DSH Web。
 *
 * 架构与调用方向：
 *   员工浏览器 ──▶ 网关（本模块，对外端口）──密码认证──▶ 本机 DSH Web（127.0.0.1:upstreamPort）
 *
 * DSH 双层认证的处理（为什么需要签名器）：
 *   DSH Web 自身还有一道「启动 token → 签名会话 Cookie」认证（dsh-auth-*，绑定 Host 头、
 *   HMAC-SHA256 签名，secret 持久化在宿主凭据文件）。员工浏览器只有网关密码、没有 DSH 会话，
 *   直接转发会被 DSH 以 401 拒绝。因此网关在启动时读取宿主凭据文件里的
 *   client-connection/browser-session secret，转发时自动签发机器内会话 Cookie（v1.payload.hmac），
 *   与宿主 isAuthenticated 的校验规则完全对齐（authority 绑定 Host 头、7 天有效期）。
 *   该 Cookie 只存在于网关→DSH 的本机回环请求里，绝不发给员工浏览器。
 *
 * 安全边界（为什么这样做）：
 *  - DSH Web 本体保持只听回环，外网唯一入口是网关一道门；网关关闭时外部完全不可达。
 *  - 密码比较走 SHA-256 摘要 + timingSafeEqual，恒定时间，防时序侧信道；先摘要再比较也
 *    规避了 timingSafeEqual 对长度不一致直接抛异常的问题。
 *  - 登录失败限速：单 IP 连错 5 次锁 60 秒，防公网暴力穷举。
 *  - 会话 Cookie：HttpOnly（禁脚本读取）+ SameSite=Lax（防跨站）+ 过期时间，超时需重新登录。
 *  - WebSocket upgrade 原样转发：DSH Web GUI 与宿主的 WS 通道必须保持工作。
 *  - 密码与 secret 只存在于内存，绝不写入任何日志。
 *  - 只依赖 node:http / node:crypto / node:os 内置模块，零新增第三方依赖。
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer, request as httpRequest, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import type { Socket } from 'node:net'

/** 网关日志出口（由调用方用 ctx.logger 包装，避免日志异常影响业务）。 */
export interface GatewayLog {
  info(message: string, ...args: unknown[]): void
  warn(message: string, ...args: unknown[]): void
}

/** 网关配置（由插件 Config.remoteAccess 规整后传入）。 */
export interface RemoteGatewayConfig {
  /** 监听端口（对外服务端口）。 */
  port: number
  /** 监听地址：0.0.0.0 = 所有网卡；127.0.0.1 = 仅本机（调试用）。 */
  host: string
  /** 访问密码（空串视为未配置，网关拒绝启动）。 */
  password: string
  /** 转发目标：本机 DSH Web 端口。 */
  upstreamPort: number
  /** 登录会话有效期（小时）。 */
  sessionHours: number
  /** 宿主凭据文件路径（默认 <家目录>\.dsh\.credentials.yaml；暂存实例经 USERPROFILE 自动隔离）。 */
  credentialsFile?: string
}

/** 网关句柄：dispose 停止监听并断开全部连接。 */
export interface RemoteGateway {
  dispose(): void
  /** 当前是否在监听。 */
  readonly running: boolean
  /** 实际监听端口（配置 port=0 由系统分配时，以此为准）。 */
  readonly listeningPort: number | undefined
}

/** 会话有效期上限（7 天）：防止配置出超长会话长期挂机。 */
const MAX_SESSION_HOURS = 168

/** 登录失败限速：窗口内最大失败次数。 */
const LOGIN_MAX_FAILURES = 5

/** 登录失败锁定时长（毫秒）。 */
const LOGIN_LOCK_MS = 60_000

/** 会话 Cookie 名（带网关前缀，避免与上游 Cookie 混淆）。 */
const SESSION_COOKIE = 'devforge_gw_session'

/** 网关自身路由前缀（登录/登出），其余路径全部反代上游。 */
const LOGIN_PATH = '/__gateway/login'
const LOGOUT_PATH = '/__gateway/logout'

/** 进行中的会话：token → 过期时间戳（毫秒）。 */
const sessions = new Map<string, number>()

/** 登录失败记录：ip → { 失败次数, 锁定截止时间 }。 */
const loginFailures = new Map<string, { count: number; lockedUntil: number }>()

/** SHA-256 摘要比较：恒定时间且不受长度差异影响。 */
function passwordMatches(candidate: string, password: string): boolean {
  const a = createHash('sha256').update(candidate, 'utf8').digest()
  const b = createHash('sha256').update(password, 'utf8').digest()
  return timingSafeEqual(a, b)
}

/** 从 Cookie 头解析指定名字的值；无该 Cookie 返回空串。 */
function readCookie(req: IncomingMessage, name: string): string {
  const header = req.headers.cookie ?? ''
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return decodeURIComponent(rest.join('='))
  }
  return ''
}

/** 请求来源 IP（x-forwarded-for 优先，便于将来挂在别的反代后面）。 */
function clientIpOf(req: IncomingMessage): string {
  const forwarded = req.headers['x-forwarded-for']
  if (typeof forwarded === 'string' && forwarded !== '') return forwarded.split(',')[0].trim()
  return req.socket.remoteAddress ?? 'unknown'
}

/** 会话是否有效（存在且未过期；过期即清理）。 */
function sessionValid(token: string, sessionHours: number): boolean {
  if (token === '') return false
  const expiresAt = sessions.get(token)
  if (expiresAt === undefined) return false
  if (Date.now() >= expiresAt) {
    sessions.delete(token)
    return false
  }
  // 滑动续期：每次有效访问把会话顺延到「当前时间 + 有效期」，活跃用户不掉线。
  sessions.set(token, Date.now() + sessionHours * 3_600_000)
  return true
}

/** 限速判断：该 IP 当前是否处于锁定状态。 */
function isLocked(ip: string): boolean {
  const record = loginFailures.get(ip)
  // 未锁定时 lockedUntil 保持哨兵值 0：必须先排除，否则 0 会被当成「早已过期」误删失败计数。
  if (record === undefined || record.lockedUntil === 0) return false
  if (Date.now() >= record.lockedUntil) {
    loginFailures.delete(ip)
    return false
  }
  return true
}

/** 记录一次登录失败；达到阈值进入锁定。 */
function recordLoginFailure(ip: string): void {
  const record = loginFailures.get(ip) ?? { count: 0, lockedUntil: 0 }
  record.count += 1
  if (record.count >= LOGIN_MAX_FAILURES) {
    record.lockedUntil = Date.now() + LOGIN_LOCK_MS
    record.count = 0
  }
  loginFailures.set(ip, record)
}

/** 登录页（内联极简中文表单；fetch 提交 JSON，避免整页表单跳转的黑框感）。 */
function renderLoginPage(message: string): string {
  const tip = message === '' ? '' : `<p class="tip error">${message}</p>`
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>天工造梦 · 访问验证</title>
<style>
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
         background: #0f1420; font-family: "Microsoft YaHei", system-ui, sans-serif; color: #e8ecf4; }
  .card { width: min(360px, 88vw); background: #171e2e; border: 1px solid #2a3550; border-radius: 14px;
          padding: 36px 32px; box-shadow: 0 18px 50px rgba(0,0,0,.45); }
  h1 { font-size: 19px; margin: 0 0 6px; text-align: center; }
  p.sub { font-size: 12.5px; color: #8fa0bd; text-align: center; margin: 0 0 22px; }
  input[type=password] { width: 100%; box-sizing: border-box; padding: 11px 12px; border-radius: 9px;
          border: 1px solid #2f3d5e; background: #0f1524; color: #e8ecf4; font-size: 15px; outline: none; }
  input[type=password]:focus { border-color: #4d7cff; }
  button { width: 100%; margin-top: 14px; padding: 11px 0; border: 0; border-radius: 9px; cursor: pointer;
           background: #3b6cff; color: #fff; font-size: 15px; font-weight: 600; }
  button:hover { background: #4d7cff; }
  button:disabled { opacity: .55; cursor: wait; }
  .tip { font-size: 12.5px; text-align: center; margin: 12px 0 0; }
  .error { color: #ff7b7b; }
</style>
</head>
<body>
  <div class="card">
    <h1>天工造梦 · 维护控制台</h1>
    <p class="sub">请输入访问密码继续</p>
    <input id="pwd" type="password" placeholder="访问密码" autofocus />
    <button id="go" type="button">进入</button>
    ${tip}
  </div>
  <script>
    const btn = document.getElementById('go')
    const pwd = document.getElementById('pwd')
    async function submit() {
      btn.disabled = true
      try {
        const res = await fetch('${LOGIN_PATH}', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ password: pwd.value }),
        })
        if (res.ok) { location.reload(); return }
        location.href = '${LOGIN_PATH}?e=' + (res.status === 429 ? 'locked' : 'bad')
      } catch { location.href = '${LOGIN_PATH}?e=bad' }
    }
    btn.addEventListener('click', submit)
    pwd.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit() })
  </script>
</body>
</html>`
}

/** 发送 HTML 响应。 */
function sendHtml(res: ServerResponse, status: number, html: string): void {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
  res.end(html)
}

/** 读取请求体并按 JSON 解析（登录提交；限制 8KB 防滥用）。 */
function readJsonBody(req: IncomingMessage): Promise<{ password?: string }> {
  return new Promise((resolvePromise, rejectPromise) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > 8192) {
        rejectPromise(new Error('请求体过大'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { password?: string }
        resolvePromise(typeof parsed?.password === 'string' ? parsed : {})
      } catch {
        resolvePromise({})
      }
    })
    req.on('error', rejectPromise)
  })
}

/**
 * 判断逐跳头（hop-by-hop）并从透传头里剔除：这些头描述的是「这一段连接」，不应跨代理传递。
 * WebSocket upgrade 场景由转发逻辑单独处理，不走这里。
 */
const HOP_BY_HOP_HEADERS = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade',
])

/** 复制请求头到上游请求（剔除逐跳头；附加 x-forwarded-for 便于上游识别真实来源）。 */
function forwardHeaders(req: IncomingMessage): Record<string, string | string[] | undefined> {
  const headers: Record<string, string | string[] | undefined> = {}
  for (const [name, value] of Object.entries(req.headers)) {
    if (HOP_BY_HOP_HEADERS.has(name.toLowerCase())) continue
    headers[name] = value
  }
  const prior = typeof req.headers['x-forwarded-for'] === 'string' ? req.headers['x-forwarded-for'] + ', ' : ''
  headers['x-forwarded-for'] = prior + clientIpOf(req)
  return headers
}

/** DSH 浏览器会话 Cookie 的有效期：机器内回环转发用，签 1 天足够且必小于宿主 Cookie 上限。 */
const DSH_COOKIE_TTL_MS = 24 * 3_600_000

/** 与宿主一致的 base64url 编码（+/ 换 -_、去填充）。 */
function base64Url(value: Buffer | string): string {
  return Buffer.from(value).toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')
}

/** 与宿主一致的 authority 计算：Host 头原样归一（缺 Host 返回空串，调用方据此跳过注入）。 */
function requestAuthorityOf(req: IncomingMessage): string {
  const host = req.headers.host
  if (typeof host !== 'string' || host === '') return ''
  try {
    return new URL(`http://${host}`).host
  } catch {
    return ''
  }
}

/**
 * 读取宿主凭据文件里的 client-connection/browser-session secret（base64url 编码的 32 字节）。
 * 针对宿主固定写入结构做行级解析：定位记录键行后，在缩进块内取第一个 secret 字段；
 * 解码后校验 32 字节长度（与宿主 canonicalSecret 同规则），不合法按未读到处理。
 */
export function loadDshSessionSecret(credentialsFile: string): Buffer | undefined {
  try {
    const lines = readFileSync(credentialsFile, 'utf8').split(/\r?\n/)
    const recordIndex = lines.findIndex((line) => line.trim() === 'client-connection/browser-session:')
    if (recordIndex === -1) return undefined
    for (let i = recordIndex + 1; i < lines.length; i += 1) {
      const line = lines[i]
      if (line.trim() !== '' && !line.startsWith(' ') && !line.startsWith('\t')) break
      const match = /^\s+secret:\s*([A-Za-z0-9_-]+)\s*$/u.exec(line)
      if (match !== null) {
        const secret = Buffer.from(match[1], 'base64')
        return secret.byteLength === 32 ? secret : undefined
      }
    }
    return undefined
  } catch {
    return undefined
  }
}

/**
 * DSH 会话签名器：为网关→DSH 的回环转发请求自动签发 dsh-auth-* 会话 Cookie，
 * 让只有网关密码的员工浏览器也能透过 DSH 自身的认证栅栏。secret 不落日志。
 */
class DshSessionSigner {
  private readonly secret: Buffer | undefined

  constructor(credentialsFile: string, log: GatewayLog) {
    this.secret = loadDshSessionSecret(credentialsFile)
    if (this.secret === undefined) {
      log.warn('[devforge-gateway] 未���到宿主浏览器会话凭据（%s）：转发将被 DSH 401 拒绝；请确认网关与 DSH 同宿主且 DSH 已启动过一次', credentialsFile)
    }
  }

  /** 是否具备签名能力。 */
  get ready(): boolean { return this.secret !== undefined }

  /** 按转发请求的 authority（Host 头）现签一枚机器内会话 Cookie；无 secret 返回空串。 */
  cookieFor(authority: string): string {
    if (this.secret === undefined || authority === '') return ''
    const issuedAt = Date.now()
    const payload = { version: 1, authority, issuedAt, expiresAt: issuedAt + DSH_COOKIE_TTL_MS }
    const body = base64Url(Buffer.from(JSON.stringify(payload), 'utf8'))
    const signature = base64Url(createHmac('sha256', this.secret).update(body).digest())
    const name = 'dsh-auth-' + base64Url(createHash('sha256').update(authority).digest())
    return `${name}=v1.${body}.${signature}`
  }
}

/**
 * 启动远程访问网关。
 * 返回句柄：dispose() 停止监听、清空会话（配置热更新时由插件 sync() 调用重建）。
 */
export function startRemoteGateway(config: RemoteGatewayConfig, log: GatewayLog): RemoteGateway {
  const password = config.password
  const sessionMs = Math.min(config.sessionHours, MAX_SESSION_HOURS) * 3_600_000
  // DSH 会话签名器：读宿主凭据 secret，转发时自动签 dsh-auth-* 机器内会话 Cookie（见类注释）。
  const signer = new DshSessionSigner(config.credentialsFile ?? join(homedir(), '.dsh', '.credentials.yaml'), log)

  /** 处理普通 HTTP 请求：网关自身路由之外，全部反代上游。 */
  async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = req.url ?? '/'

    // ---- 登录提交：校验限速与密码，成功发会话 Cookie ----
    if (req.method === 'POST' && url === LOGIN_PATH) {
      const ip = clientIpOf(req)
      if (isLocked(ip)) {
        log.warn('[devforge-gateway] 登录锁定中，已拒绝：%s', ip)
        sendHtml(res, 429, renderLoginPage('尝试过多，请 1 分钟后再试'))
        return
      }
      let candidate = ''
      try {
        candidate = (await readJsonBody(req)).password ?? ''
      } catch {
        sendHtml(res, 400, renderLoginPage('请求无效'))
        return
      }
      if (!passwordMatches(candidate, password)) {
        recordLoginFailure(ip)
        log.warn('[devforge-gateway] 登录失败：%s', ip)
        sendHtml(res, 401, renderLoginPage('密码不正确'))
        return
      }
      loginFailures.delete(ip)
      const token = randomBytes(32).toString('hex')
      sessions.set(token, Date.now() + sessionMs)
      log.info('[devforge-gateway] 登录成功：%s', ip)
      res.writeHead(200, {
        'set-cookie': `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(sessionMs / 1000)}`,
        'cache-control': 'no-store',
      })
      res.end('ok')
      return
    }

    // ---- 登出：清会话与 Cookie，回登录页 ----
    if (req.method === 'GET' && url === LOGOUT_PATH) {
      const token = readCookie(req, SESSION_COOKIE)
      if (token !== '') sessions.delete(token)
      res.writeHead(302, {
        location: LOGIN_PATH,
        'set-cookie': `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
      })
      res.end()
      return
    }

    // ---- 登录页本身无需会话；错误码经查询参数展示提示 ----
    if (url === LOGIN_PATH || url.startsWith(LOGIN_PATH + '?')) {
      const reason = new URL(url, 'http://gateway').searchParams.get('e') ?? ''
      const message = reason === 'locked' ? '尝试过多，请 1 分钟后再试' : reason === 'bad' ? '密码不正确' : ''
      sendHtml(res, 200, renderLoginPage(message))
      return
    }

    // ---- 其余路径一律要求有效会话 ----
    if (!sessionValid(readCookie(req, SESSION_COOKIE), config.sessionHours)) {
      res.writeHead(302, { location: LOGIN_PATH })
      res.end()
      return
    }

    // ---- 已认证：反代到本机 DSH Web（保留原始 Host/Origin；并注入机器内 DSH 会话 Cookie 过宿主认证栅栏）----
    const headers = forwardHeaders(req)
    const dshCookie = signer.cookieFor(requestAuthorityOf(req))
    if (dshCookie !== '') headers.cookie = typeof headers.cookie === 'string' && headers.cookie !== '' ? `${headers.cookie}; ${dshCookie}` : dshCookie
    const upstream = httpRequest({
      host: '127.0.0.1',
      port: config.upstreamPort,
      method: req.method,
      path: url,
      headers,
    })
    upstream.on('response', (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers)
      upstreamRes.pipe(res)
    })
    upstream.on('error', (error: Error) => {
      log.warn('[devforge-gateway] 上游请求失败：%s', error.message)
      if (!res.headersSent) sendHtml(res, 502, renderLoginPage('本机服务暂不可达，请确认 DSH Web 正在运行'))
      else res.end()
    })
    req.pipe(upstream)
  }

  /** 处理 WebSocket upgrade：会话有效才转发，双向管道直通。失败时回明确状态码便于诊断。 */
  function handleUpgrade(req: IncomingMessage, socket: Socket, head: Buffer): void {
    if (!sessionValid(readCookie(req, SESSION_COOKIE), config.sessionHours)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nconnection: close\r\n\r\n网关会话无效')
      socket.destroy()
      return
    }
    const upgradeHeaders: Record<string, string | string[] | undefined> = { ...req.headers }
    const upgradeCookie = signer.cookieFor(requestAuthorityOf(req))
    if (upgradeCookie !== '') {
      const raw = req.headers.cookie
      upgradeHeaders.cookie = typeof raw === 'string' && raw !== '' ? `${raw}; ${upgradeCookie}` : upgradeCookie
    }
    const upstream = httpRequest({
      host: '127.0.0.1',
      port: config.upstreamPort,
      path: req.url ?? '/',
      headers: upgradeHeaders,
      // node:http 对 upgrade 的要求：显式声明这两类头，收到 101 时触发 upgrade 事件
    })
    upstream.on('upgrade', (upstreamRes, upstreamSocket, upstreamHead) => {
      const lines = [`HTTP/1.1 ${upstreamRes.statusCode ?? 101} ${upstreamRes.statusMessage ?? ''}`]
      for (const [name, value] of Object.entries(upstreamRes.headers)) {
        if (value === undefined) continue
        lines.push(`${name}: ${Array.isArray(value) ? value.join(', ') : value}`)
      }
      socket.write(lines.join('\r\n') + '\r\n\r\n')
      if (upstreamHead.length > 0) socket.write(upstreamHead)
      upstreamSocket.pipe(socket)
      socket.pipe(upstreamSocket)
      const closeBoth = (): void => {
        upstreamSocket.destroy()
        socket.destroy()
      }
      upstreamSocket.on('error', closeBoth)
      socket.on('error', closeBoth)
    })
    upstream.on('response', (upstreamRes) => {
      // 上游拒绝升级（非 101）：把状态码回给客户端（可诊断），不给探测者更多信息。
      const body = upstreamRes.statusCode === 401 ? '上游认证被拒' : `上游拒绝升级（${upstreamRes.statusCode}）`
      socket.write(`HTTP/1.1 ${upstreamRes.statusCode ?? 502}\r\nconnection: close\r\n\r\n${body}`)
      socket.destroy()
    })
    upstream.on('error', (error: Error) => {
      socket.write('HTTP/1.1 502 Bad Gateway\r\nconnection: close\r\n\r\n上游不可达: ' + error.message)
      socket.destroy()
      log.warn('[devforge-gateway] WS 上游错误：%s', error.message)
    })
    upstream.end()
  }

  const server: Server = createServer((req, res) => {
    void handleRequest(req, res).catch((error: unknown) => {
      log.warn('[devforge-gateway] 请求处理异常：%s', error instanceof Error ? error.message : String(error))
      if (!res.headersSent) sendHtml(res, 500, renderLoginPage('服务异常，请稍后再试'))
      else res.end()
    })
  })
  server.on('upgrade', handleUpgrade)

  let running = false
  const gateway: RemoteGateway = {
    dispose(): void {
      running = false
      sessions.clear()
      loginFailures.clear()
      // closeAllConnections：不等 keep-alive 空闲连接自然超时，热更新即时释放端口。
      server.closeAllConnections()
      server.close(() => { log.info('[devforge-gateway] 网关已停止') })
    },
    get running(): boolean { return running },
    get listeningPort(): number | undefined {
      if (!running) return undefined
      const address = server.address()
      return typeof address === 'object' && address !== null ? address.port : undefined
    },
  }

  server.listen(config.port, config.host, () => {
    running = true
    const address = server.address()
    const boundPort = typeof address === 'object' && address !== null ? address.port : config.port
    log.info('[devforge-gateway] 远程访问网关已启动：http://%s:%d（上游 127.0.0.1:%d，会话 %d 小时）',
      config.host, boundPort, config.upstreamPort, Math.min(config.sessionHours, MAX_SESSION_HOURS))
  })
  server.on('error', (error: Error) => {
    running = false
    log.warn('[devforge-gateway] 网关启动失败（端口被占用？）：%s', error.message)
  })

  return gateway
}
