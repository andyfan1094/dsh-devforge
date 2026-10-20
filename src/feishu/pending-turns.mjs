// 运行中消息队列：convKey -> 待投递消息（FIFO）。
//
// 与 reply-tracker 分工：tracker 管「已开轮消息的卡片生命周期」，本模块只管
// 「还没轮到开轮的入站消息」。队列在 turn/end（或 agent/status 变 idle）之后逐条
// followup，保证每条消息都拥有自己的一轮 turn 与一张独立回复卡片——这是飞书端
// 能看到新消息的唯一可靠方式（卡片原地更新不产生新消息、不提醒）。

const keyOf = (key) => String(key ?? '')

export function createPendingTurns() {
  /** @type {Map<string, unknown[]>} */
  const queues = new Map()

  return {
    /** 入队一条消息，返回排队位次（1 起）。 */
    push(key, item) {
      const id = keyOf(key)
      const queue = queues.get(id) ?? []
      queue.push(item)
      queues.set(id, queue)
      return { position: queue.length, length: queue.length }
    },

    /** 取出队首（没有则 undefined）。 */
    shift(key) {
      const id = keyOf(key)
      const queue = queues.get(id)
      if (queue === undefined || queue.length === 0) return undefined
      const item = queue.shift()
      if (queue.length === 0) queues.delete(id)
      return item
    },

    /** 投递失败时把消息退回队首，等下一个边界重试。 */
    unshift(key, item) {
      const id = keyOf(key)
      const queue = queues.get(id) ?? []
      queue.unshift(item)
      queues.set(id, queue)
      return { position: 1, length: queue.length }
    },

    peek(key) {
      const queue = queues.get(keyOf(key))
      return queue === undefined || queue.length === 0 ? undefined : queue[0]
    },

    size(key) {
      return queues.get(keyOf(key))?.length ?? 0
    },

    keys() {
      return [...queues.keys()]
    },

    /** 清空某个会话的排队消息，返回被取消的条数（/stop 用）。 */
    clear(key) {
      const id = keyOf(key)
      const queue = queues.get(id)
      if (queue === undefined) return 0
      queues.delete(id)
      return queue.length
    },

    /** 清空全部（桥重建 / 插件卸载）。 */
    clearAll() {
      let removed = 0
      for (const queue of queues.values()) removed += queue.length
      queues.clear()
      return removed
    },
  }
}
