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
  'standards.empty': '规范库为空（standards/ 目录无 md 文件）',
  'standards.view': '查看',
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
  'standards.empty': 'Standards library is empty',
  'standards.view': 'View',
  'common.refresh': 'Refresh',
  'common.close': 'Close',
}

/** 主字典（register 传入的形态）。 */
export const zh: Record<DevforgeKey, string> = zhDict
