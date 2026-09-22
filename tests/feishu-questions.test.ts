/**
 * 飞书答题器单测：ask_user_question 经 user-questions/request waterfall 到达时，
 * 飞书会话的问题以互动卡片认领并等待按钮回调/文本作答，非飞书会话 next() 放行。
 * 全部用内存假件（deliverCard / sendText / 手动触发回调）验证，不依赖真实飞书。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildQuestionCard, createQuestionAnswerer } from '../src/feishu/questions.mjs'

/** 内存假答题环境：记录发出的卡片与文本，手动投递按钮回调。 */
function fakeAnswerer() {
  const sentCards = []
  const sentTexts = []
  // deferred：卡片异步投递，测试必须等卡片真正发出后再模拟按钮回调。
  let notifyCard
  const firstCard = new Promise((resolve) => { notifyCard = resolve })
  const answerer = createQuestionAnswerer({
    getClient: () => ({}),
    sendText: async (chatId, text) => { sentTexts.push({ chatId, text }) },
    deliverCard: async (chatId, card) => {
      sentCards.push({ chatId, card })
      notifyCard(card)
      return 'om_card_1'
    },
    warn: () => {},
    info: () => {},
  })
  /** 从已发卡片反查 askId（真实场景由飞书回调携带，这里等价模拟）。 */
  const askIdOf = (card) => card.body.elements
    .flatMap((element) => element?.behaviors?.[0]?.value ?? [])
    .find((value) => value?.askId)?.askId
  return { answerer, sentCards, sentTexts, firstCard, askIdOf }
}

const QUESTIONS = [
  { id: 'q1', question: '选哪个部署方式？', options: [{ label: '暂存' }, { label: '生产 (推荐)' }] },
  { id: 'q2', question: '还有什么补充要求？' },
]

test('问题卡片：包含每个问题的选项按钮与回调值，开放题提示文字作答', () => {
  const card = buildQuestionCard('ask-1', QUESTIONS)
  assert.equal(card.schema, '2.0')
  const buttons = card.body.elements.filter((element) => element?.tag === 'button')
  const optionValues = buttons.map((button) => button.behaviors?.[0]?.value).filter(Boolean)
  assert.ok(optionValues.some((value) => value.action === 'feishu_question' && value.questionId === 'q1' && value.label === '生产 (推荐)'))
  assert.ok(optionValues.some((value) => value.action === 'feishu_question_cancel'))
  // 开放题（无选项）不出按钮，卡片文案提示直接输入
  assert.ok(!optionValues.some((value) => value.questionId === 'q2' && value.action === 'feishu_question'))
  const plainTexts = card.body.elements.filter((element) => element?.tag === 'div' && element?.text?.tag === 'plain_text').map((element) => element.text.content)
  assert.ok(plainTexts.some((text) => text.includes('直接在会话里输入答案')))
})

test('问题卡片：推荐选项解析为（推荐）后缀并高亮', () => {
  const card = buildQuestionCard('ask-1', [{ id: 'q1', question: '？', options: [{ label: 'A (recommended)' }, { label: 'B' }] }])
  const buttons = card.body.elements.filter((element) => element?.tag === 'button')
  const recommended = buttons.find((button) => button.text?.content === 'A（推荐）')
  assert.ok(recommended, '推荐选项应展示（推荐）后缀')
  assert.equal(recommended.type, 'primary')
})

test('答题器：非飞书会话的请求 next() 放行，不投递卡片', async () => {
  const { answerer, sentCards } = fakeAnswerer()
  let delegated = false
  await answerer.answer({ agent: { id: 'other-agent' }, questions: QUESTIONS }, async () => { delegated = true })
  assert.ok(delegated, '应调用 next() 放行')
  assert.equal(sentCards.length, 0)
})

test('答题器：选项按钮点选齐全部问题后，按契约 resolve 答案批次', async () => {
  const { answerer, sentTexts, firstCard, askIdOf } = fakeAnswerer()
  answerer.registerAgent('agent-1', 'oc_chat1')
  const pendingPromise = answerer.answer({ agent: { id: 'agent-1' }, questions: QUESTIONS })
  const askId = askIdOf(await firstCard)
  answerer.handleCardValue({ action: 'feishu_question', askId, questionId: 'q1', label: '生产 (推荐)' })
  answerer.recordCustomAnswer('oc_chat1', '希望今晚就发')
  const answer = await pendingPromise
  assert.deepEqual(answer, { answers: [{ id: 'q1', selected: ['生产 (推荐)'] }, { id: 'q2', selected: [], custom: '希望今晚就发' }] })
  assert.ok(sentTexts.some((item) => item.chatId === 'oc_chat1' && item.text.includes('已收到你的回答')), '应回一条确认文本')
})

test('答题器：取消按钮按 ASK_CANCELLED 拒绝', async () => {
  const { answerer, firstCard, askIdOf } = fakeAnswerer()
  answerer.registerAgent('agent-1', 'oc_chat1')
  const pendingPromise = answerer.answer({ agent: { id: 'agent-1' }, questions: QUESTIONS })
  const askId = askIdOf(await firstCard)
  const settled = pendingPromise.then(() => null, (error) => error)
  answerer.handleCardValue({ action: 'feishu_question_cancel', askId })
  const error = await settled
  assert.equal(error.name, 'UserQuestionError')
  assert.equal(error.code, 'ASK_CANCELLED')
})

test('答题器：单选题重复点选被拒绝提示，不影响答案', async () => {
  const { answerer, firstCard, askIdOf } = fakeAnswerer()
  answerer.registerAgent('agent-1', 'oc_chat1')
  // 两题场景：点选第一题后整卡仍未结算，才能验证"重复点选被拒"的边界
  const questions = [
    { id: 'q1', question: '？', options: [{ label: 'A' }] },
    { id: 'q2', question: '补充要求？' },
  ]
  const pendingPromise = answerer.answer({ agent: { id: 'agent-1' }, questions })
  const askId = askIdOf(await firstCard)
  const first = answerer.handleCardValue({ action: 'feishu_question', askId, questionId: 'q1', label: 'A' })
  const second = answerer.handleCardValue({ action: 'feishu_question', askId, questionId: 'q1', label: 'A' })
  assert.equal(second.toast.content, '本题已作答')
  answerer.recordCustomAnswer('oc_chat1', '无')
  const answer = await pendingPromise
  assert.deepEqual(answer.answers[0].selected, ['A'])
  assert.ok(first)
})

test('答题器：多选题点选切换 + 完成本题提交', async () => {
  const { answerer, firstCard, askIdOf } = fakeAnswerer()
  answerer.registerAgent('agent-1', 'oc_chat1')
  const question = { id: 'q1', question: '带哪些模块？', multiSelect: true, options: [{ label: 'A' }, { label: 'B' }] }
  const pendingPromise = answerer.answer({ agent: { id: 'agent-1' }, questions: [question] })
  const askId = askIdOf(await firstCard)
  answerer.handleCardValue({ action: 'feishu_question', askId, questionId: 'q1', label: 'A' })
  answerer.handleCardValue({ action: 'feishu_question', askId, questionId: 'q1', label: 'B' })
  answerer.handleCardValue({ action: 'feishu_question', askId, questionId: 'q1', label: 'B' }) // 再点取消选择
  answerer.handleCardValue({ action: 'feishu_question_commit', askId, questionId: 'q1' })
  const answer = await pendingPromise
  assert.deepEqual(answer.answers[0].selected, ['A'])
})

test('答题器：跳过按钮记为空选择并参与结算', async () => {
  const { answerer, firstCard, askIdOf } = fakeAnswerer()
  answerer.registerAgent('agent-1', 'oc_chat1')
  const pendingPromise = answerer.answer({ agent: { id: 'agent-1' }, questions: [{ id: 'q1', question: '？', options: [{ label: 'A' }] }] })
  const askId = askIdOf(await firstCard)
  answerer.handleCardValue({ action: 'feishu_question_skip', askId, questionId: 'q1' })
  const answer = await pendingPromise
  assert.deepEqual(answer.answers[0], { id: 'q1', selected: [] })
})

test('答题器：关停 dispose 按 ASK_ABORTED 拒绝全部挂起问题', async () => {
  const answerer = createQuestionAnswerer({
    getClient: () => ({}),
    sendText: async () => {},
    deliverCard: async () => 'om_x',
  })
  answerer.registerAgent('agent-1', 'oc_chat1')
  // 先挂 reject 监听再 dispose，避免测试自己在等待一个永远不会结算的 promise
  const settled = answerer.answer({ agent: { id: 'agent-1' }, questions: QUESTIONS }, async () => {}).then(
    () => null,
    (error) => error,
  )
  answerer.dispose()
  const error = await settled
  assert.equal(error.name, 'UserQuestionError')
  assert.equal(error.code, 'ASK_ABORTED')
})

test('答题器：卡片投递失败时抛错给模型，不静默吞掉', async () => {
  const answerer = createQuestionAnswerer({
    getClient: () => null,
    sendText: async () => {},
  })
  answerer.registerAgent('agent-1', 'oc_chat1')
  await assert.rejects(
    answerer.answer({ agent: { id: 'agent-1' }, questions: QUESTIONS }, async () => {}),
    (error) => error.name === 'UserQuestionError' && error.code === 'ASK_ABORTED' && error.message.includes('投递失败'),
  )
})

test('答题器：开放题文本捕获只消费匹配会话的消息', async () => {
  const { answerer, firstCard } = fakeAnswerer()
  answerer.registerAgent('agent-1', 'oc_chat1')
  const pendingPromise = answerer.answer({ agent: { id: 'agent-1' }, questions: [{ id: 'q1', question: '补充要求？' }] })
  await firstCard
  assert.equal(answerer.recordCustomAnswer('oc_other', '不是本会话的'), false)
  assert.equal(answerer.recordCustomAnswer('oc_chat1', '没有了'), true)
  const answer = await pendingPromise
  assert.deepEqual(answer.answers[0].custom, '没有了')
})
