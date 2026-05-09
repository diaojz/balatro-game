// 完整 8 ante × 3 盲注 = 24 关，严格对齐 Balatro 原作白注（White Stake）数据
//   - base chips: 300 / 800 / 2000 / 5000 / 11000 / 20000 / 35000 / 50000
//   - Small Blind = 1× base
//   - Big Blind   = 1.5× base
//   - Boss Blind  = 2× base （The Wall 4×、The Needle 1× 例外）
//   - 奖励金币：Small $3 / Big $4 / Boss $5

const HAND_LEVELS = {
  HIGH_CARD: { key: 'HIGH_CARD', name: '高牌', chips: 5, mult: 1, level: 1 },
  PAIR: { key: 'PAIR', name: '对子', chips: 10, mult: 2, level: 1 },
  TWO_PAIR: { key: 'TWO_PAIR', name: '两对', chips: 20, mult: 2, level: 1 },
  THREE_KIND: { key: 'THREE_KIND', name: '三条', chips: 30, mult: 3, level: 1 },
  STRAIGHT: { key: 'STRAIGHT', name: '顺子', chips: 30, mult: 4, level: 1 },
  FLUSH: { key: 'FLUSH', name: '同花', chips: 35, mult: 4, level: 1 },
  FULL_HOUSE: { key: 'FULL_HOUSE', name: '葫芦', chips: 40, mult: 4, level: 1 },
  FOUR_KIND: { key: 'FOUR_KIND', name: '四条', chips: 60, mult: 7, level: 1 },
  STRAIGHT_FLUSH: { key: 'STRAIGHT_FLUSH', name: '同花顺', chips: 100, mult: 8, level: 1 }
}

// 每个 ante 的 base chips（白注）
const ANTE_BASE = [300, 800, 2000, 5000, 11000, 20000, 35000, 50000]

// 8 个 ante 各分配一个 Boss（与原作机制一致）
const BOSS_BY_ANTE = [
  {
    ante: 1,
    badge: 'The\nHook',
    name: 'The Hook（鱼钩）',
    label: 'The Hook',
    targetMult: 2,
    rule: {
      key: 'DRAW_2_DISCARD',
      name: '鱼钩',
      description: '每打出一手牌后随机弃 2 张手牌。'
    }
  },
  {
    ante: 2,
    badge: 'The\nManacle',
    name: 'The Manacle（枷锁）',
    label: 'The Manacle',
    targetMult: 2,
    rule: {
      key: 'LOW_HAND_SIZE',
      name: '枷锁',
      description: '本回合手牌上限 -1（共 7 张）。'
    }
  },
  {
    ante: 3,
    badge: 'The\nPlant',
    name: 'The Plant（草芥）',
    label: 'The Plant',
    targetMult: 2,
    rule: {
      key: 'DEBUFF_FACE',
      name: '草芥',
      description: '所有面牌（J/Q/K）不再贡献筹码。'
    }
  },
  {
    ante: 4,
    badge: 'The\nGoad',
    name: 'The Goad（尖刺）',
    label: 'The Goad',
    targetMult: 2,
    rule: {
      key: 'DEBUFF_SPADE',
      name: '尖刺',
      description: '所有 ♠ 黑桃牌不再贡献筹码。'
    }
  },
  {
    ante: 5,
    badge: 'The\nPillar',
    name: 'The Pillar（柱子）',
    label: 'The Pillar',
    targetMult: 2,
    rule: {
      key: 'DEBUFF_PREVIOUS',
      name: '柱子',
      description: '本 ante 之前打出过的牌都被削弱，不再贡献筹码。'
    }
  },
  {
    ante: 6,
    badge: 'The\nNeedle',
    name: 'The Needle（针）',
    label: 'The Needle',
    targetMult: 1,
    rule: {
      key: 'ONE_HAND',
      name: '针',
      description: '本回合只能打出 1 手牌。'
    }
  },
  {
    ante: 7,
    badge: 'The\nOx',
    name: 'The Ox（公牛）',
    label: 'The Ox',
    targetMult: 2,
    rule: {
      key: 'MOST_HAND_PENALTY',
      name: '公牛',
      description: '若打出本 ante 出现最多的牌型，金钱清零。'
    }
  },
  {
    ante: 8,
    badge: 'The\nWall',
    name: 'The Wall（高墙）',
    label: 'The Wall',
    targetMult: 4,
    rule: {
      key: 'HIGH_TARGET',
      name: '高墙',
      description: '目标分数为基础的 4 倍，是终极考验。'
    }
  }
]

function createBlind({
  id,
  ante,
  round,
  type,
  name,
  label,
  badge,
  targetScore,
  reward,
  hands = 4,
  discards = 3,
  bossRule = null
}) {
  return {
    id,
    ante,
    round,
    type,
    name,
    label,
    badge,
    targetScore,
    reward,
    rewardText: `$${reward}`,
    hands,
    discards,
    handLevels: HAND_LEVELS,
    bossRule
  }
}

function buildAnte(ante) {
  const base = ANTE_BASE[ante - 1]
  const boss = BOSS_BY_ANTE[ante - 1]
  const roundOffset = (ante - 1) * 3

  return [
    createBlind({
      id: `ante-${ante}-small`,
      ante,
      round: roundOffset + 1,
      type: 'small',
      name: '小盲注',
      label: 'Small Blind',
      badge: 'Small\nBlind',
      targetScore: base, // 1×
      reward: 3
    }),
    createBlind({
      id: `ante-${ante}-big`,
      ante,
      round: roundOffset + 2,
      type: 'big',
      name: '大盲注',
      label: 'Big Blind',
      badge: 'Big\nBlind',
      targetScore: Math.round(base * 1.5),
      reward: 4
    }),
    createBlind({
      id: `ante-${ante}-boss`,
      ante,
      round: roundOffset + 3,
      type: 'boss',
      name: boss.name,
      label: boss.label,
      badge: boss.badge,
      targetScore: base * boss.targetMult,
      reward: 5,
      hands: boss.rule.key === 'ONE_HAND' ? 1 : 4,
      discards: 3,
      bossRule: boss.rule
    })
  ]
}

export const BLINDS = [
  ...buildAnte(1),
  ...buildAnte(2),
  ...buildAnte(3),
  ...buildAnte(4),
  ...buildAnte(5),
  ...buildAnte(6),
  ...buildAnte(7),
  ...buildAnte(8)
]

export const TOTAL_ANTES = ANTE_BASE.length
