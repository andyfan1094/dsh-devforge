/**
 * 知识库管理工具 —— kb_manage：把「知识库文档归谁管、能不能改、怎么改对」变成工具的真实返回值。
 *
 * 为什么需要它（2026-10-19 辉哥实测暴露）：
 *   在此之前模型侧只有两个相关工具——rag_search（纯检索，只读）与 memory_manage
 *   （只管内置长期记忆 memory.entry）。知识库文档（rag.doc）在工具面上**完全没有写入路径**，
 *   而写在文档里的东西偏偏会过期。模型遇到「知识库里那条文档写错了」时，只能回一句
 *   「那条文档是只读的、我改不了，等它自动刷新就一致了」：
 *     - 前半句是它没工具可用的托词（那些库在数据层并没有只读标记）；
 *     - 后半句是它自己补的理由，而事实是**那些库没有自动刷新**，过期内容会一直留着。
 *   本工具把这条路补上，并把「哪些库能写、为什么不能写」做成明确的返回，
 *   让模型再没有编造理由的空间。
 *
 * 写权限护栏（红线，2026-10-19 定稿）：
 *   1. 只有 source=manual 的库允许 ingest/delete/restore；其余来源一律拒写，
 *      并回明确原因与正确处置（改源头，而不是改副本）——副本永远会被生成器覆盖；
 *   2. 写入频率上限：60 秒窗口内最多 KB_WRITE_WINDOW_MAX 次（写入与删除共用配额），
 *      防模型循环批量改写；
 *   3. 覆盖/删除前先留原文快照（rag.backup），并可用 restore 真的写回；
 *   4. 每次写操作记审计（rag.audit，只记元数据不记正文，含失败那条）。
 *
 * 独立复审（2026-10-19）修掉的四类真缺陷，勿回退：
 *   - 「可回滚」原先是空头承诺：只写快照、没有任何写回入口 → 补 restore；
 *   - memory 库的拒写理由说「由会话记忆沉淀层写入」，而该写入路径在当前接线下是死代码
 *     （sediment.ts 的 governance 分支先 continue），生产那个库六周没新增 → 改口径；
 *   - 同名库/同库同名文档会静默命中第一个 → 改为一律报歧义错误，要求用 id；
 *   - 覆盖写入失败时只留快照不留审计，且"没改动也照记覆盖" → 补失败审计 + 内容未变即短路。
 */
import { createHash } from 'node:crypto'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { RagService } from './service.ts'
import type { RagDocument, RagKbSource, RagKnowledgeBase } from './protocol.ts'

function text(value: string): Array<{ type: 'text'; text: string }> {
  return [{ type: 'text', text: value }]
}

/** read 单次返回的默认字符窗口。 */
const READ_DEFAULT_CHARS = 12000
/** read 单次返回的字符窗口上限（模型可显式要更多，但不能一次拉爆上下文）。 */
const READ_MAX_CHARS = 40000
/** ingest 单篇正文长度上限（约等于 400 个切块，超此规模应拆分或走面板上传）。 */
const INGEST_MAX_CHARS = 200000
/** docs 单次列出的文档数上限。 */
const DOCS_MAX = 200
/** 文档名长度上限（文档名只是幂等键与展示名，不是路径，但仍设上限防脏数据）。 */
const FILE_NAME_MAX_CHARS = 200
/** 写入频率窗口与窗口内上限（写入与删除共用）。 */
const WRITE_WINDOW_MS = 60000
const WRITE_WINDOW_MAX = 10
/** 内容未变时 read 回灌的提示语，避免模型据此整篇重写而丢掉缩进。 */
const READ_REBUILD_CAVEAT = '（本正文由索引切块按行号重建，块首尾空白可能被规范化。'
  + '要整篇重写请以你自己的源文本为准，不要直接回灌本返回值。）'

export interface KbSummary {
  id: string
  name: string
  source: RagKbSource
  /** 是否允许本工具写入（仅 manual 为 true）。 */
  writable: boolean
  docCount: number
  description?: string
}

export interface KbDocSummary {
  docId: string
  fileName: string
  status: string
  chunks: number
  sourcePath?: string
}

export interface KbManageToolOutput {
  ok: boolean
  action: string
  message?: string
  kbs?: KbSummary[]
  docs?: KbDocSummary[]
  /** 被截断（未列出）的文档数；0 或缺省表示列全了。 */
  docsTruncated?: number
  doc?: {
    docId: string
    kbId: string
    kbName: string
    fileName: string
    chars: number
    text: string
    truncated: boolean
    /** 续读偏移；truncated=true 时传回 offset 可继续读。 */
    nextOffset: number
  }
  written?: {
    docId: string
    fileName: string
    chunks: number
    mode: 'created' | 'overwritten' | 'unchanged' | 'restored'
    backupId?: string
    restoredFrom?: string
  }
  deleted?: { docId: string; fileName: string; backupId?: string }
}

/**
 * 非 manual 库的写入拒绝原因 —— 这就是「为什么不能改」的正确答案。
 *
 * 各类库的生成器不同，共同点是：改副本一定会被生成器覆盖，
 * 所以拒写时必须把「该去哪里改」一并说清，否则模型只会换个措辞继续猜。
 *
 * 措辞须与真实机制一致（2026-10-19 逐条核过代码，别再退化成想当然）：
 *   - project：ProjectIndexer 按白名单扩展名覆盖同名文档，且**删除**本轮没扫到的旧文档；
 *   - mirror：mirrorIngest 按 fileName 覆盖，源侧消失的文档同样会被删（空扫描有保护）；
 *   - memory：**当前接线下已无写入方**（沉淀层走 governance 写内置长期记忆），
 *     此库是历史产物，还可能是统计模块刚建出来的空库——所以不能说"由沉淀层写入"。
 */
export function writeDenial(kb: RagKnowledgeBase): string | undefined {
  if (kb.source === 'manual') return undefined
  const head = '「' + kb.name + '」（source=' + kb.source + '）不可由本工具写入：'
  if (kb.source === 'project') {
    return head + '该库正文由项目索引器按本机项目目录生成，改这里的副本会在下次索引时被源文件覆盖，'
      + '源文件删除或不再被索引后对应文档也会被清掉。正确做法是改源文件（用 docs 看 sourcePath）后重新索引。'
  }
  if (kb.source === 'mirror') {
    return head + '该库正文由外部源（Mnemon／Hindsight）单向拉取，改这里会在下次镜像同步时被覆盖，'
      + '源侧已消失的文档也会在同步时被清掉。正确做法是改外部源，再等同步或手动同步。'
  }
  if (kb.source === 'memory') {
    return head + '该库是历史会话记忆沉淀的产物——当前沉淀层写入的是内置长期记忆（memory.entry），'
      + '此库不再有新内容（也可能是统计模块刚建出来的空库）。要纠正长期事实请用 memory_manage。'
  }
  // 未来新增 source 时给中性原因，避免把「不认识的来源」硬说成 memory 误导模型。
  return head + '该库由其它生成器维护。本工具只允许写 source=manual 的库；若确需修改，请先查明该库由谁生成。'
}

/** 知识库定位结果：命中或（带可操作原因）失败。歧义一律报错，绝不静默取第一个。 */
export type KbLookup = { kb: RagKnowledgeBase } | { error: string }

/**
 * 按 id 或名称唯一定位知识库。
 *
 * 名称要求完全相等；同名多个一律报歧义（2026-10-19 复审实测：静默取第一个会让
 * 模型按错误理由去"改源文件"，同一串参数换个创建顺序行为就相反）。
 */
export function resolveKb(service: RagService, ref: string): KbLookup {
  const key = ref.trim()
  if (key === '') return { error: '未给知识库：kb 参数必填，可先用 action=list 看 id 与名称' }
  const kbs = service.listKbs()
  const byId = kbs.find((kb) => kb.id === key)
  if (byId !== undefined) return { kb: byId }
  const sameName = kbs.filter((kb) => kb.name === key)
  if (sameName.length === 0) return { error: '未找到知识库：' + key + '；可先用 action=list 看 id 与名称' }
  if (sameName.length > 1) {
    return {
      error: '名称「' + key + '」对应 ' + sameName.length + ' 个知识库，无法唯一定位；请改用 id：'
        + sameName.map((kb) => kb.id + '（source=' + kb.source + '）').join('、'),
    }
  }
  return { kb: sameName[0]! }
}

/** 文档定位结果：命中或（带可操作原因）失败。 */
export type DocLookup = { doc: RagDocument; kb: RagKnowledgeBase } | { error: string }

/**
 * 按 docId 或 kb+fileName 定位文档；两种都给时以 docId 为准。
 *
 * 同库同名多条同样报歧义（正常写入以 fileName 为幂等键不会产生重复，
 * 但历史脏数据可能出现，静默删错一条比报错更糟）。
 */
export function locateDoc(service: RagService, args: { docId?: string; kb?: string; fileName?: string }): DocLookup {
  const docId = (args.docId ?? '').trim()
  if (docId !== '') {
    const doc = service.listDocs().find((item) => item.id === docId)
    if (doc === undefined) return { error: '未找到文档 id：' + docId }
    const kb = service.listKbs().find((item) => item.id === doc.kbId)
    if (kb === undefined) return { error: '文档 ' + docId + ' 所属知识库已不存在（kbId=' + doc.kbId + '）' }
    return { doc, kb }
  }
  const looked = resolveKb(service, args.kb ?? '')
  if ('error' in looked) return { error: looked.error }
  const fileName = (args.fileName ?? '').trim()
  if (fileName === '') return { error: '未给文档：请给 docId，或给 kb + fileName' }
  const matched = service.listDocs(looked.kb.id).filter((item) => item.fileName === fileName)
  if (matched.length === 0) return { error: '未找到文档：kb=' + looked.kb.name + ' fileName=' + fileName }
  if (matched.length > 1) {
    return {
      error: '库「' + looked.kb.name + '」存在 ' + matched.length + ' 条同名文档（历史脏数据），'
        + '无法唯一定位；请改传 docId：' + matched.map((item) => item.id).join('、'),
    }
  }
  return { doc: matched[0]!, kb: looked.kb }
}

/** 文档名归一与校验：只做去空白与长度限制，禁止空名与换行（换行会污染面板展示与出处行）。 */
function normalizeFileName(raw: string): string | undefined {
  const name = raw.trim()
  if (name === '') return undefined
  if (name.length > FILE_NAME_MAX_CHARS) return undefined
  if (/[\r\n]/u.test(name)) return undefined
  return name
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function docSummary(doc: RagDocument): KbDocSummary {
  return {
    docId: doc.id,
    fileName: doc.fileName,
    status: doc.status,
    chunks: doc.chunkCount,
    ...(doc.sourcePath !== undefined ? { sourcePath: doc.sourcePath } : {}),
  }
}

/** 工具结果渲染成模型可直接读的中文文本。 */
function render(value: KbManageToolOutput): string {
  if (!value.ok) return value.message ?? '知识库操作失败'

  if (value.action === 'list') {
    const kbs = value.kbs ?? []
    if (kbs.length === 0) return '（当前没有任何知识库）'
    return '知识库共 ' + kbs.length + ' 个：\n' + kbs.map((kb) => {
      const mark = kb.writable ? '可写' : '只读（由生成器维护）'
      const desc = kb.description !== undefined ? '　' + kb.description : ''
      return '- ' + kb.name + '　id=' + kb.id + '　来源=' + kb.source + '　' + mark + '　文档 ' + kb.docCount + ' 篇' + desc
    }).join('\n')
  }

  if (value.action === 'docs') {
    const docs = value.docs ?? []
    if (docs.length === 0) return '（该库暂无文档）'
    const body = docs.map((doc, index) => '[' + (index + 1) + '] ' + doc.fileName + '　id=' + doc.docId
      + '　状态=' + doc.status + '　切块 ' + doc.chunks
      + (doc.sourcePath !== undefined ? '　源文件=' + doc.sourcePath : '')).join('\n')
    const tail = (value.docsTruncated ?? 0) > 0
      ? '\n---\n（另有 ' + value.docsTruncated + ' 篇未列出，已截断；未列出不等于不存在，可直接用 read 指定 fileName）'
      : ''
    return '文档 ' + docs.length + ' 篇：\n' + body + tail
  }

  if (value.action === 'read') {
    const doc = value.doc
    if (doc === undefined) return '（未读到文档）'
    const head = '《' + doc.fileName + '》　库=' + doc.kbName + '　正文 ' + doc.chars + ' 字'
      + (doc.truncated ? '　本次返回至 ' + doc.nextOffset + ' 字' : '　已到末尾')
    const note = doc.truncated ? '\n---\n（正文已截断，续读请带 offset=' + doc.nextOffset + '）' : ''
    // 提示前置于正文：这正是"读出来整篇回灌会把缩进写坏"的场景，看完正文才看到就晚了。
    return head + '\n' + READ_REBUILD_CAVEAT + '\n\n' + doc.text + note
  }

  if (value.action === 'ingest' || value.action === 'restore') {
    const written = value.written
    if (written === undefined) return '（未写入）'
    if (written.mode === 'unchanged') {
      return '《' + written.fileName + '》内容与库中一致，未改动（未留快照、未记写审计）'
    }
    const mode = written.mode === 'created' ? '新建'
      : written.mode === 'restored' ? '已从快照回滚'
        : '同名覆盖（原文已留快照，可用 restore 回滚）'
    return '已写入《' + written.fileName + '》：' + mode + '，切块 ' + written.chunks
      + '，docId=' + written.docId
      + (written.backupId !== undefined ? '，本次覆盖前快照 ' + written.backupId : '')
      + (written.restoredFrom !== undefined ? '，来源快照 ' + written.restoredFrom : '')
  }

  if (value.action === 'delete') {
    const deleted = value.deleted
    if (deleted === undefined) return '（未删除）'
    return '已删除《' + deleted.fileName + '》（docId=' + deleted.docId + '）'
      + (deleted.backupId !== undefined ? '，原文已留快照 ' + deleted.backupId + '（可用 restore 写回）' : '')
  }

  return value.message ?? '（无输出）'
}

export interface KbManageToolOptions {
  /** 注入日志（接线层传宿主 logger；缺省静默，测试不依赖）。 */
  log?: (message: string) => void
}

/**
 * 构造 kb_manage 工具。
 *
 * 写入频率计数保存在闭包内（同进程共享同一工具实例），因此是「窗口内上限」而非「单轮上限」——
 * 工具层拿不到轮次上下文，用时间窗是同等防护且无需额外接线。
 */
export function kbManageTool(service: RagService, options?: KbManageToolOptions) {
  const writeStamps: number[] = []

  /** 写入频率闸门：超限返回 false（拒绝时不再消耗配额）。 */
  const allowWrite = (): boolean => {
    const now = Date.now()
    while (writeStamps.length > 0 && now - writeStamps[0]! > WRITE_WINDOW_MS) writeStamps.shift()
    if (writeStamps.length >= WRITE_WINDOW_MAX) return false
    writeStamps.push(now)
    return true
  }

  const rateLimited = (): KbManageToolOutput => ({
    ok: false,
    action: '',
    message: '写入过于频繁：' + Math.round(WRITE_WINDOW_MS / 1000) + ' 秒内最多 ' + WRITE_WINDOW_MAX
      + ' 次（写入与删除共用该配额），本次已拒绝；请稍后重试',
  })

  const log = options?.log ?? ((): void => { /* 无注入时静默 */ })

  /**
   * 唯一的文档写入路径（ingest 与 restore 共用；两套写路径必然漂移，故不复制）。
   *
   * 顺序即护栏：频率闸门 → 内容未变短路 → 覆盖前快照 → 写入 → 审计。
   * 写入失败也要补一条 result=failed 审计（否则异常路径上"谁动过什么"缺一条）。
   */
  const writeDocument = async (
    kb: RagKnowledgeBase,
    fileName: string,
    body: string,
    action: string,
    extra?: { restoredFrom?: string },
  ): Promise<KbManageToolOutput> => {
    if (body.length > INGEST_MAX_CHARS) {
      return { ok: false, action, message: '正文 ' + body.length + ' 字超过单篇上限 ' + INGEST_MAX_CHARS + ' 字；请拆分后再写，或改走面板上传' }
    }
    if (!allowWrite()) {
      const limited = rateLimited()
      return { ...limited, action }
    }

    const existing = service.listDocs(kb.id).find((doc) => doc.fileName === fileName)
    // 内容未变则短路：不留快照、不记写审计、不重嵌（也顺手省下一次向量调用）。
    if (existing !== undefined && existing.status === 'ready' && existing.contentHash === sha256(body)) {
      return {
        ok: true,
        action,
        written: {
          docId: existing.id,
          fileName,
          chunks: existing.chunkCount,
          mode: 'unchanged',
          ...(extra?.restoredFrom !== undefined ? { restoredFrom: extra.restoredFrom } : {}),
        },
      }
    }

    // 覆盖前留原文快照（新建无需快照）。
    let backupId: string | undefined
    if (existing !== undefined) {
      backupId = service.snapshotDocText({
        kbId: kb.id,
        docId: existing.id,
        fileName,
        text: service.readDocText(existing.id),
        reason: 'kb_manage ' + action + ' 覆盖前快照',
      })
    }

    let doc: RagDocument
    try {
      doc = await service.ingestText(kb.id, fileName, body)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      service.auditKbWrite({
        action: action === 'restore' ? 'restore' : 'ingest',
        result: 'failed',
        kbId: kb.id,
        kbName: kb.name,
        fileName,
        textChars: body.length,
        ...(backupId !== undefined ? { backupId } : {}),
        error: message.slice(0, 200),
      })
      return { ok: false, action, message: '写入失败（库中内容未被改动）：' + message.slice(0, 200) }
    }

    service.auditKbWrite({
      action: action === 'restore' ? 'restore' : 'ingest',
      kbId: kb.id,
      kbName: kb.name,
      fileName,
      docId: doc.id,
      textChars: body.length,
      ...(backupId !== undefined ? { backupId } : {}),
    })
    log('[dsh-devforge] kb_manage ' + action + '：库=' + kb.name + ' 文档=' + fileName + ' 字数=' + body.length
      + ' 模式=' + (existing !== undefined ? '覆盖' : '新建'))
    return {
      ok: true,
      action,
      written: {
        docId: doc.id,
        fileName,
        chunks: doc.chunkCount,
        mode: extra?.restoredFrom !== undefined ? 'restored' : existing !== undefined ? 'overwritten' : 'created',
        ...(backupId !== undefined ? { backupId } : {}),
        ...(extra?.restoredFrom !== undefined ? { restoredFrom: extra.restoredFrom } : {}),
      },
    }
  }

  return defineTool({
    name: 'kb_manage',
    description: '管理天工造梦 RAG 知识库的文档：list 列库、docs 列文档、read 读正文、'
      + 'ingest 写入（同名即覆盖，用于修正文档）、delete 删除、restore 用快照把文档写回原样。'
      + '所有库都可读；写入只允许 source=manual 的库。其余来源的库正文归各自生成器维护，'
      + '改副本会被覆盖或清掉，本工具会拒绝并告诉你去改哪里。'
      + '要纠正一条长期记忆事实，用 memory_manage 而不是本工具。'
      + 'Triggers: 改知识库, 知识库文档, 更正文档, 知识库只读, 记忆中枢文档.',
    parameters: {
      action: { type: 'string', enum: ['list', 'docs', 'read', 'ingest', 'delete', 'restore'], description: '操作类型，默认 list。' },
      kb: { type: 'string', description: '知识库 id 或名称（名称须完全相等且唯一；docs/read/ingest 必填，delete 与 docId 二选一）。' },
      docId: { type: 'string', description: 'read/delete 可直接指定文档 id（比 kb+fileName 更稳，同名文档必须用它）。' },
      fileName: { type: 'string', description: '文档名（ingest 必填；read/delete 与 docId 二选一）。同名即覆盖。' },
      text: { type: 'string', description: 'ingest 必填：整篇新正文（覆盖写入，不是增量拼接）。' },
      backupId: { type: 'string', description: 'restore 必填：要写回的快照 id（来自 ingest/delete 的返回）。' },
      offset: { type: 'integer', description: 'read 起始字符偏移，默认 0；配合返回的 nextOffset 续读长文。' },
      limit: { type: 'integer', description: 'read 单次返回字符上限，默认 ' + READ_DEFAULT_CHARS + '，最大 ' + READ_MAX_CHARS + '。' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          action: { type: 'string', required: true },
          message: { type: 'string' },
          kbs: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                name: { type: 'string', required: true },
                source: { type: 'string', required: true },
                writable: { type: 'boolean', required: true },
                docCount: { type: 'number', required: true },
                description: { type: 'string' },
              },
            },
          },
          docs: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                docId: { type: 'string', required: true },
                fileName: { type: 'string', required: true },
                status: { type: 'string', required: true },
                chunks: { type: 'number', required: true },
                sourcePath: { type: 'string' },
              },
            },
          },
          docsTruncated: { type: 'number' },
          doc: {
            type: 'object',
            additionalProperties: false,
            properties: {
              docId: { type: 'string', required: true },
              kbId: { type: 'string', required: true },
              kbName: { type: 'string', required: true },
              fileName: { type: 'string', required: true },
              chars: { type: 'number', required: true },
              text: { type: 'string', required: true },
              truncated: { type: 'boolean', required: true },
              nextOffset: { type: 'number', required: true },
            },
          },
          written: {
            type: 'object',
            additionalProperties: false,
            properties: {
              docId: { type: 'string', required: true },
              fileName: { type: 'string', required: true },
              chunks: { type: 'number', required: true },
              mode: { type: 'string', required: true },
              backupId: { type: 'string' },
              restoredFrom: { type: 'string' },
            },
          },
          deleted: {
            type: 'object',
            additionalProperties: false,
            properties: {
              docId: { type: 'string', required: true },
              fileName: { type: 'string', required: true },
              backupId: { type: 'string' },
            },
          },
        },
      },
      render: (_args, value: KbManageToolOutput) => text(render(value)),
    },

    async execute(args): Promise<KbManageToolOutput> {
      const action = args.action ?? 'list'
      try {
        if (action === 'list') {
          const kbs = service.listKbs().map((kb): KbSummary => ({
            id: kb.id,
            name: kb.name,
            source: kb.source,
            writable: kb.source === 'manual',
            docCount: service.listDocs(kb.id).length,
            ...(kb.description !== undefined ? { description: kb.description } : {}),
          }))
          return { ok: true, action, kbs }
        }

        if (action === 'docs') {
          const looked = resolveKb(service, args.kb ?? '')
          if ('error' in looked) return { ok: false, action, message: looked.error }
          const all = service.listDocs(looked.kb.id)
            .slice()
            .sort((a, b) => a.fileName.localeCompare(b.fileName))
          return {
            ok: true,
            action,
            docs: all.slice(0, DOCS_MAX).map(docSummary),
            docsTruncated: Math.max(0, all.length - DOCS_MAX),
          }
        }

        if (action === 'read') {
          const found = locateDoc(service, args)
          if ('error' in found) return { ok: false, action, message: found.error }
          const { doc, kb } = found
          const full = service.readDocText(doc.id)
          const offset = args.offset !== undefined && args.offset > 0 ? Math.floor(args.offset) : 0
          if (full.length > 0 && offset >= full.length) {
            return { ok: false, action, message: '起始偏移 ' + offset + ' 已超出《' + doc.fileName + '》正文长度（共 ' + full.length + ' 字）' }
          }
          const limit = args.limit !== undefined && args.limit > 0
            ? Math.min(Math.floor(args.limit), READ_MAX_CHARS)
            : READ_DEFAULT_CHARS
          const window = full.slice(offset, offset + limit)
          const nextOffset = offset + window.length
          return {
            ok: true,
            action,
            doc: {
              docId: doc.id,
              kbId: kb.id,
              kbName: kb.name,
              fileName: doc.fileName,
              chars: full.length,
              text: window,
              truncated: nextOffset < full.length,
              nextOffset,
            },
          }
        }

        if (action === 'ingest') {
          const looked = resolveKb(service, args.kb ?? '')
          if ('error' in looked) return { ok: false, action, message: looked.error }

          // 护栏 1：只有 manual 库可写。拒写理由是确定性答案，先于任何写入动作返回。
          const denial = writeDenial(looked.kb)
          if (denial !== undefined) return { ok: false, action, message: denial }

          const fileName = normalizeFileName(args.fileName ?? '')
          if (fileName === undefined) return { ok: false, action, message: 'fileName 必填且需为单行、不超过 ' + FILE_NAME_MAX_CHARS + ' 字符' }
          const body = args.text ?? ''
          if (body.trim() === '') return { ok: false, action, message: 'text 必填（整篇新正文）' }

          return await writeDocument(looked.kb, fileName, body, action)
        }

        if (action === 'restore') {
          const backupId = (args.backupId ?? '').trim()
          if (backupId === '') return { ok: false, action, message: 'backupId 必填（来自之前 ingest/delete 返回的快照 id）' }
          const snapshot = service.getKbBackup(backupId)
          if (snapshot === undefined) return { ok: false, action, message: '未找到快照：' + backupId }
          // 恢复也是一次写入：目标库仍须存在且仍属 manual，否则同样拒写。
          const looked = resolveKb(service, snapshot.kbId)
          if ('error' in looked) return { ok: false, action, message: '快照所属知识库已不存在，无法回滚：' + looked.error }
          const denial = writeDenial(looked.kb)
          if (denial !== undefined) return { ok: false, action, message: denial }
          return await writeDocument(looked.kb, snapshot.fileName, snapshot.text, action, { restoredFrom: backupId })
        }

        if (action === 'delete') {
          // 先按 kb 参数判定护栏，再找文档：即便文件名给错、或该库里根本没有这条文档，
          // 也要先把「这个库归谁管、该去哪改」讲清楚——否则模型只会以为自己名字写错，
          // 换着文件名反复试（2026-10-19 由 tests/rag-kb-manage.test.ts 的 memory 库用例暴露）。
          const kbRef = (args.kb ?? '').trim()
          if (kbRef !== '') {
            const named = resolveKb(service, kbRef)
            if ('error' in named) return { ok: false, action, message: named.error }
            const namedDenial = writeDenial(named.kb)
            if (namedDenial !== undefined) return { ok: false, action, message: namedDenial }
          }
          const found = locateDoc(service, args)
          if ('error' in found) return { ok: false, action, message: found.error }
          const { doc, kb } = found
          const denial = writeDenial(kb)
          if (denial !== undefined) return { ok: false, action, message: denial }
          if (!allowWrite()) {
            const limited = rateLimited()
            return { ...limited, action }
          }

          // 删除不可逆，先留快照再删（快照可用 restore 写回）。
          const backupId = service.snapshotDocText({
            kbId: kb.id,
            docId: doc.id,
            fileName: doc.fileName,
            text: service.readDocText(doc.id),
            reason: 'kb_manage delete 前快照',
          })
          service.deleteDoc(doc.id)
          service.auditKbWrite({ action: 'delete', kbId: kb.id, kbName: kb.name, fileName: doc.fileName, docId: doc.id, backupId })
          log('[dsh-devforge] kb_manage delete：库=' + kb.name + ' 文档=' + doc.fileName + ' docId=' + doc.id)
          return { ok: true, action, deleted: { docId: doc.id, fileName: doc.fileName, backupId } }
        }

        return { ok: false, action, message: '未知 action：' + action + '；可用 list/docs/read/ingest/delete/restore' }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { ok: false, action, message: '知识库操作失败：' + message.slice(0, 200) }
      }
    },
  })
}
