/**
 * 面板文案字典 —— zh 为主、en 兜底（dsh-winrm 同款 locale 契约）。
 * 结构：zhDict as const → DevforgeKey = keyof typeof zhDict；en 逐 key 对齐。
 */

/** 中文文案（主语言，as const 保证 key 字面量类型）。 */
export const zhDict = {
  'entry.label': '服务工厂',
  'entry.tooltip': 'dsh-devforge：规范库与一键服务生成',
  'panel.title': '服务工厂（dsh-devforge）',
  'tab.standards': '开发规范',
  'tab.jobs': '生成任务',
  'tab.new': '新建服务',
  'standards.empty': '规范库为空（standards/ 目录无 md 文件）',
  'standards.view': '查看',
  'jobs.empty': '暂无生成任务；切到"新建服务"一键开工',
  'jobs.cancel': '取消',
  'jobs.openSession': '打开会话',
  'jobs.status.queued': '排队中',
  'jobs.status.running': '进行中',
  'jobs.status.succeeded': '已完成',
  'jobs.status.failed': '失败',
  'jobs.status.cancelled': '已取消',
  'new.name': '任务名称',
  'new.template': '服务模板',
  'new.targetDir': '目标目录（绝对路径）',
  'new.requirements': '需求描述（可留空）',
  'new.standards': '挂载规范',
  'new.submit': '一键生成（创建子代理）',
  'new.submitting': '创建中…',
  'common.refresh': '刷新',
  'common.close': '关闭',
} as const

/** 字典 key 类型（漏译编译期报错）。 */
export type DevforgeKey = keyof typeof zhDict

/** 英文文案（兜底，key 必须与 zh 完全对齐）。 */
export const en: Record<DevforgeKey, string> = {
  'entry.label': 'DevForge',
  'entry.tooltip': 'dsh-devforge: standards & one-click service forge',
  'panel.title': 'DevForge (dsh-devforge)',
  'tab.standards': 'Standards',
  'tab.jobs': 'Jobs',
  'tab.new': 'New Service',
  'standards.empty': 'Standards library is empty',
  'standards.view': 'View',
  'jobs.empty': 'No forge jobs yet',
  'jobs.cancel': 'Cancel',
  'jobs.openSession': 'Open session',
  'jobs.status.queued': 'Queued',
  'jobs.status.running': 'Running',
  'jobs.status.succeeded': 'Succeeded',
  'jobs.status.failed': 'Failed',
  'jobs.status.cancelled': 'Cancelled',
  'new.name': 'Job name',
  'new.template': 'Template',
  'new.targetDir': 'Target directory (absolute path)',
  'new.requirements': 'Requirements (optional)',
  'new.standards': 'Standards to mount',
  'new.submit': 'Forge it (spawn subagent)',
  'new.submitting': 'Forging…',
  'common.refresh': 'Refresh',
  'common.close': 'Close',
}

/** 主字典（register 传入的形态）。 */
export const zh: Record<DevforgeKey, string> = zhDict
