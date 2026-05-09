// 小丑牌配置 — 25 张，对齐《Balatro》原作命名/效果/稀有度
// 稀有度：common（普通）/ uncommon（罕见）/ rare（稀有）/ legendary（传说）
// art 字段决定 JokerCard 组件用哪种纯 CSS 像素风插图

export const JOKERS = {
  // ========== Common（普通）==========
  JOKER: {
    id: 'joker',
    name: '小丑',
    description: '+4 倍率',
    price: 2,
    rarity: 'common',
    art: 'jimbo',
    effect: (cards, handType, state) => {
      state.mult += 4
    }
  },
  GREEDY_JOKER: {
    id: 'greedy_joker',
    name: '贪婪小丑',
    description: '已打出的 ♦ 牌每张 +3 倍率',
    price: 5,
    rarity: 'common',
    art: 'suit-diamond',
    effect: (cards, handType, state) => {
      const count = cards.filter(c => c.suit === 'diamonds').length
      state.mult += count * 3
    }
  },
  LUSTY_JOKER: {
    id: 'lusty_joker',
    name: '色欲小丑',
    description: '已打出的 ♥ 牌每张 +3 倍率',
    price: 5,
    rarity: 'common',
    art: 'suit-heart',
    effect: (cards, handType, state) => {
      const count = cards.filter(c => c.suit === 'hearts').length
      state.mult += count * 3
    }
  },
  WRATHFUL_JOKER: {
    id: 'wrathful_joker',
    name: '愤怒小丑',
    description: '已打出的 ♠ 牌每张 +3 倍率',
    price: 5,
    rarity: 'common',
    art: 'suit-spade',
    effect: (cards, handType, state) => {
      const count = cards.filter(c => c.suit === 'spades').length
      state.mult += count * 3
    }
  },
  GLUTTONOUS_JOKER: {
    id: 'gluttonous_joker',
    name: '暴食小丑',
    description: '已打出的 ♣ 牌每张 +3 倍率',
    price: 5,
    rarity: 'common',
    art: 'suit-club',
    effect: (cards, handType, state) => {
      const count = cards.filter(c => c.suit === 'clubs').length
      state.mult += count * 3
    }
  },
  JOLLY_JOKER: {
    id: 'jolly_joker',
    name: '欢乐小丑',
    description: '当牌组含「对子」时 +8 倍率',
    price: 3,
    rarity: 'common',
    art: 'smile',
    effect: (cards, handType, state) => {
      if (['对子', '两对', '三条', '葫芦', '四条'].includes(handType.name)) {
        state.mult += 8
      }
    }
  },
  ZANY_JOKER: {
    id: 'zany_joker',
    name: '滑稽小丑',
    description: '当牌组含「三条」时 +12 倍率',
    price: 4,
    rarity: 'common',
    art: 'wink',
    effect: (cards, handType, state) => {
      if (['三条', '葫芦', '四条'].includes(handType.name)) {
        state.mult += 12
      }
    }
  },
  MAD_JOKER: {
    id: 'mad_joker',
    name: '疯狂小丑',
    description: '当牌组含「两对」时 +10 倍率',
    price: 4,
    rarity: 'common',
    art: 'angry',
    effect: (cards, handType, state) => {
      if (['两对', '葫芦'].includes(handType.name)) {
        state.mult += 10
      }
    }
  },
  CRAZY_JOKER: {
    id: 'crazy_joker',
    name: '癫狂小丑',
    description: '当牌组含「顺子」时 +12 倍率',
    price: 4,
    rarity: 'common',
    art: 'tongue',
    effect: (cards, handType, state) => {
      if (['顺子', '同花顺'].includes(handType.name)) {
        state.mult += 12
      }
    }
  },
  DROLL_JOKER: {
    id: 'droll_joker',
    name: '诙谐小丑',
    description: '当牌组含「同花」时 +10 倍率',
    price: 4,
    rarity: 'common',
    art: 'fish',
    effect: (cards, handType, state) => {
      if (['同花', '同花顺'].includes(handType.name)) {
        state.mult += 10
      }
    }
  },
  SLY_JOKER: {
    id: 'sly_joker',
    name: '狡猾小丑',
    description: '当牌组含「对子」时 +50 筹码',
    price: 3,
    rarity: 'common',
    art: 'glasses',
    effect: (cards, handType, state) => {
      if (['对子', '两对', '三条', '葫芦', '四条'].includes(handType.name)) {
        state.chips += 50
      }
    }
  },
  HALF_JOKER: {
    id: 'half_joker',
    name: '半身小丑',
    description: '出牌不超过 3 张时 +20 倍率',
    price: 5,
    rarity: 'common',
    art: 'half',
    effect: (cards, handType, state) => {
      if (cards.length <= 3) {
        state.mult += 20
      }
    }
  },
  EVEN_STEVEN: {
    id: 'even_steven',
    name: '偶数小子',
    description: '已打出的偶数牌（10/8/6/4/2）每张 +4 倍率',
    price: 4,
    rarity: 'common',
    art: 'even',
    effect: (cards, handType, state) => {
      const count = cards.filter(c => c.rank >= 2 && c.rank <= 10 && c.rank % 2 === 0).length
      state.mult += count * 4
    }
  },
  ODD_TODD: {
    id: 'odd_todd',
    name: '奇数小托',
    description: '已打出的奇数牌（A/9/7/5/3）每张 +30 筹码',
    price: 4,
    rarity: 'common',
    art: 'odd',
    effect: (cards, handType, state) => {
      const count = cards.filter(c => c.rank === 14 || (c.rank >= 3 && c.rank <= 9 && c.rank % 2 === 1)).length
      state.chips += count * 30
    }
  },
  SCARY_FACE: {
    id: 'scary_face',
    name: '惊悚脸',
    description: '已打出的人头牌（J/Q/K）每张 +30 筹码',
    price: 4,
    rarity: 'common',
    art: 'skull',
    effect: (cards, handType, state) => {
      const count = cards.filter(c => c.rank >= 11 && c.rank <= 13).length
      state.chips += count * 30
    }
  },
  ABSTRACT_JOKER: {
    id: 'abstract_joker',
    name: '抽象小丑',
    description: '每持有一张小丑牌 +3 倍率',
    price: 4,
    rarity: 'common',
    art: 'abstract',
    effect: (cards, handType, state) => {
      const jokerCount = state.jokerCount || 1
      state.mult += jokerCount * 3
    }
  },

  // ========== Uncommon（罕见）==========
  FIBONACCI: {
    id: 'fibonacci',
    name: '斐波那契',
    description: '已打出的 A/2/3/5/8 每张 +8 倍率',
    price: 8,
    rarity: 'uncommon',
    art: 'spiral',
    effect: (cards, handType, state) => {
      const count = cards.filter(c => [14, 2, 3, 5, 8].includes(c.rank)).length
      state.mult += count * 8
    }
  },
  SCHOLAR: {
    id: 'scholar',
    name: '学者',
    description: '已打出的 A 牌每张 +20 筹码 +4 倍率',
    price: 4,
    rarity: 'uncommon',
    art: 'book',
    effect: (cards, handType, state) => {
      const count = cards.filter(c => c.rank === 14).length
      state.chips += count * 20
      state.mult += count * 4
    }
  },
  WALKIE_TALKIE: {
    id: 'walkie_talkie',
    name: '对讲机',
    description: '已打出的 10 与 4 每张 +10 筹码 +4 倍率',
    price: 4,
    rarity: 'uncommon',
    art: 'radio',
    effect: (cards, handType, state) => {
      const count = cards.filter(c => c.rank === 10 || c.rank === 4).length
      state.chips += count * 10
      state.mult += count * 4
    }
  },
  SMILEY_FACE: {
    id: 'smiley_face',
    name: '笑脸',
    description: '已打出的人头牌每张 +5 倍率',
    price: 4,
    rarity: 'uncommon',
    art: 'smiley',
    effect: (cards, handType, state) => {
      const count = cards.filter(c => c.rank >= 11 && c.rank <= 13).length
      state.mult += count * 5
    }
  },
  RIDE_THE_BUS: {
    id: 'ride_the_bus',
    name: '公车小丑',
    description: '本回合首次出牌 +15 倍率',
    price: 6,
    rarity: 'uncommon',
    art: 'bus',
    effect: (cards, handType, state) => {
      state.mult += 15
    }
  },

  // ========== Rare（稀有）==========
  BARON: {
    id: 'baron',
    name: '男爵',
    description: '出牌时持有的 K 每张 ×1.5 倍率',
    price: 8,
    rarity: 'rare',
    art: 'crown',
    effect: (cards, handType, state) => {
      const count = cards.filter(c => c.rank === 13).length
      if (count > 0) {
        state.mult *= Math.pow(1.5, count)
      }
    }
  },
  THE_DUO: {
    id: 'the_duo',
    name: '二重唱',
    description: '当牌组含「对子」时 ×2 倍率',
    price: 8,
    rarity: 'rare',
    art: 'duo',
    effect: (cards, handType, state) => {
      if (['对子', '两对', '三条', '葫芦', '四条'].includes(handType.name)) {
        state.mult *= 2
      }
    }
  },
  THE_TRIO: {
    id: 'the_trio',
    name: '三重奏',
    description: '当牌组含「三条」时 ×3 倍率',
    price: 8,
    rarity: 'rare',
    art: 'trio',
    effect: (cards, handType, state) => {
      if (['三条', '葫芦', '四条'].includes(handType.name)) {
        state.mult *= 3
      }
    }
  },
  THE_ORDER: {
    id: 'the_order',
    name: '秩序',
    description: '当牌组含「顺子」时 ×3 倍率',
    price: 8,
    rarity: 'rare',
    art: 'order',
    effect: (cards, handType, state) => {
      if (['顺子', '同花顺'].includes(handType.name)) {
        state.mult *= 3
      }
    }
  },

  // ========== Legendary（传说）==========
  TRIBOULET: {
    id: 'triboulet',
    name: '特里布莱',
    description: '已打出的 K 与 Q 每张 ×2 倍率',
    price: 20,
    rarity: 'legendary',
    art: 'jester',
    effect: (cards, handType, state) => {
      const count = cards.filter(c => c.rank === 12 || c.rank === 13).length
      if (count > 0) {
        state.mult *= Math.pow(2, count)
      }
    }
  }
}

// 各稀有度在商店出现的权重（贴近原作）
const RARITY_WEIGHTS = {
  common: 70,
  uncommon: 25,
  rare: 5,
  legendary: 0 // 传说牌不会出现在普通商店
}

// 按稀有度获取一张随机小丑牌
export function getRandomJoker() {
  const totalWeight = Object.values(RARITY_WEIGHTS).reduce((a, b) => a + b, 0)
  let roll = Math.random() * totalWeight
  let chosenRarity = 'common'
  for (const [rarity, weight] of Object.entries(RARITY_WEIGHTS)) {
    if (roll < weight) {
      chosenRarity = rarity
      break
    }
    roll -= weight
  }
  const pool = Object.values(JOKERS).filter(j => j.rarity === chosenRarity)
  const list = pool.length > 0 ? pool : Object.values(JOKERS).filter(j => j.rarity === 'common')
  return { ...list[Math.floor(Math.random() * list.length)] }
}

// 稀有度展示文案
export function getRarityLabel(rarity) {
  const labels = {
    common: '普通',
    uncommon: '罕见',
    rare: '稀有',
    legendary: '传说'
  }
  return labels[rarity] || '普通'
}

// 稀有度对应的边框/光晕颜色（可在 CSS 中用作 var(--joker-rarity)）
export function getRarityColor(rarity) {
  const colors = {
    common: '#6cb4d3',
    uncommon: '#5bc97a',
    rare: '#e34b6f',
    legendary: '#b577ff'
  }
  return colors[rarity] || colors.common
}

// 兼容旧调用：返回稀有度键名给 :class 直接拼用
export function getRarityBgColor(rarity) {
  return `rarity-${rarity || 'common'}`
}
