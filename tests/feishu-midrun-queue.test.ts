/**
 * 飞书「运行中再发消息」投递单测（0.66.1）。
 *
 * 辉哥 2026-10-20 实录：先发一条消息，模型回复能看到；回复还没完成又发一条，
 * 第二条就「看不到回复」。根因是旧策略把运行中的消息 steer 进当前轮，而流式
 * 卡片按会话只维护一张——飞书对卡片原地更新不产生新消息、不提醒，手机端只能
 * 看到上面那张旧卡在变；更糟的是 steer 在 turn/end 边界被拒时没有入口承载，
 * 整轮输出丢失。
 *
 * 新契约：运行中的普通消息排队，本轮结束后逐条 followup，每条消息独立开一张
 * 新卡片；只有以「!」开头的显式插话才 steer（并翻页，续写落到新卡）。
 *
 * 改动前失败依据：旧实现没有 inboundDeliveryOf / pending-turns，且运行中普通消息
 * 的投递语义是 steer（写回同一张卡），本文件的断言在旧代码上无法成立。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { DELIVERY, inboundDeliveryOf } from '../src/feishu/inbound-strategy.mjs'
import { createPendingTurns } from '../src/feishu/pending-turns.mjs'
import { createReplyTracker } from '../src/feishu/reply-tracker.mjs'

type FakeCard = {
  chatId: string
  initial: Record<string, unknown>
  updates: { answer: string; footer: string; state: unknown }[]
  finishes: { answer: string; footer: string; state: { status?: string } }[]
  footerUpdates: number
}

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

test('投递策略：空闲开新轮、运行中普通消息排队、运行中「!」才插话', () => {
  assert.equal(inboundDeliveryOf({ wasRunning: false, isSteer: false }), DELIVERY.FOLLOWUP)
  assert.equal(inboundDeliveryOf({ wasRunning: false, isSteer: true }), DELIVERY.FOLLOWUP)
  assert.equal(inboundDeliveryOf({ wasRunning: true, isSteer: false }), DELIVERY.QUEUE)
  assert.equal(inboundDeliveryOf({ wasRunning: true, isSteer: true }), DELIVERY.STEER)
})

test('队列：FIFO、位次、退回队首与清空计数', () => {
  const queue = createPendingTurns()
  const key = 'bot\u0000oc_queue'
  assert.equal(queue.size(key), 0)
  assert.equal(queue.push(key, { text: 'a' }).position, 1)
  assert.equal(queue.push(key, { text: 'b' }).position, 2)
  assert.deepEqual(queue.peek(key), { text: 'a' })
  assert.deepEqual(queue.shift(key), { text: 'a' })
  assert.deepEqual(queue.shift(key), { text: 'b' })
  assert.equal(queue.shift(key), undefined)
  queue.push(key, { text: 'c' })
  assert.deepEqual(queue.unshift(key, { text: 'retry' }), { position: 1, length: 2 })
  assert.deepEqual(queue.shift(key), { text: 'retry' })
  assert.equal(queue.clear(key), 1)
  assert.equal(queue.size(key), 0)
  queue.push('k1', {})
  queue.push('k2', {})
  queue.push('k2', {})
  assert.equal(queue.clearAll(), 3)
  assert.deepEqual(queue.keys(), [])
})

test('运行中再发消息：排队不写回旧卡，turn/end 后逐条开新卡', async () => {
  const { tracker, cards } = fakeTracker()
  const sid = 'session-feishu-v2-midrun'
  const chat = 'oc_midrun'
  const queue = createPendingTurns()

  // 第一条消息：空闲 → followup，正常开卡
  assert.equal(inboundDeliveryOf({ wasRunning: false, isSteer: false }), DELIVERY.FOLLOWUP)
  tracker.register(sid, chat, { waitForTurnStart: false })
  await turnStart(tracker, sid)
  await chunk(tracker, sid, '第一条的回复')
  assert.equal(cards.length, 1)

  // 第二条在运行中到达：排队，不注册新卡、不写旧卡
  assert.equal(inboundDeliveryOf({ wasRunning: true, isSteer: false }), DELIVERY.QUEUE)
  assert.equal(queue.push(chat, { text: '第二条' }).position, 1)
  assert.equal(tracker.hasActive(sid), true, '第一条仍在跑，旧实现会直接 steer 进当前轮')
  await chunk(tracker, sid, '（本轮继续输出）')
  assert.equal(cards.length, 1, '排队消息不应让输出写进新的或旧的卡')

  // 第一轮结束：旧卡收尾；flush 队列 → 注册新 entry + followup → 第二轮开新卡
  await turnEnd(tracker, sid)
  assert.equal(cards[0].finishes.length, 1, '第一条卡片应就地收尾')
  const item = queue.shift(chat)
  assert.deepEqual(item, { text: '第二条' })
  tracker.register(sid, chat, { waitForTurnStart: false })
  await turnStart(tracker, sid, 2)
  await chunk(tracker, sid, '第二条的回复')
  assert.equal(cards.length, 2, '排队消息必须拥有自己的新卡片（手机端能看到的新消息）')
  assert.equal(cards[1].updates[cards[1].updates.length - 1].answer, '第二条的回复')
  await turnEnd(tracker, sid, 2)
  assert.equal(cards[1].finishes.length, 1, '第二条终态收在自己的卡片上')
  assert.equal(cards[0].finishes.length, 1, '第一条卡片不再被改写')
})

test('运行中显式插话：steer 后翻页，续写落到新卡片而不是旧卡', async () => {
  const { tracker, cards } = fakeTracker()
  const sid = 'session-feishu-v2-interject'
  const chat = 'oc_interject'

  tracker.register(sid, chat, { waitForTurnStart: false })
  await turnStart(tracker, sid)
  await chunk(tracker, sid, '第一段输出')
  assert.equal(cards.length, 1)

  assert.equal(inboundDeliveryOf({ wasRunning: true, isSteer: true }), DELIVERY.STEER)
  // index.mjs 在 steer 之后调用 rolloverChat（状态文案可定制）
  await tracker.rolloverChat(chat, { status: '已收到你的插话，继续处理' })
  assert.equal(cards[0].finishes.length, 1, '插话时旧卡必须就地收尾')
  assert.equal(cards[0].finishes[0].state.status, '**已收到你的插话，继续处理**')

  await chunk(tracker, sid, '插话后的回答')
  assert.equal(cards.length, 2, '插话后的回答必须出现在新卡片上')
  assert.equal(cards[1].updates[cards[1].updates.length - 1].answer, '插话后的回答')
  await turnEnd(tracker, sid)
  assert.equal(cards[1].finishes.length, 1)
})
