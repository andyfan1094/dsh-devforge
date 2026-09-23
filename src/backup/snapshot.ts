/**
 * 备份快照组装：
 * - store.db 热快照用 `VACUUM INTO`（node:sqlite 无 backup API）：由 SQLite 保证
 *   一致性（含 WAL 内容合并进快照文件），绝不能直接拷贝 db 文件（WAL 下会拿到旧数据）。
 * - 附带 dsh-feishu.json（vendored 飞书桥刻意零迁移设计，仍以 JSON 文件为主存）。
 * - 容器为明文 JSON（各文件 base64）→ 由 backup/crypto.ts 整体加密。
 * - 组装时顺带把凭据镜像刷新进库（yaml 主存 refs 段【全量】入镜像，见
 *   store/credential-sync.ts），保证备份携带完整凭据集。
 */

import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { hostname } from 'node:os'
import { createHash } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { defaultDbPath, getDb } from '../store/db.ts'
import { mirrorYamlToDb } from '../store/credential-sync.ts'
import { dshHome } from '../remote/shared/dsh-home.ts'

/** 备份容器内的文件清单键。 */
export interface BackupContainer {
  magic: 'DFB1-JSON'
  created_at: number
  machine: string
  files: Record<string, string>
}

/** 飞书配置文件路径（vendored 桥主存；缺失则跳过该项）。 */
export function feishuStorePath(): string {
  return join(dshHome(), 'dsh-feishu.json')
}

/** 备份前刷新凭据镜像（yaml 主存 refs 段【全量】→ 库 credential 表，见 store/credential-sync.ts）。 */
export function refreshCredentialMirrors(db: DatabaseSync): void {
  // 全量镜像（原 DEVFORGE_CREDENTIAL_REFS 白名单限制移除，白名单常量保留给 migrate.ts）：
  // yaml refs 段所有 ref 都进镜像，备份容器才能携带完整凭据集；
  // 同值跳过不写库，updated_at 稳定 → 备份内容 hash 不被无谓扰动。
  mirrorYamlToDb({ db })
}

/** 生成 store.db 一致性快照，返回快照文件字节（临时文件即用即删）。 */
export function snapshotStoreDb(): Buffer {
  const source = getDb() // 确保库已初始化（WAL 连接）
  const snapshotPath = defaultDbPath() + '.snapshot.tmp'
  try {
    rmSync(snapshotPath, { force: true })
    source.exec(`VACUUM INTO '${snapshotPath.replace(/'/g, "''")}'`)
    return readFileSync(snapshotPath)
  } finally {
    rmSync(snapshotPath, { force: true })
  }
}

/** 组装备份容器（明文 JSON 字节；调用方交给 crypto.ts 加密）。 */
export function buildBackupContainer(): { plaintext: Buffer; fileCount: number; contentHash: string } {
  const db = getDb()
  refreshCredentialMirrors(db)
  const files: Record<string, string> = {
    'store.db': snapshotStoreDb().toString('base64'),
  }
  if (existsSync(feishuStorePath())) {
    files['dsh-feishu.json'] = readFileSync(feishuStorePath()).toString('base64')
  }
  const container: BackupContainer = {
    magic: 'DFB1-JSON',
    created_at: Date.now(),
    machine: hostname(),
    files,
  }
  // 内容 hash 基于文件载荷本身（排除 created_at 时间戳），供「内容无变化跳过」判断；
  // 快照为 VACUUM INTO 确定性输出，库数据不变 → hash 不变。
  const contentHash = createHash('sha256').update(JSON.stringify(container.files)).digest('hex')
  return { plaintext: Buffer.from(JSON.stringify(container), 'utf8'), fileCount: Object.keys(files).length, contentHash }
}

/** 解析备份容器（解密后的明文 JSON）。 */
export function parseBackupContainer(plaintext: Uint8Array): BackupContainer {
  const parsed = JSON.parse(Buffer.from(plaintext).toString('utf8')) as BackupContainer
  if (parsed?.magic !== 'DFB1-JSON' || typeof parsed.files !== 'object' || parsed.files === null) {
    throw new Error('备份容器内容非法（magic 或 files 缺失）。')
  }
  return parsed
}
