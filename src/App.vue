<script setup>
import { ref, computed, onMounted, nextTick } from 'vue'
import { createDeck, identifyHand } from './utils/poker.js'
import { calculateScore, buildScoreSequence } from './utils/scoring.js'
import { BLINDS } from './config/blinds.js'
import { getRandomJoker } from './config/jokers.js'
import gsap from 'gsap'
import { burstParticles, burstJokerParticles, flyToTable, floatNumber } from './utils/animation.js'
import PlayingCard from './components/PlayingCard.vue'
import JokerCard from './components/JokerCard.vue'
import ScoreCounter from './components/ScoreCounter.vue'

const RUN_PHASES = {
  SETUP: 'setup',
  BLIND_SELECT: 'blind-select',
  BATTLE: 'battle',
  REWARD: 'reward',
  SHOP: 'shop',
  PACK: 'pack',
  GAME_OVER: 'game-over'
}

const STARTER_DECK_OPTIONS = [
  {
    key: 'standard-52',
    name: '标准牌组',
    description: '最小可用起始牌组，使用完整 52 张扑克牌。'
  }
]

const DIFFICULTY_OPTIONS = [
  {
    key: 'white-stake',
    name: '白注',
    description: '最小可用难度，占位配置，不附加额外惩罚。',
    startingMoney: 4
  }
]

const deck = ref([])
const discardPile = ref([])
const hand = ref([])
const currentBlind = ref(0)
const totalScore = ref(0)
const handsLeft = ref(4)
const discardsLeft = ref(3)
const money = ref(4)
const gameWon = ref(false)
const lastPlayedHand = ref(null)
const lastScore = ref(0)
const playedCards = ref([])
const showPlayedCards = ref(false)
const ownedJokers = ref([])
const maxJokers = 5
const HAND_SIZE = 8
const shopJokers = ref([])
const triggeredJokerIds = ref([])
const shimmeringJokerIds = ref([])
const handCardRefs = ref([])
const playedCardRefs = ref([])
const playTableRef = ref(null)
const showScoreFloat = ref(false)
const isResolvingHand = ref(false)
const battleChips = ref(0)
const battleMult = ref(1)
const toastMessage = ref('')

function setHandCardRef(el, index) {
  handCardRefs.value[index] = el
}
function setPlayedCardRef(el, index) {
  playedCardRefs.value[index] = el
}
function wait(ms) {
  return new Promise(r => setTimeout(r, ms))
}
const toastType = ref('info')
const showToast = ref(false)
const showHandInfo = ref(false)
const runPhase = ref(RUN_PHASES.SETUP)
const selectedDeckOption = ref(STARTER_DECK_OPTIONS[0].key)
const selectedDifficultyOption = ref(DIFFICULTY_OPTIONS[0].key)
const completedBlindIds = ref([])
const selectedBlindId = ref(null)

const selectedDeckConfig = computed(
  () => STARTER_DECK_OPTIONS.find(option => option.key === selectedDeckOption.value) ?? STARTER_DECK_OPTIONS[0]
)
const selectedDifficultyConfig = computed(
  () => DIFFICULTY_OPTIONS.find(option => option.key === selectedDifficultyOption.value) ?? DIFFICULTY_OPTIONS[0]
)
const blind = computed(() => BLINDS[currentBlind.value] ?? BLINDS[0])
const currentAnte = computed(() => blind.value?.ante ?? 1)
const currentAnteBlinds = computed(() => BLINDS.filter(item => item.ante === currentAnte.value))
const currentBlindProgress = computed(() => {
  const total = currentAnteBlinds.value.length
  const cleared = currentAnteBlinds.value.filter(item => completedBlindIds.value.includes(item.id)).length
  return `${cleared}/${total}`
})
const availableBlindOptions = computed(() => {
  const anteBlinds = currentAnteBlinds.value
  const nextChallengeBlind = anteBlinds.find(item => !completedBlindIds.value.includes(item.id))

  return anteBlinds.map((item, index) => {
    const previousBlind = index > 0 ? anteBlinds[index - 1] : null
    const isCompleted = completedBlindIds.value.includes(item.id)
    const isUnlocked = !previousBlind || completedBlindIds.value.includes(previousBlind.id)
    const isCurrent = item.id === blind.value?.id
    const canChallenge = isUnlocked && !isCompleted
    const isRecommended = nextChallengeBlind?.id === item.id && canChallenge
    const statusTone = isCompleted ? 'cleared' : canChallenge ? 'available' : 'locked'
    const statusLabel = isCompleted ? '已完成' : canChallenge ? '当前挑战' : '未解锁'
    const actionLabel = isCompleted
      ? '已通关'
      : isRecommended
        ? '下一步：点击开始'
        : canChallenge
          ? '可挑战'
          : '需先完成前一项'

    return {
      ...item,
      isCompleted,
      isUnlocked,
      isCurrent,
      canChallenge,
      isRecommended,
      statusTone,
      statusLabel,
      actionLabel
    }
  })
})
const selectedCards = computed(() => hand.value.filter(card => card.selected))
const selectedCardCount = computed(() => selectedCards.value.length)
const canPlaySelectedCards = computed(
  () => !isResolvingHand.value && selectedCardCount.value >= 1 && selectedCardCount.value <= 5
)
const displayChips = computed(() => {
  if (isResolvingHand.value) return battleChips.value
  return selectedScorePreview.value.handType?.chips ?? 0
})
const displayMult = computed(() => {
  if (isResolvingHand.value) return battleMult.value
  return selectedScorePreview.value.handType?.mult ?? 1
})
const selectionStatus = computed(() => {
  if (canPlaySelectedCards.value) {
    const preview = identifyHand(selectedCards.value)
    return {
      tone: 'ready',
      title: `${preview.name}`,
      description: `已选 ${selectedCardCount.value} 张，可直接出牌。`
    }
  }

  return {
    tone: 'idle',
    title: '尚未选择手牌',
    description: '从下方手牌中选择 1-5 张组成牌型。'
  }
})
const selectedScorePreview = computed(() => {
  if (selectedCardCount.value === 0) {
    return { handType: null, score: 0 }
  }

  const handType = identifyHand(selectedCards.value)
  return {
    handType,
    score: calculateScore(selectedCards.value, handType, ownedJokers.value)
  }
})
const drawPileCount = computed(() => deck.value.length)
const discardPileCount = computed(() => discardPile.value.length)
const activeConsumable = computed(() => ownedJokers.value[0] || null)
const jokerSlotsLeft = computed(() => Math.max(0, maxJokers - ownedJokers.value.length))
const buildSummary = computed(() => {
  const rarityCounter = ownedJokers.value.reduce((counter, joker) => {
    const rarity = joker.rarity || '普通'
    counter[rarity] = (counter[rarity] || 0) + 1
    return counter
  }, {})
  const sortedRarities = Object.entries(rarityCounter).sort((a, b) => b[1] - a[1])
  const dominantRarity = sortedRarities[0]

  return {
    totalSellValue: ownedJokers.value.reduce((sum, joker) => sum + Math.floor(joker.price / 2), 0),
    dominantRarityLabel: dominantRarity ? `${dominantRarity[0]} × ${dominantRarity[1]}` : '暂无构筑',
    rarityCount: sortedRarities.length
  }
})
const shopRefreshState = computed(() => {
  const canAfford = money.value >= 1

  return {
    disabled: !canAfford,
    label: canAfford ? '刷新' : '金币不足',
    detail: canAfford ? '消耗 $1 获得一组新商品' : '至少需要 $1 才能刷新商店'
  }
})
const shopOfferStates = computed(() =>
  shopJokers.value.map(joker => {
    const canAfford = money.value >= joker.price
    const hasSlot = ownedJokers.value.length < maxJokers
    let status = 'available'
    let statusLabel = '可购买'
    let detail = '满足条件，可直接加入构筑'

    if (!hasSlot) {
      status = 'full'
      statusLabel = '槽位已满'
      detail = '先出售一张 Joker，再回来购买'
    } else if (!canAfford) {
      status = 'insufficient'
      statusLabel = '金币不足'
      detail = `还差 $${joker.price - money.value} 才能购买`
    }

    return {
      ...joker,
      canAfford,
      hasSlot,
      canBuy: canAfford && hasSlot,
      status,
      statusLabel,
      detail
    }
  })
)
const shopSummaryCards = computed(() => [
  {
    label: '可用金币',
    value: `$${money.value}`,
    tone: 'gold',
    hint: money.value >= 1 ? '可刷新商店' : '无法刷新'
  },
  {
    label: 'Joker 槽位',
    value: `${ownedJokers.value.length}/${maxJokers}`,
    tone: jokerSlotsLeft.value > 0 ? 'mint' : 'slate',
    hint: jokerSlotsLeft.value > 0 ? `剩余 ${jokerSlotsLeft.value} 个空槽` : '需要出售后再购入'
  },
  {
    label: '可立即购买',
    value: `${shopOfferStates.value.filter(joker => joker.canBuy).length}/${shopOfferStates.value.length}`,
    tone: shopOfferStates.value.some(joker => joker.canBuy) ? 'sky' : 'rose',
    hint: shopOfferStates.value.some(joker => joker.canBuy) ? '优先查看高价收益牌' : '当前没有可买商品'
  }
])
const shopBuildHighlights = computed(() => [
  {
    label: '构筑规模',
    value: `${ownedJokers.value.length} 张`,
    hint: jokerSlotsLeft.value > 0 ? `还可再放 ${jokerSlotsLeft.value} 张` : '槽位已满'
  },
  {
    label: '主流稀有度',
    value: buildSummary.value.dominantRarityLabel,
    hint: buildSummary.value.rarityCount > 1 ? `共 ${buildSummary.value.rarityCount} 种稀有度` : '当前构筑较集中'
  },
  {
    label: '出售回收',
    value: `$${buildSummary.value.totalSellValue}`,
    hint: ownedJokers.value.length > 0 ? '全部卖出可回收的金币' : '暂无可出售牌'
  }
])
const handInfoRows = computed(() =>
  Object.values(BLINDS[0].handLevels || {}).map(row => ({
    ...row,
    played: row.name === lastPlayedHand.value?.name ? 1 : 0
  }))
)
const isSetupPhase = computed(() => runPhase.value === RUN_PHASES.SETUP)
const isBlindSelectPhase = computed(() => runPhase.value === RUN_PHASES.BLIND_SELECT)
const isBattlePhase = computed(() => runPhase.value === RUN_PHASES.BATTLE)
const isShopPhase = computed(() => runPhase.value === RUN_PHASES.SHOP)
const isGameOverPhase = computed(() => runPhase.value === RUN_PHASES.GAME_OVER)

function setRunPhase(phase) {
  runPhase.value = phase
}

function showBlindSelect() {
  setRunPhase(RUN_PHASES.BLIND_SELECT)
}

function showToastMessage(message, type = 'info') {
  toastMessage.value = message
  toastType.value = type
  showToast.value = true

  setTimeout(() => {
    showToast.value = false
  }, 3000)
}

function initDeckBySelection() {
  if (selectedDeckConfig.value.key === 'standard-52') {
    deck.value = createDeck()
    return
  }

  deck.value = createDeck()
}

function initGame() {
  initDeckBySelection()
  discardPile.value = []
  currentBlind.value = 0
  totalScore.value = 0
  handsLeft.value = BLINDS[0].hands ?? 4
  discardsLeft.value = BLINDS[0].discards ?? 3
  money.value = selectedDifficultyConfig.value.startingMoney
  gameWon.value = false
  ownedJokers.value = []
  playedCards.value = []
  showPlayedCards.value = false
  lastPlayedHand.value = null
  lastScore.value = 0
  shopJokers.value = []
  completedBlindIds.value = []
  selectedBlindId.value = null
  hand.value = []
  showBlindSelect()
}

function startRun() {
  initGame()
}

function selectBlind(blindId) {
  const targetBlindIndex = BLINDS.findIndex(item => item.id === blindId)

  if (targetBlindIndex === -1) {
    showToastMessage('未找到可挑战的盲注', 'error')
    return
  }

  const targetBlind = BLINDS[targetBlindIndex]
  const availableBlind = availableBlindOptions.value.find(item => item.id === blindId)

  if (!availableBlind?.canChallenge || targetBlind.ante !== currentAnte.value) {
    showToastMessage('该盲注当前不可选择', 'warning')
    return
  }

  currentBlind.value = targetBlindIndex
  selectedBlindId.value = blindId
  resetRound()
  dealCards()
  setRunPhase(RUN_PHASES.BATTLE)
}

function drawCards(count) {
  if (deck.value.length < count) {
    deck.value = createDeck()
  }

  return deck.value.splice(0, count).map(card => ({
    ...card,
    selected: false
  }))
}

function dealCards() {
  // 先发牌：新牌按发牌顺序进入手牌（不立即排序），等入场动画结束再触发理牌
  hand.value = drawCards(HAND_SIZE)
  scheduleReorderAfterDeal(HAND_SIZE)
}

const currentSortMode = ref('rank') // 'rank' | 'suit'

function getSortedHand(cards) {
  if (currentSortMode.value === 'suit') {
    const suitOrder = { hearts: 0, diamonds: 1, clubs: 2, spades: 3 }
    return [...cards].sort((a, b) => {
      if (suitOrder[a.suit] !== suitOrder[b.suit]) {
        return suitOrder[a.suit] - suitOrder[b.suit]
      }
      return a.rank - b.rank
    })
  }
  return [...cards].sort((a, b) => b.rank - a.rank)
}

/**
 * 用 FLIP 思路把手牌从当前 DOM 位置滑到排序后的目标位置：
 * 1) 记录每张牌的当前位置
 * 2) 应用排序（数据层重排）
 * 3) nextTick 后用 gsap.fromTo 让每张牌从旧位置滑动到新位置
 */
async function reorderHand() {
  const oldRectsById = new Map()
  hand.value.forEach((card, i) => {
    const el = handCardRefs.value[i]?.cardRef
    if (el) oldRectsById.set(card.id, el.getBoundingClientRect())
  })

  const sorted = getSortedHand(hand.value)
  const sameOrder = sorted.every((c, i) => c.id === hand.value[i]?.id)
  if (sameOrder) return
  hand.value = sorted

  await nextTick()

  hand.value.forEach((card, i) => {
    const el = handCardRefs.value[i]?.cardRef
    const oldRect = oldRectsById.get(card.id)
    if (!el || !oldRect) return
    const newRect = el.getBoundingClientRect()
    const dx = oldRect.left - newRect.left
    const dy = oldRect.top - newRect.top
    if (dx === 0 && dy === 0) return
    gsap.fromTo(
      el,
      { x: dx, y: dy },
      {
        x: 0,
        y: 0,
        duration: 0.45,
        ease: 'power3.out',
        clearProps: 'transform'
      }
    )
  })
}

/**
 * 估算新牌入场动画结束时间，然后触发理牌。
 * 入场 stagger 80ms / duration 550ms（见 PlayingCard onMounted）。
 */
function scheduleReorderAfterDeal(newCardCount) {
  const totalEnterMs = Math.max(0, newCardCount - 1) * 80 + 550 + 60
  setTimeout(() => {
    reorderHand()
  }, totalEnterMs)
}

function sortHandByRank() {
  currentSortMode.value = 'rank'
  reorderHand()
}

function sortHandBySuit() {
  currentSortMode.value = 'suit'
  reorderHand()
}

function refillHand() {
  const needed = HAND_SIZE - hand.value.length
  if (needed > 0) {
    hand.value.push(...drawCards(needed))
    scheduleReorderAfterDeal(needed)
  }
}

function toggleCard(card) {
  if (!card.selected && selectedCardCount.value >= 5) {
    showToastMessage('最多只能选择 5 张牌', 'warning')
    return
  }
  card.selected = !card.selected
}

async function playHand() {
  if (isResolvingHand.value) return
  const selected = selectedCards.value

  if (selected.length === 0) {
    showToastMessage('请先选择牌', 'warning')
    return
  }

  const handType = identifyHand(selected)
  const events = buildScoreSequence(selected, handType, ownedJokers.value)
  const finalEvent = events[events.length - 1]
  const selectedSnapshot = [...selected]
  const selectedIds = new Set(selectedSnapshot.map(c => c.id))

  isResolvingHand.value = true
  handsLeft.value--
  lastPlayedHand.value = handType
  lastScore.value = 0
  triggeredJokerIds.value = []
  showPlayedCards.value = true // 触发 banner 弹出

  // 1) 让已选牌就地 transform 飞到 .play-table 中央
  // 关键：不销毁 hand 中的 DOM，全程同一组元素承担"飞 → 计分 → 淡出"
  const targetEl = playTableRef.value
  const flyingByCardId = new Map()
  if (targetEl) {
    const orderedSelected = hand.value.filter(c => selectedIds.has(c.id))
    const cardWidth = 88 // PlayingCard.compact 宽度
    const gap = 12
    const totalWidth = orderedSelected.length * cardWidth + (orderedSelected.length - 1) * gap
    const startOffsetX = -totalWidth / 2 + cardWidth / 2

    hand.value.forEach((card, idx) => {
      if (!selectedIds.has(card.id)) return
      const el = handCardRefs.value[idx]?.cardRef
      if (!el) return
      flyingByCardId.set(card.id, el)

      const orderIdx = orderedSelected.findIndex(c => c.id === card.id)
      const src = el.getBoundingClientRect()
      const dst = targetEl.getBoundingClientRect()
      const dstCx = dst.left + dst.width / 2 + startOffsetX + orderIdx * (cardWidth + gap)
      const dstCy = dst.top + dst.height / 2
      const dx = dstCx - (src.left + src.width / 2)
      const dy = dstCy - (src.top + src.height / 2)

      el.style.zIndex = '120'
      gsap.to(el, {
        x: dx,
        y: dy,
        scale: 1.05,
        duration: 0.5,
        ease: 'power2.out',
        delay: orderIdx * 0.04
      })
    })
    await wait(540)
    targetEl.classList.add('impact')
    setTimeout(() => targetEl.classList.remove('impact'), 460)
  }

  // 2) 全屏 screen-shake
  const shell = document.querySelector('.balatro-shell')
  shell?.classList.add('screen-shake')
  setTimeout(() => shell?.classList.remove('screen-shake'), 360)

  // 3) base：HUD chips/mult 重置为牌型基础值
  const baseEvent = events[0]
  battleChips.value = baseEvent.chips
  battleMult.value = baseEvent.mult
  await wait(280)

  // 4) 逐张牌 / 逐张 Joker 检验
  for (let i = 1; i < events.length - 1; i++) {
    const ev = events[i]
    if (ev.type === 'card') {
      const el = flyingByCardId.get(ev.card.id)
      if (el) {
        gsap.to(el, {
          y: '-=18',
          duration: 0.18,
          ease: 'power2.out',
          yoyo: true,
          repeat: 1
        })
        floatNumber(el, `+${ev.chipsDelta}`, {
          color: '#5ac8fa',
          glow: 'rgba(90,200,250,0.85)',
          size: 24
        })
      }
      battleChips.value = ev.totalChips
      await wait(220)
    } else if (ev.type === 'joker') {
      const jokerId = ev.joker.id
      triggeredJokerIds.value = [...triggeredJokerIds.value, jokerId]
      const jokerEls = document.querySelectorAll('.joker-bar .joker-bar-row .joker-card:not(.empty)')
      const jokerEl = jokerEls[ev.jokerIndex]
      if (jokerEl) {
        burstJokerParticles(jokerEl, 8)
        if (ev.chipsDelta) {
          floatNumber(jokerEl, `+${ev.chipsDelta} 筹码`, {
            color: '#5ac8fa',
            glow: 'rgba(90,200,250,0.85)',
            size: 18
          })
        }
        if (ev.multDelta) {
          floatNumber(jokerEl, `+${ev.multDelta} 倍率`, {
            color: '#ff5e7e',
            glow: 'rgba(255,94,126,0.85)',
            size: 18
          })
        }
      }
      battleChips.value = ev.totalChips
      battleMult.value = ev.totalMult
      await wait(320)
      triggeredJokerIds.value = triggeredJokerIds.value.filter(id => id !== jokerId)
    }
  }

  // 5) 最终结算
  lastScore.value = finalEvent.score
  showScoreFloat.value = true
  totalScore.value += finalEvent.score
  showToastMessage(`${handType.name} +${finalEvent.score} 分！`, 'success')
  await wait(680)

  // 6) 飞行牌就地淡出（全程同一 DOM，不再有"突然出现"）
  flyingByCardId.forEach(el => {
    gsap.to(el, {
      opacity: 0,
      scale: 0.85,
      duration: 0.28,
      ease: 'power2.in'
    })
  })
  await wait(280)

  // 7) 真正从 hand 移除并清场
  discardPile.value.push(...selectedSnapshot.map(c => ({ ...c, selected: false })))
  hand.value = hand.value.filter(c => !selectedIds.has(c.id))
  showPlayedCards.value = false
  showScoreFloat.value = false
  isResolvingHand.value = false

  if (totalScore.value >= blind.value.targetScore) {
    passBlind()
  } else if (handsLeft.value === 0) {
    failBlind()
  } else {
    refillHand()
  }
}

function discardCards() {
  if (isResolvingHand.value) return
  const selected = selectedCards.value

  if (selected.length === 0) {
    showToastMessage('请选择要弃掉的牌', 'warning')
    return
  }

  if (discardsLeft.value === 0) {
    showToastMessage('弃牌次数已用完', 'error')
    return
  }

  discardPile.value.push(...selected.map(card => ({ ...card, selected: false })))
  hand.value = hand.value.filter(card => !card.selected)
  refillHand()
  discardsLeft.value--
  showToastMessage(`已弃掉 ${selected.length} 张牌`, 'info')
}

function passBlind() {
  money.value += blind.value.reward
  completedBlindIds.value = [...new Set([...completedBlindIds.value, blind.value.id])]
  showToastMessage(`通过 ${blind.value.name}！获得 $${blind.value.reward}`, 'success')

  if (blind.value.type === 'boss') {
    burstParticles(36)
  }

  if (currentBlind.value < BLINDS.length - 1) {
    setTimeout(() => {
      openShop()
    }, 1000)
  } else {
    setTimeout(() => {
      gameWon.value = true
      setRunPhase(RUN_PHASES.GAME_OVER)
    }, 1000)
  }
}

function failBlind() {
  showToastMessage(`未能通过 ${blind.value.name}`, 'error')
  setTimeout(() => {
    setRunPhase(RUN_PHASES.GAME_OVER)
  }, 1000)
}

function resetRound() {
  totalScore.value = 0
  handsLeft.value = blind.value.hands ?? 4
  discardsLeft.value = blind.value.discards ?? 3
  lastPlayedHand.value = null
  lastScore.value = 0
  playedCards.value = []
  showPlayedCards.value = false
  hand.value = []
  discardPile.value = []
}

function openShop() {
  shopJokers.value = []
  for (let i = 0; i < 3; i++) {
    shopJokers.value.push(getRandomJoker())
  }
  setRunPhase(RUN_PHASES.SHOP)
  triggerShopShimmer()
}

function triggerShopShimmer() {
  const ids = shopJokers.value
    .filter(j => j.rarity === 'rare' || j.rarity === 'legendary')
    .map(j => j.id)
  if (ids.length === 0) return

  nextTick(() => {
    shimmeringJokerIds.value = ids
    setTimeout(() => {
      shimmeringJokerIds.value = []
    }, 900)
  })
}

function rerollShop() {
  if (money.value < 1) {
    showToastMessage('至少需要 $1 才能刷新商店', 'warning')
    return
  }

  money.value -= 1
  openShop()
  showToastMessage('商店已刷新', 'info')
}

function closeShop() {
  const nextBlindIndex = currentBlind.value + 1
  const nextBlind = BLINDS[nextBlindIndex]

  if (!nextBlind) {
    gameWon.value = true
    setRunPhase(RUN_PHASES.GAME_OVER)
    return
  }

  currentBlind.value = nextBlindIndex
  selectedBlindId.value = null
  resetRound()
  showBlindSelect()
}

function buyJoker(joker) {
  if (money.value < joker.price) {
    showToastMessage('金币不足', 'error')
    return
  }

  if (ownedJokers.value.length >= maxJokers) {
    showToastMessage('小丑牌槽已满（最多 5 个）', 'warning')
    return
  }

  money.value -= joker.price
  ownedJokers.value.push({ ...joker })
  shopJokers.value = shopJokers.value.filter(item => item.id !== joker.id)
  showToastMessage(`购买了 ${joker.name}`, 'success')
}

function sellJoker(joker) {
  const sellPrice = Math.floor(joker.price / 2)
  money.value += sellPrice
  ownedJokers.value = ownedJokers.value.filter(item => item !== joker)
  showToastMessage(`出售了 ${joker.name}，获得 $${sellPrice}`, 'info')
}

const confirmDialog = ref({
  visible: false,
  title: '',
  message: '',
  confirmLabel: '确认',
  cancelLabel: '取消',
  tone: 'danger',
  onConfirm: null
})

function openConfirm(opts) {
  confirmDialog.value = {
    visible: true,
    title: opts.title || '请确认',
    message: opts.message || '',
    confirmLabel: opts.confirmLabel || '确认',
    cancelLabel: opts.cancelLabel || '取消',
    tone: opts.tone || 'danger',
    onConfirm: opts.onConfirm || null
  }
}

function closeConfirm() {
  confirmDialog.value.visible = false
  confirmDialog.value.onConfirm = null
}

function handleConfirm() {
  const fn = confirmDialog.value.onConfirm
  closeConfirm()
  if (typeof fn === 'function') fn()
}

function requestSellJoker(joker) {
  const sellPrice = Math.floor(joker.price / 2)
  openConfirm({
    title: '出售小丑牌？',
    message: `确认要出售「${joker.name}」吗？将获得 $${sellPrice}。`,
    confirmLabel: `出售 · $${sellPrice}`,
    cancelLabel: '再想想',
    tone: 'danger',
    onConfirm: () => sellJoker(joker)
  })
}

function restart() {
  setRunPhase(RUN_PHASES.SETUP)
  initGame()
}

onMounted(() => {
  setRunPhase(RUN_PHASES.SETUP)
})
</script>

<template>
  <div class="balatro-shell">
    <!-- 牌型弹出 banner -->
    <Transition name="hand-type-pop">
      <div
        v-if="showPlayedCards && lastPlayedHand"
        class="hand-type-banner"
      >
        {{ lastPlayedHand.name }}
      </div>
    </Transition>

    <!-- 得分飘字 -->
    <Transition name="score-float">
      <div
        v-if="showScoreFloat"
        class="score-float"
      >
        +{{ lastScore }}
      </div>
    </Transition>

    <!-- Toast -->
    <Transition name="toast">
      <div
        v-if="showToast"
        class="toast-bar"
        :class="{
          'toast--info': toastType === 'info',
          'toast--success': toastType === 'success',
          'toast--error': toastType === 'error',
          'toast--warning': toastType === 'warning'
        }"
      >
        {{ toastMessage }}
      </div>
    </Transition>

    <!-- Confirm Dialog -->
    <Transition name="fade">
      <div
        v-if="confirmDialog.visible"
        class="confirm-overlay"
        @click.self="closeConfirm"
      >
        <div class="confirm-panel" :class="`confirm-tone-${confirmDialog.tone}`">
          <h3 class="confirm-title">{{ confirmDialog.title }}</h3>
          <p class="confirm-message">{{ confirmDialog.message }}</p>
          <div class="confirm-actions">
            <button class="btn-ghost-lg" @click="closeConfirm">
              {{ confirmDialog.cancelLabel }}
            </button>
            <button
              class="btn-confirm"
              :class="`tone-${confirmDialog.tone}`"
              @click="handleConfirm"
            >
              {{ confirmDialog.confirmLabel }}
            </button>
          </div>
        </div>
      </div>
    </Transition>

    <Transition name="fade" mode="out-in">
      <!-- ========== SETUP ========== -->
      <div v-if="isSetupPhase" key="setup" class="phase-panel">
        <div class="setup-layout">
          <div class="setup-hero">
            <h1 class="setup-title">小丑牌</h1>
            <p class="setup-sub">扑克肉鸽 · 掌机风格致敬版</p>
            <div class="setup-cards">
              <span class="card-demo black tilt-l">
                <span class="card-corner tl">A<br>♠</span>
                <span class="card-pip">♠</span>
                <span class="card-corner br">A<br>♠</span>
              </span>
              <span class="card-demo red tilt-r">
                <span class="card-corner tl">K<br>♥</span>
                <span class="card-pip">♥</span>
                <span class="card-corner br">K<br>♥</span>
              </span>
            </div>
          </div>

          <div class="setup-options">
            <section class="setup-section">
              <p class="setup-section-label">牌组</p>
              <div class="setup-option-list">
                <button
                  v-for="option in STARTER_DECK_OPTIONS"
                  :key="option.key"
                  @click="selectedDeckOption = option.key"
                  class="setup-option-card"
                  :class="{ active: selectedDeckOption === option.key }"
                >
                  <div class="setup-option-head">
                    <h3>{{ option.name }}</h3>
                    <span class="setup-option-badge">{{ selectedDeckOption === option.key ? '已选择' : '可选' }}</span>
                  </div>
                  <p>{{ option.description }}</p>
                </button>
              </div>
            </section>

            <section class="setup-section">
              <p class="setup-section-label">难度</p>
              <div class="setup-option-list">
                <button
                  v-for="option in DIFFICULTY_OPTIONS"
                  :key="option.key"
                  @click="selectedDifficultyOption = option.key"
                  class="setup-option-card"
                  :class="{ active: selectedDifficultyOption === option.key }"
                >
                  <div class="setup-option-head">
                    <h3>{{ option.name }}</h3>
                    <span class="setup-option-badge">起始 ${{ option.startingMoney }}</span>
                  </div>
                  <p>{{ option.description }}</p>
                </button>
              </div>
            </section>

            <div class="setup-summary">
              <div class="setup-summary-item">
                <span class="setup-summary-label">起始牌组</span>
                <span class="setup-summary-value">{{ selectedDeckConfig.name }}</span>
              </div>
              <div class="setup-summary-item">
                <span class="setup-summary-label">难度</span>
                <span class="setup-summary-value">{{ selectedDifficultyConfig.name }}</span>
              </div>
              <div class="setup-summary-item">
                <span class="setup-summary-label">起始金币</span>
                <span class="setup-summary-value gold">${{ selectedDifficultyConfig.startingMoney }}</span>
              </div>
            </div>

            <button @click="startRun" class="btn-primary-lg">
              开始游戏
            </button>
          </div>
        </div>
      </div>

      <!-- ========== BLIND SELECT ========== -->
      <div v-else-if="isBlindSelectPhase" key="blind-select" class="phase-panel">
        <div class="blind-select-screen">
          <div class="blind-select-top">
            <div>
              <h2 class="blind-select-title">选择盲注</h2>
              <div class="blind-select-chips">
                <span class="chip-tag muted">底注 {{ currentAnte }}/8</span>
                <span class="chip-tag muted">第 {{ currentBlind + 1 }} 回合</span>
              </div>
            </div>
            <div class="blind-select-right">
              <span class="chip-tag gold">$ {{ money }}</span>
              <span class="blind-select-progress">{{ currentBlindProgress }} 已完成</span>
            </div>
          </div>

          <div class="blind-select-cards">
            <button
              v-for="blindOption in availableBlindOptions"
              :key="blindOption.id"
              @click="selectBlind(blindOption.id)"
              :disabled="!blindOption.canChallenge"
              class="blind-card"
              :class="{
                current: blindOption.isRecommended && blindOption.canChallenge,
                cleared: blindOption.isCompleted,
                locked: !blindOption.canChallenge,
                small: blindOption.type === 'small',
                big: blindOption.type === 'big',
                boss: blindOption.type === 'boss'
              }"
            >
              <span v-if="blindOption.isRecommended && blindOption.canChallenge" class="blind-card-tag">当前选择</span>
              <span v-else-if="blindOption.type === 'boss'" class="blind-card-tag boss-tag">头目</span>
              <div class="blind-card-icon">{{ blindOption.badge }}</div>
              <h3 class="blind-card-title">{{ blindOption.name }}</h3>
              <div class="blind-card-row">
                <span>目标分数</span>
                <span class="blind-card-val red">{{ blindOption.targetScore }}</span>
              </div>
              <div class="blind-card-row">
                <span>奖励</span>
                <span class="blind-card-val">{{ blindOption.rewardText }}</span>
              </div>
              <div class="blind-card-action">
                <span v-if="blindOption.isCompleted">已通关</span>
                <span v-else-if="blindOption.canChallenge" class="text-gold">{{ blindOption.actionLabel }}</span>
                <span v-else class="text-muted">需先完成前一项</span>
              </div>
            </button>
          </div>

          <div class="bottom-bar">
            <button
              v-for="blindOption in availableBlindOptions.filter(b => b.isRecommended && b.canChallenge)"
              :key="'btn-' + blindOption.id"
              @click="selectBlind(blindOption.id)"
              class="btn-primary"
            >
              选择盲注
            </button>
            <button class="btn-ghost">跳过盲注（$1）</button>
          </div>
        </div>
      </div>

      <!-- ========== SHOP ========== -->
      <div v-else-if="isShopPhase" key="shop" class="phase-panel">
        <div class="shop-screen">
          <div class="shop-top">
            <h2 class="shop-title">商店</h2>
            <div class="shop-top-right">
              <span class="chip-tag gold">$ {{ money }}</span>
              <button
                @click="rerollShop"
                :disabled="shopRefreshState.disabled"
                class="btn-ghost-sm"
                :class="{ disabled: shopRefreshState.disabled }"
              >
                刷新 · $1
              </button>
            </div>
          </div>

          <div class="shop-for-sale">
            <p class="shop-section-label">可购买</p>
            <div class="shop-items">
              <article
                v-for="joker in shopOfferStates"
                :key="joker.id"
                class="shop-item-card"
                :class="{ unavailable: !joker.canBuy }"
              >
                <div class="shop-item-art-wrap">
                  <JokerCard
                    :joker="joker"
                    size="shop"
                    :show-tooltip="false"
                    :shimmering="shimmeringJokerIds.includes(joker.id)"
                  />
                </div>
                <div class="shop-item-bottom">
                  <span class="shop-item-price">$ {{ joker.price }}</span>
                  <button
                    @click="buyJoker(joker)"
                    :disabled="!joker.canBuy"
                    class="btn-primary-sm"
                    :class="{ disabled: !joker.canBuy }"
                  >
                    {{ joker.canBuy ? '购买' : joker.statusLabel }}
                  </button>
                </div>
              </article>
            </div>
          </div>

          <div class="shop-owned">
            <p class="shop-section-label">已拥有 · {{ ownedJokers.length }} / {{ maxJokers }}（点击卡片可出售）</p>
            <div class="shop-owned-row">
              <JokerCard
                v-for="joker in ownedJokers"
                :key="joker.id"
                :joker="joker"
                size="normal"
                @click="requestSellJoker(joker)"
              />
              <JokerCard
                v-for="slot in maxJokers - ownedJokers.length"
                :key="'empty-' + slot"
                :empty="true"
                size="normal"
              />
            </div>
          </div>

          <div class="bottom-bar">
            <button
              @click="rerollShop"
              :disabled="shopRefreshState.disabled"
              class="btn-warn"
              :class="{ disabled: shopRefreshState.disabled }"
            >
              刷新
            </button>
            <button @click="closeShop" class="btn-success">下一回合</button>
          </div>
        </div>
      </div>

      <!-- ========== GAME OVER ========== -->
      <div v-else-if="isGameOverPhase" key="gameover" class="phase-panel gameover-bg">
        <div class="gameover-panel" :class="{ win: gameWon }">
          <h2 class="gameover-title" :class="{ win: gameWon }">
            {{ gameWon ? '挑战胜利' : '挑战失败' }}
          </h2>
          <p class="gameover-sub">
            {{ gameWon ? '击败全部 8 层底注' : `你未能击败 ${blind.name}` }}
          </p>
          <div class="gameover-stats">
            <div class="gameover-stat">
              <span class="gameover-stat-label">{{ gameWon ? '最终得分' : '得分' }}</span>
              <span class="gameover-stat-value" :class="{ gold: gameWon, red: !gameWon }">{{ totalScore }}</span>
            </div>
            <div class="gameover-stat">
              <span class="gameover-stat-label">获得金币</span>
              <span class="gameover-stat-value gold">${{ money }}</span>
            </div>
            <div class="gameover-stat">
              <span class="gameover-stat-label">持有 Joker</span>
              <span class="gameover-stat-value">{{ ownedJokers.length }}</span>
            </div>
          </div>
          <div class="gameover-actions">
            <button @click="restart" class="btn-primary-lg">重新开局</button>
            <button @click="restart" class="btn-ghost-lg">返回主菜单</button>
          </div>
        </div>
      </div>

      <!-- ========== BATTLE ========== -->
      <div v-else-if="isBattlePhase" key="game" class="battle-screen">
        <!-- 顶部 HUD -->
        <div class="hud">
          <!-- 盲注信息 -->
          <div class="hud-blind">
            <div class="hud-blind-icon">{{ blind.badge }}</div>
            <div>
              <span class="hud-blind-name">{{ blind.name }}</span>
              <span class="hud-blind-req">{{ blind.targetScore }}</span>
            </div>
          </div>

          <!-- 筹码 × 倍率 -->
          <div class="hud-score" :class="{ 'is-resolving': isResolvingHand }">
            <div class="hud-score-col chips">
              <span class="hud-score-val chips-color">
                <ScoreCounter :value="displayChips" :duration="0.4" />
              </span>
              <span class="hud-score-label">筹码</span>
            </div>
            <div class="hud-score-col mult">
              <span class="hud-score-val mult-color">×<ScoreCounter :value="displayMult" :duration="0.4" /></span>
              <span class="hud-score-label">倍率</span>
            </div>
          </div>

          <!-- 元数据 -->
          <div class="hud-meta">
            <div class="hud-meta-item">
              <span class="hud-meta-label">回合</span>
              <span class="hud-meta-val">{{ currentBlind + 1 }}</span>
            </div>
            <div class="hud-meta-item">
              <span class="hud-meta-label">底注</span>
              <span class="hud-meta-val">{{ currentAnte }}/8</span>
            </div>
            <div class="hud-meta-item">
              <span class="hud-meta-label">手数</span>
              <span class="hud-meta-val green">{{ handsLeft }}</span>
            </div>
            <div class="hud-meta-item">
              <span class="hud-meta-label">弃牌</span>
              <span class="hud-meta-val blue">{{ discardsLeft }}</span>
            </div>
            <div class="hud-meta-item">
              <span class="hud-meta-label">牌库</span>
              <span class="hud-meta-val">{{ drawPileCount }}/52</span>
            </div>
            <div class="hud-meta-item">
              <span class="hud-meta-label">金钱</span>
              <span class="hud-meta-val">${{ money }}</span>
            </div>
          </div>

          <!-- 进度条 -->
          <div class="hud-progress">
            <div class="hud-progress-bar">
              <div
                class="hud-progress-fill"
                :style="{ width: `${Math.min((totalScore / blind.targetScore) * 100, 100)}%` }"
              ></div>
            </div>
            <span class="hud-progress-text"><ScoreCounter :value="totalScore" /> / {{ blind.targetScore }}</span>
          </div>
        </div>

        <!-- Joker 区 -->
        <div class="joker-bar">
          <div class="joker-bar-label">JOKERS · {{ ownedJokers.length }}/{{ maxJokers }}</div>
          <div class="joker-bar-row">
            <JokerCard
              v-for="joker in ownedJokers"
              :key="joker.id"
              :joker="joker"
              size="normal"
              :triggering="triggeredJokerIds.includes(joker.id)"
            />
            <JokerCard
              v-for="slot in maxJokers - ownedJokers.length"
              :key="'joker-slot-' + slot"
              :empty="true"
              size="normal"
            />
          </div>
        </div>

        <!-- 出牌预览区 -->
        <div class="play-table" ref="playTableRef">
          <div v-if="isResolvingHand" class="play-table-scored">
            <p class="play-table-hand-type">★ {{ lastPlayedHand?.name }} ★</p>
            <p v-if="lastScore > 0" class="play-table-score">+ <ScoreCounter :value="lastScore" /></p>
          </div>
          <div v-else-if="selectedCardCount > 0" class="play-table-preview">
            <p class="play-table-placeholder">已选 {{ selectedCardCount }} 张 · 等待出牌</p>
            <span class="chip-tag purple" v-if="selectedScorePreview.handType">
              {{ selectedScorePreview.handType.name }} · ≈{{ selectedScorePreview.score }}
            </span>
          </div>
          <div v-else class="play-table-idle">
            <span class="play-table-placeholder">选择手牌组成牌型（1-5 张）</span>
          </div>
        </div>

        <!-- 手牌扇区 -->
        <div class="hand-area">
          <div class="hand-area-header">
            <span class="hand-area-label">
              手牌 · 已选 {{ selectedCardCount }} 张
              <span v-if="selectionStatus.tone === 'ready'" class="hand-ready">· {{ selectionStatus.title }}</span>
            </span>
            <div class="hand-area-sorts">
              <button @click="sortHandByRank" class="btn-sort">按点数</button>
              <button @click="sortHandBySuit" class="btn-sort">按花色</button>
              <button @click="showHandInfo = true" class="btn-sort info">比赛信息</button>
            </div>
          </div>
          <div class="hand-fan">
            <PlayingCard
              v-for="(card, index) in hand"
              :ref="(el) => setHandCardRef(el, index)"
              :key="card.id"
              :card="card"
              :selected="card.selected"
              :selectable="true"
              :deal-index="index"
              compact
              @click="toggleCard(card)"
              :style="{
                marginLeft: index === 0 ? '0' : '-8px',
                transform: card.selected ? 'translateY(-28px)' : 'none',
                zIndex: card.selected ? 60 : index
              }"
              class="hand-card"
            />
          </div>
        </div>

        <!-- 底部操作栏 -->
        <div class="bottom-bar">
          <button
            @click="playHand"
            :disabled="!canPlaySelectedCards"
            class="btn-primary"
            :class="{ disabled: !canPlaySelectedCards }"
          >
            {{ canPlaySelectedCards ? '出牌' : '请先选牌' }}
          </button>
          <button
            @click="discardCards"
            :disabled="isResolvingHand || discardsLeft === 0 || selectedCardCount === 0"
            class="btn-warn"
            :class="{ disabled: isResolvingHand || discardsLeft === 0 || selectedCardCount === 0 }"
          >
            弃牌
          </button>
          <button class="btn-ghost">取消选择</button>
        </div>
      </div>

      <!-- ========== FALLBACK ========== -->
      <div v-else key="phase-skeleton" class="phase-panel phase-skeleton">
        <p class="skeleton-eyebrow">Run Phase</p>
        <h2 class="skeleton-title">{{ runPhase }}</h2>
        <p class="skeleton-desc">
          这里先预留后续页面骨架，当前只接通主 phase 切换。
        </p>
      </div>
    </Transition>

    <!-- 比赛信息弹窗 -->
    <Transition name="fade">
      <div v-if="showHandInfo" class="modal-overlay" @click.self="showHandInfo = false">
        <div class="info-modal">
          <div class="info-modal-tabs">
            <button class="info-tab active">牌型</button>
            <button class="info-tab">盲注</button>
            <button class="info-tab">优惠券</button>
            <button class="info-tab">赌注</button>
          </div>
          <div class="info-modal-rows">
            <div v-for="row in handInfoRows" :key="row.name" class="info-row">
              <div class="info-row-level">等级{{ row.level }}</div>
              <div class="info-row-name">{{ row.name }}</div>
              <div class="info-row-math">
                <span class="info-row-chips">{{ row.chips }}</span>
                <span class="info-row-mult">×{{ row.mult }}</span>
              </div>
              <div class="info-row-played"># {{ row.played }}</div>
            </div>
          </div>
          <button @click="showHandInfo = false" class="btn-primary-lg info-modal-close">返回</button>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
/* =====================================================
   CSS Variables & Global
   ===================================================== */
.balatro-shell {
  --bg: #0e0716;
  --panel: #1f1130;
  --panel-2: #2a1a3f;
  --line: #43295e;
  --text: #f6efe1;
  --text-dim: #c9b8d8;
  --muted: #8e7aa8;
  --gold: #ffd166;
  --money: #ffc857;
  --red: #ef476f;
  --blue: #38c5ff;
  --green: #62d18b;
  --purple: #b388ff;
  --chips: #5ac8fa;
  --mult: #ff5e7e;

  height: 100vh;
  overflow: hidden;
  background:
    radial-gradient(1200px 600px at 20% 0%, rgba(122, 80, 188, 0.20), transparent 60%),
    radial-gradient(900px 600px at 100% 30%, rgba(56, 197, 255, 0.10), transparent 60%),
    linear-gradient(180deg, #0a0512 0%, #0e0716 50%, #0a0512 100%);
  color: var(--text);
  font-family: 'Inter', system-ui, -apple-system, 'PingFang SC', sans-serif;
}

/* =====================================================
   Toast
   ===================================================== */
.toast-bar {
  position: fixed;
  right: 16px;
  top: 16px;
  z-index: 50;
  border-radius: 14px;
  border: 1px solid rgba(255,255,255,.1);
  padding: 12px 24px;
  font-size: 1rem;
  font-weight: 700;
  box-shadow: 0 12px 24px rgba(0,0,0,.45);
}
.toast--info    { background: #38c5ff; color: #0a1a24; }
.toast--success { background: #62d18b; color: #0a1a24; }
.toast--error   { background: #ef476f; color: #fff; }
.toast--warning { background: #ffc857; color: #2a1700; }

/* =====================================================
   Confirm Dialog
   ===================================================== */
.confirm-overlay {
  position: fixed;
  inset: 0;
  z-index: 100;
  background: rgba(8, 4, 16, 0.78);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}
.confirm-panel {
  width: min(440px, 92vw);
  background: linear-gradient(180deg, var(--panel) 0%, #160a23 100%);
  border: 2px solid var(--line);
  border-radius: 18px;
  padding: 28px 26px 22px;
  box-shadow: 0 24px 40px rgba(0, 0, 0, 0.6);
}
.confirm-tone-danger {
  border-color: rgba(239, 71, 111, 0.55);
  box-shadow: 0 24px 40px rgba(0, 0, 0, 0.6), 0 0 24px rgba(239, 71, 111, 0.2);
}
.confirm-tone-warning {
  border-color: rgba(255, 200, 87, 0.5);
  box-shadow: 0 24px 40px rgba(0, 0, 0, 0.6), 0 0 24px rgba(255, 200, 87, 0.2);
}
.confirm-title {
  font-size: 20px;
  font-weight: 900;
  letter-spacing: 1px;
  color: var(--gold);
  margin-bottom: 10px;
}
.confirm-tone-danger .confirm-title { color: var(--red); }
.confirm-message {
  font-size: 14px;
  line-height: 1.55;
  color: var(--text-dim);
  margin-bottom: 22px;
}
.confirm-actions {
  display: flex;
  gap: 12px;
  justify-content: flex-end;
}
.btn-confirm {
  padding: 10px 22px;
  border-radius: 12px;
  font-size: 14px;
  font-weight: 900;
  letter-spacing: 1px;
  border: none;
  cursor: pointer;
  color: #fff;
  box-shadow: 0 4px 0 rgba(0, 0, 0, 0.45);
  transition: transform 0.12s ease, filter 0.12s ease;
}
.btn-confirm:hover { transform: translateY(-1px); filter: brightness(1.08); }
.btn-confirm:active { transform: translateY(2px); box-shadow: 0 1px 0 rgba(0, 0, 0, 0.45); }
.btn-confirm.tone-danger {
  background: linear-gradient(180deg, #ff6b8b, #d6234a);
}
.btn-confirm.tone-warning {
  background: linear-gradient(180deg, #ffd166, #f08a3a);
  color: #2a1700;
}

/* =====================================================
   Phase Panel (shared)
   ===================================================== */
.phase-panel {
  height: 100%;
  overflow-y: auto;
  padding: 28px;
}

/* =====================================================
   Buttons (shared)
   ===================================================== */
.btn-primary,
.btn-primary-lg,
.btn-primary-sm,
.btn-ghost,
.btn-ghost-lg,
.btn-ghost-sm,
.btn-warn,
.btn-success,
.btn-sort {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border-radius: 12px;
  font-weight: 900;
  letter-spacing: 1px;
  border: 2px solid transparent;
  cursor: pointer;
  user-select: none;
  transition: transform 0.15s ease, box-shadow 0.15s ease, opacity 0.15s ease;
}
.btn-primary:hover:not(.disabled),
.btn-primary-lg:hover:not(.disabled),
.btn-primary-sm:hover:not(.disabled),
.btn-ghost:hover:not(.disabled),
.btn-ghost-lg:hover:not(.disabled),
.btn-ghost-sm:hover:not(.disabled),
.btn-warn:hover:not(.disabled),
.btn-success:hover:not(.disabled) {
  transform: translateY(-2px);
}
.btn-primary.disabled,
.btn-primary-lg.disabled,
.btn-primary-sm.disabled,
.btn-warn.disabled,
.btn-ghost.disabled {
  opacity: 0.45;
  cursor: not-allowed;
  transform: none;
}

.btn-primary,
.btn-primary-lg,
.btn-primary-sm {
  background: linear-gradient(180deg, #ff5e7e, #d6234a);
  color: #fff;
  border-color: rgba(255,255,255,.18);
  box-shadow: 0 4px 0 rgba(0,0,0,.4);
}
.btn-primary    { padding: 12px 24px; font-size: 13px; }
.btn-primary-lg { padding: 16px 32px; font-size: 15px; border-radius: 14px; }
.btn-primary-sm { padding: 8px 16px; font-size: 11px; border-radius: 10px; }

.btn-ghost,
.btn-ghost-lg,
.btn-ghost-sm {
  background: rgba(255,255,255,.05);
  color: var(--text);
  border-color: rgba(255,255,255,.12);
  box-shadow: 0 4px 0 rgba(0,0,0,.4);
}
.btn-ghost    { padding: 12px 24px; font-size: 13px; }
.btn-ghost-lg { padding: 16px 32px; font-size: 15px; border-radius: 14px; }
.btn-ghost-sm { padding: 8px 16px; font-size: 11px; border-radius: 10px; }

.btn-warn {
  background: linear-gradient(180deg, #ffc857, #e3a03c);
  color: #2a1700;
  border-color: rgba(255,255,255,.18);
  box-shadow: 0 4px 0 rgba(0,0,0,.4);
  padding: 12px 24px;
  font-size: 13px;
}

.btn-success {
  background: linear-gradient(180deg, #62d18b, #2a9d57);
  color: #fff;
  border-color: rgba(255,255,255,.18);
  box-shadow: 0 4px 0 rgba(0,0,0,.4);
  padding: 12px 24px;
  font-size: 13px;
}

.btn-sort {
  background: rgba(255,255,255,.08);
  color: var(--text-dim);
  border: 1px solid rgba(255,255,255,.1);
  box-shadow: none;
  padding: 6px 12px;
  font-size: 11px;
  border-radius: 8px;
}
.btn-sort:hover { color: #fff; border-color: var(--purple); }
.btn-sort.info { background: rgba(239,71,111,.15); color: var(--red); border-color: rgba(239,71,111,.3); }

/* =====================================================
   Chip Tags
   ===================================================== */
.chip-tag {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 900;
  letter-spacing: 1px;
}
.chip-tag.gold   { background: rgba(255,209,102,.15); color: var(--gold); border: 1px solid rgba(255,209,102,.3); }
.chip-tag.muted  { background: rgba(255,255,255,.05); color: var(--muted); border: 1px solid rgba(255,255,255,.08); }
.chip-tag.purple { background: rgba(179,136,255,.15); color: var(--purple); border: 1px solid rgba(179,136,255,.3); }

/* =====================================================
   Phase Skeleton (fallback)
   ===================================================== */
.phase-skeleton {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
}
.skeleton-eyebrow {
  font-size: 13px;
  font-weight: 900;
  letter-spacing: 0.35em;
  text-transform: uppercase;
  color: var(--muted);
}
.skeleton-title {
  margin-top: 16px;
  font-size: 3rem;
  font-weight: 900;
}
.skeleton-desc {
  margin-top: 16px;
  max-width: 720px;
  font-size: 1.1rem;
  line-height: 1.6;
  color: var(--text-dim);
}

/* =====================================================
   SETUP
   ===================================================== */
.setup-layout {
  max-width: 960px;
  margin: 0 auto;
  display: grid;
  gap: 40px;
}
.setup-hero {
  text-align: center;
}
.setup-title {
  font-size: 48px;
  font-weight: 900;
  color: var(--gold);
  letter-spacing: 6px;
  text-shadow: 0 4px 0 #6b3fa0, 0 0 24px rgba(255,209,102,.4);
}
.setup-sub {
  margin-top: 10px;
  font-size: 18px;
  color: var(--text-dim);
}
.setup-cards {
  margin-top: 32px;
  display: flex;
  justify-content: center;
  gap: 16px;
}

/* Demo cards */
.card-demo {
  width: 88px;
  height: 124px;
  border-radius: 12px;
  background: #fff8ec;
  color: #2a1c33;
  box-shadow: 0 6px 0 rgba(0,0,0,.45), 0 0 0 2px #2a1c33;
  position: relative;
  flex-shrink: 0;
}
.card-demo .card-corner {
  position: absolute;
  font-size: 22px;
  line-height: 1;
  text-align: center;
}
.card-demo .card-corner.tl { top: 8px; left: 8px; }
.card-demo .card-corner.br { bottom: 8px; right: 8px; transform: rotate(180deg); }
.card-demo .card-pip {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  font-size: 50px;
}
.card-demo.red, .card-demo.red .card-pip { color: #d6234a; }
.card-demo.black, .card-demo.black .card-pip { color: #1a1024; }
.card-demo.tilt-l { transform: rotate(-3deg); }
.card-demo.tilt-r { transform: rotate(3deg); }

.setup-options {
  display: grid;
  gap: 24px;
}
.setup-section {
  border: 1px solid rgba(255,255,255,.08);
  border-radius: 22px;
  background: var(--panel);
  padding: 24px;
}
.setup-section-label {
  font-size: 12px;
  font-weight: 900;
  letter-spacing: 0.3em;
  text-transform: uppercase;
  color: var(--muted);
  margin-bottom: 16px;
}
.setup-option-list {
  display: grid;
  gap: 12px;
}
.setup-option-card {
  width: 100%;
  text-align: left;
  border: 1px solid rgba(255,255,255,.08);
  border-radius: 18px;
  background: rgba(255,255,255,.03);
  padding: 18px;
  color: var(--text);
  cursor: pointer;
  transition: border-color 0.2s ease, background 0.2s ease;
}
.setup-option-card:hover {
  border-color: var(--purple);
}
.setup-option-card.active {
  border-color: rgba(179,136,255,.5);
  background: rgba(179,136,255,.1);
}
.setup-option-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.setup-option-head h3 {
  font-size: 1.4rem;
  font-weight: 900;
}
.setup-option-badge {
  font-size: 11px;
  font-weight: 700;
  color: var(--text-dim);
}
.setup-option-card p {
  margin-top: 10px;
  font-size: 0.9rem;
  line-height: 1.5;
  color: var(--text-dim);
}

.setup-summary {
  display: grid;
  gap: 10px;
  border: 1px solid rgba(255,255,255,.08);
  border-radius: 18px;
  background: var(--panel);
  padding: 20px;
}
.setup-summary-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.setup-summary-label {
  font-size: 13px;
  font-weight: 700;
  color: var(--text-dim);
}
.setup-summary-value {
  font-size: 1.2rem;
  font-weight: 900;
}
.setup-summary-value.gold { color: var(--gold); }

/* =====================================================
   BLIND SELECT
   ===================================================== */
.blind-select-screen {
  max-width: 960px;
  margin: 0 auto;
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 24px;
}
.blind-select-top {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
}
.blind-select-title {
  font-size: 1.5rem;
  font-weight: 900;
  color: var(--gold);
  letter-spacing: 2px;
}
.blind-select-chips {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}
.blind-select-right {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
}
.blind-select-progress {
  font-size: 12px;
  color: var(--muted);
}
.blind-select-cards {
  flex: 1;
  display: flex;
  gap: 20px;
  align-items: flex-end;
  justify-content: center;
  min-height: 0;
  overflow-x: auto;
  padding-bottom: 8px;
}

/* Blind card */
.blind-card {
  width: 220px;
  border-radius: 18px;
  background: linear-gradient(180deg, var(--panel-2), #190d28);
  border: 3px solid var(--line);
  padding: 20px 16px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  position: relative;
  color: var(--text);
  cursor: pointer;
  transition: transform 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease;
  box-shadow: 0 12px 24px rgba(0,0,0,.45);
  flex-shrink: 0;
}
.blind-card:hover:not(.locked):not(.cleared) {
  transform: translateY(-4px);
}
.blind-card.current {
  transform: translateY(-18px);
  border-color: var(--gold);
  box-shadow: 0 18px 0 rgba(0,0,0,.45), 0 0 0 4px rgba(255,209,102,.25);
}
.blind-card.cleared {
  border-color: rgba(98,209,139,.4);
  background: linear-gradient(180deg, #1a2a1f, #0d1a12);
  opacity: 0.7;
}
.blind-card.locked {
  opacity: 0.45;
  cursor: not-allowed;
}
.blind-card-icon {
  width: 80px;
  height: 80px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  font-size: 18px;
  font-weight: 900;
  color: #fff;
  border: 4px solid #1a1024;
  box-shadow: inset 0 -6px 0 rgba(0,0,0,.3);
}
.blind-card.small .blind-card-icon  { background: radial-gradient(circle at 30% 30%, #62d18b, #1a7c45); }
.blind-card.big .blind-card-icon    { background: radial-gradient(circle at 30% 30%, #ffc857, #c47b15); }
.blind-card.boss .blind-card-icon   { background: radial-gradient(circle at 30% 30%, #ef476f, #7a1f37); }
.blind-card-title {
  font-size: 14px;
  font-weight: 900;
  letter-spacing: 1px;
}
.blind-card-row {
  width: 100%;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 8px;
  border-top: 1px dashed rgba(255,255,255,.12);
  font-size: 11px;
  font-weight: 900;
  color: var(--text-dim);
}
.blind-card-val {
  font-size: 20px;
  font-weight: 900;
  color: var(--gold);
}
.blind-card-val.red { color: var(--red); }
.blind-card-tag {
  position: absolute;
  top: -12px;
  background: var(--gold);
  color: #2a1700;
  font-size: 10px;
  font-weight: 900;
  padding: 4px 12px;
  border-radius: 999px;
  border: 2px solid #2a1700;
  letter-spacing: 1px;
}
.blind-card-tag.boss-tag {
  background: var(--red);
  color: #fff;
  border-color: #1a1024;
}
.blind-card-action {
  margin-top: 8px;
  font-size: 12px;
  font-weight: 900;
  letter-spacing: 1px;
}
.text-gold { color: var(--gold); }
.text-muted { color: var(--muted); }

/* =====================================================
   SHOP
   ===================================================== */
.shop-screen {
  max-width: 1000px;
  margin: 0 auto;
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 20px;
}
.shop-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.shop-title {
  font-size: 1.5rem;
  font-weight: 900;
  color: var(--gold);
  letter-spacing: 2px;
}
.shop-top-right {
  display: flex;
  align-items: center;
  gap: 12px;
}
.shop-section-label {
  font-size: 12px;
  font-weight: 900;
  letter-spacing: 1px;
  color: var(--text-dim);
  margin-bottom: 12px;
}
.shop-for-sale {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}
.shop-items {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 18px;
}
.shop-item-card {
  border-radius: 18px;
  background: linear-gradient(180deg, var(--panel-2), #14091f);
  border: 2px solid var(--line);
  padding: 20px 16px 16px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  box-shadow: 0 12px 24px rgba(0,0,0,.45);
}
.shop-item-card.unavailable {
  opacity: 0.6;
}
.shop-item-art-wrap {
  display: flex;
  justify-content: center;
  width: 100%;
  padding: 4px 0;
}
.shop-item-bottom {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
  margin-top: auto;
  gap: 12px;
}
.shop-item-price {
  font-size: 14px;
  font-weight: 900;
  color: var(--money);
}
.shop-owned {
  min-height: 0;
}
.shop-owned-row {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  align-items: center;
}
/* shop-owned-row 现在直接渲染 JokerCard 组件，旧的 .joker-card-sm 已废弃 */

/* =====================================================
   GAME OVER
   ===================================================== */
.gameover-bg {
  display: flex;
  align-items: center;
  justify-content: center;
  background:
    radial-gradient(60% 60% at 50% 40%, rgba(239,71,111,.18), transparent 70%),
    linear-gradient(180deg, #1a0610, #0a0210);
}
.gameover-panel {
  width: min(520px, 90%);
  background: linear-gradient(180deg, var(--panel), #0d0617);
  border: 3px solid rgba(239,71,111,.5);
  border-radius: 24px;
  padding: 36px 28px;
  text-align: center;
  box-shadow: 0 12px 24px rgba(0,0,0,.45);
}
.gameover-panel.win {
  border-color: rgba(255,209,102,.55);
}
.gameover-title {
  font-size: 36px;
  font-weight: 900;
  color: var(--red);
  letter-spacing: 4px;
  text-shadow: 0 4px 0 #6b1f33;
}
.gameover-title.win {
  color: var(--gold);
  text-shadow: 0 4px 0 #6b3fa0, 0 0 24px rgba(255,209,102,.6);
}
.gameover-sub {
  margin-top: 10px;
  font-size: 16px;
  color: var(--text-dim);
}
.gameover-stats {
  display: flex;
  justify-content: space-around;
  gap: 16px;
  margin: 28px 0;
}
.gameover-stat {
  text-align: center;
}
.gameover-stat-label {
  display: block;
  font-size: 10px;
  font-weight: 900;
  letter-spacing: 1px;
  color: var(--text-dim);
  margin-bottom: 6px;
}
.gameover-stat-value {
  font-size: 32px;
  font-weight: 900;
}
.gameover-stat-value.gold { color: var(--gold); }
.gameover-stat-value.red  { color: var(--red); }
.gameover-actions {
  display: flex;
  gap: 12px;
  justify-content: center;
  flex-wrap: wrap;
  margin-top: 24px;
}

/* =====================================================
   BATTLE SCREEN
   ===================================================== */
.battle-screen {
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px 16px 8px;
  background:
    radial-gradient(80% 60% at 50% 20%, rgba(122,80,188,.18), transparent 60%),
    radial-gradient(60% 60% at 50% 110%, rgba(56,197,255,.08), transparent 60%),
    linear-gradient(180deg, #1a0c2c, #0e0617 90%);
}

/* HUD */
.hud {
  display: grid;
  grid-template-columns: 200px 1fr 220px;
  gap: 10px;
  align-items: stretch;
}
.hud-blind {
  background: linear-gradient(180deg, var(--panel-2), #1a0f24);
  border: 2px solid var(--line);
  border-radius: 14px;
  padding: 10px 14px;
  display: flex;
  gap: 10px;
  align-items: center;
}
.hud-blind-icon {
  width: 38px;
  height: 38px;
  border-radius: 10px;
  background: linear-gradient(180deg, #ef476f, #8a1f3a);
  border: 2px solid #1a1024;
  display: grid;
  place-items: center;
  font-size: 14px;
  font-weight: 900;
  color: #fff;
  flex-shrink: 0;
}
.hud-blind-name {
  display: block;
  font-size: 12px;
  font-weight: 900;
  letter-spacing: 1px;
}
.hud-blind-req {
  display: block;
  font-size: 24px;
  font-weight: 900;
  color: var(--red);
  line-height: 1;
  margin-top: 2px;
}

.hud-score {
  background: #0a0414;
  border: 2px solid var(--line);
  border-radius: 14px;
  padding: 8px 12px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}
.hud-score-col {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: linear-gradient(180deg, var(--panel), #14091f);
  border-radius: 10px;
  padding: 6px;
}
.hud-score-col.chips { box-shadow: inset 0 0 0 2px rgba(90,200,250,.45); }
.hud-score-col.mult  { box-shadow: inset 0 0 0 2px rgba(255,94,126,.55); }
.hud-score-val {
  font-size: 28px;
  font-weight: 900;
  line-height: 1;
}
.chips-color { color: var(--chips); }
.mult-color  { color: var(--mult); }
.hud-score-label {
  font-size: 10px;
  font-weight: 900;
  color: var(--text-dim);
  margin-top: 2px;
  letter-spacing: 1px;
}

.hud-meta {
  background: linear-gradient(180deg, var(--panel-2), #1a0f24);
  border: 2px solid var(--line);
  border-radius: 14px;
  padding: 8px 12px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px 10px;
  align-content: center;
}
.hud-meta-item {
  display: flex;
  flex-direction: column;
}
.hud-meta-label {
  font-size: 9px;
  font-weight: 900;
  color: var(--text-dim);
  letter-spacing: 1px;
}
.hud-meta-val {
  font-size: 18px;
  font-weight: 900;
  color: var(--gold);
  line-height: 1;
}
.hud-meta-val.green { color: var(--green); }
.hud-meta-val.blue  { color: var(--blue); }

/* HUD progress */
.hud-progress {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  gap: 10px;
}
.hud-progress-bar {
  flex: 1;
  height: 10px;
  border-radius: 999px;
  background: rgba(0,0,0,.3);
  overflow: hidden;
}
.hud-progress-fill {
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, #f59e0b, #fde68a);
  box-shadow: 0 0 12px rgba(245,158,11,.4);
  transition: width 0.3s ease;
}
.hud-progress-text {
  font-size: 11px;
  font-weight: 700;
  color: var(--text-dim);
  white-space: nowrap;
}

/* Joker bar (战斗中持有的 Joker) */
.joker-bar {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px 12px;
  background:
    linear-gradient(180deg, #1f1130 0%, #14091f 60%, #0a0414 100%);
  border: 2px solid var(--line);
  border-radius: 14px;
  align-self: flex-start;
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,.06),
    0 4px 12px rgba(0,0,0,.4);
}
.joker-bar-label {
  font-family: 'Press Start 2P', monospace;
  font-size: 8px;
  color: var(--gold);
  letter-spacing: 2px;
  text-shadow: 1px 1px 0 #000;
}
.joker-bar-row {
  display: flex;
  gap: 8px;
  align-items: flex-end;
}

/* Play table */
.play-table {
  flex: 1;
  min-height: 0;
  display: grid;
  place-items: center;
  border: 2px dashed rgba(255,255,255,.08);
  border-radius: 18px;
  background: linear-gradient(180deg, rgba(56,197,255,.04), rgba(255,94,126,.04));
  text-align: center;
  overflow-y: auto;
}
.play-table-idle,
.play-table-preview,
.play-table-scored {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 16px;
}
.play-table-placeholder {
  font-size: 13px;
  font-weight: 900;
  color: var(--muted);
  letter-spacing: 1px;
}
.play-table-cards {
  display: flex;
  gap: 10px;
  justify-content: center;
  flex-wrap: wrap;
}
.play-table-hand-type {
  font-size: 20px;
  font-weight: 900;
  color: var(--gold);
  letter-spacing: 2px;
}
.play-table-score {
  font-size: 48px;
  font-weight: 900;
  color: var(--gold);
  text-shadow: 0 0 20px rgba(255,209,102,.5);
}

/* Hand area */
.hand-area {
  min-height: 0;
}
.hand-area-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
}
.hand-area-label {
  font-size: 11px;
  font-weight: 900;
  color: var(--text-dim);
  letter-spacing: 1px;
}
.hand-ready {
  color: var(--green);
  margin-left: 6px;
}
.hand-building {
  color: var(--blue);
  margin-left: 6px;
}
.hand-area-sorts {
  display: flex;
  gap: 6px;
}
.hand-fan {
  display: flex;
  justify-content: center;
  align-items: flex-end;
  padding: 12px 0 4px;
  min-height: 150px;
}
.hand-card {
  flex-shrink: 0;
  transition: transform 0.18s ease, margin 0.18s ease;
}

/* Bottom bar */
.bottom-bar {
  display: flex;
  gap: 12px;
  justify-content: center;
  padding: 4px 0;
}

/* =====================================================
   INFO MODAL
   ===================================================== */
.modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 40;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0,0,0,.55);
  padding: 16px;
  backdrop-filter: blur(8px);
}
.info-modal {
  width: 100%;
  max-width: 800px;
  border-radius: 24px;
  border: 3px solid var(--line);
  background: linear-gradient(180deg, var(--panel), #0d0617);
  padding: 28px;
  box-shadow: 0 40px 120px rgba(0,0,0,.45);
}
.info-modal-tabs {
  display: flex;
  gap: 8px;
  margin-bottom: 24px;
  flex-wrap: wrap;
}
.info-tab {
  border-radius: 14px;
  background: linear-gradient(180deg, #ef476f, #8a1f3a);
  padding: 12px 24px;
  font-size: 1rem;
  font-weight: 900;
  color: #fff;
  border: none;
  cursor: pointer;
  box-shadow: inset 0 2px 0 rgba(255,255,255,.18);
  letter-spacing: 1px;
}
.info-tab.active {
  transform: translateY(-2px);
}
.info-modal-rows {
  display: grid;
  gap: 10px;
  max-height: 50vh;
  overflow-y: auto;
}
.info-row {
  display: grid;
  grid-template-columns: 120px 1fr 180px 80px;
  align-items: center;
  gap: 14px;
  border-radius: 16px;
  background: rgba(255,255,255,.04);
  padding: 12px 16px;
  border: 1px solid rgba(255,255,255,.06);
}
.info-row-level {
  border-radius: 999px;
  background: var(--panel-2);
  padding: 8px 14px;
  text-align: center;
  font-size: 1.1rem;
  font-weight: 900;
}
.info-row-name {
  font-size: 1.2rem;
  font-weight: 900;
}
.info-row-math {
  display: grid;
  grid-template-columns: 1fr 1fr;
  overflow: hidden;
  border-radius: 999px;
}
.info-row-chips {
  background: #1f9cf0;
  color: #fff;
  padding: 8px 14px;
  text-align: center;
  font-size: 1.1rem;
  font-weight: 900;
}
.info-row-mult {
  background: #ff5f58;
  color: #fff;
  padding: 8px 14px;
  text-align: center;
  font-size: 1.1rem;
  font-weight: 900;
}
.info-row-played {
  text-align: right;
  font-size: 1.1rem;
  font-weight: 900;
  color: var(--money);
}
.info-modal-close {
  display: block;
  margin: 24px auto 0;
}

/* =====================================================
   Transitions
   ===================================================== */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.toast-enter-active {
  animation: toast-in 0.3s ease-out;
}
.toast-leave-active {
  animation: toast-out 0.3s ease-in;
}
@keyframes toast-in {
  from { opacity: 0; transform: translateX(100%); }
  to   { opacity: 1; transform: translateX(0); }
}
@keyframes toast-out {
  from { opacity: 1; transform: translateX(0); }
  to   { opacity: 0; transform: translateX(100%); }
}

/* =====================================================
   Responsive
   ===================================================== */
@media (max-width: 1024px) {
  .hud {
    grid-template-columns: 1fr 1fr;
  }
  .hud-meta {
    grid-column: 1 / -1;
  }
  .hud-progress {
    grid-column: 1 / -1;
  }
  .joker-bar {
    display: none;
  }
  .bl ind-select-cards {
    flex-wrap: wrap;
  }
  .shop-items {
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  }
}

@media (max-width: 640px) {
  .phase-panel {
    padding: 16px;
  }
  .hud {
    grid-template-columns: 1fr;
  }
  .battle-screen {
    padding: 8px;
    gap: 6px;
  }
  .bottom-bar {
    flex-wrap: wrap;
  }
  .blind-select-cards {
    flex-direction: column;
    align-items: center;
  }
  .gameover-stats {
    flex-direction: column;
    gap: 12px;
  }
  .setup-hero .setup-title {
    font-size: 32px;
  }
  .info-row {
    grid-template-columns: 1fr;
    text-align: center;
  }
  .info-row-played {
    text-align: center;
  }
}
</style>
