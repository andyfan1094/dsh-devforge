import type { DouyinLiveMessage } from './protocol.ts'

/** 只接受普通对象结构，忽略数组、null 和标量。 */
export function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

/** 外部字段只保留可显示标量，并限制长度。 */
function label(value: unknown, max = 2000): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value).slice(0, max) : ''
}

/** 兼容接收器 envelope 与 protobuf JSON 字段；不透传原始消息。 */
export function normalizeDouyinMessage(raw: unknown, sequence: number, now = Date.now()): { message: DouyinLiveMessage; remoteId: string } | undefined {
  const envelope = asRecord(raw)
  // 接收器把 method 添到 protobuf 平面对象；业务自己的 type/data 不能当作 envelope。
  const flat = typeof envelope.method === 'string'
  let payload = flat ? envelope : (envelope.data ?? envelope.Data ?? envelope.payload ?? envelope)
  if (typeof payload === 'string') {
    try { payload = JSON.parse(payload) } catch { return undefined }
  }
  const data = asRecord(payload)
  const kind = label(envelope.method ?? envelope.type ?? envelope.event ?? envelope.msg_type ?? envelope.message_type ?? data.type).toLowerCase()
  if (!kind || kind === 'ping' || kind === 'pong' || kind === 'heartbeat') return undefined
  let type: DouyinLiveMessage['type'] = 'other'
  if (kind.includes('chat')) type = 'chat'
  else if (kind.includes('gift')) type = 'gift'
  else if (kind.includes('like')) type = 'like'
  else if (kind.includes('member') || kind.includes('enter')) type = 'member'
  else if (kind.includes('social') || kind.includes('follow')) type = 'social'
  else if (kind === 'system' || kind === 'live_status') type = 'system'
  const user = asRecord(data.user ?? data.User ?? envelope.user)
  const common = asRecord(data.common ?? data.Common)
  const gift = asRecord(data.gift ?? data.Gift)
  const nickname = label(user.nickName ?? user.nickname ?? user.NickName ?? data.nickname ?? data.nick_name, 100)
  let text = label(data.content ?? data.Content ?? data.comment ?? data.text ?? data.message)
  if (!text) {
    if (type === 'gift') text = '送出 ' + (label(gift.name ?? data.gift_name, 100) || '礼物') + ' × ' + (label(data.repeatCount ?? data.repeat_count ?? data.combo_count ?? data.count, 20) || '1')
    else if (type === 'like') text = '点赞 × ' + (label(data.count ?? data.Count, 20) || '1')
    else if (type === 'member') text = label(data.actionDescription ?? data.action_description, 200) || '进入直播间'
    else if (type === 'social') text = label(data.actionDescription ?? data.action_description, 200) || '发生互动（关注/分享）'
    else return undefined
  }
  const remoteId = label(common.msgId ?? common.msg_id ?? common.MsgId ?? data.msgId ?? data.msg_id ?? envelope.msg_id ?? envelope.id, 128)
  return { remoteId: remoteId ? kind + ':' + remoteId : '', message: { id: String(sequence), sequence, type, nickname, text, receivedAt: now } }
}
