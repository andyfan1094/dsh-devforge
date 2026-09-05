import { spawn } from 'node:child_process'

const SAME_NICKNAME_COOLDOWN_MS = 60_000
const GLOBAL_COOLDOWN_MS = 3_000

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
   * 尝试播报点赞感谢语；与进场共用昵称和全局限频，点赞连发时不会刷屏。
   * 只有真正播报成功才消耗下一条祝福模板。
   */
  announceLike(nickname: string, at = this.now()): boolean {
    const blessing = LIKE_BLESSINGS[this.likeBlessingIndex]!
    const spoken = this.announceText(nickname, at, name => '感谢' + name + '点赞，' + blessing)
    if (spoken) this.likeBlessingIndex = (this.likeBlessingIndex + 1) % LIKE_BLESSINGS.length
    return spoken
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
  dispose(): void { this.recentNames.clear() }
}
