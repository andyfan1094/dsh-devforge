// Vendored from dsh-feishu 0.2.2 (MIT, andyfan1094/dsh-feishu).
// dsh-devforge consolidation modification: module folded into dsh-devforge;
// runtime behavior preserved. See THIRD_PARTY_NOTICES.md.
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'

const SDK_PACKAGE = '@larksuiteoapi/node-sdk'
const DEFAULT_DOMAIN = 'https://open.feishu.cn'
const MAX_TEXT_CHARS = 4000
const STREAM_STATUS_ELEMENT_ID = 'dsh_feishu_status'
const STREAM_TOOLS_ELEMENT_ID = 'dsh_feishu_tools'
const STREAM_TOOLS_TEXT_ELEMENT_ID = 'dsh_feishu_tools_txt'
const STREAM_ELEMENT_ID = 'dsh_feishu_answer'
const STREAM_META_ELEMENT_ID = 'dsh_feishu_meta'
const STREAM_META_TEXT_ELEMENT_ID = 'dsh_feishu_meta_txt'
const STREAM_STOP_ELEMENT_ID = 'dsh_feishu_stop_btn'
export const CARD_STOP_ACTION = 'stop'
const STREAM_INITIAL_STATUS = '**准备中**'
const STREAM_INITIAL_TEXT = '正在处理，请稍候...'
const STREAM_INITIAL_FOOTER = '模型：默认 · 思考强度：默认 · 耗时：0秒'

export function receiveIdTypeOf(id) {
  const value = String(id ?? '')
  if (value.startsWith('oc_')) return 'chat_id'
  if (value.startsWith('on_')) return 'union_id'
  return 'open_id'
}

export function extractText(content) {
  try {
    const parsed = JSON.parse(String(content ?? ''))
    const text = typeof parsed?.text === 'string' ? parsed.text : ''
    return text.replace(/@_user_\d+/g, '').trim()
  } catch {
    return ''
  }
}

export function extractPostText(content) {
  let parsed
  try {
    parsed = JSON.parse(String(content ?? ''))
  } catch {
    return ''
  }
  const lines = []
  const title = typeof parsed?.title === 'string' ? parsed.title.trim() : ''
  if (title !== '') lines.push(title)
  for (const paragraph of Array.isArray(parsed?.content) ? parsed.content : []) {
    if (!Array.isArray(paragraph)) continue
    const parts = []
    for (const element of paragraph) {
      const tag = String(element?.tag ?? '')
      const text = typeof element?.text === 'string' ? element.text : ''
      if (tag === 'text' || tag === 'a' || tag === 'code_block') {
        if (text !== '') parts.push(text)
      } else if (tag === 'at') {
        const name = typeof element?.user_name === 'string' ? element.user_name.trim() : ''
        parts.push('@' + (name !== '' ? name : 'user'))
      } else if (tag === 'img') {
        parts.push('[图片]')
      } else if (tag === 'media') {
        parts.push('[视频]')
      } else if (tag === 'emotion') {
        parts.push('[表情]')
      }
    }
    const line = parts.join('').trim()
    if (line !== '') lines.push(line)
  }
  return lines.join('\n').trim()
}

export function extractPostImageKeys(content) {
  let parsed
  try {
    parsed = JSON.parse(String(content ?? ''))
  } catch {
    return []
  }
  const keys = []
  for (const paragraph of Array.isArray(parsed?.content) ? parsed.content : []) {
    if (!Array.isArray(paragraph)) continue
    for (const element of paragraph) {
      if (String(element?.tag ?? '') !== 'img') continue
      const key = String(element?.image_key ?? '').trim()
      if (key !== '' && !keys.includes(key)) keys.push(key)
    }
  }
  return keys
}

export function mentionedAppIdsOf(message) {
  const mentions = Array.isArray(message?.mentions) ? message.mentions : []
  const ids = []
  for (const mention of mentions) {
    const appId = String(mention?.id?.app_id ?? '').trim()
    if (appId !== '') ids.push(appId)
  }
  return [...new Set(ids)]
}

export function isMentionedByApp(message, appId) {
  const wanted = String(appId ?? '').trim()
  if (wanted === '') return false
  return mentionedAppIdsOf(message).includes(wanted)
}

export function shouldDeliverGroupMessage(config, message) {
  if (String(message?.chat_type ?? '') !== 'group') return true
  const mode = String(config?.groupMode ?? 'all').trim() || 'all'
  if (mode === 'all') return true
  return isMentionedByApp(message, config?.appId)
}

const MEDIA_TTL_MS = 3 * 24 * 60 * 60 * 1000
const MANIFEST_FILENAME = 'MANIFEST.jsonl'
const META_SUFFIX = '.meta.json'

function sniffImageExtension(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return 'bin'
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'png'
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpg'
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) return 'gif'
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'webp'
  return 'bin'
}

async function collectBytes(payload) {
  if (payload === null || payload === undefined) return null
  if (typeof payload.getReadableStream === 'function') return collectBytes(payload.getReadableStream())
  if (Buffer.isBuffer(payload)) return payload
  if (ArrayBuffer.isView(payload)) return Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength)
  if (typeof payload.pipe === 'function') {
    return await new Promise((resolve, reject) => {
      const chunks = []
      payload.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
      payload.on('end', () => resolve(Buffer.concat(chunks)))
      payload.on('error', reject)
    })
  }
  if (typeof payload.getReader === 'function') {
    const reader = payload.getReader()
    const chunks = []
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(Buffer.from(value))
    }
    return Buffer.concat(chunks)
  }
  if (typeof payload[Symbol.asyncIterator] === 'function') {
    const chunks = []
    for await (const chunk of payload) chunks.push(Buffer.from(chunk))
    return Buffer.concat(chunks)
  }
  return null
}

function pruneMediaFiles(rootDir) {
  try {
    const now = Date.now()
    const walk = (dir) => {
      let entries
      try { entries = fs.readdirSync(dir) } catch { return }
      for (const name of entries) {
        const full = path.join(dir, name)
        let stat
        try { stat = fs.statSync(full) } catch { continue }
        if (stat.isDirectory()) {
          walk(full)
          try { fs.rmdirSync(full) } catch {}
          continue
        }
        if (!stat.isFile()) continue
        if (name === MANIFEST_FILENAME || name.endsWith(META_SUFFIX)) continue
        if (now - stat.mtimeMs > MEDIA_TTL_MS) fs.rmSync(full, { force: true })
      }
    }
    walk(rootDir)
  } catch {}
}

function chunksOf(text) {
  const chars = Array.from(String(text ?? ''))
  const chunks = []
  for (let i = 0; i < chars.length; i += MAX_TEXT_CHARS) {
    chunks.push(chars.slice(i, i + MAX_TEXT_CHARS).join(''))
  }
  return chunks.length > 0 ? chunks : ['']
}

function buildFooter(content) {
  return {
    tag: 'div',
    element_id: STREAM_META_ELEMENT_ID,
    margin: '8px 0 0 0',
    text: {
      tag: 'plain_text',
      element_id: STREAM_META_TEXT_ELEMENT_ID,
      content,
      text_size: 'notation',
      text_color: 'grey',
      text_align: 'left',
    },
  }
}

function buildToolSteps(content) {
  return {
    tag: 'div',
    element_id: STREAM_TOOLS_ELEMENT_ID,
    margin: '0px 0 0 0',
    text: {
      tag: 'plain_text',
      element_id: STREAM_TOOLS_TEXT_ELEMENT_ID,
      content: String(content ?? '') || ' ',
      text_size: 'notation',
      text_align: 'left',
    },
  }
}

export function buildStreamingCard(content = STREAM_INITIAL_TEXT, {
  streaming = true,
  summary = content,
  footer = STREAM_INITIAL_FOOTER,
  status = STREAM_INITIAL_STATUS,
  tools = '',
} = {}) {
  const footerContent = String(footer ?? '').trim() || STREAM_INITIAL_FOOTER
  const statusContent = String(status ?? '').trim() || STREAM_INITIAL_STATUS
  const card = {
    schema: '2.0',
    header: {
      template: 'blue',
      title: { tag: 'plain_text', content: 'DSH Agent 执行过程' },
    },
    config: {
      streaming_mode: streaming,
      summary: { content: String(summary ?? '').slice(0, 120) || STREAM_INITIAL_TEXT },
      ...(streaming ? {
        streaming_config: {
          print_frequency_ms: { default: 70 },
          print_step: { default: 1 },
          print_strategy: 'fast',
        },
      } : {}),
    },
    body: {
      elements: [{
        tag: 'markdown',
        element_id: STREAM_STATUS_ELEMENT_ID,
        content: statusContent,
      }, buildToolSteps(tools), {
        tag: 'markdown',
        element_id: STREAM_ELEMENT_ID,
        content: String(content ?? '') || STREAM_INITIAL_TEXT,
      }, { tag: 'hr' }, buildFooter(footerContent), {
        tag: 'button',
        element_id: STREAM_STOP_ELEMENT_ID,
        size: 'tiny',
        type: 'default',
        text: { tag: 'plain_text', content: '停止任务' },
        behaviors: [{ type: 'callback', value: { action: CARD_STOP_ACTION } }],
      }],
    },
  }
  return card
}

function assertResponseOk(response, operation) {
  if (response?.code !== undefined && Number(response.code) !== 0) {
    throw new Error('Feishu ' + operation + ' failed: code=' + response.code + ' msg=' + (response.msg ?? ''))
  }
}

export function buildImagePrompt({ text = '', imagePath = '', imageMeta = null } = {}) {
  const meta = (imageMeta !== null && typeof imageMeta === 'object') ? imageMeta : {}
  const trimmed = String(text ?? '').trim()
  const lines = []
  if (trimmed !== '' && trimmed !== '[图片]') {
    lines.push('用户附带文字：' + trimmed)
  }
  lines.push('【飞书图片】用户从飞书发来一张图片。图片已下载到本地，**请立即调用 read_image 工具（参数 file_path 填下面的绝对路径）**读取后再回答用户——不要再 glob / find / grep 搜索，路径已确定。')
  lines.push('')
  lines.push('绝对路径: ' + imagePath)
  if (typeof meta.messageId === 'string' && meta.messageId !== '') lines.push('飞书 message_id: ' + meta.messageId)
  if (typeof meta.chatId === 'string' && meta.chatId !== '') lines.push('飞书 chat_id: ' + meta.chatId)
  if (typeof meta.format === 'string' && meta.format !== '') lines.push('格式: ' + meta.format)
  if (typeof meta.bytes === 'number') lines.push('字节数: ' + meta.bytes)
  if (typeof meta.sha256 === 'string' && meta.sha256 !== '') lines.push('SHA-256: ' + meta.sha256)
  if (typeof meta.savedAt === 'string' && meta.savedAt !== '') lines.push('下载时间: ' + meta.savedAt)
  lines.push('')
  lines.push('推荐调用：')
  lines.push('  read_image(file_path="' + imagePath + '")')
  lines.push('  vision_describe(paths=["' + imagePath + '"])')
  return lines.join('\n')
}

export function createFeishuClient({
  config = {},
  onMessage,
  sdkLoader,
  logger,
  onStopRequest,
  onMenuCommand,
  onLoadState,
  onSaveState,
} = {}) {
  const domain = String(config.domain ?? DEFAULT_DOMAIN).replace(/\/+$/, '') || DEFAULT_DOMAIN
  const loadSdk = sdkLoader ?? (async () => import(SDK_PACKAGE))
  const mediaDir = String(config.mediaDir ?? '').trim() !== ''
    ? String(config.mediaDir)
    : path.join(String(config.cwd ?? process.cwd()), '.dsh-feishu-media')
  let client = null
  let wsClient = null
  let startPromise = null
  let running = false
  let connected = false
  let lastError = ''
  let lastCardError = ''
  // card message_id -> { chatId, cardId }; powers the stop-button callback.
  const cardIndex = new Map()
  const seenMessageIds = new Set()
  const recentChatByUser = new Map()

  const warn = (message) => {
    try { logger?.warn?.('[dsh-feishu]', message) } catch {}
    try { console.error('[dsh-feishu]', message) } catch {}
  }

  async function sendText(chatId, text, { replyTo = '' } = {}) {
    if (client === null) return false
    const receiveId = String(chatId ?? '').trim()
    if (receiveId === '') return false
    const postText = async (chunk) => {
      if (replyTo !== '' && typeof client.im?.v1?.message?.reply === 'function') {
        try {
          const reply = await client.im.v1.message.reply({
            path: { message_id: String(replyTo) },
            data: { msg_type: 'text', content: JSON.stringify({ text: chunk }) },
          })
          if (reply?.code === undefined || Number(reply.code) === 0) return
        } catch (error) {
          warn('Feishu reply send failed, falling back: ' + (error instanceof Error ? error.message : String(error)))
        }
      }
      const response = await client.im.v1.message.create({
        params: { receive_id_type: receiveIdTypeOf(receiveId) },
        data: {
          receive_id: receiveId,
          msg_type: 'text',
          content: JSON.stringify({ text: chunk }),
        },
      })
      if (response?.code !== undefined && Number(response.code) !== 0) {
        throw new Error('Feishu send failed: code=' + response.code + ' msg=' + (response.msg ?? ''))
      }
    }
    try {
      for (const chunk of chunksOf(text)) await postText(chunk)
      return true
    } catch (error) {
      warn('Feishu send failed: ' + (error instanceof Error ? error.message : String(error)))
      return false
    }
  }

  async function createStreamingCard(chatId, {
    initialText = STREAM_INITIAL_TEXT,
    initialStatus = STREAM_INITIAL_STATUS,
    initialTools = '',
    initialFooter = STREAM_INITIAL_FOOTER,
    rootMessageId = '',
  } = {}) {
    if (client === null) return null
    const receiveId = String(chatId ?? '').trim()
    if (receiveId === '') return null
    const messageApi = client.im?.v1?.message
    const cardApi = client.cardkit?.v1?.card
    const cardElementApi = client.cardkit?.v1?.cardElement
    const native = typeof cardApi?.create === 'function'
      && typeof cardApi?.settings === 'function'
      && typeof cardElementApi?.content === 'function'
    const patch = typeof messageApi?.patch === 'function'
    if (!native && !patch) return null
    if (typeof messageApi?.create !== 'function') return null

    const initial = String(initialText ?? '').trim() || STREAM_INITIAL_TEXT
    const initialStatusValue = String(initialStatus ?? '').trim() || STREAM_INITIAL_STATUS
    const initialToolsValue = String(initialTools ?? '')
    const initialFooterValue = String(initialFooter ?? '').trim() || STREAM_INITIAL_FOOTER
    const cardSpec = buildStreamingCard(initial, {
      status: initialStatusValue,
      tools: initialToolsValue,
      footer: initialFooterValue,
    })
    let cardId = ''
    let messageId = ''
    const postInteractive = async (contentJson) => {
      if (rootMessageId !== '' && typeof messageApi?.reply === 'function') {
        try {
          const response = await messageApi.reply({
            path: { message_id: String(rootMessageId) },
            data: { msg_type: 'interactive', content: contentJson },
          })
          if (response?.code === undefined || Number(response.code) === 0) {
            return String(response?.data?.message_id ?? '')
          }
        } catch (error) {
          warn('Feishu card reply failed, falling back to direct send: ' + (error instanceof Error ? error.message : String(error)))
        }
      }
      const response = await messageApi.create({
        params: { receive_id_type: receiveIdTypeOf(receiveId) },
        data: {
          receive_id: receiveId,
          msg_type: 'interactive',
          content: contentJson,
        },
      })
      assertResponseOk(response, 'streaming card send')
      return String(response?.data?.message_id ?? '')
    }
    if (native) {
      const cardResponse = await cardApi.create({
        data: { type: 'card_json', data: JSON.stringify(cardSpec) },
      })
      assertResponseOk(cardResponse, 'card create')
      cardId = String(cardResponse?.data?.card_id ?? '')
      if (cardId === '') throw new Error('Feishu card create returned no card_id')
      messageId = await postInteractive(JSON.stringify({ type: 'card', data: { card_id: cardId } }))
    } else {
      messageId = await postInteractive(JSON.stringify(cardSpec))
    }
    if (messageId === '') throw new Error('Feishu streaming card send returned no message_id')
    cardIndex.set(messageId, { chatId: receiveId, cardId })

    let sequence = 0
    let statusContent = initialStatusValue
    let toolsContent = initialToolsValue
    let content = initial
    let footerContent = initialFooterValue
    let chain = Promise.resolve()
    const enqueue = (operation) => {
      const next = chain.then(operation, operation).then(
        (value) => { lastCardError = ''; return value },
        (error) => { lastCardError = error instanceof Error ? error.message : String(error); throw error },
      )
      chain = next.catch(() => {})
      return next
    }
    const patchMessage = (card) => messageApi.patch({
      path: { message_id: messageId },
      data: { content: JSON.stringify(card) },
    }).then((response) => {
      assertResponseOk(response, 'streaming card patch')
      return response
    })
    const updateNativeElement = async (elementId, value, uuidPrefix, operation) => {
      const nextSequence = ++sequence
      const response = await cardElementApi.content({
        path: { card_id: cardId, element_id: elementId },
        data: {
          content: value,
          sequence: nextSequence,
          uuid: uuidPrefix + '_' + cardId + '_' + nextSequence,
        },
      })
      assertResponseOk(response, operation)
    }

    return {
      messageId,
      cardId: native ? cardId : undefined,
      mode: native ? 'cardkit' : 'message-patch',
      update(nextContent, nextFooter, nextState = {}) {
        const nextStatusContent = String(nextState?.status ?? statusContent).trim() || STREAM_INITIAL_STATUS
        const nextToolsContent = String(nextState?.tools ?? toolsContent)
        const nextAnswerContent = String(nextContent ?? '') || STREAM_INITIAL_TEXT
        const nextFooterContent = String(nextFooter ?? footerContent).trim() || STREAM_INITIAL_FOOTER
        const changed = {
          status: nextStatusContent !== statusContent,
          tools: nextToolsContent !== toolsContent,
          answer: nextAnswerContent !== content,
          footer: nextFooterContent !== footerContent,
        }
        statusContent = nextStatusContent
        toolsContent = nextToolsContent
        content = nextAnswerContent
        footerContent = nextFooterContent
        const snapshot = {
          status: statusContent,
          tools: toolsContent,
          answer: content,
          footer: footerContent,
        }
        return enqueue(async () => {
          if (native) {
            if (changed.status) await updateNativeElement(STREAM_STATUS_ELEMENT_ID, snapshot.status, 'p', 'streaming card status update')
            if (changed.tools) await updateNativeElement(STREAM_TOOLS_TEXT_ELEMENT_ID, snapshot.tools || ' ', 't', 'streaming card tools update')
            if (changed.answer) await updateNativeElement(STREAM_ELEMENT_ID, snapshot.answer, 'c', 'streaming card answer update')
            if (changed.footer) await updateNativeElement(STREAM_META_TEXT_ELEMENT_ID, snapshot.footer, 'f', 'streaming card footer update')
            return
          }
          if (changed.status || changed.tools || changed.answer || changed.footer) {
            await patchMessage(buildStreamingCard(snapshot.answer, snapshot))
          }
        })
      },
      updateFooter(nextFooter) {
        const nextFooterContent = String(nextFooter ?? footerContent).trim() || STREAM_INITIAL_FOOTER
        const changed = nextFooterContent !== footerContent
        footerContent = nextFooterContent
        const snapshot = footerContent
        return enqueue(async () => {
          if (!changed) return
          if (native) {
            await updateNativeElement(STREAM_META_TEXT_ELEMENT_ID, snapshot, 'f', 'streaming card footer heartbeat')
            return
          }
          await patchMessage(buildStreamingCard(content, {
            status: statusContent,
            tools: toolsContent,
            footer: snapshot,
          }))
        })
      },
      finish(summary, nextFooter, nextState = {}) {
        const nextStatusContent = String(nextState?.status ?? statusContent).trim() || STREAM_INITIAL_STATUS
        const nextToolsContent = String(nextState?.tools ?? toolsContent)
        const nextAnswerContent = String(summary ?? content) || '任务已完成，但没有可回传的文本。'
        const nextFooterContent = String(nextFooter ?? footerContent).trim() || STREAM_INITIAL_FOOTER
        const changed = {
          status: nextStatusContent !== statusContent,
          tools: nextToolsContent !== toolsContent,
          answer: nextAnswerContent !== content,
          footer: nextFooterContent !== footerContent,
        }
        statusContent = nextStatusContent
        toolsContent = nextToolsContent
        content = nextAnswerContent
        footerContent = nextFooterContent
        const final = {
          status: statusContent,
          tools: toolsContent,
          answer: content,
          footer: footerContent,
        }
        return enqueue(async () => {
          if (native) {
            if (changed.status) await updateNativeElement(STREAM_STATUS_ELEMENT_ID, final.status, 'p', 'streaming card final status update')
            if (changed.tools) await updateNativeElement(STREAM_TOOLS_TEXT_ELEMENT_ID, final.tools || ' ', 't', 'streaming card final tools update')
            if (changed.answer) await updateNativeElement(STREAM_ELEMENT_ID, final.answer, 'c', 'streaming card final answer update')
            if (changed.footer) await updateNativeElement(STREAM_META_TEXT_ELEMENT_ID, final.footer, 'f', 'streaming card footer final update')
            const settingsSequence = ++sequence
            const settingsResponse = await cardApi.settings({
              path: { card_id: cardId },
              data: {
                settings: JSON.stringify({
                  config: { streaming_mode: false, summary: { content: final.answer.slice(0, 120) } },
                }),
                sequence: settingsSequence,
                uuid: 's_' + cardId + '_' + settingsSequence,
              },
            })
            assertResponseOk(settingsResponse, 'streaming card finish')
            return
          }
          await patchMessage(buildStreamingCard(final.answer, {
            streaming: false,
            summary: final.answer,
            status: final.status,
            tools: final.tools,
            footer: final.footer,
          }))
        })
      },
    }
  }

  async function reactToMessage(messageId, emojiType = 'OK') {
    if (client === null) return false
    const id = String(messageId ?? '').trim()
    const emoji = String(emojiType ?? 'OK').trim() || 'OK'
    if (id === '') return false
    try {
      const response = await client.im.v1.messageReaction.create({
        path: { message_id: id },
        data: { reaction_type: { emoji_type: emoji } },
      })
      if (response?.code !== undefined && Number(response.code) !== 0) {
        throw new Error('Feishu reaction failed: code=' + response.code + ' msg=' + (response.msg ?? ''))
      }
      return true
    } catch (error) {
      warn('Feishu reaction failed: ' + (error instanceof Error ? error.message : String(error)))
      return false
    }
  }

  async function downloadResource(messageId, fileKey, type) {
    const response = await client.im.v1.messageResource?.get?.({
      path: { message_id: messageId, file_key: fileKey },
      params: { type },
    })
    if (response?.code !== undefined && Number(response.code) !== 0) {
      throw new Error('code=' + response.code + ' msg=' + (response.msg ?? ''))
    }
    const bytes = await collectBytes(response?.data ?? response)
    if (bytes === null || bytes.length === 0) throw new Error('empty resource payload')
    return bytes
  }

  function saveMediaBytes(bytes, chatIdRaw, messageId, ext, baseMeta) {
    fs.mkdirSync(mediaDir, { recursive: true })
    pruneMediaFiles(mediaDir)
    const safeChatId = chatIdRaw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) || 'unknown'
    const safeMsgId = messageId.replace(/[^a-zA-Z0-9_-]/g, '_')
    const chatDir = path.join(mediaDir, safeChatId)
    fs.mkdirSync(chatDir, { recursive: true })
    const candidatePath = path.join(chatDir, Date.now() + '-' + safeMsgId + '-' + Math.random().toString(36).slice(2, 6) + '.' + ext)
    fs.writeFileSync(candidatePath, bytes)
    const meta = {
      ...baseMeta,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      bytes: bytes.length,
      format: ext,
      savedAt: new Date().toISOString(),
      absPath: candidatePath,
    }
    try { fs.writeFileSync(candidatePath + META_SUFFIX, JSON.stringify(meta, null, 2), 'utf8') }
    catch (error) { warn('Feishu media meta write failed: ' + (error instanceof Error ? error.message : String(error))) }
    try { fs.appendFileSync(path.join(mediaDir, MANIFEST_FILENAME), JSON.stringify(meta) + '\n', 'utf8') }
    catch (error) { warn('Feishu manifest append failed: ' + (error instanceof Error ? error.message : String(error))) }
    return { path: candidatePath, meta }
  }

  async function transcribeAudioFile(filePath) {
    const baseUrl = String(config.asrBaseUrl ?? '').trim().replace(/\/+$/, '')
    const apiKey = String(config.asrApiKey ?? '').trim()
    if (baseUrl === '' || apiKey === '') return ''
    const model = String(config.asrModel ?? '').trim() || 'whisper-1'
    try {
      const form = new FormData()
      form.append('file', new Blob([fs.readFileSync(filePath)]), path.basename(filePath))
      form.append('model', model)
      const response = await fetch(baseUrl + '/audio/transcriptions', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + apiKey },
        body: form,
      })
      if (!response.ok) throw new Error('HTTP ' + response.status)
      const body = await response.json().catch(() => ({}))
      return String(body?.text ?? '').trim()
    } catch (error) {
      warn('Feishu voice transcription failed: ' + (error instanceof Error ? error.message : String(error)))
      return ''
    }
  }

  async function handleMediaMessage(data, { kind = 'image', caption = '', imageKeys = [] } = {}) {
    try {
      const message = data?.message ?? {}
      const userId = String(data?.sender?.sender_id?.open_id ?? '')
      const messageId = String(message.message_id ?? '')
      if (userId === '' || messageId === '') return
      let parsedContent = {}
      try { parsedContent = JSON.parse(String(message.content ?? '{}')) ?? {} } catch {}
      const chatIdRaw = String(message.chat_id ?? userId)

      if (kind !== 'image' && String(parsedContent.file_key ?? '').trim() === '') {
        const envelope = { channel: 'feishu', userId, chatId: chatIdRaw, chatType: String(message.chat_type ?? ''), messageId, text: '[unsupported Feishu message: ' + kind + ']' }
        Promise.resolve(onMessage?.(envelope, { sendText, react: reactToMessage })).catch((error) => {
          warn('Feishu message handler failed: ' + (error instanceof Error ? error.message : String(error)))
        })
        return
      }

      const wantedKeys = []
      if (kind === 'image') {
        const keys = imageKeys.length > 0 ? [...imageKeys] : []
        if (keys.length === 0) {
          const single = String(parsedContent.image_key ?? '').trim()
          if (single !== '') keys.push(single)
        }
        for (const key of keys) wantedKeys.push({ key, ext: '' })
      } else {
        const key = String(parsedContent.file_key ?? '').trim()
        if (key !== '') {
          const fileName = String(parsedContent.file_name ?? '')
          const ext = kind === 'audio' ? 'opus' : kind === 'media' ? 'mp4' : (extname(fileName).slice(1).toLowerCase() || 'bin')
          wantedKeys.push({ key, ext, fileName })
        }
      }

      const downloaded = []
      const failures = []
      if (client === null) {
        failures.push('[媒体接收失败：客户端未就绪]')
      } else if (wantedKeys.length === 0) {
        failures.push('[媒体接收失败：缺少 file_key]')
      } else {
        for (const item of wantedKeys) {
          try {
            const bytes = await downloadResource(messageId, item.key, kind === 'image' ? 'image' : 'file')
            const resolvedExt = kind === 'image' ? sniffImageExtension(bytes) : item.ext
            const saved = saveMediaBytes(bytes, chatIdRaw, messageId, resolvedExt, {
              messageId,
              chatId: chatIdRaw,
              userId,
              fileKey: item.key,
              kind,
              ...(item.fileName !== undefined && item.fileName !== '' ? { fileName: item.fileName } : {}),
            })
            downloaded.push({ path: saved.path, meta: saved.meta })
          } catch (error) {
            failures.push((error instanceof Error ? error.message : String(error)))
          }
        }
      }

      const savedPaths = []
      const metas = []
      for (const item of downloaded) {
        savedPaths.push(item.path)
        metas.push(item.meta)
      }

      let text = ''
      const notes = []
      if (kind === 'image') {
        text = caption.trim() !== '' && caption.trim() !== '[图片]' ? caption.trim() : ''
        if (savedPaths.length > 0 && text === '') text = savedPaths.length > 1 ? '[图片]x' + savedPaths.length : '[图片]'
        if (savedPaths.length > 1) notes.push('（共 ' + savedPaths.length + ' 张图片已保存到本地）')
        if (failures.length > 0) {
          notes.push(savedPaths.length > 0
            ? '[其余 ' + failures.length + ' 张图片下载失败：' + failures[0] + ']'
            : '[图片下载失败：' + failures[0] + ']')
        }
      } else {
        const label = kind === 'audio' ? '语音' : kind === 'media' ? '视频' : '文件'
        if (kind === 'audio' && savedPaths.length > 0) {
          const transcript = await transcribeAudioFile(savedPaths[0])
          if (transcript !== '') text = transcript
        }
        if (savedPaths.length > 0) notes.push('（' + label + '附件已保存到本地: ' + savedPaths[0] + '）')
        if (failures.length > 0) notes.push('[' + label + '接收失败: ' + failures[0] + ']')
        if (text === '' && savedPaths.length === 0 && failures.length > 0) text = failures[0]
        if (text === '') text = '[' + label + '消息]'
      }
      text = [text, ...notes.filter(Boolean)].filter(Boolean).join('\n').trim()
      if (text === '') return

      const hasImages = kind === 'image' && savedPaths.length > 0
      const envelope = {
        channel: 'feishu',
        userId,
        chatId: chatIdRaw,
        chatType: String(message.chat_type ?? ''),
        messageId,
        text,
        ...(hasImages ? { imagePaths: savedPaths, imageMetas: metas, imagePath: savedPaths[0], imageMeta: metas[0] } : {}),
        ...(!hasImages && savedPaths.length > 0 ? { filePath: savedPaths[0], fileMeta: metas[0] } : {}),
      }
      Promise.resolve(onMessage?.(envelope, { sendText, react: reactToMessage })).catch((error) => {
        warn('Feishu message handler failed: ' + (error instanceof Error ? error.message : String(error)))
      })
    } catch (error) {
      warn('Feishu event handling failed: ' + (error instanceof Error ? error.message : String(error)))
    }
  }

  const lastInboundByMessage = new Map()

  function rememberInbound(message) {
    const id = String(message?.message_id ?? '')
    if (id === '') return false
    if (seenMessageIds.has(id)) return false
    seenMessageIds.add(id)
    if (seenMessageIds.size > 600) {
      for (const key of [...seenMessageIds].slice(0, 200)) seenMessageIds.delete(key)
    }
    return true
  }

  function deliverEnvelope(envelope) {
    const chatId = String(envelope.chatId ?? '')
    const userId = String(envelope.userId ?? '')
    if (chatId !== '' && userId !== '') recentChatByUser.set(userId, chatId)
    if (envelope.kind !== 'edit' && String(envelope.messageId ?? '') !== '') {
      lastInboundByMessage.set(String(envelope.messageId), {
        userId,
        chatId,
        chatType: String(envelope.chatType ?? ''),
        at: Date.now(),
      })
      if (lastInboundByMessage.size > 300) {
        for (const key of [...lastInboundByMessage.keys()].slice(0, 100)) lastInboundByMessage.delete(key)
      }
      if (typeof onSaveState === 'function' && chatId.startsWith('oc_')) {
        try {
          onSaveState({ chats: { [chatId]: { lastTs: Date.now(), seen: [String(envelope.messageId)] } } })
        } catch {}
      }
    }
    Promise.resolve(onMessage?.(envelope, { sendText, react: reactToMessage })).catch((error) => {
      warn('Feishu message handler failed: ' + (error instanceof Error ? error.message : String(error)))
    })
  }

  async function handleMessage(data) {
    try {
      const message = data?.message ?? {}
      const userId = String(data?.sender?.sender_id?.open_id ?? '')
      const messageId = String(message.message_id ?? '')
      if (userId === '' || messageId === '') return
      if (!rememberInbound(message)) return
      if (!shouldDeliverGroupMessage(config, message)) return
      const messageType = String(message.message_type ?? '')
      const base = {
        channel: 'feishu',
        userId,
        chatId: String(message.chat_id ?? userId),
        chatType: String(message.chat_type ?? ''),
        messageId,
      }
      if (messageType === 'text') {
        const text = extractText(message.content)
        if (text === '') return
        deliverEnvelope({ ...base, text })
        return
      }
      if (messageType === 'post') {
        const imageKeys = extractPostImageKeys(message.content)
        const caption = extractPostText(message.content)
        if (imageKeys.length > 0) {
          await handleMediaMessage(data, { kind: 'image', caption, imageKeys })
          return
        }
        if (caption === '') return
        deliverEnvelope({ ...base, text: caption })
        return
      }
      if (messageType === 'image') {
        await handleMediaMessage(data, { kind: 'image' })
        return
      }
      if (messageType === 'audio' || messageType === 'media' || messageType === 'file') {
        await handleMediaMessage(data, { kind: messageType })
        return
      }
      deliverEnvelope({ ...base, text: '[unsupported Feishu message: ' + (messageType || 'unknown') + ']' })
    } catch (error) {
      warn('Feishu event handling failed: ' + (error instanceof Error ? error.message : String(error)))
    }
  }

  function handleEditedMessage(data) {
    try {
      const message = data?.message ?? {}
      const messageId = String(message.message_id ?? '')
      if (messageId === '' || !seenMessageIds.has(messageId)) return
      const original = lastInboundByMessage.get(messageId)
      if (original === undefined) return
      const newText = extractText(message.content) || extractPostText(message.content)
      if (newText === '') return
      deliverEnvelope({
        channel: 'feishu',
        kind: 'edit',
        userId: original.userId,
        chatId: original.chatId,
        chatType: original.chatType,
        messageId,
        text: '（用户修改了刚才的那条消息，请以修改后的内容为准）\n' + newText,
      })
    } catch (error) {
      warn('Feishu edit handling failed: ' + (error instanceof Error ? error.message : String(error)))
    }
  }

  function handleRecalledMessage(data) {
    try {
      const messageId = String(data?.message_id ?? data?.message?.message_id ?? '')
      info('Feishu message recalled: ' + messageId)
    } catch (error) {
      warn('Feishu recall handling failed: ' + (error instanceof Error ? error.message : String(error)))
    }
  }

  async function handleCardAction(data) {
    try {
      const actionValue = data?.action?.value ?? {}
      const openMessageId = String(data?.context?.open_message_id ?? '')
      if (String(actionValue.action ?? '') !== CARD_STOP_ACTION) return null
      const entry = cardIndex.get(openMessageId)
      const chatId = entry?.chatId ?? ''
      if (chatId === '') return { toast: { content: '未找到对应的飞书会话' } }
      onStopRequest?.(chatId)
      return { toast: { content: '已请求停止当前任务' } }
    } catch (error) {
      warn('Feishu card action failed: ' + (error instanceof Error ? error.message : String(error)))
      return null
    }
  }

  function handleMenuEvent(data) {
    try {
      const key = String(data?.event_key ?? '').trim().toLowerCase()
      if (key === '') return
      const userId = String(data?.operator?.operator_id?.open_id ?? '')
      const chatId = recentChatByUser.get(userId) ?? ''
      if (userId === '' || chatId === '') return
      onMenuCommand?.({ command: key, userId, chatId })
    } catch (error) {
      warn('Feishu menu handling failed: ' + (error instanceof Error ? error.message : String(error)))
    }
  }

  async function catchUpMissedMessages() {
    if (config.syncCatchUp === false) return
    if (typeof onLoadState !== 'function' || typeof onSaveState !== 'function') return
    if (typeof client?.im?.v1?.message?.list !== 'function') return
    let state = null
    try { state = await onLoadState() } catch (error) {
      warn('Feishu catch-up state read failed: ' + (error instanceof Error ? error.message : String(error)))
      return
    }
    const chats = state?.chats
    if (chats === null || chats === undefined || typeof chats !== 'object') return
    const endMs = Date.now()
    for (const [chatId, cursor] of Object.entries(chats)) {
      if (!chatId.startsWith('oc_')) continue
      const startMs = Number(cursor?.lastTs ?? 0)
      try {
        const response = await client.im.v1.message.list({
          params: {
            container_id_type: 'chat',
            container_id: chatId,
            ...(startMs > 0 ? { start_time: String(startMs) } : {}),
            end_time: String(endMs),
            sort_type: 'ByCreateTimeAsc',
            page_size: 50,
          },
        })
        if (response?.code !== undefined && Number(response.code) !== 0) {
          throw new Error('code=' + response.code + ' msg=' + (response.msg ?? ''))
        }
        const items = Array.isArray(response?.data?.items) ? response.data.items : []
        const seen = new Set(Array.isArray(cursor?.seen) ? cursor.seen : [])
        let maxTs = startMs
        let delivered = 0
        for (const item of items) {
          const createTime = Number(item?.create_time ?? 0)
          if (Number.isFinite(createTime) && createTime > maxTs) maxTs = createTime
          const id = String(item?.message_id ?? '')
          if (id === '' || seen.has(id)) continue
          seen.add(id)
          if (String(item?.sender?.sender_type ?? '') !== 'user') continue
          const type = String(item?.msg_type ?? '')
          if (!['text', 'post', 'image', 'audio', 'media', 'file'].includes(type)) continue
          if (delivered >= 20) break
          delivered += 1
          await handleMessage({
            sender: { sender_id: { open_id: String(item?.sender?.id ?? '') } },
            message: {
              message_id: id,
              message_type: type,
              content: String(item?.body?.content ?? ''),
              chat_id: String(item?.chat_id ?? chatId),
              chat_type: String(item?.chat_type ?? 'p2p'),
            },
          })
        }
        onSaveState({ chats: { [chatId]: { lastTs: Math.max(maxTs, endMs), seen: [...seen].slice(-200) } } })
        if (delivered > 0) info('catch-up delivered ' + delivered + ' missed Feishu messages to ' + chatId)
      } catch (error) {
        warn('Feishu catch-up failed for ' + chatId + ': ' + (error instanceof Error ? error.message : String(error)))
      }
    }
  }

  async function startNow() {
    const sdk = await loadSdk()
    if (typeof sdk?.Client !== 'function' || typeof sdk?.WSClient !== 'function' || typeof sdk?.EventDispatcher !== 'function') {
      throw new Error(SDK_PACKAGE + ' must export Client, WSClient and EventDispatcher')
    }
    client = new sdk.Client({ appId: config.appId, appSecret: config.appSecret, domain })
    const sdkWsLogger = {
      info() {},
      warn() {},
      debug() {},
      trace() {},
      error: (...args) => warn('Feishu SDK WSClient: ' + args.map((arg) => arg instanceof Error ? arg.message : String(arg)).join(' ')),
    }
    wsClient = new sdk.WSClient({ appId: config.appId, appSecret: config.appSecret, domain, logger: sdkWsLogger })
    const dispatcher = new sdk.EventDispatcher({}).register({
      'im.message.receive_v1': (data) => handleMessage(data),
      'im.message.message_edited_v1': (data) => handleEditedMessage(data),
      'im.message.recalled_v1': (data) => handleRecalledMessage(data),
      'card.action.trigger': (data) => handleCardAction(data),
      'application.bot.menu_v6': (data) => handleMenuEvent(data),
    })
    await wsClient.start({ eventDispatcher: dispatcher })
    void catchUpMissedMessages().catch((error) => {
      warn('Feishu catch-up crashed: ' + (error instanceof Error ? error.message : String(error)))
    })
  }

  return {
    sendText,
    getClient: () => client,
    async createStreamingCard(chatId, options) {
      lastCardError = ''
      try {
        return await createStreamingCard(chatId, options)
      } catch (error) {
        lastCardError = error instanceof Error ? error.message : String(error)
        throw error
      }
    },
    reactToMessage,
    start() {
      if (running || startPromise !== null) return startPromise
      running = true
      lastError = ''
      startPromise = startNow()
        .then(() => {
          connected = true
          warn('Feishu self-built app WebSocket connected')
        })
        .catch((error) => {
          running = false
          connected = false
          startPromise = null
          lastError = error instanceof Error ? error.message : String(error)
          warn('Feishu WebSocket startup failed: ' + lastError)
        })
      return startPromise
    },
    status() {
      return { state: connected ? 'connected' : running ? 'connecting' : lastError ? 'error' : 'stopped', connected, lastError, lastCardError }
    },
    async stop() {
      running = false
      connected = false
      try {
        await startPromise
        if (wsClient !== null && typeof wsClient.close === 'function') await wsClient.close()
        else if (wsClient !== null && typeof wsClient.stop === 'function') await wsClient.stop()
        else wsClient?.wsConfig?.getWSInstance?.()?.terminate?.()
      } catch {}
      client = null
      wsClient = null
      startPromise = null
    },
  }
}
