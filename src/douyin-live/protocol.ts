/** 抖音直播只读消息接口；不向浏览器暴露原始载荷或凭据。 */
export const DOUYIN_LIVE_API = '/api/dsh-devforge/douyin-live'

/** 保存公开房间输入和自动跟随开关；连接状态、消息不落盘。 */
export interface DouyinLiveConfig { roomInput: string; autoMonitor: boolean; welcomeSpeech: boolean }
export type CompanionState = 'unknown' | 'live' | 'offline'
/** 伴侣状态只暴露有限字段，不暴露日志原文、Cookie 或签名。 */
export interface CompanionSnapshot {
  installed: boolean
  state: CompanionState
  internalRoomId: string
  publicRoomId: string
  error: string
  updatedAt?: number
}
export type DouyinConnectionState = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'error'
/** 归一化后的有限展示字段。 */
export interface DouyinLiveMessage {
  id: string
  sequence: number
  type: 'chat' | 'gift' | 'like' | 'member' | 'social' | 'system' | 'other'
  nickname: string
  text: string
  receivedAt: number
}
/** Host 权威状态；messages 最多保留 500 条。 */
export interface DouyinLiveSnapshot {
  config: DouyinLiveConfig
  companion: CompanionSnapshot
  connection: DouyinConnectionState
  upstreamReady: boolean
  roomId: string
  roomOnline?: boolean
  error: string
  messages: DouyinLiveMessage[]
  received: number
  lastEventAt?: number
}
