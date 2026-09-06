/** 受管凭据原子写入（天工造梦内专用，loopback 围栏限制访问）。 */
import { copyFile, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** 凭据存储文件名（位于 $DSH_HOME 根目录）。 */
const CREDENTIALS_FILE = '.credentials.yaml'

/** 受 POSIX shell 标识符约束的 ref 名。 */
const REF_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

/** 当前凭据文件中存在的所有 ref（脱敏：仅返回键）。 */
export async function listCredentialRefs(filePath?: string): Promise<string[]> {
  const raw = await readSafe(filePath)
  return parseRefs(raw).map((entry) => entry.ref)
}

/** 原子 upsert 一个凭据；返回 { created, updated } 表示本次写入的语义。 */
export async function setCredential(ref: string, value: string, filePath?: string): Promise<{ created: boolean; updated: boolean }> {
  if (!REF_PATTERN.test(ref)) throw new Error('凭据引用名格式无效：' + ref)
  if (value === '') throw new Error('凭据值不能为空。')
  const target = resolvePath(filePath)
  const existed = await pathExists(target)
  const raw = existed ? await readFile(target, 'utf8') : ''
  if (existed) {
    const backupPath = target + '.bak.' + formatTimestamp()
    try { await copyFile(target, backupPath) } catch { /* 备份失败不阻塞写入 */ }
  }
  const next = upsertRef(raw, ref, value)
  await writeFile(target, next, { mode: 0o600 })
  return { created: !existed, updated: existed }
}

/** 在 raw 中 upsert 一个 refs 段条目；其他行原样保留。 */
function upsertRef(raw: string, ref: string, value: string): string {
  const lines = raw === '' ? [] : raw.split('\n')
  const refsLine = lines.findIndex((line) => /^\s*refs:\s*$/.test(line))
  if (refsLine === -1) {
    const versionLine = lines.findIndex((line) => /^\s*version:\s*/.test(line))
    const insertAt = versionLine === -1 ? lines.length : versionLine + 1
    const refLine = '  ' + ref + ': ' + value
    const newLines = [...lines.slice(0, insertAt), 'refs:', refLine, ...lines.slice(insertAt)]
    return joinLines(newLines)
  }
  for (let i = refsLine + 1; i < lines.length; i += 1) {
    const line = lines[i]
    if (/^\s*\w[^:]*:\s*$/.test(line)) break
    const match = /^(\s+)([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/.exec(line)
    if (match === null) continue
    const indent = match[1]
    const name = match[2]
    if (name === ref) {
      lines[i] = indent + name + ': ' + value
      return joinLines(lines)
    }
  }
  const refLine = '  ' + ref + ': ' + value
  lines.splice(refsLine + 1, 0, refLine)
  return joinLines(lines)
}

/** 从受管凭据中删除一个 ref（不存在则无操作）；返回 { removed } 表示本次是否真的删了。 */
export async function deleteCredential(ref: string, filePath?: string): Promise<{ removed: boolean }> {
  if (!REF_PATTERN.test(ref)) throw new Error('凭据引用名格式无效：' + ref)
  const target = resolvePath(filePath)
  const raw = await readSafe(filePath)
  if (raw === '') return { removed: false }
  const lines = raw.split('\n')
  const entry = parseRefs(raw).find((item) => item.ref === ref)
  if (entry === undefined) return { removed: false }
  const backupPath = target + '.bak.' + formatTimestamp()
  try { await copyFile(target, backupPath) } catch { /* 备份失败不阻塞删除 */ }
  lines.splice(entry.line, 1)
  await writeFile(target, joinLines(lines), { mode: 0o600 })
  return { removed: true }
}

/** 在 raw 中解析 refs 段。 */
function parseRefs(raw: string): Array<{ ref: string; line: number }> {
  if (raw === '') return []
  const lines = raw.split('\n')
  const refsLine = lines.findIndex((line) => /^\s*refs:\s*$/.test(line))
  if (refsLine === -1) return []
  const result: Array<{ ref: string; line: number }> = []
  for (let i = refsLine + 1; i < lines.length; i += 1) {
    const line = lines[i]
    if (/^\s*\w[^:]*:\s*$/.test(line)) break
    const match = /^\s+([A-Za-z_][A-Za-z0-9_]*):\s*/.exec(line)
    if (match !== null) result.push({ ref: match[1], line: i })
  }
  return result
}

/** 读取文件；不存在返回空串。 */
async function readSafe(filePath: string | undefined): Promise<string> {
  const target = resolvePath(filePath)
  try {
    return await readFile(target, 'utf8')
  } catch {
    return ''
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  try { await readFile(filePath, 'utf8'); return true } catch { return false }
}

function resolvePath(filePath: string | undefined): string {
  if (filePath !== undefined) return filePath
  const home = process.env.DSH_HOME
  return join(home ?? join(homedir(), '.dsh'), CREDENTIALS_FILE)
}

function joinLines(lines: string[]): string {
  return lines.join('\n')
}

function formatTimestamp(): string {
  const now = new Date()
  const pad = (value: number): string => String(value).padStart(2, '0')
  return now.getFullYear().toString() + pad(now.getMonth() + 1) + pad(now.getDate()) + '-' + pad(now.getHours()) + pad(now.getMinutes()) + pad(now.getSeconds())
}
