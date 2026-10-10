/**
 * 显式遗忘与双时间轴测试（0.43.0 P2-11，契约移植自灵枢 dsh-memory）：
 * 记忆有两条时间轴——写入时间（createdAt/updatedAt）与有效期（validUntil）。
 * 到期只表示「不再用它」，不是抹掉记录：条目仍在库里可追溯，这是可审计的遗忘。
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
  const dir = mkdtempSync(join(tmpdir(), 'dsh-mem-forget-'))
  const ragStore = new RagStore(join(dir, 'store.db'), join(dir, 'rag-vec.db'))
  return { store: new NativeMemoryStore(ragStore), dir }
}

function cleanup(dir: string): void {
  closeAllDb()
  rmSync(dir, { recursive: true, force: true })
}

test('P2-11 双时间轴遗忘：validUntil 到期的记忆不再召回，但记录仍可追溯', () => {
  const { store, dir } = makeRig()
  try {
    const past = Date.now() - 60_000
    const future = Date.now() + 3_600_000
    store.create({ content: '暂存实例旧端口是 3081', category: 'fact', source: 'session', scope: { kind: 'global' }, validUntil: past }, 'vg-old')
    store.create({ content: '暂存实例新端口是 8081', category: 'fact', source: 'session', scope: { kind: 'global' }, validUntil: future }, 'vg-new')

    const hits = store.searchDetailed('暂存实例端口', { limit: 4, scope: { kind: 'global' }, isolateScope: true })
    assert.ok(!hits.some((hit) => hit.entry.id === 'vg-old'), '过期记忆不得再进召回（否则旧端口会冒充现状）')
    assert.ok(hits.some((hit) => hit.entry.id === 'vg-new'), '未过期记忆照常召回')

    // 遗忘是「不再用它」，不是抹掉记录：条目仍在库里，可追溯、可审计。
    assert.ok(store.get('vg-old') !== undefined, '过期不等于删除，记录必须保留')
    assert.equal(store.get('vg-old')?.validUntil, past, '有效期本身也要留存，便于解释为什么失效')
  } finally { cleanup(dir) }
})

test('P2-11 显式遗忘：归档后不再召回，取消归档即可恢复', () => {
  const { store, dir } = makeRig()
  try {
    store.create({ content: '暂存实例固定使用 3081 端口', category: 'fact', source: 'session', scope: { kind: 'global' } }, 'arc-1')
    store.archive('arc-1', true)
    assert.ok(!store.searchDetailed('暂存实例端口', { limit: 4, scope: { kind: 'global' }, isolateScope: true }).some((hit) => hit.entry.id === 'arc-1'), '归档后必须退出召回')
    assert.ok(store.get('arc-1') !== undefined, '软归档不是删除，记录仍在')
    store.archive('arc-1', false)
    assert.ok(store.searchDetailed('暂存实例端口', { limit: 4, scope: { kind: 'global' }, isolateScope: true }).some((hit) => hit.entry.id === 'arc-1'), '取消归档后恢复召回')
  } finally { cleanup(dir) }
})
