/**
 * 项目自动探测 —— 对远程主机跑只读命令，把项目在服务器上的真实落点找出来（0.40.x）。
 *
 * 解决的问题：项目登记后「线上地址 / 测试地址 / 域名 / 发布服务器」全靠手填，登记表长期空着。
 * 本模块的自动化边界（保守，绝不覆盖手填值）：
 * - 探测命令全部只读（grep / ls / systemctl list / Get-Website），不改服务器任何状态。
 * - 关键词来自项目名与路径目录名（去常见后缀提升命中），在 nginx / Caddy / systemd / IIS
 *   配置里匹配；命中即附「证据行」原文，可解释、可人工复核。
 * - 回填规则：字段为空 且 候选唯一 → 自动绑定；已有值或多义命中 → 跳过并在 skipped 里说明。
 * - 凭据零触碰：只读配置文本，不读任何密钥文件；证据行截断防刷屏。
 */
import type { DeployTarget, ProjectEntry, ProjectProbeResult, ProbeHit } from './protocol.ts'
import { saveProject } from './store.ts'

/** 引擎单次执行结果（与 remote 引擎 ExecResult 对齐；便于测试注入桩件）。 */
export interface ProbeEngineOutcome {
  success?: boolean
  exitCode?: number | null
  timedOut?: boolean
  stdout?: string
  stderr?: string
  error?: string
}

/** 探测引擎的最小形状（对齐 SSH/WinRM 引擎真实 exec；便于测试注入桩件）。 */
export interface ProbeEngines {
  ssh?: { exec(alias: string, command: string, timeoutMs?: number): Promise<ProbeEngineOutcome> }
  winrm?: { exec(alias: string, command: string, timeoutMs?: number): Promise<ProbeEngineOutcome> }
}

/** 主机清单条目（探测目标；deployTargets 为空时用全部已配置主机兜底）。
 *  host 为该台的 IP/主机名：站点绑定没有域名时用它 + 端口兜底构造地址（辉哥：IP 带端口也算）。 */
export interface ProbeHostRef {
  transport: 'ssh' | 'winrm'
  alias: string
  host?: string
}

/** 单台探测超时（毫秒）：只读命令应很快，30s 足够。 */
const PROBE_TIMEOUT_MS = 30_000

/** 单行证据上限（字符）。 */
const EVIDENCE_LINE_MAX = 200

/** 单台证据行数上限。 */
const EVIDENCE_LINES_MAX = 8

/** 测试环境线索词（文件名/路径/主机名/站点名包含即视为测试落点）。
 *  词边界含驼峰：TESTHecnyOpenAIapi 这类 TEST 紧贴大写驼峰也算测试站。 */
const TEST_HINT_RE = /(^|[-._/])(test|testing|staging|stage|uat|dev|preview|预发|测试)(?=[-._/A-Z\u4e00-\u9fff]|$)/i

/** 无效域名黑名单（server_name 里的占位/回环项）。 */
const INVALID_DOMAIN_RE = /^(~|_|\*|localhost|127\.0\.0\.1|0\.0\.0\.0|::1|default_server)/i

/** 转义正则特殊字符（关键词进 grep -E 模式前用）。 */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 工作区布局通用段黑名单（0.65.0）：项目常放在 D:\项目\projects\dsh-plugins\<项目> 这类
 * 分层目录里，路径段 projects/plugins 对每台机器都成立、毫无辨识度，一旦当关键词就会
 * 把服务器上所有同类目录误判成该项目站点（实测 dsh-devforge 探测出关键词
 * 「devforge/projects/plugins」，正是这个噪音）。这里只保留真正有项目特征的词。
 */
const PROJECT_KEYWORD_STOPWORDS = new Set([
  'projects', 'project', 'plugins', 'plugin', 'packages', 'package',
  'workspace', 'workspaces', 'build', 'dist', 'source', 'sources',
])

/**
 * 从项目名与路径目录名提取探测关键词：
 * 小写分词取长度 ≥5 的段（过短易误报），剔除工作区布局通用段，并对常见技术后缀做归并
 * （modagentai-site → modagentai；HecnyExpressWebApi → hecnyexpress + hecny）。
 * 项目名本身必定参与（路径段可被黑名单滤掉，但项目名不滤——项目名是强特征）。
 */
export function projectKeywords(entry: Pick<ProjectEntry, 'name' | 'path'>): string[] {
  const raw = [entry.name, ...entry.path.split(/[\\/]+/)].filter((part) => part !== '')
  const tokens = new Set<string>()
  for (const part of raw) {
    const fromName = part === entry.name
    for (const token of part.toLowerCase().split(/[^a-z0-9\u4e00-\u9fff]+/)) {
      if (token.length < 5) continue
      if (!fromName && PROJECT_KEYWORD_STOPWORDS.has(token)) continue
      tokens.add(token)
    }
  }
  // 归并去后缀：x-site / x-web / x-api / x-server / x-app / x-gateway / x-service → x
  for (const token of [...tokens]) {
    const stem = token.replace(/(site|web|api|server|app|gateway|service|backend|frontend)$/, '')
    if (stem.length >= 5 && !PROJECT_KEYWORD_STOPWORDS.has(stem)) tokens.add(stem)
  }
  return [...tokens].sort((a, b) => b.length - a.length).slice(0, 6)
}

/** 组装 Linux 只读探测命令：nginx/Caddy 配置 grep + 部署目录 + systemd 服务清单。 */
export function buildSshProbeCommand(keywords: string[]): string {
  const pattern = keywords.map(escapeRegExp).join('|')
  return [
    `grep -riHE '${pattern}' /etc/nginx/sites-enabled /etc/nginx/conf.d /etc/caddy 2>/dev/null | head -200`,
    "echo '---DIRS---'",
    "ls -d /opt/* /var/www/* /srv/* /data/* 2>/dev/null",
    "echo '---SVC---'",
    "systemctl list-unit-files --type=service --no-legend 2>/dev/null | awk '{print $1}'",
  ].join('; ')
}

/** 组装 Windows 只读探测命令：IIS 站点清单（名称|状态|物理路径|绑定）。 */
export function buildWinrmProbeCommand(): string {
  return 'Import-Module WebAdministration; Get-Website | ForEach-Object { $b = ($_.bindings.Collection | ForEach-Object { $_.bindingInformation }) -join \';\'; "$($_.Name)|$($_.State)|$($_.PhysicalPath)|$b" }'
}

/** 截断证据行并限量。 */
function clampEvidence(lines: string[]): string[] {
  return lines
    .map((line) => (line.length > EVIDENCE_LINE_MAX ? line.slice(0, EVIDENCE_LINE_MAX) + '…' : line))
    .slice(0, EVIDENCE_LINES_MAX)
}

/** 从 listen 值提取端口（default_server/[::] 等修饰都能容忍）。 */
function extractPort(listen: string): number | undefined {
  const match = listen.match(/(\d{2,5})/)
  const port = match !== null ? Number(match[1]) : undefined
  return port !== undefined && port >= 1 && port <= 65535 ? port : undefined
}

/** 域名组装地址：有证书线索用 https；非标端口显式带上。 */
function buildUrl(domain: string, port: number | undefined, https: boolean): string {
  const scheme = https ? 'https' : 'http'
  const defaultPort = https ? 443 : 80
  return scheme + '://' + domain + (port !== undefined && port !== defaultPort ? ':' + String(port) : '')
}

/** 解析出的单个 nginx/Caddy 站点候选（内部中间结构）。 */
interface SshSiteCandidate {
  file: string
  domains: string[]
  port?: number
  https: boolean
  roots: string[]
  proxies: string[]
  isTest: boolean
  evidence: string[]
}

/**
 * 解析 SSH 探测输出：grep 结果按文件归组还原站点画像，再叠加目录/服务线索。
 * 仅返回与项目关键词确实相关的文件（命中关键词才算），避免把服务器上全部站点都拉回来。
 * fallbackHost：站点没有 server_name 域名时，用该主机 IP/主机名 + 端口兜底构造地址。
 */
export function parseSshProbeOutput(keywords: string[], stdout: string, fallbackHost?: string): ProbeHit[] {
  const pattern = new RegExp(keywords.map(escapeRegExp).join('|'), 'i')
  const dirSep = '---DIRS---'
  const svcSep = '---SVC---'
  const grepPart = stdout.includes(dirSep) ? stdout.slice(0, stdout.indexOf(dirSep)) : stdout
  const dirsPart = stdout.includes(dirSep)
    ? (stdout.includes(svcSep) ? stdout.slice(stdout.indexOf(dirSep) + dirSep.length, stdout.indexOf(svcSep)) : stdout.slice(stdout.indexOf(dirSep) + dirSep.length))
    : ''
  const svcPart = stdout.includes(svcSep) ? stdout.slice(stdout.indexOf(svcSep) + svcSep.length) : ''

  // 按文件归组还原配置行
  const byFile = new Map<string, string[]>()
  for (const rawLine of grepPart.split('\n')) {
    const line = rawLine.trim()
    if (line === '') continue
    const idx = line.indexOf(':')
    if (idx <= 0) continue
    const file = line.slice(0, idx)
    const content = line.slice(idx + 1).trim()
    if (!byFile.has(file)) byFile.set(file, [])
    byFile.get(file)!.push(content)
  }

  const hits: ProbeHit[] = []
  for (const [file, contents] of byFile) {
    // 文件级命中：任一行内容（含文件路径）匹配关键词
    const fileHit = pattern.test(file) || contents.some((content) => pattern.test(content))
    if (!fileHit) continue
    const domains = new Set<string>()
    let port: number | undefined
    let https = false
    const roots: string[] = []
    const proxies: string[] = []
    const evidence: string[] = []
    for (const content of contents) {
      const serverName = content.match(/server_name\s+([^;]+);/i)
      if (serverName !== null) {
        for (const domain of serverName[1].trim().split(/\s+/)) {
          if (!INVALID_DOMAIN_RE.test(domain)) domains.add(domain)
        }
      }
      if (port === undefined && /listen\s/i.test(content)) port = extractPort(content) ?? undefined
      // https 证据：listen 带 ssl 标志，或显式 ssl_certificate 配置
      if (/listen[^;]*\bssl\b/i.test(content) || /ssl_certificate\s/i.test(content)) https = true
      const root = content.match(/root\s+([^;]+);/i)
      if (root !== null) roots.push(root[1].trim())
      const proxy = content.match(/proxy_pass\s+([^;]+);/i)
      if (proxy !== null) proxies.push(proxy[1].trim())
      if (evidence.length < EVIDENCE_LINES_MAX) evidence.push(content)
    }
    const domain = [...domains][0]
    if (domain === undefined && roots.length === 0 && proxies.length === 0) continue
    const isTest = TEST_HINT_RE.test(file) || contents.some((content) => TEST_HINT_RE.test(content))
    const evidenceLines = [file, ...evidence]
    if (domain !== undefined) {
      hits.push({
        transport: 'ssh',
        alias: '',
        domain,
        siteUrl: buildUrl(domain, port, https),
        ...(isTest ? { testUrl: buildUrl(domain, port, https) } : {}),
        ...(roots[0] !== undefined ? { deployDir: roots[0] } : (proxies[0] !== undefined ? { deployDir: proxies[0] } : {})),
        evidence: clampEvidence(evidenceLines),
      })
    } else {
      // 无域名但 root/proxy 命中：用主机 IP + 端口兜底地址（没有 IP 则只给部署目录证据）
      const fallbackUrl = fallbackHost !== undefined && fallbackHost !== '' && port !== undefined
        ? buildUrl(fallbackHost, port, https)
        : undefined
      hits.push({
        transport: 'ssh',
        alias: '',
        ...(fallbackUrl !== undefined ? { domain: fallbackHost!, siteUrl: fallbackUrl } : {}),
        ...(roots[0] !== undefined ? { deployDir: roots[0] } : (proxies[0] !== undefined ? { deployDir: proxies[0] } : {})),
        evidence: clampEvidence(evidenceLines),
      })
    }
  }

  // 目录与服务线索并入首个命中（或独立成行）
  const matchedDirs = dirsPart.split('\n').map((line) => line.trim()).filter((line) => line !== '' && pattern.test(line))
  const matchedSvcs = svcPart.split('\n').map((line) => line.trim()).filter((line) => line !== '' && line.endsWith('.service') && pattern.test(line))
  if (hits.length > 0) {
    if (matchedDirs[0] !== undefined && hits[0].deployDir === undefined) hits[0].deployDir = matchedDirs[0]
    if (matchedSvcs[0] !== undefined) hits[0].serviceName = matchedSvcs[0]
  } else if (matchedDirs[0] !== undefined || matchedSvcs[0] !== undefined) {
    hits.push({
      transport: 'ssh',
      alias: '',
      ...(matchedDirs[0] !== undefined ? { deployDir: matchedDirs[0] } : {}),
      ...(matchedSvcs[0] !== undefined ? { serviceName: matchedSvcs[0] } : {}),
      evidence: clampEvidence([...(matchedDirs[0] !== undefined ? [matchedDirs[0]] : []), ...(matchedSvcs[0] !== undefined ? [matchedSvcs[0]] : [])]),
    })
  }
  return hits
}

/**
 * 解析 WinRM 探测输出：每行 `Name|State|PhysicalPath|bindings`，
 * bindings 项形如 `host:port:ip`；站点名/物理路径命中关键词才算。
 * fallbackHost：绑定没有 host（如 `*:3505:`）时，用该主机 IP/主机名 + 端口兜底构造地址。
 */
export function parseWinrmProbeOutput(keywords: string[], stdout: string, fallbackHost?: string): ProbeHit[] {
  const pattern = new RegExp(keywords.map(escapeRegExp).join('|'), 'i')
  const hits: ProbeHit[] = []
  for (const rawLine of stdout.split('\n')) {
    const line = rawLine.trim()
    if (line === '' || !line.includes('|')) continue
    const [name, state, physicalPath, bindings = ''] = line.split('|').map((part) => part.trim())
    if (!pattern.test(name ?? '') && !pattern.test(physicalPath ?? '')) continue
    const bindingList = bindings.split(';').filter((item) => item !== '')
    const firstBinding = bindingList[0] ?? ''
    const parts = firstBinding.split(':')
    const rawHost = parts[0]
    const host = rawHost !== undefined && rawHost !== '' && rawHost !== '*' ? rawHost : undefined
    const port = parts[1] !== undefined ? Number(parts[1]) : undefined
    const portValid = Number.isFinite(port)
    const httpsBinding = bindingList.some((item) => item.split(':').length >= 2 && Number(item.split(':')[1]) === 443)
    // 地址 = 绑定域名（含 IP 型绑定），没有域名时退回主机 IP + 端口（辉哥：IP 带端口也算）
    const urlHost = host ?? (fallbackHost !== undefined && fallbackHost !== '' ? fallbackHost : undefined)
    const evidence = [`站点 ${name}（${state ?? '未知'}）`, `物理路径 ${physicalPath}`, ...bindingList.map((item) => '绑定 ' + item)]
    hits.push({
      transport: 'winrm',
      alias: '',
      ...(urlHost !== undefined && portValid ? { domain: urlHost, siteUrl: buildUrl(urlHost, port, httpsBinding) } : {}),
      ...((TEST_HINT_RE.test(name ?? '') || TEST_HINT_RE.test(physicalPath ?? '')) && urlHost !== undefined && portValid ? { testUrl: buildUrl(urlHost, port, httpsBinding) } : {}),
      ...(physicalPath !== undefined && physicalPath !== '' ? { deployDir: physicalPath } : {}),
      ...(name !== undefined && name !== '' ? { serviceName: name } : {}),
      evidence: clampEvidence(evidence),
    })
  }
  return hits
}

/** 引擎结果判定（对齐 deploy.judgeOutcome 语义，避免跨模块耦合）。 */
function judgeOutcome(outcome: ProbeEngineOutcome): { ok: boolean; error?: string } {
  if (outcome.timedOut === true) return { ok: false, error: '探测命令超时' }
  if (outcome.error !== undefined && outcome.error !== '') return { ok: false, error: outcome.error }
  if (typeof outcome.exitCode === 'number') return outcome.exitCode === 0 ? { ok: true } : { ok: false, error: '退出码 ' + outcome.exitCode }
  return outcome.success === true ? { ok: true } : { ok: false, error: '退出码不可知（通道异常）' }
}

/** 逐台探测（deployTargets 优先；为空时对全部已配置主机兜底），单台失败不中断。 */
export async function runProjectProbe(
  entry: ProjectEntry,
  engines: ProbeEngines,
  allHosts: ProbeHostRef[],
): Promise<ProjectProbeResult> {
  const keywords = projectKeywords(entry)
  if (keywords.length === 0) return { ok: false, hits: [], applied: [], skipped: [], error: '项目名与路径无法提取探测关键词。' }
  if (engines.ssh === undefined && engines.winrm === undefined) {
    return { ok: false, hits: [], applied: [], skipped: [], error: '远程运维未启用（remote.enabled=false），无法探测。' }
  }

  const targets: ProbeHostRef[] = entry.deployTargets.length > 0
    ? entry.deployTargets.map((target) => {
      const known = allHosts.find((candidate) => candidate.transport === target.transport && candidate.alias === target.alias)
      return { transport: target.transport, alias: target.alias, ...(known?.host !== undefined ? { host: known.host } : {}) }
    })
    : allHosts
  if (targets.length === 0) {
    return { ok: false, hits: [], applied: [], skipped: [], error: '没有可探测主机：项目未绑定发布服务器，且远程运维未配置任何主机。' }
  }

  const hits: ProbeHit[] = []
  const failures: string[] = []
  for (const target of targets) {
    const engine = target.transport === 'ssh' ? engines.ssh : engines.winrm
    if (engine === undefined) continue
    const command = target.transport === 'ssh' ? buildSshProbeCommand(keywords) : buildWinrmProbeCommand()
    try {
      const outcome = await engine.exec(target.alias, command, PROBE_TIMEOUT_MS)
      const verdict = judgeOutcome(outcome)
      if (!verdict.ok) {
        failures.push(target.transport + ':' + target.alias + '（' + (verdict.error ?? '未知原因') + '）')
        continue
      }
      const parsed = target.transport === 'ssh'
        ? parseSshProbeOutput(keywords, outcome.stdout ?? '', target.host)
        : parseWinrmProbeOutput(keywords, outcome.stdout ?? '', target.host)
      for (const hit of parsed) hits.push({ ...hit, alias: target.alias })
    } catch (cause) {
      failures.push(target.transport + ':' + target.alias + '（' + (cause instanceof Error ? cause.message : String(cause)) + '）')
    }
  }

  // 保守回填：字段为空 且 候选唯一 → 自动绑定；否则跳过并说明
  const applied: string[] = []
  const skipped: string[] = []
  const patch: Partial<ProjectEntry> = {}
  const nextTargets: DeployTarget[] = [...entry.deployTargets]

  const prodCandidates = [...new Set(hits.filter((hit) => hit.siteUrl !== undefined && hit.testUrl === undefined).map((hit) => hit.siteUrl!))]
  if (entry.siteUrl === '' && prodCandidates.length === 1) {
    patch.siteUrl = prodCandidates[0]
    applied.push('已回填线上地址 ' + prodCandidates[0])
  } else if (entry.siteUrl === '' && prodCandidates.length > 1) {
    skipped.push('线上地址候选多个（' + prodCandidates.join('、') + '），未自动回填，请人工确认')
  }

  const testCandidates = [...new Set(hits.filter((hit) => hit.testUrl !== undefined).map((hit) => hit.testUrl!))]
  if ((entry.testUrl ?? '') === '' && testCandidates.length === 1) {
    patch.testUrl = testCandidates[0]
    applied.push('已回填测试地址 ' + testCandidates[0])
  } else if ((entry.testUrl ?? '') === '' && testCandidates.length > 1) {
    skipped.push('测试地址候选多个（' + testCandidates.join('、') + '），未自动回填')
  }

  if (nextTargets.length === 0 && hits.length > 0) {
    const withDir = hits.find((hit) => hit.deployDir !== undefined) ?? hits[0]
    nextTargets.push({ transport: withDir.transport, alias: withDir.alias, ...(withDir.deployDir !== undefined ? { remotePath: withDir.deployDir } : {}) })
    applied.push('已绑定发布服务器 ' + withDir.transport + ':' + withDir.alias + (withDir.deployDir !== undefined ? '（远程路径 ' + withDir.deployDir + '）' : ''))
  }

  if (Object.keys(patch).length > 0 || nextTargets.length !== entry.deployTargets.length) {
    saveProject({ id: entry.id, ...patch, ...(nextTargets.length !== entry.deployTargets.length ? { deployTargets: nextTargets } : {}) })
  }

  const emptyHosts = failures.length > 0 ? '；探测失败：' + failures.join('、') : ''
  return {
    ok: true,
    hits,
    applied,
    skipped: [...skipped, ...(targets.length > 0 && hits.length === 0 ? ['全部 ' + String(targets.length) + ' 台主机未发现与「' + keywords.join('/') + '」相关的站点配置' + emptyHosts] : [])],
  }
}
