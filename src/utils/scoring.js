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
 * 把一手牌的计分过程拆成事件序列，让 UI 能逐步播放：
 *  - base   : 牌型基础 chips × mult
 *  - card   : 每张已打出的牌叠加点数 chips
 *  - joker  : 每张持有的 Joker 触发后 chips/mult 的变化量
 *  - final  : 总分 = chips × mult
 *
 * Joker 的 chipsDelta / multDelta 通过 effect 调用前后对比 state 得到，
 * 这样不论 effect 改了哪个指标，UI 都能针对性飘字。
 */
export function buildScoreSequence(cards, handType, jokers = []) {
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
    const delta = getCardValue(card.rank)
    state.chips += delta
    events.push({
      type: 'card',
      card,
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
