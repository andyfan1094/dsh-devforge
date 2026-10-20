/**
 * 飞书「运行中再发消息」投递单测（0.66.2）。
 *
 * 辉哥 2026-10-20 实录：先发一条消息，模型回复能看到；回复还没完成又发一条，
 * 第二条就「看不到回复」。根因是运行中的消息被 steer 进当前轮，而流式卡片按会话
 * 只有一张——飞书对卡片原地更新不产生新消息、不提醒，手机端只能看到旧卡在变；
 * 更糟的是 steer 在 turn/end 边界被拒时没有入口承载，整轮输出丢失。
 *
 * 辉哥定案：不排队，直接插话；插话后给卡片刷一张最新的到对话最下方。
 * 新契约：运行中的消息一律 steer（模型立即看到），随即 rolloverChat 让旧卡收尾、
 * 续写落到底部新卡；另注册一张「等待下一轮」的兜底卡片，接住 turn/end 边界上
 * 被 steer 唤醒的新轮次。
 *
 * 改动前失败依据：旧实现（0.66.0）没有 inboundDeliveryOf / pending-turns，且运行中
 * 消息只 steer 不翻页（续写回同一张卡），本文件断言在旧代码上无法成立。
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

function fakeTracker(now: () => number = Date.now) {
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
    now,
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

test('投递策略：空闲开新轮、运行中一律插话（不再排队）', () => {
  assert.equal(inboundDeliveryOf({ wasRunning: false }), DELIVERY.FOLLOWUP)
  assert.equal(inboundDeliveryOf({ wasRunning: false, isSteer: true }), DELIVERY.FOLLOWUP)
  assert.equal(inboundDeliveryOf({ wasRunning: true }), DELIVERY.STEER)
  assert.equal(inboundDeliveryOf({ wasRunning: true, isSteer: true }), DELIVERY.STEER)
})

test('队列模块仅作插话失败降级：FIFO、位次、退回队首与清空计数', () => {
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

test('运行中再发消息：插话后立刻翻页，回答出现在对话最下方的新卡片', async () => {
  const { tracker, cards } = fakeTracker()
  const sid = 'session-feishu-v2-interject'
  const chat = 'oc_interject'

  tracker.register(sid, chat, { waitForTurnStart: false })
  await turnStart(tracker, sid)
  await chunk(tracker, sid, '第一段的回复')
  assert.equal(cards.length, 1)

  // 第二条在运行中到达 → 插话（steer）+ 立刻翻页（index.mjs 的投递路径）
  assert.equal(inboundDeliveryOf({ wasRunning: true }), DELIVERY.STEER)
  const fallback = tracker.register(sid, chat, { waitForTurnStart: true })
  assert.equal(tracker.pendingCount(sid), 2, '当前轮卡片 + 兜底等待卡片')
  await tracker.rolloverChat(chat, { status: '已收到你的新消息，继续处理' })
  assert.equal(cards[0].finishes.length, 1, '旧卡必须就地收尾（不再被后续输出改写）')
  assert.equal(cards[0].finishes[0].state.status, '**已收到你的新消息，继续处理**')

  await chunk(tracker, sid, '插话后的回答')
  assert.equal(cards.length, 2, '插话后的回答必须出现在一张新卡片上（手机端能看到的新消息）')
  assert.equal(cards[1].updates[cards[1].updates.length - 1].answer, '插话后的回答')
  assert.equal(cards[0].finishes.length, 1, '旧卡不被改写')
  void fallback
})

test('turn/end 边界兜底：steer 唤醒的新轮次由「等待下一轮」卡片接住', async () => {
  const { tracker, cards } = fakeTracker()
  const sid = 'session-feishu-v2-boundary'
  const chat = 'oc_boundary'

  tracker.register(sid, chat, { waitForTurnStart: false })
  await turnStart(tracker, sid)
  await chunk(tracker, sid, '第一段')
  // 插话到达时先注册兜底卡片（ready=false），随后当前轮恰好结束
  const fallback = tracker.register(sid, chat, { waitForTurnStart: true })
  await tracker.rolloverChat(chat, { status: '已收到你的新消息，继续处理' })
  await turnEnd(tracker, sid)
  assert.equal(cards[0].finishes.length >= 1, true, '第一张卡已收尾')
  assert.equal(tracker.pendingCount(sid), 1, '兜底卡片仍在队列里等下一轮（未被 turn/end 清掉）')

  // steer 唤醒了新轮次：兜底卡片被提升为活跃卡片并开新卡
  await turnStart(tracker, sid, 2)
  await chunk(tracker, sid, '新轮次的回答')
  assert.equal(cards.length, 2, '新轮次必须开新卡片，回答不能丢')
  assert.equal(cards[1].updates[cards[1].updates.length - 1].answer, '新轮次的回答')
  await turnEnd(tracker, sid, 2)
  assert.equal(cards[1].finishes.length, 1)
  assert.equal(tracker.pendingCount(sid), 0, '轮次结束后兜底卡片已被消费')
  void fallback
})

test('兜底卡片清理：插话被当前轮吸收时，等待卡片过期回收不泄漏', async () => {
  let stamp = 0
  const { tracker } = fakeTracker(() => stamp)
  const sid = 'session-feishu-v2-stale'
  const chat = 'oc_stale'

  tracker.register(sid, chat, { waitForTurnStart: false })
  await turnStart(tracker, sid)
  tracker.register(sid, chat, { waitForTurnStart: true })
  assert.equal(tracker.pendingCount(sid), 2)
  // 插话被当前轮吸收、没有新轮次来提升它：10 分钟后在 turn/end 时回收
  stamp = 11 * 60 * 1000
  await turnEnd(tracker, sid)
  assert.equal(tracker.pendingCount(sid), 0, '过期未提升的等待卡片必须被回收')
})
