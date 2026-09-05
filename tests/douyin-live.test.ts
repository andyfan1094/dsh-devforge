import assert from 'node:assert/strict'
import { test } from 'node:test'
import { EventEmitter } from 'node:events'
import { createServer, request } from 'node:http'
import type { AddressInfo } from 'node:net'
import type WebSocket from 'ws'
import { setTimeout as delay } from 'node:timers/promises'
import { DouyinLiveService } from '../src/douyin-live/service.ts'
import { normalizeDouyinMessage } from '../src/douyin-live/normalize.ts'
import { resolveDouyinRoom } from '../src/douyin-live/room.ts'
import { isDouyinLiveUrl, publicRoomIdFromDouyinUrl } from '../src/douyin-live/link.ts'
import { makeDouyinLiveRoutes } from '../src/douyin-live/routes.ts'
import { WelcomeSpeechService } from '../src/douyin-live/speech.ts'

/** 伪接收器仅在内存广播，不向真实直播发送任何消息。 */
class FakeSocket extends EventEmitter {
  stopped = false
  terminate(): void { this.stopped = true; this.emit('close') }
  ping(): void { this.emit('pong') }
  message(data: unknown): void { this.emit('message', Buffer.from(JSON.stringify(data))) }
}

function fixture() {
  const sockets: FakeSocket[] = []
  let config = { roomInput: '123' }
  const urls: string[] = []
  const service = new DouyinLiveService({
    store: { read: () => config, write: value => { config = value } }, log: () => {}, retryMs: 5,
    socket: url => { urls.push(url); const socket = new FakeSocket(); sockets.push(socket); return socket as unknown as WebSocket },
  })
  return { service, sockets, urls }
}

const chat = (id: number) => ({ type: 'WebcastChatMessage', data: { common: { msgId: String(id) }, user: { nickName: '测试观众' }, content: '测试弹幕 ' + id } })

test('房间解析支持号码、直链及逐跳验证分享链接', async () => {
  const signal = AbortSignal.timeout(1000)
  const never = (async () => { throw new Error('不应访问网络') }) as typeof fetch
  assert.equal(await resolveDouyinRoom('287865911150', signal, never), '287865911150')
  assert.equal(await resolveDouyinRoom('https://live.douyin.com/287865911150', signal, never), '287865911150')
  const seen: string[] = []
  const request = (async (url: URL) => {
    seen.push(url.href)
    if (seen.length === 1) return new Response(null, { status: 302, headers: { location: 'https://webcast.amemv.com/share/123' } })
    return new Response('<script>{"room_id":"999","webRid":"456"}</script>')
  }) as typeof fetch
  assert.equal(await resolveDouyinRoom('直播分享 https://v.douyin.com/abc/ 来看', signal, request), '456')
  assert.equal(seen.length, 2)
})

test('链接拦截只认 HTTPS 抖音直播地址并保留公开房间号规则', () => {
  const direct = new URL('https://live.douyin.com/287865911150?enter_from=share')
  const short = new URL('https://v.douyin.com/AbCdEf/')
  assert.equal(isDouyinLiveUrl(direct), true)
  assert.equal(isDouyinLiveUrl(short), true)
  assert.equal(publicRoomIdFromDouyinUrl(direct), '287865911150')
  assert.equal(publicRoomIdFromDouyinUrl(new URL('https://live.douyin.com/123/456')), undefined)
  for (const input of [
    'http://live.douyin.com/287865911150',
    'https://live.douyin.com.evil.test/287865911150',
    'https://u:p@live.douyin.com/287865911150',
    'https://live.douyin.com:8443/287865911150',
    'https://www.douyin.com/video/123456',
  ]) assert.equal(isDouyinLiveUrl(new URL(input)), false)
})

test('拒绝非白名单、凭据、非法端口、内部room_id和恶意重定向', async () => {
  const signal = AbortSignal.timeout(1000)
  const empty = (async () => new Response('{"room_id":"999"}')) as typeof fetch
  for (const input of ['', {}, 'https://127.0.0.1/admin', 'http://live.douyin.com/123', 'https://live.douyin.com.evil.test/123', 'https://u:p@live.douyin.com/123', 'https://live.douyin.com:8080/123', 'https://v.douyin.com/abc']) {
    await assert.rejects(resolveDouyinRoom(input, signal, empty))
  }
  const redirect = (async () => new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/' } })) as typeof fetch
  await assert.rejects(resolveDouyinRoom('https://v.douyin.com/abc', signal, redirect))
  const big = (async () => new Response('a'.repeat(2 * 1024 * 1024 + 1))) as typeof fetch
  await assert.rejects(resolveDouyinRoom('https://v.douyin.com/abc', signal, big), /过大/)
})

test('事件归一化覆盖常见类型、长度限制、未知与损坏载荷', () => {
  const flat = normalizeDouyinMessage({ method: 'WebcastChatMessage', type: 1, data: '业务字段', common: { msgId: '18446744073709551615' }, user: { nickname: '真实格式' }, content: '平面消息' }, 1)!
  assert.equal(flat.message.nickname, '真实格式')
  assert.equal(flat.message.text, '平面消息')
  assert.equal(flat.message.type, 'chat')
  assert.equal(flat.remoteId, 'webcastchatmessage:18446744073709551615')
  const result = normalizeDouyinMessage(chat(1), 1, 10)!
  assert.equal(result.message.type, 'chat')
  assert.equal(result.message.nickname, '测试观众')
  assert.equal(result.message.receivedAt, 10)
  assert.equal(result.remoteId, 'webcastchatmessage:1')
  for (const [kind, type] of [['Gift', 'gift'], ['Like', 'like'], ['Member', 'member'], ['Social', 'social']]) {
    assert.equal(normalizeDouyinMessage({ method: 'Webcast' + kind + 'Message', data: { gift: { name: '测试礼物' }, count: 2 } }, 2)?.message.type, type)
  }
  assert.equal(normalizeDouyinMessage({ type: 'WebcastChatMessage', data: '{"content":"hello"}' }, 3)?.message.text, 'hello')
  const limited = normalizeDouyinMessage({ type: 'chat', content: 'a'.repeat(3000), user: { nickname: 'n'.repeat(200) }, cookie: 'secret' }, 4)!
  assert.equal(limited.message.text.length, 2000)
  assert.equal(limited.message.nickname.length, 100)
  assert.ok(!JSON.stringify(limited).includes('secret'))
  for (const raw of [null, [], {}, { type: 'ping' }, { type: 'chat', data: '{bad' }]) assert.equal(normalizeDouyinMessage(raw, 5), undefined)
})

test('连接手动开启，状态帧标记上游就绪，去重及缓存有界', async t => {
  const { service, sockets, urls } = fixture()
  t.after(() => service.dispose())
  assert.equal(service.snapshot().connection, 'idle')
  assert.equal(sockets.length, 0)
  await service.connect('123')
  const socket = sockets[0]!
  assert.equal(urls[0], 'ws://127.0.0.1:1088/ws/123')
  socket.emit('open')
  socket.message({ type: 'system', event: 'live_status', code: 'ROOM_ONLINE', valid: true, live: true, message: '直播间已开播' })
  assert.equal(service.snapshot().roomOnline, true)
  assert.equal(service.snapshot().upstreamReady, true)
  socket.message(chat(1)); socket.message(chat(1))
  assert.equal(service.snapshot().received, 2)
  assert.equal(service.snapshot().upstreamReady, true)
  for (let id = 2; id <= 601; id++) socket.message(chat(id))
  assert.equal(service.snapshot().messages.length, 500)
  assert.equal(service.snapshot().received, 602)
  const copy = service.snapshot()
  copy.messages[0]!.text = '篡改'
  assert.notEqual(service.snapshot().messages[0]!.text, '篡改')
  service.clear()
  socket.message(chat(601))
  assert.equal(service.snapshot().received, 0)
  assert.equal(service.snapshot().messages.length, 0)
  socket.message(chat(602))
  assert.ok(service.snapshot().messages[0]!.sequence > 602)
})

test('断线仅安排一次重连，手动断开后旧事件不再污染状态', async t => {
  const { service, sockets } = fixture()
  t.after(() => service.dispose())
  await service.connect('123')
  const old = sockets[0]!
  old.emit('open'); old.emit('error', new Error('模拟异常')); old.emit('close'); old.emit('close')
  assert.equal(service.snapshot().connection, 'reconnecting')
  await delay(20)
  assert.equal(sockets.length, 2)
  sockets[1]!.emit('open')
  old.message(chat(1)); old.emit('error', new Error('过期'))
  assert.equal(service.snapshot().received, 0)
  assert.equal(service.snapshot().error, '')
  sockets[1]!.emit('close')
  service.disconnect()
  await delay(20)
  assert.equal(sockets.length, 2)
  assert.equal(service.snapshot().connection, 'idle')
})

test('切换房间清空缓存，停止及并发操作取消未完成解析', async t => {
  const { service, sockets } = fixture()
  t.after(() => service.dispose())
  await service.connect('123')
  sockets[0]!.message(chat(1))
  await service.connect('456')
  assert.ok(sockets[0]!.stopped)
  assert.equal(service.snapshot().roomId, '456')
  assert.equal(service.snapshot().messages.length, 0)
  let finish!: (value: string) => void
  let opened = 0
  const racing = new DouyinLiveService({
    store: { read: () => ({ roomInput: '' }), write: () => {} }, log: () => {},
    resolve: async () => await new Promise(resolve => { finish = resolve }),
    socket: () => { opened++; return new FakeSocket() as unknown as WebSocket },
  })
  t.after(() => racing.dispose())
  const pending = racing.connect('123')
  racing.disconnect(); finish('123'); await pending
  assert.equal(opened, 0)
  assert.equal(racing.snapshot().connection, 'idle')
})

test('自动跟随伴侣开播映射公开房间并在停播后断开', async t => {
  let companion = { installed: true, state: 'live' as const, internalRoomId: '7681903275842489138', publicRoomId: '287865911150', error: '', updatedAt: 10 }
  let stored = { roomInput: '287865911150', autoMonitor: true }
  const sockets: FakeSocket[] = []
  const urls: string[] = []
  const service = new DouyinLiveService({
    store: { read: () => stored, write: value => { stored = value } }, log: () => {}, monitorIntervalMs: 5,
    companionRead: () => companion,
    companionProbe: async () => ({ live: true, publicRoomId: '287865911150', internalRoomId: companion.internalRoomId }),
    resolve: async input => String(input),
    socket: url => { urls.push(url); const socket = new FakeSocket(); sockets.push(socket); return socket as unknown as WebSocket },
  })
  t.after(() => service.dispose())
  await delay(25)
  assert.equal(urls.length, 1)
  assert.equal(urls[0], 'ws://127.0.0.1:1088/ws/287865911150')
  assert.equal(service.snapshot().connection, 'connecting')
  companion = { ...companion, state: 'offline', internalRoomId: '', updatedAt: 20 }
  await delay(25)
  assert.equal(service.snapshot().connection, 'idle')
  assert.equal(sockets[0]!.stopped, true)
})

test('自动跟随开关持久化且关闭不会断开手动连接', async t => {
  let stored = { roomInput: '123', autoMonitor: false }
  const sockets: FakeSocket[] = []
  const service = new DouyinLiveService({
    store: { read: () => stored, write: value => { stored = value } }, log: () => {}, monitorIntervalMs: 100000,
    companionRead: () => ({ installed: true, state: 'unknown', internalRoomId: '', publicRoomId: '', error: '' }),
    resolve: async input => String(input), socket: () => { const socket = new FakeSocket(); sockets.push(socket); return socket as unknown as WebSocket },
  })
  t.after(() => service.dispose())
  service.setAutoMonitor(true)
  assert.equal(stored.autoMonitor, true)
  await service.connect('123')
  sockets[0]!.emit('open')
  service.setAutoMonitor(false)
  assert.equal(stored.autoMonitor, false)
  assert.equal(service.snapshot().connection, 'connected')
})

test('入场欢迎语音按昵称60秒和全局3秒限频', () => {
  let now = 0
  const spoken: string[] = []
  const speech = new WelcomeSpeechService(text => spoken.push(text), () => now)
  assert.equal(speech.announce('小明'), true)
  now = 1000
  assert.equal(speech.announce('小红'), false)
  now = 3000
  assert.equal(speech.announce('小红'), true)
  now = 60000
  assert.equal(speech.announce('小明'), true)
  assert.deepEqual(spoken, ['欢迎小明进入我的直播间', '欢迎小红进入我的直播间', '欢迎小明进入我的直播间'])
  speech.dispose()
})

test('路由验证方法、同源边界、损坏JSON与只读快照', async t => {
  const { service } = fixture()
  const routes = makeDouyinLiveRoutes(service)
  const server = createServer((req, res) => {
    const route = routes.find(route => route.path === req.url)
    if (route) void route.handler(req, res)
    else { res.statusCode = 404; res.end() }
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => { service.dispose(); server.closeAllConnections(); server.close() })
  const base = 'http://127.0.0.1:' + (server.address() as AddressInfo).port + '/api/dsh-devforge/douyin-live'
  assert.equal((await fetch(base + '/snapshot')).status, 200)
  assert.equal((await fetch(base + '/snapshot', { method: 'POST' })).status, 405)
  assert.equal((await fetch(base + '/disconnect', { method: 'POST', headers: { origin: 'https://evil.test' } })).status, 403)
  // 原生 fetch 会重写 Host；用 http.request 验证 DNS rebinding 的实际请求头。
  const untrustedHost = await new Promise<number | undefined>((resolve, reject) => {
    request(base + '/snapshot', { headers: { host: 'evil.test' } }, response => { response.resume(); resolve(response.statusCode) }).on('error', reject).end()
  })
  assert.equal(untrustedHost, 403)
  for (const body of ['null', '[]', '{}', '{bad', JSON.stringify({ roomInput: 'a'.repeat(9000) })]) {
    const res = await fetch(base + '/connect', { method: 'POST', headers: { 'content-type': 'application/json' }, body })
    assert.equal(res.status, 400)
  }
  const connected = await fetch(base + '/connect', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"roomInput":"123"}' })
  assert.equal(connected.status, 200)
  assert.equal((await connected.json()).snapshot.roomId, '123')
  assert.equal((await fetch(base + '/clear', { method: 'POST' })).status, 200)
  const auto = await fetch(base + '/auto', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: true }) })
  assert.equal(auto.status, 200)
  assert.equal((await auto.json()).snapshot.config.autoMonitor, true)
  const speech = await fetch(base + '/speech', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: true }) })
  assert.equal(speech.status, 200)
  assert.equal((await speech.json()).snapshot.config.welcomeSpeech, true)
  assert.equal((await fetch(base + '/disconnect', { method: 'POST' })).status, 200)
})
