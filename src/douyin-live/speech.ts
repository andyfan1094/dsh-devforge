import { spawn } from 'node:child_process'

const SAME_NICKNAME_COOLDOWN_MS = 60_000
const GLOBAL_COOLDOWN_MS = 3_000
const LIKE_QUEUE_LIMIT = 500

/** 点赞感谢语轮换模板；轮换可预测，便于测试，也避免连续重复同一句。 */
const LIKE_BLESSINGS = [
  '祝你东财西财八方来财，财源广进',
  '祝你日进斗金，财源滚滚，好运连连',
  '祝你东成西就，南来北往贵人相助',
  '祝你福气满满，喜事连连，心想事成',
  '祝你左手收红包，右手接好运，天天开心',
  '祝你事业蒸蒸日上，生活红红火火',
] as const

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
  private likeBlessingIndex = 0
  private pendingLikes: string[] = []
  private readonly pendingLikeNames = new Set<string>()
  private likeTimer?: ReturnType<typeof setTimeout>

  /** @param run 语音执行函数；生产默认调用 macOS say。 */
  constructor(run: SpeechRunner = runMacSay, now: () => number = Date.now) {
    this.run = run
    this.now = now
  }

  /** 尝试播报进场欢迎语；返回 false 表示昵称去重或全局限频被拦截。 */
  announce(nickname: string, at = this.now()): boolean {
    return this.announceText(nickname, at, name => '欢迎' + name + '进入我的直播间')
  }

  /**
   * 尝试播报点赞感谢语；同名 60 秒仍去重，但全局冷却期间的不同昵称会进入 FIFO 队列。
   * 队列有界，避免高峰期无限占用内存；返回 true 表示已播报或已成功排队。
   */
  announceLike(nickname: string, at = this.now()): boolean {
    const name = cleanNickname(nickname)
    if (name === '') return false
    this.flushQueuedLikes(at)
    if (this.pendingLikeNames.has(name)) return false
    const previous = this.recentNames.get(name)
    if (previous !== undefined && at - previous < SAME_NICKNAME_COOLDOWN_MS) return false
    if (this.pendingLikes.length >= LIKE_QUEUE_LIMIT) return false
    if (this.pendingLikes.length > 0 || at - this.lastSpokenAt < GLOBAL_COOLDOWN_MS) {
      this.recentNames.set(name, at)
      this.pendingLikes.push(name)
      this.pendingLikeNames.add(name)
      this.scheduleLikeDrain()
      return true
    }
    this.speakLike(name, at)
    return true
  }

  /** 取消尚未播报的点赞语音；关闭播报或切换直播间时使用。 */
  clearPendingLikes(): void {
    this.clearLikeTimer()
    this.pendingLikes = []
    this.pendingLikeNames.clear()
  }

  /** 立即执行一条已通过昵称和时间窗口校验的点赞语音。 */
  private speakLike(name: string, at: number): void {
    const blessing = LIKE_BLESSINGS[this.likeBlessingIndex]!
    this.recentNames.set(name, at)
    this.lastSpokenAt = at
    this.run('感谢' + name + '点赞，' + blessing)
    this.likeBlessingIndex = (this.likeBlessingIndex + 1) % LIKE_BLESSINGS.length
    this.prune(at)
  }

  /** 按全局间隔释放队首点赞；每次只释放一条，保证语音间隔稳定。 */
  private flushQueuedLikes(at = this.now()): void {
    if (this.pendingLikes.length === 0) return
    const wait = GLOBAL_COOLDOWN_MS - (at - this.lastSpokenAt)
    if (wait > 0) {
      this.scheduleLikeDrain()
      return
    }
    this.clearLikeTimer()
    const name = this.pendingLikes.shift()!
    this.pendingLikeNames.delete(name)
    this.speakLike(name, at)
    if (this.pendingLikes.length > 0) this.scheduleLikeDrain()
  }

  /** 为队首点赞安排下一次释放，不让队列定时器阻止 Host 正常退出。 */
  private scheduleLikeDrain(): void {
    if (this.likeTimer !== undefined || this.pendingLikes.length === 0) return
    const wait = Math.max(0, GLOBAL_COOLDOWN_MS - (this.now() - this.lastSpokenAt))
    this.likeTimer = setTimeout(() => {
      this.likeTimer = undefined
      this.flushQueuedLikes()
    }, wait)
    this.likeTimer.unref()
  }

  /** 清理已安排的点赞释放任务，切换直播或卸载时不再触发语音。 */
  private clearLikeTimer(): void {
    if (this.likeTimer !== undefined) clearTimeout(this.likeTimer)
    this.likeTimer = undefined
  }

  /** 统一执行昵称清洗、去重、全局限频和本地系统语音。 */
  private announceText(nickname: string, at: number, buildText: (name: string) => string): boolean {
    const name = cleanNickname(nickname)
    if (name === '') return false
    const previous = this.recentNames.get(name)
    if (previous !== undefined && at - previous < SAME_NICKNAME_COOLDOWN_MS) return false
    if (at - this.lastSpokenAt < GLOBAL_COOLDOWN_MS) return false
    this.recentNames.set(name, at)
    this.lastSpokenAt = at
    this.run(buildText(name))
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
  dispose(): void {
    this.clearPendingLikes()
    this.recentNames.clear()
  }
}
