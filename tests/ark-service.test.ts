/** 火山方舟 Coding Plan：Provider 合并与受管凭据写入的无网络单测。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listCredentialRefs, setCredential } from '../src/credentials-writer.ts'
import { ARK_DEFAULT_MODELS, ARK_PLAN_BASE_URL, mergeArkProvider } from '../src/ark/service.ts'

test('方舟 Provider 合并：固定 Plan Base URL 并保留用户已有字段', () => {
  const merged = mergeArkProvider({
    apiKeyEnv: 'MY_ARK_KEY',
    displayName: '自定义名称',
    models: [{ id: 'custom-model', name: 'Custom' }],
    headers: { 'x-test': 'keep' },
  }, 'ARK_CODING_PLAN_API_KEY')
  assert.equal(merged.apiKeyEnv, 'MY_ARK_KEY')
  assert.equal(merged.displayName, '自定义名称')
  assert.equal(merged.baseURL, ARK_PLAN_BASE_URL)
  assert.equal(merged.api, 'openai-completions')
  assert.deepEqual(merged.headers, { 'x-test': 'keep' })
  const ids = (merged.models as Array<{ id: string }>).map((model) => model.id)
  assert.deepEqual(ids, ['custom-model', ...ARK_DEFAULT_MODELS.map((model) => model.id)])
})

test('方舟 Agent Plan 模型池：覆盖控制台全部文本模型与自动路由', () => {
  const ids = ARK_DEFAULT_MODELS.map((model) => model.id)
  assert.deepEqual(ids, [
    'auto',
    'doubao-seed-evolving',
    'doubao-seed-2.1-turbo',
    'doubao-seed-2.0-lite',
    'doubao-seed-2.0-mini',
    'glm-5.3-flash',
    'glm-5.3',
    'deepseek-v4-pro',
    'deepseek-v4-flash',
    'kimi-k3',
    'minimax-m3',
    'glm-5.2',
    'kimi-k2.7-code',
    'ark-code-latest',
  ])
})

test('方舟 Provider 合并：为旧模型补推理档位并保留显式覆盖', () => {
  const merged = mergeArkProvider({
    models: [
      { id: 'glm-5.3', name: '旧 GLM 配置' },
      { id: 'deepseek-v4-pro', reasoningEfforts: false },
      { id: 'kimi-k2.7-code', name: '旧 Kimi 配置', compat: { supportsDeveloperRole: false } },
    ],
  }, 'ARK_CODING_PLAN_API_KEY')
  const models = merged.models as Array<Record<string, unknown>>
  const glm = models.find((model) => model.id === 'glm-5.3')
  const deepseek = models.find((model) => model.id === 'deepseek-v4-pro')
  const kimi = models.find((model) => model.id === 'kimi-k2.7-code')
  assert.deepEqual(glm?.reasoningEfforts, { low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' })
  assert.equal(deepseek?.reasoningEfforts, false)
  assert.deepEqual(kimi?.reasoningEfforts, { off: null, high: 'high' })
  assert.deepEqual(kimi?.compat, { thinkingFormat: 'qwen', supportsReasoningEffort: false, supportsDeveloperRole: false })
})

test('受管凭据写入：upsert ref 时保留其它已有 refs', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-devforge-credential-'))
  const file = join(dir, '.credentials.yaml')
  try {
    await writeFile(file, 'version: 1\nrefs:\n    EXISTING_KEY: before\n    OTHER_KEY: keep\n')
    const result = await setCredential('ARK_CODING_PLAN_API_KEY', 'test-ark-value', file)
    assert.deepEqual(result, { created: false, updated: true })
    const first = await readFile(file, 'utf8')
    assert.match(first, /EXISTING_KEY: before/)
    assert.match(first, /OTHER_KEY: keep/)
    assert.match(first, /ARK_CODING_PLAN_API_KEY: test-ark-value/)
    assert.deepEqual((await listCredentialRefs(file)).sort(), ['ARK_CODING_PLAN_API_KEY', 'EXISTING_KEY', 'OTHER_KEY'])

    await setCredential('ARK_CODING_PLAN_API_KEY', 'replaced', file)
    const second = await readFile(file, 'utf8')
    assert.equal((second.match(/ARK_CODING_PLAN_API_KEY:/g) ?? []).length, 1)
    assert.match(second, /ARK_CODING_PLAN_API_KEY: replaced/)
    await assert.rejects(setCredential('bad-key', 'x', file), /凭据引用名格式无效/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
