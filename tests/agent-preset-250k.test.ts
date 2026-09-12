/** 250k 压缩预设一键配置：模板契约、参数解析、创建与设默认行为测试。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  PRESET_COMPOSITION_YAML,
  PRESET_ID,
  RETAIN_TOKENS,
  THRESHOLD_RATIO,
} from '../src/agent-preset-250k-template.ts'
import {
  parsePresetParams,
  readAgentPreset250kStatus,
  resolvePresetRoot,
  setupAgentPreset250k,
  type AgentPreset250kDeps,
} from '../src/agent-preset-250k.ts'

/** 构造可指定 agent-presets 域内容的内存 settings 依赖。 */
function fakeDeps(options: { default?: string; updateError?: Error } = {}): AgentPreset250kDeps & { updates: Array<{ ns: string; patch: object }> } {
  const updates: Array<{ ns: string; patch: object }> = []
  return {
    updates,
    settings: {
      get: (ns: string) => {
        assert.equal(ns, 'agent-presets')
        return options.default === undefined ? undefined : { default: options.default }
      },
      update: async (ns: string, patch: object) => {
        if (options.updateError !== undefined) throw options.updateError
        updates.push({ ns, patch })
      },
    },
    agentPresets: {
      resolve: async (id: string) => ({ id }),
    },
  }
}

/** 构造隔离的临时 DSH_HOME，避免测试触碰真实用户目录。 */
function fakeHome(): string {
  return mkdtempSync(join(tmpdir(), 'dsh-devforge-preset250k-'))
}

test('模板契约：参数为目标值，且不含创作模式专属行', () => {
  assert.equal(PRESET_ID, 'cordis-250k')
  assert.match(PRESET_COMPOSITION_YAML, /thresholdRatio: 0\.25/)
  assert.match(PRESET_COMPOSITION_YAML, /retainTokens: 32768/)
  // 精简版不携带 compat 依赖的创作模式行：无绝对路径、任意机器可挂载
  //（断言按「组合行」匹配，避免头注释里的说明文字误伤）。
  assert.doesNotMatch(PRESET_COMPOSITION_YAML, /^-\s+id:\s*tool-cordis/m)
  assert.doesNotMatch(PRESET_COMPOSITION_YAML, /^-\s+id:\s*skill-filesystem/m)
  assert.doesNotMatch(PRESET_COMPOSITION_YAML, /^- id:\s*tool-cordis/m)
  assert.doesNotMatch(PRESET_COMPOSITION_YAML, /name: '\.\/cordis-tools\.compat/)
  // 平台差异必须由表达式处理，保证 Windows/Mac 同一份模板可用。
  assert.match(PRESET_COMPOSITION_YAML, /process\.platform === 'win32'/)
})

test('parsePresetParams：提取合法参数，缺失项返回 undefined', () => {
  assert.deepEqual(parsePresetParams(PRESET_COMPOSITION_YAML), { thresholdRatio: 0.25, retainTokens: 32768 })
  assert.deepEqual(parsePresetParams('rows: []'), { thresholdRatio: undefined, retainTokens: undefined })
})

test('resolvePresetRoot：显式参数优先，其次 DSH_HOME，最后 ~/.dsh', () => {
  assert.equal(resolvePresetRoot('/tmp/a'), join('/tmp/a', '.agent-presets'))
  const previous = process.env.DSH_HOME
  try {
    process.env.DSH_HOME = '/tmp/b'
    assert.equal(resolvePresetRoot(), join('/tmp/b', '.agent-presets'))
    delete process.env.DSH_HOME
    assert.match(resolvePresetRoot(), /\.agent-presets$/)
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
  }
})

test('setupAgentPreset250k：缺失时写入模板，状态转为就绪', async () => {
  const home = fakeHome()
  try {
    const deps = fakeDeps()
    const before = readAgentPreset250kStatus(deps, home)
    assert.equal(before.presetExists, false)
    assert.equal(before.paramsOk, false)

    const result = await setupAgentPreset250k(deps, { dshHome: home, setDefault: true })
    assert.equal(result.ok, true)
    assert.equal(result.presetExists, true)
    assert.equal(result.paramsOk, true)
    assert.equal(result.created.length, 2)
    assert.equal(result.defaultSwitched, true)
    assert.deepEqual(deps.updates, [{ ns: 'agent-presets', patch: { default: 'cordis-250k' } }])
    assert.match(readFileSync(result.presetPath, 'utf8'), /thresholdRatio: 0\.25/)
    assert.ok(existsSync(join(resolvePresetRoot(home), 'cordis-250k', 'preset.yml')))

    const after = readAgentPreset250kStatus(deps, home)
    assert.equal(after.isDefault, false) // fake get 未反映 update，仅验证读取路径
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('setupAgentPreset250k：已存在的预设文件绝不覆盖', async () => {
  const home = fakeHome()
  try {
    const presetDir = join(resolvePresetRoot(home), PRESET_ID)
    const { mkdirSync } = await import('node:fs')
    mkdirSync(presetDir, { recursive: true })
    const userFile = join(presetDir, 'agent.cordis.yml')
    writeFileSync(userFile, '# 用户自己的完整版预设\nthresholdRatio: 0.25\nretainTokens: 32768\n', 'utf8')

    const result = await setupAgentPreset250k(fakeDeps(), { dshHome: home })
    assert.equal(result.ok, true)
    assert.equal(result.created.length, 0)
    assert.match(readFileSync(userFile, 'utf8'), /用户自己的完整版预设/)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('setupAgentPreset250k：设默认失败与宿主解析异常进 warnings，不阻断就绪', async () => {
  const home = fakeHome()
  try {
    const deps: AgentPreset250kDeps = {
      settings: {
        get: () => undefined,
        update: async () => { throw new Error('settings 只读') },
      },
      agentPresets: {
        resolve: async () => ({ id: PRESET_ID, broken: '兼容模块过期' }),
      },
    }
    const result = await setupAgentPreset250k(deps, { dshHome: home, setDefault: true })
    assert.equal(result.ok, true)
    assert.equal(result.paramsOk, true)
    assert.equal(result.defaultSwitched, false)
    assert.equal(result.warnings.length, 2)
    assert.match(result.warnings[0], /settings 只读/)
    assert.match(result.warnings[1], /兼容模块过期/)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('readAgentPreset250kStatus：按 settings 当前默认判定 isDefault', async () => {
  const home = fakeHome()
  try {
    await setupAgentPreset250k(fakeDeps(), { dshHome: home })
    const isDefault = readAgentPreset250kStatus(fakeDeps({ default: PRESET_ID }), home)
    assert.equal(isDefault.defaultPreset, PRESET_ID)
    assert.equal(isDefault.isDefault, true)

    const notDefault = readAgentPreset250kStatus(fakeDeps({ default: 'cordis' }), home)
    assert.equal(notDefault.defaultPreset, 'cordis')
    assert.equal(notDefault.isDefault, false)

    const unset = readAgentPreset250kStatus(fakeDeps(), home)
    assert.equal(unset.defaultPreset, undefined)
    assert.equal(unset.isDefault, false)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})
