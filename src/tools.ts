/**
 * Agent 工具 —— 面板能力的 Agent 侧入口，同一引擎两副面孔。
 * 模式（dsh-winrm 实证）：execute 返回结构化值，output.render 把值渲染成
 * 文本；schema 声明输出形态供协议层校验（对象必须带 additionalProperties）。
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ForgeEngine } from './forge.ts'
import type { ForgeJob, StandardSummary } from './protocol.ts'
import type { DshWebRestartManager } from './restart.ts'
import type { StandardsStore } from './standards.ts'

/** 纯文本输出块。 */
function text(value: string): Array<{ type: 'text'; text: string }> {
  return [{ type: 'text', text: value }]
}

/** 任务表渲染（工具输出与面板同源）。 */
function renderJobs(jobs: ForgeJob[]): string {
  if (jobs.length === 0) return '（暂无生成任务）'
  return ['id | 名称 | 模板 | 状态 | 目标目录 | 最近消息 | 会话',
    '--- | --- | --- | --- | --- | --- | ---',
    ...jobs.map((j) => [j.id, j.name, j.templateId, j.status, j.targetDir, j.lastMessage ?? '-', j.sessionId ?? '-'].join(' | ')),
  ].join('\n')
}

/** ForgeJob 的 schema 片段（两处复用）。 */
const jobItemSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    name: { type: 'string', required: true },
    templateId: { type: 'string', required: true },
    targetDir: { type: 'string', required: true },
    standardIds: { type: 'array', items: { type: 'string' }, required: true },
    requirements: { type: 'string', required: true },
    status: { type: 'string', enum: ['queued', 'running', 'succeeded', 'failed', 'cancelled'], required: true },
    createdAt: { type: 'integer', required: true },
    updatedAt: { type: 'integer', required: true },
    sessionId: { type: 'string' },
    lastMessage: { type: 'string' },
  },
} as const

/** 工具输出值类型（与 schema 一一对应）。 */
interface JobsToolOutput {
  ok: boolean
  jobs?: ForgeJob[]
  message?: string
}

/** 任务清单 + 新建 + 取消（单一入口工具，action 分派）。 */
export function devforgeJobsTool(engine: ForgeEngine) {
  return defineTool({
    name: 'devforge_jobs',
    description: 'List/create/cancel spec-driven service forge jobs. One-click subagent creation per mounted standards. ' +
      'Triggers: 一键生成服务, 创建服务, 生成任务, forge job, service generator.',
    parameters: {
      action: { type: 'string', enum: ['list', 'create', 'cancel'], description: 'list=列任务；create=新建；cancel=取消。默认 list。' },
      name: { type: 'string', description: 'create：任务名。' },
      templateId: { type: 'string', description: 'create：模板 id（web-service / frontend-app）。' },
      targetDir: { type: 'string', description: 'create：目标绝对路径（服务落地目录）。' },
      standardIds: { type: 'string', description: 'create：逗号分隔规范 id（缺省用模板默认，如 v1/common.zh,v1/api.zh）。' },
      requirements: { type: 'string', description: 'create：需求描述。' },
      id: { type: 'string', description: 'cancel：任务 id。' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          jobs: { type: 'array', items: jobItemSchema },
          message: { type: 'string' },
        },
      },
      render: (_args, value: JobsToolOutput) => text(value.message ?? renderJobs(value.jobs ?? [])),
    },
    async execute(args): Promise<JobsToolOutput> {
      const action = args.action ?? 'list'
      if (action === 'list') return { ok: true, jobs: engine.listJobs() }
      if (action === 'cancel') {
        const job = engine.cancelJob(args.id ?? '')
        return job
          ? { ok: true, jobs: [job], message: '已取消：' + job.id + '（' + job.status + '）' }
          : { ok: false, message: '任务不存在：' + (args.id ?? '') }
      }
      // create：必填校验后转引擎
      if (!args.templateId || !args.targetDir) {
        return { ok: false, message: 'create 需要 templateId 与 targetDir；模板清单见 devforge_standards 工具。' }
      }
      try {
        const job = await engine.createJob({
          name: args.name ?? args.templateId,
          templateId: args.templateId,
          targetDir: args.targetDir,
          standardIds: args.standardIds ? args.standardIds.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
          requirements: args.requirements ?? '',
        })
        return {
          ok: true,
          jobs: [job],
          message: '已创建生成任务 ' + job.id + '（' + job.name + ' → ' + job.targetDir + '）\n子代理正按规范开工，进度可在 devforge 面板查看。',
        }
      } catch (error) {
        return { ok: false, message: '创建失败：' + (error instanceof Error ? error.message : String(error)) }
      }
    },
  })
}

/** 规范工具输出值类型。 */
interface StandardsToolOutput {
  standards?: StandardSummary[]
  content?: string
}

/** 规范库工具：列规范 + 读正文（agent 可自查规范全文）。 */
export function devforgeStandardsTool(standards: StandardsStore) {
  return defineTool({
    name: 'devforge_standards',
    description: 'List bundled coding standards or read one full standard (markdown). ' +
      'Triggers: 开发规范, 规范库, standards, coding standard.',
    parameters: {
      id: { type: 'string', description: '规范 id（如 v1/common）；缺省列清单。' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          standards: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                title: { type: 'string', required: true },
                tags: { type: 'array', items: { type: 'string' }, required: true },
                updatedAt: { type: 'number', required: true },
              },
            },
          },
          content: { type: 'string' },
        },
      },
      render: (_args, value: StandardsToolOutput) => {
        if (value.content !== undefined) return text(value.content !== '' ? value.content : '规范不存在')
        const items = value.standards ?? []
        if (items.length === 0) return text('（规范库为空）')
        return text(['id | 标题 | 标签', '--- | --- | ---',
          ...items.map((s) => [s.id, s.title, s.tags.join(',') || '-'].join(' | '))].join('\n'))
      },
    },
    async execute(args): Promise<StandardsToolOutput> {
      // 单一返回形态：两个可选键按需填充，避免联合类型破坏推断
      const result: StandardsToolOutput = {}
      if (!args.id) {
        result.standards = standards.list()
      } else {
        result.content = standards.get(args.id)?.content ?? ''
      }
      return result
    },
  })
}

/** 本机 DSH Web 重启工具输出。 */
interface RestartToolOutput {
  scheduled: boolean
  message: string
}

/**
 * 安排本机 DSH Web 重启。
 *
 * 此工具会短暂中断当前 GUI，只能在用户明确要求重启时调用；不会接受命令参数，
 * 不会执行远程重启，也不会推送或修改项目代码。
 */
export function devforgeRestartTool(restartManager: DshWebRestartManager) {
  return defineTool({
    name: 'devforge_restart',
    description: 'Schedule a local DSH Web restart. Use only when the user explicitly asks to restart DSH; the GUI disconnects briefly and returns automatically.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          scheduled: { type: 'boolean', required: true },
          message: { type: 'string', required: true },
        },
      },
      render: (_args, value: RestartToolOutput) => text(value.message),
    },
    async execute(): Promise<RestartToolOutput> {
      return restartManager.requestRestart()
    },
  })
}
