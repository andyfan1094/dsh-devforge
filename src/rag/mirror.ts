/**
 * 只读镜像连接器 —— Mnemon / Hindsight 记忆只读拉取入库（红线：零写入协议）。
 *
 * - Mnemon：读全局数据根（storageScope=global → ~/.mnemon）下的
 *   runtime/MEMORY.md、runtime/USER.md 与 documents/active/*.md（含 index.json 标题）；
 *   Windows 与 macOS 同规则展开主目录，custom dataDir 可配置覆盖。
 * - Hindsight：读 ~/.hindsight/coding-agent.json 的 apiUrl/apiToken/bankId（值不落日志），
 *   GET /v1/default/banks/{bank}/knowledge-base/tree → 列页 → 逐页拉正文入库。
 * - 全部以镜像源文件名为幂等键（同内容零嵌入调用），失败只记录不中断。
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { upstreamRequestHeaders, upstreamResponseText } from '../upstream-fetch.ts'
import type { RagService } from './service.ts'

/** Hindsight 配置（只取连接所需三字段，令牌绝不落日志）。 */
export interface HindsightConfig {
  apiUrl: string
  apiToken?: string
  bankId?: string
  serverMode?: string
  apiPort?: number
}

/** 读取 Hindsight 配置文件；缺失或损坏返回 undefined。 */
export function readHindsightConfig(configPath?: string): HindsightConfig | undefined {
  const path = configPath ?? process.env.HINDSIGHT_CONFIG ?? join(homedir(), '.hindsight', 'coding-agent.json')
  if (!existsSync(path)) return undefined
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
    const serverMode = typeof raw.serverMode === 'string' ? raw.serverMode : undefined
    const apiPort = typeof raw.apiPort === 'number' ? raw.apiPort : undefined
    const apiUrl = serverMode === 'daemon' && apiPort !== undefined
      ? 'http://127.0.0.1:' + apiPort
      : typeof raw.apiUrl === 'string' ? raw.apiUrl : undefined
    if (apiUrl === undefined) return undefined
    return {
      apiUrl: apiUrl.replace(/\/+$/, ''),
      ...(typeof raw.apiToken === 'string' && raw.apiToken !== '' ? { apiToken: raw.apiToken } : {}),
      ...(typeof raw.bankId === 'string' && raw.bankId !== '' ? { bankId: raw.bankId } : {}),
      serverMode,
      apiPort,
    }
  } catch { return undefined }
}

/** 解析 Hindsight 知识库标识（daemon 默认端口 8622；显式 bankId 优先）。 */
export function resolveBankId(config: HindsightConfig): string {
  if (config.bankId !== undefined && config.bankId !== '') return config.bankId
  return 'default'
}

/** 知识库页列表项。 */
export interface HindsightPageRef { id: string; name: string }

/** 从知识库树递归收集页面节点（只读）。 */
export function collectPageRefs(tree: unknown): HindsightPageRef[] {
  const out: HindsightPageRef[] = []
  const walk = (nodes: unknown): void => {
    if (!Array.isArray(nodes)) return
    for (const node of nodes) {
      const item = node as { id?: unknown; name?: unknown; kind?: unknown; children?: unknown }
      if (typeof item.id === 'string' && typeof item.name === 'string' && item.kind === 'page') {
        out.push({ id: item.id, name: item.name })
      }
      if (item.children !== undefined) walk(item.children)
    }
  }
  walk(tree)
  return out
}

/** Mnemon 数据根（global 规则：~/.mnemon；可用 dataDir 覆盖）。 */
export function mnemonDataRoot(dataDir?: string): string {
  if (dataDir !== undefined && dataDir.trim() !== '') return dataDir.replace(/^~(?=\/|$)/u, homedir())
  return join(homedir(), '.mnemon')
}

/** 收集 Mnemon 全局数据里可镜像的 Markdown 文件（相对键 → 绝对路径）。 */
export function listMnemonMarkdowns(root: string): Array<{ key: string; path: string }> {
  const out: Array<{ key: string; path: string }> = []
  const runtime = join(root, 'runtime')
  for (const name of ['MEMORY.md', 'USER.md']) {
    const p = join(runtime, name)
    if (existsSync(p)) out.push({ key: 'mnemon/runtime/' + name, path: p })
  }
  const active = join(root, 'documents', 'active')
  if (existsSync(active)) {
    let titles = new Map<string, string>()
    try {
      const index = JSON.parse(readFileSync(join(root, 'documents', 'index.json'), 'utf8')) as { documents?: Array<{ id?: unknown; title?: unknown }> }
      titles = new Map((index.documents ?? []).flatMap((d) => typeof d.id === 'string' && typeof d.title === 'string' ? [[d.id, d.title] as const] : []))
    } catch { /* 标题缺失不影响镜像 */ }
    try {
      for (const name of readdirSync(active)) {
        if (!name.endsWith('.md')) continue
        const p = join(active, name)
        const id = name.replace(/\.md$/u, '')
        const title = titles.get(id)
        out.push({ key: 'mnemon/docs/' + (title !== undefined ? title : id), path: p })
      }
    } catch { /* 目录不可读时跳过 */ }
  }
  return out
}

/** 镜像同步结果统计。 */
export interface MirrorReport {
  source: string
  scanned: number
  added: number
  updated: number
  removed: number
  skipped: number
  errors: string[]
}

/** 计算镜像文档的幂等哈希（同 Mnemon：内容级 sha256）。 */
function hashText(text: string): string { return createHash('sha256').update(text).digest('hex') }

/** 通用镜像入库：以 key 为文件名做增量（供 Mnemon/Hindsight 共用）。 */
async function mirrorIngest(rag: RagService, kbId: string, source: string, items: Array<{ key: string; text: string }>): Promise<MirrorReport> {
  const report: MirrorReport = { source, scanned: items.length, added: 0, updated: 0, removed: 0, skipped: 0, errors: [] }
  const existing = rag.listDocs(kbId)
  const byName = new Map(existing.map((doc) => [doc.fileName, doc]))
  const seen = new Set<string>()
  for (const item of items) {
    const prev = byName.get(item.key)
    const hash = hashText(item.text)
    if (prev !== undefined && prev.contentHash === hash && prev.status === 'ready') { report.skipped += 1; seen.add(item.key); continue }
    try {
      await rag.ingestText(kbId, item.key, item.text, { source: 'mirror' })
      seen.add(item.key)
      if (prev === undefined) report.added += 1; else report.updated += 1
    } catch (error) {
      report.errors.push(item.key + '：' + (error instanceof Error ? error.message : String(error)).slice(0, 160))
    }
  }
  for (const doc of existing) {
    if (seen.has(doc.fileName)) continue
    try { rag.deleteDoc(doc.id); report.removed += 1 } catch { /* 删除失败不中断 */ }
  }
  return report
}

/** Mnemon 全量镜像（runtime + documents/active）。 */
export async function syncMnemonMirror(rag: RagService, kbId: string, dataDir?: string): Promise<MirrorReport> {
  const root = mnemonDataRoot(dataDir)
  const items: Array<{ key: string; text: string }> = []
  for (const file of listMnemonMarkdowns(root)) {
    try { items.push({ key: file.key, text: readFileSync(file.path, 'utf8') }) }
    catch (error) { items.push({ key: file.key, text: '' }) ; void error }
  }
  return await mirrorIngest(rag, kbId, 'mnemon', items)
}

/** Hindsight 知识页镜像（只读 HTTP：tree → 逐页正文）。 */
export async function syncHindsightMirror(rag: RagService, kbId: string, overrides?: { apiUrl?: string; apiToken?: string; bankId?: string; timeoutMs?: number }): Promise<MirrorReport> {
  const config = readHindsightConfig()
  const apiUrl = (overrides?.apiUrl !== undefined && overrides.apiUrl !== '' ? overrides.apiUrl : config?.apiUrl ?? '').replace(/\/+$/, '')
  const report: MirrorReport = { source: 'hindsight', scanned: 0, added: 0, updated: 0, removed: 0, skipped: 0, errors: [] }
  if (apiUrl === '') { report.errors.push('未找到 Hindsight 配置（~/.hindsight/coding-agent.json），无法镜像'); return report }
  const bank = overrides?.bankId !== undefined && overrides.bankId !== '' ? overrides.bankId : resolveBankId(config ?? { apiUrl })
  const token = overrides?.apiToken !== undefined && overrides.apiToken !== '' ? overrides.apiToken : config?.apiToken
  const base = apiUrl + '/v1/default/banks/' + encodeURIComponent(bank)
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (token !== undefined) headers.Authorization = 'Bearer ' + token
  const timeout = overrides?.timeoutMs ?? 15000
  let tree: unknown
  try {
    const response = await fetch(base + '/knowledge-base/tree', { headers: upstreamRequestHeaders(headers), signal: AbortSignal.timeout(timeout) })
    if (!response.ok) { report.errors.push('知识库树 HTTP ' + response.status); return report }
    tree = (JSON.parse(await upstreamResponseText(response)) as { roots?: unknown }).roots
  } catch (error) {
    report.errors.push('知识库树请求失败：' + (error instanceof Error ? error.message : String(error)).slice(0, 160))
    return report
  }
  const pages = collectPageRefs(tree)
  report.scanned = pages.length
  const items: Array<{ key: string; text: string }> = []
  for (const page of pages) {
    try {
      const response = await fetch(base + '/knowledge-base/pages/' + encodeURIComponent(page.id), { headers: upstreamRequestHeaders(headers), signal: AbortSignal.timeout(timeout) })
      if (!response.ok) { report.errors.push(page.name + '：HTTP ' + response.status); continue }
      const doc = (JSON.parse(await upstreamResponseText(response)) as { markdown?: string; content?: string; body?: string })
      const text = doc.markdown ?? doc.content ?? doc.body ?? ''
      if (text.trim() === '') { report.skipped += 1; continue }
      items.push({ key: 'hindsight/' + page.name, text })
    } catch (error) {
      report.errors.push(page.name + '：' + (error instanceof Error ? error.message : String(error)).slice(0, 160))
    }
  }
  const ingest = await mirrorIngest(rag, kbId, 'hindsight', items)
  ingest.scanned = pages.length
  return ingest
}
