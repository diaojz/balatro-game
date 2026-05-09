// 牌型定义
export const HAND_TYPES = {
  HIGH_CARD: { name: '高牌', chips: 5, mult: 1, level: 1 },
  PAIR: { name: '对子', chips: 10, mult: 2, level: 2 },
  TWO_PAIR: { name: '两对', chips: 20, mult: 2, level: 3 },
  THREE_KIND: { name: '三条', chips: 30, mult: 3, level: 4 },
  STRAIGHT: { name: '顺子', chips: 30, mult: 4, level: 5 },
  FLUSH: { name: '同花', chips: 35, mult: 4, level: 6 },
  FULL_HOUSE: { name: '葫芦', chips: 40, mult: 4, level: 7 },
  FOUR_KIND: { name: '四条', chips: 60, mult: 7, level: 8 },
  STRAIGHT_FLUSH: { name: '同花顺', chips: 100, mult: 8, level: 9 }
}

// 识别牌型
export function identifyHand(cards) {
  if (cards.length !== 5) {
    return HAND_TYPES.HIGH_CARD
  }

  // 1. 统计点数出现次数
  const ranks = cards.map(c => c.rank)
  const counts = {}
  ranks.forEach(r => counts[r] = (counts[r] || 0) + 1)

  // 2. 检查同花
  const suits = cards.map(c => c.suit)
  const isFlush = new Set(suits).size === 1

  // 3. 检查顺子
  const sortedRanks = [...ranks].sort((a, b) => a - b)
  let isStraight = sortedRanks.every((r, i) =>
    i === 0 || r === sortedRanks[i-1] + 1
  )

  // 特殊处理 A-2-3-4-5 的顺子
  if (!isStraight && sortedRanks[0] === 2 && sortedRanks[4] === 14) {
    const lowAceStraight = [2, 3, 4, 5, 14]
    isStraight = sortedRanks.every((r, i) => r === lowAceStraight[i])
  }

  // 4. 判定牌型
  const countValues = Object.values(counts).sort((a, b) => b - a)

  // 同花顺
  if (isFlush && isStraight) return HAND_TYPES.STRAIGHT_FLUSH

  // 四条
  if (countValues[0] === 4) return HAND_TYPES.FOUR_KIND

  // 葫芦
  if (countValues[0] === 3 && countValues[1] === 2) return HAND_TYPES.FULL_HOUSE

  // 同花
  if (isFlush) return HAND_TYPES.FLUSH

  // 顺子
  if (isStraight) return HAND_TYPES.STRAIGHT

  // 三条
  if (countValues[0] === 3) return HAND_TYPES.THREE_KIND

  // 两对
  if (countValues[0] === 2 && countValues[1] === 2) return HAND_TYPES.TWO_PAIR

  // 对子
  if (countValues[0] === 2) return HAND_TYPES.PAIR

  // 高牌
  return HAND_TYPES.HIGH_CARD
}

// 获取牌点数值
export function getCardValue(rank) {
  if (rank >= 2 && rank <= 10) return rank
  if (rank === 11) return 10 // J
  if (rank === 12) return 10 // Q
  if (rank === 13) return 10 // K
  if (rank === 14) return 11 // A
  return 0
}

// 创建标准牌组
export function createDeck() {
  const suits = ['hearts', 'diamonds', 'clubs', 'spades']
  const ranks = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14] // 11=J, 12=Q, 13=K, 14=A
  const deck = []

  let id = 0
  for (const suit of suits) {
    for (const rank of ranks) {
      deck.push({
        id: id++,
        suit,
        rank,
        selected: false
      })
    }
  }

  return shuffleDeck(deck)
}

// 洗牌
export function shuffleDeck(deck) {
  const shuffled = [...deck]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }
  return shuffled
}

// 获取牌的显示名称
export function getCardDisplay(rank) {
  if (rank >= 2 && rank <= 10) return rank.toString()
  if (rank === 11) return 'J'
  if (rank === 12) return 'Q'
  if (rank === 13) return 'K'
  if (rank === 14) return 'A'
  return '?'
}

// 获取花色符号
export function getSuitSymbol(suit) {
  const symbols = {
    hearts: '♥',
    diamonds: '♦',
    clubs: '♣',
    spades: '♠'
  }
  return symbols[suit] || '?'
}

// 获取花色颜色
export function getSuitColor(suit) {
  return (suit === 'hearts' || suit === 'diamonds') ? 'text-red-600' : 'text-gray-900'
}
