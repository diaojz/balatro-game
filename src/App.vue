<script setup>
import { ref, computed, onMounted } from 'vue'
import { createDeck, identifyHand, getCardDisplay, getSuitSymbol, getSuitColor } from './utils/poker.js'
import { calculateScore } from './utils/scoring.js'
import { BLINDS } from './config/blinds.js'

// 游戏状态
const deck = ref([])
const hand = ref([])
const currentBlind = ref(0)
const totalScore = ref(0)
const handsLeft = ref(4)
const money = ref(0)
const gameOver = ref(false)
const gameWon = ref(false)
const lastPlayedHand = ref(null)
const lastScore = ref(0)

// 当前盲注信息
const blind = computed(() => BLINDS[currentBlind.value])

// 选中的牌
const selectedCards = computed(() => hand.value.filter(c => c.selected))

// 初始化游戏
function initGame() {
  deck.value = createDeck()
  currentBlind.value = 0
  totalScore.value = 0
  handsLeft.value = 4
  money.value = 0
  gameOver.value = false
  gameWon.value = false
  dealCards()
}

// 发牌
function dealCards() {
  hand.value = deck.value.slice(0, 8).map(card => ({
    ...card,
    selected: false
  }))
  deck.value = deck.value.slice(8)

  // 如果牌不够，重新洗牌
  if (deck.value.length < 8) {
    deck.value = createDeck()
  }
}

// 切换选中状态
function toggleCard(card) {
  card.selected = !card.selected
}

// 出牌
function playHand() {
  const selected = selectedCards.value

  if (selected.length !== 5) {
    alert('请选择 5 张牌')
    return
  }

  // 识别牌型
  const handType = identifyHand(selected)

  // 计算得分
  const score = calculateScore(selected, handType)

  // 更新状态
  totalScore.value += score
  handsLeft.value--
  lastPlayedHand.value = handType
  lastScore.value = score

  // 检查是否通过盲注
  if (totalScore.value >= blind.value.targetScore) {
    passBlind()
  } else if (handsLeft.value === 0) {
    failBlind()
  } else {
    // 重新发牌
    dealCards()
  }
}

// 通过盲注
function passBlind() {
  money.value += blind.value.reward

  if (currentBlind.value < BLINDS.length - 1) {
    currentBlind.value++
    resetRound()
    dealCards()
  } else {
    // 游戏胜利
    gameWon.value = true
    gameOver.value = true
  }
}

// 失败盲注
function failBlind() {
  gameOver.value = true
}

// 重置回合
function resetRound() {
  totalScore.value = 0
  handsLeft.value = 4
  lastPlayedHand.value = null
  lastScore.value = 0
}

// 重新开始
function restart() {
  initGame()
}

// 组件挂载时初始化游戏
onMounted(() => {
  initGame()
})
</script>

<template>
  <div class="min-h-screen bg-gradient-to-br from-purple-900 via-blue-900 to-indigo-900 p-4 md:p-8">
    <div class="max-w-6xl mx-auto">
      <!-- 游戏标题 -->
      <h1 class="text-4xl md:text-5xl font-bold text-white text-center mb-8">
        🃏 Balatro (小丑牌)
      </h1>

      <!-- 游戏结束界面 -->
      <div v-if="gameOver" class="bg-white/10 backdrop-blur-md rounded-xl p-8 text-center">
        <h2 class="text-3xl font-bold text-white mb-4">
          {{ gameWon ? '🎉 恭喜通关！' : '💀 游戏结束' }}
        </h2>
        <p class="text-xl text-white/80 mb-2">最终分数: {{ totalScore }}</p>
        <p class="text-xl text-white/80 mb-6">获得金币: ${{ money }}</p>
        <button
          @click="restart"
          class="bg-green-500 hover:bg-green-600 text-white px-8 py-4 rounded-xl text-xl font-bold transition-colors"
        >
          重新开始
        </button>
      </div>

      <!-- 游戏主界面 -->
      <div v-else>
        <!-- 盲注信息 -->
        <div class="bg-white/10 backdrop-blur-md rounded-xl p-6 mb-8">
          <h2 class="text-3xl font-bold text-white mb-4">{{ blind.name }}</h2>
          <div class="grid grid-cols-2 md:grid-cols-4 gap-4 text-white">
            <div>
              <p class="text-sm opacity-70">目标分数</p>
              <p class="text-2xl font-bold">{{ blind.targetScore }}</p>
            </div>
            <div>
              <p class="text-sm opacity-70">当前分数</p>
              <p class="text-2xl font-bold" :class="totalScore >= blind.targetScore ? 'text-green-400' : ''">
                {{ totalScore }}
              </p>
            </div>
            <div>
              <p class="text-sm opacity-70">剩余手数</p>
              <p class="text-2xl font-bold">{{ handsLeft }}</p>
            </div>
            <div>
              <p class="text-sm opacity-70">金币</p>
              <p class="text-2xl font-bold text-yellow-400">${{ money }}</p>
            </div>
          </div>
        </div>

        <!-- 上一手牌型和得分 -->
        <div v-if="lastPlayedHand" class="bg-white/10 backdrop-blur-md rounded-xl p-4 mb-6 text-center">
          <p class="text-white text-lg">
            上一手: <span class="font-bold text-yellow-400">{{ lastPlayedHand.name }}</span>
            得分: <span class="font-bold text-green-400">{{ lastScore }}</span>
          </p>
        </div>

        <!-- 手牌区 -->
        <div class="mb-8">
          <h3 class="text-xl font-bold text-white mb-4 text-center">
            手牌 (选择 5 张牌)
          </h3>
          <div class="flex flex-wrap gap-4 justify-center">
            <div
              v-for="card in hand"
              :key="card.id"
              @click="toggleCard(card)"
              class="w-20 h-28 md:w-24 md:h-36 bg-white rounded-lg shadow-xl cursor-pointer
                     transition-all hover:scale-105 flex flex-col items-center justify-center
                     relative"
              :class="{
                'ring-4 ring-yellow-400 -translate-y-4': card.selected,
                'hover:shadow-2xl': !card.selected
              }"
            >
              <!-- 左上角 -->
              <div class="absolute top-1 left-1 text-center">
                <div class="text-lg md:text-2xl font-bold" :class="getSuitColor(card.suit)">
                  {{ getCardDisplay(card.rank) }}
                </div>
                <div class="text-xl md:text-3xl" :class="getSuitColor(card.suit)">
                  {{ getSuitSymbol(card.suit) }}
                </div>
              </div>

              <!-- 中间大符号 -->
              <div class="text-4xl md:text-6xl" :class="getSuitColor(card.suit)">
                {{ getSuitSymbol(card.suit) }}
              </div>

              <!-- 右下角 -->
              <div class="absolute bottom-1 right-1 text-center rotate-180">
                <div class="text-lg md:text-2xl font-bold" :class="getSuitColor(card.suit)">
                  {{ getCardDisplay(card.rank) }}
                </div>
                <div class="text-xl md:text-3xl" :class="getSuitColor(card.suit)">
                  {{ getSuitSymbol(card.suit) }}
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- 操作按钮 -->
        <div class="flex gap-4 justify-center">
          <button
            @click="playHand"
            :disabled="selectedCards.length !== 5"
            class="bg-green-500 hover:bg-green-600 disabled:bg-gray-500 disabled:cursor-not-allowed
                   text-white px-8 py-4 rounded-xl text-xl font-bold transition-colors"
          >
            出牌 ({{ selectedCards.length }}/5)
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 添加一些自定义样式 */
</style>
