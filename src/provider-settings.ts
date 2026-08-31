/** llm-pi-ai provider 设置合并的共享工具（智谱 / MiniMax / 火山方舟通用）。 */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 判断两个纯 JSON 值是否深度相等；用于 provider 无变化时跳过设置写入。 */
export function deepEqualJson(left: unknown, right: unknown): boolean {
  if (left === right) return true
  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) return false
    return left.every((item, index) => deepEqualJson(item, right[index]))
  }
  if (isPlainObject(left) && isPlainObject(right)) {
    const leftKeys = Object.keys(left)
    const rightKeys = Object.keys(right)
    if (leftKeys.length !== rightKeys.length) return false
    return leftKeys.every((key) => Object.hasOwn(right, key) && deepEqualJson(left[key], right[key]))
  }
  return false
}
