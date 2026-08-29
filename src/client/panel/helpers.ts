/** 侧边栏入口等非 React 表面的轻量本地化辅助。 */
import { en, zh, type DevforgeKey } from '../locales.ts'

/** 按当前文档语言取字典；与 SSH 的 tt 契约一致。 */
function dictionary(): Record<DevforgeKey, string> {
  const lang = typeof document !== 'undefined' ? document.documentElement.lang : 'zh'
  return lang.toLowerCase().startsWith('en') ? en : zh
}

/** 读取一个 dsh-devforge 本地化键。 */
export function tt(key: DevforgeKey): string {
  return dictionary()[key]
}
