/** 飞书占用接管（fork）、会话代际与 /new 换代的针对性单测（2026-09-29 占用改造）。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildForkSeed, describeOccupier, forkCreateOptions, pickForkBoundary, readSessionEvents } from '../src/feishu/fork-takeover.mjs'
import { generationOfSessionId, withGeneration } from '../src/feishu/session-identity.mjs'
import { FeishuStore } from '../src/feishu/store.mjs'

const turnEnd = (seq) => ({ seq, type: 'turn/end', data: { reason: { kind: 'completed' } } })
const step = (seq) => ({ seq, type: 'assistant/message', data: { turn: 1, step: seq, message: { content: [{ type: 'text', text: '第' + seq + '步' }] } } })

test('pickForkBoundary：切到最后一个 turn/end 的下一位置', () => {
  const events = [step(0), turnEnd(1), step(2), step(3), turnEnd(4), step(5)]
  assert.equal(pickForkBoundary(events), 5)
})

test('pickForkBoundary：没有任何完成轮次时返回 -1（不能切出非法前缀）', () => {
  assert.equal(pickForkBoundary([step(0), step(1)]), -1)
  assert.equal(pickForkBoundary([]), -1)
  assert.equal(pickForkBoundary(undefined), -1)
})

test('buildForkSeed：有完成轮次 → complete=true 且含边界事件；无 → 空种子', () => {
  const events = [step(0), turnEnd(1), step(2), turnEnd(3), step(4)]
  const forked = buildForkSeed(events)
  assert.equal(forked.complete, true)
  assert.equal(forked.seed.length, 4)
  assert.equal(forked.seed.at(-1).type, 'turn/end')
  const open = buildForkSeed([step(0), step(1)])
  assert.deepEqual(open, { seed: [], complete: false })
})

test('forkCreateOptions：有种子带 parentSession/seedLength 血缘；空种子退化为全新会话', () => {
  const seed = [step(0), turnEnd(1)]
  const forked = forkCreateOptions({ sessionId: 's-new', seed, parentSessionId: 's-old', cwd: 'D:\\x', agentPreset: 'ptc', agentOptions: { a: 1 }, setup: () => {} })
  assert.equal(forked.sessionId, 's-new')
  assert.equal(forked.seed, seed)
  assert.equal(forked.meta.parentSession, 's-old')
  assert.equal(forked.meta.seedLength, 2)
  assert.equal(forked.meta.cwd, 'D:\\x')
  const fresh = forkCreateOptions({ sessionId: 's-new2', seed: [], parentSessionId: 's-old', cwd: 'D:\\x', agentPreset: 'ptc' })
  assert.equal(fresh.seed, undefined)
  assert.equal(fresh.meta.parentSession, undefined)
  assert.equal(fresh.meta.cwd, 'D:\\x')
})

test('withGeneration：gen=1 保持原号（存量兼容），gen>1 追加代际后缀', () => {
  const identity = '{"agentPreset":"ptc","cwd":"D:\\\\x"}'
  assert.equal(withGeneration(identity, 1), identity)
  assert.equal(withGeneration(identity, 0), identity)
  assert.equal(withGeneration(identity, 3), identity + ':gen-3')
})

test('generationOfSessionId：代际后缀往返解析一致，异常输入按 1 处理', () => {
  const identity = 'identity-json'
  for (const gen of [1, 2, 9]) assert.equal(generationOfSessionId(withGeneration(identity, gen)), gen)
  assert.equal(generationOfSessionId('session-feishu-v2-abc'), 1)
  assert.equal(generationOfSessionId(''), 1)
  assert.equal(generationOfSessionId(undefined), 1)
})

test('describeOccupier：宿主进程内有活体代理 → gui，否则 external；异常也归 external', () => {
  assert.equal(describeOccupier({ get: (id) => (id === 's1' ? { id: 's1' } : undefined) }, 's1'), 'gui')
  assert.equal(describeOccupier({ get: () => undefined }, 's1'), 'external')
  assert.equal(describeOccupier({}, 's1'), 'external')
  assert.equal(describeOccupier({ get: () => { throw new Error('boom') } }, 's1'), 'external')
})

test('readSessionEvents：只读句柄取事件流；服务/句柄异常返回 null 且 close 必被调用', async () => {
  const events = [step(0), turnEnd(1)]
  let closed = 0
  const good = {
    open: async (id, access) => {
      assert.equal(access, 'read')
      return { read: async () => ({ eventState: 'materialized', events }), close: async () => { closed += 1 } }
    },
  }
  assert.deepEqual(await readSessionEvents(good, 's1'), events)
  assert.equal(closed, 1)
  const bad = { open: async () => { throw new Error('occupied') } }
  assert.equal(await readSessionEvents(bad, 's1'), null)
  assert.equal(await readSessionEvents(null, 's1'), null)
  assert.equal(await readSessionEvents({}, 's1'), null)
})

test('FeishuStore：会话代际与插件归档持久化，代际不回退，重启后重算一致', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-feishu-store-test-'))
  try {
    const path = join(dir, 'dsh-feishu.json')
    const store = new FeishuStore({}, path)
    assert.equal(store.getChatGeneration('oc_a'), 1)
    store.setChatGeneration('oc_a', 2)
    // 代际单调不回退：误传更小值被拒——回退会把身份算回可能已归档的旧号。
    store.setChatGeneration('oc_a', 1)
    assert.equal(store.getChatGeneration('oc_a'), 2)
    store.archiveSessionId('oc_a', 'session-old-1')
    store.archiveSessionId('oc_a', 'session-old-1') // 去重
    store.archiveSessionId('oc_a', 'session-old-2')
    assert.deepEqual(store.extraArchivedIds('oc_a'), ['session-old-1', 'session-old-2'])
    assert.deepEqual(store.extraArchivedIds('oc_b'), [])
    // 模拟重启：用同一份盘上状态重建实例，代际与归档都还在。
    const reloaded = new FeishuStore({}, path)
    assert.equal(reloaded.getChatGeneration('oc_a'), 2)
    assert.deepEqual(reloaded.extraArchivedIds('oc_a'), ['session-old-1', 'session-old-2'])
    // 落盘 state 里只存会话号与代际数字，绝不携带任何凭据。
    const state = JSON.parse(readFileSync(path, 'utf8'))
    assert.equal(state.state.generations['oc_a'], 2)
    assert.deepEqual(state.state.archivedExtra['oc_a'], ['session-old-1', 'session-old-2'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
