// 飞书答题器：把 ask_user_question 的交互弹框接到飞书互动卡片上。
// 背景（0.36.2 实测踩坑）：飞书桥创建的独立会话里，模型调用 ask_user_question 时
// 弹框只出现在电脑端 Web 面板，手机飞书用户看不到也无法作答，任务会一直挂起。
// 机制依据：DSH 事件目录登记的 waterfall 通道 user-questions/request（agent 作用域）。
// 内置 api-remotes 会把该事件转发给 Web 面板，而面板答题器"认识会话"就认领且不主动
// 转交，普通挂载会让本答题器永远轮空（0.41.0 实锤：手机永远收不到卡片）——因此
// index.mjs 以 { prepend: true } 把本答题器插到监听队首；只认领飞书会话，其余 next() 放行。
// 答题契约（照抄 dsh-client-ui-user-questions 的返回形状）：
//   resolve { answers: [{ id, selected: string[], custom? }] }
//   取消/超时 reject Error{ name:'UserQuestionError', code:'ASK_CANCELLED'|'ASK_ABORTED' }
import { randomUUID } from 'node:crypto'
import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { sendCard } from './outbound.mjs'

/**
 * 文件日志器：把答题器的关键节点（注册/认领/放行/失败）追加落到固定文件。
 * 为什么需要：宿主 stdout 未必重定向，ctx.logger 又不进 stdout（0.38.4 无声死亡教训），
 * 认领 miss 若无落盘证据就永远黑箱。logFile 由宿主注入（隔离 HOME 下 homedir 跟随，
 * 暂存实例自然隔离）；未注入（单测）时不产生任何文件写入。
 */
function createFileLogger(logFile) {
  if (typeof logFile !== 'string' || logFile.trim() === '') return () => {}
  const target = logFile.trim()
  return (level, message) => {
    try {
      mkdirSync(dirname(target), { recursive: true })
      appendFileSync(target, '[' + new Date().toISOString() + '] [' + level + '] ' + String(message) + '\n', 'utf8')
    } catch {}
  }
}

/** 单题等待上限：超过即视为用户不在场，报错让模型改用文字继续，防止任务永久挂起。 */
const QUESTION_TIMEOUT_MS = 30 * 60 * 1000
/** 卡片容量护栏：飞书单卡 30 KB 上限，问题数与文本长度都要截断。 */
const MAX_QUESTIONS = 6
const MAX_OPTIONS = 8
const MAX_TEXT_CHARS = 1_500
/** 推荐选项后缀（与 Web 端 QuestionComposer 的 parseRecommendedLabel 解析一致）。 */
const RECOMMENDED_SUFFIX = /\s*(?:\((?:recommended|推荐)\)|（(?:recommended|推荐)）)\s*$/i

/** 创建与 Web 端同形的 UserQuestionError，让宿主按既有错误分类处理。 */
function questionError(message, code) {
  const error = new Error(message)
  error.name = 'UserQuestionError'
  error.code = code
  return error
}

/** 卡片文本截断：过长内容进卡片会被飞书整卡拒绝，宁可截断保可用。 */
function clip(text, max = MAX_TEXT_CHARS) {
  const value = String(text ?? '').trim()
  return value.length <= max ? value : value.slice(0, max) + '…'
}

/**
 * 构建问题卡片（飞书 Card 2.0，按钮回调与流式卡的"停止任务"按钮同一机制）。
 * 纯函数：同样的 askId + questions 永远产出同样的卡片，方便单测断言。
 */
export function buildQuestionCard(askId, questions) {
  const list = (Array.isArray(questions) ? questions : []).slice(0, MAX_QUESTIONS)
  const elements = []
  list.forEach((question, index) => {
    const questionId = String(question?.id ?? '')
    const options = (Array.isArray(question?.options) ? question.options : []).slice(0, MAX_OPTIONS)
    const multi = question?.multiSelect === true
    elements.push({ tag: 'div', text: { tag: 'lark_md', content: '**问题 ' + (index + 1) + ' · ' + clip(question?.header ?? '需要你的输入', 60) + '**' } })
    elements.push({ tag: 'div', text: { tag: 'lark_md', content: clip(question?.question ?? '', 600) } })
    if (String(question?.detail ?? '').trim() !== '') {
      elements.push({ tag: 'div', text: { tag: 'lark_md', content: clip(question.detail) } })
    }
    if (options.length > 0) {
      if (multi) elements.push({ tag: 'div', text: { tag: 'plain_text', content: '（可点选多项，选完点「完成本题」）' } })
      for (const option of options) {
        const rawLabel = String(option?.label ?? '')
        const display = rawLabel.replace(RECOMMENDED_SUFFIX, '')
        const recommended = display !== rawLabel
        elements.push({
          tag: 'button',
          size: 'medium',
          type: recommended ? 'primary' : 'default',
          text: { tag: 'plain_text', content: clip(display, 40) + (recommended ? '（推荐）' : '') },
          behaviors: [{ type: 'callback', value: { action: 'feishu_question', askId, questionId, label: rawLabel } }],
        })
      }
      if (multi) {
        elements.push({
          tag: 'button',
          size: 'medium',
          type: 'primary',
          text: { tag: 'plain_text', content: '完成本题' },
          behaviors: [{ type: 'callback', value: { action: 'feishu_question_commit', askId, questionId } }],
        })
      } else {
        elements.push({
          tag: 'button',
          size: 'medium',
          type: 'default',
          text: { tag: 'plain_text', content: '跳过本题' },
          behaviors: [{ type: 'callback', value: { action: 'feishu_question_skip', askId, questionId } }],
        })
      }
    } else {
      elements.push({ tag: 'div', text: { tag: 'plain_text', content: '本题没有预设选项：请直接在会话里输入答案。' } })
    }
    elements.push({ tag: 'hr' })
  })
  elements.push({
    tag: 'button',
    size: 'tiny',
    type: 'danger',
    text: { tag: 'plain_text', content: '取消提问' },
    behaviors: [{ type: 'callback', value: { action: 'feishu_question_cancel', askId } }],
  })
  elements.push({ tag: 'div', text: { tag: 'plain_text', content: 'DSH · 飞书问答卡片 · ' + Math.round(QUESTION_TIMEOUT_MS / 60000) + ' 分钟内未作答自动取消' } })
  return {
    schema: '2.0',
    header: { template: 'blue', title: { tag: 'plain_text', content: '❓ 智能体需要你的输入' } },
    body: { elements },
  }
}

/**
 * 创建飞书答题器实例。
 * 依赖注入而非直连桥：deliverCard/sendText 可在单测里替换为内存假件。
 */
export function createQuestionAnswerer({
  getClient,
  sendText,
  deliverCard,
  logFile = '',
  warn = () => {},
  info = () => {},
} = {}) {
  const fileLog = createFileLogger(logFile)
  /** agentId/sessionId -> chatId：判断一条 user-questions/request 是否属于飞书会话。 */
  const agentChat = new Map()
  /** askId -> 挂起记录；卡片按钮回调按 askId 路由。 */
  const pending = new Map()
  /** chatId -> askId：让文本消息能路由给等待自由作答的题目。 */
  const pendingByChat = new Map()
  /** chatId -> Promise：同一飞书会话的问题串行发送，避免两张问题卡交叉。 */
  const chatChains = new Map()
  /** 关闭标志：dispose 后拒绝一切新问题（含排队在微任务里尚未起跑的 runAsk）。 */
  let closed = false

  /**
   * 记录飞书会话的 agent，答题器只为这些 agent 认领问题。
   * 双键注册：agent 实例 id 与其 session id 各映射一条（前缀 session: 区分），
   * 任一命中即可认领——运行时升级或句柄重建可能让两个 id 不同步（0.38.4 实测认领全 miss）。
   */
  const registerAgent = (agentId, chatId, sessionId = '') => {
    const id = String(agentId ?? '').trim()
    const chat = String(chatId ?? '').trim()
    const sid = String(sessionId ?? '').trim()
    if (chat === '') {
      fileLog('warn', 'register: chatId 为空，忽略注册 agent=' + (id || '(空)'))
      return
    }
    if (id !== '') {
      agentChat.set(id, chat)
    } else {
      warn('registerAgent：agent id 为空，仅按会话 id 注册 chat=' + chat)
      fileLog('warn', 'register: agent id 为空，仅按会话 id 注册 chat=' + chat)
    }
    if (sid !== '') agentChat.set('session:' + sid, chat)
    fileLog('info', 'register: agent=' + (id || '(空)') + ' session=' + (sid || '(空)') + ' -> chat=' + chat)
  }
  const forgetAgent = (agentId) => {
    const id = String(agentId ?? '').trim()
    if (id === '') return
    // 调用方传来的可能是 agent id 也可能是 session id，两种键一并清除。
    agentChat.delete(id)
    agentChat.delete('session:' + id)
  }
  const forgetAll = () => {
    agentChat.clear()
  }

  /** 判定该请求是否属于飞书会话；不属于则答题器不认领。 */
  const chatIdOfRequest = (request) => {
    const agent = request?.agent
    const direct = agentChat.get(String(agent?.id ?? '').trim())
    if (direct !== undefined) return direct
    const sessionKey = 'session:' + String(agent?.session?.id ?? '').trim()
    if (sessionKey !== 'session:') return agentChat.get(sessionKey) ?? ''
    return ''
  }

  /** 失败收口：清理挂起记录、解除信号监听、reject 给宿主 waterfall。 */
  const failRecord = (record, error) => {
    if (!pending.has(record.askId)) return
    pending.delete(record.askId)
    if (pendingByChat.get(record.chatId) === record.askId) pendingByChat.delete(record.chatId)
    if (record.timer !== undefined) clearTimeout(record.timer)
    if (record.onAbort !== undefined) record.signal?.removeEventListener?.('abort', record.onAbort)
    fileLog('warn', 'fail: ask=' + record.askId + ' chat=' + record.chatId + ' code=' + String(error?.code ?? '?') + ' message=' + String(error?.message ?? error))
    record.reject(error)
  }

  /** 完成收口：清理挂起记录并 resolve 答案批次，同时给飞书回一条确认。 */
  const completeRecord = (record) => {
    if (!pending.has(record.askId)) return
    pending.delete(record.askId)
    if (pendingByChat.get(record.chatId) === record.askId) pendingByChat.delete(record.chatId)
    if (record.timer !== undefined) clearTimeout(record.timer)
    if (record.onAbort !== undefined) record.signal?.removeEventListener?.('abort', record.onAbort)
    const answers = record.questions.map((question) => {
      const entry = record.answers.get(String(question?.id ?? '')) ?? { selected: [] }
      return entry.custom === undefined
        ? { id: question.id, selected: entry.selected }
        : { id: question.id, selected: entry.selected, custom: entry.custom }
    })
    void (async () => {
      try {
        const summary = record.questions.map((question, index) => {
          const entry = record.answers.get(String(question?.id ?? ''))
          const answerText = entry?.custom !== undefined && entry.custom !== ''
            ? entry.custom
            : (entry?.selected ?? []).join('、')
          return (index + 1) + '. ' + clip(question?.question ?? '', 80) + ' → ' + (answerText === '' ? '（跳过）' : clip(answerText, 120))
        }).join('\n')
        await sendText(record.chatId, '已收到你的回答：\n' + summary)
      } catch (error) {
        warn('飞书答题确认发送失败：' + (error instanceof Error ? error.message : String(error)))
      }
    })()
    record.resolve({ answers })
  }

  /** 判断一道题是否已作答（按钮点选、跳过或自由作答都算）。 */
  const isAnswered = (record, questionId) => record.answers.has(String(questionId))

  /** 每次作答后检查是否全部答完，答完即结算。 */
  const maybeComplete = (record) => {
    if (record.questions.every((question) => isAnswered(record, question?.id))) completeRecord(record)
  }

  /**
   * 挂起一个问题的等待。先注册挂起记录再发卡片 → 挂起直至按钮回调/取消/超时。
   * 注册必须先于发卡：卡片送达用户手的瞬间就可能被点击，不能存在注册空窗。
   * 卡片发送失败时通过 failRecord 抛错：让模型收到工具错误，改用文字向用户提问。
   */
  const runAsk = async (chatId, request) => {
    // dispose 可能发生在 answer() 排队微任务与 runAsk 起跑之间，起跑时再核对一次。
    if (closed) throw questionError('飞书插件正在关闭，问题已被取消', 'ASK_ABORTED')
    const askId = randomUUID()
    const questions = (Array.isArray(request?.questions) ? request.questions : []).slice(0, MAX_QUESTIONS)
    const card = buildQuestionCard(askId, questions)
    const completion = Promise.withResolvers()
    const record = {
      askId,
      chatId,
      questions,
      answers: new Map(),
      multiSets: new Map(),
      resolve: completion.resolve,
      reject: completion.reject,
      timer: undefined,
      signal: request?.signal ?? undefined,
      onAbort: undefined,
      messageId: '',
    }
    pending.set(askId, record)
    pendingByChat.set(chatId, askId)
    // 注册后若恰逢关闭，立即按 ASK_ABORTED 结算，绝不留下无主的挂起记录。
    if (closed) {
      failRecord(record, questionError('飞书插件正在关闭，问题已被取消', 'ASK_ABORTED'))
      return await completion.promise
    }
    // 超时兜底：用户不在场时报 ASK_ABORTED，模型收到错误后可用文字继续对话。
    // unref：定时器只为兜底，不得阻止宿主进程正常退出（测试进程曾因此挂住 30 分钟）。
    record.timer = setTimeout(() => {
      failRecord(record, questionError('用户 30 分钟未作答，问题已自动取消；请直接用文字与用户沟通', 'ASK_ABORTED'))
    }, QUESTION_TIMEOUT_MS)
    record.timer.unref?.()
    // 会话被中止（用户停止任务、插件关闭）时同步取消挂起问题。
    if (record.signal !== undefined && record.signal !== null) {
      record.onAbort = () => {
        failRecord(record, questionError('ask_user_question was aborted before the user answered', 'ASK_ABORTED'))
      }
      try {
        record.signal.addEventListener('abort', record.onAbort, { once: true })
        if (record.signal.aborted) record.onAbort()
      } catch {}
    }
    try {
      const deliver = deliverCard ?? (async (targetChatId, targetCard) => {
        const client = getClient?.()
        if (client === null || client === undefined) throw new Error('飞书客户端未连接，无法投递问题卡片')
        return await sendCard(client, targetChatId, targetCard)
      })
      record.messageId = String(await deliver(chatId, card) ?? '')
    } catch (error) {
      // failRecord 已 reject completion.promise，错误经 await 向上抛给 waterfall。
      failRecord(record, questionError('飞书问题卡片投递失败：' + (error instanceof Error ? error.message : String(error)), 'ASK_ABORTED'))
    }
    info('飞书问题卡片已发出 chat=' + chatId + ' ask=' + askId + '（message=' + record.messageId + '）')
    return await completion.promise
  }

  /** waterfall 入口：非飞书会话 next() 放行给其他答题器；同会话问题按序串行。 */
  const answer = async (request, next) => {
    const chatId = chatIdOfRequest(request)
    if (chatId === '') {
      // 认领 miss 必须留痕：注册了哪些键、请求带的是哪个 agent/session，
      // 否则「问题弹到电脑端」永远无法归因（0.38.4 实录）。
      const agent = request?.agent
      const missDetail = 'miss: request.agent.id=' + String(agent?.id ?? '(空)')
        + ' session=' + String(agent?.session?.id ?? '(空)')
        + ' registered=[' + [...agentChat.keys()].join(', ') + ']'
      warn('user-questions/request 非飞书会话，放行给其他答题器：' + missDetail)
      fileLog('warn', missDetail)
      return await next()
    }
    fileLog('info', 'claim: chat=' + chatId + ' agent=' + String(request?.agent?.id ?? '(空)') + ' questions=' + (Array.isArray(request?.questions) ? request.questions.length : 0))
    const previous = chatChains.get(chatId) ?? Promise.resolve()
    const operation = previous.catch(() => {}).then(() => runAsk(chatId, request))
    chatChains.set(chatId, operation)
    try {
      return await operation
    } finally {
      if (chatChains.get(chatId) === operation) chatChains.delete(chatId)
    }
  }

  /** 该会话是否正在等待自由作答（开放题文本捕获用）。 */
  const hasPendingCustom = (chatId) => {
    const record = pending.get(pendingByChat.get(String(chatId ?? '').trim()) ?? '')
    if (record === undefined) return false
    return record.questions.some((question) => {
      const options = Array.isArray(question?.options) ? question.options : []
      return options.length === 0 && !isAnswered(record, question?.id)
    })
  }

  /** 把会话里的一条文本消息消费为首个未答开放题的答案；返回是否消费。 */
  const recordCustomAnswer = (chatId, text) => {
    const record = pending.get(pendingByChat.get(String(chatId ?? '').trim()) ?? '')
    if (record === undefined) return false
    const value = String(text ?? '').trim()
    if (value === '') return false
    const question = record.questions.find((item) => {
      const options = Array.isArray(item?.options) ? item.options : []
      return options.length === 0 && !isAnswered(record, item?.id)
    })
    if (question === undefined) return false
    record.answers.set(String(question.id), { selected: [], custom: value })
    maybeComplete(record)
    return true
  }

  /** 卡片按钮回调统一入口；返回给飞书的 toast 文案（可空）。 */
  const handleCardValue = (value) => {
    const action = String(value?.action ?? '')
    if (!action.startsWith('feishu_question')) return null
    const record = pending.get(String(value?.askId ?? ''))
    if (record === undefined) return { toast: { content: '该问题已结束或已失效' } }
    const questionId = String(value?.questionId ?? '')
    if (action === 'feishu_question_cancel') {
      failRecord(record, questionError('the user cancelled ask_user_question', 'ASK_CANCELLED'))
      return { toast: { content: '已取消提问，任务将改用文字继续' } }
    }
    if (action === 'feishu_question_skip') {
      if (isAnswered(record, questionId)) return { toast: { content: '本题已作答' } }
      record.answers.set(questionId, { selected: [] })
      maybeComplete(record)
      return { toast: { content: '已跳过' } }
    }
    if (action === 'feishu_question') {
      const question = record.questions.find((item) => String(item?.id ?? '') === questionId)
      const multi = question?.multiSelect === true
      const label = String(value?.label ?? '')
      if (label === '') return { toast: { content: '无效的选项' } }
      if (multi) {
        const set = record.multiSets.get(questionId) ?? new Set()
        if (set.has(label)) { set.delete(label); return { toast: { content: '已取消选择：' + label } } }
        set.add(label)
        record.multiSets.set(questionId, set)
        return { toast: { content: '已选择：' + label + '（选完点「完成本题」）' } }
      }
      if (isAnswered(record, questionId)) return { toast: { content: '本题已作答' } }
      record.answers.set(questionId, { selected: [label] })
      maybeComplete(record)
      return { toast: { content: '已选择：' + label } }
    }
    if (action === 'feishu_question_commit') {
      const set = record.multiSets.get(questionId)
      if (set === undefined || set.size === 0) return { toast: { content: '请先点选至少一项' } }
      if (isAnswered(record, questionId)) return { toast: { content: '本题已作答' } }
      record.answers.set(questionId, { selected: [...set] })
      maybeComplete(record)
      return { toast: { content: '本题已完成' } }
    }
    return null
  }

  /**
   * 取消全部挂起问题，但保留答题器可用状态（桥重启专用）。
   * 飞书桥因配置更新重建时（performConfigUpdate → stopBridgeAndSessions → startBridge），
   * 只有 bridge 被重建，答题器实例不重建、getClient 是懒取新 bridge 的，因此这里
   * 绝不能置 closed：一旦置位，之后所有提问都在入口被拒（0.41.4 实录——辉哥连点两次
   * 卡片，两次都立刻收到「飞书插件正在关闭，问题已被取消」，手机上表现为点了完全没反应）。
   * 会话注册映射（agentChat）与桥无关，同样必须保留，否则重启后旧会话提问全被当成
   * 非飞书会话 miss 掉、放行给电脑端答题器。
   */
  const cancelAll = (reason) => {
    const message = String(reason ?? '').trim() !== ''
      ? String(reason)
      : '飞书桥正在重启，该问题已取消；请直接用文字继续沟通'
    for (const record of [...pending.values()]) {
      failRecord(record, questionError(message, 'ASK_ABORTED'))
    }
    pending.clear()
    pendingByChat.clear()
    chatChains.clear()
  }

  /** 关停：拒绝全部挂起问题（含等待中的自由作答），并拒绝后续一切新问题。仅插件卸载时调用，不可逆。 */
  const dispose = () => {
    closed = true
    cancelAll('飞书插件正在关闭，问题已被取消')
    agentChat.clear()
  }

  return { answer, registerAgent, forgetAgent, forgetAll, hasPendingCustom, recordCustomAnswer, handleCardValue, cancelAll, dispose, log: fileLog }
}
