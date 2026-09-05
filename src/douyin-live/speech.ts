import { spawn } from 'node:child_process'

const SAME_NICKNAME_COOLDOWN_MS = 60_000
const GLOBAL_COOLDOWN_MS = 3_000

/** 语音执行边界；测试可注入内存函数，生产使用 macOS 本地 say。 */
export type SpeechRunner = (text: string) => void

/** 清理昵称中的控制字符和过长内容，避免把原始外部文本直接交给语音命令。 */
function cleanNickname(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/gu, ' ').replace(/\s+/gu, ' ').trim().slice(0, 40)
}

/** 使用系统语音，不上传昵称、不依赖云端凭据。 */
function runMacSay(text: string): void {
  if (process.platform !== 'darwin') return
  const child = spawn('say', [text], { stdio: 'ignore' })
  child.on('error', () => { /* 系统没有 say 或音频不可用时，文字消息仍正常显示。 */ })
  child.unref()
}

/** 入场欢迎播报限频器：同名 60 秒去重，全局播报至少间隔 3 秒。 */
export class WelcomeSpeechService {
  private readonly run: SpeechRunner
  private readonly now: () => number
  private readonly recentNames = new Map<string, number>()
  private lastSpokenAt = Number.NEGATIVE_INFINITY

  /** @param run 语音执行函数；生产默认调用 macOS say。 */
  constructor(run: SpeechRunner = runMacSay, now: () => number = Date.now) {
    this.run = run
    this.now = now
  }

  /** 尝试播报一次；返回 false 表示昵称去重或全局限频被拦截。 */
  announce(nickname: string, at = this.now()): boolean {
    const name = cleanNickname(nickname)
    if (name === '') return false
    const previous = this.recentNames.get(name)
    if (previous !== undefined && at - previous < SAME_NICKNAME_COOLDOWN_MS) return false
    if (at - this.lastSpokenAt < GLOBAL_COOLDOWN_MS) return false
    this.recentNames.set(name, at)
    this.lastSpokenAt = at
    this.run('欢迎' + name + '进入我的直播间')
    this.prune(at)
    return true
  }

  /** 清理过期昵称记录，避免长时间直播时集合无限增长。 */
  private prune(at: number): void {
    for (const [name, timestamp] of this.recentNames) {
      if (at - timestamp >= SAME_NICKNAME_COOLDOWN_MS) this.recentNames.delete(name)
    }
  }

  /** 卸载时释放内存状态；已启动的系统 say 进程交由系统自然结束。 */
  dispose(): void { this.recentNames.clear() }
}
