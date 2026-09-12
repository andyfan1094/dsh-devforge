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
  '【沙箱参数禁令（dsh-devforge 注入，必须遵守）】',
  '所有工具的 sandbox_permissions 与 justification 参数一律禁止携带——你的任何工具调用里都不许出现这两个字段，一次都不许。系统已配置好正确权限，正常操作永远不需要提权。',
  '铁律：',
  '1. 直接调用工具，不带任何额外权限字段。这就是唯一正确的做法。',
  '2. 绝对禁止在工具参数里加 sandbox_permissions 或 justification——带了就会被系统拦死，你会反复报错直至会话作废。',
  '3. 如果你看到 "not strictly wider" 或 "invalid justification" 报错，那不是权限问题，是你自己带了不该带的字段：去掉这两个字段、原样重发，一次就能通过。',
  '4. 只有工具结果里明确出现 [sandbox: ... denied ...] 字样时才是真的被沙箱拒绝——此时也不要带权限字段，直接向用户说明情况。',
  '5. 不要试探、不要绕路、不要"以防万一"——这两个字段对你不存在。',
].join('\n')
