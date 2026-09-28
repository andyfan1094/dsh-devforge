// 飞书会话身份：决定 stableSessionIdOf 的哈希输入，进而决定"复用同一会话还是新开一个"。
// 抽成独立模块的原因：index.mjs 顶部依赖 @deepseek-ai/dsh-agent（宿主运行时），
// 测试直接 import 会拉起重依赖；这里保持零依赖纯函数。

/**
 * 计算当前会话身份字符串。identity 一变，stableSessionIdOf 的哈希就变，飞书聊天就会
 * 落到一个全新会话、上下文全断。
 *
 * 0.41.7 定稿：**模型不再参与身份**。
 * 历史行为把 provider/model/reasoningEffort 算进哈希，导致「在飞书里换个模型 = 换会话」，
 * 上下文全断（辉哥 2026-09-28 实录）。会话身份只应由「这条飞书聊天 + 预设 + 工作目录」
 * 决定；换模型属于会话内部的状态切换，交给 createHandle 的 installModelSelection 注入，
 * resume 同一条会话即可，历史上下文照旧保留。
 *
 * @param {{ provider?: unknown, model?: unknown, reasoningEffort?: unknown }} _selection 解析后的模型选择（不再参与身份，仅为兼容调用方签名保留）
 * @param {unknown} agentPreset 预设名
 * @param {unknown} cwd 工作目录
 * @returns {string} JSON 身份串
 */
export function selectionIdentity(_selection, agentPreset, cwd) {
  return JSON.stringify({ agentPreset, cwd })
}

/**
 * 0.41.6 及以前的身份算法：把模型三件套算进哈希。
 *
 * 只用于**兼容迁移**：老会话是按这个身份建的，升级后先拿它算出的旧 ID 去 resume，
 * 命中就把历史上下文接过来（否则辉哥重启后会再丢一次上下文）。一旦继承完成，
 * 之后所有新消息都走模型无关的新身份。
 *
 * @param {{ provider?: unknown, model?: unknown, reasoningEffort?: unknown }} selection 解析后的模型选择
 * @param {unknown} agentPreset 预设名
 * @param {unknown} cwd 工作目录
 * @param {boolean} followDefault 是否跟随 DSH 默认模型（跟随时不把运行时强度算进身份）
 * @returns {string} JSON 身份串
 */
export function legacySelectionIdentity(selection, agentPreset, cwd, followDefault = false) {
  return JSON.stringify({
    provider: selection.provider,
    model: selection.model,
    // 跟随默认模型时，思考强度来自 agentDefaultModel.currentSelection() 的运行时取值：
    // 同一个模型在宿主重启前后可能给出不同的 reasoningEffort（甚至有时 undefined），
    // 一旦算进身份，重启就会换哈希 → 新开会话 → 谁都得重讲一遍背景
    // （辉哥 2026-09-27 实录：每次重启桌面版后飞书里都是新会话）。
    // 只有用户在飞书侧显式配置过的强度才参与身份，用户主动改强度时照旧换会话。
    reasoningEffort: followDefault ? '' : (selection.reasoningEffort ?? ''),
    agentPreset,
    cwd,
  })
}
