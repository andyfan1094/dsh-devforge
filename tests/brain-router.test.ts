/**
 * 主脑路由核心判定单元测试 —— 覆盖改道决策的全部分支与防御边界。
 * 运行：node --experimental-strip-types --test tests/brain-router.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { BRAIN_ROUTER_DEFAULTS, type BrainRouterSettings } from '../src/brain-router/protocol.ts'
import { compileMainModelPattern, isMainModelPatternValid, mergeRoutedAgentOptions, readParentRoute, resolveBrainRoute, sanitizeBrainRouterInput } from '../src/brain-router/core.ts'

/** 构造测试设置：在默认值上覆盖指定字段。 */
function settings(overrides: Partial<BrainRouterSettings> = {}): BrainRouterSettings {
  return { ...BRAIN_ROUTER_DEFAULTS, enabled: true, ...overrides }
}

test('未启用或工人模型未配置时不改道', () => {
  const base = { providerName: 'spawn', parentRoute: { provider: 'openai-gateway', model: 'gpt-5.6' } }
  assert.equal(resolveBrainRoute(settings({ enabled: false }), base), undefined)
  assert.equal(resolveBrainRoute(settings({ workerProvider: '' }), base), undefined)
  assert.equal(resolveBrainRoute(settings({ workerModel: '' }), base), undefined)
  // 空白串视同未配置。
  assert.equal(resolveBrainRoute(settings({ workerModel: '  ' }), base), undefined)
})

test('排除清单命中时不改道（fork 必须保持跟随主模型）', () => {
  const decision = resolveBrainRoute(settings(), { providerName: 'fork', parentRoute: { provider: 'openai-gateway', model: 'gpt-5.6' } })
  assert.equal(decision, undefined)
  // spawn 不在默认排除清单内，正常改道。
  assert.notEqual(resolveBrainRoute(settings(), { providerName: 'spawn', parentRoute: { provider: 'openai-gateway', model: 'gpt-5.6' } }), undefined)
})

test('主模型路由缺失或未命中匹配时不改道', () => {
  assert.equal(resolveBrainRoute(settings(), { providerName: 'spawn' }), undefined)
  // GLM 主模型：默认 gpt 模式不命中。
  const glm = resolveBrainRoute(settings(), { providerName: 'spawn', parentRoute: { provider: 'zai-coding-cn', model: 'glm-5.3-flash' } })
  assert.equal(glm, undefined)
  // 大小写不敏感。
  const upper = resolveBrainRoute(settings(), { providerName: 'spawn', parentRoute: { provider: 'openai-gateway', model: 'GPT-5.6' } })
  assert.notEqual(upper, undefined)
})

test('命中默认 gpt 模式时改道工人模型并带上档位语义', () => {
  const decision = resolveBrainRoute(settings(), { providerName: 'spawn', parentRoute: { provider: 'openai-gateway', model: 'gpt-5.6' } })
  assert.deepEqual(decision, { provider: 'zai-coding-cn', model: 'glm-5.3-flash' })
  // 配置了工人档位时随决策下发。
  const withEffort = resolveBrainRoute(settings({ workerReasoningEffort: 'low' }), { providerName: 'spawn', parentRoute: { provider: 'openai-gateway', model: 'gpt-5.6' } })
  assert.deepEqual(withEffort, { provider: 'zai-coding-cn', model: 'glm-5.3-flash', reasoningEffort: 'low' })
})

test('主模型显式指定子模型时默认尊重、允许强制覆盖', () => {
  const explicit = { providerName: 'spawn', parentRoute: { provider: 'openai-gateway', model: 'gpt-5.6' }, requestedAgentOptions: { provider: 'zai-coding-cn', model: 'glm-5.3' } }
  assert.equal(resolveBrainRoute(settings(), explicit), undefined)
  const forced = resolveBrainRoute(settings({ overrideExplicit: true }), explicit)
  assert.deepEqual(forced, { provider: 'zai-coding-cn', model: 'glm-5.3-flash' })
  // 只带档位不带路由不算显式选择：仍改道。
  const effortOnly = resolveBrainRoute(settings(), { providerName: 'spawn', parentRoute: { provider: 'openai-gateway', model: 'gpt-5.6' }, requestedAgentOptions: { reasoningEffort: 'high' } })
  assert.notEqual(effortOnly, undefined)
})

test('非法正则安全降级为永不命中且不抛异常', () => {
  const broken = settings({ mainModelPattern: '([unclosed' })
  assert.equal(resolveBrainRoute(broken, { providerName: 'spawn', parentRoute: { provider: 'openai-gateway', model: 'gpt-5.6' } }), undefined)
  assert.equal(isMainModelPatternValid('([unclosed'), false)
  assert.equal(isMainModelPatternValid('  '), false)
  assert.equal(isMainModelPatternValid('^gpt'), true)
})

test('mergeRoutedAgentOptions 换路由丢弃旧档位并按需写入工人档位', () => {
  const merged = mergeRoutedAgentOptions({ reasoningEffort: 'max', maxTokens: 4096 }, { provider: 'zai-coding-cn', model: 'glm-5.3-flash' })
  assert.equal(merged.reasoningEffort, undefined)
  assert.equal(merged.maxTokens, 4096)
  assert.equal(merged.provider, 'zai-coding-cn')
  assert.equal(merged.model, 'glm-5.3-flash')
  const withEffort = mergeRoutedAgentOptions({ reasoningEffort: 'max' }, { provider: 'zai-coding-cn', model: 'glm-5.3-flash', reasoningEffort: 'low' })
  assert.equal(withEffort.reasoningEffort, 'low')
  // 空输入也能产出完整路由。
  const fromEmpty = mergeRoutedAgentOptions(undefined, { provider: 'p', model: 'm' })
  assert.deepEqual(fromEmpty, { provider: 'p', model: 'm' })
})

test('readParentRoute 优先请求头、回落创建 options、异常时安全返回', () => {
  // 顺序一：请求头。
  const viaHeader = readParentRoute({ session: { requestHeader: () => ({ config: { provider: 'openai-gateway', model: 'gpt-5.6' } }) }, options: { provider: 'zai-coding-cn', model: 'glm-5.3' } })
  assert.deepEqual(viaHeader, { provider: 'openai-gateway', model: 'gpt-5.6' })
  // 顺序二：无请求头时用创建 options。
  const viaOptions = readParentRoute({ options: { provider: 'zai-coding-cn', model: 'glm-5.3' } })
  assert.deepEqual(viaOptions, { provider: 'zai-coding-cn', model: 'glm-5.3' })
  // 防御：请求头抛异常时安全回落创建 options（p/m 应读到）。
  assert.deepEqual(readParentRoute({ session: { requestHeader: () => { throw new Error('会话尚未发起请求') } }, options: { provider: 'p', model: 'm' } }), { provider: 'p', model: 'm' })
  // 防御：空串字段、非对象输入、两者皆无时返回 undefined。
  assert.equal(readParentRoute({ session: { requestHeader: () => ({ config: { provider: '', model: 'm' } }) } }), undefined)
  assert.equal(readParentRoute(null), undefined)
  assert.equal(readParentRoute('agent'), undefined)
  assert.equal(readParentRoute({ options: {} }), undefined)
})

test('sanitizeBrainRouterInput 白名单规整与跨字段校验', () => {
  // 合法输入：全字段透传。
  const good = sanitizeBrainRouterInput({ enabled: true, mainModelPattern: '^gpt', workerProvider: ' p ', workerModel: 'm', workerReasoningEffort: ' low ', excludeProviders: ['fork', ''], overrideExplicit: false })
  assert.equal(good.ok, true)
  if (good.ok) {
    assert.equal(good.value.workerProvider, 'p')
    assert.equal(good.value.workerReasoningEffort, 'low')
    assert.deepEqual(good.value.excludeProviders, ['fork'])
  }
  // 开启但未配工人模型：拒绝。
  const noWorker = sanitizeBrainRouterInput({ enabled: true, workerProvider: '', workerModel: '' })
  assert.equal(noWorker.ok, false)
  if (!noWorker.ok) assert.match(noWorker.error, /工人模型/)
  // 非法正则：拒绝。
  const badPattern = sanitizeBrainRouterInput({ mainModelPattern: '([x' })
  assert.equal(badPattern.ok, false)
  if (!badPattern.ok) assert.match(badPattern.error, /正则/)
  // fork 被用户手动移除：服务端强制加回。
  const noFork = sanitizeBrainRouterInput({ excludeProviders: ['spawn'] })
  assert.equal(noFork.ok, true)
  if (noFork.ok) assert.ok(noFork.value.excludeProviders.includes('fork'))
  // 类型错误逐字段拒绝。
  assert.equal(sanitizeBrainRouterInput('x').ok, false)
  assert.equal(sanitizeBrainRouterInput({ enabled: 'yes' }).ok, false)
  assert.equal(sanitizeBrainRouterInput({ excludeProviders: 'fork' }).ok, false)
  // 缺省字段回落默认值（允许全量替换的局部省略）。
  const defaults = sanitizeBrainRouterInput({})
  assert.equal(defaults.ok, true)
  if (defaults.ok) assert.deepEqual(defaults.value, { ...BRAIN_ROUTER_DEFAULTS })
})

test('compileMainModelPattern 对同一 pattern 复用编译缓存', () => {
  const first = compileMainModelPattern('gpt')
  const second = compileMainModelPattern('gpt')
  assert.equal(first, second)
  // pattern 变更后重建。
  const other = compileMainModelPattern('^gpt')
  assert.notEqual(first, other)
})
