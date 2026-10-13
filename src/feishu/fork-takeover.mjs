// 飞书会话占用接管：写句柄被长期占用时，只读旧会话历史，fork 出带完整上下文的后继会话。
//
// 背景（2026-09-29 辉哥实录 + 宿主源码核实）：
// 1. DSH 会话是单写者租约——电脑端 GUI 打开会话就持有写句柄（Windows 内核信号量锁，
//    宿主刻意不设过期："绝不过期抢夺活动写者"，防止恢复的追加撕裂日志）。实测占用
//    可持续数小时甚至隔夜，"排队等占用释放"这条路不成立。
// 2. 宿主支持 fork 式建会话：ctx.agents.create({ sessionId: 新号, seed, meta:
//    { parentSession, seedLength, cwd, agentPreset } })。seed 是父日志的完整
//    completed-turn 前缀（从 seq 0 连续、无未闭合 turn / 悬空 tool call），
//    宿主自己的 fork RPC（api-session-controller 的 fork()）就是这么实现的。
// 3. sessionPersistence.open(id, 'read') 是无所有权读句柄：写句柄被占用时照读不误。
//
// 因此占用 ≠ 死路：读旧历史（不需要写锁）→ 切到最后一个 turn/end → 以新号 fork
// 后继会话接管。消息不丢、历史不丢、GUI 侧毫无感知（它继续持有旧号，旧号留作历史）。
// 本模块保持零宿主运行时依赖：事件边界与参数组装都是纯函数，可直接单测。

/**
 * 在事件流里找最后一个完成轮次边界（最后一个 turn/end 的下一位置）。
 *
 * 宿主对 seed 的硬要求：必须是 balanced completed-turn 前缀——不允许以未闭合的
 * turn/step 或悬空 tool call 结尾。从尾向头扫，第一个 turn/end 的下一位置即安全切口。
 *
 * @param {readonly unknown[]} events 会话事件流（按 seq 升序）
 * @returns {number} 切口位置（slice(0, cut) 即合法前缀）；没有任何完成轮次时返回 -1
 */
export function pickForkBoundary(events) {
  const list = Array.isArray(events) ? events : []
  for (let index = list.length - 1; index >= 0; index -= 1) {
    if (list[index]?.type === 'turn/end') return index + 1
  }
  return -1
}

/**
 * 按完成轮次边界切出 fork 种子。
 *
 * @param {readonly unknown[]} events 会话事件流
 * @returns {{ seed: unknown[], complete: boolean }} complete=false 表示旧会话
 *   还没有任何完成轮次（或事件流为空），此时不应携带 seed，退化为全新会话。
 */
export function buildForkSeed(events) {
  const cut = pickForkBoundary(events)
  if (cut <= 0) return { seed: [], complete: false }
  return { seed: events.slice(0, cut), complete: true }
}

/**
 * 用只读句柄读一个会话的全部事件。
 *
 * 关键点：open(id, 'read') 不取所有权（宿主注释原文 "read（无所有权）"），
 * 写句柄被 GUI 占用时照样能读——这正是占用接管可行的根基。
 *
 * @param {unknown} sessionPersistence ctx.sessionPersistence 服务
 * @param {string} sessionId 要读的会话号
 * @returns {Promise<unknown[]|null>} 事件数组；服务缺失/读失败时返回 null，
 *   调用方应退化为"不带 seed 的全新会话"，绝不因此阻断用户消息。
 */
export async function readSessionEvents(sessionPersistence, sessionId) {
  if (sessionPersistence === null || typeof sessionPersistence.open !== 'function') return null
  let handle = null
  try {
    handle = await sessionPersistence.open(sessionId, 'read')
    // read(offset, length)：length 缺省语义是"读到尾"，这里显式传安全整数上限，
    // 避免个别后端把 undefined 当 0 处理。
    const slice = await handle.read(0, Number.MAX_SAFE_INTEGER)
    return Array.isArray(slice?.events) ? slice.events : null
  } catch {
    return null
  } finally {
    // 读句柄用完必须关闭；close 失败不影响主流程（句柄随宿主回收）。
    try { await handle?.close?.() } catch {}
  }
}

/**
 * 归因占用者：宿主进程内是否已有这条会话的活体代理。
 *
 * 有活体代理 → 几乎必然是电脑端 GUI 打开着该会话（宿主内唯一会长期持有写句柄的
 * 场景）；没有 → 占用者在本宿主进程之外（外部进程持有跨进程租约）。只用于日志
 * 与用户文案，不参与控制流——两种情况的处置完全相同：fork 接管。
 *
 * @param {unknown} agents ctx.agents 服务
 * @param {string} sessionId 被占用的会话号
 * @returns {'gui'|'external'} 占用者归因
 */
export function describeOccupier(agents, sessionId) {
  try {
    return typeof agents?.get === 'function' && agents.get(sessionId) !== undefined ? 'gui' : 'external'
  } catch {
    return 'external'
  }
}

/**
 * 组装 fork 后继会话的 agents.create 参数。
 *
 * seed 非空：新号继承父会话全部完成轮次（parentSession 血缘 + seedLength 边界）。
 * seed 为空（旧会话无完成轮次）：退化为全新会话参数，绝不传空 seed——宿主把空
 * 种子按"有种子但为空"校验会直接拒绝。
 *
 * @param {object} input 参数包
 * @param {string} input.sessionId 后继会话号
 * @param {unknown[]} input.seed 父日志前缀（buildForkSeed 的产物）
 * @param {string} input.parentSessionId 被占用的父会话号
 * @param {string} input.cwd 工作目录（宿主要求 validated absolute path）
 * @param {string} input.agentPreset 预设名
 * @param {unknown} input.agentOptions 模型选择等 agent 选项
 * @param {unknown} input.setup 创建期组合回调（与 resume 同一形状）
 * @returns {object} agents.create 的 options
 */
export function forkCreateOptions({ sessionId, seed, parentSessionId, cwd, agentPreset, agentOptions, setup }) {
  const base = { sessionId, agentOptions, setup }
  if (!Array.isArray(seed) || seed.length === 0) {
    return { ...base, meta: { cwd, agentPreset } }
  }
  return {
    ...base,
    seed,
    meta: { cwd, agentPreset, parentSession: parentSessionId, seedLength: seed.length },
  }
}
