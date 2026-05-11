<script setup>
import { computed, onMounted, ref } from 'vue'
import gsap from 'gsap'

const props = defineProps({
  card: {
    type: Object,
    required: true
  },
  selected: {
    type: Boolean,
    default: false
  },
  selectable: {
    type: Boolean,
    default: false
  },
  compact: {
    type: Boolean,
    default: false
  },
  dealIndex: {
    type: Number,
    default: 0
  },
  disableEnter: {
    type: Boolean,
    default: false
  },
  recommended: {
    // v3.1.0：枚举 'play' | 'discard' | null，Boolean true 视同 'play'（向后兼容）
    type: [Boolean, String],
    default: null,
    validator: (v) => v === null || v === false || v === true || v === 'play' || v === 'discard'
  }
})

const emit = defineEmits(['click'])

const displayRank = computed(() => {
  const rank = props.card.rank
  if (rank >= 2 && rank <= 10) return rank.toString()
  if (rank === 11) return 'J'
  if (rank === 12) return 'Q'
  if (rank === 13) return 'K'
  if (rank === 14) return 'A'
  return '?'
})

const suitSymbol = computed(() => {
  const symbols = {
    hearts: '♥',
    diamonds: '♦',
    clubs: '♣',
    spades: '♠'
  }
  return symbols[props.card.suit] || '?'
})

const isRed = computed(() => {
  return props.card.suit === 'hearts' || props.card.suit === 'diamonds'
})

// v3.1.0：把 Boolean true 视同 'play'，统一归一为枚举值
const recommendedKind = computed(() => {
  if (props.recommended === 'discard') return 'discard'
  if (props.recommended) return 'play'   // true 或 'play' 都走此分支
  return null
})

const cardClasses = computed(() => {
  return [
    'playing-card',
    { 'selected': props.selected },
    // v3.1.0：按 recommendedKind 切换两种高亮 class
    { 'is-recommended-play':    recommendedKind.value === 'play' },
    { 'is-recommended-discard': recommendedKind.value === 'discard' },
    // 旧 class 保留：向下兼容可能存在的外部 CSS 引用
    { 'is-recommended': !!recommendedKind.value },
    { 'red': isRed.value },
    { 'compact': props.compact },
    { 'selectable': props.selectable }
  ]
})

const cardRef = ref(null)

onMounted(() => {
  if (!cardRef.value || props.disableEnter) return
  gsap.from(cardRef.value, {
    x: 160,
    opacity: 0,
    duration: 0.4,
    delay: props.dealIndex * 0.06,
    ease: 'power2.out',
    clearProps: 'transform,opacity'
  })
})

defineExpose({ cardRef })
</script>

<template>
  <div :class="cardClasses" @click="emit('click', card)" ref="cardRef">
    <div class="card-border"></div>

    <div class="card-bg">
      <div class="card-pattern"></div>
    </div>

    <div v-if="selectable && !selected" class="selection-ring"></div>

    <div class="corner top-left">
      <div class="rank">{{ displayRank }}</div>
      <div class="suit">{{ suitSymbol }}</div>
    </div>

    <div class="center-suit">{{ suitSymbol }}</div>

    <div class="corner bottom-right">
      <div class="rank">{{ displayRank }}</div>
      <div class="suit">{{ suitSymbol }}</div>
    </div>

    <div v-if="selected" class="glow-effect"></div>
  </div>
</template>

<style scoped>
.playing-card {
  position: relative;
  width: 110px;
  height: 154px;
  background: linear-gradient(145deg, #fff8ec 0%, #f0ead8 50%, #e8e0c8 100%);
  border-radius: 12px;
  cursor: pointer;
  transition: transform 0.22s ease, box-shadow 0.22s ease;
  user-select: none;
  overflow: hidden;
  box-shadow:
    0 6px 0 rgba(0, 0, 0, 0.45),
    0 0 0 2px #2a1c33;
  color: #2a1c33;
}

.playing-card.selectable:not(.selected) {
  filter: saturate(0.96);
}

.playing-card:hover {
  transform: translateY(-8px) scale(1.05);
  box-shadow:
    0 12px 0 rgba(0, 0, 0, 0.45),
    0 0 0 2px #2a1c33,
    0 16px 28px rgba(0, 0, 0, 0.5);
}

.playing-card.selected {
  transform: translateY(-22px);
  box-shadow:
    0 18px 24px rgba(0, 0, 0, 0.45),
    0 0 0 2px #2a1c33,
    0 0 0 4px #ffd166,
    0 0 24px rgba(255, 209, 102, 0.55);
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

.selection-ring {
  position: absolute;
  inset: 7px;
  border: 2px dashed rgba(56, 197, 255, 0.45);
  border-radius: 10px;
  pointer-events: none;
  z-index: 1;
}


.corner {
  position: absolute;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
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
  font-size: 22px;
  font-family: 'Georgia', 'Times New Roman', serif;
  color: #2a1c33;
  font-weight: 900;
}

.red .rank {
  color: #d6234a;
}

.suit {
  font-size: 18px;
  color: #2a1c33;
  line-height: 1;
}

.red .suit {
  color: #d6234a;
}

.center-suit {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  font-size: 50px;
  color: #2a1c33;
  opacity: 0.12;
  pointer-events: none;
  z-index: 0;
}

.red .center-suit {
  color: #d6234a;
}

.glow-effect {
  position: absolute;
  inset: -10px;
  background: radial-gradient(ellipse, rgba(255, 209, 102, 0.5) 0%, rgba(255, 209, 102, 0.15) 50%, transparent 75%);
  border-radius: 18px;
  pointer-events: none;
  z-index: -1;
  animation: glow-pulse 1.8s ease-in-out infinite;
}
@keyframes glow-pulse {
  0%, 100% { opacity: 0.6; transform: scale(1); }
  50% { opacity: 1; transform: scale(1.04); }
}

/* Compact */
.playing-card.compact {
  width: 88px;
  height: 124px;
  border-radius: 10px;
}
.playing-card.compact .rank {
  font-size: 20px;
}
.playing-card.compact .suit {
  font-size: 16px;
}
.playing-card.compact .center-suit {
  font-size: 42px;
}

/* Responsive */
@media (max-width: 1024px) {
  .playing-card {
    width: 90px;
    height: 126px;
  }
  .rank { font-size: 20px; }
  .suit { font-size: 16px; }
  .center-suit { font-size: 44px; }
}

@media (max-width: 768px) {
  .playing-card {
    width: 75px;
    height: 105px;
    border-radius: 10px;
  }
  .top-left { top: 6px; left: 6px; }
  .bottom-right { bottom: 6px; right: 6px; }
  .rank { font-size: 18px; }
  .suit { font-size: 14px; }
  .center-suit { font-size: 36px; }
  .card-border { inset: 2px; border-radius: 8px; }
}

/* AI 推荐高亮：旧通用 class 保留（向后兼容） */
.playing-card.is-recommended {
  outline: 3px solid var(--gold, #ffd166);
  outline-offset: 2px;
}

/* v3.1.0：出牌推荐——金色描边 + 缓慢光晕呼吸 */
.playing-card.is-recommended-play {
  outline: 3px solid var(--gold, #ffd166);
  outline-offset: 2px;
  box-shadow: 0 0 18px 4px rgba(255, 209, 102, .55);
  animation: card-recommend-pulse 1.6s ease-in-out infinite;
}
@keyframes card-recommend-pulse {
  0%, 100% { box-shadow: 0 0 12px 2px rgba(255, 209, 102, .4); }
  50%      { box-shadow: 0 0 22px 6px rgba(255, 209, 102, .85); }
}

/* v3.1.0：弃牌推荐——红色描边 + 红色光晕呼吸（警示配色） */
.playing-card.is-recommended-discard {
  outline: 3px solid var(--danger, #e34b6f);
  outline-offset: 2px;
  box-shadow: 0 0 18px 4px rgba(227, 75, 111, .55);
  animation: card-recommend-pulse-discard 1.6s ease-in-out infinite;
}
@keyframes card-recommend-pulse-discard {
  0%, 100% { box-shadow: 0 0 12px 2px rgba(227, 75, 111, .4); }
  50%      { box-shadow: 0 0 22px 6px rgba(227, 75, 111, .85); }
}
</style>
