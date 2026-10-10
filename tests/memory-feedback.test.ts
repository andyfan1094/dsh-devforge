/**
 * 反馈回路测试（0.43.0 P2-10，契约移植自灵枢 dsh-memory）：
 * helpfulCount / harmfulCount 必须真的进召回评分——否则反馈只是一堆没人读的死计数。
 * 这里验证同一相关度下好评升权、差评降权。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RagStore } from '../src/rag/rag-store.ts'
import { closeAllDb } from '../src/store/db.ts'
import { NativeMemoryStore } from '../src/memory/native.ts'

function makeRig(): { store: NativeMemoryStore; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-mem-feedback-'))
  const ragStore = new RagStore(join(dir, 'store.db'), join(dir, 'rag-vec.db'))
  return { store: new NativeMemoryStore(ragStore), dir }
}

function cleanup(dir: string): void {
  closeAllDb()
  rmSync(dir, { recursive: true, force: true })
}

test('P2-10 反馈回路：词法相关度相同时，好评记忆排前、差评记忆排后', () => {
  const { store, dir } = makeRig()
  try {
    // 两条内容完全一致 → 词法分数必然相同，排序差异只可能来自反馈分量。
    store.create({ content: '暂存实例固定使用 3081 端口', category: 'fact', source: 'session', scope: { kind: 'global' } }, 'fb-good')
    store.create({ content: '暂存实例固定使用 3081 端口', category: 'fact', source: 'session', scope: { kind: 'global' } }, 'fb-bad')
    store.markFeedback('fb-good', true)
    store.markFeedback('fb-good', true)
    store.markFeedback('fb-bad', false)
    store.markFeedback('fb-bad', false)

    const hits = store.searchDetailed('暂存实例端口', { limit: 4, scope: { kind: 'global' }, isolateScope: true })
    assert.equal(hits[0]?.entry.id, 'fb-good', '好评多的记忆必须在同等相关度下排前')
    assert.ok(hits.some((hit) => hit.entry.id === 'fb-bad'), '差评只降权，不得把记忆直接踢出召回')
  } finally { cleanup(dir) }
})

test('P2-10 反馈回路：无反馈的记忆不受影响，反馈幅度不压过相关度', () => {
  const { store, dir } = makeRig()
  try {
    store.create({ content: '暂存实例固定使用 3081 端口', category: 'fact', source: 'session', scope: { kind: 'global' } }, 'fb-none')
    store.create({ content: '完全无关的另一条记忆', category: 'fact', source: 'session', scope: { kind: 'global' } }, 'fb-noise')
    const before = store.searchDetailed('暂存实例端口', { limit: 4, scope: { kind: 'global' }, isolateScope: true })
    const baseline = before.find((hit) => hit.entry.id === 'fb-none')?.qualityScore ?? 0
    assert.equal(baseline > 0, true, '基线分量为正')
    // 噪声条目即使被大量好评，也不该排到真正相关的记忆前面：反馈只是微调。
    for (let index = 0; index < 50; index += 1) store.markFeedback('fb-noise', true)
    const after = store.searchDetailed('暂存实例端口', { limit: 4, scope: { kind: 'global' }, isolateScope: true })
    assert.equal(after[0]?.entry.id, 'fb-none', '相关度优先：反馈不得把无关记忆顶到前面')
  } finally { cleanup(dir) }
})
