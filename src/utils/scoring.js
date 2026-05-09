import { getCardValue } from './poker.js'

// 计算得分
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
