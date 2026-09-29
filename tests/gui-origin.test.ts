/**
 * 本机 GUI 同源围栏测试 —— isGuiSameOriginRequest 及其在真实路由上的接线。
 *
 * 背景：DSH 桌面壳把产品主界面跑在自定义协议 dsh-app://app 上，并把 /api 请求代转到宿主；
 * 代转时壳会删除 origin / host / cookie / sec-fetch-site 四个头、只留 referer，
 * 因此写请求到达插件时 Origin 必然缺失、Referer 是 dsh-app://app/…。
 * 修复前「来源 host === 请求 Host」的判定会让桌面版所有写操作报
 * forbidden: same-origin request required。
 *
 * 覆盖：桌面壳代转形状、HTTP/HTTPS 同源、跨站来源、file:// 的 null 来源、
 * 本机其它端口网页、非 loopback 来源、sec-fetch-site 兜底，以及真实路由接线。
 * 隔离：不触碰生产数据；路由级用例固定发空 JSON 对象，路由在读取请求体阶段即返回 400。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isGuiSameOriginRequest, isLoopbackRequest } from '../src/loopback.ts'
import { CREDENTIALS_API, makeCredentialsRoutes } from '../src/credentials-routes.ts'

/** 桌面版宿主实际监听的地址（与 Host 头一致）。 */
const LOCAL_HOST = '127.0.0.1:19387'

/** 造一个只带 socket.remoteAddress 与 headers 的假请求对象。 */
function request(headers: Record<string, string>, remoteAddress = '127.0.0.1'): {
  socket: { remoteAddress: string }
  headers: Record<string, string>
} {
  return { socket: { remoteAddress }, headers }
}

test('loopback 判定覆盖 IPv4/IPv6/映射地址与非本机地址', () => {
  assert.equal(isLoopbackRequest({ socket: { remoteAddress: '127.0.0.1' } }), true)
  assert.equal(isLoopbackRequest({ socket: { remoteAddress: '::1' } }), true)
  assert.equal(isLoopbackRequest({ socket: { remoteAddress: '::ffff:127.0.0.1' } }), true)
  assert.equal(isLoopbackRequest({ socket: { remoteAddress: '192.168.71.13' } }), false)
  assert.equal(isLoopbackRequest({}), false)
})

test('HTTP 与 HTTPS 同源写请求放行（web 实例行为不回归）', () => {
  assert.equal(isGuiSameOriginRequest(request({ host: LOCAL_HOST, origin: `http://${LOCAL_HOST}` })), true)
  assert.equal(isGuiSameOriginRequest(request({ host: 'localhost:3080', origin: 'http://localhost:3080' })), true)
  assert.equal(isGuiSameOriginRequest(request({ host: '127.0.0.1:3080', origin: 'https://127.0.0.1:3080' })), true)
})

test('DSH 桌面壳代转：Origin 被壳删除、Referer 为 dsh-app://app 时放行', () => {
  assert.equal(isGuiSameOriginRequest(request({ host: LOCAL_HOST, referer: 'dsh-app://app/settings' })), true)
})

test('DSH 桌面壳页面直接发起（Origin: dsh-app://）时放行', () => {
  assert.equal(isGuiSameOriginRequest(request({ host: LOCAL_HOST, origin: 'dsh-app://app' })), true)
  assert.equal(isGuiSameOriginRequest(request({ host: LOCAL_HOST, origin: 'dsh-app://shell/update-dialog.html' })), true)
})

test('本机非浏览器客户端（无 Origin、无 Referer）放行', () => {
  assert.equal(isGuiSameOriginRequest(request({ host: LOCAL_HOST })), true)
})

test('跨站与本机其它网页来源一律拒绝', () => {
  assert.equal(isGuiSameOriginRequest(request({ host: LOCAL_HOST, origin: 'https://evil.example' })), false)
  assert.equal(isGuiSameOriginRequest(request({ host: LOCAL_HOST, origin: 'http://127.0.0.1:3080' })), false)
  assert.equal(isGuiSameOriginRequest(request({ host: LOCAL_HOST, origin: 'null' })), false)
  assert.equal(isGuiSameOriginRequest(request({ host: LOCAL_HOST, referer: 'https://evil.example/x' })), false)
})

test('Origin 优先于 Referer：伪造成桌面壳 Referer 也救不了跨站 Origin', () => {
  assert.equal(isGuiSameOriginRequest(request({ host: LOCAL_HOST, origin: 'https://evil.example', referer: 'dsh-app://app/x' })), false)
})

test('sec-fetch-site: cross-site 一票否决', () => {
  assert.equal(isGuiSameOriginRequest(request({ host: LOCAL_HOST, origin: `http://${LOCAL_HOST}`, 'sec-fetch-site': 'cross-site' })), false)
})

test('非 loopback 来源与缺失 Host 头拒绝', () => {
  assert.equal(isGuiSameOriginRequest(request({ host: LOCAL_HOST, origin: `http://${LOCAL_HOST}` }, '192.168.71.13')), false)
  assert.equal(isGuiSameOriginRequest(request({ origin: `http://${LOCAL_HOST}` })), false)
})

/**
 * 用假 req/res 调一次凭据写入路由。
 * 固定发送空 JSON 对象：围栏通过后请求体校验立即返回 400，不会写入任何凭据。
 * @param headers - 本次请求要带的请求头。
 * @param remoteAddress - 模拟的对端地址。
 * @returns 响应状态码与错误文案。
 */
async function callCredentialsSet(
  headers: Record<string, string>,
  remoteAddress = '127.0.0.1',
): Promise<{ status: number; error: string | undefined }> {
  const route = makeCredentialsRoutes().find((item) => item.path === CREDENTIALS_API.set)
  assert.ok(route, '凭据写入路由未注册')
  const req = {
    method: 'POST',
    socket: { remoteAddress },
    headers,
    url: CREDENTIALS_API.set,
    // 路由用 `for await (const chunk of req)` 读体，假请求必须提供异步迭代器。
    async *[Symbol.asyncIterator]() {
      yield Buffer.from('{}')
    },
  } as unknown as import('node:http').IncomingMessage
  let status = 0
  let payload: Record<string, unknown> = {}
  const res = {
    writeHead(code: number) { status = code },
    end(raw: string) { payload = JSON.parse(String(raw)) as Record<string, unknown> },
  } as unknown as import('node:http').ServerResponse
  await route.handler(req, res)
  return { status, error: typeof payload.error === 'string' ? payload.error : undefined }
}

test('真实凭据路由：桌面壳代转形状与 HTTP 同源都通过围栏（不再是 403）', async () => {
  const shellProxy = await callCredentialsSet({ host: LOCAL_HOST, referer: 'dsh-app://app/settings' })
  assert.equal(shellProxy.status, 400)
  assert.equal(shellProxy.error, 'ref 不能为空。')

  const webSameOrigin = await callCredentialsSet({ host: LOCAL_HOST, origin: `http://${LOCAL_HOST}` })
  assert.equal(webSameOrigin.status, 400)
  assert.equal(webSameOrigin.error, 'ref 不能为空。')

  const localScript = await callCredentialsSet({ host: LOCAL_HOST })
  assert.equal(localScript.status, 400)
})

test('真实凭据路由：跨站、非 loopback 来源仍被围栏挡下', async () => {
  const crossSite = await callCredentialsSet({ host: LOCAL_HOST, origin: 'https://evil.example' })
  assert.equal(crossSite.status, 403)
  assert.equal(crossSite.error, 'forbidden: same-origin request required')

  const otherLocalPage = await callCredentialsSet({ host: LOCAL_HOST, origin: 'http://127.0.0.1:3080' })
  assert.equal(otherLocalPage.status, 403)
  assert.equal(otherLocalPage.error, 'forbidden: same-origin request required')

  const lan = await callCredentialsSet({ host: LOCAL_HOST, origin: `http://${LOCAL_HOST}` }, '192.168.71.13')
  assert.equal(lan.status, 403)
  assert.equal(lan.error, 'forbidden: loopback-only')
})
