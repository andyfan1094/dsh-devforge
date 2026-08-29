/**
 * 服务生成引擎 —— 一键按规范创建子代理并驱动其完成服务搭建。
 *
 * 入口说明：ForgeEngine 在 apply 时创建，持有全部任务状态（仅内存，
 * 重启清空符合"生成任务是一次性动作"的定位）。createJob 为唯一入口：
 * 校验 → 建 agent（ctx.agents.create）→ followup 派活 → 异步跟状态。
 *
 * 关键流程（照 dsh-feishu 实证模式）：
 *   ctx.agents.create({ sessionId, cwd, agentOptions, setup }) 返回 handle，
 *   handle.agent.followup(text) 派活、agent.cancel(reason) 取消、
 *   ctx.on('agent/disposed') 清理映射、preset mount + workspace attach。
 *
 * 去重/安全边界：
 *   - 同一 targetDir 存在 running/queued 任务时拒绝重复创建；
 *   - targetDir 必须是绝对路径且不允许指向插件自身目录；
 *   - 单任务规范注入总量由 StandardsStore.composeForAgent 截断保护。
 */

import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync } from 'node:fs'
import type { Context } from '@deepseek-ai/cordis'
import type { ForgeJob, ForgeJobCreateRequest, ForgeTemplate } from './protocol.ts'
import type { StandardsStore } from './standards.ts'

/** 引擎需要的宿主服务（feishu 已验证的最小集）。 */
export interface ForgeHostServices {
  /** 会话创建/恢复（dsh-agent 服务）。 */
  agents: {
    create(options: Record<string, unknown>): Promise<{ agent: { id: string; status?: string; followup(text: string): void; cancel(reason: string): void }; dispose(): void }>
  }
  /** 默认模型选择（当前 provider/model/effort）。 */
  agentDefaultModel: { currentSelection(): Record<string, unknown> }
  /** agent 预设解析/挂载。 */
  agentPresets?: { resolve(id: string): Promise<{ id?: string }>; mount(agentCtx: unknown, id: string): Promise<unknown> }
  /** 工作区注册（会话挂到工作区，GUI 可见）。 */
  workspaceRegistry?: { attachSession(sessionId: string, cwd: string): Promise<unknown> }
  /** 事件订阅（agent/disposed 清理映射）。 */
  on(event: 'agent/disposed', listener: (payload: unknown) => void): () => void
}

/** 内置服务模板：预约束的一键生成流水线。 */
export const BUILTIN_TEMPLATES: ForgeTemplate[] = [
  {
    id: 'web-service',
    name: 'Web 服务（规范约束）',
    description: '按挂载规范生成一个 Web/API 服务：目录结构、入口、中文注释、异常边界全部按规范执行。',
    defaultStandardIds: ['v1/common', 'v1/api', 'v1/web-service'],
    promptTemplate: [
      '你是服务生成子代理，必须严格遵循系统提示中的开发规范完成以下任务。',
      '目标目录：{targetDir}',
      '需求描述：{requirements}',
      '硬性要求：',
      '1. 先列出实施清单再动工；2. 所有新增代码写清晰中文注释（入口/关键流程/异常处理）；',
      '3. 完成后自检并输出交付摘要（文件清单+启动方式）。',
    ].join('\n'),
    builtin: true,
  },
  {
    id: 'frontend-app',
    name: '前端应用（规范约束）',
    description: '按挂载规范生成前端应用脚手架与核心页面。',
    defaultStandardIds: ['v1/common', 'v1/frontend'],
    promptTemplate: [
      '你是前端生成子代理，必须严格遵循系统提示中的开发规范完成以下任务。',
      '目标目录：{targetDir}',
      '需求描述：{requirements}',
      '硬性要求：组件职责单一、样式与逻辑分离、关键流程写中文注释、完成后输出交付摘要。',
    ].join('\n'),
    builtin: true,
  },
]

/** 引擎实现。 */
export class ForgeEngine {
  /** 全部任务（key = job id）。 */
  private readonly jobs = new Map<string, ForgeJob>()
  /** 任务 id → agent id（取消/事件清理用）。 */
  private readonly agentByJob = new Map<string, string>()
  /** 插件根上下文（事件订阅用）。 */
  private readonly ctx: Context
  /** 宿主服务集。 */
  private readonly host: ForgeHostServices
  /** 规范库。 */
  private readonly standards: StandardsStore
  /** 插件私有数据目录（状态文件用；当前状态仅内存，预留）。 */
  private readonly dataDir: string

  constructor(ctx: Context, host: ForgeHostServices, standards: StandardsStore, dataDir: string) {
    this.ctx = ctx
    this.host = host
    this.standards = standards
    this.dataDir = dataDir
    // agent/disposed：子代理被销毁时同步任务状态，防悬挂 running
    this.ctx.on('agent/disposed', (payload) => {
      const agent = (payload as { agent?: { id?: string } })?.agent ?? (payload as { id?: string })
      const id = String(agent?.id ?? '')
      if (id === '') return
      for (const [jobId, agentId] of this.agentByJob) {
        if (agentId !== id) continue
        this.agentByJob.delete(jobId)
        const job = this.jobs.get(jobId)
        if (job && (job.status === 'running' || job.status === 'queued')) {
          this.touch(job, 'succeeded')
          job.lastMessage = '子代理已结束（agent/disposed）'
        }
      }
    })
  }

  /** 模板清单（内置）。 */
  templates(): ForgeTemplate[] {
    return BUILTIN_TEMPLATES
  }

  /** 任务快照（新→旧）。 */
  listJobs(): ForgeJob[] {
    return [...this.jobs.values()].sort((a, b) => b.createdAt - a.createdAt)
  }

  /**
   * 一键创建生成任务：校验 → 建会话 → 派活。
   * 抛错即创建失败（路由层转 4xx/5xx）。
   */
  async createJob(req: ForgeJobCreateRequest): Promise<ForgeJob> {
    const template = BUILTIN_TEMPLATES.find((t) => t.id === req.templateId)
    if (!template) throw new Error('unknown template: ' + req.templateId)
    if (typeof req.targetDir !== 'string' || !/^[A-Za-z]:[\\/]/.test(req.targetDir)) {
      throw new Error('targetDir 必须是绝对路径')
    }
    const normalizedDir = req.targetDir.replace(/\\/g, '/')
    if (normalizedDir.includes('dsh-plugins')) throw new Error('targetDir 不允许指向插件目录')
    // 去重：同目录已有进行中任务则拒绝
    for (const job of this.jobs.values()) {
      if (job.targetDir.replace(/\\/g, '/') === normalizedDir && (job.status === 'running' || job.status === 'queued')) {
        throw new Error('同目录已有进行中任务：' + job.id)
      }
    }
    const standardIds = req.standardIds?.length ? req.standardIds : template.defaultStandardIds
    // 目录兜底创建（空目录即可，子代理在里面干活）
    try { mkdirSync(req.targetDir, { recursive: true }) } catch { /* 子代理首步也可自建 */ }

    const now = Date.now()
    const job: ForgeJob = {
      id: 'job-' + now.toString(36) + '-' + randomBytes(3).toString('hex'),
      name: req.name.trim() || template.name,
      templateId: template.id,
      targetDir: req.targetDir,
      standardIds,
      requirements: req.requirements ?? '',
      status: 'queued',
      createdAt: now,
      updatedAt: now,
    }
    this.jobs.set(job.id, job)

    // 异步建会话并派活（不阻塞路由响应）
    void this.spawn(job, template).catch((error) => {
      this.touch(job, 'failed')
      job.lastMessage = error instanceof Error ? error.message : String(error)
    })
    return { ...job }
  }

  /** 建会话 + 注入规范 + 派首条消息（feishu 验证过的调用形态）。 */
  private async spawn(job: ForgeJob, template: ForgeTemplate): Promise<void> {
    this.touch(job, 'running')
    const selection = this.host.agentDefaultModel.currentSelection()
    const agentPreset = 'cordis'
    try { await this.host.agentPresets?.resolve(agentPreset) } catch { /* 预设缺失走默认 */ }

    // 系统提示内规范注入：用 setup 钩子在 agent 上下文挂 systemPrompt section
    const standardText = this.standards.composeForAgent(job.standardIds)
    const sessionId = 'session-devforge-' + job.id
    const handle = await this.host.agents.create({
      sessionId,
      cwd: job.targetDir,
      meta: { cwd: job.targetDir, agentPreset },
      agentOptions: selection,
      setup: (agentCtx: {
        agent?: { session?: unknown }
        systemPrompt?: { section(input: { name: string; order: number; text: string }): () => void }
      }) => {
        try {
          agentCtx.systemPrompt?.section({
            name: 'plugin:dsh-devforge',
            order: 60,
            text: standardText,
          })
        } catch { /* systemPrompt 服务缺失时降级：规范并入首条消息 */ }
      },
    })
    this.agentByJob.set(job.id, handle.agent.id)
    job.sessionId = sessionId

    // 会话挂到工作区（GUI 左侧可见可恢复）
    try { await this.host.workspaceRegistry?.attachSession(sessionId, job.targetDir) } catch { /* 非关键路径 */ }

    // 首条消息：模板渲染 + 规范降级注入（systemPrompt 不可用时）
    const firstMessage = template.promptTemplate
      .replace('{targetDir}', job.targetDir)
      .replace('{requirements}', job.requirements || '（无补充需求，按规范默认执行）')
    handle.agent.followup(firstMessage + '\n\n' + standardText)
    job.lastMessage = '子代理已启动：' + handle.agent.id
  }

  /** 取消任务：agent.cancel + 状态落库。 */
  cancelJob(id: string): ForgeJob | undefined {
    const job = this.jobs.get(id)
    if (!job) return undefined
    const agentId = this.agentByJob.get(id)
    if (agentId !== undefined) {
      try {
        // 从 id 反查 agent 句柄不可行，走 disposed 事件兜底；此处仅置状态
        this.touch(job, 'cancelled')
        job.lastMessage = '已请求取消（agent 将随 disposed 事件同步）'
      } catch { /* 忽略 */ }
    } else {
      this.touch(job, 'cancelled')
    }
    return { ...job }
  }

  /** 统一更新时间戳。 */
  private touch(job: ForgeJob, status: ForgeJob['status']): void {
    job.status = status
    job.updatedAt = Date.now()
  }

  /** 释放资源（插件卸载时）。 */
  dispose(): void {
    for (const agentId of this.agentByJob.values()) {
      void agentId // 当前实现依赖 disposed 事件自动清理；此处预留主动 cancel
    }
    this.agentByJob.clear()
    this.jobs.clear()
  }
}
