/**
 * 记忆写入契约测试（0.43.0 P1-4 / P1-7，契约移植自灵枢 dsh-memory）：
 * - `committed` 语义：`ok` 只表示工具执行没出错，`committed` 才表示记忆真的落盘；
 * - 可修正的拒绝：写入被拒必须给出能照着补的 `missing` 清单。
 * 全部使用临时库，零网络。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RagStore } from '../src/rag/rag-store.ts'
import { closeAllDb } from '../src/store/db.ts'
import { NativeMemoryStore } from '../src/memory/native.ts'
import { MemoryGovernanceService } from '../src/memory/governance.ts'
import { memoryManageTool } from '../src/memory/tools.ts'
import { checkMemoryAdmission } from '../src/memory/admission.ts'

/** 每个用例独立临时库；工具接治理服务，走与生产一致的写入路径。 */
function makeRig(): { store: NativeMemoryStore; tool: any; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-mem-admission-'))
  const ragStore = new RagStore(join(dir, 'store.db'), join(dir, 'rag-vec.db'))
  const store = new NativeMemoryStore(ragStore)
  const governance = new MemoryGovernanceService(ragStore, store)
  const tool = memoryManageTool(store, { governance, scopeOfAgent: () => ({ kind: 'global' }) })
  return { store, tool, dir }
}

function cleanup(dir: string): void {
  // RagStore 同时打开主库与 rag-vec.db，统一全关再删目录（Windows 句柄未关删不掉）。
  closeAllDb()
  rmSync(dir, { recursive: true, force: true })
}

test('受理闸门：只拦没有信息量的内容，不拦短事实', () => {
  for (const content of ['', '   ', '好的', '嗯嗯', '。。。', '!!']) {
    const result = checkMemoryAdmission({ content })
    assert.equal(result.admitted, false, '「' + content + '」不该被认为是可写入的记忆')
    assert.ok(result.missing.length > 0, '拒绝必须给出缺失清单')
  }
  // 「重启生产」只有 4 个有效字符，但它是确凿事实——闸门只拦没有信息量的内容。
  assert.equal(checkMemoryAdmission({ content: '重启生产' }).admitted, true)
  assert.equal(checkMemoryAdmission({ content: '构建命令是 pnpm build' }).admitted, true)
})

test('P1-7 可修正的拒绝：save 被拒时返回可照做的 missing 清单', async () => {
  const { tool, dir } = makeRig()
  try {
    const rejected = await tool.execute({ action: 'save', content: '好的' }, {})
    assert.equal(rejected.ok, false)
    assert.equal(rejected.committed, false, '被拒的写入绝不能标成已落盘')
    assert.ok(rejected.missing.some((item: string) => item.includes('content')), '要指明缺哪个字段')
    assert.ok(rejected.missing.some((item: string) => item.includes('至少')), '要说明补到什么程度')
    // 拒绝必须真的没落盘。
    const listed = await tool.execute({ action: 'list' }, {})
    assert.equal(listed.count, 0)
  } finally { cleanup(dir) }
})

test('P1-4 committed 语义：ok 不等于记住，重复写入明确报未新增', async () => {
  const { tool, dir } = makeRig()
  try {
    const first = await tool.execute({ action: 'save', content: '构建命令是 pnpm build', category: 'fact' }, {})
    assert.equal(first.committed, true, '真正落盘才允许 committed:true')
    assert.ok(first.entry !== undefined)
    // 同一内容再存一次：工具执行没出错（ok:true），但记忆并没有新增。
    const second = await tool.execute({ action: 'save', content: '构建命令是 pnpm build', category: 'fact' }, {})
    assert.equal(second.ok, true, '重复不算工具错误')
    assert.equal(second.committed, false, '重复写入绝不能报成保存成功')
    assert.equal(second.pendingReason, 'duplicate')
    assert.equal(second.entry.id, first.entry.id, '要回指已有的那条记忆')
    const listed = await tool.execute({ action: 'list' }, {})
    assert.equal(listed.count, 1, '重复写入不得产生第二条记忆')
  } finally { cleanup(dir) }
})

test('P1-4 committed 语义：读操作不谎报落盘，写操作逐条如实标注', async () => {
  const { tool, dir } = makeRig()
  try {
    const listed = await tool.execute({ action: 'list' }, {})
    assert.equal(listed.committed, undefined, '读操作不涉及落盘，不该给 committed')
    const saved = await tool.execute({ action: 'save', content: '辉哥的偏好是每轮回复都要称呼辉哥' }, {})
    assert.equal(saved.committed, true)
    // 更新为新内容才真的落盘；只改 importance 时治理层判定为同一事实（内容未变）而不重复落盘。
    const updated = await tool.execute({ action: 'update', id: saved.entry.id, content: '辉哥要求每轮回复都必须称呼他为辉哥' }, {})
    assert.equal(updated.committed, true)
    // 归档是不可逆状态变更，必须有用户原话证据；测试里没有，因此只能拿到「未落盘 + 缺什么」。
    const deleted = await tool.execute({ action: 'delete', id: saved.entry.id }, {})
    assert.equal(deleted.committed, false, '未通过用户确认校验的归档不得标成已落盘')
    assert.ok(deleted.missing.some((item: string) => item.includes('用户确认')), '要说明缺的是用户确认')
  } finally { cleanup(dir) }
})
