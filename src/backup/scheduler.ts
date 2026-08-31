/**
 * CNB 备份定时调度器（宿主进程生命周期，不依赖浏览器）。
 * - 插件启用时 start()：读配置，enabled 才启动；立即执行一次补跑
 *   （距上次成功推送超过间隔即触发，重启不丢节拍）。
 * - setInterval 按间隔触发 backupNow()；内容无变化时内部自动跳过（只刷新时间戳）。
 * - 同一时刻至多一个备份在跑（防重入）；调度器随插件 dispose 停止。
 */

import { backupNow, intervalToMs, readBackupSettings, readBackupState } from './backup.ts'

/** 宿主 logger 的最小形状（避免依赖宿主类型细节）。 */
interface SchedulerLogger {
  info?(message: string, ...args: unknown[]): void
  warn?(message: string, ...args: unknown[]): void
}

export interface BackupSchedulerOptions {
  log: SchedulerLogger
}

export class BackupScheduler {
  private timer: NodeJS.Timeout | undefined
  private running = false
  private readonly log: SchedulerLogger

  constructor(options: BackupSchedulerOptions) {
    this.log = options.log
  }

  /** 读取当前配置并（重）启动调度；未启用则停止。 */
  restart(): void {
    this.stop()
    const settings = readBackupSettings()
    if (!settings.enabled) return
    const intervalMs = intervalToMs(settings.interval)
    // 启动补跑：距上次成功推送超过间隔（或从未跑过）立即执行一次
    const state = readBackupState()
    const due = state.lastPushAt === undefined || Date.now() - state.lastPushAt >= intervalMs
    if (due) void this.runOnce('启动补跑')
    this.timer = setInterval(() => { void this.runOnce('定时触发') }, intervalMs)
    // unref：不阻止进程自然退出（与宿主生命周期一致）
    this.timer.unref?.()
    this.log.info?.('[dsh-devforge] CNB 备份调度已启动（间隔 %s）', settings.interval)
  }

  /** 手动触发一次（配置保存后可用）。 */
  async runOnce(trigger: string): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      const result = await backupNow()
      if (result.ok && result.skipped !== undefined) {
        this.log.info?.('[dsh-devforge] CNB 备份（%s）：内容无变化，跳过推送', trigger)
      } else if (result.ok) {
        this.log.info?.('[dsh-devforge] CNB 备份（%s）成功：%s 字节', trigger, String(result.size ?? 0))
      } else {
        this.log.warn?.('[dsh-devforge] CNB 备份（%s）失败：%s', trigger, result.error ?? result.skipped ?? '未知')
      }
    } catch (error) {
      this.log.warn?.('[dsh-devforge] CNB 备份（%s）异常：%s', trigger, error instanceof Error ? error.message : String(error))
    } finally {
      this.running = false
    }
  }

  stop(): void {
    if (this.timer !== undefined) {
      clearInterval(this.timer)
      this.timer = undefined
    }
  }

  dispose(): void {
    this.stop()
  }
}
