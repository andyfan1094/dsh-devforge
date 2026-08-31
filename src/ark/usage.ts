/** 火山方舟套餐用量客户端：OpenAPI V4 签名、请求与响应规整。 */
import { createHash, createHmac } from 'node:crypto'
import type { ArkPlanUsage, ArkUsageProduct } from './protocol.ts'

const VOLC_OPEN_API_HOST = 'open.volcengineapi.com'
const VOLC_OPEN_API_VERSION = '2024-01-01'

/** 火山 OpenAPI 请求的最小可测试视图。 */
export interface VolcOpenApiRequest {
  url: string
  headers: Record<string, string>
  body: string
}

/** 套餐用量请求参数。 */
export interface ArkUsageRequest {
  accessKey: string
  secretKey: string
  region: string
  timeoutMs: number
  signal?: AbortSignal
  fetcher?: typeof fetch
}

/** 把字符串编码成火山签名要求的 RFC 3986 形式。 */
function uriEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) => '%' + character.charCodeAt(0).toString(16).toUpperCase())
}

/** 计算 SHA-256 十六进制摘要。 */
function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

/** 使用上一层二进制密钥计算下一层 HMAC。 */
function hmac(key: string | Buffer, value: string): Buffer {
  return createHmac('sha256', key).update(value, 'utf8').digest()
}

/**
 * 生成火山方舟 OpenAPI V4 请求。
 *
 * 该函数不执行网络请求，便于使用固定时间验证 canonical request 和签名稳定性。
 */
export function buildVolcOpenApiRequest(action: string, region: string, accessKey: string, secretKey: string, now = new Date()): VolcOpenApiRequest {
  const queryPairs: Array<[string, string]> = [
    ['Action', action],
    ['Region', region],
    ['Version', VOLC_OPEN_API_VERSION],
  ]
  queryPairs.sort((left, right) => left[0].localeCompare(right[0]))
  const canonicalQuery = queryPairs.map(([key, value]) => uriEncode(key) + '=' + uriEncode(value)).join('&')
  const xDate = now.toISOString().replace(/[-:]/g, '').replace(/[.][0-9]{3}Z$/, 'Z')
  const shortDate = xDate.slice(0, 8)
  const body = ''
  const contentHash = sha256Hex(body)
  const contentType = 'application/json; charset=utf-8'
  const signedHeaders = 'content-type;host;x-content-sha256;x-date'
  const canonicalHeaders = 'content-type:' + contentType + '\n'
    + 'host:' + VOLC_OPEN_API_HOST + '\n'
    + 'x-content-sha256:' + contentHash + '\n'
    + 'x-date:' + xDate + '\n'
  const canonicalRequest = 'POST\n/\n' + canonicalQuery + '\n' + canonicalHeaders + '\n' + signedHeaders + '\n' + contentHash
  const scope = shortDate + '/' + region + '/ark/request'
  const stringToSign = 'HMAC-SHA256\n' + xDate + '\n' + scope + '\n' + sha256Hex(canonicalRequest)
  const dateKey = hmac(secretKey, shortDate)
  const regionKey = hmac(dateKey, region)
  const serviceKey = hmac(regionKey, 'ark')
  const signingKey = hmac(serviceKey, 'request')
  const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex')
  const authorization = 'HMAC-SHA256 Credential=' + accessKey + '/' + scope
    + ', SignedHeaders=' + signedHeaders
    + ', Signature=' + signature

  return {
    url: 'https://' + VOLC_OPEN_API_HOST + '/?' + canonicalQuery,
    headers: {
      'X-Date': xDate,
      'X-Content-Sha256': contentHash,
      'Content-Type': contentType,
      Authorization: authorization,
    },
    body,
  }
}

/** 把外部数值规整为有限数，非法值返回 undefined。 */
function finiteNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string' || value.trim() === '') return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

/** 把秒、毫秒或 RFC3339 时间统一成毫秒时间戳。 */
function normalizeTimestamp(value: unknown): number | undefined {
  const numeric = finiteNumber(value)
  if (numeric !== undefined && numeric > 0) return numeric < 1_000_000_000_000 ? numeric * 1000 : numeric
  if (typeof value !== 'string') return undefined
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

/** 只保留上游可安全展示的短错误，不回传请求头或响应全文。 */
function safeUpstreamError(code: unknown, message: unknown): string {
  const safeCode = typeof code === 'string' ? code.slice(0, 80) : 'UpstreamError'
  const safeMessage = typeof message === 'string' ? message.slice(0, 240) : '火山方舟用量接口返回错误。'
  return safeCode + ': ' + safeMessage
}

/** 将单个套餐响应规整为稳定的 Host/Client 契约。 */
export function parseArkUsageResponse(product: ArkUsageProduct, status: number, text: string): ArkPlanUsage {
  let payload: unknown
  try {
    payload = JSON.parse(text)
  } catch {
    return { product, subscribed: false, periods: [], error: '火山方舟用量响应不是合法 JSON。' }
  }
  if (payload === null || typeof payload !== 'object') {
    return { product, subscribed: false, periods: [], error: '火山方舟用量响应格式无效。' }
  }

  const root = payload as Record<string, unknown>
  const metadata = root.ResponseMetadata
  if (metadata !== null && typeof metadata === 'object') {
    const upstreamError = (metadata as Record<string, unknown>).Error
    if (upstreamError !== null && typeof upstreamError === 'object') {
      const errorRecord = upstreamError as Record<string, unknown>
      return { product, subscribed: false, periods: [], error: safeUpstreamError(errorRecord.Code, errorRecord.Message) }
    }
  }
  if (status < 200 || status >= 300) {
    return { product, subscribed: false, periods: [], error: '火山方舟用量接口返回 HTTP ' + status + '。' }
  }

  const resultValue = root.Result
  if (product === 'agent-plan' && resultValue === null) return { product, subscribed: false, periods: [] }
  const result = resultValue !== null && typeof resultValue === 'object' ? resultValue as Record<string, unknown> : root
  const periods: ArkPlanUsage['periods'] = []

  // Agent Plan 真实 OpenAPI 使用三个具名 AFP 桶，不返回 QuotaUsage 数组。
  if (product === 'agent-plan') {
    const buckets: Array<[string, string]> = [
      ['AFPFiveHour', '5h'],
      ['AFPWeekly', 'weekly'],
      ['AFPMonthly', 'monthly'],
    ]
    let recognized = false
    for (const [field, level] of buckets) {
      const bucket = result[field]
      if (bucket === null || typeof bucket !== 'object') continue
      recognized = true
      const row = bucket as Record<string, unknown>
      const used = finiteNumber(row.Used)
      const total = finiteNumber(row.Quota)
      const usedPercent = used !== undefined && total !== undefined && total > 0 ? used / total * 100 : undefined
      periods.push({
        level,
        used,
        total,
        usedPercent: usedPercent === undefined ? undefined : Math.max(0, Math.min(100, usedPercent)),
        resetAt: normalizeTimestamp(row.ResetTime),
      })
    }
    if (recognized) return { product, subscribed: true, periods }
  }

  let rawPeriods: unknown[] | undefined
  if (Array.isArray(result.QuotaUsage)) rawPeriods = result.QuotaUsage
  else if (Array.isArray(result.Usages)) rawPeriods = result.Usages
  else if (Array.isArray(result.Details)) rawPeriods = result.Details
  if (rawPeriods === undefined) {
    // Coding Plan 未订阅时只返回 Status/UpdateTimestamp，QuotaUsage 会被省略。
    if (product === 'coding-plan' && ('Status' in result || 'UpdateTimestamp' in result)) return { product, subscribed: false, periods: [] }
    return { product, subscribed: false, periods: [], error: '火山方舟用量响应缺少可识别的额度结构。' }
  }
  for (const item of rawPeriods) {
    if (item === null || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    const rawLevel = row.Level ?? row.Type ?? row.Period ?? row.Label ?? row.Window
    if (typeof rawLevel !== 'string' || rawLevel === '' || rawLevel === 'daily') continue
    const used = finiteNumber(row.Used)
    const total = finiteNumber(row.Total ?? row.Quota)
    let usedPercent = finiteNumber(row.Percent ?? row.UsedPercent ?? row.UsagePercent)
    if (usedPercent === undefined && used !== undefined && total !== undefined && total > 0) usedPercent = used / total * 100
    periods.push({
      level: rawLevel,
      used,
      total,
      usedPercent: usedPercent === undefined ? undefined : Math.max(0, Math.min(100, usedPercent)),
      resetAt: normalizeTimestamp(row.ResetTime ?? row.ResetTimestamp),
    })
  }
  const order = ['5h', 'session', 'weekly', 'monthly']
  periods.sort((left, right) => {
    const leftIndex = order.indexOf(left.level)
    const rightIndex = order.indexOf(right.level)
    return (leftIndex === -1 ? order.length : leftIndex) - (rightIndex === -1 ? order.length : rightIndex)
  })
  return { product, subscribed: periods.length > 0, periods }
}

/** 调用一个套餐用量 Action；原始凭据只进入签名过程，不进入返回值。 */
async function callUsageAction(action: string, product: ArkUsageProduct, request: ArkUsageRequest, signal: AbortSignal): Promise<ArkPlanUsage> {
  const signed = buildVolcOpenApiRequest(action, request.region, request.accessKey, request.secretKey)
  const fetcher = request.fetcher ?? fetch
  try {
    const response = await fetcher(signed.url, {
      method: 'POST',
      headers: signed.headers,
      body: signed.body,
      signal,
    })
    const text = await response.text()
    return parseArkUsageResponse(product, response.status, text)
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 240) : '未知网络错误'
    return { product, subscribed: false, periods: [], error: '用量请求失败：' + message }
  }
}

/** 并发读取 Coding Plan 与 Agent Plan，单套餐失败不会遮蔽另一套餐。 */
export async function fetchArkPlanUsage(request: ArkUsageRequest): Promise<ArkPlanUsage[]> {
  const controller = new AbortController()
  const abortFromCaller = (): void => controller.abort()
  if (request.signal?.aborted === true) controller.abort()
  else request.signal?.addEventListener('abort', abortFromCaller, { once: true })
  const timer = setTimeout(() => controller.abort(), request.timeoutMs)
  try {
    return await Promise.all([
      callUsageAction('GetCodingPlanUsage', 'coding-plan', request, controller.signal),
      callUsageAction('GetAFPUsage', 'agent-plan', request, controller.signal),
    ])
  } finally {
    clearTimeout(timer)
    request.signal?.removeEventListener('abort', abortFromCaller)
  }
}
