/**
 * kb_manage 回归（2026-10-19）。
 *
 * 背景：模型侧此前只有 rag_search（只读检索）与 memory_manage（只管内置长期记忆），
 * 知识库文档没有写入路径，模型只能回一句「那条文档是只读的、改不了」。
 * 本文件锁住四件事：
 *   1. 各 action 的真实行为（list/docs/read/ingest/delete/restore）；
 *   2. 写权限护栏：只有 manual 可写，其余来源拒写**且给出正确原因**、**且确实没写进去**
 *      （只断言错误文案的用例挡不住「先写后拒」的实现突变，故一律加负面断言）；
 *   3. 安全装置：覆盖/删除前留快照（restore 可写回）、写审计（含失败）、内容未变短路、
 *      快照保留上限、写入频率闸门、参数校验、歧义拒绝；
 *   4. 读回正文不得因切块 overlap 而重复（readDocText 按绝对行号重建的回归）。
 *
 * 全部使用 FakeEmbedder 与临时目录，不调真实 API、不碰生产库。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeAllDb } from '../src/store/db.ts'
import { RagStore } from '../src/rag/rag-store.ts'
import { RagService, KB_BACKUP_KEEP, type RagEmbedder } from '../src/rag/service.ts'
import { kbManageTool } from '../src/rag/kb-tools.ts'

/** 伪向量化器：同文本同向量（确定性，无网络）。 */
class FakeEmbedder implements RagEmbedder {
  async embed(texts: string[], _model?: string): Promise<Float32Array[]> {
    return texts.map(t => this.vectorOf(t))
  }
  async embedQuery(text: string, _model?: string): Promise<Float32Array> {
    return this.vectorOf(text)
  }
  private vectorOf(text: string): Float32Array {
    const code = text.codePointAt(0) ?? 0
    return Float32Array.from([((code % 97) + 1) / 98, 0.2, 0.3, 0.4])
  }
}

/** 必失败的向量化器（只在需要验证失败路径时替换进去）。 */
class FailingEmbedder implements RagEmbedder {
  async embed(): Promise<Float32Array[]> { throw new Error('模拟嵌入失败') }
  async embedQuery(): Promise<Float32Array> { throw new Error('模拟嵌入失败') }
}

interface Env {
  service: RagService
  store: RagStore
  tool: any
  /** 可替换的渠道表（service 持有其引用，换实现即刻生效）。 */
  embedders: Record<string, RagEmbedder>
}

function makeEnv(): Env {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-kb-manage-'))
  const store = new RagStore(join(dir, 'main.db'), join(dir, 'vec.db'))
  const fake = new FakeEmbedder()
  const embedders: Record<string, RagEmbedder> = { zhipu: fake, ark: fake, 'openai-gateway': fake, siliconflow: fake }
  const service = new RagService(store, embedders)
  return { service, store, tool: kbManageTool(service) as any, embedders }
}

/** 造一段会产生多切块（含 overlap）的长文。 */
function longText(lines: number): string {
  return Array.from({ length: lines }, (_, i) => '第' + i + '行 ' + 'x'.repeat(40)).join('\n')
}

function backupsOf(store: RagStore): Array<{ id: string; data: any }> {
  return store.listDomainDocs('rag.backup') as Array<{ id: string; data: any }>
}

function auditsOf(store: RagStore): Array<{ data: any }> {
  return store.listDomainDocs('rag.audit') as Array<{ data: any }>
}

test('kb_manage list：列出知识库并标出可写性', async () => {
  const { service, tool } = makeEnv()
  service.createKb('手写库')
  service.createKb('项目库', { source: 'project' })
  service.createKb('镜像库', { source: 'mirror' })
  service.createKb('记忆库', { source: 'memory' })

  const result = await tool.execute({ action: 'list' })
  assert.equal(result.ok, true)
  assert.equal(result.kbs.length, 4)
  // 模型选库全靠这几个字段，须逐个断言，不能只看 writable
  const manual = result.kbs.find((kb: any) => kb.name === '手写库')
  assert.equal(manual.source, 'manual')
  assert.equal(manual.docCount, 0)
  assert.equal(manual.writable, true)
  assert.equal(typeof manual.id, 'string')
  assert.equal(result.kbs.find((kb: any) => kb.name === '项目库').source, 'project')
  const writable = Object.fromEntries(result.kbs.map((kb: any) => [kb.name, kb.writable]))
  assert.deepEqual(writable, { 手写库: true, 项目库: false, 镜像库: false, 记忆库: false })
  closeAllDb()
})

test('kb_manage ingest/read/docs：写入 manual 库、按 docId 与文件名读回', async () => {
  const { service, tool } = makeEnv()
  const kb = service.createKb('手写库')

  const created = await tool.execute({ action: 'ingest', kb: '手写库', fileName: '说明.md', text: '# 标题\n\n正文内容。' })
  assert.equal(created.ok, true)
  assert.equal(created.written.mode, 'created')
  assert.equal(created.written.fileName, '说明.md')
  assert.equal(created.written.backupId, undefined)

  const byKb = await tool.execute({ action: 'docs', kb: kb.id })
  assert.equal(byKb.ok, true)
  assert.equal(byKb.docs.length, 1)
  assert.equal(byKb.docs[0].fileName, '说明.md')
  assert.equal(byKb.docs[0].status, 'ready')
  assert.equal(byKb.docs[0].chunks > 0, true)

  const byDocId = await tool.execute({ action: 'read', docId: created.written.docId })
  assert.equal(byDocId.ok, true)
  assert.match(byDocId.doc.text, /正文内容/)
  assert.equal(byDocId.doc.truncated, false)

  const byName = await tool.execute({ action: 'read', kb: '手写库', fileName: '说明.md' })
  assert.equal(byName.ok, true)
  assert.match(byName.doc.text, /标题/)
  closeAllDb()
})

test('kb_manage read：长文按窗口截断并可用 nextOffset 续读', async () => {
  const { service, tool } = makeEnv()
  service.createKb('手写库')
  const text = longText(40) // 约 1800 字，足够多窗口
  await tool.execute({ action: 'ingest', kb: '手写库', fileName: 'long.md', text })

  const first = await tool.execute({ action: 'read', kb: '手写库', fileName: 'long.md', limit: 100 })
  assert.equal(first.ok, true)
  assert.equal(first.doc.text.length, 100)
  assert.equal(first.doc.truncated, true)
  assert.equal(first.doc.nextOffset, 100)

  const second = await tool.execute({ action: 'read', kb: '手写库', fileName: 'long.md', offset: first.doc.nextOffset, limit: 100 })
  assert.equal(second.doc.text.length, 100)
  assert.notEqual(first.doc.text, second.doc.text)

  const all = await tool.execute({ action: 'read', kb: '手写库', fileName: 'long.md', limit: 40000 })
  assert.equal(all.doc.truncated, false)
  assert.equal(all.doc.text, text)
  closeAllDb()
})

test('kb_manage read：重叠切块重建正文不得重复内容（回归）', async () => {
  const { service, tool } = makeEnv()
  service.createKb('手写库')
  // 每行约 46 字，200 行约 9200 字 → 512/64 参数下必然多块且相邻块重叠
  const text = longText(200)
  const written = await tool.execute({ action: 'ingest', kb: '手写库', fileName: 'big.md', text })
  assert.ok(written.written.chunks > 1, '需产生多切块才能验证重叠重建')

  const read = await tool.execute({ action: 'read', kb: '手写库', fileName: 'big.md', limit: 40000 })
  assert.equal(read.ok, true)
  // 关键断言：直接拼接切块会把 overlap 区重复一份，长度会明显超出；此处必须与原文一致
  assert.equal(read.doc.chars, text.length)
  assert.equal(read.doc.text, text)
  closeAllDb()
})

test('kb_manage read：越界偏移给出明确错误而不是空正文', async () => {
  const { service, tool } = makeEnv()
  service.createKb('手写库')
  await tool.execute({ action: 'ingest', kb: '手写库', fileName: 'a.md', text: '短正文' })

  const beyond = await tool.execute({ action: 'read', kb: '手写库', fileName: 'a.md', offset: 999999 })
  assert.equal(beyond.ok, false)
  assert.match(beyond.message, /超出/)
  closeAllDb()
})

test('kb_manage ingest：同名覆盖留可回滚快照并记审计', async () => {
  const { service, store, tool } = makeEnv()
  const kb = service.createKb('手写库')

  await tool.execute({ action: 'ingest', kb: '手写库', fileName: 'doc.md', text: 'A 版正文' })
  const overwritten = await tool.execute({ action: 'ingest', kb: '手写库', fileName: 'doc.md', text: 'B 版正文' })
  assert.equal(overwritten.ok, true)
  assert.equal(overwritten.written.mode, 'overwritten')
  assert.equal(typeof overwritten.written.backupId, 'string')

  assert.equal(service.listDocs(kb.id).length, 1)
  const read = await tool.execute({ action: 'read', kb: '手写库', fileName: 'doc.md' })
  assert.equal(read.doc.text, 'B 版正文')

  // 快照里是覆盖前的原文（可回滚）
  const backups = backupsOf(store)
  assert.equal(backups.length, 1)
  assert.equal(backups[0].data.text, 'A 版正文')
  assert.equal(backups[0].data.docId, overwritten.written.docId)

  // 审计只记元数据（不记正文），两次写入各一条且都是 ok
  const audits = auditsOf(store)
  assert.equal(audits.length, 2)
  assert.equal(audits[0].data.action, 'ingest')
  assert.equal(audits[0].data.actor, 'model')
  assert.equal(audits[0].data.result, 'ok')
  assert.equal(audits[0].data.textChars, 5)
  assert.equal(JSON.stringify(audits).includes('A 版正文'), false)
  closeAllDb()
})

test('kb_manage restore：用快照把覆盖过的正文真的写回', async () => {
  const { service, tool } = makeEnv()
  const kb = service.createKb('手写库')

  await tool.execute({ action: 'ingest', kb: '手写库', fileName: 'doc.md', text: '第一版' })
  const second = await tool.execute({ action: 'ingest', kb: '手写库', fileName: 'doc.md', text: '第二版' })
  assert.equal(second.written.mode, 'overwritten')

  const restored = await tool.execute({ action: 'restore', backupId: second.written.backupId })
  assert.equal(restored.ok, true)
  assert.equal(restored.written.mode, 'restored')
  assert.equal(restored.written.restoredFrom, second.written.backupId)

  const read = await tool.execute({ action: 'read', kb: '手写库', fileName: 'doc.md' })
  assert.equal(read.doc.text, '第一版')
  assert.equal(service.listDocs(kb.id).length, 1)
  closeAllDb()
})

test('kb_manage restore：能把删除掉的文档写回', async () => {
  const { service, tool } = makeEnv()
  const kb = service.createKb('手写库')
  const written = await tool.execute({ action: 'ingest', kb: '手写库', fileName: 'gone.md', text: '删前正文' })
  const deleted = await tool.execute({ action: 'delete', docId: written.written.docId })
  assert.equal(service.listDocs(kb.id).length, 0)

  const restored = await tool.execute({ action: 'restore', backupId: deleted.deleted.backupId })
  assert.equal(restored.ok, true)
  assert.equal(service.listDocs(kb.id).length, 1)
  const read = await tool.execute({ action: 'read', kb: '手写库', fileName: 'gone.md' })
  assert.equal(read.doc.text, '删前正文')
  closeAllDb()
})

test('kb_manage restore：非 manual 库的快照同样拒写', async () => {
  const { service, store, tool } = makeEnv()
  const project = service.createKb('项目库', { source: 'project' })
  const doc = await service.ingestText(project.id, 'src/a.cs', '源码内容', { sourcePath: 'src/a.cs' })
  // 直接伪造一份属于项目库的快照，模拟"有人想用快照改项目库副本"
  const backupId = service.snapshotDocText({ kbId: project.id, docId: doc.id, fileName: 'src/a.cs', text: '伪造原文', reason: '测试' })

  const restored = await tool.execute({ action: 'restore', backupId })
  assert.equal(restored.ok, false)
  assert.match(restored.message, /source=project/)
  // 项目库文档正文未被改动
  assert.equal(service.readDocText(doc.id), '源码内容')
  assert.equal(backupsOf(store).length, 1)
  closeAllDb()
})

test('kb_manage ingest：内容与库中一致时短路（不留快照、不记写审计）', async () => {
  const { service, store, tool } = makeEnv()
  service.createKb('手写库')
  await tool.execute({ action: 'ingest', kb: '手写库', fileName: 'doc.md', text: '同样的正文' })
  const auditsBefore = auditsOf(store).length

  const again = await tool.execute({ action: 'ingest', kb: '手写库', fileName: 'doc.md', text: '同样的正文' })
  assert.equal(again.ok, true)
  assert.equal(again.written.mode, 'unchanged')
  assert.equal(backupsOf(store).length, 0, '未改动不应留快照')
  assert.equal(auditsOf(store).length, auditsBefore, '未改动不应记写审计')
  closeAllDb()
})

test('kb_manage ingest：写入失败时库内内容不变，但留失败审计', async () => {
  const { service, store, tool, embedders } = makeEnv()
  const kb = service.createKb('手写库')
  await tool.execute({ action: 'ingest', kb: '手写库', fileName: 'doc.md', text: '好版本' })

  // 换成必失败的向量化器：新正文未嵌过，必然真的调嵌入并抛错
  embedders.zhipu = new FailingEmbedder()
  const failed = await tool.execute({ action: 'ingest', kb: '手写库', fileName: 'doc.md', text: '坏版本绝不会落库' })
  assert.equal(failed.ok, false)
  assert.match(failed.message, /写入失败/)

  // 正文未变
  assert.equal(service.readDocText(service.listDocs(kb.id)[0]!.id), '好版本')
  // 失败也要留痕，否则事后分不清"没写"与"写了但失败"
  const failedRows = auditsOf(store).filter((row) => row.data.result === 'failed')
  assert.equal(failedRows.length, 1)
  assert.equal(failedRows[0].data.fileName, 'doc.md')
  closeAllDb()
})

test('kb_manage 护栏：project 库拒写并指向源文件，且正文与条数都没动', async () => {
  const { service, tool } = makeEnv()
  const kb = service.createKb('均辉-ExpressWebApi', { source: 'project' })
  await service.ingestText(kb.id, 'src/a.cs', '源码内容', { sourcePath: 'src/a.cs' })

  const ingest = await tool.execute({ action: 'ingest', kb: '均辉-ExpressWebApi', fileName: 'src/a.cs', text: '改一改' })
  assert.equal(ingest.ok, false)
  assert.match(ingest.message, /source=project/)
  assert.match(ingest.message, /项目索引器/)
  assert.match(ingest.message, /源文件/)

  const del = await tool.execute({ action: 'delete', kb: '均辉-ExpressWebApi', fileName: 'src/a.cs' })
  assert.equal(del.ok, false)
  assert.match(del.message, /source=project/)

  // 条数、正文、contentHash 三重负面断言：只断文案挡不住"先写后拒"
  const docs = service.listDocs(kb.id)
  assert.equal(docs.length, 1)
  assert.equal(docs[0].fileName, 'src/a.cs')
  assert.equal(service.readDocText(docs[0].id), '源码内容')
  assert.equal(docs[0].contentHash, service.listDocs(kb.id)[0]!.contentHash)
  closeAllDb()
})

test('kb_manage 护栏：mirror 库拒写并指向外部源，且确实没写进去', async () => {
  const { service, tool } = makeEnv()
  const kb = service.createKb('Mnemon 镜像', { source: 'mirror' })
  const doc = await service.ingestText(kb.id, 'a.md', '镜像原文')

  const result = await tool.execute({ action: 'ingest', kb: 'Mnemon 镜像', fileName: 'a.md', text: '篡改' })
  assert.equal(result.ok, false)
  assert.match(result.message, /source=mirror/)
  assert.match(result.message, /外部源/)
  // 负面断言：正文没被改，条数没变
  assert.equal(service.listDocs(kb.id).length, 1)
  assert.equal(service.readDocText(doc.id), '镜像原文')

  const del = await tool.execute({ action: 'delete', kb: 'Mnemon 镜像', fileName: 'a.md' })
  assert.equal(del.ok, false)
  assert.equal(service.listDocs(kb.id).length, 1)
  closeAllDb()
})

test('kb_manage 护栏：memory 库拒写、说明归因已变并指向 memory_manage，且确实没写进去', async () => {
  const { service, tool } = makeEnv()
  const kb = service.createKb('会话记忆库', { source: 'memory' })
  const doc = await service.ingestText(kb.id, 'x.md', '历史沉淀原文')

  // 即便文件名给错，也要先讲清"这库归谁管"，而不是回一句"未找到文档"
  const wrongName = await tool.execute({ action: 'delete', kb: '会话记忆库', fileName: 'not-here.md' })
  assert.equal(wrongName.ok, false)
  assert.match(wrongName.message, /source=memory/)
  assert.match(wrongName.message, /memory_manage/)

  const result = await tool.execute({ action: 'ingest', kb: '会话记忆库', fileName: 'x.md', text: '篡改' })
  assert.equal(result.ok, false)
  assert.match(result.message, /memory_manage/)
  // 归因不得再说"由沉淀层写入"（该路径在当前接线下已停用）
  assert.equal(result.message.includes('由会话记忆沉淀层写入'), false)
  // 负面断言：确实没写进去
  assert.equal(service.listDocs(kb.id).length, 1)
  assert.equal(service.readDocText(doc.id), '历史沉淀原文')
  closeAllDb()
})

test('kb_manage 护栏：docId 跨库也拦得住（项目库文档 + docId）', async () => {
  const { service, tool } = makeEnv()
  const project = service.createKb('项目库', { source: 'project' })
  const manual = service.createKb('手写库')
  const projectDoc = await service.ingestText(project.id, 'src/a.cs', '源码内容', { sourcePath: 'src/a.cs' })

  // 只给 docId：按文档真实归属判库，仍被拒
  const byDocId = await tool.execute({ action: 'delete', docId: projectDoc.id })
  assert.equal(byDocId.ok, false)
  assert.match(byDocId.message, /source=project/)

  // kb 指向 manual、docId 指向 project：docId 优先，按 project 拒，且不能误删 manual 里的东西
  const mixed = await tool.execute({ action: 'delete', kb: '手写库', docId: projectDoc.id })
  assert.equal(mixed.ok, false)
  assert.match(mixed.message, /source=project/)

  assert.equal(service.listDocs(project.id).length, 1)
  assert.equal(service.readDocText(projectDoc.id), '源码内容')
  assert.equal(service.listDocs(manual.id).length, 0)
  closeAllDb()
})

test('kb_manage 歧义：同名知识库拒绝静默命中，要求用 id', async () => {
  const { service, tool } = makeEnv()
  service.createKb('资料库', { source: 'project' })
  const manualKb = service.createKb('资料库', { source: 'manual' })

  const ambiguous = await tool.execute({ action: 'ingest', kb: '资料库', fileName: 'a.md', text: '正文' })
  assert.equal(ambiguous.ok, false)
  assert.match(ambiguous.message, /无法唯一定位/)
  assert.ok(ambiguous.message.includes(manualKb.id), '错误里应给出可用的 id')
  // 没有写进任何一个库
  assert.equal(service.listDocs(manualKb.id).length, 0)

  // 指定 id 就能正常写
  const byId = await tool.execute({ action: 'ingest', kb: manualKb.id, fileName: 'a.md', text: '正文' })
  assert.equal(byId.ok, true)
  closeAllDb()
})

test('kb_manage 歧义：同库同名文档拒绝静默删错，要求用 docId', async () => {
  const { service, store, tool } = makeEnv()
  const kb = service.createKb('手写库')
  await service.ingestText(kb.id, 'dup.md', '第一条')
  // 伪造一条历史脏数据：同库同名、不同 id
  store.putDoc({
    id: 'legacy-dup',
    kbId: kb.id,
    fileName: 'dup.md',
    contentHash: 'deadbeef',
    status: 'ready',
    chunkCount: 0,
    createdAt: Date.now(),
  })

  const result = await tool.execute({ action: 'delete', kb: '手写库', fileName: 'dup.md' })
  assert.equal(result.ok, false)
  assert.match(result.message, /同名/)
  assert.match(result.message, /docId/)
  assert.equal(service.listDocs(kb.id).length, 2, '不得删掉任何一条')

  // 用 docId 就能精确删
  const precise = await tool.execute({ action: 'delete', docId: 'legacy-dup' })
  assert.equal(precise.ok, true)
  assert.equal(service.listDocs(kb.id).length, 1)
  closeAllDb()
})

test('kb_manage 护栏：写入频率闸门拒绝窗口内超限写入', async () => {
  const { service, tool } = makeEnv()
  service.createKb('手写库')
  for (let i = 0; i < 10; i++) {
    const ok = await tool.execute({ action: 'ingest', kb: '手写库', fileName: 'f' + i + '.md', text: '正文' + i })
    assert.equal(ok.ok, true, '第 ' + (i + 1) + ' 次写入应当成功')
  }
  const blocked = await tool.execute({ action: 'ingest', kb: '手写库', fileName: 'f10.md', text: '正文10' })
  assert.equal(blocked.ok, false)
  assert.match(blocked.message, /过于频繁/)
  assert.equal(service.listDocs(service.listKbs()[0]!.id).length, 10)
  closeAllDb()
})

test('kb_manage 参数校验：空正文、缺文档名、超长正文、未知库均被拒', async () => {
  const { service, tool } = makeEnv()
  service.createKb('手写库')

  const emptyText = await tool.execute({ action: 'ingest', kb: '手写库', fileName: 'a.md', text: '   ' })
  assert.equal(emptyText.ok, false)
  assert.match(emptyText.message, /text 必填/)

  const noName = await tool.execute({ action: 'ingest', kb: '手写库', text: '正文' })
  assert.equal(noName.ok, false)
  assert.match(noName.message, /fileName/)

  const tooLong = await tool.execute({ action: 'ingest', kb: '手写库', fileName: 'a.md', text: 'x'.repeat(200001) })
  assert.equal(tooLong.ok, false)
  assert.match(tooLong.message, /超过单篇上限/)

  const noKb = await tool.execute({ action: 'ingest', kb: '没有这个库', fileName: 'a.md', text: '正文' })
  assert.equal(noKb.ok, false)
  assert.match(noKb.message, /未找到知识库/)
  closeAllDb()
})

test('kb_manage delete：删除 manual 库文档并留快照与审计', async () => {
  const { service, store, tool } = makeEnv()
  const kb = service.createKb('手写库')
  const written = await tool.execute({ action: 'ingest', kb: '手写库', fileName: 'gone.md', text: '待删正文' })

  const deleted = await tool.execute({ action: 'delete', docId: written.written.docId })
  assert.equal(deleted.ok, true)
  assert.equal(deleted.deleted.fileName, 'gone.md')
  assert.equal(typeof deleted.deleted.backupId, 'string')
  assert.equal(service.listDocs(kb.id).length, 0)

  const backups = backupsOf(store)
  assert.equal(backups.some(b => b.data.text === '待删正文' && b.data.reason.includes('delete')), true)
  const audits = auditsOf(store)
  assert.equal(audits.some(a => a.data.action === 'delete' && a.data.docId === written.written.docId), true)
  closeAllDb()
})

test('kb_manage 未找到目标时给出可操作的错误', async () => {
  const { service, tool } = makeEnv()
  service.createKb('手写库')

  const read = await tool.execute({ action: 'read', docId: 'no-such-doc' })
  assert.equal(read.ok, false)
  assert.match(read.message, /未找到文档 id/)

  const del = await tool.execute({ action: 'delete', kb: '手写库', fileName: 'no-such-file.md' })
  assert.equal(del.ok, false)
  assert.match(del.message, /未找到文档/)

  const docs = await tool.execute({ action: 'docs', kb: '没有这个库' })
  assert.equal(docs.ok, false)
  assert.match(docs.message, /未找到知识库/)

  const restore = await tool.execute({ action: 'restore', backupId: 'no-such-backup' })
  assert.equal(restore.ok, false)
  assert.match(restore.message, /未找到快照/)
  closeAllDb()
})

test('kb_manage read：缩进类文档带出重建提示（防整篇回灌写坏缩进）', async () => {
  const { service, tool } = makeEnv()
  service.createKb('手写库')
  const indented = Array.from({ length: 60 }, (_, i) => '    ' + '第' + i + '行缩进内容').join('\n')
  await tool.execute({ action: 'ingest', kb: '手写库', fileName: 'code.md', text: indented })

  const read = await tool.execute({ action: 'read', kb: '手写库', fileName: 'code.md', limit: 40000 })
  assert.equal(read.ok, true)
  // 工具必须显式声明"重建正文的空白可能被规范化"，否则模型会整篇回灌把缩进写坏
  const rendered = (tool.output.render as any)({}, read)[0].text as string
  assert.match(rendered, /空白可能被规范化/)
  // 提示必须排在正文之前（读完正文才看到就晚了）
  assert.ok(rendered.indexOf('空白可能被规范化') < rendered.indexOf('第1行缩进内容'), '提示应前置于正文')
  closeAllDb()
})

test('RagService 快照保留上限：超出 KB_BACKUP_KEEP 条时按时间删最旧', async () => {
  const { service, store } = makeEnv()
  const kb = service.createKb('手写库')
  for (let i = 0; i < KB_BACKUP_KEEP + 5; i++) {
    service.snapshotDocText({ kbId: kb.id, docId: 'd' + i, fileName: 'f' + i + '.md', text: '正文' + i, reason: '测试' })
  }
  const backups = backupsOf(store)
  assert.equal(backups.length, KB_BACKUP_KEEP)
  // 留下的应是最新的那批（f5 起），最旧的 f0..f4 被裁掉
  const names = new Set(backups.map(b => b.data.fileName))
  assert.equal(names.has('f0.md'), false)
  assert.equal(names.has('f' + (KB_BACKUP_KEEP + 4) + '.md'), true)
  closeAllDb()
})

test('kb_manage 描述说清只读面与写入约束，并指向 memory_manage', () => {
  const { service, tool } = makeEnv()
  const description: string = tool.description ?? ''
  assert.match(description, /manual/)
  assert.match(description, /所有库都可读/)
  assert.match(description, /memory_manage/)
  assert.match(description, /restore/)
  closeAllDb()
})
