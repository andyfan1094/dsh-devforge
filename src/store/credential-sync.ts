/**
 * 凭据双向同步：.credentials.yaml 主存 ⇄ store.db credential 镜像表。
 *
 * 【状态机与权威方向（定稿设计）】
 * - 运行时权威是 yaml：官方宿主 ctx.credentials.resolve 读 yaml，credentials-writer.ts
 *   的原子写（+0600+.bak）也只针对 yaml。store.db 的 credential(ref,value,updated_at)
 *   表只是【备份载体镜像】——CNB 加密备份只带 store.db（+飞书 JSON），不带 yaml，
 *   凭据跨机迁移只能走库。
 * - 正向（yaml → 库）：随时可做，库跟随权威。启动对账后半程、定时巡检、备份组装前
 *   刷新（refreshCredentialMirrors）都是正向；值与镜像相同时跳过不写库，保证
 *   updated_at 稳定 → 备份内容 hash 不被无谓扰动。
 * - 反向（库 → yaml）只发生在两个场景，语义必须区分：
 *     1. 启动对账补缺（新机 yaml 缺 ref）：overwrite=false，本机已配置的值绝不覆盖，
 *        只把库里有而 yaml 里没有的 ref 补进 yaml；
 *     2. 恢复备份后（以库为准覆盖式回写）：overwrite=true，刚落盘的新库镜像值覆盖
 *        yaml 同名 ref（换电脑装插件 → 恢复备份 → 凭据无缝衔接）。
 * - 删除不参与常规双向同步：prune 默认 false 永不删库镜像；ref 的删除只由官方 unset
 *   路径联动清理镜像（credentials-routes.ts 已实现，不归本模块管）。
 *
 * 【红线】
 * - 日志只允许出现 ref 名 / 方向 / 数量，绝不记录凭据值；
 * - yaml 写入只经 credentials-writer（原子写 + 0600 + .bak 备份），本模块绝不自行拼
 *   文件内容写 yaml。
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { setCredential } from '../credentials-writer.ts'
import { dshHome } from '../remote/shared/dsh-home.ts'
import {
  getCredentialMirror,
  getDb,
  listCredentialMirrorRefs,
  putCredentialMirror,
  removeCredentialMirror,
} from './db.ts'

/** 默认 yaml 主存路径（与 credentials-writer / snapshot 的解析口径一致：$DSH_HOME 优先）。 */
function defaultYamlPath(): string {
  return join(dshHome(), '.credentials.yaml')
}

/**
 * 解析 yaml refs 段全部 ref → 值（语义与原 snapshot.ts 手写解析一致）：
 * 从顶格/带缩进的 `refs:` 行起，到下一个顶格 key 行止，其间形如 `  ref: value` 的
 * 缩进行为条目；值 trim。文件不存在 / 无 refs 段返回空 Map（含空值条目，由调用方过滤）。
 */
export function readYamlCredentialValues(yamlPath?: string): Map<string, string> {
  const target = yamlPath ?? defaultYamlPath()
  let raw = ''
  try { raw = readFileSync(target, 'utf8') } catch { return new Map() }
  const lines = raw.split('\n')
  const refsLine = lines.findIndex(line => /^\s*refs:\s*$/.test(line))
  if (refsLine === -1) return new Map()
  const values = new Map<string, string>()
  for (let i = refsLine + 1; i < lines.length; i += 1) {
    const line = lines[i]
    if (/^\s*\w[^:]*:\s*$/.test(line)) break // 离开 refs 段
    const match = /^\s+([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/.exec(line)
    if (match === null) continue
    values.set(match[1], match[2].trim())
  }
  return values
}

/** 正向镜像结果（mirrored=本次写入的 ref，pruned=仅 prune=true 时清理的 ref）。 */
export interface CredentialMirrorResult {
  mirrored: string[]
  skipped: number
  pruned: string[]
}

/**
 * 正向同步：yaml refs 段【全量】upsert 进库镜像（不再限 DEVFORGE_CREDENTIAL_REFS 白名单，
 * 白名单常量保留给 migrate.ts 的迁移逻辑）。
 * - 值与镜像相同 → 跳过不写库：保 updated_at 稳定，备份内容 hash 不被扰动；
 * - yaml 空值条目不是有效凭据 → 跳过（与原 refreshCredentialMirrors 语义一致）；
 * - prune 默认 false 永不删除；显式开启时仅清理「镜像有而 yaml 已无」的 ref，
 *   且 yaml 文件不存在时保守跳过（无法区分文件被挪走还是被清空）。
 */
export function mirrorYamlToDb(opts?: { db?: DatabaseSync; yamlPath?: string; prune?: boolean }): CredentialMirrorResult {
  const db = opts?.db ?? getDb()
  const yamlPath = opts?.yamlPath ?? defaultYamlPath()
  const values = readYamlCredentialValues(yamlPath)
  const mirrored: string[] = []
  let skipped = 0
  for (const [ref, value] of values) {
    if (value === '') { skipped += 1; continue }
    if (getCredentialMirror(db, ref) === value) { skipped += 1; continue }
    putCredentialMirror(db, ref, value)
    mirrored.push(ref)
  }
  const pruned: string[] = []
  if (opts?.prune === true && existsSync(yamlPath)) {
    for (const ref of listCredentialMirrorRefs(db)) {
      if (!values.has(ref)) {
        removeCredentialMirror(db, ref)
        pruned.push(ref)
      }
    }
  }
  return { mirrored, skipped, pruned }
}

/** 反向回写结果（restored=本次写入 yaml 的 ref）。 */
export interface CredentialRestoreResult {
  restored: string[]
  skipped: number
}

/**
 * 反向同步：读库全部镜像 ref → 写入 yaml（只经 credentials-writer 原子写）。
 * 场景差异（overwrite 语义）：
 * - yaml 缺该 ref → 写入（新机补缺与恢复场景都需要）；
 * - yaml 已有且值相同 → 跳过（避免无谓 .bak 与 mtime 变化）；
 * - yaml 已有但值不同 → 仅 overwrite=true（恢复场景）才覆盖；默认 false 保留本机
 *   已配置值（启动对账绝不动用户手工设置的凭据）；
 * - 库镜像值为空的历史脏数据 → 跳过不回写。
 */
export async function restoreMirrorsToYaml(opts?: { db?: DatabaseSync; yamlPath?: string; overwrite?: boolean }): Promise<CredentialRestoreResult> {
  const db = opts?.db ?? getDb()
  const yamlPath = opts?.yamlPath ?? defaultYamlPath()
  const overwrite = opts?.overwrite ?? false
  const current = readYamlCredentialValues(yamlPath)
  const restored: string[] = []
  let skipped = 0
  for (const ref of listCredentialMirrorRefs(db)) {
    const value = getCredentialMirror(db, ref)
    if (value === undefined || value === '') { skipped += 1; continue }
    const existing = current.get(ref)
    if (existing === value) { skipped += 1; continue }
    if (existing !== undefined && !overwrite) { skipped += 1; continue }
    await setCredential(ref, value, yamlPath)
    current.set(ref, value) // 同轮后续判定基于最新 yaml 值
    restored.push(ref)
  }
  return { restored, skipped }
}

/** 宿主 logger 的最小形状（避免依赖宿主类型细节；实现必须遵守「不记凭据值」红线）。 */
export interface CredentialSyncLogger {
  info?(message: string, ...args: unknown[]): void
  warn?(message: string, ...args: unknown[]): void
}

/** 启动对账汇总：先反向补缺、再正向跟随（两步结果都给调用方/日志）。 */
export interface CredentialReconcileResult {
  restore: CredentialRestoreResult
  mirror: CredentialMirrorResult
}

/**
 * 凭据双向同步服务：对账、巡检、恢复回写的宿主侧编排。
 * 定时模式与 backup/scheduler.ts、rag/mirror-sync.ts 一致：class 自持
 * setInterval + unref，start(intervalMs) 启动、stop()/dispose() 停止（index.ts
 * 无 ctx.timer 可用，此为项目现行最简一致方案）。
 */
export class CredentialSyncService {
  private timer: ReturnType<typeof setInterval> | undefined
  private readonly log: CredentialSyncLogger
  private readonly yamlPath?: string
  private readonly dbPath?: string

  constructor(deps: { log?: CredentialSyncLogger; yamlPath?: string; dbPath?: string } = {}) {
    this.log = deps.log ?? {}
    this.yamlPath = deps.yamlPath
    this.dbPath = deps.dbPath
  }

  /** 库连接解析：dbPath 注入（测试隔离用）优先，未注入走宿主默认库（getDb 单例）。 */
  private resolveDb(): DatabaseSync {
    return getDb(this.dbPath)
  }

  /**
   * 启动对账（宿主启动时调用一次）：
   * 1) 反向 restoreMirrorsToYaml(overwrite=false)：库里有而 yaml 缺的 ref 补进 yaml
   *    （新机/刚恢复过库的场景），本机已配置值绝不覆盖；
   * 2) 正向 mirrorYamlToDb()：yaml 为运行时权威，全量跟随回镜像（含 yaml 新增 ref）。
   */
  async reconcileOnStartup(): Promise<CredentialReconcileResult> {
    const restore = await restoreMirrorsToYaml({ db: this.resolveDb(), yamlPath: this.yamlPath, overwrite: false })
    const mirror = mirrorYamlToDb({ db: this.resolveDb(), yamlPath: this.yamlPath })
    if (restore.restored.length > 0) {
      this.log.info?.('[dsh-devforge] 启动对账（库→yaml 补缺）：写入 %s 项（%s）', String(restore.restored.length), restore.restored.join('、'))
    }
    if (mirror.mirrored.length > 0) {
      this.log.info?.('[dsh-devforge] 启动对账（yaml→库镜像）：写入 %s 项（%s）', String(mirror.mirrored.length), mirror.mirrored.join('、'))
    }
    return { restore, mirror }
  }

  /** 巡检（供定时调用）：正向 mirrorYamlToDb，yaml 当前值跟随回镜像（不删、不覆盖 yaml）。 */
  patrol(): CredentialMirrorResult {
    const result = mirrorYamlToDb({ db: this.resolveDb(), yamlPath: this.yamlPath })
    if (result.mirrored.length > 0) {
      this.log.info?.('[dsh-devforge] 凭据巡检（yaml→库镜像）：写入 %s 项（%s）', String(result.mirrored.length), result.mirrored.join('、'))
    }
    return result
  }

  /** 恢复备份后调用：反向覆盖式回写（overwrite=true，以库镜像为准覆盖 yaml 同名 ref）。 */
  async restoreAfterBackup(): Promise<CredentialRestoreResult> {
    const result = await restoreMirrorsToYaml({ db: this.resolveDb(), yamlPath: this.yamlPath, overwrite: true })
    if (result.restored.length > 0) {
      this.log.info?.('[dsh-devforge] 备份恢复回写（库→yaml 覆盖式）：写入 %s 项（%s）', String(result.restored.length), result.restored.join('、'))
    }
    return result
  }

  /** 启动定时巡检（默认 15 分钟）；unref 不阻止进程自然退出，随插件 dispose 停止。 */
  start(intervalMs = 15 * 60_000): void {
    this.stop()
    this.timer = setInterval(() => {
      try {
        this.patrol()
      } catch (error) {
        // 定时回调绝不炸宿主进程：失败只记原因（不含凭据值）
        this.log.warn?.('[dsh-devforge] 凭据巡检（yaml→库镜像）异常：%s', error instanceof Error ? error.message : String(error))
      }
    }, intervalMs)
    this.timer.unref?.()
    this.log.info?.('[dsh-devforge] 凭据巡检调度已启动（间隔 %s ms）', String(intervalMs))
  }

  stop(): void {
    if (this.timer !== undefined) { clearInterval(this.timer); this.timer = undefined }
  }

  dispose(): void { this.stop() }
}
