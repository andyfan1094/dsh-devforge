// 企业微信智能机器人「长连接」协议编解码。
//
// 协议来源：企业微信开发者中心《智能机器人长连接》
//   https://developer.work.weixin.qq.com/document/path/101463
//
// 边界说明（为什么单独成文件）：
// 1. 这里只做「帧的构造与解析」，不持有连接、不做重试、不碰业务；
//    连接生命周期在 client.mjs，业务在 bridge.mjs，三者互不渗透。
// 2. 所有帧都是 JSON 文本，字段名与官方文档逐字对应；改名会让服务端直接
//    丢弃请求且只回 errcode，排查成本极高，因此集中在此文件维护。
// 3. 单元测试直接对拍本文件的输出，不需要真实企微环境。

import { createHash, randomUUID } from 'node:crypto'

/** 长连接服务端地址（官方文档固定值，不可配置）。 */
export const WECOM_WS_URL = 'wss://openws.work.weixin.qq.com'

/** 命令字：订阅（身份校验，连接建立后第一条）。 */
export const CMD_SUBSCRIBE = 'aibot_subscribe'
/** 命令字：心跳。 */
export const CMD_PING = 'ping'
/** 命令字：回复普通消息（含流式）。 */
export const CMD_RESPOND_MSG = 'aibot_respond_msg'
/** 命令字：回复欢迎语（仅 enter_chat 事件）。 */
export const CMD_RESPOND_WELCOME_MSG = 'aibot_respond_welcome_msg'
/** 命令字：主动推送消息。 */
export const CMD_SEND_MSG = 'aibot_send_msg'
/** 回调命令字：用户消息。 */
export const CMD_MSG_CALLBACK = 'aibot_msg_callback'
/** 回调命令字：事件（进会话、卡片点击、断线通知等）。 */
export const CMD_EVENT_CALLBACK = 'aibot_event_callback'

/** markdown 消息内容上限（官方：最长 20480 字节，UTF-8）。 */
export const MAX_MARKDOWN_BYTES = 20480

/** 生成请求唯一标识；服务端按 req_id 回执，必须每次唯一。 */
export function makeReqId() {
  return randomUUID()
}

/**
 * 构造订阅帧。
 * @param {string} botId 智能机器人 BotID
 * @param {string} secret 长连接专用 Secret
 * @param {string} reqId 本次请求标识
 */
export function buildSubscribe(botId, secret, reqId = makeReqId()) {
  return {
    cmd: CMD_SUBSCRIBE,
    headers: { req_id: reqId },
    body: { bot_id: String(botId ?? ''), secret: String(secret ?? '') },
  }
}

/** 构造心跳帧；服务端未及时收到心跳会主动断连，建议 30 秒一次。 */
export function buildPing(reqId = makeReqId()) {
  return { cmd: CMD_PING, headers: { req_id: reqId } }
}

/**
 * 构造「回复文本」帧。
 * 注意：必须透传收到回调时的 req_id，否则服务端无法把回复关联到那次会话。
 */
export function buildRespondText(reqId, text) {
  return {
    cmd: CMD_RESPOND_MSG,
    headers: { req_id: String(reqId ?? '') },
    body: {
      msgtype: 'markdown',
      markdown: { content: truncateMarkdown(text) },
    },
  }
}

/**
 * 构造「流式回复」帧。
 * 同一个 req_id + 同一个 stream.id 表示同一条流式消息：首次创建、后续刷新、
 * finish=true 收尾；10 分钟内必须收尾，否则服务端自动结束该流。
 * @param {string} reqId 回调透传的请求标识
 * @param {string} streamId 本次流式消息标识（同一轮内保持不变）
 * @param {string} content 当前累计内容
 * @param {boolean} finish 是否收尾
 */
export function buildRespondStream(reqId, streamId, content, finish) {
  return {
    cmd: CMD_RESPOND_MSG,
    headers: { req_id: String(reqId ?? '') },
    body: {
      msgtype: 'stream',
      stream: {
        id: String(streamId ?? ''),
        finish: finish === true,
        content: truncateMarkdown(content),
      },
    },
  }
}

/**
 * 构造「主动推送 markdown」帧。
 * 用于超过回复窗口、或后台任务完成后的通知；前提是用户先给机器人发过消息。
 * @param {string} chatid 单聊填 userid，群聊填 chatid
 * @param {number} chatType 1=单聊，2=群聊
 * @param {string} text markdown 正文
 */
export function buildSendMarkdown(chatid, chatType, text) {
  return {
    cmd: CMD_SEND_MSG,
    headers: { req_id: makeReqId() },
    body: {
      chatid: String(chatid ?? ''),
      chat_type: Number(chatType) === 2 ? 2 : 1,
      msgtype: 'markdown',
      markdown: { content: truncateMarkdown(text) },
    },
  }
}

/** 构造「回复欢迎语」帧；仅 enter_chat 事件可用，且需 5 秒内发出。 */
export function buildRespondWelcome(reqId, text) {
  return {
    cmd: CMD_RESPOND_WELCOME_MSG,
    headers: { req_id: String(reqId ?? '') },
    body: {
      msgtype: 'markdown',
      markdown: { content: truncateMarkdown(text) },
    },
  }
}

/**
 * 解析服务端下发的帧。
 * 服务端有两种形态：回执（errcode/errmsg）与回调（cmd + body）。
 * 解析失败返回 null，由调用方记日志丢弃——解析异常绝不能打断连接循环。
 */
export function parseFrame(raw) {
  if (typeof raw !== 'string') {
    // ws 库在 binary 模式下给 Buffer，这里统一按 UTF-8 解读。
    try {
      raw = Buffer.from(raw).toString('utf8')
    } catch {
      return null
    }
  }
  const text = String(raw ?? '').trim()
  if (text === '') return null
  let value
  try {
    value = JSON.parse(text)
  } catch {
    return null
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  return value
}

/**
 * 判断一帧是不是「回执」（而不是回调）。
 * 回执的特征是带 errcode；回调一定带 cmd。
 */
export function isAck(frame) {
  return frame !== null
    && typeof frame === 'object'
    && frame.cmd === undefined
    && (typeof frame.errcode === 'number' || typeof frame.errcode === 'string')
}

/** 从帧里取 req_id（回执与回调都放在 headers.req_id）。 */
export function reqIdOf(frame) {
  const value = frame?.headers?.req_id
  return typeof value === 'string' ? value : ''
}

/**
 * 按会话派生稳定 sessionId。
 * 同一会话（单聊用户 / 群）多次消息必须命中同一个 DSH 会话，否则上下文断裂；
 * 因此不能随机生成，只能由会话键哈希得到。
 * @param {string} chatKey 形如 "single:userid" 或 "group:chatid"
 */
export function deriveSessionId(chatKey) {
  const digest = createHash('sha256')
    .update('dsh-wecom-session-v1\0' + String(chatKey ?? ''), 'utf8')
    .digest('hex')
    .slice(0, 32)
  return 'session-wecom-' + digest
}

/**
 * 按字节上限截断 markdown，避免服务端拒收。
 * 按 UTF-8 字节算而不是按字符算：中文一个字 3 字节，按字符截会超限。
 */
export function truncateMarkdown(text, limit = MAX_MARKDOWN_BYTES) {
  const source = String(text ?? '')
  if (Buffer.byteLength(source, 'utf8') <= limit) return source
  const suffix = '\n\n（内容过长已截断）'
  const budget = Math.max(0, limit - Buffer.byteLength(suffix, 'utf8'))
  let used = 0
  let out = ''
  for (const char of source) {
    const size = Buffer.byteLength(char, 'utf8')
    if (used + size > budget) break
    used += size
    out += char
  }
  return out + suffix
}

/**
 * 从消息回调里抽出一条可读文本。
 * 群聊里 @机器人 的文本形如 "@机器人名 内容"，官方不会自动剥离，需要在业务侧清理；
 * 这里只做去空白，@ 前缀的剥离放在 bridge（因为需要知道机器人自己的显示名）。
 */
export function textOfCallback(body) {
  const msgtype = String(body?.msgtype ?? '')
  if (msgtype === 'text') return String(body?.text?.content ?? '')
  if (msgtype === 'mixed') {
    const items = Array.isArray(body?.mixed?.msg_item) ? body.mixed.msg_item : []
    const texts = items
      .filter((item) => String(item?.msgtype ?? '') === 'text')
      .map((item) => String(item?.text?.content ?? ''))
    return texts.join('\n')
  }
  if (msgtype === 'voice') return String(body?.voice?.content ?? '')
  return ''
}
