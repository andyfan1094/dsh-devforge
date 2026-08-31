/**
 * CNB 备份 Agent 工具 —— cnb_backup_* 系列。
 * 让 Agent 能按辉哥指令立即备份/查看状态；恢复必须走面板（要人工确认），
 * 因此只暴露只读状态与立即备份两个写面。
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import { backupNow, readBackupPassword, readBackupSettings, readBackupState } from './backup.ts'

type ContentBlock = { type: 'text'; text: string }
function text(value: string): ContentBlock[] { return [{ type: 'text', text: value }] }
function render(value: unknown): string { return JSON.stringify(value, null, 2) }
function jsonValue(value: unknown): any { return JSON.parse(JSON.stringify(value)) }
const schema = { type: 'json' } as const

export function backupNowTool() {
  return defineTool({
    name: 'cnb_backup_now',
    description: '立即执行一次服务工厂 CNB 加密备份（store.db + 飞书配置，6 位密码加密）。需已启用备份（cnb_backup_status 查看）；内容无变化时跳过推送。',
    parameters: {
      force: { type: 'boolean', description: '跳过「内容无变化」检查强制推送（默认 false）。' },
    },
    output: { schema, render: (_args, value) => text(render(value)) },
    async execute(args) {
      const result = await backupNow({ force: args.force === true })
      return jsonValue(result)
    },
  })
}

export function backupStatusTool() {
  return defineTool({
    name: 'cnb_backup_status',
    description: '查看服务工厂 CNB 备份状态：是否启用、仓库、间隔、上次推送时间与结果、本机是否已设密码。不回显密码。',
    parameters: {},
    output: { schema, render: (_args, value) => text(render(value)) },
    async execute() {
      const settings = readBackupSettings()
      const state = readBackupState()
      return jsonValue({
        enabled: settings.enabled,
        repo: settings.repo,
        interval: settings.interval,
        accountAlias: settings.accountAlias,
        passwordSet: readBackupPassword() !== undefined,
        lastPushAt: state.lastPushAt,
        lastSize: state.lastSize,
        lastError: state.lastError,
        consecutiveFailures: state.consecutiveFailures,
      })
    },
  })
}
