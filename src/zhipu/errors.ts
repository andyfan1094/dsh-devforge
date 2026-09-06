/** 智谱 Coding Plan 可直接呈现给面板的分类错误（独立模块，避免 key-pool 与 service 循环依赖）。 */

/** 内容不得包含请求头或 Key 明文。 */
export class ZhipuServiceError extends Error {
  readonly status: number

  constructor(message: string, status = 502) {
    super(message)
    this.name = 'ZhipuServiceError'
    this.status = status
  }
}
