<script setup>
import { ref, computed, onMounted } from 'vue'
import { createDeck, identifyHand } from './utils/poker.js'
import { calculateScore } from './utils/scoring.js'
import { BLINDS } from './config/blinds.js'
import { getRandomJoker, getRarityColor, getRarityBgColor } from './config/jokers.js'
import PlayingCard from './components/PlayingCard.vue'

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
const shopJokers = ref([])
const toastMessage = ref('')
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

  return anteBlinds.map((item, index) => {
    const previousBlind = index > 0 ? anteBlinds[index - 1] : null
    const isCompleted = completedBlindIds.value.includes(item.id)
    const isUnlocked = !previousBlind || completedBlindIds.value.includes(previousBlind.id)
    const isCurrent = item.id === blind.value?.id

    return {
      ...item,
      isCompleted,
      isUnlocked,
      isCurrent,
      canChallenge: isUnlocked && !isCompleted
    }
  })
})
const selectedCards = computed(() => hand.value.filter(card => card.selected))
const selectedScorePreview = computed(() => {
  if (selectedCards.value.length !== 5) {
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
  hand.value = drawCards(8)
}

function sortHandByRank() {
  hand.value = [...hand.value].sort((a, b) => a.rank - b.rank)
}

function sortHandBySuit() {
  const suitOrder = {
    hearts: 0,
    diamonds: 1,
    clubs: 2,
    spades: 3
  }

  hand.value = [...hand.value].sort((a, b) => {
    if (suitOrder[a.suit] !== suitOrder[b.suit]) {
      return suitOrder[a.suit] - suitOrder[b.suit]
    }
    return a.rank - b.rank
  })
}

function toggleCard(card) {
  card.selected = !card.selected
}

function playHand() {
  const selected = selectedCards.value

  if (selected.length === 0) {
    showToastMessage('请先选择牌', 'warning')
    return
  }

  if (selected.length !== 5) {
    showToastMessage(`请选择 5 张牌（当前已选 ${selected.length} 张）`, 'warning')
    return
  }

  const handType = identifyHand(selected)
  const score = calculateScore(selected, handType, ownedJokers.value)

  playedCards.value = [...selected]
  showPlayedCards.value = true
  totalScore.value += score
  handsLeft.value--
  lastPlayedHand.value = handType
  lastScore.value = score

  discardPile.value.push(...selected.map(card => ({ ...card, selected: false })))
  showToastMessage(`${handType.name} +${score} 分！`, 'success')

  setTimeout(() => {
    showPlayedCards.value = false
    playedCards.value = []

    if (totalScore.value >= blind.value.targetScore) {
      passBlind()
    } else if (handsLeft.value === 0) {
      failBlind()
    } else {
      dealCards()
    }
  }, 3000)
}

function discardCards() {
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
  hand.value.push(...drawCards(selected.length))
  discardsLeft.value--
  showToastMessage(`已弃掉 ${selected.length} 张牌`, 'info')
}

function passBlind() {
  money.value += blind.value.reward
  completedBlindIds.value = [...new Set([...completedBlindIds.value, blind.value.id])]
  showToastMessage(`通过 ${blind.value.name}！获得 $${blind.value.reward}`, 'success')

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

function restart() {
  setRunPhase(RUN_PHASES.SETUP)
  initGame()
}

onMounted(() => {
  setRunPhase(RUN_PHASES.SETUP)
})
</script>

<template>
  <div class="balatro-shell min-h-screen text-white">
    <Transition name="toast">
      <div
        v-if="showToast"
        class="fixed right-4 top-4 z-50 rounded-2xl border border-white/10 px-6 py-4 text-lg font-bold shadow-2xl"
        :class="{
          'bg-sky-500 text-slate-950': toastType === 'info',
          'bg-emerald-400 text-slate-950': toastType === 'success',
          'bg-rose-500 text-white': toastType === 'error',
          'bg-amber-400 text-slate-950': toastType === 'warning'
        }"
      >
        {{ toastMessage }}
      </div>
    </Transition>

    <div class="mx-auto flex min-h-screen max-w-[1600px] gap-4 p-4 lg:p-6">
      <aside class="hidden w-[260px] flex-col gap-4 xl:flex">
        <div class="pixel-panel px-4 py-5">
          <div class="blind-chip mb-4 text-center">{{ blind.label }}</div>
          <div class="rounded-[28px] border border-sky-400/40 bg-slate-950/70 px-4 py-4 shadow-inner shadow-black/40">
            <div class="mb-4 flex items-center gap-3">
              <div class="flex h-20 w-20 items-center justify-center rounded-full border-4 border-sky-300/50 bg-sky-950 text-center text-sm font-black uppercase leading-tight text-sky-100">
                {{ blind.badge }}
              </div>
              <div>
                <p class="text-sm font-semibold text-slate-300">至少得分</p>
                <p class="text-4xl font-black text-amber-300">{{ blind.targetScore }}</p>
                <p class="text-sm text-slate-400">奖励 {{ blind.rewardText }}</p>
              </div>
            </div>
            <div class="rounded-2xl bg-slate-900/80 px-4 py-3">
              <p class="text-sm font-semibold tracking-wide text-slate-300">回合分数</p>
              <p class="text-5xl font-black text-white">{{ totalScore }}</p>
            </div>
          </div>
        </div>

        <div class="pixel-panel px-4 py-5">
          <div class="score-track mb-4">
            <div class="chips-lane">{{ selectedScorePreview.handType ? selectedScorePreview.handType.chips : 0 }}</div>
            <div class="mult-lane">x{{ selectedScorePreview.handType ? selectedScorePreview.handType.mult : 0 }}</div>
          </div>

          <div v-if="lastPlayedHand" class="mb-4 rounded-[24px] border border-amber-300/30 bg-slate-950/70 px-4 py-4">
            <p class="text-sm text-slate-300">上一手</p>
            <p class="text-3xl font-black text-white">{{ lastPlayedHand.name }}</p>
            <p class="mt-2 text-4xl font-black text-amber-300">{{ lastScore }}</p>
          </div>

          <div class="grid grid-cols-2 gap-3 text-center">
            <div class="action-pill bg-rose-500 text-white">
              <span class="block text-xs font-bold tracking-[0.2em] text-white/80">出牌</span>
              <span class="text-4xl font-black">{{ handsLeft }}</span>
            </div>
            <div class="action-pill bg-slate-700 text-white">
              <span class="block text-xs font-bold tracking-[0.2em] text-white/80">弃牌</span>
              <span class="text-4xl font-black">{{ discardsLeft }}</span>
            </div>
            <div class="action-pill bg-amber-400 text-slate-950">
              <span class="block text-xs font-bold tracking-[0.2em] text-slate-900/70">金币</span>
              <span class="text-4xl font-black">${{ money }}</span>
            </div>
            <div class="action-pill bg-sky-500 text-white">
              <span class="block text-xs font-bold tracking-[0.2em] text-white/80">阶段</span>
              <span class="text-3xl font-black">{{ currentBlind + 1 }}/{{ BLINDS.length }}</span>
            </div>
          </div>

          <div class="mt-4 grid gap-3">
            <button @click="showHandInfo = true" class="menu-button bg-rose-500 hover:bg-rose-400">比赛信息</button>
            <button class="menu-button bg-amber-400 text-slate-950 hover:bg-amber-300">选项</button>
          </div>

          <div class="mt-4 rounded-[24px] border border-white/10 bg-slate-950/50 px-4 py-4">
            <p class="text-xs font-bold uppercase tracking-[0.3em] text-slate-400">Run Phase</p>
            <p class="mt-2 text-2xl font-black text-white">{{ runPhase }}</p>
          </div>
        </div>
      </aside>

      <main class="flex min-w-0 flex-1 flex-col gap-4">
        <div class="flex items-start justify-between gap-4">
          <div class="flex-1 rounded-[32px] border border-white/10 bg-slate-950/45 px-4 py-3 shadow-inner shadow-black/20 backdrop-blur-sm">
            <div class="mb-3 flex items-center justify-between">
              <p class="text-sm font-bold uppercase tracking-[0.35em] text-slate-300">Joker 区</p>
              <span class="text-sm font-bold text-slate-400">{{ ownedJokers.length }}/{{ maxJokers }}</span>
            </div>
            <div class="flex min-h-[136px] gap-3 overflow-x-auto pb-2">
              <div
                v-for="joker in ownedJokers"
                :key="joker.id"
                class="joker-card w-[120px] flex-shrink-0 rounded-[20px] border p-3 shadow-xl"
                :class="getRarityBgColor(joker.rarity)"
              >
                <div class="mb-2 flex items-center justify-between">
                  <span class="text-xs font-black tracking-[0.3em] text-white/70">JOKER</span>
                  <span class="text-xs font-bold" :class="getRarityColor(joker.rarity)">{{ joker.rarity }}</span>
                </div>
                <div class="mb-2 flex h-14 items-center justify-center rounded-2xl bg-black/20 text-4xl">🃏</div>
                <h3 class="text-sm font-black text-white">{{ joker.name }}</h3>
                <p class="mt-1 text-xs leading-relaxed text-white/80">{{ joker.description }}</p>
              </div>
              <div
                v-for="slot in maxJokers - ownedJokers.length"
                :key="`joker-slot-${slot}`"
                class="joker-empty w-[120px] flex-shrink-0 rounded-[20px] border-2 border-dashed border-white/15 bg-slate-900/30"
              >
                <span class="text-sm font-bold text-slate-500">空槽位</span>
              </div>
            </div>
          </div>

          <div class="hidden w-[140px] rounded-[32px] border border-white/10 bg-slate-950/45 p-4 shadow-inner shadow-black/20 backdrop-blur-sm lg:block">
            <div class="mb-3 text-center text-xs font-bold uppercase tracking-[0.35em] text-slate-300">消耗品</div>
            <div class="consumable-card mx-auto flex h-[180px] w-[110px] items-center justify-center rounded-[22px] border border-amber-200/25 bg-gradient-to-br from-amber-200/20 via-yellow-500/15 to-slate-950/50 shadow-lg">
              <div v-if="activeConsumable" class="px-3 text-center">
                <p class="text-xs font-black tracking-[0.25em] text-amber-200/70">TOWER</p>
                <p class="mt-3 text-xl font-black text-white">{{ activeConsumable.name }}</p>
              </div>
              <span v-else class="text-xs font-bold text-slate-500">暂无</span>
            </div>
            <p class="mt-3 text-center text-sm font-bold text-slate-400">1 / 2</p>
          </div>
        </div>

        <Transition name="fade" mode="out-in">
          <div v-if="isSetupPhase" key="setup" class="pixel-panel flex-1 px-6 py-8 lg:px-8">
            <p class="text-sm font-bold uppercase tracking-[0.35em] text-slate-300">Run Setup</p>
            <div class="mt-4 grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
              <div>
                <h2 class="text-5xl font-black text-white">开始一局新 Run</h2>
                <p class="mt-4 max-w-3xl text-lg leading-relaxed text-slate-300">
                  先选择最小可用的起始牌组与难度配置，然后进入盲注选择。
                </p>

                <div class="mt-8 grid gap-4">
                  <section class="rounded-[28px] border border-white/10 bg-slate-900/45 p-5">
                    <p class="text-xs font-black uppercase tracking-[0.3em] text-slate-400">Deck</p>
                    <div class="mt-4 grid gap-4">
                      <button
                        v-for="option in STARTER_DECK_OPTIONS"
                        :key="option.key"
                        @click="selectedDeckOption = option.key"
                        class="setup-option text-left"
                        :class="{ active: selectedDeckOption === option.key }"
                      >
                        <div class="flex items-center justify-between gap-3">
                          <h3 class="text-2xl font-black text-white">{{ option.name }}</h3>
                          <span class="text-sm font-bold text-slate-300">{{ selectedDeckOption === option.key ? '已选择' : '可选' }}</span>
                        </div>
                        <p class="mt-3 text-sm leading-relaxed text-slate-300">{{ option.description }}</p>
                      </button>
                    </div>
                  </section>

                  <section class="rounded-[28px] border border-white/10 bg-slate-900/45 p-5">
                    <p class="text-xs font-black uppercase tracking-[0.3em] text-slate-400">Difficulty</p>
                    <div class="mt-4 grid gap-4">
                      <button
                        v-for="option in DIFFICULTY_OPTIONS"
                        :key="option.key"
                        @click="selectedDifficultyOption = option.key"
                        class="setup-option text-left"
                        :class="{ active: selectedDifficultyOption === option.key }"
                      >
                        <div class="flex items-center justify-between gap-3">
                          <h3 class="text-2xl font-black text-white">{{ option.name }}</h3>
                          <span class="text-sm font-bold text-slate-300">起始金币 ${{ option.startingMoney }}</span>
                        </div>
                        <p class="mt-3 text-sm leading-relaxed text-slate-300">{{ option.description }}</p>
                      </button>
                    </div>
                  </section>
                </div>
              </div>

              <div class="rounded-[32px] border border-white/10 bg-slate-950/55 p-6 shadow-inner shadow-black/30">
                <p class="text-xs font-black uppercase tracking-[0.35em] text-slate-400">当前配置</p>
                <div class="mt-6 space-y-5">
                  <div class="rounded-[24px] border border-white/10 bg-slate-900/60 p-5">
                    <p class="text-sm font-bold text-slate-400">起始牌组</p>
                    <p class="mt-2 text-3xl font-black text-white">{{ selectedDeckConfig.name }}</p>
                    <p class="mt-2 text-sm text-slate-300">{{ selectedDeckConfig.description }}</p>
                  </div>
                  <div class="rounded-[24px] border border-white/10 bg-slate-900/60 p-5">
                    <p class="text-sm font-bold text-slate-400">难度</p>
                    <p class="mt-2 text-3xl font-black text-white">{{ selectedDifficultyConfig.name }}</p>
                    <p class="mt-2 text-sm text-slate-300">起始金币 ${{ selectedDifficultyConfig.startingMoney }}</p>
                  </div>
                </div>
                <button @click="startRun" class="mt-8 w-full rounded-[24px] bg-emerald-400 px-8 py-5 text-xl font-black text-slate-950 shadow-lg shadow-emerald-950/40 transition hover:bg-emerald-300">
                  开始游戏
                </button>
              </div>
            </div>
          </div>

          <div v-else-if="isBlindSelectPhase" key="blind-select" class="pixel-panel flex-1 px-6 py-8 lg:px-8">
            <div class="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p class="text-sm font-bold uppercase tracking-[0.35em] text-slate-300">Blind Select</p>
                <h2 class="mt-3 text-5xl font-black text-white">选择当前盲注</h2>
                <p class="mt-4 max-w-3xl text-lg leading-relaxed text-slate-300">
                  当前为 Ante {{ currentAnte }}。只开放本 Ante 的可挑战盲注，按顺序推进。
                </p>
              </div>
              <div class="rounded-[28px] border border-white/10 bg-slate-950/55 px-5 py-4 text-right">
                <p class="text-xs font-black uppercase tracking-[0.35em] text-slate-400">进度</p>
                <p class="mt-2 text-3xl font-black text-white">{{ currentBlindProgress }}</p>
                <p class="mt-1 text-sm text-slate-400">Ante {{ currentAnte }} 已完成</p>
              </div>
            </div>

            <div class="mt-8 grid gap-4 xl:grid-cols-3">
              <button
                v-for="blindOption in availableBlindOptions"
                :key="blindOption.id"
                @click="selectBlind(blindOption.id)"
                :disabled="!blindOption.canChallenge"
                class="blind-select-card text-left"
                :class="{
                  active: selectedBlindId === blindOption.id,
                  locked: !blindOption.canChallenge,
                  cleared: blindOption.isCompleted
                }"
              >
                <div class="flex items-start justify-between gap-4">
                  <div>
                    <p class="text-xs font-black uppercase tracking-[0.35em] text-slate-400">{{ blindOption.label }}</p>
                    <h3 class="mt-2 text-3xl font-black text-white">{{ blindOption.name }}</h3>
                  </div>
                  <span class="rounded-full border border-white/10 px-3 py-1 text-xs font-black uppercase text-slate-200">
                    {{ blindOption.type }}
                  </span>
                </div>

                <div class="mt-5 grid grid-cols-2 gap-3 text-center">
                  <div class="rounded-[20px] bg-slate-950/60 px-4 py-4">
                    <p class="text-xs font-bold uppercase tracking-[0.25em] text-slate-400">目标</p>
                    <p class="mt-2 text-3xl font-black text-amber-300">{{ blindOption.targetScore }}</p>
                  </div>
                  <div class="rounded-[20px] bg-slate-950/60 px-4 py-4">
                    <p class="text-xs font-bold uppercase tracking-[0.25em] text-slate-400">奖励</p>
                    <p class="mt-2 text-3xl font-black text-emerald-300">{{ blindOption.rewardText }}</p>
                  </div>
                </div>

                <div class="mt-5 rounded-[22px] border border-white/10 bg-slate-950/40 px-4 py-4 text-sm leading-relaxed text-slate-300">
                  <p>出牌 {{ blindOption.hands }} 次 · 弃牌 {{ blindOption.discards }} 次</p>
                  <p v-if="blindOption.bossRule" class="mt-2 text-amber-200">Boss 效果：{{ blindOption.bossRule.description }}</p>
                </div>

                <div class="mt-5 flex items-center justify-between text-sm font-bold">
                  <span v-if="blindOption.isCompleted" class="text-emerald-300">已通关</span>
                  <span v-else-if="blindOption.canChallenge" class="text-sky-300">点击开始挑战</span>
                  <span v-else class="text-slate-500">尚未解锁</span>
                  <span class="text-slate-400">Round {{ blindOption.round }}</span>
                </div>
              </button>
            </div>
          </div>

          <div v-else-if="isShopPhase" key="shop" class="shop-shell pixel-panel flex-1 px-6 py-6 lg:px-8">
            <div class="mb-6 flex flex-wrap items-center justify-between gap-4">
              <div>
                <p class="text-sm font-bold uppercase tracking-[0.35em] text-slate-300">Shop</p>
                <h2 class="text-4xl font-black text-white">商店</h2>
              </div>
              <div class="flex items-center gap-3">
                <div class="rounded-2xl border border-amber-300/20 bg-slate-950/60 px-4 py-3 text-2xl font-black text-amber-300">${{ money }}</div>
                <button @click="rerollShop" class="rounded-2xl bg-sky-500 px-5 py-3 text-sm font-black text-slate-950 shadow-lg shadow-sky-950/40 transition hover:bg-sky-400">刷新 $1</button>
              </div>
            </div>

            <div class="mb-8 grid grid-cols-1 gap-4 xl:grid-cols-3">
              <div
                v-for="joker in shopJokers"
                :key="joker.id"
                class="rounded-[28px] border border-white/10 bg-slate-900/75 p-5 shadow-2xl shadow-black/20"
              >
                <div class="mb-4 flex items-center justify-between">
                  <div>
                    <p class="text-xs font-black tracking-[0.35em] text-slate-400">JOKER</p>
                    <h3 class="text-2xl font-black text-white">{{ joker.name }}</h3>
                  </div>
                  <span class="rounded-full border border-white/10 px-3 py-1 text-xs font-black uppercase" :class="getRarityColor(joker.rarity)">
                    {{ joker.rarity }}
                  </span>
                </div>
                <div class="mb-4 flex h-28 items-center justify-center rounded-[24px] bg-gradient-to-br from-slate-800 via-slate-700 to-slate-900 text-5xl shadow-inner shadow-black/40">🃏</div>
                <p class="mb-6 min-h-[48px] text-sm leading-relaxed text-slate-200">{{ joker.description }}</p>
                <div class="flex items-center justify-between">
                  <span class="text-3xl font-black text-amber-300">${{ joker.price }}</span>
                  <button @click="buyJoker(joker)" class="rounded-2xl bg-amber-400 px-5 py-3 text-sm font-black text-slate-950 transition hover:bg-amber-300">购买</button>
                </div>
              </div>
            </div>

            <div class="mb-6">
              <div class="mb-3 flex items-center justify-between">
                <h3 class="text-2xl font-black text-white">我的构筑</h3>
                <span class="text-sm font-bold text-slate-400">{{ ownedJokers.length }}/{{ maxJokers }}</span>
              </div>
              <div v-if="ownedJokers.length === 0" class="rounded-[24px] border border-dashed border-white/10 bg-slate-900/30 px-6 py-10 text-center text-slate-500">
                还没有小丑牌
              </div>
              <div v-else class="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
                <div
                  v-for="joker in ownedJokers"
                  :key="joker.id"
                  class="rounded-[24px] border border-white/10 p-4 shadow-lg"
                  :class="getRarityBgColor(joker.rarity)"
                >
                  <p class="text-xs font-black tracking-[0.35em] text-white/70">JOKER</p>
                  <h4 class="mt-2 text-lg font-black text-white">{{ joker.name }}</h4>
                  <p class="mt-2 min-h-[56px] text-sm text-white/80">{{ joker.description }}</p>
                  <button @click="sellJoker(joker)" class="mt-4 w-full rounded-2xl bg-rose-500 px-3 py-2 text-sm font-black text-white transition hover:bg-rose-400">
                    出售 ${{ Math.floor(joker.price / 2) }}
                  </button>
                </div>
              </div>
            </div>

            <div class="flex justify-end">
              <button @click="closeShop" class="rounded-2xl bg-emerald-400 px-8 py-4 text-lg font-black text-slate-950 shadow-lg shadow-emerald-950/40 transition hover:bg-emerald-300">
                返回盲注选择
              </button>
            </div>
          </div>

          <div v-else-if="isGameOverPhase" key="gameover" class="pixel-panel flex-1 px-6 py-10 text-center lg:px-8">
            <p class="text-sm font-bold uppercase tracking-[0.35em] text-slate-300">Run End</p>
            <h2 class="mt-4 text-5xl font-black text-white">{{ gameWon ? '恭喜通关' : '游戏结束' }}</h2>
            <div class="mx-auto mt-8 grid max-w-3xl gap-4 md:grid-cols-3">
              <div class="result-card">
                <p class="result-label">最终分数</p>
                <p class="result-value">{{ totalScore }}</p>
              </div>
              <div class="result-card">
                <p class="result-label">获得金币</p>
                <p class="result-value text-amber-300">${{ money }}</p>
              </div>
              <div class="result-card">
                <p class="result-label">持有 Joker</p>
                <p class="result-value">{{ ownedJokers.length }}</p>
              </div>
            </div>
            <button @click="restart" class="mt-10 rounded-2xl bg-amber-400 px-10 py-4 text-xl font-black text-slate-950 shadow-lg shadow-amber-950/30 transition hover:bg-amber-300">
              重新开始
            </button>
          </div>

          <div v-else-if="isBattlePhase" key="game" class="flex flex-1 gap-4">
            <div class="flex min-w-0 flex-1 flex-col gap-4">
              <div class="relative flex-1 overflow-hidden rounded-[36px] border border-white/10 bg-[radial-gradient(circle_at_20%_20%,rgba(255,255,255,0.13),transparent_22%),radial-gradient(circle_at_80%_30%,rgba(255,255,255,0.1),transparent_18%),radial-gradient(circle_at_50%_85%,rgba(255,255,255,0.08),transparent_24%),linear-gradient(180deg,rgba(54,130,110,0.92),rgba(31,83,72,0.95))] shadow-[inset_0_0_0_2px_rgba(255,255,255,0.04),0_30px_80px_rgba(0,0,0,0.35)]">
                <div class="absolute inset-0 bg-[radial-gradient(circle_at_50%_40%,rgba(255,255,255,0.14),transparent_30%)] opacity-70"></div>
                <div class="relative z-10 flex h-full min-h-[720px] flex-col px-4 py-4 lg:px-8 lg:py-6">
                  <div class="flex items-start justify-between gap-4">
                    <div class="hidden lg:block rounded-[28px] border border-white/10 bg-slate-950/20 px-4 py-3 backdrop-blur-sm">
                      <p class="text-xs font-black uppercase tracking-[0.3em] text-white/70">当前盲注</p>
                      <h2 class="mt-2 text-4xl font-black text-white">{{ blind.name }}</h2>
                      <p class="mt-1 text-sm text-white/70">目标 {{ blind.targetScore }} · 奖励 {{ blind.rewardText }}</p>
                    </div>
                    <div class="ml-auto flex items-center gap-3 rounded-[28px] border border-white/10 bg-slate-950/20 px-4 py-3 backdrop-blur-sm">
                      <div class="text-right">
                        <p class="text-xs font-black uppercase tracking-[0.3em] text-white/60">牌堆</p>
                        <p class="text-2xl font-black text-white">{{ drawPileCount }}/52</p>
                      </div>
                      <div class="deck-stack"></div>
                    </div>
                  </div>

                  <div class="mt-6 grid flex-1 gap-4 xl:grid-cols-[1fr_240px]">
                    <div class="flex min-h-0 flex-col rounded-[34px] border border-white/6 bg-slate-950/10 p-4 backdrop-blur-[2px]">
                      <div class="mb-4 flex flex-wrap items-start justify-between gap-4">
                        <div>
                          <p class="text-sm font-bold uppercase tracking-[0.3em] text-white/70">得分预览</p>
                          <div class="mt-3 flex items-center gap-3">
                            <div class="score-pill bg-sky-500 text-slate-950">{{ selectedScorePreview.handType ? selectedScorePreview.handType.chips : 0 }}</div>
                            <div class="text-4xl font-black text-white">×</div>
                            <div class="score-pill bg-rose-500 text-white">{{ selectedScorePreview.handType ? selectedScorePreview.handType.mult : 0 }}</div>
                          </div>
                        </div>
                        <div class="text-right">
                          <p class="text-sm font-bold uppercase tracking-[0.3em] text-white/70">牌型</p>
                          <p class="mt-3 text-4xl font-black text-white">{{ selectedScorePreview.handType ? selectedScorePreview.handType.name : '未成型' }}</p>
                          <p class="mt-1 text-sm text-white/70">总分预览 {{ selectedScorePreview.score }}</p>
                        </div>
                      </div>

                      <div class="relative flex min-h-[240px] flex-1 items-center justify-center rounded-[28px] border border-white/8 bg-slate-950/12 px-4 py-8">
                        <div v-if="showPlayedCards" class="flex flex-wrap justify-center gap-4">
                          <div v-for="card in playedCards" :key="card.id" class="animate-fade-in-up">
                            <PlayingCard :card="card" :selected="false" compact />
                          </div>
                        </div>
                        <div v-else class="text-center">
                          <p class="text-sm font-bold uppercase tracking-[0.3em] text-white/55">Center Stage</p>
                          <p class="mt-3 text-5xl font-black text-white">{{ lastPlayedHand ? lastPlayedHand.name : '选择 5 张牌' }}</p>
                          <p class="mt-3 text-lg text-white/70">{{ lastPlayedHand ? `上一手得分 ${lastScore}` : '打出牌组后，这里会展示当前结算' }}</p>
                        </div>
                      </div>
                    </div>

                    <div class="hidden xl:flex flex-col gap-4">
                      <div class="rounded-[28px] border border-white/10 bg-slate-950/20 p-4 backdrop-blur-sm">
                        <p class="text-xs font-black uppercase tracking-[0.35em] text-white/60">弃牌堆</p>
                        <div class="mt-4 flex items-center justify-between">
                          <div class="discard-stack"></div>
                          <span class="text-3xl font-black text-white">{{ discardPileCount }}</span>
                        </div>
                      </div>
                      <div class="rounded-[28px] border border-white/10 bg-slate-950/20 p-4 backdrop-blur-sm">
                        <p class="text-xs font-black uppercase tracking-[0.35em] text-white/60">提示</p>
                        <p class="mt-4 text-sm leading-relaxed text-white/70">参考图里的核心节奏是：先看左侧目标，再在底部挑 5 张，顶部 Joker 提供构筑加成，右侧牌堆与消耗品负责额外决策。</p>
                      </div>
                    </div>
                  </div>

                  <div class="mt-6">
                    <div class="mb-4 flex flex-wrap items-center justify-between gap-4 rounded-[28px] border border-white/10 bg-slate-950/20 px-5 py-4 backdrop-blur-sm">
                      <div>
                        <p class="text-xs font-black uppercase tracking-[0.35em] text-white/60">手牌区</p>
                        <p class="mt-1 text-sm text-white/75">{{ selectedCards.length === 0 ? '点击牌选择' : `已选择 ${selectedCards.length} 张` }}</p>
                      </div>
                      <div class="flex flex-wrap gap-3">
                        <button @click="sortHandByRank" class="mini-button">按点数</button>
                        <button @click="sortHandBySuit" class="mini-button">按花色</button>
                        <button @click="discardCards" :disabled="discardsLeft === 0 || selectedCards.length === 0" class="main-button disabled:bg-slate-700/70 disabled:text-slate-400 bg-slate-800 hover:bg-slate-700">
                          弃牌
                        </button>
                        <button @click="playHand" :disabled="selectedCards.length !== 5" class="main-button disabled:bg-slate-700/70 disabled:text-slate-400 bg-amber-400 text-slate-950 hover:bg-amber-300">
                          出牌
                        </button>
                      </div>
                    </div>

                    <div class="relative mx-auto flex min-h-[250px] max-w-[860px] items-end justify-center overflow-visible px-8 pb-8 pt-4">
                      <PlayingCard
                        v-for="(card, index) in hand"
                        :key="card.id"
                        :card="card"
                        :selected="card.selected"
                        compact
                        @click="toggleCard(card)"
                        :style="{
                          transform: `translateX(${(index - (hand.length - 1) / 2) * 72}px) translateY(${Math.abs(index - (hand.length - 1) / 2) * 6}px) rotate(${(index - (hand.length - 1) / 2) * 4}deg)`,
                          zIndex: card.selected ? 80 : index + 1
                        }"
                        class="hand-card"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div v-else key="phase-skeleton" class="pixel-panel flex-1 px-6 py-10 lg:px-8">
            <p class="text-sm font-bold uppercase tracking-[0.35em] text-slate-300">Run Phase</p>
            <h2 class="mt-4 text-5xl font-black text-white">{{ runPhase }}</h2>
            <p class="mt-4 max-w-3xl text-lg leading-relaxed text-slate-300">
              这里先预留 2.0.0 后续页面骨架，当前只接通主 phase 切换，不展开 reward、pack 的具体内容。
            </p>
          </div>
        </Transition>
      </main>
    </div>

    <Transition name="fade">
      <div v-if="showHandInfo" class="fixed inset-0 z-40 flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm">
        <div class="info-modal w-full max-w-5xl rounded-[40px] border border-white/10 bg-[#32454c] p-6 shadow-[0_40px_120px_rgba(0,0,0,0.45)] lg:p-8">
          <div class="mb-6 flex flex-wrap items-center gap-3">
            <button class="tab-button active">牌型</button>
            <button class="tab-button">盲注</button>
            <button class="tab-button">优惠券</button>
            <button class="tab-button">赌注</button>
          </div>
          <div class="space-y-3">
            <div v-for="row in handInfoRows" :key="row.name" class="hand-info-row">
              <div class="hand-level">等级{{ row.level }}</div>
              <div class="hand-name">{{ row.name }}</div>
              <div class="hand-math">
                <span class="chips">{{ row.chips }}</span>
                <span class="mult">×{{ row.mult }}</span>
              </div>
              <div class="hand-played"># {{ row.played }}</div>
            </div>
          </div>
          <div class="mt-8 flex justify-center">
            <button @click="showHandInfo = false" class="rounded-[20px] bg-amber-400 px-16 py-4 text-2xl font-black text-slate-950 shadow-lg shadow-black/20 transition hover:bg-amber-300">返回</button>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.balatro-shell {
  background:
    radial-gradient(circle at top, rgba(255, 255, 255, 0.1), transparent 28%),
    linear-gradient(180deg, #081219 0%, #071019 100%);
}

.pixel-panel {
  border-radius: 34px;
  border: 1px solid rgba(94, 234, 212, 0.2);
  background: linear-gradient(180deg, rgba(28, 39, 52, 0.96) 0%, rgba(17, 24, 36, 0.96) 100%);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.04),
    0 18px 40px rgba(0, 0, 0, 0.35);
}

.blind-chip {
  border-radius: 18px;
  background: linear-gradient(180deg, #1f9cf0, #1678d4);
  padding: 14px 18px;
  font-size: 1.9rem;
  font-weight: 900;
  letter-spacing: 0.04em;
  color: white;
  box-shadow: inset 0 2px 0 rgba(255, 255, 255, 0.18);
}

.score-track {
  display: grid;
  grid-template-columns: 1fr 1fr;
  overflow: hidden;
  border-radius: 24px;
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.chips-lane,
.mult-lane {
  padding: 18px 12px;
  text-align: center;
  font-size: 2.6rem;
  font-weight: 900;
}

.chips-lane {
  background: linear-gradient(180deg, #21a6f0, #1f7ed2);
  color: #081019;
}

.mult-lane {
  background: linear-gradient(180deg, #ff5f58, #eb453d);
  color: white;
}

.action-pill {
  border-radius: 24px;
  padding: 16px 12px;
  box-shadow: inset 0 2px 0 rgba(255, 255, 255, 0.14);
}

.menu-button {
  border-radius: 24px;
  padding: 18px 20px;
  font-size: 1.4rem;
  font-weight: 900;
  transition: transform 0.2s ease, box-shadow 0.2s ease;
  box-shadow: 0 10px 20px rgba(0, 0, 0, 0.18);
}

.menu-button:hover {
  transform: translateY(-2px);
}

.setup-option,
.blind-select-card {
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 28px;
  background: rgba(15, 23, 42, 0.48);
  padding: 20px;
  transition: transform 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease, opacity 0.2s ease;
}

.setup-option:hover,
.blind-select-card:hover:not(:disabled) {
  transform: translateY(-2px);
}

.setup-option.active,
.blind-select-card.active {
  border-color: rgba(52, 211, 153, 0.7);
  box-shadow: 0 0 0 1px rgba(52, 211, 153, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.08);
}

.blind-select-card.cleared {
  border-color: rgba(52, 211, 153, 0.45);
}

.blind-select-card.locked {
  opacity: 0.55;
}

.blind-select-card:disabled {
  cursor: not-allowed;
}

.joker-card {
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.08), rgba(15, 23, 42, 0.35));
}

.joker-empty {
  display: flex;
  align-items: center;
  justify-content: center;
}

.consumable-card,
.deck-stack,
.discard-stack {
  position: relative;
}

.deck-stack::before,
.deck-stack::after,
.discard-stack::before,
.discard-stack::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 18px;
}

.deck-stack,
.discard-stack {
  width: 84px;
  height: 118px;
  border-radius: 18px;
  border: 2px solid rgba(255, 255, 255, 0.55);
  background:
    linear-gradient(135deg, rgba(255, 255, 255, 0.92), rgba(214, 228, 255, 0.95)),
    linear-gradient(145deg, #ef476f, #118ab2);
  box-shadow: 0 16px 30px rgba(0, 0, 0, 0.28);
}

.deck-stack::before,
.discard-stack::before {
  transform: translate(-10px, -8px);
  background: rgba(255, 255, 255, 0.45);
  z-index: -2;
}

.deck-stack::after,
.discard-stack::after {
  transform: translate(-5px, -4px);
  background: rgba(255, 255, 255, 0.7);
  z-index: -1;
}

.score-pill {
  min-width: 140px;
  border-radius: 24px;
  padding: 18px 18px;
  text-align: center;
  font-size: 2.6rem;
  font-weight: 900;
  box-shadow: inset 0 2px 0 rgba(255, 255, 255, 0.15);
}

.mini-button {
  border-radius: 18px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(245, 158, 11, 0.95);
  padding: 10px 18px;
  font-size: 0.95rem;
  font-weight: 900;
  color: #111827;
}

.main-button {
  border-radius: 18px;
  padding: 14px 26px;
  font-size: 1.1rem;
  font-weight: 900;
  transition: transform 0.2s ease, box-shadow 0.2s ease;
  box-shadow: 0 12px 22px rgba(0, 0, 0, 0.2);
}

.main-button:hover:not(:disabled) {
  transform: translateY(-1px);
}

.hand-card {
  position: absolute;
  left: 50%;
  bottom: 0;
  transform-origin: bottom center;
  margin-left: -55px;
}

.result-card {
  border-radius: 28px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(15, 23, 42, 0.5);
  padding: 24px 20px;
}

.result-label {
  font-size: 0.95rem;
  font-weight: 800;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.65);
}

.result-value {
  margin-top: 12px;
  font-size: 2.5rem;
  font-weight: 900;
  color: white;
}

.info-modal {
  background:
    linear-gradient(180deg, rgba(66, 92, 101, 0.98), rgba(42, 59, 66, 0.98));
}

.tab-button {
  border-radius: 18px;
  background: linear-gradient(180deg, #ff6257, #f04f47);
  padding: 14px 28px;
  font-size: 1.8rem;
  font-weight: 900;
  color: white;
  box-shadow: inset 0 2px 0 rgba(255, 255, 255, 0.18);
}

.tab-button.active {
  transform: translateY(-2px);
}

.hand-info-row {
  display: grid;
  grid-template-columns: 180px 1fr 240px 100px;
  align-items: center;
  gap: 18px;
  border-radius: 22px;
  background: rgba(235, 239, 245, 0.96);
  padding: 12px 18px;
  color: #1f2937;
  box-shadow: inset 0 -2px 0 rgba(148, 163, 184, 0.35);
}

.hand-level {
  border-radius: 999px;
  background: white;
  padding: 10px 16px;
  text-align: center;
  font-size: 1.8rem;
  font-weight: 900;
}

.hand-name {
  font-size: 2rem;
  font-weight: 900;
}

.hand-math {
  display: grid;
  grid-template-columns: 1fr 1fr;
  overflow: hidden;
  border-radius: 999px;
}

.hand-math .chips,
.hand-math .mult {
  padding: 10px 18px;
  text-align: center;
  font-size: 2rem;
  font-weight: 900;
}

.hand-math .chips {
  background: #1f9cf0;
  color: white;
}

.hand-math .mult {
  background: #ff5f58;
  color: white;
}

.hand-played {
  text-align: right;
  font-size: 2rem;
  font-weight: 900;
  color: #f59e0b;
}

.animate-fade-in-up {
  animation: fade-in-up 0.5s ease-out;
}

@keyframes fade-in-up {
  from {
    opacity: 0;
    transform: translateY(20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.toast-enter-active {
  animation: toast-in 0.3s ease-out;
}

.toast-leave-active {
  animation: toast-out 0.3s ease-in;
}

@keyframes toast-in {
  from {
    opacity: 0;
    transform: translateX(100%);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}

@keyframes toast-out {
  from {
    opacity: 1;
    transform: translateX(0);
  }
  to {
    opacity: 0;
    transform: translateX(100%);
  }
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

@media (max-width: 1279px) {
  .hand-card {
    margin-left: -48px;
  }
}

@media (max-width: 1024px) {
  .score-pill {
    min-width: 110px;
    font-size: 2rem;
  }

  .tab-button {
    font-size: 1.3rem;
    padding: 12px 20px;
  }

  .hand-info-row {
    grid-template-columns: 1fr;
    text-align: center;
  }

  .hand-played {
    text-align: center;
  }
}

@media (max-width: 768px) {
  .main-button {
    width: 100%;
  }

  .score-pill {
    min-width: 96px;
    font-size: 1.6rem;
  }

  .hand-card {
    margin-left: -42px;
  }
}
</style>

