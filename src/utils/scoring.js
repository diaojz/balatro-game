import { getCardValue } from './poker.js'

// 一次性算最终分（用于选牌预览等不需要分步动效的场景）
export function calculateScore(cards, handType, jokers = []) {
  const state = {
    chips: handType.chips,
    mult: handType.mult,
    jokerCount: jokers.length
  }

  cards.forEach(card => {
    state.chips += getCardValue(card.rank)
  })

  jokers.forEach(joker => {
    if (joker.effect) {
      joker.effect(cards, handType, state)
    }
  })

  return state.chips * state.mult
}

/**
 * 判断某张牌在当前 boss rule 下是否被 debuff（不计 chips）。
 * - DEBUFF_FACE  : J/Q/K（rank 11-13）失效
 * - DEBUFF_SPADE : 黑桃 ♠ 失效
 * - DEBUFF_PREVIOUS : 调用方在 card 上标记 debuffed=true（本 ante 之前打过）
 */
export function isCardDebuffed(card, bossRule) {
  if (!bossRule) return false
  if (bossRule.key === 'DEBUFF_FACE' && card.rank >= 11 && card.rank <= 13) return true
  if (bossRule.key === 'DEBUFF_SPADE' && card.suit === 'spades') return true
  if (bossRule.key === 'DEBUFF_PREVIOUS' && card.debuffed) return true
  return false
}

/**
 * 把一手牌的计分过程拆成事件序列，让 UI 能逐步播放：
 *  - base   : 牌型基础 chips × mult
 *  - card   : 每张已打出的牌叠加点数 chips（debuff 时 chipsDelta=0）
 *  - joker  : 每张持有的 Joker 触发后 chips/mult 的变化量
 *  - final  : 总分 = chips × mult
 *
 * Joker 的 chipsDelta / multDelta 通过 effect 调用前后对比 state 得到，
 * 这样不论 effect 改了哪个指标，UI 都能针对性飘字。
 *
 * bossRule 参数控制 card 事件是否标记 debuffed（不计 chips 但仍触发 card 事件，
 * 让 UI 仍走"每张牌检查"的节奏，飘"DEBUFF"灰字）。
 */
export function buildScoreSequence(cards, handType, jokers = [], bossRule = null) {
  const events = []
  const state = {
    chips: handType.chips,
    mult: handType.mult,
    jokerCount: jokers.length
  }

  events.push({
    type: 'base',
    handType,
    chips: state.chips,
    mult: state.mult
  })

  cards.forEach(card => {
    const debuffed = isCardDebuffed(card, bossRule)
    const delta = debuffed ? 0 : getCardValue(card.rank)
    state.chips += delta
    events.push({
      type: 'card',
      card,
      debuffed,
      chipsDelta: delta,
      multDelta: 0,
      totalChips: state.chips,
      totalMult: state.mult
    })
  })

  jokers.forEach((joker, index) => {
    if (!joker.effect) return
    const beforeChips = state.chips
    const beforeMult = state.mult
    joker.effect(cards, handType, state)
    const chipsDelta = state.chips - beforeChips
    const multDelta = state.mult - beforeMult
    if (chipsDelta === 0 && multDelta === 0) return // 该 Joker 本回合没生效，跳过事件
    events.push({
      type: 'joker',
      joker,
      jokerIndex: index,
      chipsDelta,
      multDelta,
      totalChips: state.chips,
      totalMult: state.mult
    })
  })

  events.push({
    type: 'final',
    chips: state.chips,
    mult: state.mult,
    score: state.chips * state.mult
  })

  return events
}
