// Vendored from dsh-feishu 0.2.2 (MIT, andyfan1094/dsh-feishu).
// dsh-devforge consolidation modification: module folded into dsh-devforge;
// runtime behavior preserved. See THIRD_PARTY_NOTICES.md.
import fs from 'node:fs'
import path from 'node:path'

const FILE_TYPE_BY_EXT = {
  '.opus': 'opus',
  '.ogg': 'opus',
  '.mp4': 'mp4',
  '.mov': 'mp4',
  '.m4v': 'mp4',
  '.pdf': 'pdf',
  '.doc': 'doc',
  '.docx': 'doc',
  '.xls': 'xls',
  '.xlsx': 'xls',
  '.csv': 'xls',
  '.ppt': 'ppt',
  '.pptx': 'ppt',
}

export function fileTypeOf(filePath) {
  const ext = path.extname(String(filePath ?? '')).toLowerCase()
  return FILE_TYPE_BY_EXT[ext] ?? 'stream'
}

export function isWithin(rootDir, candidatePath) {
  const root = path.resolve(String(rootDir ?? ''))
  const candidate = path.resolve(String(candidatePath ?? ''))
  const rel = path.relative(root, candidate)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

export function allowedPathOf(filePath, roots = []) {
  const candidate = String(filePath ?? '').trim()
  if (candidate === '') throw new Error('file path is empty')
  const resolved = path.resolve(candidate)
  for (const root of roots) {
    if (String(root ?? '').trim() !== '' && isWithin(root, resolved)) return resolved
  }
  throw new Error('path is outside the allowed workspace directories: ' + resolved)
}

function assertResponseOk(response, operation) {
  if (response?.code !== undefined && Number(response.code) !== 0) {
    throw new Error('Feishu ' + operation + ' failed: code=' + response.code + ' msg=' + (response.msg ?? ''))
  }
}

export async function uploadImage(client, filePath) {
  const resolved = path.resolve(String(filePath ?? ''))
  // The SDK builds the multipart body itself and expects a Buffer; a ReadStream
  // is silently serialized into garbage and the upload returns no key. The key
  // surfaces at the top level of the response (nested envelope kept as fallback).
  const response = await client.im.v1.image.create({
    data: {
      image_type: 'message',
      image: fs.readFileSync(resolved),
    },
  })
  assertResponseOk(response, 'image upload')
  const imageKey = String(response?.image_key ?? response?.data?.image_key ?? '')
  if (imageKey === '') throw new Error('Feishu image upload returned no image_key')
  return imageKey
}

export async function uploadFile(client, filePath) {
  const resolved = path.resolve(String(filePath ?? ''))
  const fileName = path.basename(resolved)
  const response = await client.im.v1.file.create({
    data: {
      file_type: fileTypeOf(resolved),
      file_name: fileName,
      file: fs.readFileSync(resolved),
    },
  })
  assertResponseOk(response, 'file upload')
  const fileKey = String(response?.file_key ?? response?.data?.file_key ?? '')
  if (fileKey === '') throw new Error('Feishu file upload returned no file_key')
  return fileKey
}

async function deliverMessage(client, chatId, receiveIdType, data, replyTo) {
  if (replyTo) {
    try {
      const response = await client.im.v1.message.reply({
        path: { message_id: String(replyTo) },
        data,
      })
      assertResponseOk(response, 'reply send')
      return String(response?.data?.message_id ?? '')
    } catch (error) {
      if (!/reply|message_id|permission|not exist|deleted/i.test(error instanceof Error ? error.message : String(error))) throw error
    }
  }
  const response = await client.im.v1.message.create({
    params: { receive_id_type: receiveIdType },
    data: { receive_id: String(chatId), ...data },
  })
  assertResponseOk(response, 'send')
  return String(response?.data?.message_id ?? '')
}

export async function sendImage(client, chatId, filePath, { replyTo = '', receiveIdType } = {}) {
  const imageKey = await uploadImage(client, filePath)
  const idType = receiveIdType ?? (String(chatId).startsWith('oc_') ? 'chat_id' : String(chatId).startsWith('on_') ? 'union_id' : 'open_id')
  return await deliverMessage(client, chatId, idType, {
    msg_type: 'image',
    content: JSON.stringify({ image_key: imageKey }),
  }, replyTo)
}

/** 把 Host turn/end 的结构化 TurnEndReason 归一化为可读状态；纯函数便于测试。 */
export function describeTurnEndReason(reason) {
  if (reason === null || reason === undefined || reason === '') {
    return { failed: false, tone: 'green', icon: '✅', label: '任务完成', text: '' }
  }
  if (typeof reason === 'string') {
    const compact = reason.trim()
    if (compact === '' || compact === 'success' || compact === 'completed') {
      return { failed: false, tone: 'green', icon: '✅', label: '任务完成', text: '' }
    }
    return { failed: true, tone: 'red', icon: '❌', label: '任务失败', text: compact.slice(0, 160) }
  }
  if (typeof reason !== 'object') {
    return { failed: true, tone: 'red', icon: '❌', label: '任务失败', text: String(reason).slice(0, 160) }
  }
  const kind = String(reason.kind ?? '')
  if (kind === 'completed') return { failed: false, tone: 'green', icon: '✅', label: '任务完成', text: '' }
  if (kind === 'max-tokens') return { failed: false, tone: 'green', icon: '✅', label: '任务完成', text: '至少一步达到输出上限' }
  if (kind === 'blocked') return { failed: false, tone: 'yellow', icon: '⏸', label: '任务等待输入', text: '' }
  if (kind === 'paused') return { failed: false, tone: 'yellow', icon: '⏸', label: '任务已暂停', text: '' }
  if (kind === 'aborted') {
    const cause = String(reason.reason ?? reason.cause ?? '')
    const causeText = cause === 'user' ? '由用户中止'
      : cause === 'parent' ? '由上级会话中止'
        : cause === 'disposed' ? '会话关闭时中止'
          : cause
    return { failed: false, tone: 'grey', icon: '⚪', label: '任务已中止', text: causeText }
  }
  if (kind === 'interrupted') return { failed: false, tone: 'grey', icon: '⚪', label: '任务中断', text: '会话异常恢复时补记' }
  if (kind === 'error') {
    const failure = reason.error ?? reason
    const message = String(failure.message ?? '').trim() || '未知错误'
    const code = String(failure.code ?? '').trim()
    const text = code !== '' && !message.includes(code) ? message + '（code=' + code + '）' : message
    return { failed: true, tone: 'red', icon: '❌', label: '任务失败', text: text.slice(0, 160) }
  }
  // 未知结构：提取常见字段，兜底 JSON 序列化，绝不输出 [object Object]
  const message = String(reason.message ?? reason.text ?? '').trim()
  const text = (message !== '' ? message : safeJson(reason)).slice(0, 160)
  return { failed: true, tone: 'red', icon: '❌', label: '任务失败', text }
}

function safeJson(value) {
  try {
    const text = JSON.stringify(value)
    return text === undefined ? '无法序列化的失败信息' : text
  } catch {
    return '无法序列化的失败信息'
  }
}

function clipCardText(value, maxBytes) {
  const text = String(value ?? '').replace(/\r\n/g, '\n').trim()
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return text
  const suffix = '\n\n…（内容过长，已截断）'
  const budget = Math.max(0, maxBytes - Buffer.byteLength(suffix, 'utf8'))
  let bytes = 0
  let clipped = ''
  for (const char of text) {
    const size = Buffer.byteLength(char, 'utf8')
    if (bytes + size > budget) break
    clipped += char
    bytes += size
  }
  return clipped.trimEnd() + suffix
}

function splitCardText(value, maxChars = 3_500) {
  const chars = Array.from(String(value ?? ''))
  const chunks = []
  for (let index = 0; index < chars.length; index += maxChars) chunks.push(chars.slice(index, index + maxChars).join(''))
  return chunks.length > 0 ? chunks : ['']
}

function completionNoticeTitle(state) {
  if (state.label === '任务完成') return '【DSH完成通知】'
  if (state.label === '任务等待输入') return '【DSH等待输入】'
  if (state.label === '任务已暂停') return '【DSH暂停通知】'
  if (state.label === '任务已中止') return '【DSH中止通知】'
  if (state.label === '任务中断') return '【DSH中断通知】'
  return '【DSH失败通知】'
}

/** 把任务请求、模型最终回复与辅助状态格式化为飞书 Card 2.0。 */
export function buildCompletionCard({ subject, request, response, turn, durationMs, reason }) {
  // 飞书单卡整体数据上限 30 KB；按 UTF-8 字节保守预留 JSON 转义和结构开销。
  const safeSubject = clipCardText(String(subject ?? '').replace(/\s+/g, ' '), 600)
  const safeRequest = clipCardText(request, 2_000) || safeSubject || '未记录原始请求。'
  const safeResponse = clipCardText(response, 12_000)
  const safeTurn = Number.isFinite(turn) ? Math.max(1, Math.floor(turn)) : 1
  const ms = Number.isFinite(durationMs) ? Math.max(0, Math.floor(durationMs)) : 0
  const seconds = Math.round(ms / 1000)
  const durationText = seconds >= 60 ? Math.floor(seconds / 60) + ' 分 ' + (seconds % 60) + ' 秒' : seconds + ' 秒'
  const state = describeTurnEndReason(reason)
  const resultText = safeResponse || state.text || '任务已结束，但未捕获到模型最终回复。'
  const reasonText = safeResponse !== '' && state.text !== ''
    ? (state.failed ? '**失败原因**\n' : '**说明**\n') + state.text
    : ''
  const resultElements = splitCardText(resultText).map((part, index) => ({
    tag: 'div',
    text: { tag: 'lark_md', content: (index === 0 ? '**结果**\n' : '') + part },
  }))
  return {
    schema: '2.0',
    header: {
      template: state.tone,
      title: { tag: 'plain_text', content: completionNoticeTitle(state) },
    },
    body: {
      elements: [
        { tag: 'div', text: { tag: 'lark_md', content: '**请求**\n' + safeRequest } },
        ...resultElements,
        ...(reasonText !== '' ? [{ tag: 'div', text: { tag: 'lark_md', content: reasonText } }] : []),
        { tag: 'hr' },
        { tag: 'div', text: { tag: 'plain_text', content: 'DSH · 共 ' + safeTurn + ' 轮 · 耗时 ' + durationText } },
      ],
    },
  }
}

/** 通过已连接的飞书 client 发送一张 interactive 卡片；返回飞书 message_id。 */
export async function sendCard(client, chatId, card, { receiveIdType } = {}) {
  const chatIdStr = String(chatId ?? '').trim()
  if (chatIdStr === '') throw new Error('chat id is empty')
  const idType = receiveIdType ?? (chatIdStr.startsWith('oc_') ? 'chat_id' : chatIdStr.startsWith('on_') ? 'union_id' : 'open_id')
  const response = await client.im.v1.message.create({
    params: { receive_id_type: idType },
    data: { receive_id: chatIdStr, msg_type: 'interactive', content: JSON.stringify(card) },
  })
  if (response?.code !== undefined && response.code !== 0) throw new Error('feishu sendCard failed: ' + (response?.msg ?? response?.code))
  return String(response?.data?.message_id ?? '')
}

export async function sendFile(client, chatId, filePath, { replyTo = '', receiveIdType } = {}) {
  const fileKey = await uploadFile(client, filePath)
  const idType = receiveIdType ?? (String(chatId).startsWith('oc_') ? 'chat_id' : String(chatId).startsWith('on_') ? 'union_id' : 'open_id')
  return await deliverMessage(client, chatId, idType, {
    msg_type: 'file',
    content: JSON.stringify({ file_key: fileKey }),
  }, replyTo)
}
