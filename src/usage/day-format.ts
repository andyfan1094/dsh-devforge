/** 本地日期工具（纯函数，零 node 依赖）。
 * 单独成文件的原因：宿主侧 tokens.ts 依赖 node:zlib/node:fs，
 * 而面板客户端 bundle 只允许浏览器安全模块——共享的日期格式化必须与它们解耦。 */

/** 本地时区日期键（YYYY-MM-DD）。 */
export function formatLocalDay(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return year + '-' + month + '-' + day
}
