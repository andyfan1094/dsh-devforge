/**
 * 记忆写入受理闸门（0.43.0 P1-4 / P1-7，契约移植自灵枢 dsh-memory 的写入闸门）。
 *
 * 设计取舍（重要）：灵枢要求六要素齐全才 `committed:true`，但本机存量 4864 条记忆
 * **零条**满足该标准——照抄会把现有写入路径整体挡死。因此这里只做「够不够成一条记忆」
 * 的最小判定，且**只作用于 memory_manage 工具写入**；自动沉淀（sediment）与做梦整理
 * 不经此闸门，避免影响生产既有的沉淀量。
 *
 * 拒绝必须可修正：`missing` 里写清缺什么、按什么格式补，调用方照着补就能通过，
 * 而不是只回一句失败。
 */

/** 闸门输入：只关心判定所需的最小字段。 */
export interface MemoryAdmissionInput {
  /** 待写入的记忆正文。 */
  content: string
}

/** 闸门结论。 */
export interface MemoryAdmissionResult {
  /** true=够格写入；false=拒绝（此时 missing 必非空）。 */
  admitted: boolean
  /** 缺失/不合格项清单：写清缺什么、怎么补。 */
  missing: string[]
  /** 一句话结论（人类可读，可直接回给调用方）。 */
  reason: string
}

/**
 * 有效内容下限。
 * 只按「有效字符」计数（去掉空白、标点、符号），所以「好的」「嗯嗯」这类口头语会被挡下，
 * 而「重启生产」这类短但确凿的事实能通过——闸门只拦没有信息量的内容，不拦短事实。
 */
const MIN_CONTENT_CHARS = 4

/** 判定一条内容是否够格写入长期记忆。 */
export function checkMemoryAdmission(input: MemoryAdmissionInput): MemoryAdmissionResult {
  const content = input.content.trim()
  if (content === '') {
    return { admitted: false, missing: ['content：需要写清要记住的具体事实，不能为空'], reason: '记忆内容为空' }
  }
  // 去除空白、标点、符号后计数：全角标点与 emoji 都不该算作内容。
  const effective = content.replace(/[\s\p{P}\p{S}]/gu, '')
  if (effective.length < MIN_CONTENT_CHARS) {
    return {
      admitted: false,
      missing: ['content：当前只有 ' + effective.length + ' 个有效字符（至少 ' + MIN_CONTENT_CHARS + ' 个），请写成完整事实，例如「构建命令是 pnpm build」'],
      reason: '记忆内容过短，不足以承载可复用事实',
    }
  }
  return { admitted: true, missing: [], reason: '受理' }
}
