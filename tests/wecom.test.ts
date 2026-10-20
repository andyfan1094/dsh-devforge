/**
 * 企微智能机器人桥（dsh-wecom）单元与协议级测试。
 *
 * 覆盖范围：
 * 1. protocol.mjs：帧字段、会话号派生、按字节截断、坏帧容错。
 * 2. client.mjs：用本地 WebSocket 服务端模拟企微，真实跑「订阅 → 心跳 → 收回调 → 发回复」。
 * 3. bridge.mjs：用假 DSH 上下文验证投递、流式聚合、turn/end 收尾与 /help 指令。
 * 4. store.mjs：配置归一化与 Secret 脱敏。
 *
 * 改动前失败依据：src/wecom/* 为本次新增，旧代码里不存在这些模块与能力，
 * 本文件在改动前无法导入，全部用例必然失败。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { WebSocketServer } from 'ws'
import {
  buildPing,
  buildRespondStream,
  buildRespondText,
  buildSendMarkdown,
  buildSubscribe,
  deriveSessionId,
  parseFrame,
  textOfCallback,
  truncateMarkdown,
} from '../src/wecom/protocol.mjs'
import { WecomClient } from '../src/wecom/client.mjs'
import { WecomBridge, buildWecomUserMessage, stripMention } from '../src/wecom/bridge.mjs'
import { normalizeConfig, redactConfig } from '../src/wecom/store.mjs'

/** 轮询等待条件成立，超时抛错；用于等待异步帧到达。 */
async function waitFor(check: () => boolean, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (check()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('等待条件超时')
}

// ── protocol ────────────────────────────────────────────────────────────────

test('订阅帧字段与官方文档一致', () => {
  const frame = buildSubscribe('bot-1', 'sec-1', 'req-1')
  assert.equal(frame.cmd, 'aibot_subscribe')
  assert.equal(frame.headers.req_id, 'req-1')
  assert.equal(frame.body.bot_id, 'bot-1')
  assert.equal(frame.body.secret, 'sec-1')
})

test('心跳帧带唯一 req_id', () => {
  const a = buildPing()
  const b = buildPing()
  assert.equal(a.cmd, 'ping')
  assert.notEqual(a.headers.req_id, b.headers.req_id)
})

test('流式回复帧 finish 标记正确', () => {
  const frame = buildRespondStream('req-2', 'stream-1', '处理中', false)
  assert.equal(frame.cmd, 'aibot_respond_msg')
  assert.equal(frame.headers.req_id, 'req-2')
  assert.equal(frame.body.msgtype, 'stream')
  assert.equal(frame.body.stream.id, 'stream-1')
  assert.equal(frame.body.stream.finish, false)
  assert.equal(frame.body.stream.content, '处理中')
})

test('主动推送帧区分单聊与群聊', () => {
  const single = buildSendMarkdown('user-1', 1, '单聊消息')
  const group = buildSendMarkdown('chat-1', 2, '群消息')
  assert.equal(single.body.chat_type, 1)
  assert.equal(group.body.chat_type, 2)
  assert.equal(group.cmd, 'aibot_send_msg')
})

test('回复文本帧走 markdown 类型', () => {
  const frame = buildRespondText('req-3', '**粗体**')
  assert.equal(frame.body.msgtype, 'markdown')
  assert.equal(frame.body.markdown.content, '**粗体**')
})

test('会话号按会话键稳定派生且互不串号', () => {
  const a = deriveSessionId('single:user-1')
  const b = deriveSessionId('single:user-1')
  const c = deriveSessionId('single:user-2')
  assert.equal(a, b)
  assert.notEqual(a, c)
  assert.ok(a.startsWith('session-wecom-'))
  assert.equal(a.length, 'session-wecom-'.length + 32)
})

test('markdown 按 UTF-8 字节截断，不会把中文截成半个字', () => {
  const long = '汉'.repeat(8000) // 24000 字节，超过 20480 上限
  const out = truncateMarkdown(long)
  assert.ok(Buffer.byteLength(out, 'utf8') <= 20480)
  assert.ok(out.endsWith('（内容过长已截断）'))
  assert.ok(!out.includes('\uFFFD'))
})

test('坏帧解析返回 null 而不是抛错', () => {
  assert.equal(parseFrame('not-json'), null)
  assert.equal(parseFrame(''), null)
  assert.equal(parseFrame('[]'), null)
  assert.deepEqual(parseFrame('{"cmd":"ping"}'), { cmd: 'ping' })
})

test('回调文本抽取覆盖文本/混排/语音', () => {
  assert.equal(textOfCallback({ msgtype: 'text', text: { content: '你好' } }), '你好')
  assert.equal(textOfCallback({ msgtype: 'mixed', mixed: { msg_item: [{ msgtype: 'text', text: { content: 'A' } }, { msgtype: 'image' }, { msgtype: 'text', text: { content: 'B' } }] } }), 'A\nB')
  assert.equal(textOfCallback({ msgtype: 'voice', voice: { content: '语音转写' } }), '语音转写')
  assert.equal(textOfCallback({ msgtype: 'image' }), '')
})

// ── client（本地模拟企微服务端）─────────────────────────────────────────────

test('长连接：订阅、心跳、收回调、发回复全链路', async () => {
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1' })
  await once(server, 'listening')
  const port = server.address().port
  const received: any[] = []
  const connections: any[] = []
  server.on('connection', (socket) => {
    connections.push(socket)
    socket.on('message', (raw: any) => {
      const frame = JSON.parse(raw.toString())
      received.push(frame)
      // 订阅、心跳、回复都回执，模拟真实服务端。
      if (frame.cmd === 'aibot_subscribe' || frame.cmd === 'ping' || frame.cmd === 'aibot_respond_msg') {
        socket.send(JSON.stringify({ headers: { req_id: frame.headers.req_id }, errcode: 0, errmsg: 'ok' }))
      }
    })
  })

  const callbacks: any[] = []
  const client = new WecomClient({
    botId: 'bot-test',
    secret: 'secret-test',
    url: 'ws://127.0.0.1:' + port,
    heartbeatMs: 40,
    onMessage: (body: any, reqId: string) => callbacks.push({ body, reqId }),
  })

  try {
    await client.start()
    assert.equal(client.status().connected, true)

    // 服务端下发用户消息回调
    connections[0].send(JSON.stringify({
      cmd: 'aibot_msg_callback',
      headers: { req_id: 'req-abc' },
      body: { msgtype: 'text', text: { content: '你好' }, from: { userid: 'u1' }, chattype: 'single' },
    }))
    await waitFor(() => callbacks.length === 1)
    assert.equal(callbacks[0].reqId, 'req-abc')
    assert.equal(callbacks[0].body.text.content, '你好')

    // 心跳确实发出
    await waitFor(() => received.some((frame) => frame.cmd === 'ping'))

    // 发回复并拿到回执
    const ack = await client.request(buildRespondText('req-abc', '收到'))
    assert.equal(ack.errcode, 0)
    const sent = received.find((frame) => frame.cmd === 'aibot_respond_msg')
    assert.equal(sent.headers.req_id, 'req-abc')
  } finally {
    await client.stop()
    for (const socket of connections) {
      try { socket.close() } catch { /* ignore */ }
    }
    await new Promise((resolve) => server.close(resolve))
  }
})

test('长连接：订阅被拒时 start 抛错并说明 errcode', async () => {
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1' })
  await once(server, 'listening')
  const port = server.address().port
  server.on('connection', (socket) => {
    socket.on('message', (raw: any) => {
      const frame = JSON.parse(raw.toString())
      socket.send(JSON.stringify({ headers: { req_id: frame.headers.req_id }, errcode: 40001, errmsg: 'invalid secret' }))
    })
  })
  const client = new WecomClient({ botId: 'b', secret: 's', url: 'ws://127.0.0.1:' + port })
  try {
    await assert.rejects(() => client.start(), /40001/)
  } finally {
    await client.stop()
    await new Promise((resolve) => server.close(resolve))
  }
})

// ── bridge（假 DSH 上下文）─────────────────────────────────────────────────

/** 构造最小可用的假 DSH 上下文：记录投递消息与会话参数。 */
function fakeCtx() {
  const created: any[] = []
  return {
    created,
    agents: {
      create: async (options: any) => {
        const agent: any = {
          id: 'agent-' + String(created.length + 1),
          status: 'idle',
          session: { id: options.sessionId, events: [] },
          lastMessage: null,
          followup(message: any) {
            agent.lastMessage = message
            agent.status = 'running'
          },
          cancel() { agent.status = 'idle' },
        }
        created.push({ options, agent })
        return { agent, dispose: async () => { agent.status = 'disposed' } }
      },
    },
    agentDefaultModel: { currentSelection: () => ({ provider: 'deepseek', model: 'deepseek-v4' }) },
    agentPresets: { resolve: async (id: string) => ({ id }), mount: async (_ctx: any, id: string) => ({ id }) },
    on: () => () => {},
    logger: { info() {}, warn() {} },
  }
}

/** 构造记录帧的假长连接客户端。 */
function fakeClient() {
  const frames: any[] = []
  return {
    frames,
    send: (frame: any) => { frames.push(frame); return true },
    request: async (frame: any) => { frames.push(frame); return { errcode: 0, errmsg: 'ok' } },
    status: () => ({ connected: true }),
  }
}

const BRIDGE_CONFIG = {
  enabled: true,
  botId: 'bot',
  secret: 'secret',
  cwd: 'D:\\项目',
  agentPreset: 'cordis',
  botName: '天工助手',
  welcomeText: '',
  allowUserIds: [],
  replyMode: 'stream',
}

test('消息投递：source.kind 必须是 dsh-wecom（否则会话格式 v4 拒绝整轮）', async () => {
  const ctx = fakeCtx()
  const client = fakeClient()
  const bridge = new WecomBridge({ ctx, client, config: BRIDGE_CONFIG, streamFlushMs: 0 })
  await bridge.handleMessage({ chattype: 'single', from: { userid: 'u1' }, msgtype: 'text', text: { content: '你好' } }, 'req-1')

  assert.equal(ctx.created.length, 1)
  const message = ctx.created[0].agent.lastMessage
  assert.equal(message.role, 'user')
  assert.equal(message.source.kind, 'dsh-wecom')
  assert.deepEqual(message.content, [{ type: 'text', text: '你好' }])
  // 会话号必须是派生值
  assert.equal(ctx.created[0].options.sessionId, deriveSessionId('single:u1'))
  // 先发占位流式
  const placeholder = client.frames.find((frame) => frame.body?.msgtype === 'stream')
  assert.ok(placeholder !== undefined)
  assert.equal(placeholder.body.stream.finish, false)
})

test('流式聚合与 turn/end 收尾：最终帧 finish=true 且包含助手输出', async () => {
  const ctx = fakeCtx()
  const client = fakeClient()
  const bridge = new WecomBridge({ ctx, client, config: BRIDGE_CONFIG, streamFlushMs: 0 })
  await bridge.handleMessage({ chattype: 'single', from: { userid: 'u1' }, msgtype: 'text', text: { content: '写个函数' } }, 'req-1')
  const sessionId = ctx.created[0].options.sessionId

  bridge.observeSessionEvent({ id: sessionId, events: [] }, { type: 'assistant/chunk', data: { chunk: { type: 'text-delta', text: '好的，' } } })
  bridge.observeSessionEvent({ id: sessionId, events: [] }, { type: 'assistant/chunk', data: { chunk: { type: 'text-delta', text: '这是函数。' } } })
  bridge.observeSessionEvent({ id: sessionId, events: [] }, { type: 'turn/end', data: { reason: { kind: 'stop' } } })

  const streams = client.frames.filter((frame) => frame.body?.msgtype === 'stream')
  const final = streams[streams.length - 1]
  assert.equal(final.body.stream.finish, true)
  assert.equal(final.body.stream.content, '好的，这是函数。')
  assert.equal(final.headers.req_id, 'req-1')
})

test('非本桥会话的事件一律放行，不误发消息', async () => {
  const ctx = fakeCtx()
  const client = fakeClient()
  const bridge = new WecomBridge({ ctx, client, config: BRIDGE_CONFIG, streamFlushMs: 0 })
  bridge.observeSessionEvent({ id: 'session-gui-1', events: [] }, { type: 'turn/end', data: { reason: { kind: 'stop' } } })
  assert.equal(client.frames.length, 0)
})

test('/help 直接回说明，不进 Agent', async () => {
  const ctx = fakeCtx()
  const client = fakeClient()
  const bridge = new WecomBridge({ ctx, client, config: BRIDGE_CONFIG, streamFlushMs: 0 })
  await bridge.handleMessage({ chattype: 'single', from: { userid: 'u1' }, msgtype: 'text', text: { content: '/help' } }, 'req-help')
  assert.equal(ctx.created.length, 0)
  const reply = client.frames.find((frame) => frame.body?.msgtype === 'markdown')
  assert.ok(reply !== undefined)
  assert.match(reply.body.markdown.content, /企微桥/)
})

test('群聊 @机器人 前缀被剥离后再投递', async () => {
  const ctx = fakeCtx()
  const client = fakeClient()
  const bridge = new WecomBridge({ ctx, client, config: BRIDGE_CONFIG, streamFlushMs: 0 })
  await bridge.handleMessage({ chattype: 'group', chatid: 'chat-1', from: { userid: 'u1' }, msgtype: 'text', text: { content: '@天工助手 帮我看下日报' } }, 'req-g')
  const message = ctx.created[0].agent.lastMessage
  assert.deepEqual(message.content, [{ type: 'text', text: '帮我看下日报' }])
  // 群聊按 chatid 派生会话，不能和单聊串号
  assert.equal(ctx.created[0].options.sessionId, deriveSessionId('group:chat-1'))
})

test('运行中再发消息会排队，turn/end 后自动推进', async () => {
  const ctx = fakeCtx()
  const client = fakeClient()
  const bridge = new WecomBridge({ ctx, client, config: BRIDGE_CONFIG, streamFlushMs: 0 })
  await bridge.handleMessage({ chattype: 'single', from: { userid: 'u1' }, msgtype: 'text', text: { content: '第一条' } }, 'req-1')
  await bridge.handleMessage({ chattype: 'single', from: { userid: 'u1' }, msgtype: 'text', text: { content: '第二条' } }, 'req-2')
  const entry = ctx.created[0]
  // 运行中：第二条只入队，不投递
  assert.equal(entry.agent.lastMessage.content[0].text, '第一条')
  const status = bridge.status()
  assert.equal(status.conversations[0].queued, 1)

  bridge.observeSessionEvent({ id: entry.options.sessionId, events: [] }, { type: 'turn/end', data: { reason: { kind: 'stop' } } })
  await waitFor(() => entry.agent.lastMessage.content[0].text === '第二条')
})

test('stripMention 兼容配置了机器人名与未配置两种情况', () => {
  assert.equal(stripMention('@天工助手 你好', '天工助手'), '你好')
  assert.equal(stripMention('@某机器人 帮我写代码'), '帮我写代码')
  assert.equal(stripMention('普通消息'), '普通消息')
})

test('buildWecomUserMessage 空文本不产生空内容块', () => {
  const message = buildWecomUserMessage('   ')
  assert.deepEqual(message.content, [])
  assert.equal(message.source.kind, 'dsh-wecom')
})

// ── store ──────────────────────────────────────────────────────────────────

test('配置归一化：默认关闭、相对路径转绝对、白名单清洗', () => {
  const config = normalizeConfig({ enabled: true, cwd: '.', allowUserIds: [' a ', '', null] })
  assert.equal(config.enabled, true)
  assert.ok(config.cwd.length > 1)
  assert.deepEqual(config.allowUserIds, ['a'])
  assert.equal(config.agentPreset, 'cordis')
  assert.equal(config.replyMode, 'stream')
})

test('配置归一化：未知 replyMode 收敛为 stream', () => {
  assert.equal(normalizeConfig({ replyMode: 'weird' }).replyMode, 'stream')
  assert.equal(normalizeConfig({ replyMode: 'final' }).replyMode, 'final')
})

test('脱敏配置绝不回传 Secret 明文', () => {
  const view = redactConfig(normalizeConfig({ botId: 'bot-1', secret: 'top-secret' }))
  assert.equal(view.botId, 'bot-1')
  assert.equal(view.secretConfigured, true)
  assert.equal(JSON.stringify(view).includes('top-secret'), false)
})
