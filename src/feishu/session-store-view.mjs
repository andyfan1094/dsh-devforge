// 会话持久化快照的读取与排序：把 sessionPersistence.list() 的返回形状收敛在一处。
//
// 为什么值得独立成模块：
// ① index.mjs 顶部依赖宿主运行时（@deepseek-ai/dsh-agent），测试直接 import 拉不起重依赖；
// ② 0.41.6 及以前的「重启就新开会话」根因正是这里读错了字段——list() 返回的是快照
//    { header, revision, sizeBytes }，身份在 snapshot.header.id 上，而代码读的是
//    snapshot.id（恒为 undefined），导致 persistedIds 恒为空：
//      · resumeCandidates 被清空 → resume 永远不执行
//      · createCandidates 放行全部候选 → create 从稳定号开始撞车，靠 already-exists
//        兜底一路退到下一个空号，磁盘上表现为兜底号 0→4 严格递增。
//    这个坑必须用单测锁死。

/**
 * 归拢 list() 返回的会话快照。
 * 同时兼容快照形状（{ header: { id } }）与裸 header 形状（{ id }），
 * 便于后端演进或未来换后端时不至于再次静默读空。
 *
 * @param {unknown} snapshots sessionPersistence.list() 的返回值
 * @returns {{ ids: Set<string>, byId: Map<string, unknown>, listed: boolean }}
 *   ids 供候选过滤使用；byId 供排序取活动时间；listed 表示后端确实给出了清单。
 */
export function collectPersistedSessions(snapshots) {
  const ids = new Set()
  const byId = new Map()
  if (!Array.isArray(snapshots)) return { ids, byId, listed: false }
  for (const snapshot of snapshots) {
    const id = String(snapshot?.header?.id ?? snapshot?.id ?? '').trim()
    if (id === '') continue
    ids.add(id)
    byId.set(id, snapshot)
  }
  return { ids, byId, listed: true }
}

/**
 * 一条已落盘会话的"最后活动时间"（毫秒），取不到就返回 -1。
 * revision 是 JSONL 后端 stat 派生的 "dev:ino:size:mtimeNs:ctimeNs"，第 4 段即 mtime；
 * 换后端或字段形态变化时退回 header.createdAt。
 *
 * @param {unknown} snapshot 会话快照
 * @returns {number} 毫秒时间戳，未知为 -1
 */
export function sessionActivityAt(snapshot) {
  if (snapshot === undefined || snapshot === null) return -1
  const mtimeNs = Number(String(snapshot.revision ?? '').split(':')[3])
  if (Number.isFinite(mtimeNs) && mtimeNs > 0) return Math.round(mtimeNs / 1e6)
  const createdAt = Number(snapshot.header?.createdAt ?? snapshot.createdAt)
  return Number.isFinite(createdAt) ? createdAt : -1
}

/**
 * 按最后活动时间倒序排列候选会话号。
 * 同一条聊天在磁盘上会积累多代会话号（稳定号 + 若干兜底号），必须接回**最近**聊的那条，
 * 否则重启/升级后用户最近几轮对话照样整段丢掉。
 *
 * @param {Iterable<string>} candidateIds 候选会话号
 * @param {Map<string, unknown>} byId 快照索引
 * @returns {string[]} 排序后的候选（未知活动时间的排最后）
 */
export function orderByRecentActivity(candidateIds, byId) {
  return [...candidateIds].sort((left, right) => sessionActivityAt(byId.get(right)) - sessionActivityAt(byId.get(left)))
}
