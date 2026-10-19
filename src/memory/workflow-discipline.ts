/**
 * 记忆工作流纪律注入 —— 「先查记忆 → 再核事实 → 回写修正」闭环（0.41.16）。
 *
 * 背景（辉哥定）：记忆中枢已有检索注入（[记忆中枢自动注入] / [内置长期记忆]）
 * 与常驻钉选层（[常驻记忆]），但「怎么用记忆干活」这件事本身从未注入过——
 * 模型靠自觉：不查就答、拿过期记忆当现状、发现记忆有误也不回写，于是同一条
 * 事实每轮重新探索、旧结论反复复用。本模块不改动 dsh 源码，只通过
 * systemPrompt 常驻节把记忆工作流直接写进全部会话，与 sandbox-discipline
 * 同款（不依赖召回、每轮必达）。
 *
 * 文本与插件实际能力保持一致，不得承诺库里没有的能力：
 *   - 查：rag_search（知识库 + 内置长期记忆）、memory_manage(search/list/get)；
 *   - 核：devforge_db_query / ssh_exec / winrm_exec 等实时事实源；
 *   - 回写：memory_manage(save/update)，update 走真实覆盖、不是另存。
 */

/** 节名（宿主全局唯一；同名重复注册会抛错，卸旧后再挂新）。 */
export const MEMORY_WORKFLOW_SECTION_NAME = 'plugin:dsh-devforge:memory-workflow'

/** 节顺序：项目约束(80)之后、沙箱纪律/插件总览(90)之前——先看「怎么干活」，再看禁用项。 */
export const MEMORY_WORKFLOW_SECTION_ORDER = 85

/** 向全部会话注入的记忆工作流纪律文本。 */
export const MEMORY_WORKFLOW_TEXT = [
  '【记忆工作流（dsh-devforge 注入，必须遵守）】',
  '铁律：不懂的先查记忆 → 再用实时事实核验 → 发现记忆有误就更新记忆。',
  '1. 先查记忆：遇到不熟悉的问题（项目约定、服务器地址、历史踩坑、上次怎么解决的），先 rag_search 或 memory_manage(search) 查，不要从零试探。',
  '2. 再核事实：记忆可能过期，涉及版本号、路径、端口、发布状态等可变事实，必须用实时工具核验（查库/查服务器/查文件），不得凭记忆直接断言。',
  '3. 回写修正：解决完成后只要发现记忆与实际不符，就用 memory_manage(save/update) 写回修正后的结论——这是义务，不是可选项；需要每轮都记住的规则设 pinned=true。',
  '4. 只写修正后的新结论：与既有记忆冲突时替换它，不要堆积旧说法。',
  // 0.55.0：注入行开始带短 ID，但模型不会自动意识到那串东西能当 id 用。
  // 不写明这条，短 ID 就只是装饰，纠正记忆时又退回复述正文去碰运气。
  '5. 引用具体记忆：注入的记忆行形如「[日期 · 来源 · 类别 · #a1b2c3d4] 正文」，其中 #后面的 8 位短 ID 就是 memory_manage 的 id，可直接用于 get/update/feedback/delete；重名或报歧义时补更多位数即可。',
].join('\n')
