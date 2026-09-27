// 飞书会话身份：决定 stableSessionIdOf 的哈希输入，进而决定"复用同一会话还是新开一个"。
// 抽成独立模块的原因：index.mjs 顶部依赖 @deepseek-ai/dsh-agent（宿主运行时），
// 测试直接 import 会拉起重依赖；这里保持零依赖纯函数。

/**
 * 计算会话身份字符串。identity 一变，stableSessionIdOf 的哈希就变，飞书聊天就会
 * 落到一个全新会话、上下文全断。
 *
 * @param {{ provider?: unknown, model?: unknown, reasoningEffort?: unknown }} selection 解析后的模型选择
 * @param {unknown} agentPreset 预设名
 * @param {unknown} cwd 工作目录
 * @param {boolean} followDefault 是否跟随 DSH 默认模型（用户未在飞书侧显式配置模型）
 * @returns {string} JSON 身份串
 */
export function selectionIdentity(selection, agentPreset, cwd, followDefault = false) {
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
