/** 火山方舟套餐用量：SigV4 请求和上游响应规整的无真实网络单测。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ArkCodingPlanService } from '../src/ark/service.ts'
import { buildVolcOpenApiRequest, fetchArkPlanUsage, parseArkUsageResponse } from '../src/ark/usage.ts'

/** 固定时间下的签名必须稳定，且 URL/请求头不得出现 Secret Key 明文。 */
test('火山 OpenAPI V4 签名：固定 canonical query 与凭据安全边界', () => {
  const request = buildVolcOpenApiRequest('GetAFPUsage', 'cn-beijing', 'test-access', 'test-secret', new Date('2026-08-31T03:00:00.000Z'))
  assert.equal(request.url, 'https://open.volcengineapi.com/?Action=GetAFPUsage&Region=cn-beijing&Version=2024-01-01')
  assert.equal(request.body, '')
  assert.equal(request.headers['X-Date'], '20260831T030000Z')
  assert.equal(request.headers['X-Content-Sha256'], 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  const authorizationPrefix = 'HMAC-SHA256 Credential=test-access/20260831/cn-beijing/ark/request, SignedHeaders=content-type;host;x-content-sha256;x-date, Signature='
  assert.equal(request.headers.Authorization.startsWith(authorizationPrefix), true)
  assert.match(request.headers.Authorization.slice(authorizationPrefix.length), /^[a-f0-9]{64}$/)
  assert.equal(request.url.includes('test-secret'), false)
  assert.equal(JSON.stringify(request.headers).includes('test-secret'), false)
})

/** Agent Plan 返回的绝对量、百分比和秒级重置时间应转换成稳定契约。 */
test('方舟用量响应：规整额度窗口与重置时间', () => {
  const plan = parseArkUsageResponse('agent-plan', 200, JSON.stringify({
    Result: {
      QuotaUsage: [
        { Level: '5h', Used: 250, Total: 1000, Percent: 25, ResetTimestamp: 1_800_000_000 },
        { Level: 'weekly', Used: '12500', Total: '50000', ResetTime: '2026-09-07T00:00:00+08:00' },
        { Level: 'daily', Used: 1, Total: 10, Percent: 10 },
      ],
    },
  }))
  assert.equal(plan.subscribed, true)
  assert.equal(plan.error, undefined)
  assert.deepEqual(plan.periods[0], {
    level: '5h',
    used: 250,
    total: 1000,
    usedPercent: 25,
    resetAt: 1_800_000_000_000,
  })
  assert.equal(plan.periods.length, 2)
  assert.equal(plan.periods[1]?.usedPercent, 25)
  assert.equal(plan.periods[1]?.resetAt, Date.parse('2026-09-07T00:00:00+08:00'))
})

/** OpenAPI 业务错误只返回短错误，不透传完整响应对象。 */
test('方舟用量响应：规整 OpenAPI 权限错误与未知 schema', () => {
  const denied = parseArkUsageResponse('coding-plan', 403, JSON.stringify({
    ResponseMetadata: { Error: { Code: 'AccessDenied', Message: '没有用量查询权限' } },
  }))
  assert.equal(denied.subscribed, false)
  assert.deepEqual(denied.periods, [])
  assert.equal(denied.error, 'AccessDenied: 没有用量查询权限')

  const unknown = parseArkUsageResponse('agent-plan', 200, JSON.stringify({ Result: { Unexpected: [] } }))
  assert.equal(unknown.subscribed, false)
  assert.equal(unknown.error, '火山方舟用量响应缺少可识别的额度数组。')
  const unsubscribed = parseArkUsageResponse('agent-plan', 200, JSON.stringify({ Result: null }))
  assert.equal(unsubscribed.error, undefined)
  assert.equal(unsubscribed.subscribed, false)
})

/** 两个套餐并发查询时，一个失败不得遮蔽另一个成功结果。 */
test('方舟用量请求：并发读取两个套餐并隔离单套餐错误', async () => {
  const urls: string[] = []
  const fakeFetch = (async (input: string | URL | Request) => {
    const url = String(input)
    urls.push(url)
    if (url.includes('Action=GetAFPUsage')) {
      return new Response(JSON.stringify({ Result: { QuotaUsage: [{ Level: '5h', Percent: 12.5 }] } }), { status: 200 })
    }
    throw new Error('Coding Plan 网络暂时不可用')
  }) as typeof fetch
  const plans = await fetchArkPlanUsage({
    accessKey: 'access',
    secretKey: 'secret',
    region: 'cn-beijing',
    timeoutMs: 1000,
    fetcher: fakeFetch,
  })
  assert.equal(urls.length, 2)
  assert.equal(plans.find((plan) => plan.product === 'agent-plan')?.periods[0]?.usedPercent, 12.5)
  assert.equal(plans.find((plan) => plan.product === 'coding-plan')?.error, '用量请求失败：Coding Plan 网络暂时不可用')
})

/** 五分钟内复用成功快照；强制刷新失败时返回 stale 旧数据。 */
test('方舟用量服务：换凭据时强制刷新重新签名', async () => {
  const originalFetch = globalThis.fetch
  let accessKey = 'old-access'
  let secretKey = 'old-secret'
  let resolveIndex = 0
  let releaseOldRequests: (() => void) | undefined
  let markOldRequestsStarted: (() => void) | undefined
  const oldRequestsGate = new Promise<void>((resolve) => { releaseOldRequests = resolve })
  const oldRequestsStarted = new Promise<void>((resolve) => { markOldRequestsStarted = resolve })
  const authorizations: string[] = []
  const fakeContext = {
    credentials: {
      resolve: async () => {
        const value = resolveIndex % 2 === 0 ? accessKey : secretKey
        resolveIndex += 1
        return { value }
      },
    },
  }
  try {
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const authorization = new Headers(init?.headers).get('authorization') ?? ''
      authorizations.push(authorization)
      if (authorization.includes('old-access')) {
        if (authorizations.filter((value) => value.includes('old-access')).length === 2) markOldRequestsStarted?.()
        await oldRequestsGate
      }
      const level = String(input).includes('Action=GetAFPUsage') ? '5h' : 'session'
      return new Response(JSON.stringify({ Result: { QuotaUsage: [{ Level: level, Percent: 10 }] } }), { status: 200 })
    }) as typeof fetch
    const service = new ArkCodingPlanService(fakeContext as never, {
      enabled: true,
      apiKeyEnv: 'ARK_CODING_PLAN_API_KEY',
      usageAccessKeyEnv: 'VOLC_ACCESS_KEY',
      usageSecretKeyEnv: 'VOLC_SECRET_KEY',
      usageTimeoutMs: 1000,
    })
    const oldRequest = service.dashboard()
    await oldRequestsStarted
    accessKey = 'new-access'
    secretKey = 'new-secret'
    const refreshedRequest = service.refreshUsage()
    releaseOldRequests?.()
    await oldRequest
    await refreshedRequest
    assert.equal(authorizations.length, 4)
    assert.equal(authorizations.slice(0, 2).every((value) => value.includes('old-access')), true)
    assert.equal(authorizations.slice(2).every((value) => value.includes('new-access')), true)
  } finally {
    releaseOldRequests?.()
    globalThis.fetch = originalFetch
  }
})

test('方舟用量服务：缓存命中与刷新失败降级', async () => {
  const originalFetch = globalThis.fetch
  let requests = 0
  const fakeContext = {
    credentials: {
      resolve: async () => ({ value: 'test-credential' }),
    },
  }
  try {
    globalThis.fetch = (async (input: string | URL | Request) => {
      requests += 1
      const url = String(input)
      const level = url.includes('Action=GetAFPUsage') ? '5h' : 'session'
      return new Response(JSON.stringify({ Result: { QuotaUsage: [{ Level: level, Percent: 10 }] } }), { status: 200 })
    }) as typeof fetch
    const service = new ArkCodingPlanService(fakeContext as never, {
      enabled: true,
      apiKeyEnv: 'ARK_CODING_PLAN_API_KEY',
      usageAccessKeyEnv: 'VOLC_ACCESS_KEY',
      usageSecretKeyEnv: 'VOLC_SECRET_KEY',
      usageTimeoutMs: 1000,
    })
    const first = await service.dashboard()
    const cached = await service.dashboard()
    assert.equal(requests, 2)
    assert.equal(cached.fetchedAt, first.fetchedAt)
    assert.equal(cached.stale, false)

    globalThis.fetch = (async () => {
      requests += 1
      throw new Error('模拟网络中断')
    }) as typeof fetch
    const stale = await service.refreshUsage()
    assert.equal(stale.stale, true)
    assert.equal(stale.fetchedAt, first.fetchedAt)
    assert.match(stale.warnings.at(-1) ?? '', /实时刷新失败/)
  } finally {
    globalThis.fetch = originalFetch
  }
})
