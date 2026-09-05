import { getDb, getSettings, putSettings } from '../store/db.ts'
import type { DouyinLiveConfig } from './protocol.ts'

/** 直播配置单独存域，消息和连接意图均不落盘。 */
export const douyinLiveStore = {
  /** 读取房间输入；不加载任何连接状态。 */
  read(): DouyinLiveConfig {
    const stored = getSettings<DouyinLiveConfig>(getDb(), 'douyin-live.settings')
    return {
      roomInput: typeof stored?.roomInput === 'string' ? stored.roomInput.slice(0, 2048) : '',
      autoMonitor: stored?.autoMonitor === true,
      welcomeSpeech: stored?.welcomeSpeech === true,
    }
  },
  /** 只保存解析后的公开房间号码，避免分享链接携带跟踪参数。 */
  write(config: DouyinLiveConfig): void { putSettings(getDb(), 'douyin-live.settings', config) },
}
