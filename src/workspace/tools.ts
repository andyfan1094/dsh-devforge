/**
 * 工作区工具 —— devforge_workspace：产出公约的 Agent 侧入口。
 *
 * locate：按类别返回规范目录（不存在即创建），让模型不再猜路径乱放文件；
 * audit：扫描工作区根的散落文件给归类建议（只建议不动手，移动必须用户确认）。
 * 工作区根：args.workspace 显式指定优先；缺省从执行上下文的 agent 会话 cwd
 * 防御式解析（与约束注入同一套读取逻辑）。
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import { auditWorkspace, getConvention, resolveConventionDir, type AuditSuggestion } from './convention.ts'
import { resolveAgentCwd } from '../constraints.ts'

/** 工具输出值类型（与 schema 一一对应）。 */
interface WorkspaceToolOutput {
  ok: boolean
  message: string
}

/** 从工具执行上下文防御式解析会话 cwd。 */
function cwdFromExec(exec: unknown): string | undefined {
  if (exec === null || typeof exec !== 'object') return undefined
  const agent = (exec as { agent?: unknown }).agent
  if (agent === null || typeof agent !== 'object') return undefined
  const session = (agent as { session?: unknown }).session
  return resolveAgentCwd(session)
}

/** 渲染 audit 建议（紧凑一行一文件）。 */
function renderSuggestions(root: string, suggestions: AuditSuggestion[]): string {
  if (suggestions.length === 0) return '工作区 ' + root + ' 根目录没有发现可归类的散落文件。'
  return [
    '工作区 ' + root + ' 根目录发现 ' + suggestions.length + ' 个散落文件，建议归类（仅建议，不自动移动）：',
    ...suggestions.map((item) => '- ' + item.name + ' → ' + item.suggestedKind + '/（' + (item.targetPath ?? '') + '）'),
    '需要移动时请先征得用户确认。',
  ].join('\n')
}

/** devforge_workspace 工具定义。 */
export function devforgeWorkspaceTool() {
  return defineTool({
    name: 'devforge_workspace',
    description: 'Locate convention directories (auto-create) for agent outputs, or audit scattered files in the workspace root. ' +
      'Triggers: 产出目录, 规范路径, 归类建议, devforge_workspace, locate directory.',
    parameters: {
      action: { type: 'string', enum: ['locate', 'audit'], description: 'locate=取类别规范目录（自动创建）；audit=扫描根目录散落文件给归类建议。' },
      kind: { type: 'string', description: 'locate：类别键（projects/tmp/scripts/downloads/backups/outputs/notes，以面板配置为准）。' },
      workspace: { type: 'string', description: '工作区根绝对路径；缺省用当前会话工作目录。' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          message: { type: 'string' },
        },
      },
      render: (_args, value: WorkspaceToolOutput) => [{ type: 'text', text: value.message }],
    },
    async execute(args, exec): Promise<WorkspaceToolOutput> {
      const root = (typeof args.workspace === 'string' && args.workspace.trim() !== '')
        ? args.workspace.trim()
        : cwdFromExec(exec)
      if (root === undefined || root === '') {
        return { ok: false, message: '无法确定工作区根：请传 workspace 参数（本机绝对路径）。' }
      }
      const action = args.action ?? 'locate'
      if (action === 'locate') {
        if (typeof args.kind !== 'string' || args.kind.trim() === '') {
          const kinds = getConvention().dirs.map((dir) => dir.kind).join('/')
          return { ok: false, message: 'locate 需要 kind 参数；可用类别：' + kinds + '。' }
        }
        const target = resolveConventionDir(root, args.kind.trim())
        if (target === undefined) {
          const kinds = getConvention().dirs.map((dir) => dir.kind).join('/')
          return { ok: false, message: '未登记类别：' + args.kind + '；可用类别：' + kinds + '。' }
        }
        return { ok: true, message: '类别「' + args.kind + '」规范目录：' + target + '（不存在已自动创建）。请把该类文件放到此目录下。' }
      }
      // audit
      const suggestions = auditWorkspace(root)
      return { ok: true, message: renderSuggestions(root, suggestions) }
    },
  })
}
