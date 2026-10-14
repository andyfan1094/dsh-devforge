/**
 * 设计资产库测试：frontmatter 解析、六层资产扫描、检索与注入预算。
 *
 * 全部用临时目录自建夹具，不依赖插件内真实的 design/ 资产内容
 * （资产会随集成演进变化，测试只锁定代码契约）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DESIGN_KINDS, DesignStore, parseFrontmatter } from '../src/design.ts'

/** 造一个临时 design 根目录，返回路径与写文件助手。 */
function makeFixture(): { root: string; put: (rel: string, content: string) => void } {
  const root = mkdtempSync(join(tmpdir(), 'design-store-'))
  const put = (rel: string, content: string): void => {
    const full = join(root, rel)
    mkdirSync(join(full, '..'), { recursive: true })
    writeFileSync(full, content)
  }
  return { root, put }
}

test('frontmatter：解析 name/description/triggers 与 od.category', () => {
  const fm = parseFrontmatter([
    '---',
    'name: 反 AI 味清单',
    'description: 交付前逐条自检',
    'triggers:',
    '  - 反AI味',
    '  - anti-slop',
    'od:',
    '  category: craft',
    '---',
    '# 正文标题',
    '正文内容。',
  ].join('\n'))
  assert.equal(fm.name, '反 AI 味清单')
  assert.equal(fm.description, '交付前逐条自检')
  assert.deepEqual(fm.triggers, ['反AI味', 'anti-slop'])
  assert.equal(fm.category, 'craft')
  assert.ok(fm.body.includes('正文内容。'))
  assert.ok(!fm.body.includes('name:'))
})

test('frontmatter：description 块标量（| 多行）', () => {
  const fm = parseFrontmatter([
    '---',
    'name: x',
    'description: |',
    '  第一行说明',
    '  第二行说明',
    '---',
    'body',
  ].join('\n'))
  assert.equal(fm.description, '第一行说明\n第二行说明')
  assert.equal(fm.body, 'body')
})

test('frontmatter：没有 frontmatter 时全文当正文，不报错', () => {
  const fm = parseFrontmatter('# 只有正文\n内容。')
  assert.equal(fm.name, undefined)
  assert.deepEqual(fm.triggers, [])
  assert.ok(fm.body.includes('只有正文'))
})

test('frontmatter：缺少结束标记时整体当正文（防御破损文件）', () => {
  const text = '---\nname: 坏文件\n没有结束标记'
  const fm = parseFrontmatter(text)
  assert.equal(fm.name, undefined)
  assert.equal(fm.body, text)
})

test('扫描：单文件资产与目录型资产都能识别，空的与无入口的被跳过', () => {
  const { root, put } = makeFixture()
  put('craft/anti-slop.md', '---\nname: 反 AI 味\ntriggers:\n  - AI味\n---\n正文')
  put('skills/taste/SKILL.md', '---\nname: taste\ndescription: 三旋钮\n---\n技能正文')
  put('systems/linear/DESIGN.md', '---\nname: Linear\n---\n系统正文')
  put('systems/linear/tokens.css', ':root { --primary: oklch(0.5 0.1 250); }')
  put('skills/empty/README.txt', '没有入口文档') // 无 SKILL.md/README.md → 跳过
  const store = new DesignStore(root)

  assert.equal(store.count(), 3)
  assert.equal(store.list('craft').length, 1)
  assert.equal(store.list('skills').length, 1)
  assert.equal(store.list('systems').length, 1)
  assert.ok(!store.list().some((a) => a.id.includes('empty')))
})

test('扫描：目录不存在时安静降级为空库', () => {
  const store = new DesignStore(join(tmpdir(), '不存在的-design-' + Date.now()))
  assert.equal(store.count(), 0)
  assert.deepEqual(store.list(), [])
  assert.equal(store.catalog(), '（设计资产库为空）')
})

test('扫描：白名单外的一级目录被忽略', () => {
  const { root, put } = makeFixture()
  put('craft/ok.md', '# ok')
  put('secrets/偷偷.md', '# 不该被索引')
  const store = new DesignStore(root)
  assert.equal(store.count(), 1)
  assert.deepEqual(DESIGN_KINDS.includes('secrets' as never), false)
})

test('get：单文件资产返回正文（去掉 frontmatter）', () => {
  const { root, put } = makeFixture()
  put('craft/a.md', '---\nname: A\ntriggers:\n  - 甲\n---\n# 标题\n\n正文段落。')
  const store = new DesignStore(root)
  const detail = store.get('craft/a')
  assert.ok(detail !== undefined)
  assert.equal(detail.name, 'A')
  assert.deepEqual(detail.triggers, ['甲'])
  assert.ok(detail.content.includes('正文段落。'))
  assert.ok(!detail.content.includes('---'))
})

test('get：设计系统带出 tokens.css，不存在的 id 返回 undefined', () => {
  const { root, put } = makeFixture()
  put('systems/linear/DESIGN.md', '# Linear\n意图正文')
  put('systems/linear/tokens.css', ':root { --primary: red; }')
  put('systems/linear/design-tokens.json', '{"primary":"red"}')
  const store = new DesignStore(root)
  const detail = store.get('systems/linear')
  assert.ok(detail !== undefined)
  assert.ok(detail.content.includes('意图正文'))
  assert.ok(detail.content.includes('tokens.css'))
  assert.ok(detail.content.includes('--primary: red'))
  assert.ok(detail.content.includes('design-tokens.json'))
  assert.equal(store.get('systems/不存在'), undefined)
})

test('检索：触发词命中优先于描述命中，且 kind 可限定', () => {
  const { root, put } = makeFixture()
  put('skills/taste/SKILL.md', '---\nname: taste\ntriggers:\n  - 品味\n  - 定方向\n---\n正文')
  put('craft/taste-craft.md', '---\nname: 品味工艺\ndescription: 提到品味但只在描述里\n---\n正文')
  put('standards/taste-std.md', '---\nname: 标准\n---\n正文')
  const store = new DesignStore(root)

  const hits = store.search('品味')
  assert.equal(hits[0]?.id, 'skills/taste', '触发词命中应排在描述命中之前')
  const onlyCraft = store.search('品味', 'craft')
  assert.equal(onlyCraft.length, 1)
  assert.equal(onlyCraft[0]?.id, 'craft/taste-craft')
})

test('注入：composeForAgent 遵守预算，且跳过不存在的 id', () => {
  const { root, put } = makeFixture()
  put('craft/big.md', '# 大文件\n' + 'x'.repeat(2000))
  put('craft/small.md', '# 小文件\n短正文')
  const store = new DesignStore(root)

  const text = store.composeForAgent(['craft/small', 'craft/不存在', 'craft/big'])
  assert.ok(text.includes('小文件'))
  assert.ok(text.includes('大文件'))
  // 单篇上限生效：2000 字符正文被截到 perAssetChars 之内
  assert.ok(text.length < 2000 + 500, '应按单篇上限截断')
  const tiny = store.composeForAgent(['craft/big'], 100, 50)
  assert.ok(tiny.length <= 100 + 120, '总预算生效')
})

test('catalog：按层列出资产，含 id、名称与描述首行', () => {
  const { root, put } = makeFixture()
  put('craft/a.md', '---\nname: 甲\ndescription: 第一行说明\n第二行不该出现\n---\n正文')
  put('skills/s/SKILL.md', '---\nname: 乙\n---\n正文')
  const store = new DesignStore(root)
  const catalog = store.catalog()
  assert.ok(catalog.includes('【craft】共 1 项'))
  assert.ok(catalog.includes('craft/a'))
  assert.ok(catalog.includes('第一行说明'))
  assert.ok(!catalog.includes('第二行不该出现'))
  assert.ok(catalog.includes('【skills】共 1 项'))
})

test('检索：多词查询全词命中优先，缺词时退化为按命中词数排序（不得整串返回空）', () => {
  const { root, put } = makeFixture()
  put('craft/typography.md', '---\nname: 排版规则\ntriggers:\n  - 排版\n---\n正文')
  put('craft/hierarchy.md', '---\nname: 排版层级契约\ntriggers:\n  - 排版层级\n---\n正文')
  put('craft/form.md', '---\nname: 表单校验规则\ntriggers:\n  - 表单校验\n---\n正文')
  const store = new DesignStore(root)

  // 全词都能命中：只返回同时满足两个词的资产
  const strict = store.search('排版 层级')
  assert.equal(strict.length, 1)
  assert.equal(strict[0]?.id, 'craft/hierarchy')

  // 其中「控制台」没有对应资产：不得整体返回空，应退化并按命中词数排序
  const loose = store.search('排版 层级 控制台')
  assert.ok(loose.length >= 2, '含无对应资产的词时不应返回空')
  assert.equal(loose[0]?.id, 'craft/hierarchy', '命中两个词的资产应排最前')
  assert.ok(loose.some((a) => a.id === 'craft/typography'), '只命中一个词的资产仍应返回')
  assert.ok(!loose.some((a) => a.id === 'craft/form'), '一个词都没命中的资产不得混入')
})

test('检索：中英文标点分隔与空格等价', () => {
  const { root, put } = makeFixture()
  put('craft/form.md', '---\nname: 表单校验规则\ntriggers:\n  - 表单校验\n---\n正文')
  const store = new DesignStore(root)
  for (const query of ['表单 校验', '表单、校验', '表单，校验', '表单/校验', '表单,校验']) {
    assert.equal(store.search(query).length, 1, query + ' 应命中同一条资产')
  }
})

test('检索：单词无命中时保持空结果（不误报）', () => {
  const { root, put } = makeFixture()
  put('craft/form.md', '---\nname: 表单校验规则\ntriggers:\n  - 表单校验\n---\n正文')
  const store = new DesignStore(root)
  assert.deepEqual(store.search('量子纠缠'), [])
})

test('检索：整串叫法命中加成（精确词排在同义分散词之前）', () => {
  const { root, put } = makeFixture()
  put('craft/a.md', '---\nname: 甲\ntriggers:\n  - 排版\n  - 层级\n---\n正文')
  put('craft/b.md', '---\nname: 乙\ntriggers:\n  - 排版层级\n---\n正文')
  const store = new DesignStore(root)
  const hits = store.search('排版层级')
  assert.equal(hits.length, 1)
  assert.equal(hits[0]?.id, 'craft/b')
})

test('list：带 query 时保持全词命中（AND）语义，供精确过滤使用', () => {
  const { root, put } = makeFixture()
  put('craft/hierarchy.md', '---\nname: 排版层级契约\ntriggers:\n  - 排版层级\n---\n正文')
  put('craft/typography.md', '---\nname: 排版规则\ntriggers:\n  - 排版\n---\n正文')
  const store = new DesignStore(root)
  assert.equal(store.list('craft', '排版 层级').length, 1)
  assert.equal(store.list('craft', '排版 控制台').length, 0)
})
