<script setup>
import { ref, computed, watch, onUnmounted } from 'vue'
import gsap from 'gsap'
import * as ai from '../utils/ai-coach.js'
import * as audio from '../utils/audio.js'

const props = defineProps({
  // v3.0.0 已有：是否显示水晶球
  visible: { type: Boolean, default: true },
  // v3.1.0 扩展：当前决策场景
  scene:   {
    type: String,
    default: 'play',
    validator: v => ['play', 'discard', 'shop', 'blind'].includes(v)
  },
  // v3.1.0 扩展：scene 对应的原始 payload（由父组件按 scene 准备）
  payload: { type: Object, default: null }
})
const emit = defineEmits(['recommend', 'clear', 'toast'])

const orbRef = ref(null)
const particleRef = ref(null)
const status = ref('idle')   // idle | thinking | done | error
const advice = ref(null)
const bubbleVisible = ref(false)
const enabled = ref(false)
let bubbleTimer = null
let particleTl = null

// 每 2 秒轮询 AI 设置，确保设置面板启用后水晶球自动响应
function refreshEnabled() {
  const s = ai.getSettings()
  enabled.value = s.enabled && !!s.apiKey
}
refreshEnabled()
let pollTimer = null
watch(() => props.visible, (v) => {
  if (v) {
    refreshEnabled()
    pollTimer = setInterval(refreshEnabled, 2000)
  } else {
    clearInterval(pollTimer)
    pollTimer = null
  }
}, { immediate: true })

// scene 切换时重置状态，避免上一场景的建议残留在气泡里
watch(() => props.scene, () => {
  advice.value = null
  bubbleVisible.value = false
  clearTimeout(bubbleTimer)
  status.value = 'idle'
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
  // 每次点击前重新读取 AI 设置，解决设置面板改动后水晶球不刷新的问题
  refreshEnabled()
  if (!enabled.value) {
    emit('toast', { type: 'warn', text: '请先在设置中启用 AI 教练并填入 API Key' })
    return
  }
  if (status.value === 'thinking') return
  if (!props.payload) {
    emit('toast', { type: 'warn', text: 'AI 当前场景未知' })
    return
  }
  startThinking()
  try {
    let result
    if (props.scene === 'play')         result = await ai.requestPlayAdvice(props.payload)
    else if (props.scene === 'discard') result = await ai.requestDiscardAdvice(props.payload)
    else if (props.scene === 'shop')    result = await ai.requestShopAdvice(props.payload)
    else if (props.scene === 'blind')   result = await ai.requestBlindAdvice(props.payload)
    else {
      emit('toast', { type: 'warn', text: 'AI 当前场景未知' })
      return
    }
    advice.value = result
    // v3.1.0：emit 整个 advice 对象，父组件按 scene 决定高亮逻辑
    emit('recommend', result)
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
    disabled:          'AI 教练未启用',
    no_api_key:        '请在设置中填入 API Key',
    throttled:         e.detail || '请稍候再试',
    timeout:           'AI 思考超时，请重试',
    network:           '网络异常，无法连接 AI',
    http_error:        `AI 拒绝请求：${e.detail}`,
    empty_response:    'AI 没有返回内容',
    invalid_response:  'AI 返回了不可解析的结果',
    unknown_provider:  '未知供应商',
    unknown_scene:     'AI 当前场景未知',
    no_discards_left:  '本回合已无弃牌次数'
  }
  return map[e.reason] || `AI 暂时不可用（${e.reason}）`
}

// ============================================================
// 气泡文案：按 scene 渲染标题与正文
// ============================================================

/** 场景 tag 文字与颜色 */
const bubbleTag = computed(() => {
  const tags = {
    play:    { text: 'AI 推荐', color: '#ffd166' },
    discard: { text: 'AI 弃牌', color: '#e34b6f' },
    shop:    { text: 'AI 商店', color: '#a78bfa' },
    blind:   { text: 'AI 盲注', color: '#60a5fa' }
  }
  return tags[props.scene] ?? tags.play
})

/** 气泡标题：按 scene + action 组合 */
const bubbleTitle = computed(() => {
  if (!advice.value) return ''
  const a = advice.value
  if (a.scene === 'play') {
    return a.handType || '出牌推荐'
  }
  if (a.scene === 'discard') {
    const n = a.discardCardIds?.length ?? 0
    return `弃 ${n} 张`
  }
  if (a.scene === 'shop') {
    const actionMap = {
      buy:    `购买：${resolveShopJokerName(a.targetId)}`,
      sell:   `卖出：${resolveOwnedJokerName(a.targetId)}`,
      reroll: '刷新商店',
      skip:   '跳过商店'
    }
    return actionMap[a.action] ?? a.action
  }
  if (a.scene === 'blind') {
    const name = resolveBlindName(a.blindId)
    const riskCN = { low: '低', medium: '中', high: '高' }[a.riskLevel] ?? '未知'
    return `选 ${name} · 风险 ${riskCN}`
  }
  return ''
})

/** 从 payload 中找商店 Joker 名称（buy 时） */
function resolveShopJokerName(targetId) {
  if (!props.payload?.shopJokers) return targetId ?? ''
  const j = props.payload.shopJokers.find(x => x.shopJokerId === targetId)
  return j?.name ?? targetId ?? ''
}

/** 从 payload 中找已拥有 Joker 名称（sell 时） */
function resolveOwnedJokerName(targetId) {
  if (!props.payload?.ownedJokers) return targetId ?? ''
  const j = props.payload.ownedJokers.find(x => x.ownedJokerId === targetId)
  return j?.name ?? targetId ?? ''
}

/** 从 payload 中找盲注名称 */
function resolveBlindName(blindId) {
  if (!props.payload?.candidateBlinds) return blindId ?? ''
  const b = props.payload.candidateBlinds.find(x => x.id === blindId)
  return b?.name ?? blindId ?? ''
}

onUnmounted(() => {
  stopThinking()
  clearTimeout(bubbleTimer)
  clearInterval(pollTimer)
})
</script>

<template>
  <div v-if="visible" class="ai-coach-root">
    <button
      ref="orbRef"
      class="ai-orb"
      :class="{
        'is-thinking': status === 'thinking',
        'is-disabled': !enabled,
        'scene-discard': scene === 'discard',
        'scene-shop':    scene === 'shop',
        'scene-blind':   scene === 'blind'
      }"
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
      <div v-if="bubbleVisible && advice" class="ai-bubble" :class="`scene-${scene}`">
        <div class="ai-bubble-head">
          <span
            class="ai-bubble-tag"
            :style="{ background: bubbleTag.color, color: scene === 'play' ? '#1a1330' : '#fff' }"
          >{{ bubbleTag.text }}</span>
          <span class="ai-bubble-handtype">{{ bubbleTitle }}</span>
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

/* 弃牌模式：红色光晕 */
.ai-orb.scene-discard {
  border-color: var(--danger, #e34b6f);
  animation: orb-breath-discard 3.2s ease-in-out infinite;
}
.ai-orb.scene-discard.is-thinking {
  animation: orb-breath-discard 0.8s ease-in-out infinite;
}
@keyframes orb-breath-discard {
  0%, 100% { box-shadow: 0 0 12px 2px rgba(227, 75, 111, .55); }
  50%      { box-shadow: 0 0 20px 6px rgba(227, 75, 111, .85); }
}

/* 商店模式：紫色光晕 */
.ai-orb.scene-shop {
  border-color: #a78bfa;
  animation: orb-breath-shop 3.2s ease-in-out infinite;
}
.ai-orb.scene-shop.is-thinking {
  animation: orb-breath-shop 0.8s ease-in-out infinite;
}
@keyframes orb-breath-shop {
  0%, 100% { box-shadow: 0 0 12px 2px rgba(167, 139, 250, .55); }
  50%      { box-shadow: 0 0 20px 6px rgba(167, 139, 250, .85); }
}

/* 盲注模式：蓝色光晕 */
.ai-orb.scene-blind {
  border-color: #60a5fa;
  animation: orb-breath-blind 3.2s ease-in-out infinite;
}
.ai-orb.scene-blind.is-thinking {
  animation: orb-breath-blind 0.8s ease-in-out infinite;
}
@keyframes orb-breath-blind {
  0%, 100% { box-shadow: 0 0 12px 2px rgba(96, 165, 250, .55); }
  50%      { box-shadow: 0 0 20px 6px rgba(96, 165, 250, .85); }
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
