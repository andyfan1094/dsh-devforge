/**
 * 记忆提炼/复盘生成的截断扩容策略。
 *
 * 宿主对「被 token 上限截断」的响应形态是**正常返回 + finish.kind='max-tokens'**，
 * 不抛错（0.29.8 生产实况：思考型模型把预算吃在思考上，正文 JSON 写了一半，
 * 旧写法在成功返回路径直接 return，半截 JSON 交给解析器只会换来「无法解析」）。
 * 所以成功返回也必须核对结束原因，截断就换下一档预算重试。
 */
export async function generateReflectionWithTokenSteps(
  generate: (input: { system: string; user: string; maxTokens: number; onFinish?: (reason: string) => void }) => Promise<string>,
  input: { system: string; user: string },
  baseTokens: number,
  steps: readonly number[],
): Promise<string> {
  let lastError: unknown
  for (const step of steps) {
    const maxTokens = baseTokens * step
    let finishReason = ''
    let text = ''
    try {
      text = await generate({ ...input, maxTokens, onFinish: (reason) => { finishReason = reason } })
    } catch (error) {
      lastError = error
      // 抛错路径：只有「被 token 上限截断」才值得扩容重试；真实调用故障直接上抛，避免多倍空跑。
      if (finishReason !== '' && finishReason !== 'max-tokens' && finishReason !== 'length') throw error
      continue
    }
    // 成功返回路径：截断不抛错，必须核对结束原因——半截 JSON 不能交给解析器。
    if (finishReason !== 'max-tokens' && finishReason !== 'length') return text
    lastError = new Error('输出被 maxTokens 截断（预算 ' + maxTokens + '）')
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}
