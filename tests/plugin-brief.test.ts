/** 已安装插件功能总览单测：Loader 收集、临时目录过滤、包描述读取与总览渲染。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import {
  collectLoaderEntries,
  createPackageReader,
  isCoreModule,
  isTempModule,
  renderPluginBrief,
  PLUGIN_BRIEF_SECTION_NAME,
  PLUGIN_BRIEF_SECTION_ORDER,
  type LoaderEntryLite,
} from '../src/plugin-brief.ts'

test('isTempModule：识别 npm 临时安装目录，不影响正常插件名', () => {
  assert.equal(isTempModule('dsh-devforge_4354_d187543f'), true)
  assert.equal(isTempModule('dsh-devforge'), false)
  assert.equal(isTempModule('dsh-mnemon'), false)
})

test('isCoreModule：官方 scope 判定', () => {
  assert.equal(isCoreModule('@deepseek-ai/dsh-agent'), true)
  assert.equal(isCoreModule('dsh-devforge'), false)
})

test('collectLoaderEntries：跳过分组与临时目录，disabled 取反，异常降级空表', () => {
  const loader = {
    entries: () => [
      { options: { name: 'group-a', group: true } },
      { options: { name: 'dsh-devforge' }, disabled: false },
      { options: { name: 'dsh-old-plugin' }, disabled: true },
      { options: { name: 'dsh-devforge_1_abcdef' } },
      { options: {} },
      null,
      'junk',
    ],
  }
  const entries = collectLoaderEntries(loader)
  assert.deepEqual(entries, [
    { moduleName: 'dsh-devforge', enabled: true },
    { moduleName: 'dsh-old-plugin', enabled: false },
  ])
  assert.deepEqual(collectLoaderEntries(null), [])
  assert.deepEqual(collectLoaderEntries({}), [])
  assert.deepEqual(collectLoaderEntries({ entries: () => { throw new Error('boom') } }), [])
})

test('createPackageReader：绝对路径目录读取与未知模块负缓存', () => {
  const repoRoot = fileURLToPath(new URL('../', import.meta.url))
  const read = createPackageReader([import.meta.url])
  const info = read(repoRoot)
  assert.ok(info?.version, '仓库 package.json 应能读到版本号')
  assert.ok((info.description ?? '').length > 0, '仓库 package.json 应能读到描述')
  // 未知模块：解析失败返回 undefined，且负缓存后重复调用不抛错。
  assert.equal(read('dsh-definitely-not-exists-xyz'), undefined)
  assert.equal(read('dsh-definitely-not-exists-xyz'), undefined)
  assert.equal(read(''), undefined)
})

/** 测试用固定读取器：确定性输出，不依赖磁盘。 */
const fixedReader = (moduleName: string) => {
  if (moduleName === 'dsh-devforge') return { version: '0.12.0', description: 'DSH 规范驱动天工造梦' }
  if (moduleName === 'dsh-mnemon') return { version: '1.0.0', description: 'x'.repeat(150) }
  return undefined
}

test('renderPluginBrief：全核心返回空串，用户插件逐条列出且官方模块汇总计数', () => {
  const onlyCore: LoaderEntryLite[] = [
    { moduleName: '@deepseek-ai/dsh-agent', enabled: true },
    { moduleName: '@deepseek-ai/dsh-tool-bash', enabled: true },
  ]
  assert.equal(renderPluginBrief(onlyCore, fixedReader), '')
  const mixed: LoaderEntryLite[] = [
    { moduleName: '@deepseek-ai/dsh-agent', enabled: true },
    { moduleName: 'dsh-mnemon', enabled: true },
    { moduleName: 'dsh-devforge', enabled: true },
  ]
  const text = renderPluginBrief(mixed, fixedReader)
  assert.ok(text.startsWith('【已安装插件功能总览'))
  assert.ok(text.includes('- dsh-devforge v0.12.0：DSH 规范驱动天工造梦'))
  assert.ok(text.includes('另有 1 个 @deepseek-ai 官方核心内置模块'))
})

test('renderPluginBrief：禁用插件汇总、超长描述截断', () => {
  const entries: LoaderEntryLite[] = [
    { moduleName: 'dsh-devforge', enabled: true },
    { moduleName: 'dsh-mnemon', enabled: true },
    { moduleName: 'dsh-disabled', enabled: false },
  ]
  const text = renderPluginBrief(entries, fixedReader)
  assert.ok(text.includes('另有 1 个已禁用插件：dsh-disabled。'))
  const line = text.split('\n').find((l) => l.startsWith('- dsh-mnemon')) ?? ''
  assert.ok(line.includes('…'), '超长描述应截断')
  assert.ok(line.length < 140, '单行长度应受控')
})

test('renderPluginBrief：行数封顶并提示省略数量', () => {
  const entries: LoaderEntryLite[] = Array.from({ length: 6 }, (_, i) => ({ moduleName: 'dsh-p' + String(i), enabled: true }))
  const text = renderPluginBrief(entries, fixedReader, { maxLines: 4 })
  const lines = text.split('\n')
  assert.ok(lines.length <= 5, '至多表头+3条+省略行')
  assert.ok(text.includes('另有 3 个启用插件未逐条列出'))
})

test('节名与顺序：位于约束注入(80)之后、工具指引(100)之前', () => {
  assert.equal(PLUGIN_BRIEF_SECTION_NAME, 'plugin:dsh-devforge:plugin-brief')
  assert.equal(PLUGIN_BRIEF_SECTION_ORDER, 90)
})
