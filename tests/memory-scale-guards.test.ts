/**
 * 记忆规模护栏测试（0.43.0）。
 *
 * 两条都来自生产实况：
 * - memory.audit 9485 条无界增长（trimDomain 本就写好、只是从没被 audit 调用）；
 * - 语义召回候选被 list({limit:1000}) 硬截断——4825 条记忆里只有最近 1000 条能被语义命中，
 *   其余永远搜不到（词法侧是全量扫，所以现象是「同一条记忆有时搜得到有时搜不到」）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RagStore } from '../src/rag/rag-store.ts'
import { closeAllDb } from '../src/store/db.ts'
import { NativeMemoryStore } from '../src/memory/native.ts'
import { MemoryGovernanceService, MEMORY_AUDIT_DOMAIN } from '../src/memory/governance.ts'

function makeRig(): { store: NativeMemoryStore; governance: MemoryGovernanceService; ragStore: RagStore; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-mem-scale-'))
  const ragStore = new RagStore(join(dir, 'store.db'), join(dir, 'rag-vec.db'))
  const store = new NativeMemoryStore(ragStore)
  return { store, governance: new MemoryGovernanceService(ragStore, store), ragStore, dir }
}

function cleanup(dir: string): void {
  // RagStore 同时持有主库与 rag-vec.db 双连接，统一全关再删目录（Windows 句柄未关删不掉）。
  closeAllDb()
  rmSync(dir, { recursive: true, force: true })
}

test('审计域裁剪：节流触发后一次收敛到上限，且从最旧一端删起', () => {
  const { governance, ragStore, dir } = makeRig()
  try {
    // 造 2600 条历史审计，模拟生产实况的无界增长（生产重启时实测 9563 条）。
    for (let index = 0; index < 2600; index += 1) {
      ragStore.putDomainDoc(MEMORY_AUDIT_DOMAIN, 'audit-seed-' + index, { id: 'audit-seed-' + index, action: 'seed', ids: [], reason: '', createdAt: index })
    }
    assert.equal(ragStore.listDomainDocs(MEMORY_AUDIT_DOMAIN).length, 2600)
    // 20 次真实审计写入 = 一个节流窗口（AUDIT_TRIM_EVERY）。
    for (let index = 0; index < 20; index += 1) {
      governance.propose({ content: '审计裁剪测试条目 ' + index, scope: { kind: 'global' }, source: 'session-reflection', sourceId: 'trim:' + index })
    }
    const rows = ragStore.listDomainDocs(MEMORY_AUDIT_DOMAIN)
    // 2600 历史 + 20 新写 → 一次裁剪收敛到上限 2000：存量积压必须一次清掉，
    // 否则「单次限删 500」会让近万条的存量要上千次写入才回落，等于修复很久以后才生效。
    assert.equal(rows.length, 2000)
    // 裁掉的是最旧的一批（createdAt 最小），最新写入与近期历史保留。
    assert.equal(rows.some((row) => row.id === 'audit-seed-0'), false)
    assert.equal(rows.some((row) => row.id === 'audit-seed-2599'), true)
  } finally { cleanup(dir) }
})

test('语义召回候选：解除 1000 条截断，千条以上的旧记忆不再被排除', () => {
  const { store, dir } = makeRig()
  try {
    for (let index = 0; index < 1005; index += 1) {
      store.create({ content: '记忆条目 ' + index, category: 'fact', source: 'test', importance: 3 })
    }
    // 旧路径仍按原口径截断（其它调用方依赖），但语义召回走全量。
    assert.equal(store.list({ limit: 1000 }).length, 1000)
    assert.equal(store.listForSemanticRecall().length, 1005)
  } finally { cleanup(dir) }
})
