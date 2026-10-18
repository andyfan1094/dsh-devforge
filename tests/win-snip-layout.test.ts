/**
 * 排版渲染测试：确保"按截图排版"由渲染层保证，而不是指望模型自己数空格。
 *
 * 背景（2026-10-18 实测）：让模型输出空格对齐的文本时，同一张图的表格会出现
 * 某几行多一个空格、以及混用全角空格的情况，列宽稳不住。所以改为模型只输出
 * 结构化行列，由 layout.ts 按显示宽度补齐 —— 这里验证补齐逻辑本身。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { displayWidth, parseLayoutDocument, renderLayout } from '../src/win-snip/layout.ts'
import { modelSpeedRank, normalizeLayout, parseTranslateOutput, readModelTarget } from '../src/win-snip/vision.ts'

test('显示宽度：中文算两列，西文算一列（与等宽字体实测比例一致）', () => {
  assert.equal(displayWidth('abc'), 3)
  assert.equal(displayWidth('中文'), 4)
  assert.equal(displayWidth('中文abc'), 7)
  assert.equal(displayWidth(''), 0)
})

test('显示宽度：全角标点、假名、韩文按两列计', () => {
  assert.equal(displayWidth('，。'), 4)
  assert.equal(displayWidth('かな'), 4)
  assert.equal(displayWidth('한글'), 4)
})

test('表格渲染：列按最宽内容对齐，中英混排也不错位', () => {
  const text = renderLayout({
    lines: [{
      type: 'table',
      rows: [
        ['名称', '数量', '单价'],
        ['苹果', '12', '3.50'],
        ['banana', '7', '2.10'],
      ],
    }],
  })
  const lines = text.split('\n')
  assert.equal(lines.length, 3)
  // 每一列在各自行上的起始显示位置必须相同。
  const columnStarts = (line: string): number[] => {
    const starts: number[] = []
    let width = 0
    let inCell = false
    for (const char of line) {
      if (char === ' ') {
        if (inCell) { inCell = false }
        width += 1
        continue
      }
      if (!inCell) { starts.push(width); inCell = true }
      width += displayWidth(char)
    }
    return starts
  }
  const first = columnStarts(lines[0] ?? '')
  for (const line of lines) {
    assert.deepEqual(columnStarts(line), first, '列起始位置必须一致：' + line)
  }
})

test('表格渲染：不足的单元格用空格补齐，行尾不留空格', () => {
  const text = renderLayout({ lines: [{ type: 'table', rows: [['a', 'b'], ['longer', 'c']] }] })
  const [first, second] = text.split('\n')
  assert.equal(first, 'a       b')
  assert.equal(second, 'longer  c')
  for (const line of text.split('\n')) assert.equal(line, line.replace(/ +$/, ''))
})

test('列表与缩进：indent 每层两个空格，marker 缺省用短横线', () => {
  assert.equal(
    renderLayout({ lines: [{ type: 'list', text: '第一项', marker: '•', indent: 0 }, { type: 'text', text: '补充', indent: 1 }] }),
    '• 第一项\n  补充',
  )
  assert.equal(renderLayout({ lines: [{ type: 'list', text: '条目' }] }), '- 条目')
})

test('渲染时去掉整体首尾空行，但保留中间空行', () => {
  const text = renderLayout({
    lines: [
      { type: 'text', text: '' },
      { type: 'text', text: 'A' },
      { type: 'text', text: '' },
      { type: 'text', text: 'B' },
      { type: 'text', text: '   ' },
    ],
  })
  assert.equal(text, 'A\n\nB')
})

test('解析结构化输出：能吃代码块围栏与前后废话', () => {
  const raw = '好的，结果如下：\n```json\n{"lines":[{"type":"text","text":"你好"}]}\n```'
  const document = parseLayoutDocument(raw)
  assert.ok(document !== undefined)
  assert.equal(renderLayout(document), '你好')
})

test('解析结构化输出：非结构或空结构返回 undefined', () => {
  assert.equal(parseLayoutDocument('就是一段普通文字'), undefined)
  assert.equal(parseLayoutDocument('{"lines":[]}'), undefined)
  assert.equal(parseLayoutDocument('{"other":1}'), undefined)
})

test('解析结构化输出：表格里的空行与非法行被丢弃，不产生空表格', () => {
  const raw = JSON.stringify({ lines: [{ type: 'table', rows: [] }, { type: 'text', text: '正文' }] })
  const document = parseLayoutDocument(raw)
  assert.ok(document !== undefined)
  assert.equal(renderLayout(document), '正文')
})

test('模型速度偏好：flash 级排在重模型前面', () => {
  assert.ok(modelSpeedRank('GLM-Flash') < modelSpeedRank('gpt-5.6-terra'))
  assert.ok(modelSpeedRank('gpt-6.1-sol') < modelSpeedRank('Kimi-K3'))
  // 未命中任何偏好时排在最后，但仍可用。
  assert.ok(modelSpeedRank('某未知模型') > modelSpeedRank('GLM-Flash'))
})

test('翻译输出：结构化 text/translation 两侧都渲染成对齐文本', () => {
  const raw = JSON.stringify({
    text: { lines: [{ type: 'table', rows: [['名称', '数量'], ['苹果', '12']] }] },
    translation: { lines: [{ type: 'table', rows: [['Name', 'Qty'], ['apple', '12']] }] },
  })
  const result = parseTranslateOutput(raw)
  assert.equal(result.text.split('\n').length, 2)
  assert.equal(result.translation.split('\n').length, 2)
  assert.match(result.text, /^名称\s+数量$/m)
})

test('当前模型选择：缺字段或非对象时返回 undefined', () => {
  assert.deepEqual(readModelTarget({ provider: 'p', model: 'm' }), { provider: 'p', model: 'm' })
  assert.equal(readModelTarget({ provider: '', model: 'm' }), undefined)
  assert.equal(readModelTarget(null), undefined)
  assert.equal(readModelTarget('x'), undefined)
})
