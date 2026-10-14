/**
 * 官网生图持久化回归：宿主会为缺失配置填入 { enabled: false, model: '' }。
 * 官网开关由登录/登出及同步接口写入 store.db；已保存值必须优先于宿主默认值，
 * 否则重启会错误回落个人中转。其他中转配置仍保持原来的字段优先级。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// 插件模块可能打开默认 store.db，测试一律隔离到临时 HOME（须在 import 之前生效）。
process.env.DSH_HOME = join(tmpdir(), 'dsh-devforge-cfg-test-' + String(process.pid))

const { mergeOpenAiConfig } = await import('../src/openai/config-merge.ts')

test('openai 兜底：插件配置段没有 openai 时，官网生图开关必须从 store.db 副本恢复', () => {
  const merged = mergeOpenAiConfig(undefined, { siteImage: { enabled: true, model: 'gpt-image-2' } })
  assert.equal(merged.siteImage?.enabled, true, '面板里打开的官网生图不能在重启后丢失')
  assert.equal(merged.siteImage?.model, 'gpt-image-2', '生图模型名同样要恢复')
})

test('官网生图：宿主补出的关闭默认对象不能覆盖已保存的官网开关', () => {
  const merged = mergeOpenAiConfig(
    { siteImage: { enabled: false, model: '' }, apiKeyEnv: 'MY_HOT_KEY' },
    { siteImage: { enabled: true, model: 'gpt-image-2' }, apiKeyEnv: 'OPENAI_GATEWAY_API_KEY' },
  )
  assert.deepEqual(merged.siteImage, { enabled: true, model: 'gpt-image-2' })
  assert.equal(merged.apiKeyEnv, 'MY_HOT_KEY', '不改变个人中转其他配置的优先级')
})

test('官网生图：登出保存的 false 必须覆盖宿主残留 true，不能用逻辑或重新开启', () => {
  const merged = mergeOpenAiConfig(
    { siteImage: { enabled: true, model: '旧模型' } },
    { siteImage: { enabled: false, model: 'gpt-image-2' } },
  )
  assert.deepEqual(merged.siteImage, { enabled: false, model: 'gpt-image-2' })
})

test('官网生图：未保存过官网开关时兼容已有配置段', () => {
  const merged = mergeOpenAiConfig({ siteImage: { enabled: true, model: 'gpt-image-2' } }, {})
  assert.deepEqual(merged.siteImage, { enabled: true, model: 'gpt-image-2' })
})

test('openai 兜底：两边都没有 siteImage 时不写入该字段（服务按未启用处理）', () => {
  const merged = mergeOpenAiConfig(undefined, {})
  assert.equal(merged.siteImage, undefined)
  assert.equal(merged.enabled, true, 'openai 能力默认开')
  assert.equal(merged.apiKeyEnv, 'OPENAI_GATEWAY_API_KEY')
  assert.equal(merged.timeoutMs, 300000)
})

test('openai 兜底：面板快照里的 null 字段按缺省处理，不覆盖 store.db 副本', () => {
  const merged = mergeOpenAiConfig(
    { siteImage: null, imageModel: null, endpoints: null },
    {
      siteImage: { enabled: true, model: 'gpt-image-2' },
      imageModel: 'gpt-image-2',
      endpoints: [{ id: 'default', name: '主端点', baseURL: 'https://example.com', apiKeyEnv: 'K' }],
    },
  )
  assert.equal(merged.siteImage?.enabled, true)
  assert.equal(merged.imageModel, 'gpt-image-2')
  assert.equal(merged.endpoints?.length, 1)
})

test('openai 兜底：空端点数组不覆盖 store.db 副本，非空端点数组整体覆盖', () => {
  const stored = { endpoints: [{ id: 'default', name: '主端点', baseURL: 'https://example.com', apiKeyEnv: 'K' }] }
  assert.equal(mergeOpenAiConfig({ endpoints: [] }, stored).endpoints?.length, 1)
  const replaced = mergeOpenAiConfig({ endpoints: [{ id: 'x', name: 'x', baseURL: 'https://a.com', apiKeyEnv: 'K' }] }, stored)
  assert.equal(replaced.endpoints?.length, 1)
  assert.equal(replaced.endpoints?.[0].id, 'x')
})
