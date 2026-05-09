import { getCardValue } from './poker.js'

// 计算得分
export function calculateScore(cards, handType, jokers = []) {
  const state = {
    chips: handType.chips,
    mult: handType.mult
  }

  // 加上牌点数
  cards.forEach(card => {
    state.chips += getCardValue(card.rank)
  })

  // 应用小丑牌效果（第二节课实现）
  jokers.forEach(joker => {
    if (joker.effect) {
      joker.effect(cards, handType, state)
    }
  })

  return state.chips * state.mult
}
