/**
 * 重启 DSH 共享流程 —— 从操作台头部按钮抽出，供侧边栏「重启」入口等复用。
 *
 * 关键边界：重启采用「旧 Host 退出、独立进程拉起新 Host」的两段式流程；
 * 收到 scheduled 响应后旧 API 会随 Host 退出而失败，必须轮询新 Host 恢复后
 * 再刷新页面，不能响应一回来就 reload（那只会重连到垂死的旧 Host）。
 */
import type { DevforgeApi } from '../api.ts'

/** 等待新 Host 恢复的最大轮询次数（500ms 间隔，共约 10 秒）。 */
const HOST_WAIT_ATTEMPTS = 20
/** 发起重启后的缓冲延迟：避开旧 Host 尚未退出时的最后几次响应。 */
const RESTART_GRACE_MS = 750
/** 轮询间隔。 */
const POLL_INTERVAL_MS = 500

/**
 * 发起重启并等待新 Host 恢复；成功路径以整页刷新收尾（不返回）。
 * @param api 天工造梦 HTTP API。
 * @param onError 失败回调：请求失败或超时未恢复时触发，由调用方呈现错误。
 */
export async function restartDshAndWait(api: DevforgeApi, onError: (message: string) => void): Promise<void> {
  try {
    await api.restartDsh()
  } catch (e) {
    onError(e instanceof Error ? e.message : String(e))
    return
  }
  // 旧 Host 先退出，独立进程随后启动新 Host；延迟避免轮询仍命中旧服务。
  window.setTimeout(() => { void waitForHost(api, HOST_WAIT_ATTEMPTS, onError) }, RESTART_GRACE_MS)
}

/**
 * 轮询新 Host：任一真实 API 调用成功即认为恢复完成，刷新页面交还控制权。
 * 次数耗尽仍失败则回调错误，由调用方提示用户手动刷新。
 */
async function waitForHost(api: DevforgeApi, attemptsLeft: number, onError: (message: string) => void): Promise<void> {
  try {
    await api.listStandards()
    window.location.reload()
  } catch {
    if (attemptsLeft === 0) {
      onError('DSH 未在预期时间内恢复，请稍后手动刷新页面。')
      return
    }
    window.setTimeout(() => { void waitForHost(api, attemptsLeft - 1, onError) }, POLL_INTERVAL_MS)
  }
}
