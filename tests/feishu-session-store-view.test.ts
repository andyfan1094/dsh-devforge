/**
 * 会话快照读取与排序单测。
 * 背景：0.41.6 及以前的「每次重启就新开会话」根因是这里读错字段——
 * sessionPersistence.list() 返回快照 { header, revision, sizeBytes }，身份在 snapshot.header.id，
 * 旧代码读 snapshot.id（恒 undefined）→ persistedIds 恒空 → resume 永不执行、create 一路退号。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { collectPersistedSessions, orderByRecentActivity, sessionActivityAt } from '../src/feishu/session-store-view.mjs'

const ID_A = 'session-feishu-v2-6753f05e66363c422bc8739ef6ef5050'
const ID_B = 'session-feishu-v2-5d5fd7dc084aa2eb866779ded1ed38f1'
const ID_C = 'session-feishu-v2-d7a188ca5411b9ca14fca5fdb27b181a'

test('快照归拢：身份在 snapshot.header.id 上，绝不能读成 snapshot.id（0.41.7 根因回归）', () => {
  const listed = collectPersistedSessions([
    { header: { id: ID_A, createdAt: 1000 }, revision: '1:2:3:4000000:5', sizeBytes: 10 },
    { header: { id: ID_B, createdAt: 2000 }, revision: '1:2:3:9000000:5', sizeBytes: 20 },
  ])
  assert.equal(listed.listed, true)
  assert.equal(listed.ids.size, 2)
  assert.equal(listed.ids.has(ID_A), true)
  assert.equal(listed.ids.has(ID_B), true)
  assert.equal(listed.ids.has('undefined'), false, '不能把 undefined 当身份收进来')
})

test('快照归拢：兼容裸 header 形状、跳过空身份、非数组视为未列出', () => {
  const bare = collectPersistedSessions([{ id: ID_A }, { header: {} }, { header: { id: '  ' } }, null])
  assert.equal(bare.listed, true)
  assert.deepEqual([...bare.ids], [ID_A])
  assert.equal(collectPersistedSessions(undefined).listed, false)
  assert.equal(collectPersistedSessions({}).listed, false)
})

test('活动时间：优先取 revision 里的 mtimeNs（纳秒→毫秒），退化到 createdAt，未知为 -1', () => {
  assert.equal(sessionActivityAt({ header: { id: ID_A, createdAt: 1000 }, revision: '11:22:33:7000000:44' }), 7)
  assert.equal(sessionActivityAt({ header: { createdAt: 1234 } }), 1234)
  assert.equal(sessionActivityAt({ header: { createdAt: 1234 }, revision: 'not-a-revision' }), 1234)
  assert.equal(sessionActivityAt(undefined), -1)
  assert.equal(sessionActivityAt({}), -1)
})

test('候选排序：最近活动的那条排最前（否则会接回最早的旧会话，最近几轮对话全丢）', () => {
  const listed = collectPersistedSessions([
    { header: { id: ID_A, createdAt: 19 }, revision: '1:1:1:19000000:1' },
    { header: { id: ID_B, createdAt: 23 }, revision: '1:1:1:23000000:1' },
    { header: { id: ID_C, createdAt: 21 }, revision: '1:1:1:21000000:1' },
  ])
  const ordered = orderByRecentActivity([ID_A, ID_C, ID_B], listed.byId)
  assert.deepEqual(ordered, [ID_B, ID_C, ID_A], '必须按最后活动时间倒序')
  // 磁盘上不存在的候选（快照缺失）排最后，不影响已有会话的取舍
  const withUnknown = orderByRecentActivity([ID_A, 'session-feishu-v2-unknown'], listed.byId)
  assert.equal(withUnknown[0], ID_A)
  assert.equal(withUnknown[1], 'session-feishu-v2-unknown')
})
