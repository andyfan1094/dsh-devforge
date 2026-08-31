/**
 * CNB 备份路由族：状态/配置/立即备份/远端清单/恢复。
 * 安全边界：loopback 围栏 + 同源校验（写操作）；密码与密文绝不回显。
 */
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { isLoopbackRequest } from '../loopback.ts'
import { DEVFORGE_API } from '../protocol.ts'
import {
  backupNow,
  clearBackupPassword,
  fetchAndDecryptLatest,
  listRemoteBackups,
  readBackupPassword,
  readBackupSettings,
  readBackupState,
  restoreFromContainer,
  writeBackupPassword,
  writeBackupSettings,
} from './backup.ts'
import { BackupCryptoError } from './crypto.ts'
import { CnbStore } from '../cnb/store.ts'
import { CnbApi } from '../cnb/cnb-api.ts'

function writeJson(res: import('node:http').ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'content-length': Buffer.byteLength(body) })
  res.end(body)
}

function guardRead(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse): boolean {
  if (isLoopbackRequest(req)) return true
  writeJson(res, 403, { ok: false, error: 'forbidden: loopback-only' })
  return false
}

/** 写操作额外要求同源（与 credentials-routes 一致）。 */
function guardWrite(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse): boolean {
  if (!guardRead(req, res)) return false
  const host = req.headers.host
  const source = typeof req.headers.origin === 'string' ? req.headers.origin : req.headers.referer
  if (host === undefined || typeof source !== 'string') {
    writeJson(res, 403, { ok: false, error: 'forbidden: same-origin request required' })
    return false
  }
  try {
    if (new URL(source).host === host) return true
  } catch { /* 非法来源按拒绝处理 */ }
  writeJson(res, 403, { ok: false, error: 'forbidden: same-origin request required' })
  return false
}

async function readJsonBody(req: import('node:http').IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    total += (chunk as Buffer).length
    if (total > 128 * 1024) throw new Error('请求体超过 128 KiB 上限。')
    chunks.push(chunk as Buffer)
  }
  if (chunks.length === 0) throw new Error('请求体为空。')
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if (typeof parsed !== 'object' || parsed === null) throw new Error('请求体必须是 JSON 对象。')
  return parsed as Record<string, unknown>
}

/** 校验备份仓库存在且私密（启用前置条件）。 */
async function verifyPrivateRepo(accountAlias: string, repo: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const store = new CnbStore()
    const api = new CnbApi(store)
    const info = await api.request<{ visibility_level?: string }>(store.findAccount(accountAlias), '/' + repo)
    if (info.visibility_level !== undefined && info.visibility_level !== 'Private') {
      return { ok: false, error: '备份仓库必须是【私密】仓库（当前 ' + info.visibility_level + '）。请在 cnb.cool 仓库设置中改为私密。' }
    }
    return { ok: true }
  } catch (error) {
    return { ok: false, error: '备份仓库校验失败：' + (error instanceof Error ? error.message : String(error)) }
  }
}

export function makeBackupRoutes(): WebRoute[] {
  return [
    {
      kind: 'exact',
      path: DEVFORGE_API.backupStatus,
      handler: async (req, res) => {
        if (!guardRead(req, res)) return
        if (req.method !== 'GET') { writeJson(res, 405, { ok: false, error: 'GET only' }); return }
        const settings = readBackupSettings()
        const state = readBackupState()
        const accounts = new CnbStore().listAccounts().map(account => account.alias)
        writeJson(res, 200, {
          ok: true,
          settings,
          state: { ...state, lastContentHash: undefined },
          passwordSet: readBackupPassword() !== undefined,
          accounts,
        })
      },
    },
    {
      kind: 'exact',
      path: DEVFORGE_API.backupConfig,
      handler: async (req, res) => {
        if (!guardWrite(req, res)) return
        if (req.method !== 'POST') { writeJson(res, 405, { ok: false, error: 'POST only' }); return }
        try {
          const body = await readJsonBody(req)
          const patch: Record<string, unknown> = {}
          if (typeof body['accountAlias'] === 'string') patch['accountAlias'] = body['accountAlias'].trim()
          if (typeof body['repo'] === 'string') patch['repo'] = body['repo'].trim().replace(/^https:\/\/cnb\.cool\//, '').replace(/\.git$/, '')
          if (typeof body['interval'] === 'string' && ['15m', '1h', '6h', '24h'].includes(body['interval'])) patch['interval'] = body['interval']
          if (typeof body['password'] === 'string' && body['password'] !== '') writeBackupPassword(body['password'])
          if (body['clearPassword'] === true) clearBackupPassword()
          const next = writeBackupSettings(patch)
          if (next.enabled) {
            if (readBackupPassword() === undefined) {
              writeBackupSettings({ enabled: false })
              writeJson(res, 400, { ok: false, error: '启用前请先设置 6 位备份密码。' }); return
            }
            const verify = await verifyPrivateRepo(next.accountAlias, next.repo)
            if (!verify.ok) {
              writeBackupSettings({ enabled: false })
              writeJson(res, 400, { ok: false, error: verify.error }); return
            }
          }
          writeJson(res, 200, { ok: true, settings: writeBackupSettings({}) })
        } catch (error) {
          writeJson(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
    {
      kind: 'exact',
      path: DEVFORGE_API.backupNow,
      handler: async (req, res) => {
        if (!guardWrite(req, res)) return
        if (req.method !== 'POST') { writeJson(res, 405, { ok: false, error: 'POST only' }); return }
        try {
          const body = await readJsonBody(req).catch(() => ({}) as Record<string, unknown>)
          const result = await backupNow({ force: body['force'] === true })
          writeJson(res, result.ok ? 200 : 400, { ...result })
        } catch (error) {
          writeJson(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
    {
      kind: 'exact',
      path: DEVFORGE_API.backupList,
      handler: async (req, res) => {
        if (!guardRead(req, res)) return
        if (req.method !== 'GET') { writeJson(res, 405, { ok: false, error: 'GET only' }); return }
        try {
          writeJson(res, 200, { ok: true, backups: await listRemoteBackups() })
        } catch (error) {
          writeJson(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
    {
      kind: 'exact',
      path: DEVFORGE_API.backupRestore,
      handler: async (req, res) => {
        if (!guardWrite(req, res)) return
        if (req.method !== 'POST') { writeJson(res, 405, { ok: false, error: 'POST only' }); return }
        try {
          const body = await readJsonBody(req)
          const dryRun = body['dryRun'] === true
          const password = typeof body['password'] === 'string' && body['password'] !== ''
            ? body['password']
            : readBackupPassword()
          if (password === undefined) { writeJson(res, 400, { ok: false, error: '请输入 6 位备份密码。' }); return }
          const container = await fetchAndDecryptLatest(password)
          if (dryRun) {
            writeJson(res, 200, {
              ok: true,
              dryRun: true,
              machine: container.machine,
              createdAt: container.created_at,
              files: Object.keys(container.files),
            })
            return
          }
          if (body['confirm'] !== '确认恢复') {
            writeJson(res, 400, { ok: false, error: '恢复会覆盖本机数据，confirm 字段必须为「确认恢复」。' }); return
          }
          const result = await restoreFromContainer(container)
          writeJson(res, 200, { ok: true, ...result, machine: container.machine, createdAt: container.created_at, restartRequired: true })
        } catch (error) {
          if (error instanceof BackupCryptoError) {
            writeJson(res, 400, { ok: false, error: error.message, code: error.code })
            return
          }
          writeJson(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
  ]
}
