/**
 * ai-pilot.js — v1.11 AI 托管模式决策状态机
 *
 * 导出：
 *   runAutoPilot({ actor, refs, signal, onTick, providerHint })
 *   class AiPilotAbort extends Error
 *   wait(ms, signal)
 *
 * 设计纪律：
 *   - 不碰 DOM（零 DOM API 调用，不查询任何元素）
 *   - 不用轮询定时器（主循环完全靠 await wait() 串行推进，AbortSignal 可立即打断）
 *   - onTick 异常被吞掉，不影响主循环
 *   - LLM 失败 >= AI_PILOT_MAX_FAILURES(=1) 立即终止整局，不重试，避免连环烧 Key
 */

import {
  requestPlayAdvice,
  requestDiscardAdvice,
  requestShopAdvice,
  requestBlindAdvice,
  AiCoachError
} from './ai-coach.js'

import {
  AI_PILOT_TICK_DELAY_MS,
  AI_PILOT_RESOLVE_WAIT_MS,
  AI_PILOT_SHOP_WAIT_MS,
  AI_PILOT_BLIND_WAIT_MS,
  AI_PILOT_MAX_FAILURES
} from '../config/ai.js'

// ─────────────────────────────────────────────────────────────────────────────
// 导出：AiPilotAbort
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 托管主循环主动中止时抛出的错误类型。
 * 上层 try/catch 应先判断 instanceof AiPilotAbort，若是则静默处理（非异常情况）。
 */
export class AiPilotAbort extends Error {
  constructor(reason = 'aborted') {
    super(reason)
    this.name = 'AiPilotAbort'
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 导出：wait(ms, signal)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 可被 AbortSignal 打断的延时工具。
 * 注意：setTimeout 用于延时（一次性触发），符合文档约束。
 *
 * @param {number} ms - 等待毫秒数
 * @param {AbortSignal|null} [signal] - 中止信号；abort 后立即 reject AiPilotAbort
 * @returns {Promise<void>}
 */
export function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    // 若信号在调用时已经 aborted，立即 reject
    if (signal?.aborted) return reject(new AiPilotAbort('signal_aborted'))

    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)

    function onAbort() {
      clearTimeout(t)
      reject(new AiPilotAbort('signal_aborted'))
    }

    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// 内部工具：payload 构建器
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 出牌 / 弃牌场景 payload（与 serializePlayState 的输入字段对齐）
 * @param {object} refs - 一组 ref/computed
 * @returns {object}
 */
function buildPlayPayload(refs) {
  return {
    hand:          refs.hand.value,
    ownedJokers:   refs.ownedJokers.value,
    blind:         refs.blind.value,
    handsLeft:     refs.handsLeft.value,
    discardsLeft:  refs.discardsLeft.value,
    money:         refs.money.value,
    lastPlayedHand: refs.lastPlayedHand.value,
    totalScore:    refs.totalScore.value
  }
}

/**
 * 商店场景 payload（与 serializeShopState 的输入字段对齐）
 * 注意字段名：blind（不是 currentBlind）+ shopJokersWithIds / ownedJokersWithIds
 * @param {object} refs
 * @returns {object}
 */
function buildShopPayload(refs) {
  return {
    shopJokers:    refs.shopJokersWithIds.value,
    ownedJokers:   refs.ownedJokersWithIds.value,
    money:         refs.money.value,
    currentAnte:   refs.currentAnte.value,
    blind:         refs.blind.value,
    lastPlayedHand: refs.lastPlayedHand.value
  }
}

/**
 * 盲注选择场景 payload（与 serializeBlindState 的输入字段对齐）
 * @param {object} refs
 * @returns {object}
 */
function buildBlindPayload(refs) {
  return {
    candidateBlinds: refs.candidateBlinds.value,
    ownedJokers:     refs.ownedJokers.value,
    money:           refs.money.value,
    currentAnte:     refs.currentAnte.value,
    totalScore:      refs.totalScore.value,
    lastPlayedHand:  refs.lastPlayedHand.value
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 内部工具：启发式判断当前手牌是否"最优只能凑高牌"
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 粗略判断当前手牌的最优牌型是否只有高牌，用于决定"先弃牌优化手牌"还是"直接出牌"。
 *
 * 规则（故意简化，v1.11.0 目标是打通流程而非优化 AI 水平）：
 *   - 手牌中有任意同点数对子（或更多） → false（能组成对子以上牌型）
 *   - 手牌中同一花色 >= 5 张 → false（同花潜力）
 *   - 都没有 → 认为目前只能凑高牌，返回 true
 *
 * 注意：不 import poker.js；只做近似判断，不修改玩法逻辑文件。
 *
 * @param {object} refs
 * @returns {boolean}
 */
function evaluateBestPreviewIsHighCard(refs) {
  const hand = refs.hand.value
  if (!hand || hand.length === 0) return false

  // 检查是否有同点数牌（对子及以上）
  const rankCount = {}
  for (const card of hand) {
    rankCount[card.rank] = (rankCount[card.rank] || 0) + 1
  }
  if (Object.values(rankCount).some(n => n >= 2)) return false

  // 检查是否有同花潜力（5 张及以上同花色）
  const suitCount = {}
  for (const card of hand) {
    suitCount[card.suit] = (suitCount[card.suit] || 0) + 1
  }
  if (Object.values(suitCount).some(n => n >= 5)) return false

  // 简单的顺子检测：如果有 5 张连续点数，也不用弃牌
  const rankOrder = ['2','3','4','5','6','7','8','9','10','J','Q','K','A']
  const ranks = hand.map(c => rankOrder.indexOf(String(c.rank))).filter(i => i >= 0).sort((a, b) => a - b)
  if (ranks.length >= 5) {
    const unique = [...new Set(ranks)]
    for (let i = 0; i <= unique.length - 5; i++) {
      if (unique[i + 4] - unique[i] === 4) return false
    }
  }

  return true
}

// ─────────────────────────────────────────────────────────────────────────────
// 主循环：runAutoPilot
// ─────────────────────────────────────────────────────────────────────────────

/**
 * AI 托管主循环。按 runPhase 自动调度 4 个 advice 函数 + 调用 actor 执行。
 *
 * @param {object} params
 * @param {object}   params.actor        - createGameActor 返回的 actor 对象
 * @param {object}   params.refs         - createGameState 返回的全套 ref/computed
 * @param {AbortSignal|null} params.signal - 中止信号；abort 后立即退出主循环
 * @param {Function} [params.onTick]     - 每个决策事件的回调 (event) => void；异常被吞掉
 * @param {string|null} [params.providerHint] - 临时供应商标识（双 AI 模式透传）；null 使用全局设置
 * @returns {Promise<{ reason: 'game_over'|'aborted'|'reset'|'failed', error?: Error }>}
 */
export async function runAutoPilot({ actor, refs, signal, onTick, providerHint = null }) {
  let failures = 0
  let stepIndex = 0

  // onTick 封装：内部异常不影响主循环
  function emit(event) {
    try {
      onTick?.({ ...event, at: Date.now(), step: ++stepIndex })
    } catch (_) {
      // 故意吞掉，避免 UI 层 bug 干扰主循环
    }
  }

  // providerHint 到 options 的转换
  const adviceOptions = providerHint ? { providerOverride: providerHint } : {}

  emit({ kind: 'start', message: 'AI 接管开始' })

  // 主循环：串行推进，全靠 await wait() 节奏控制
  while (true) {
    // 每轮开始先检查 abort
    if (signal?.aborted) {
      emit({ kind: 'end', reason: 'aborted' })
      return { reason: 'aborted' }
    }

    const phase = refs.runPhase.value
    emit({ kind: 'phase', phase })

    try {
      // ── game-over：主循环正常结束 ──────────────────────────────────────────
      if (phase === 'game-over') {
        emit({
          kind:       'end',
          reason:     'game_over',
          totalScore: refs.totalScore.value,
          ante:       refs.currentAnte.value
        })
        return { reason: 'game_over' }
      }

      // ── setup：玩家中途 reset，托管自动退出 ──────────────────────────────────
      if (phase === 'setup') {
        emit({ kind: 'end', reason: 'reset_to_setup' })
        return { reason: 'reset' }
      }

      // ── blind-select：选择本 ante 盲注 ──────────────────────────────────────
      if (phase === 'blind-select') {
        emit({ kind: 'thinking', scene: 'blind' })
        const advice = await requestBlindAdvice(buildBlindPayload(refs), adviceOptions)
        emit({ kind: 'decided', scene: 'blind', advice })
        const r = await actor.selectBlind(advice.blindId)
        if (!r.ok) throw new AiCoachError('actor_failed', r.reason)
        await wait(AI_PILOT_BLIND_WAIT_MS, signal)
      }

      // ── battle：出牌 / 弃牌 ─────────────────────────────────────────────────
      else if (phase === 'battle') {
        // 启发式：有弃牌次数 + 剩余出牌次数 > 1 + 当前手牌最优只是高牌 → 先弃牌优化手牌
        const shouldTryDiscard =
          refs.discardsLeft.value > 0 &&
          refs.handsLeft.value > 1 &&
          evaluateBestPreviewIsHighCard(refs)

        if (shouldTryDiscard) {
          emit({ kind: 'thinking', scene: 'discard' })
          const advice = await requestDiscardAdvice(buildPlayPayload(refs), adviceOptions)
          emit({ kind: 'decided', scene: 'discard', advice })
          const r = await actor.discard(advice.discardCardIds)
          if (!r.ok) throw new AiCoachError('actor_failed', r.reason)
        } else {
          emit({ kind: 'thinking', scene: 'play' })
          const advice = await requestPlayAdvice(buildPlayPayload(refs), adviceOptions)
          emit({ kind: 'decided', scene: 'play', advice })
          const r = await actor.playHand(advice.recommendedCardIds)
          if (!r.ok) throw new AiCoachError('actor_failed', r.reason)
        }
        await wait(AI_PILOT_RESOLVE_WAIT_MS, signal)
      }

      // ── reward：结算页，自动 proceedToShop ──────────────────────────────────
      else if (phase === 'reward') {
        emit({ kind: 'auto', message: '结算 → 进入商店' })
        const r = await actor.proceedToShop()
        if (!r.ok) throw new AiCoachError('actor_failed', r.reason)
        await wait(AI_PILOT_SHOP_WAIT_MS, signal)
      }

      // ── shop：AI 决策买 / 卖 / 刷新 / 跳过 ─────────────────────────────────
      else if (phase === 'shop') {
        emit({ kind: 'thinking', scene: 'shop' })
        const advice = await requestShopAdvice(buildShopPayload(refs), adviceOptions)
        emit({ kind: 'decided', scene: 'shop', advice })

        let r
        if (advice.action === 'buy')         r = await actor.buyJoker(advice.targetId)
        else if (advice.action === 'sell')   r = await actor.sellJoker(advice.targetId)
        else if (advice.action === 'reroll') r = await actor.reroll()
        else                                  r = await actor.skipShop()

        if (!r.ok) throw new AiCoachError('actor_failed', r.reason)
        await wait(AI_PILOT_SHOP_WAIT_MS, signal)
      }

      // ── pack：v1.11.0 不处理卡包，一律跳过 ─────────────────────────────────
      else if (phase === 'pack') {
        emit({ kind: 'auto', message: '跳过卡包阶段' })
        const r = await actor.skipShop()
        if (!r.ok) throw new AiCoachError('actor_failed', r.reason)
        await wait(AI_PILOT_SHOP_WAIT_MS, signal)
      }

      // ── 未知阶段：等待 game state 自然转移 ──────────────────────────────────
      else {
        emit({ kind: 'auto', message: `等待阶段转移（当前：${phase}）` })
        await wait(AI_PILOT_TICK_DELAY_MS, signal)
      }

    } catch (err) {
      // AiPilotAbort：abort 信号触发，静默退出
      if (err instanceof AiPilotAbort) {
        emit({ kind: 'end', reason: 'aborted' })
        return { reason: 'aborted' }
      }

      // 其他错误（LLM 失败 / actor 拒绝 / 网络问题等）
      failures += 1
      emit({
        kind:     'error',
        error:    { reason: err.reason || 'unknown', detail: err.detail || err.message },
        failures
      })

      if (failures >= AI_PILOT_MAX_FAILURES) {
        emit({
          kind:   'end',
          reason: 'failed',
          error:  { reason: err.reason || 'unknown', detail: err.detail || err.message }
        })
        return { reason: 'failed', error: err }
      }
    }

    // 每个决策周期之间最小间隔，让动效 / 气泡有时间展示
    await wait(AI_PILOT_TICK_DELAY_MS, signal)
  }
}
