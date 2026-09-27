/**
 * 飞书答题「翻页」单测：用户答完问答卡片后，当前流式卡片必须就地收尾，
 * 续跑的答复落到一张新卡片上——否则答复会被写回提问卡片上方那张执行过程卡，
 * 飞书对卡片原地更新既不产生新消息也不提醒，手机端只能看到「已收到你的回答」，
 * 用户据此判定模型没回话（2026-09-27 实录：事件流 turn/end 与卡片 update_time
 * 六组时间戳逐一吻合，全程零新消息）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createReplyTracker } from '../src/feishu/reply-tracker.mjs'
import { createQuestionAnswerer } from '../src/feishu/questions.mjs'

type FakeCard = {
  chatId: string
  initial: Record<string, unknown>
  updates: { answer: string; footer: string; state: unknown }[]
  finishes: { answer: string; footer: string; state: { status?: string } }[]
  footerUpdates: number
}

/** 假回复追踪环境：每开一张卡记一条，供「是否真的翻页」断言。 */
function fakeTracker() {
  const cards: FakeCard[] = []
  const sentTexts: { chatId: string; text: string }[] = []
  const tracker = createReplyTracker({
    sendText: async (chatId: string, text: string) => { sentTexts.push({ chatId, text }) },
    createStream: async (chatId: string, initial: Record<string, unknown>) => {
      const card: FakeCard = { chatId, initial, updates: [], finishes: [], footerUpdates: 0 }
      cards.push(card)
      return {
        update: async (answer: string, footer: string, state: unknown) => { card.updates.push({ answer, footer, state }) },
        updateFooter: async (footer: string) => { card.footerUpdates += 1 },
        finish: async (answer: string, footer: string, state: { status?: string }) => { card.finishes.push({ answer, footer, state }) },
      }
    },
    warn: () => {},
    // 心跳定时器在单测里停掉：翻页语义由显式调用驱动，不依赖心跳节拍
    setIntervalFn: () => ({ unref() {} }),
    clearIntervalFn: () => {},
  })
  return { tracker, cards, sentTexts }
}

const turnStart = (tracker: any, sid: string, turn = 1) =>
  tracker.observeSessionEvent({ id: sid }, { type: 'turn/start', data: { turn } })

const chunk = (tracker: any, sid: string, text: string) =>
  tracker.observeSessionEvent({ id: sid }, { type: 'assistant/chunk', data: { chunk: { type: 'text-delta', text } } })

const turnEnd = (tracker: any, sid: string, turn = 1, reason: unknown = { kind: 'completed' }) =>
  tracker.observeSessionEvent({ id: sid, events: [] }, { type: 'turn/end', data: { turn, reason } })

test('翻页：答完卡片后旧卡就地收尾，续跑答复落到新卡片', async () => {
  const { tracker, cards, sentTexts } = fakeTracker()
  const sid = 'session-feishu-v2-roll'
  const chat = 'oc_roll'
  tracker.register(sid, chat, { waitForTurnStart: false, model: 'DeepSeek V4.1 Flash' })
  await turnStart(tracker, sid)
  assert.equal(cards.length, 1, '轮次开始应开第一张卡')
  await chunk(tracker, sid, '先问你一个问题')
  // turn/start 先有一次初始更新，随后流式增量再更新一次（同一张卡，不新开卡）
  assert.equal(cards.length, 1, '流式增量不应新开卡片')
  assert.equal(cards[0].updates[cards[0].updates.length - 1].answer, '先问你一个问题')

  await tracker.rolloverChat(chat)
  assert.equal(cards[0].finishes.length, 1, '旧卡应就地收尾')
  assert.equal(cards[0].finishes[0].state.status, '**已收到回答，继续处理**')
  assert.equal(cards[0].finishes[0].answer, '先问你一个问题', '旧卡保留已产出的内容')

  await chunk(tracker, sid, '继续处理')
  assert.equal(cards.length, 2, '续跑必须落到新卡片（这就是手机端能看到的那条）')
  assert.equal(cards[1].updates[cards[1].updates.length - 1].answer, '继续处理')

  await turnEnd(tracker, sid)
  assert.equal(cards[1].finishes.length, 1, '终态收在新卡片上')
  assert.equal(cards[1].finishes[0].answer, '继续处理')
  assert.equal(cards[0].finishes.length, 1, '旧卡收尾后不再被改写')
  assert.equal(sentTexts.length, 0, '卡片路径不落纯文本兜底')
})

test('翻页：答题期间没有文字输出时，旧卡给占位说明而不是空答复', async () => {
  const { tracker, cards } = fakeTracker()
  const sid = 'session-feishu-v2-blank'
  const chat = 'oc_blank'
  tracker.register(sid, chat, { waitForTurnStart: false })
  await turnStart(tracker, sid)
  await tracker.rolloverChat(chat)
  assert.equal(cards[0].finishes.length, 1)
  assert.match(cards[0].finishes[0].answer, /下方新卡片/)
})

test('翻页：没有活跃卡片（或 chatId 为空）时安全返回 false', async () => {
  const { tracker } = fakeTracker()
  assert.equal(await tracker.rolloverChat('oc_none'), false)
  assert.equal(await tracker.rolloverChat(''), false)
})

test('答题器：结算时先回调 onAnswered（翻页），再把答案交给模型', async () => {
  const order: string[] = []
  let askId = ''
  const answerer = createQuestionAnswerer({
    getClient: () => ({}),
    sendText: async () => { order.push('text') },
    deliverCard: async (_chatId: string, card: any) => {
      askId = card.body.elements
        .flatMap((element: any) => element?.behaviors?.[0]?.value ?? [])
        .find((value: any) => value?.askId)?.askId
      return 'om_card_1'
    },
    onAnswered: (chatId: string) => { order.push('rollover:' + chatId) },
    warn: () => {},
    info: () => {},
  })
  answerer.registerAgent('agent-1', 'oc_chat1')
  const answerPromise = answerer
    .answer({ agent: { id: 'agent-1' }, questions: [{ id: 'q1', question: '选哪个？', options: [{ label: 'A' }] }] })
    .then((value: unknown) => { order.push('resolved'); return value })
  for (let index = 0; index < 50 && askId === ''; index += 1) await new Promise((resolve) => setTimeout(resolve, 0))
  assert.notEqual(askId, '', '问题卡片应已投递')
  answerer.handleCardValue({ action: 'feishu_question', askId, questionId: 'q1', label: 'A' })
  const answer = await answerPromise
  assert.deepEqual(answer, { answers: [{ id: 'q1', selected: ['A'] }] })
  const rolloverAt = order.indexOf('rollover:oc_chat1')
  assert.ok(rolloverAt >= 0, '应回调 onAnswered 且带正确 chatId')
  assert.ok(order.indexOf('resolved') > rolloverAt, '翻页必须早于答案返回模型')
})

test('答题器：onAnswered 抛错不影响答案回传（呈现优化不得阻断主链路）', async () => {
  let askId = ''
  const answerer = createQuestionAnswerer({
    getClient: () => ({}),
    sendText: async () => {},
    deliverCard: async (_chatId: string, card: any) => {
      askId = card.body.elements
        .flatMap((element: any) => element?.behaviors?.[0]?.value ?? [])
        .find((value: any) => value?.askId)?.askId
      return 'om_card_1'
    },
    onAnswered: () => { throw new Error('翻页炸了') },
    warn: () => {},
    info: () => {},
  })
  answerer.registerAgent('agent-1', 'oc_chat1')
  const answerPromise = answerer.answer({ agent: { id: 'agent-1' }, questions: [{ id: 'q1', question: '？', options: [{ label: 'A' }] }] })
  for (let index = 0; index < 50 && askId === ''; index += 1) await new Promise((resolve) => setTimeout(resolve, 0))
  answerer.handleCardValue({ action: 'feishu_question', askId, questionId: 'q1', label: 'A' })
  const answer = await answerPromise
  assert.deepEqual(answer, { answers: [{ id: 'q1', selected: ['A'] }] })
})
