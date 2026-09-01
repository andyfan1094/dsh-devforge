/** OpenAI 中转站全局 generate_image 工具：生图、工作区落盘与聊天附件渲染。 */
import { mkdir, writeFile } from 'node:fs/promises'
import { basename, dirname, extname } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-tools'
import { type ImageMediaType } from './api-client.ts'
import { OpenAiGatewayService } from './service.ts'

const GENERATE_SIZES = ['auto', '256x256', '512x512', '1024x1024', '1024x1536', '1536x1024', '1024x1792', '1792x1024'] as const
const GENERATE_QUALITIES = ['auto', 'low', 'medium', 'high', 'standard', 'hd'] as const
const DEFAULT_MAX_IMAGE_BYTES = 20 * 1024 * 1024

interface ImageFsTarget { displayPath: string }
interface ImageFs {
  resolve(path: string, opts?: { cwd?: string; signal?: AbortSignal }): Promise<ImageFsTarget>
  contains(parent: ImageFsTarget, child: ImageFsTarget): boolean
  processPath(target: ImageFsTarget): string
}

/** 获取 DSH 文件系统服务；保持可选以便启动时不因环境差异崩溃。 */
function getFs(ctx: Context): ImageFs | undefined {
  return (ctx as Context & { get(name: 'fs'): ImageFs | undefined }).get('fs')
}

/** 按图片类型选择落盘扩展名。 */
function extensionFor(mediaType: ImageMediaType): string {
  if (mediaType === 'image/jpeg') return '.jpg'
  if (mediaType === 'image/webp') return '.webp'
  if (mediaType === 'image/gif') return '.gif'
  return '.png'
}

/** 默认文件名按秒生成，便于用户在工作区识别。 */
function defaultOutputName(mediaType: ImageMediaType): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '-').slice(0, 19)
  return 'generated-' + stamp + extensionFor(mediaType)
}

/** 把生成图片写进当前会话工作区，拒绝目录穿越。 */
async function writeGeneratedImage(
  ctx: Context,
  exec: { signal: AbortSignal; agent?: { session: { header: { cwd?: string } } } },
  requestedPath: string | undefined,
  data: Uint8Array,
  mediaType: ImageMediaType,
): Promise<string> {
  const fs = getFs(ctx)
  if (fs === undefined) throw new Error('DSH 文件系统服务未挂载，无法保存生成图片。')
  const cwd = exec.agent?.session.header.cwd
  if (cwd === undefined || cwd.trim() === '') throw new Error('generate_image 需要先选择工作区。')
  const rawPath = requestedPath !== undefined && requestedPath.trim() !== '' ? requestedPath.trim() : defaultOutputName(mediaType)
  const withExtension = extname(rawPath) === '' ? rawPath + extensionFor(mediaType) : rawPath
  const root = await fs.resolve('.', { cwd, signal: exec.signal })
  const target = await fs.resolve(withExtension, { cwd, signal: exec.signal })
  if (!fs.contains(root, target)) throw new Error('generate_image 只能写入当前工作区：' + target.displayPath)
  const absolutePath = fs.processPath(target)
  await mkdir(dirname(absolutePath), { recursive: true })
  await writeFile(absolutePath, data)
  return target.displayPath
}

/** 构造全局工具定义，单测可直接注入假服务。 */
export function makeGenerateImageTool(ctx: Context, service: OpenAiGatewayService) {
  return defineTool({
    name: 'generate_image',
    description: '通过天工造梦中配置的 OpenAI 兼容中转站生成图片，写入当前工作区，并在聊天记录中内联展示。',
    parameters: {
      prompt: { type: 'string', required: true, description: '图像生成提示词。' },
      file_path: { type: 'string', description: '工作区内输出路径；留空自动生成文件名。' },
      size: { type: 'string', enum: [...GENERATE_SIZES], description: '图片尺寸；中转站或模型不支持时可能忽略。' },
      quality: { type: 'string', enum: [...GENERATE_QUALITIES], description: '图片质量；中转站或模型不支持时可能忽略。' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          model: { type: 'string', required: true },
          mediaType: { type: 'string', required: true },
          bytes: { type: 'integer', required: true },
          revisedPrompt: { type: 'string' },
          attachment: {
            type: 'object',
            additionalProperties: false,
            properties: {
              attachmentId: { type: 'string', required: true },
              mediaType: { type: 'string', required: true },
              bytes: { type: 'integer', required: true },
              width: { type: 'integer', required: true },
              height: { type: 'integer', required: true },
              name: { type: 'string' },
            },
          },
        },
      },
      render: (_args, value) => {
        const blocks: ContentBlock[] = []
        if (value.attachment !== undefined && typeof value.attachment === 'object' && value.attachment !== null) {
          blocks.push({ type: 'image', attachment: value.attachment as ImageAttachmentRef })
        }
        blocks.push({
          type: 'text',
          text: [
            '<path>' + value.path + '</path>',
            '<type>image</type>',
            '<content>',
            value.mediaType + ', ' + value.bytes + ' bytes, model ' + value.model,
            value.revisedPrompt !== undefined ? 'revised prompt: ' + value.revisedPrompt : '',
            '</content>',
          ].filter((line) => line !== '').join('\n'),
        })
        return blocks
      },
    },
    timeoutMs: 600_000,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const prompt = args.prompt.trim()
      if (prompt === '') throw new Error('prompt 不能为空。')
      const maxBytes = ctx.get('attachments')?.imageLimits.maxImageBytes ?? DEFAULT_MAX_IMAGE_BYTES
      const image = await service.generateImage({
        prompt,
        ...(args.size !== undefined ? { size: args.size } : {}),
        ...(args.quality !== undefined ? { quality: args.quality } : {}),
      }, exec.signal, maxBytes)
      const path = await writeGeneratedImage(ctx, exec, args.file_path, image.data, image.mediaType)
      let attachment: ImageAttachmentRef | undefined
      const attachmentStore = ctx.get('attachments')
      if (attachmentStore !== undefined) {
        try {
          attachment = await attachmentStore.saveImage({ data: image.data, mediaType: image.mediaType, name: basename(path) })
        } catch {
          // 附件保存失败不回滚工作区文件；工具仍返回可访问路径。
          attachment = undefined
        }
      }
      return {
        path,
        model: OPENAI_TOOL_PROVIDER + '/' + image.model,
        mediaType: image.mediaType,
        bytes: image.data.byteLength,
        ...(image.revisedPrompt !== undefined ? { revisedPrompt: image.revisedPrompt } : {}),
        ...(attachment !== undefined ? { attachment } : {}),
      }
    },
    presentCall(args) {
      return {
        card: 'generic',
        title: '生成图片' + (args.file_path !== undefined ? ' ' + args.file_path : ''),
        ...(args.file_path !== undefined ? { locations: [{ path: args.file_path }] } : {}),
      }
    },
    presentResult(_args, result) {
      const image = result.content.find((block) => block.type === 'image')
      if (image !== undefined) return { card: 'generic' as const, content: [image] }
      const text = result.content.find((block) => block.type === 'text')
      if (text !== undefined && text.type === 'text') {
        const path = text.text.match(/<path>(.*?)<\/path>/)?.[1]
        if (path !== undefined) return { card: 'generic' as const, content: [{ type: 'text', text: path }] }
      }
      return undefined
    },
  })
}

const OPENAI_TOOL_PROVIDER = 'openai-gateway'

/** 注册全局 generate_image 与提示节；关闭能力时返回空卸载器。 */
export function activateOpenAiGenerateImage(ctx: Context, config: { enabled: boolean }, service: OpenAiGatewayService): { dispose: () => void } {
  if (!config.enabled) return { dispose: () => undefined }
  const dispose = ctx.effect(() => {
    const disposePrompt = ctx.systemPrompt.section({
      name: 'tool:generate_image',
      order: 119,
      text: 'Use generate_image to create an image through the OpenAI-compatible gateway configured in 天工造梦. The tool saves the image inside the active workspace and returns an inline attachment when available.',
    })
    const disposeTool = ctx.tools.register(makeGenerateImageTool(ctx, service))
    return () => { disposeTool(); disposePrompt() }
  }, 'dsh-devforge: openai generate_image')
  return { dispose: () => dispose() }
}
