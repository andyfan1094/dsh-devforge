/**
 * 硅基流动单测：provider 合并满足 llm-pi-ai 目录外路由校验（api/baseURL/容量兜底）。
 *
 * 背景（0.16.3 教训）：merge 只写 models 时，llm-pi-ai 校验器会以
 * "model \"…\" needs an api" 拒绝整条 provider 写入，导致模型目录永远停在兜底清单。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// store.db 兜底写入会打开真实默认路径，测试一律隔离到临时 HOME。
process.env.DSH_HOME = join(tmpdir(), 'dsh-devforge-test-' + String(process.pid))

const { curateLatestChatModels, mergeSiliconFlowProvider, parseModelIds, SILICONFLOW_PROVIDER_ID } = await import('../src/siliconflow/service.ts')

test('provider 合并：目录外路由必须带 api 与 baseURL，容量走 provider 兜底', () => {
  const merged = mergeSiliconFlowProvider(undefined, 'SILICONFLOW_API_KEY', ['deepseek-ai/DeepSeek-V4-Flash', 'BAAI/bge-m3'])
  assert.equal(merged.api, 'openai-completions')
  assert.equal(merged.baseURL, 'https://api.siliconflow.cn/v1')
  assert.equal(merged.apiKeyEnv, 'SILICONFLOW_API_KEY')
  assert.equal(merged.displayName, '硅基流动')
  assert.ok(Number(merged.defaultContextWindow) > 0)
  assert.ok(Number(merged.defaultMaxTokens) > 0)
  assert.deepEqual(merged.models, [
    { id: 'deepseek-ai/DeepSeek-V4-Flash', name: 'deepseek-ai/DeepSeek-V4-Flash' },
    { id: 'BAAI/bge-m3', name: 'BAAI/bge-m3' },
  ])
})

test('provider 合并：保留用户已有模型与字段，追加新模型不重复', () => {
  const existing = { apiKeyEnv: 'MY_KEY', displayName: '我的硅基', api: 'openai-completions', models: [{ id: 'Qwen/Qwen3-32B', contextWindow: 40_960, maxTokens: 16_384 }] }
  const merged = mergeSiliconFlowProvider(existing, 'SILICONFLOW_API_KEY', ['Qwen/Qwen3-32B', 'deepseek-ai/DeepSeek-V4-Flash'])
  assert.equal(merged.apiKeyEnv, 'MY_KEY')
  assert.equal(merged.displayName, '我的硅基')
  assert.equal(merged.api, 'openai-completions')
  const models = merged.models as Array<Record<string, unknown>>
  assert.equal(models.length, 2)
  assert.equal(models[0]?.contextWindow, 40_960)
  assert.deepEqual(models[1], { id: 'deepseek-ai/DeepSeek-V4-Flash', name: 'deepseek-ai/DeepSeek-V4-Flash' })
})

test('模型清单解析：兼容 data 数组、裸数组并去重空值', () => {
  assert.deepEqual(parseModelIds({ data: [{ id: 'a' }, { id: 'a' }, { id: '' }, null] }), ['a'])
  assert.deepEqual(parseModelIds(['b', 'b', '']), ['b'])
  assert.deepEqual(parseModelIds(null), [])
  assert.equal(SILICONFLOW_PROVIDER_ID, 'siliconflow')
})

test('模型精选：每系列只保留最高版本，剔除非对话与 Pro/LoRA 变体', () => {
  const curated = curateLatestChatModels([
    'zai-org/GLM-5.2', 'Pro/zai-org/GLM-5.1', 'zai-org/GLM-4.5V', 'zai-org/GLM-4.5-Air', 'THUDM/GLM-4-32B-0414', 'THUDM/GLM-Z1-9B-0414',
    'deepseek-ai/DeepSeek-V4-Flash', 'deepseek-ai/DeepSeek-V4-Pro', 'deepseek-ai/DeepSeek-V3.2', 'Pro/deepseek-ai/DeepSeek-V3.2', 'deepseek-ai/DeepSeek-R1',
    'Qwen/Qwen3.6-35B-A3B', 'Qwen/Qwen3.6-27B', 'Qwen/Qwen3.5-397B-A17B', 'Qwen/Qwen3-32B', 'Qwen/Qwen2.5-72B-Instruct', 'LoRA/Qwen/Qwen2.5-7B-Instruct',
    'Qwen/Qwen3-VL-32B-Instruct', 'Qwen/Qwen3-VL-32B-Thinking', 'Qwen/Qwen3-VL-Embedding-8B', 'Qwen/Qwen3-Omni-30B-A3B-Instruct', 'Qwen/Qwen3-Omni-30B-A3B-Captioner', 'Qwen/Qwen3-Coder-30B-A3B-Instruct',
    'moonshotai/Kimi-K2.7-Code', 'Pro/moonshotai/Kimi-K2.6', 'MiniMaxAI/MiniMax-M2.5', 'meituan-longcat/LongCat-2.0', 'nex-agi/Nex-N2-Pro', 'stepfun-ai/Step-3.5-Flash',
    'inclusionAI/Ling-flash-2.0', 'inclusionAI/Ling-mini-2.0', 'tencent/Hunyuan-MT-7B', 'tencent/Hunyuan-A13B-Instruct', 'ByteDance-Seed/Seed-OSS-36B-Instruct',
    'Tongyi-MAI/Z-Image-Turbo', 'Wan-AI/Wan2.2-T2V-A14B', 'BAAI/bge-m3', 'Pro/BAAI/bge-m3', 'XingChenAGI/XingChenASR-V3.2', 'deepseek-ai/DeepSeek-OCR', 'FunAudioLLM/CosyVoice2-0.5B',
  ])
  assert.deepEqual(curated, [
    'ByteDance-Seed/Seed-OSS-36B-Instruct',
    'MiniMaxAI/MiniMax-M2.5',
    'Qwen/Qwen3-Coder-30B-A3B-Instruct',
    'Qwen/Qwen3-Omni-30B-A3B-Instruct',
    'Qwen/Qwen3-VL-32B-Instruct',
    'Qwen/Qwen3-VL-32B-Thinking',
    'Qwen/Qwen3.6-27B',
    'Qwen/Qwen3.6-35B-A3B',
    'deepseek-ai/DeepSeek-V4-Flash',
    'deepseek-ai/DeepSeek-V4-Pro',
    'inclusionAI/Ling-flash-2.0',
    'inclusionAI/Ling-mini-2.0',
    'meituan-longcat/LongCat-2.0',
    'moonshotai/Kimi-K2.7-Code',
    'nex-agi/Nex-N2-Pro',
    'stepfun-ai/Step-3.5-Flash',
    'tencent/Hunyuan-A13B-Instruct',
    'tencent/Hunyuan-MT-7B',
    'zai-org/GLM-4.5V',
    'zai-org/GLM-5.2',
  ])
})

