<script setup>
import { ref, computed, onUnmounted } from 'vue'
import gsap from 'gsap'
import * as ai from '../utils/ai-coach.js'
import * as audio from '../utils/audio.js'

const props = defineProps({
  gameState: { type: Object, required: true },
  visible:   { type: Boolean, default: true }
})
const emit = defineEmits(['recommend', 'clear', 'toast'])

const orbRef = ref(null)
const particleRef = ref(null)
const status = ref('idle')   // idle | thinking | done | error
const advice = ref(null)
const bubbleVisible = ref(false)
let bubbleTimer = null
let particleTl = null

const enabled = computed(() => {
  const s = ai.getSettings()
  return s.enabled && !!s.apiKey
})

function startThinking() {
  status.value = 'thinking'
  if (particleRef.value) {
    particleTl?.kill()
    particleTl = gsap.to(particleRef.value, {
      rotation: '+=360',
      duration: 1.2,
      ease: 'none',
      repeat: -1
    })
  }
}

function stopThinking() {
  particleTl?.kill()
  particleTl = null
  if (particleRef.value) gsap.set(particleRef.value, { rotation: 0 })
}

async function ask() {
  if (!enabled.value) {
    emit('toast', { type: 'warn', text: '请先在设置中启用 AI 教练并填入 API Key' })
    return
  }
  if (status.value === 'thinking') return
  startThinking()
  try {
    const result = await ai.requestCoachAdvice(props.gameState)
    advice.value = result
    emit('recommend', result.recommendedCardIds)
    audio.playSfx('aiPing')
    status.value = 'done'
    showBubble()
  } catch (e) {
    status.value = 'error'
    flashError()
    emit('toast', { type: 'warn', text: errorTextOf(e) })
  } finally {
    stopThinking()
  }
}

function showBubble() {
  bubbleVisible.value = true
  clearTimeout(bubbleTimer)
  bubbleTimer = setTimeout(() => closeBubble(), 5000)
}
function closeBubble() {
  bubbleVisible.value = false
  clearTimeout(bubbleTimer)
  emit('clear')
}

function flashError() {
  if (!orbRef.value) return
  gsap.fromTo(orbRef.value, { boxShadow: '0 0 0 0 #e34b6f' }, {
    boxShadow: '0 0 24px 6px #e34b6f', duration: 0.25, yoyo: true, repeat: 3
  })
}

function errorTextOf(e) {
  const map = {
    disabled:         'AI 教练未启用',
    no_api_key:       '请在设置中填入 API Key',
    throttled:        e.detail || '请稍候再试',
    timeout:          'AI 思考超时，请重试',
    network:          '网络异常，无法连接 AI',
    http_error:       `AI 拒绝请求：${e.detail}`,
    empty_response:   'AI 没有返回内容',
    invalid_response: 'AI 返回了不可解析的结果',
    unknown_provider: '未知供应商'
  }
  return map[e.reason] || `AI 暂时不可用（${e.reason}）`
}

onUnmounted(() => {
  stopThinking()
  clearTimeout(bubbleTimer)
})
</script>

<template>
  <div v-if="visible" class="ai-coach-root">
    <button
      ref="orbRef"
      class="ai-orb"
      :class="{ 'is-thinking': status === 'thinking', 'is-disabled': !enabled }"
      data-no-sfx="true"
      :title="enabled ? '请教 AI 教练' : '点设置启用 AI 教练'"
      @click="ask"
    >
      <span class="ai-orb-core">🔮</span>
      <span ref="particleRef" class="ai-orb-particles" aria-hidden="true">
        <span class="dot" v-for="n in 6" :key="n" />
      </span>
    </button>

    <Transition name="bubble">
      <div v-if="bubbleVisible && advice" class="ai-bubble">
        <div class="ai-bubble-head">
          <span class="ai-bubble-tag">AI 推荐</span>
          <span class="ai-bubble-handtype">{{ advice.handType }}</span>
          <button class="ai-bubble-close" data-no-sfx="true" @click="closeBubble">×</button>
        </div>
        <p class="ai-bubble-text">{{ advice.reasoning }}</p>
        <p v-if="advice.confidence !== null && advice.confidence < 0.5" class="ai-bubble-warn">
          ⚠ 这只是个粗略建议
        </p>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.ai-coach-root {
  position: relative;
  display: inline-flex;
  align-items: center;
}
.ai-orb {
  position: relative;
  width: 44px; height: 44px;
  border-radius: 50%;
  background: radial-gradient(circle at 35% 30%, #6c5ce7, #2d1f55 80%);
  border: 2px solid var(--gold, #ffd166);
  box-shadow: 0 0 12px 2px rgba(108, 92, 231, .55);
  cursor: pointer;
  display: grid; place-items: center;
  animation: orb-breath 3.2s ease-in-out infinite;
}
.ai-orb.is-thinking {
  animation: orb-breath 0.8s ease-in-out infinite;
  box-shadow: 0 0 18px 6px rgba(255, 209, 102, .65);
}
.ai-orb.is-disabled {
  opacity: 0.45;
  filter: grayscale(0.6);
  animation: none;
}
.ai-orb-core {
  font-size: 22px;
  line-height: 1;
  pointer-events: none;
}
.ai-orb-particles {
  position: absolute; inset: -8px;
  pointer-events: none;
}
.ai-orb-particles .dot {
  position: absolute;
  width: 4px; height: 4px; border-radius: 50%;
  background: var(--gold, #ffd166);
  opacity: 0;
}
.ai-orb.is-thinking .ai-orb-particles .dot { opacity: 1; }
.ai-orb-particles .dot:nth-child(1) { top: 0;  left: 50%; }
.ai-orb-particles .dot:nth-child(2) { top: 25%; right: 0; }
.ai-orb-particles .dot:nth-child(3) { bottom: 25%; right: 0; }
.ai-orb-particles .dot:nth-child(4) { bottom: 0;  left: 50%; }
.ai-orb-particles .dot:nth-child(5) { bottom: 25%; left: 0; }
.ai-orb-particles .dot:nth-child(6) { top: 25%;    left: 0; }

@keyframes orb-breath {
  0%, 100% { box-shadow: 0 0 12px 2px rgba(108, 92, 231, .55); }
  50%      { box-shadow: 0 0 20px 6px rgba(108, 92, 231, .85); }
}

.ai-bubble {
  position: absolute;
  top: 56px; right: 0;
  min-width: 240px; max-width: 320px;
  padding: 12px 14px;
  background: linear-gradient(180deg, #2a1f55 0%, #1a1330 100%);
  border: 2px solid var(--gold, #ffd166);
  border-radius: 12px;
  box-shadow: 0 14px 0 rgba(0,0,0,.45), 0 0 18px rgba(255,209,102,.35);
  color: #f5f5f5;
  font-family: 'Press Start 2P', monospace;
  font-size: 11px;
  line-height: 1.55;
  z-index: 250;
}
.ai-bubble-head {
  display: flex; align-items: center; gap: 8px;
  margin-bottom: 8px;
}
.ai-bubble-tag {
  background: var(--gold, #ffd166);
  color: #1a1330;
  padding: 2px 6px; border-radius: 4px;
  font-size: 10px;
}
.ai-bubble-handtype { flex: 1; color: var(--gold, #ffd166); }
.ai-bubble-close {
  width: 22px; height: 22px;
  background: transparent; color: #f5f5f5;
  border: 1px solid rgba(255,255,255,.25); border-radius: 6px;
  cursor: pointer;
}
.ai-bubble-text { margin: 0; }
.ai-bubble-warn {
  margin: 6px 0 0;
  color: #ffb066;
  font-size: 10px;
}

.bubble-enter-active, .bubble-leave-active { transition: all .35s ease; }
.bubble-enter-from { opacity: 0; transform: translateY(-12px); }
.bubble-leave-to   { opacity: 0; transform: translateY(-8px); }
</style>
