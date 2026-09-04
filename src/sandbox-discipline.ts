/**
 * 沙箱升级纪律注入 —— OpenAI 兼容模型工具调用加固（0.20.0）。
 *
 * 背景：dsh 宿主的 Bash 等工具 schema 恒定广播可选的 sandbox_permissions /
 * justification 字段（沙箱被拒后的一次性提权重试专用）。部分 OpenAI 兼容渠道
 * 的模型（尤其走中转的 GLM 系列）不守工具描述的约束，主动携带该字段，触发
 * "not strictly wider" / "invalid justification" 报错并死循环直至会话停止。
 *
 * 本模块不改动 dsh 源码，只通过 systemPrompt 常驻节把宿主沙箱的精确规则
 * （升级阶梯、成对校验、拒绝即终局）直接写进模型上下文，从源头消除误用。
 * 文本必须与 @deepseek-ai/dsh-sandbox 的实际校验语义保持一致：
 *   - WIDER_MODES：read-only → workspace-write → danger-full-access（单链）；
 *   - justification 与 sandbox_permissions 成对出现且必须非空句子；
 *   - 提权被用户拒绝对该命令是终局。
 */

/** 节名（宿主全局唯一；同名重复注册会抛错，卸旧后再挂新）。 */
export const SANDBOX_DISCIPLINE_SECTION_NAME = 'plugin:dsh-devforge:sandbox-discipline'

/** 节顺序：项目约束注入(80)之后、工具指引(100-199)之前。 */
export const SANDBOX_DISCIPLINE_SECTION_ORDER = 90

/** 向全部会话注入的沙箱升级纪律文本。 */
export const SANDBOX_DISCIPLINE_TEXT = [
  '【沙箱升级纪律（dsh-devforge 注入，必须遵守）】',
  'Bash 等工具的 sandbox_permissions 与 justification 是「沙箱拒绝后的一次性提权重试」专用参数。绝大多数调用永远不需要它们：',
  '1. 平时调用一律不带这两个字段；只有在上一条同名命令的结果里出现形如 [sandbox: ... denied ...] 的拒绝标记后，才允许在下一次重试中携带。',
  '2. 升级阶梯只有一条：read-only → workspace-write → danger-full-access。请求与当前模式同级或更窄必然报错；danger-full-access 已是最宽，永远无路可升。',
  '3. justification 必须与 sandbox_permissions 成对出现，是一句非空、具体的理由；空串或纯空白必然报错。',
  '4. 收到 "not strictly wider" 或 "invalid justification" 报错时，说明你带的参数本身不合法（这不是沙箱拒绝）：唯一正确动作是去掉这两个字段、原样重发同一条命令，然后停止重试，禁止反复携带同类参数重试。',
  '5. 不确定当前沙箱模式时，直接不带这两个字段执行；报错信息里 this call\'s current "X" mode 会告诉你当前模式。',
  '6. 提权请求被用户拒绝后，对该命令即为终局：解释情况即可，禁止绕路变通。',
].join('\n')
