// 飞书入站消息投递策略（0.66.1 起独立成模块：纯函数，可单测）。
//
// 背景（2026-10-20 辉哥实录）：旧策略是「运行中收到的任何消息都 steer 进当前轮」，
// 而流式回复卡片按会话只维护一张（reply-tracker 的 active entry）。飞书对卡片原地
// 更新既不产生新消息也不提醒，于是手机端表现为「发了消息却看不到回复」；更糟的是
// steer 在 turn/end 边界被拒时只停在 inbox，整轮没有 entry 承载输出，回复彻底丢失。
//
// 新策略：普通消息在运行中排队（本轮结束后逐条 followup，每条消息独立开一张新卡，
// 飞书会作为新消息出现），只有显式以「!」开头的插话才 steer 进当前轮（配合翻页，
// 续写落到新卡片上）。

export const DELIVERY = Object.freeze({
  /** 空闲：正常开一轮新 turn。 */
  FOLLOWUP: 'followup',
  /** 运行中且显式插话：steer 进当前轮次的最邻近 step。 */
  STEER: 'steer',
  /** 运行中普通消息：排队，等当前轮结束后逐条 followup。 */
  QUEUE: 'queue',
})

/**
 * 决定一条入站消息的投递方式。
 * @param {{ wasRunning?: boolean, isSteer?: boolean }} input
 * @returns {'followup' | 'steer' | 'queue'}
 */
export function inboundDeliveryOf({ wasRunning, isSteer } = {}) {
  if (wasRunning !== true) return DELIVERY.FOLLOWUP
  return isSteer === true ? DELIVERY.STEER : DELIVERY.QUEUE
}
