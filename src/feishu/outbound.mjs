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

export async function sendFile(client, chatId, filePath, { replyTo = '', receiveIdType } = {}) {
  const fileKey = await uploadFile(client, filePath)
  const idType = receiveIdType ?? (String(chatId).startsWith('oc_') ? 'chat_id' : String(chatId).startsWith('on_') ? 'union_id' : 'open_id')
  return await deliverMessage(client, chatId, idType, {
    msg_type: 'file',
    content: JSON.stringify({ file_key: fileKey }),
  }, replyTo)
}
