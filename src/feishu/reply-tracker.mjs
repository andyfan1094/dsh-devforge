// Vendored from dsh-feishu 0.2.2 (MIT, andyfan1094/dsh-feishu).
// dsh-devforge consolidation modification: module folded into dsh-devforge;
// runtime behavior preserved. See THIRD_PARTY_NOTICES.md.
import { randomUUID } from 'node:crypto'

export function lastAssistantText(session) {
  const events = session?.events
  if (!Array.isArray(events)) return ''
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type !== 'assistant/message') continue
    const blocks = event.data?.message?.content
    if (!Array.isArray(blocks)) continue
    const text = blocks
      .filter((block) => block?.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text)
      .join('\n')
      .trim()
    if (text !== '') return text
  }
  return ''
}

export function buildUserMessage(text, imageRefs = []) {
  const value = String(text ?? '').trim()
  const images = Array.isArray(imageRefs)
    ? imageRefs
      .filter((ref) => ref !== null && typeof ref === 'object')
      .map((attachment) => ({ type: 'image', attachment }))
    : []
  return {
    id: randomUUID(),
    role: 'user',
    content: [
      ...images,
      ...(value === '' ? [] : [{ type: 'text', text: value }]),
    ],
    source: {
      kind: 'plugin',
      plugin: 'dsh-feishu',
      form: 'notice',
      summary: value.slice(0, 120) || (images.length > 0 ? '[图片]' : ''),
    },
  }
}

function plain(value, limit = 180) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit)
}

function messageTextOf(message) {
  const blocks = message?.content
  if (!Array.isArray(blocks)) return plain(message, 180)
  return plain(blocks
    .filter((block) => typeof block?.text === 'string')
    .map((block) => block.text)
    .join(' '), 180)
}

function durationOf(ms) {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  if (seconds < 60) return seconds + '秒'
  const minutes = Math.floor(seconds / 60)
  return minutes + '分' + String(seconds % 60).padStart(2, '0') + '秒'
}

function toolLine(tool, now, index) {
  const status = tool.status === 'running' ? '执行中' : tool.status === 'error' ? '失败' : '完成'
  const icon = tool.status === 'running' ? '⏳' : tool.status === 'error' ? '❌' : '✅'
  const elapsedMs = Math.max(0, (tool.finishedAt ?? now) - tool.startedAt)
  const elapsed = elapsedMs < 1000 ? '' : ' · ' + durationOf(elapsedMs)
  const result = tool.result === '' ? '' : '\n  结果：' + plain(tool.result, 120)
  return icon + ' ' + (index + 1) + '. ' + plain(tool.name, 80) + ' · ' + status + elapsed + result
}

function renderCard(entry, { final = false, text = '', currentTime = Date.now() } = {}) {
  const phase = final
    ? (entry.phase === '失败' ? '执行失败' : entry.phase === '已中止' ? '已中止' : '已完成')
    : entry.phase
  let tools = ''
  if (entry.tools.length > 0) {
    const visibleTools = entry.tools.slice(-8)
    const label = entry.tools.length > visibleTools.length
      ? '工具步骤（最近 ' + visibleTools.length + ' / 共 ' + entry.tools.length + '）'
      : '工具步骤（' + visibleTools.length + '）'
    const startIndex = entry.tools.length - visibleTools.length
    tools = label + '\n' + visibleTools.map((tool, index) => toolLine(tool, currentTime, startIndex + index)).join('\n')
  }
  const answer = text !== '' ? text : entry.answer !== '' ? entry.answer : final ? '' : '等待模型输出...'
  return { status: '**' + phase + '**', tools, answer }
}

function renderFooter(entry, currentTime = Date.now()) {
  return '模型：' + (entry.model || '默认')
    + ' · 思考强度：' + (entry.effort || '默认')
    + ' · 耗时：' + durationOf(currentTime - entry.startedAt)
}

export function createReplyTracker({
  sendText,
  createStream,
  warn,
  now = Date.now,
  heartbeatMs = 1000,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
} = {}) {
  const pending = new Map()
  const heartbeatInterval = Number.isFinite(heartbeatMs) && heartbeatMs > 0 ? heartbeatMs : 1000

  const safeSend = async (chatId, text) => {
    try {
      await sendText?.(chatId, text)
    } catch (error) {
      try { warn?.('reply send failed: ' + (error instanceof Error ? error.message : String(error))) } catch {}
    }
  }

  const warnStream = (error) => {
    try { warn?.('streaming reply failed: ' + (error instanceof Error ? error.message : String(error))) } catch {}
  }

  const enqueue = (entry, operation) => {
    const next = entry.chain.then(operation, operation)
    entry.chain = next.catch(() => {})
    return next
  }

  const stopHeartbeat = (entry) => {
    const handle = entry.heartbeat
    entry.heartbeat = null
    if (handle === null) return
    try { clearIntervalFn(handle) } catch {}
  }

  const snapshotFor = (entry, renderOptions = {}) => {
    const currentTime = now()
    return {
      card: renderCard(entry, { ...renderOptions, currentTime }),
      footer: renderFooter(entry, currentTime),
    }
  }

  const streamFor = (entry, initialSnapshot) => {
    if (entry.streamPromise !== null) return entry.streamPromise
    if (typeof createStream !== 'function') return Promise.resolve(null)
    const snapshot = initialSnapshot ?? snapshotFor(entry)
    entry.streamPromise = Promise.resolve()
      .then(() => createStream(entry.chatId, {
        initialText: snapshot.card.answer,
        initialStatus: snapshot.card.status,
        initialTools: snapshot.card.tools,
        initialFooter: snapshot.footer,
      }))
      .then((stream) => {
        entry.stream = stream
        return stream
      })
      .catch((error) => {
        entry.streamFailed = true
        warnStream(error)
        return null
      })
    return entry.streamPromise
  }

  const STREAM_ROLLOVER_MS = 9 * 60 * 1000

  const rolloverStream = async (entry) => {
    const previous = entry.stream
    if (previous !== undefined && previous !== null && typeof previous.finish === 'function') {
      const snapshot = snapshotFor(entry)
      try {
        await previous.finish(snapshot.card.answer, snapshot.footer, { status: snapshot.card.status, tools: snapshot.card.tools })
      } catch (error) {
        warnStream(error)
      }
    }
    entry.stream = undefined
    entry.streamPromise = null
    entry.streamFailed = false
    entry.cardStartedAt = now()
  }

  const updateStream = (entry) => {
    const snapshot = snapshotFor(entry)
    return enqueue(entry, async () => {
      if (now() - entry.cardStartedAt >= STREAM_ROLLOVER_MS) await rolloverStream(entry)
      const stream = await streamFor(entry, snapshot)
      if (stream === null || entry.streamFailed || typeof stream.update !== 'function') return false
      try {
        await stream.update(
          snapshot.card.answer,
          snapshot.footer,
          { status: snapshot.card.status, tools: snapshot.card.tools },
        )
        return true
      } catch (error) {
        entry.streamFailed = true
        stopHeartbeat(entry)
        warnStream(error)
        return false
      }
    })
  }

  const refreshFooter = (entry) => enqueue(entry, async () => {
    const stream = await streamFor(entry)
    if (stream === null || entry.streamFailed) return false
    try {
      const currentTime = now()
      const footer = renderFooter(entry, currentTime)
      if (typeof stream.updateFooter === 'function') await stream.updateFooter(footer)
      else if (typeof stream.update === 'function') {
        const card = renderCard(entry, { currentTime })
        await stream.update(card.answer, footer, { status: card.status, tools: card.tools })
      } else return false
      return true
    } catch (error) {
      stopHeartbeat(entry)
      warnStream(error)
      return false
    }
  })

  const startHeartbeat = (entry) => {
    if (entry.heartbeat !== null || entry.streamFailed) return
    try {
      const handle = setIntervalFn(async () => {
        if (entry.heartbeat === null || entry.heartbeatRunning || entry.streamFailed || !entry.ready) return
        entry.heartbeatRunning = true
        try { await refreshFooter(entry) } finally { entry.heartbeatRunning = false }
      }, heartbeatInterval)
      entry.heartbeat = handle
      try { handle?.unref?.() } catch {}
    } catch (error) {
      warnStream(error)
    }
  }

  const finalizeEntry = (entry, text) => {
    const snapshot = snapshotFor(entry, { final: true, text })
    return enqueue(entry, async () => {
      const stream = await streamFor(entry, snapshot)
      if (stream !== null && typeof stream.finish === 'function') {
        try {
          await stream.finish(
            snapshot.card.answer,
            snapshot.footer,
            { status: snapshot.card.status, tools: snapshot.card.tools },
          )
          return true
        } catch (error) {
          entry.streamFailed = true
          warnStream(error)
        }
      }
      await safeSend(entry.chatId, text)
      return false
    })
  }

  const removeEntry = (sessionId, entry) => {
    const queue = pending.get(sessionId)
    if (queue === undefined) return false
    const index = queue.indexOf(entry)
    if (index < 0) return false
    stopHeartbeat(entry)
    queue.splice(index, 1)
    if (queue.length === 0) pending.delete(sessionId)
    return true
  }

  const assistantTextOf = (message) => {
    const blocks = message?.content
    if (!Array.isArray(blocks)) return ''
    return blocks
      .filter((block) => block?.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text)
      .join('\n')
      .trim()
  }

  const activeEntryOf = (queue) => queue.find((entry) => entry.ready === true)

  return {
    register(sessionId, chatId, { waitForTurnStart = false, provider = '', model = '', effort = '' } = {}) {
      const sid = String(sessionId ?? '')
      const queue = pending.get(sid) ?? []
      const entry = {
        id: randomUUID(),
        chatId: String(chatId ?? ''),
        ready: !waitForTurnStart && !queue.some((item) => item.ready === true),
        registeredAt: now(),
        startedAt: now(),
        cardStartedAt: now(),
        phase: '准备中',
        provider: String(provider ?? ''),
        model: String(model ?? ''),
        effort: String(effort ?? ''),
        answer: '',
        tools: [],
        stream: undefined,
        streamPromise: null,
        streamFailed: false,
        heartbeat: null,
        heartbeatRunning: false,
        chain: Promise.resolve(),
      }
      queue.push(entry)
      pending.set(sid, queue)
      return { id: entry.id, cancel: () => removeEntry(sid, entry) }
    },

    hasActive(sessionId) {
      const queue = pending.get(String(sessionId ?? ''))
      return queue !== undefined && queue.some((entry) => entry.ready === true)
    },

    // Finalize every live ticket for one agent after a stop request so no
    // card is left spinning on a turn that will never start.
    async cancelAgent(sessionId, session) {
      const sid = String(sessionId ?? '')
      const queue = pending.get(sid)
      if (sid === '' || queue === undefined || queue.length === 0) return false
      const entries = queue.splice(0, queue.length)
      pending.delete(sid)
      const answerOfSession = lastAssistantText(session)
      for (const entry of entries) {
        stopHeartbeat(entry)
        const wasWaiting = !entry.ready
        entry.phase = '已中止'
        const fallback = wasWaiting ? '排队任务已随停止一起取消。' : '任务已中止。'
        entry.answer = (wasWaiting ? '' : answerOfSession) || fallback
        await finalizeEntry(entry, entry.answer)
      }
      return true
    },

    async observeSessionEvent(session, event) {
      const sid = String(session?.id ?? '')
      const queue = pending.get(sid)
      if (sid === '' || queue === undefined || queue.length === 0) return false

      if (event?.type === 'turn/start') {
        let active = activeEntryOf(queue)
        const waiting = active === undefined ? queue.find((entry) => entry.ready === false) : undefined
        if (waiting !== undefined) {
          waiting.ready = true
          waiting.startedAt = now()
          waiting.cardStartedAt = now()
          waiting.phase = '思考中'
          active = waiting
        }
        if (active === undefined) return false
        if (waiting === undefined) {
          active.startedAt = now()
          active.cardStartedAt = now()
          active.phase = '思考中'
        }
        await updateStream(active)
        startHeartbeat(active)
        return false
      }

      const active = activeEntryOf(queue)
      if (event?.type === 'assistant/chunk' && active !== undefined) {
        const chunk = event.data?.chunk
        if (chunk?.type === 'text-delta' && typeof chunk.text === 'string' && chunk.text !== '') {
          active.answer += chunk.text
          active.phase = '生成回答'
          await updateStream(active)
        }
        return false
      }

      if (event?.type === 'assistant/message' && active !== undefined) {
        const text = assistantTextOf(event.data?.message)
        if (text !== '') {
          active.answer = text
          active.phase = '整理回答'
          await updateStream(active)
        }
        return false
      }

      if (event?.type === 'tool/call' && active !== undefined) {
        const callId = String(event.data?.callId ?? randomUUID())
        active.phase = '执行工具'
        active.tools.push({
          callId,
          name: String(event.data?.name ?? '工具'),
          status: 'running',
          startedAt: Number(event.time) || now(),
          result: '',
        })
        await updateStream(active)
        return false
      }

      if (event?.type === 'tool/result' && active !== undefined) {
        const callId = String(event.data?.callId ?? '')
        const tool = active.tools.find((item) => item.callId === callId && item.status === 'running')
          ?? [...active.tools].reverse().find((item) => item.status === 'running')
        if (tool !== undefined) {
          tool.status = event.data?.error === undefined ? 'done' : 'error'
          tool.finishedAt = Number(event.time) || now()
          tool.result = event.data?.error?.message ?? messageTextOf(event.data?.message)
        }
        active.phase = '继续思考'
        await updateStream(active)
        return false
      }

      if (event?.type !== 'turn/end') return false
      const index = queue.findIndex((entry) => entry.ready === true)
      if (index < 0) return false
      const [entry] = queue.splice(index, 1)
      stopHeartbeat(entry)
      if (queue.length === 0) pending.delete(sid)
      const reason = event?.data?.reason?.kind
      const answer = lastAssistantText(session) || entry.answer
      const fallback = reason === 'error'
        ? 'Agent 执行失败，请查看 DSH Web 日志。'
        : reason === 'aborted' || reason === 'interrupted'
          ? '任务已中止。'
          : '任务已完成，但没有可回传的文本。'
      entry.phase = reason === 'error' ? '失败' : reason === 'aborted' || reason === 'interrupted' ? '已中止' : '已完成'
      entry.answer = answer || fallback
      await finalizeEntry(entry, entry.answer)
      return true
    },

    async observeAgentError(payload = {}) {
      const agent = payload.agent
      const sid = String(agent?.id ?? agent?.session?.id ?? '')
      const queue = pending.get(sid)
      if (sid === '' || queue === undefined || queue.length === 0) return false
      const [entry] = queue.splice(0, 1)
      stopHeartbeat(entry)
      if (queue.length === 0) pending.delete(sid)
      const detail = payload.error instanceof Error ? payload.error.message : String(payload.error?.message ?? payload.error ?? 'unknown error')
      entry.phase = '失败'
      entry.answer = 'Agent 执行出错：' + detail
      await finalizeEntry(entry, entry.answer)
      return true
    },

    async observeAgentDisposed(sessionId) {
      const sid = String(sessionId ?? '')
      const queue = pending.get(sid)
      if (queue === undefined) return
      pending.delete(sid)
      for (const entry of queue) {
        stopHeartbeat(entry)
        entry.phase = '已中止'
        entry.answer = '会话已退出，无法继续处理这条飞书消息。'
        await finalizeEntry(entry, entry.answer)
      }
    },

    pendingCount(sessionId) {
      return pending.get(String(sessionId ?? ''))?.length ?? 0
    },

    dispose() {
      for (const queue of pending.values()) {
        for (const entry of queue) stopHeartbeat(entry)
      }
      pending.clear()
    },
  }
}
