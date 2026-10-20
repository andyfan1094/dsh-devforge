// 企微长连接「本地模拟服务端」——仅用于开发联调与暂存验收。
//
// 为什么需要它：
// 真实企微长连接要 BotID/Secret，且会把消息真的发到用户微信里；
// 交付前想验证「桥能否在真实 DSH 宿主里跑通订阅→收消息→投递→回复」，
// 就需要一个可断言的假服务端。它实现的范围严格对应官方文档里的必要帧：
//   aibot_subscribe / ping / aibot_msg_callback / aibot_respond_msg / aibot_send_msg
//
// 用法：
//   node scripts/wecom-mock-server.mjs --port 18888
//   然后让桥指向它：设置 DSH_WECOM_WS_URL=ws://127.0.0.1:18888
//
// 控制接口（本机 HTTP）：
//   POST /send   {"text":"你好","userid":"u1","chattype":"single"}  模拟用户发消息
//   GET  /frames                                                     查看服务端收到的帧
//   POST /reset                                                      清空记录
//   GET  /health                                                     健康检查

import { createServer } from 'node:http'
import { WebSocketServer } from 'ws'

const args = process.argv.slice(2)
const portIndex = args.indexOf('--port')
const PORT = portIndex >= 0 ? Number(args[portIndex + 1]) : 18888
const HTTP_PORT = PORT + 1

/** 服务端收到的所有帧（用于断言）。 */
const frames = []
/** 当前已订阅的连接。 */
let activeSocket = null
/** 模拟的用户消息序号。 */
let requestSeq = 0

function log(message) {
  process.stdout.write('[wecom-mock] ' + message + '\n')
}

const wss = new WebSocketServer({ port: PORT, host: '127.0.0.1' })
wss.on('listening', () => log('WebSocket 服务端已监听 ws://127.0.0.1:' + String(PORT)))

wss.on('connection', (socket) => {
  log('客户端已连接')
  socket.on('message', (raw) => {
    let frame
    try {
      frame = JSON.parse(raw.toString())
    } catch {
      log('收到无法解析的帧')
      return
    }
    frames.push({ at: Date.now(), frame })
    const reqId = frame?.headers?.req_id ?? ''
    const cmd = String(frame?.cmd ?? '')
    log('收到 ' + cmd + ' req_id=' + String(reqId))
    if (cmd === 'aibot_subscribe') {
      activeSocket = socket
      socket.send(JSON.stringify({ headers: { req_id: reqId }, errcode: 0, errmsg: 'ok' }))
      return
    }
    // 心跳与回复都回执（真实服务端行为）。
    if (cmd === 'ping' || cmd === 'aibot_respond_msg' || cmd === 'aibot_send_msg' || cmd === 'aibot_respond_welcome_msg') {
      socket.send(JSON.stringify({ headers: { req_id: reqId }, errcode: 0, errmsg: 'ok' }))
    }
  })
  socket.on('close', () => {
    log('客户端断开')
    if (activeSocket === socket) activeSocket = null
  })
})

const http = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1')
  const json = (status, body) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify(body))
  }
  if (req.method === 'GET' && url.pathname === '/health') {
    json(200, { ok: true, connected: activeSocket !== null, frames: frames.length })
    return
  }
  if (req.method === 'GET' && url.pathname === '/frames') {
    json(200, { frames })
    return
  }
  if (req.method === 'POST' && url.pathname === '/reset') {
    frames.length = 0
    json(200, { ok: true })
    return
  }
  if (req.method === 'POST' && url.pathname === '/send') {
    if (activeSocket === null) {
      json(409, { ok: false, error: '桥尚未连接' })
      return
    }
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    let payload = {}
    try {
      payload = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
    } catch {
      json(400, { ok: false, error: 'invalid json' })
      return
    }
    requestSeq += 1
    const reqId = 'mock-req-' + String(requestSeq)
    const chattype = String(payload.chattype ?? 'single')
    const body = {
      msgtype: 'text',
      text: { content: String(payload.text ?? '') },
      from: { userid: String(payload.userid ?? 'u1') },
      chattype,
      ...(chattype === 'group' ? { chatid: String(payload.chatid ?? 'chat-1') } : {}),
    }
    activeSocket.send(JSON.stringify({ cmd: 'aibot_msg_callback', headers: { req_id: reqId }, body }))
    log('已下发用户消息 req_id=' + reqId + ' 内容=' + String(payload.text ?? ''))
    json(200, { ok: true, reqId })
    return
  }
  json(404, { ok: false, error: 'not found' })
})

http.listen(HTTP_PORT, '127.0.0.1', () => {
  log('控制接口已监听 http://127.0.0.1:' + String(HTTP_PORT))
})
