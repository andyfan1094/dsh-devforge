/**
 * 外部记忆迁移采集器 —— 把 Mnemon / Hindsight 内容转成内置记忆条目（只读外部数据）。
 *
 * - Mnemon：runtime/MEMORY.md、runtime/USER.md 按 § 分条；documents/active/*.md 整篇一条；
 * - Hindsight：读 ~/.hindsight/coding-agent.json → bank → 知识页正文（整页一条，超长截断）；
 * - 幂等：migrationKey = 来源 + 内容哈希，重复执行只更新不重复；任何一条失败不中断。
 */
import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { upstreamRequestHeaders, upstreamResponseText } from '../upstream-fetch.ts'
import { listMnemonMarkdowns, readHindsightConfig, resolveBankId } from '../rag/mirror.ts'
import type { NativeMemoryCategory, NativeMemoryMigrationItem } from './protocol.ts'

/** 单条内容上限（NativeMemoryStore 校验上限 20000，留余量）。 */
const MAX_CONTENT = 18_000

function hashText(text: string): string { return createHash('sha256').update(text).digest('hex').slice(0, 24) }

function clip(text: string): string {
  const trimmed = text.trim()
  return trimmed.length > MAX_CONTENT ? trimmed.slice(0, MAX_CONTENT) + '\n…（超长截断，原文见外部系统）' : trimmed
}

/** 解析 Mnemon 运行时 Markdown（§ 分条；导出供单测）。 */
export function parseMarkdownEntries(markdown: string): string[] {
  return markdown.split(/^§\s*$/mu).map((part) => part.trim()).filter((part) => part.length >= 6)
}

/** 采集 Mnemon 全部可迁移内容（runtime 分条 + documents 整篇）。 */
export function collectMnemonItems(root: string): NativeMemoryMigrationItem[] {
  const items: NativeMemoryMigrationItem[] = []
  for (const file of listMnemonMarkdowns(root)) {
    let text = ''
    try { text = readFileSync(file.path, 'utf8') } catch { continue }
    // runtime 两个文件按 § 分条成独立记忆；documents 文档保持整篇。
    const isRuntime = file.key.startsWith('mnemon/runtime/')
    const parts = isRuntime ? parseMarkdownEntries(text) : [clip(text)]
    if (parts.length === 0) continue
    parts.forEach((part, index) => {
      const category = file.key.includes('USER.md') ? 'preference' : 'general'
      items.push({
        content: clip(part),
        category,
        source: 'mnemon',
        importance: 3,
        migrationKey: 'mnemon:' + hashText(file.key + ':' + part),
        ...(isRuntime ? { tags: ['mnemon-runtime'] } : { tags: ['mnemon-doc'] }),
        ...(index >= 0 ? {} : {}),
      })
    })
  }
  return items.filter((item) => item.content.length >= 6)
}

/** 采集 Hindsight 知识页（只读 HTTP；未配置返回空数组）。 */
export async function collectHindsightItems(overrides?: { apiUrl?: string; apiToken?: string; bankId?: string; timeoutMs?: number }): Promise<NativeMemoryMigrationItem[]> {
  const config = readHindsightConfig()
  const apiUrl = (overrides?.apiUrl !== undefined && overrides.apiUrl !== '' ? overrides.apiUrl : config?.apiUrl ?? '').replace(/\/+$/, '')
  if (apiUrl === '') return []
  const bank = overrides?.bankId !== undefined && overrides.bankId !== '' ? overrides.bankId : resolveBankId(config ?? { apiUrl })
  const token = overrides?.apiToken !== undefined && overrides.apiToken !== '' ? overrides.apiToken : config?.apiToken
  const base = apiUrl + '/v1/default/banks/' + encodeURIComponent(bank)
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (token !== undefined) headers.Authorization = 'Bearer ' + token
  const timeout = overrides?.timeoutMs ?? 15000
  let tree: unknown
  try {
    const response = await fetch(base + '/knowledge-base/tree', { headers: upstreamRequestHeaders(headers), signal: AbortSignal.timeout(timeout) })
    if (!response.ok) return []
    tree = (JSON.parse(await upstreamResponseText(response)) as { roots?: unknown }).roots
  } catch { return [] }
  const pages: Array<{ id: string; name: string }> = []
  const walk = (nodes: unknown): void => {
    if (!Array.isArray(nodes)) return
    for (const node of nodes) {
      const item = node as { id?: unknown; name?: unknown; kind?: unknown; children?: unknown }
      if (typeof item.id === 'string' && typeof item.name === 'string' && item.kind === 'page') pages.push({ id: item.id, name: item.name })
      if (item.children !== undefined) walk(item.children)
    }
  }
  walk(tree)
  const items: NativeMemoryMigrationItem[] = []
  for (const page of pages) {
    try {
      const response = await fetch(base + '/knowledge-base/pages/' + encodeURIComponent(page.id), { headers: upstreamRequestHeaders(headers), signal: AbortSignal.timeout(timeout) })
      if (!response.ok) continue
      const doc = (JSON.parse(await upstreamResponseText(response)) as { markdown?: string; content?: string; body?: string })
      const text = doc.markdown ?? doc.content ?? doc.body ?? ''
      if (text.trim() === '') continue
      items.push({ content: clip(text), category: 'context', source: 'hindsight', tags: ['hindsight-page'], migrationKey: 'hindsight:' + hashText(page.name + ':' + text) })
    } catch { /* 单页失败不中断 */ }
  }
  return items
}

/** dsh-mneme 记忆类型 → 内置分类映射（未识别的类型落 general）。 */
const MNEME_CATEGORY: Record<string, NativeMemoryCategory> = {
  preference: 'preference',
  user: 'preference',
  decision: 'decision',
  fact: 'fact',
  project: 'context',
  history: 'context',
}

/**
 * 采集 dsh-mneme 记忆库的活跃条目（只读外部 SQLite，替代 mneme 的数据通道）。
 * - 只搬活跃记忆（archived=0 且 forgotten=0）：mneme 已判定为垃圾的归档条目不搬家；
 * - title + content 拼接为单条内容（native 条目无独立标题字段，标题进正文首行）；
 * - 幂等键 migrationKey = 'mneme:' + 原始 id，重复执行只更新不重复；
 * - 库不存在/损坏返回空数组，绝不抛错（迁移失败不能影响记忆层主链路）。
 */
export function collectMnemeItems(dbPath: string): NativeMemoryMigrationItem[] {
  let rows: Array<{ id: unknown; type: unknown; title: unknown; content: unknown; tags: unknown; importance: unknown }>
  try {
    const db = new DatabaseSync(dbPath, { readOnly: true })
    try {
      rows = db.prepare('SELECT id, type, title, content, tags, importance FROM memories WHERE archived = 0 AND forgotten = 0').all() as typeof rows
    } finally { db.close() }
  } catch { return [] }
  const items: NativeMemoryMigrationItem[] = []
  for (const row of rows) {
    if (typeof row.id !== 'string' || row.id === '') continue
    const title = typeof row.title === 'string' ? row.title.trim() : ''
    const body = typeof row.content === 'string' ? row.content.trim() : ''
    const content = clip(title !== '' && body !== '' ? title + '\n' + body : title + body)
    if (content.length < 6) continue
    let tags: string[] = []
    if (typeof row.tags === 'string' && row.tags.trim() !== '') {
      try {
        const parsed = JSON.parse(row.tags) as unknown
        if (Array.isArray(parsed)) tags = parsed.filter((tag): tag is string => typeof tag === 'string').slice(0, 20)
      } catch { /* 脏 tags 忽略，不影响该条迁移 */ }
    }
    const type = typeof row.type === 'string' ? row.type : ''
    items.push({
      content,
      category: MNEME_CATEGORY[type] ?? 'general',
      ...(tags.length > 0 ? { tags } : {}),
      source: 'mneme',
      importance: typeof row.importance === 'number' ? Math.max(1, Math.min(5, Math.round(row.importance))) : 3,
      migrationKey: 'mneme:' + row.id,
    })
  }
  return items
}
