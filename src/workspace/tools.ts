/**
 * 工作区工具 —— devforge_workspace：产出公约的 Agent 侧入口。
 *
 * locate：按类别返回规范目录（不存在即创建），支持「项目优先」两级
 *   （project=项目名、sub=形态桶键），让模型不再猜路径乱放文件；
 * audit：既扫工作区根的散落文件，也对 outputs 内部做秩序体检
 *   （只建议不动手，移动必须用户确认）；
 * 工作区根：args.workspace 显式指定优先；缺省从执行上下文的 agent 会话 cwd
 * 防御式解析（与约束注入同一套读取逻辑）。
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import {
  auditOutputsLayout,
  auditWorkspace,
  getConvention,
  resolveConventionTarget,
  type AuditSuggestion,
  type ConventionDir,
  type OutputsAudit,
} from './convention.ts'
import { resolveAgentCwd } from '../constraints.ts'
import { listProjects } from '../projects/store.ts'

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

/** 可用类别键清单（用于报错提示）。 */
function kindList(): string {
  return getConvention().dirs.map((dir) => dir.kind).join('/')
}

/** 渲染某类别的可用形态桶（locate 报错与提示用）。 */
function subdirList(dir: ConventionDir): string {
  const subs = dir.subdirs ?? []
  if (subs.length === 0) return ''
  return subs.map((sub) => sub.key + '(' + sub.dirname + ')').join('、')
}

/** 渲染工作区根散落文件建议（紧凑一行一文件）。 */
function renderRootSuggestions(root: string, suggestions: AuditSuggestion[]): string[] {
  if (suggestions.length === 0) return ['工作区根：没有发现可归类的散落文件。']
  return [
    '工作区根：发现 ' + suggestions.length + ' 个散落文件，建议归类（仅建议，不自动移动）：',
    ...suggestions.map((item) => '- ' + item.name + ' → ' + (item.targetPath ?? item.suggestedKind)),
  ]
}

/** 渲染 outputs 内部秩序体检（问题清单 + 统计）。 */
function renderOutputsAudit(audit: OutputsAudit): string[] {
  if (!audit.exists) return ['outputs 内部：目录不存在（尚未创建产出目录）。']
  if (audit.totalMisplaced === 0) {
    return ['outputs 内部：' + audit.topLevelCount + ' 个一级条目全部合规（已就位文件 ' + audit.placedCount + ' 个）。']
  }
  const lines = [
    'outputs 内部：' + audit.topLevelCount + ' 个一级条目，检出 ' + audit.totalMisplaced + ' 处未按「项目/形态桶」归位'
    + '（直接堆在一级的文件 ' + audit.looseFileCount + ' 个，已就位 ' + audit.placedCount + ' 个）：',
    ...audit.entries.map((item) => '- ' + item.relPath + ' → ' + item.suggestedRelPath + '（' + item.reason + '）'),
  ]
  if (audit.totalMisplaced > audit.entries.length) {
    lines.push('（仅列出前 ' + audit.entries.length + ' 条，共 ' + audit.totalMisplaced + ' 条）')
  }
  return lines
}

/** devforge_workspace 工具定义。 */
export function devforgeWorkspaceTool() {
  return defineTool({
    name: 'devforge_workspace',
    description: 'Locate convention directories (auto-create) for agent outputs, or audit file order in the workspace root and inside outputs. '
      + 'Triggers: 产出目录, 规范路径, 归类建议, 文件秩序体检, devforge_workspace, locate directory.',
    parameters: {
      action: { type: 'string', enum: ['locate', 'audit'], description: 'locate=取类别规范目录（自动创建）；audit=扫描根目录散落文件并体检 outputs 内部秩序。' },
      kind: { type: 'string', description: 'locate：类别键（projects/tmp/scripts/downloads/backups/outputs/notes，以面板配置为准）。' },
      project: { type: 'string', description: 'locate：项目名（项目优先布局的一级），如 天工造梦/波斯通；省略时用 _通用。' },
      sub: { type: 'string', description: 'locate：形态桶键（outputs 为 packages/screenshots/mockups/docs/data，也可直接写桶目录名）。' },
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
          return { ok: false, message: 'locate 需要 kind 参数；可用类别：' + kindList() + '。' }
        }
        const kind = args.kind.trim()
        const dir = getConvention().dirs.find((item) => item.kind === kind)
        const placement = {
          ...(typeof args.project === 'string' && args.project.trim() !== '' ? { project: args.project.trim() } : {}),
          ...(typeof args.sub === 'string' && args.sub.trim() !== '' ? { sub: args.sub.trim() } : {}),
        }
        const target = resolveConventionTarget(root, kind, placement)
        if (target === undefined) {
          if (dir === undefined) return { ok: false, message: '未登记类别：' + kind + '；可用类别：' + kindList() + '。' }
          const subs = subdirList(dir)
          if (placement.sub !== undefined && subs !== '') {
            return { ok: false, message: '未登记形态桶：' + placement.sub + '；' + dir.dirname + '/ 可用形态桶：' + subs + '。' }
          }
          if (placement.project !== undefined) {
            return { ok: false, message: '项目名不合法：' + placement.project + '；不能含路径分隔符/隐藏前缀/Windows 设备名，请用简短项目名。' }
          }
          return { ok: false, message: '无法解析落位：' + kind + '。' }
        }
        const layout = target.subdir === undefined
          ? ''
          : '（项目优先两级：' + target.dir.dirname + '/<项目>/<形态桶>）'
        return {
          ok: true,
          message: '类别「' + kind + '」规范目录：' + target.path + '（不存在已自动创建）' + layout
            + (dir !== undefined && subdirList(dir) !== '' ? '；可用形态桶：' + subdirList(dir) + '。' : '。')
            + '请把该类文件放到此目录下。',
        }
      }
      // audit：根目录散落 + outputs 内部体检（全程只读，不创建、不移动）。
      let projectNames: string[] = []
      try {
        projectNames = listProjects().map((item) => item.name)
      } catch { /* 项目库不可用时退化为只做结构判定 */ }
      const lines = [
        ...renderRootSuggestions(root, auditWorkspace(root)),
        '',
        ...renderOutputsAudit(auditOutputsLayout(root, undefined, projectNames)),
        '',
        '需要移动时请先征得用户确认（本工具只建议，不动手）。',
      ]
      return { ok: true, message: lines.join('\n') }
    },
  })
}
