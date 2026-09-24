/**
 * 飞书帮助卡/模型卡单测：/help 与 /model 的互动卡片构建纯函数验证。
 * 卡片必须小于飞书 30 KB 上限、回调值携带完整动作信息、模型数量有截断护栏。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildEffortCard, buildHelpCard, buildModelCard, sendCardToChat, HELP_ACTIONS } from '../src/feishu/help.mjs'

const cardBytes = (card) => Buffer.byteLength(JSON.stringify(card), 'utf8')
/** 递归收集卡片内全部按钮：模型卡网格化后按钮嵌在 column_set 的列里。 */
const buttonsOf = (element) => {
  if (element === null || typeof element !== 'object') return []
  const own = element.tag === 'button' ? [element] : []
  const nested = [...(element.columns ?? []), ...(element.elements ?? [])].flatMap((child) => buttonsOf(child))
  return [...own, ...nested]
}
const valuesOf = (card) => buttonsOf(card?.body ?? {}).map((button) => button.behaviors?.[0]?.value).filter(Boolean)

test('帮助卡：命令清单齐全，快捷按钮回调值正确，卡片小于 30KB', () => {
  const card = buildHelpCard()
  assert.equal(card.schema, '2.0')
  const texts = card.body.elements.map((element) => element?.text?.content ?? '').join('\n')
  for (const command of ['/status', '/model', '/stop', '/whoami', '/help']) {
    assert.ok(texts.includes(command), '帮助卡应包含命令 ' + command)
  }
  assert.ok(texts.includes('自动压缩'), '压缩说明应写明自动压缩')
  const values = valuesOf(card)
  assert.ok(values.some((value) => value.action === HELP_ACTIONS.CMD && value.cmd === 'status'))
  assert.ok(values.some((value) => value.action === HELP_ACTIONS.CMD && value.cmd === 'model'))
  assert.ok(cardBytes(card) < 30 * 1024, '帮助卡必须小于飞书 30KB 上限')
})

const MODELS = [
  { provider: 'volcano', model: 'glm-flash', name: 'GLM Flash', reasoningEfforts: [{ id: 'high', name: '高' }, { id: 'max', name: '最强' }] },
  { provider: 'volcano', model: 'glm-air', name: 'GLM Air', reasoningEfforts: [] },
  { provider: 'openai', model: 'gpt-image-2', name: 'GPT Image 2', reasoningEfforts: [] },
]

test('模型卡：按提供商分组展示、当前模型高亮、回调值携带 provider/model', () => {
  const card = buildModelCard({ provider: 'volcano', model: 'glm-flash', reasoningEffort: 'high' }, MODELS)
  const texts = card.body.elements.map((element) => element?.text?.content ?? '').join('\n')
  assert.ok(texts.includes('当前选中'), '应有当前选中段')
  assert.ok(texts.includes('glm-flash'), '应显示当前模型')
  assert.ok(texts.includes('high'), '应显示当前思考强度')
  assert.ok(texts.includes('volcano') && texts.includes('openai'), '应按提供商分组')
  const values = valuesOf(card).filter((value) => value.action === HELP_ACTIONS.MODEL_PICK)
  assert.equal(values.length, MODELS.length)
  assert.ok(values.every((value) => value.provider !== '' && value.model !== ''))
  assert.ok(values.some((value) => value.model === 'glm-flash' && value.provider === 'volcano'))
  assert.ok(cardBytes(card) < 30 * 1024)
})

test('模型卡：双列网格排布，单页放下时不出现翻页按钮', () => {
  const many = Array.from({ length: 20 }, (_, index) => ({ provider: 'p' + (index < 9 ? 1 : 2), model: 'm' + index, name: '模型' + index, reasoningEfforts: [] }))
  const card = buildModelCard({ provider: '', model: '' }, many)
  const grids = card.body.elements.filter((element) => element?.tag === 'column_set')
  assert.ok(grids.length > 0, '模型按钮应以双列 column_set 网格排布')
  const gridButtons = grids.flatMap((grid) => grid.columns.map((column: any) => column.elements?.[0]).filter((element: any) => element?.tag === 'button'))
  const plainButtons = card.body.elements.filter((element) => element?.tag === 'button')
  assert.equal(gridButtons.length, many.length, '20 个模型必须全部上卡（辉哥定稿：可以挤，不能截断）')
  assert.equal(plainButtons.length, 0, '模型按钮不应再以整行按钮堆叠')
  const pickValues = gridButtons.map((element: any) => element.behaviors?.[0]?.value).filter((value: any) => value?.action === HELP_ACTIONS.MODEL_PICK)
  assert.equal(new Set(pickValues.map((value: any) => value.model)).size, many.length, '每个模型的回调值都要在')
  for (const grid of grids) assert.ok(grid.columns.every((column: any) => column.elements?.length > 0), '网格列不允许空 elements')
  assert.equal(valuesOf(card).filter((value) => value.action === HELP_ACTIONS.MODEL_PAGE).length, 0, '单页放下不应有翻页按钮')
  assert.ok(cardBytes(card) < 30 * 1024, '全量模型卡必须小于飞书 30KB 上限')
})

test('模型卡：超过每页条数自动分页，翻页按钮携带页码', () => {
  const many = Array.from({ length: 30 }, (_, index) => ({ provider: 'volcengine-ark-plan', model: 'doubao-seed-' + index, name: 'Doubao Seed ' + index, reasoningEfforts: [{ id: 'high', name: '高' }] }))
  const first = buildModelCard({ provider: '', model: '' }, many)
  assert.equal(valuesOf(first).filter((value) => value.action === HELP_ACTIONS.MODEL_PICK).length, 24, '第一页应展示 24 个模型')
  const pageValues = valuesOf(first).filter((value) => value.action === HELP_ACTIONS.MODEL_PAGE)
  assert.deepEqual(pageValues.map((value) => value.page), [0, 1], '第一页应有上一页(0)与下一页(1)按钮')
  const pageTexts = textsOf(first).join('\n')
  assert.ok(pageTexts.includes('第 1 / 2 页') && pageTexts.includes('共 30 个模型'), '应有页码与总数提示')
  assert.ok(cardBytes(first) < 30 * 1024)
  // 第二页：剩余 6 个模型 + 翻页按钮
  const second = buildModelCard({ provider: '', model: '' }, many, { page: 1 })
  assert.equal(valuesOf(second).filter((value) => value.action === HELP_ACTIONS.MODEL_PICK).length, 6)
  assert.deepEqual(valuesOf(second).filter((value) => value.action === HELP_ACTIONS.MODEL_PAGE).map((value) => value.page), [0, 1])
  // 页码越界自动收敛到最后一页
  const clamped = buildModelCard({ provider: '', model: '' }, many, { page: 99 })
  assert.equal(valuesOf(clamped).filter((value) => value.action === HELP_ACTIONS.MODEL_PICK).length, 6, '越界页码应收敛到最后一页')
  // 49 个模型（实测生产规模）→ 3 页，每页节点数可控。
  // 实测校准（2026-09-24 真卡直发）：每页 24 模型 ≈ 233 个 tag 元素、9.5KB，飞书接受；
  // 49 模型塞单卡 ≈ 455 个元素，被拒（11310 element exceeds the limit）。阈值按实测留余量。
  const real = Array.from({ length: 49 }, (_, index) => ({ provider: 'p' + (index % 5), model: 'm' + index, name: '模型' + index, reasoningEfforts: [] }))
  for (const page of [0, 1, 2]) {
    const card = buildModelCard({ provider: '', model: '' }, real, { page })
    assert.ok(cardBytes(card) < 30 * 1024, '每页都必须小于 30KB')
    assert.ok(countNodes(card) <= 240, '每页元素数不能超过实测红线（11310）')
  }
})

/** 统计卡片内带 tag 的组件元素数：飞书 11310 报错实测是元素数红线（独立于 30KB 字节红线）。 */
function countNodes(node) {
  if (node === null || typeof node !== 'object') return 0
  const own = Array.isArray(node) ? 0 : (typeof node.tag === 'string' && node.tag !== '' ? 1 : 0)
  let count = own
  for (const child of Object.values(node)) count += countNodes(child)
  return count
}

/** 递归收集卡片全部文本（含 column_set 内嵌文本），供文案断言。 */
function textsOf(node) {
  if (node === null || typeof node !== 'object') return []
  const own = node?.text?.content !== undefined ? [String(node.text.content)] : []
  const children = Array.isArray(node) ? node : Object.values(node)
  return [...own, ...children.flatMap((child) => textsOf(child))]
}

test('模型卡：无可用模型时给出面板配置指引', () => {
  const card = buildModelCard(null, [])
  const texts = card.body.elements.map((element) => element?.text?.content ?? '').join('\n')
  assert.ok(texts.includes('暂无可用模型'))
})

test('思考强度卡：跟随默认按钮 effort 为空串，强度按钮逐项携带 effort', () => {
  const card = buildEffortCard({ provider: 'volcano', model: 'glm-flash', name: 'GLM Flash', reasoningEfforts: [{ id: 'high', name: '高' }, { id: 'max', name: '最强' }] })
  const values = valuesOf(card).filter((value) => value.action === HELP_ACTIONS.MODEL_APPLY)
  const defaults = values.find((value) => value.effort === '')
  assert.ok(defaults, '应有跟随默认按钮')
  assert.equal(defaults.model, 'glm-flash')
  assert.deepEqual(values.filter((value) => value.effort !== '').map((value) => value.effort).sort(), ['high', 'max'])
  assert.ok(cardBytes(card) < 30 * 1024)
})

test('思考强度卡：无强度选项时提示直接跟随默认', () => {
  const card = buildEffortCard({ provider: 'volcano', model: 'glm-air', name: 'GLM Air', reasoningEfforts: [] })
  const applyValues = valuesOf(card).filter((value) => value.action === HELP_ACTIONS.MODEL_APPLY)
  assert.equal(applyValues.length, 1)
  assert.equal(applyValues[0].effort, '')
  const texts = card.body.elements.map((element) => element?.text?.content ?? '').join('\n')
  assert.ok(texts.includes('没有可选思考强度'))
})

test('发送辅助：客户端未连接报错，连接正常时走桥发送并回传 message_id', async () => {
  await assert.rejects(sendCardToChat(() => null, 'oc_chat1', buildHelpCard()), /未连接/)
  const sent = []
  const fakeClient = { im: { v1: { message: { create: async ({ data }) => { sent.push(data); return { code: 0, data: { message_id: 'om_help_1' } } } } } } }
  const messageId = await sendCardToChat(() => fakeClient, 'oc_chat1', buildHelpCard())
  assert.equal(messageId, 'om_help_1')
  assert.equal(sent.length, 1)
  assert.equal(sent[0].msg_type, 'interactive')
  assert.equal(sent[0].receive_id, 'oc_chat1')
})
