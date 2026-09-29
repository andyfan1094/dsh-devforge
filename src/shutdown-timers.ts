/**
 * 停机安全的可取消定时器 —— 供「可能跨进程停机时仍在等待」的重试/轮询逻辑使用。
 *
 * 背景（0.41.14）：
 * DSH 桌面端在安装更新前，要求 Host 进程在收到 shutdown 后 10 秒内真正退出，否则强杀并拒绝安装
 * 更新（用户可见报错：「未能安全停止任务，更新未安装」）。而内核停机控制器
 * （@deepseek-ai/dsh/lib/profile-boot 的 createProcessShutdown）在正常路径下**只设置 process.exitCode**，
 * 并不调用 process.exit()；进程能否退出完全取决于事件循环能否自然排空。
 *
 * 因此任何「停机瞬间仍在等待」的 ref 定时器都会直接拖住进程退出：本插件启动时自动补齐模型清单，
 * 失败会以 5 秒间隔重试（最多 3 轮），一旦在停机时正卡在等待里，就会把退出时间硬拖到 10 秒量级，
 * 正好越过桌面端窗口。修复方式有两条，缺一不可：
 *   1) 定时器一律 unref —— 即使仍在等待，也不再阻止进程退出（宿主的 dispose 语义已经生效）；
 *   2) 定时器可取消 —— 插件卸载/停机时主动清掉，避免退出后仍有异步动作落到已销毁的宿主上。
 *
 * 实测（本机 Windows / Node 24）：未 unref 的 12 秒等待会把进程存活时间拉到 12.0 秒；unref 后
 * 无论等待多长，进程都在 ~30 毫秒内退出。
 */

/** 等待被主动取消（插件卸载/停机）时抛出的错误，便于调用方与「超时」区分。 */
export class CanceledWaitError extends Error {
  constructor() {
    super('等待已被取消（插件卸载或停机）')
    this.name = 'CanceledWaitError'
  }
}

/** 一个不阻止进程退出的可取消等待。 */
export interface CancelableWait {
  /** 等待到期时兑现；被取消时以 CanceledWaitError 拒绝。 */
  readonly done: Promise<void>
  /** 取消等待：清理定时器并拒绝 done。重复调用安全 */
  cancel: () => void
  /** 是否已到期或已被取消。 */
  settled: () => boolean
}

/** 定时器归属域：插件卸载时用 cancelAll() 一次性收尾所有未完成的等待。 */
export interface TimerScope {
  /** 创建一个「不阻止进程退出」的可取消等待。 */
  wait: (ms: number) => CancelableWait
  /** 取消本域内全部未完成的等待；返回被取消的数量。 */
  cancelAll: () => number
}

/** 创建定时器域；域内定时器一律 unref，并可被 cancelAll() 批量收尾。 */
export function createTimerScope(): TimerScope {
  const pending = new Set<() => void>()

  const wait = (ms: number): CancelableWait => {
    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let cancel = (): void => {}
    const done = new Promise<void>((resolve, reject) => {
      cancel = () => {
        if (settled) return
        settled = true
        if (timer !== undefined) clearTimeout(timer)
        pending.delete(cancel)
        reject(new CanceledWaitError())
      }
      timer = setTimeout(() => {
        if (settled) return
        settled = true
        pending.delete(cancel)
        resolve()
      }, Math.max(0, ms))
      // 关键修复：等待不得阻止进程退出（DSH 桌面端停机窗口 10 秒）。
      timer.unref?.()
    })
    // 取消路径的拒绝由调用方在处理；这里吞掉「无人 await 就取消」的未处理拒绝。
    done.catch(() => {})
    pending.add(cancel)
    return { done, cancel, settled: () => settled }
  }

  return {
    wait,
    cancelAll: () => {
      const cancels = [...pending]
      for (const cancel of cancels) cancel()
      return cancels.length
    },
  }
}
