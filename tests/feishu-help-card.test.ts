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

test('模型卡：双列网格排布，全部模型都要展示', () => {
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
  assert.ok(cardBytes(card) < 30 * 1024, '全量模型卡必须小于飞书 30KB 上限')
})

test('模型卡：30 个模型全量展示仍小于 30KB', () => {
  const many = Array.from({ length: 30 }, (_, index) => ({ provider: 'volcengine-ark-plan', model: 'doubao-seed-' + index, name: 'Doubao Seed ' + index, reasoningEfforts: [{ id: 'high', name: '高' }] }))
  const card = buildModelCard({ provider: '', model: '' }, many)
  assert.equal(valuesOf(card).filter((value) => value.action === HELP_ACTIONS.MODEL_PICK).length, 30)
  assert.ok(cardBytes(card) < 30 * 1024)
})

test('模型卡：超过 30KB 护栏上限才截断并提示', () => {
  const tooMany = Array.from({ length: 70 }, (_, index) => ({ provider: 'p', model: 'm' + index, name: '模型' + index, reasoningEfforts: [] }))
  const card = buildModelCard({ provider: '', model: '' }, tooMany)
  const pickValues = valuesOf(card).filter((value) => value.action === HELP_ACTIONS.MODEL_PICK)
  assert.equal(pickValues.length, 60)
  const texts = card.body.elements.map((element) => element?.text?.content ?? '').join('\n')
  assert.ok(texts.includes('仅展示前 60 个'), '护栏截断必须提示')
})

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
