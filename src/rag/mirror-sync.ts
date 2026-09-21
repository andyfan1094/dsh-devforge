/**
 * Mnemon / Hindsight 镜像自动同步调度器（宿主进程生命周期，不依赖浏览器）。
 *
 * 背景（2026-09-18 记忆中枢半瘫诊断）：
 * 旧实现只有手动 POST /rag/mirror/sync 一个入口，镜像自首次同步后永久停滞
 * （生产实况：Mnemon 侧 40 篇，镜像库只有 12 篇，停在 2026-09-02）。
 * 本调度器按固定间隔自动增量同步，让镜像不再脱节。
 *
 * 设计：
 * - 启动延迟执行一次（等宿主与凭据就绪，避免与启动高峰抢资源）；
 * - 之后 setInterval 周期执行；同一时刻至多一个同步在跑（防重入）；
 * - 源目录不存在时直接跳过，不产生空扫描（配合 mirror.ts 的空扫描保护双保险）；
 * - 增量语义由 mirrorIngest 保证：同内容零嵌入调用，只处理变化项；
 * - 失败只记日志不抛出，绝不影响宿主其他能力；随插件 dispose 停止。
 */
import { existsSync } from 'node:fs'
import { mnemonDataRoot, readHindsightConfig, syncHindsightMirror, syncMnemonMirror, type MirrorReport } from './mirror.ts'
import type { RagService } from './service.ts'

/** 宿主 logger 的最小形状（避免依赖宿主类型细节）。 */
interface MirrorLogger {
  info?(message: string, ...args: unknown[]): void
  warn?(message: string, ...args: unknown[]): void
}

export interface MirrorSyncSettings {
  /** 总开关：关闭后不自动同步（手动接口仍可用）。 */
  enabled: boolean
  /** 同步间隔（分钟）；下限 5 分钟防抖。 */
  intervalMinutes: number
}

/**
 * 默认关闭（2026-09-21 Mnemon 退役决策）：
 * dsh-mnemon 插件已卸载，~/.mnemon 自 2026-09-04 起零写入（死水），
 * 39/40 篇内容已迁入 memory.entry，镜像库已定格为静态历史档案。
 * 每小时同步一个不再更新的目录没有意义；如未来重新接入外部记忆源，
 * 可经 PUT /api/dsh-devforge/rag/settings 打开 mirrorSync.enabled。
 */
export const DEFAULT_MIRROR_SYNC_SETTINGS: MirrorSyncSettings = {
  enabled: false,
  intervalMinutes: 60,
}

/** 规整配置：缺省字段回退默认值，间隔做下限保护。 */
export function normalizeMirrorSyncSettings(raw: unknown): MirrorSyncSettings {
  const value = (raw ?? {}) as Partial<MirrorSyncSettings>
  const minutes = typeof value.intervalMinutes === 'number' && Number.isFinite(value.intervalMinutes)
    ? Math.max(5, Math.min(24 * 60, Math.floor(value.intervalMinutes)))
    : DEFAULT_MIRROR_SYNC_SETTINGS.intervalMinutes
  // enabled 缺省跟随默认值（默认关闭）：不能用「!== false」写成缺省即启用，
  // 否则退役默认值会被规整逻辑悄悄推翻。
  return {
    enabled: typeof value.enabled === 'boolean' ? value.enabled : DEFAULT_MIRROR_SYNC_SETTINGS.enabled,
    intervalMinutes: minutes,
  }
}

/** 最近一次同步结果（面板/日志可观测）。 */
export interface MirrorSyncRun {
  at: number
  trigger: string
  mnemon?: MirrorReport
  hindsight?: MirrorReport
  error?: string
}

/** 镜像自动同步调度器。 */
export class MirrorSyncScheduler {
  private timer: ReturnType<typeof setInterval> | undefined
  private startupTimer: ReturnType<typeof setTimeout> | undefined
  private running = false
  lastRun: MirrorSyncRun | undefined

  private readonly rag: RagService
  private readonly config: () => MirrorSyncSettings
  private readonly log: MirrorLogger
  /** 启动首次同步延迟（等宿主就绪；测试可传 0）。 */
  private readonly startupDelayMs: number

  constructor(deps: {
    rag: RagService
    config: () => MirrorSyncSettings
    log?: MirrorLogger
    startupDelayMs?: number
  }) {
    this.rag = deps.rag
    this.config = deps.config
    this.log = deps.log ?? {}
    this.startupDelayMs = deps.startupDelayMs ?? 30_000
  }

  /** 启动调度：读配置，启用才启动；先延迟补跑一次，再周期执行。 */
  start(): void {
    this.stop()
    const settings = this.config()
    if (!settings.enabled) return
    this.startupTimer = setTimeout(() => {
      this.startupTimer = undefined
      void this.runOnce('启动补跑')
    }, this.startupDelayMs)
    this.startupTimer.unref?.()
    const intervalMs = settings.intervalMinutes * 60_000
    this.timer = setInterval(() => { void this.runOnce('定时触发') }, intervalMs)
    this.timer.unref?.()
    this.log.info?.('[dsh-devforge] 镜像自动同步已启动（间隔 %s 分钟）', String(settings.intervalMinutes))
  }

  /** 停止调度（在途同步自然跑完，不硬中断）。 */
  stop(): void {
    if (this.startupTimer !== undefined) { clearTimeout(this.startupTimer); this.startupTimer = undefined }
    if (this.timer !== undefined) { clearInterval(this.timer); this.timer = undefined }
  }

  dispose(): void { this.stop() }

  /**
   * 执行一次同步：Mnemon 与 Hindsight 各自独立，一个失败不影响另一个。
   * 源侧不存在（目录缺失 / Hindsight 未配置）时跳过，不产生空扫描。
   */
  async runOnce(trigger: string): Promise<MirrorSyncRun> {
    if (this.running) return this.lastRun ?? { at: Date.now(), trigger, error: '已有同步在途' }
    this.running = true
    const run: MirrorSyncRun = { at: Date.now(), trigger }
    try {
      // Mnemon：源目录必须存在才同步（空目录 ≠ 源缺失，空目录交给 mirror.ts 空扫描保护兜底）。
      const root = mnemonDataRoot()
      if (existsSync(root)) {
        try {
          const kbId = this.ensureKb('Mnemon 镜像', '只读镜像：Mnemon Documents 与热记忆')
          run.mnemon = await syncMnemonMirror(this.rag, kbId)
          this.logResult('Mnemon', run.mnemon)
        } catch (error) {
          run.mnemon = { source: 'mnemon', scanned: 0, added: 0, updated: 0, removed: 0, skipped: 0, errors: [(error instanceof Error ? error.message : String(error)).slice(0, 160)] }
          this.log.warn?.('[dsh-devforge] Mnemon 镜像同步失败：%s', run.mnemon.errors[0] ?? '未知')
        }
      } else {
        this.log.info?.('[dsh-devforge] Mnemon 数据根不存在，跳过镜像同步：%s', root)
      }

      // Hindsight：未配置时跳过（readHindsightConfig 返回 undefined）。
      if (readHindsightConfig() !== undefined) {
        try {
          const kbId = this.ensureKb('Hindsight 镜像', '只读镜像：Hindsight 知识页')
          run.hindsight = await syncHindsightMirror(this.rag, kbId)
          this.logResult('Hindsight', run.hindsight)
        } catch (error) {
          run.hindsight = { source: 'hindsight', scanned: 0, added: 0, updated: 0, removed: 0, skipped: 0, errors: [(error instanceof Error ? error.message : String(error)).slice(0, 160)] }
          this.log.warn?.('[dsh-devforge] Hindsight 镜像同步失败：%s', run.hindsight.errors[0] ?? '未知')
        }
      }
    } catch (error) {
      run.error = (error instanceof Error ? error.message : String(error)).slice(0, 200)
      this.log.warn?.('[dsh-devforge] 镜像自动同步异常：%s', run.error)
    } finally {
      this.running = false
      this.lastRun = run
    }
    return run
  }

  /** 按名取库，不存在则建（与手动接口 ensureKb 同语义）。 */
  private ensureKb(name: string, description: string): string {
    const existing = this.rag.listKbs().find((kb) => kb.name === name)
    if (existing !== undefined) return existing.id
    return this.rag.createKb(name, { source: 'mirror', description }).id
  }

  private logResult(label: string, report: MirrorReport): void {
    if (report.errors.length > 0) {
      this.log.warn?.('[dsh-devforge] %s 镜像同步有错误：%s', label, report.errors.slice(0, 3).join('；'))
      return
    }
    if (report.added + report.updated + report.removed === 0) return
    this.log.info?.(
      '[dsh-devforge] %s 镜像同步完成：新增 %s，更新 %s，删除 %s，跳过 %s',
      label, String(report.added), String(report.updated), String(report.removed), String(report.skipped),
    )
  }
}
