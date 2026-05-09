<script setup>
import { computed } from 'vue'

const props = defineProps({
  card: {
    type: Object,
    required: true
  },
  selected: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['click'])

// 获取牌的显示名称
const displayRank = computed(() => {
  const rank = props.card.rank
  if (rank >= 2 && rank <= 10) return rank.toString()
  if (rank === 11) return 'J'
  if (rank === 12) return 'Q'
  if (rank === 13) return 'K'
  if (rank === 14) return 'A'
  return '?'
})

// 获取花色符号
const suitSymbol = computed(() => {
  const symbols = {
    hearts: '♥',
    diamonds: '♦',
    clubs: '♣',
    spades: '♠'
  }
  return symbols[props.card.suit] || '?'
})

// 获取花色颜色
const isRed = computed(() => {
  return props.card.suit === 'hearts' || props.card.suit === 'diamonds'
})

// 卡牌样式类
const cardClasses = computed(() => {
  return [
    'playing-card',
    { 'selected': props.selected },
    { 'red': isRed.value }
  ]
})
</script>

<template>
  <div
    :class="cardClasses"
    @click="emit('click', card)"
  >
    <!-- 装饰性边框 -->
    <div class="card-border"></div>

    <!-- 卡牌背景 -->
    <div class="card-bg">
      <div class="card-pattern"></div>
    </div>

    <!-- 左上角 -->
    <div class="corner top-left">
      <div class="rank">{{ displayRank }}</div>
      <div class="suit">{{ suitSymbol }}</div>
    </div>

    <!-- 中间大符号 -->
    <div class="center-suit">{{ suitSymbol }}</div>

    <!-- 右下角 -->
    <div class="corner bottom-right">
      <div class="rank">{{ displayRank }}</div>
      <div class="suit">{{ suitSymbol }}</div>
    </div>

    <!-- 选中光效 -->
    <div v-if="selected" class="glow-effect"></div>
  </div>
</template>

<style scoped>
.playing-card {
  position: relative;
  width: 100px;
  height: 140px;
  background: linear-gradient(145deg, #ffffff 0%, #f8f9fa 50%, #f0f0f0 100%);
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
  user-select: none;
  overflow: hidden;
  box-shadow:
    0 6px 12px rgba(0, 0, 0, 0.15),
    0 3px 6px rgba(0, 0, 0, 0.1),
    inset 0 1px 0 rgba(255, 255, 255, 0.8);
}

.playing-card:hover {
  transform: translateY(-8px) scale(1.05);
  box-shadow:
    0 12px 24px rgba(0, 0, 0, 0.2),
    0 6px 12px rgba(0, 0, 0, 0.15),
    inset 0 1px 0 rgba(255, 255, 255, 0.9);
}

.playing-card.selected {
  transform: translateY(-12px) scale(1.08);
  box-shadow:
    0 16px 32px rgba(255, 215, 0, 0.4),
    0 8px 16px rgba(255, 215, 0, 0.3),
    0 0 0 3px #ffd700,
    inset 0 0 15px rgba(255, 215, 0, 0.2);
  animation: pulse 2s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% {
    box-shadow:
      0 16px 32px rgba(255, 215, 0, 0.4),
      0 8px 16px rgba(255, 215, 0, 0.3),
      0 0 0 3px #ffd700,
      inset 0 0 15px rgba(255, 215, 0, 0.2);
  }
  50% {
    box-shadow:
      0 16px 32px rgba(255, 215, 0, 0.5),
      0 8px 16px rgba(255, 215, 0, 0.4),
      0 0 0 4px #ffed4e,
      inset 0 0 20px rgba(255, 215, 0, 0.3);
  }
}

.card-border {
  position: absolute;
  inset: 3px;
  border-radius: 9px;
  border: 2px solid rgba(0, 0, 0, 0.05);
  pointer-events: none;
  z-index: 1;
}

.card-bg {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(circle at 30% 30%, rgba(255, 255, 255, 0.9) 0%, transparent 60%),
    radial-gradient(circle at 70% 70%, rgba(240, 240, 240, 0.6) 0%, transparent 60%);
  pointer-events: none;
}

.card-pattern {
  position: absolute;
  inset: 0;
  background-image:
    repeating-linear-gradient(45deg, transparent, transparent 10px, rgba(0, 0, 0, 0.01) 10px, rgba(0, 0, 0, 0.01) 20px);
  opacity: 0.5;
}

.corner {
  position: absolute;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  font-weight: 800;
  line-height: 1;
  z-index: 2;
  text-shadow: 0 1px 2px rgba(255, 255, 255, 0.8);
}

.top-left {
  top: 8px;
  left: 8px;
}

.bottom-right {
  bottom: 8px;
  right: 8px;
  transform: rotate(180deg);
}

.rank {
  font-size: 24px;
  font-family: 'Georgia', 'Times New Roman', serif;
  color: #1a1a1a;
  font-weight: 900;
}

.red .rank {
  color: #dc2626;
}

.suit {
  font-size: 20px;
  color: #1a1a1a;
  line-height: 1;
}

.red .suit {
  color: #dc2626;
}

.center-suit {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  font-size: 56px;
  color: #1a1a1a;
  opacity: 0.12;
  pointer-events: none;
  z-index: 0;
  text-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.red .center-suit {
  color: #dc2626;
}

.glow-effect {
  position: absolute;
  inset: -8px;
  background: radial-gradient(circle, rgba(255, 215, 0, 0.3) 0%, transparent 70%);
  border-radius: 16px;
  pointer-events: none;
  z-index: -1;
  animation: glow 2s ease-in-out infinite;
}

@keyframes glow {
  0%, 100% {
    opacity: 0.5;
    transform: scale(1);
  }
  50% {
    opacity: 0.8;
    transform: scale(1.03);
  }
}

/* 响应式适配 */
/* 平板端 */
@media (max-width: 1024px) {
  .playing-card {
    width: 90px;
    height: 126px;
  }

  .rank {
    font-size: 22px;
  }

  .suit {
    font-size: 18px;
  }

  .center-suit {
    font-size: 50px;
  }
}

/* 移动端 */
@media (max-width: 768px) {
  .playing-card {
    width: 75px;
    height: 105px;
    border-radius: 10px;
  }

  .top-left {
    top: 6px;
    left: 6px;
  }

  .bottom-right {
    bottom: 6px;
    right: 6px;
  }

  .rank {
    font-size: 18px;
  }

  .suit {
    font-size: 16px;
  }

  .center-suit {
    font-size: 42px;
  }

  .card-border {
    inset: 2px;
    border-radius: 8px;
  }
}
</style>
