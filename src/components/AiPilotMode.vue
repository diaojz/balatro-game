<!-- ======================================================================
     AiPilotMode.vue  —  AI 托管模式全屏 Overlay（v3.2.0）
     ======================================================================
     职责：
       - 展示 AI 托管状态（进度条 / 思考气泡 / 决策日志 / 中止按钮）
       - 纯展示层，不发 LLM 调用，不直接操作游戏 state
       - 所有数据通过 props 接收，所有操作通过 emit 向外通知
       - 真正的托管主循环由 ai-pilot.js 驱动（B6 接入）
     ====================================================================== -->

<script setup>
import { ref, computed, watch, nextTick } from 'vue'
import * as audio from '../utils/audio.js'

const BASE_URL = import.meta.env.BASE_URL

// ──────────────────────────────────────────────────────────────────────────
// Props（v3.2.0 文档 7.2 锁定）
// ──────────────────────────────────────────────────────────────────────────
const props = defineProps({
  /** 是否显示 overlay */
  visible: { type: Boolean, default: false },
  /** 托管模式 solo | duel */
  mode: {
    type: String,
    default: 'solo',
    validator: v => ['solo', 'duel'].includes(v)
  },
  /** 主 game state refs（A 侧） */
  refsA: { type: Object, required: true },
  /** 第二份 game state refs（duel 模式才有） */
  refsB: { type: Object, default: null },
  /** A 侧供应商标签，如 'Anthropic Claude' */
  providerLabelA: { type: String, default: '' },
  /** B 侧供应商标签，如 'OpenAI GPT' */
  providerLabelB: { type: String, default: '' },
  /**
   * 决策日志条目数组
   * 每条：{ at, step, kind, scene?, advice?, phase?, message?, error?, side?, ... }
   */
  log: { type: Array, default: () => [] },
  /** 是否正在运行（false 时中止按钮和关闭按钮状态不同） */
  isRunning: { type: Boolean, default: false }
})

// ──────────────────────────────────────────────────────────────────────────
// Emits（v3.2.0 文档 7.2 锁定）
// ──────────────────────────────────────────────────────────────────────────
const emit = defineEmits(['abort', 'export-log', 'close'])

// ──────────────────────────────────────────────────────────────────────────
// 中止确认弹窗
// ──────────────────────────────────────────────────────────────────────────
const abortConfirmOpen = ref(false)

/** 点击「中止托管」按钮 */
function confirmAbort() {
  audio.playSfx?.('uiClick')
  abortConfirmOpen.value = true
}

/** 确认中止 */
function doAbort() {
  audio.playSfx?.('uiClick')
  abortConfirmOpen.value = false
  emit('abort')
}

/** 取消中止 */
function cancelAbort() {
  audio.playSfx?.('uiClick')
  abortConfirmOpen.value = false
}

/** 导出 JSON */
function onExportLog() {
  audio.playSfx?.('uiClick')
  emit('export-log')
}

/** 关闭 overlay（仅在非运行状态可用） */
function onClose() {
  audio.playSfx?.('uiClick')
  emit('close')
}

// ──────────────────────────────────────────────────────────────────────────
// 思考气泡文案（v3.2.0 文档 7.4 + 十 锁定）
// ──────────────────────────────────────────────────────────────────────────
const SCENE_TEXT = {
  play:    'AI 在思考出哪几张牌……',
  discard: 'AI 在思考弃哪几张牌……',
  shop:    'AI 在评估商店里的 Joker……',
  blind:   'AI 在挑选下一个盲注……'
}

/** 风险等级中文 */
function riskLabel(level) {
  return { low: '低', medium: '中', high: '高' }[level] ?? level ?? '未知'
}

/**
 * 决策气泡文案（v3.2.0 文档 7.4 + 文案锁定）
 * @param {object} entry - 日志条目，kind==='decided' 时调用
 */
function decidedText(entry) {
  const a = entry.advice
  if (!a) return ''
  switch (entry.scene) {
    case 'play':
      return `决定打 ${a.handType ?? '（未知牌型）'}（${a.reasoning ?? '无说明'}）`
    case 'discard':
      return `决定弃 ${a.discardCardIds?.length ?? 0} 张（${a.reasoning ?? '无说明'}）`
    case 'shop': {
      const verbMap = { buy: '购买', sell: '卖出', reroll: '刷新商店', skip: '跳过商店' }
      const verb = verbMap[a.action] ?? a.action ?? '操作'
      return `决定${verb}（${a.reasoning ?? '无说明'}）`
    }
    case 'blind':
      return `决定挑战 ${a.blindId ?? '?'}（风险 ${riskLabel(a.riskLevel)}）`
    default:
      return ''
  }
}

/**
 * ThinkingBubble 的气泡正文（对应文档 7.4 内联子组件的 bubbleText 函数）
 * @param {object|null} tick - 最新日志条目
 * @returns {string}
 */
function bubbleTextOf(tick) {
  if (!tick) return '准备开始'
  switch (tick.kind) {
    case 'thinking': return SCENE_TEXT[tick.scene] ?? 'AI 思考中……'
    case 'decided':  return decidedText(tick)
    case 'auto':     return tick.message ?? ''
    case 'phase':    return `进入阶段 ${tick.phase}`
    case 'error':    return `失败：${tick.error?.detail || tick.error?.reason}`
    case 'end':      return `本局结束（${tick.reason}）`
    case 'start':    return 'AI 接管开始'
    default:         return ''
  }
}

// ──────────────────────────────────────────────────────────────────────────
// 从日志推导当前 tick（A 侧和 B 侧各取最新有内容的一条）
// ──────────────────────────────────────────────────────────────────────────

/**
 * 从日志中取最新的有意义条目
 * @param {string|null} side  'A' | 'B' | null（null 表示不过滤 side）
 */
function latestTick(side) {
  if (!props.log?.length) return null
  const relevant = ['thinking', 'decided', 'auto', 'phase', 'error', 'end', 'start']
  for (let i = props.log.length - 1; i >= 0; i--) {
    const e = props.log[i]
    if (side && e.side !== side) continue
    if (relevant.includes(e.kind)) return e
  }
  return null
}

const latestTickA = computed(() => {
  if (props.mode === 'duel') return latestTick('A')
  return latestTick(null)
})

const latestTickB = computed(() => {
  if (props.mode !== 'duel') return null
  return latestTick('B')
})

// ──────────────────────────────────────────────────────────────────────────
// 日志格式化
// ──────────────────────────────────────────────────────────────────────────

/** 时间格式化 hh:mm:ss */
function formatTime(ts) {
  if (!ts) return '--:--:--'
  try {
    return new Date(ts).toLocaleTimeString('zh-CN', { hour12: false })
  } catch (_) {
    return '--:--:--'
  }
}

/** 每种 kind 的方括号标签文案 */
function kindLabel(entry) {
  const MAP = {
    start:    '[启动]',
    phase:    '[阶段]',
    thinking: '[思考]',
    decided:  '[决定]',
    auto:     '[自动]',
    error:    '[错误]',
    end:      '[结束]'
  }
  return MAP[entry.kind] ?? `[${entry.kind}]`
}

/** 每条日志的详细文本 */
function detailText(entry) {
  switch (entry.kind) {
    case 'start':    return 'AI 接管开始'
    case 'phase':    return `进入阶段 ${entry.phase}`
    case 'thinking': return SCENE_TEXT[entry.scene] ?? 'AI 思考中……'
    case 'decided':  return decidedText(entry)
    case 'auto':     return entry.message ?? ''
    case 'error':    return `失败：${entry.error?.detail || entry.error?.reason || '未知错误'}`
    case 'end':      return `本局结束（${entry.reason ?? 'unknown'}）`
    default:         return JSON.stringify(entry)
  }
}

// ──────────────────────────────────────────────────────────────────────────
// 日志列表自动滚动到底部
// ──────────────────────────────────────────────────────────────────────────
const logListRef = ref(null)

// ──────────────────────────────────────────────────────────────────────────
// 抽屉控制（默认收起，新决策来时按钮 badge +1；打开后清零）
// 「清屏」纯前端：记录截止条数，渲染时跳过；不动 props.log，导出仍是全量
// ──────────────────────────────────────────────────────────────────────────
const panelOpen = ref(false)
const hiddenUntil = ref(0)
const unreadCount = ref(0)

const visibleLog = computed(() => props.log.slice(hiddenUntil.value))

watch(
  () => props.log.length,
  async (newLen, oldLen) => {
    if (newLen > oldLen && !panelOpen.value) {
      unreadCount.value += newLen - oldLen
    }
    await nextTick()
    if (logListRef.value) {
      logListRef.value.scrollTop = logListRef.value.scrollHeight
    }
  }
)

function togglePanel() {
  audio.playSfx?.('uiClick')
  panelOpen.value = !panelOpen.value
  if (panelOpen.value) unreadCount.value = 0
}

function clearVisibleLog() {
  audio.playSfx?.('uiClick')
  hiddenUntil.value = props.log.length
}
</script>

<template>
  <!-- Teleport 挂到 body 确保 z-index 不受父层级 stacking context 影响 -->
  <Teleport to="body">
    <div v-if="visible" class="ai-pilot-root">

      <!-- ────────────────────────────────────────────────────────────────
           顶部 Header：进度条 + 中止按钮
           ──────────────────────────────────────────────────────────────── -->
      <header class="ai-pilot-header">
        <div class="ai-pilot-progress" :class="{ 'is-duel': mode === 'duel' }">

          <!-- A 侧进度 -->
          <div class="progress-side">
            <span v-if="providerLabelA" class="provider-tag provider-tag-a">
              {{ providerLabelA }}
            </span>
            <span class="progress-item">
              Ante {{ refsA.currentAnte?.value ?? '?' }} / 8
            </span>
            <span class="progress-item">
              盲注 {{ refsA.completedBlindIds?.value?.length ?? 0 }} 通过
            </span>
            <span class="progress-item progress-score">
              总分 {{ refsA.totalScore?.value ?? 0 }}
            </span>
          </div>

          <!-- B 侧进度（duel 模式且 refsB 存在时） -->
          <div v-if="mode === 'duel' && refsB" class="progress-side">
            <span v-if="providerLabelB" class="provider-tag provider-tag-b">
              {{ providerLabelB }}
            </span>
            <span class="progress-item">
              Ante {{ refsB.currentAnte?.value ?? '?' }} / 8
            </span>
            <span class="progress-item">
              盲注 {{ refsB.completedBlindIds?.value?.length ?? 0 }} 通过
            </span>
            <span class="progress-item progress-score">
              总分 {{ refsB.totalScore?.value ?? 0 }}
            </span>
          </div>

        </div>

        <!-- solo 模式：思考气泡塞进顶栏中央，避免遮挡牌桌 HUD -->
        <div
          v-if="mode !== 'duel'"
          class="thinking-bubble thinking-bubble--compact"
          :class="{ 'is-thinking': latestTickA?.kind === 'thinking' }"
          :title="bubbleTextOf(latestTickA)"
        >
          <div class="thinking-orb-wrap thinking-orb-wrap--compact">
            <div class="thinking-orb" :class="{ 'orb-spin': latestTickA?.kind === 'thinking' }">
              <span class="thinking-orb-svg thinking-orb-svg--compact" aria-hidden="true"><img :src="`${BASE_URL}assets/icons/deepseek.svg`" alt="" /></span>
            </div>
            <div v-if="latestTickA?.kind === 'thinking'" class="thinking-particles">
              <span
                v-for="n in 8"
                :key="n"
                class="particle"
                :style="{ '--i': n }"
              />
            </div>
          </div>
          <div class="thinking-text-wrap thinking-text-wrap--compact">
            <span v-if="providerLabelA" class="provider-mini">{{ providerLabelA }}</span>
            <p class="thinking-text thinking-text--compact">{{ bubbleTextOf(latestTickA) }}</p>
          </div>
        </div>

        <!-- 中止按钮 -->
        <button
          class="ai-pilot-abort-btn"
          @click="confirmAbort"
          :disabled="!isRunning"
          title="中止 AI 托管，控制权立即交还给你"
        >
          中止托管
        </button>
      </header>

      <!-- ────────────────────────────────────────────────────────────────
           中央思考气泡区（仅 duel 模式渲染，左右两个气泡）
           solo 模式的 A 侧气泡已挪到顶栏中央，避免遮挡牌桌
           ──────────────────────────────────────────────────────────────── -->
      <section v-if="mode === 'duel'" class="ai-pilot-thinking is-duel">

        <!-- B 侧气泡（duel 模式才渲染） -->
        <div
          v-if="mode === 'duel'"
          class="thinking-bubble"
          :class="{ 'is-thinking': latestTickB?.kind === 'thinking' }"
        >
          <div class="thinking-orb-wrap">
            <div class="thinking-orb" :class="{ 'orb-spin': latestTickB?.kind === 'thinking' }">
              🔮
            </div>
            <div v-if="latestTickB?.kind === 'thinking'" class="thinking-particles">
              <span
                v-for="n in 8"
                :key="n"
                class="particle"
                :style="{ '--i': n }"
              />
            </div>
          </div>
          <div class="thinking-text-wrap">
            <span v-if="providerLabelB" class="provider-mini">{{ providerLabelB }}</span>
            <p class="thinking-text">{{ bubbleTextOf(latestTickB) }}</p>
          </div>
        </div>

      </section>

      <!-- ────────────────────────────────────────────────────────────────
           日志浮动按钮（始终显示，右下角，避开手牌区）
           ──────────────────────────────────────────────────────────────── -->
      <button
        class="ai-pilot-fab"
        :class="{ 'is-open': panelOpen }"
        :title="panelOpen ? '收起决策日志' : '展开决策日志'"
        @click="togglePanel"
      >
        <span class="fab-icon" aria-hidden="true">
          {{ panelOpen ? '×' : '📜' }}
        </span>
        <span
          v-if="!panelOpen && unreadCount > 0"
          class="fab-badge"
          :class="{ 'badge-99': unreadCount > 99 }"
        >
          {{ unreadCount > 99 ? '99+' : unreadCount }}
        </span>
      </button>

      <!-- ────────────────────────────────────────────────────────────────
           决策日志抽屉（默认收起，从右滑入）
           ──────────────────────────────────────────────────────────────── -->
      <Transition name="drawer">
        <aside v-if="panelOpen" class="ai-pilot-drawer">

          <header class="drawer-head">
            <span class="drawer-title">
              决策日志
              <span class="drawer-count">{{ visibleLog.length }} / {{ log.length }}</span>
            </span>
            <div class="drawer-actions">
              <button
                class="drawer-action-btn"
                @click="clearVisibleLog"
                :disabled="!visibleLog.length"
                title="清空当前显示（导出 JSON 仍是全量）"
              >
                清屏
              </button>
              <button
                class="drawer-action-btn"
                @click="onExportLog"
                :disabled="!log?.length"
                title="导出全部决策为 JSON 文件"
              >
                导出 JSON
              </button>
            </div>
          </header>

          <ul v-if="visibleLog.length" class="log-list" ref="logListRef">
            <li
              v-for="entry in visibleLog"
              :key="entry.step"
              :class="['log-item', `log-kind-${entry.kind}`]"
            >
              <span class="log-step">#{{ entry.step }}</span>
              <span class="log-time">{{ formatTime(entry.at) }}</span>
              <span v-if="mode === 'duel' && entry.side" class="log-side">
                [{{ entry.side }}]
              </span>
              <span class="log-kind-label">{{ kindLabel(entry) }}</span>
              <span class="log-detail">{{ detailText(entry) }}</span>
            </li>
          </ul>

          <div v-else class="drawer-empty">
            <p v-if="log.length === 0">尚无决策记录</p>
            <p v-else>已清屏 · 共 {{ log.length }} 条历史可在「导出 JSON」中查看</p>
          </div>

        </aside>
      </Transition>

      <!-- ────────────────────────────────────────────────────────────────
           中止确认弹窗（v3.2.0 文档文案锁定）
           ──────────────────────────────────────────────────────────────── -->
      <Transition name="modal">
        <div
          v-if="abortConfirmOpen"
          class="ai-pilot-confirm-overlay"
          @click.self="cancelAbort"
        >
          <div class="confirm-card">
            <h3 class="confirm-title">确定中止 AI 托管？</h3>
            <p class="confirm-body">
              当前局会保留状态，控制权立即交还给你，可继续手动操作。
            </p>
            <div class="confirm-actions">
              <button class="confirm-btn confirm-cancel" @click="cancelAbort">
                取消
              </button>
              <button class="confirm-btn confirm-danger" @click="doAbort">
                确认中止
              </button>
            </div>
          </div>
        </div>
      </Transition>

      <!-- 非运行状态时右上角提供关闭按钮 -->
      <button
        v-if="!isRunning"
        class="ai-pilot-close-btn"
        @click="onClose"
        title="关闭 AI 托管面板"
      >
        ×
      </button>

    </div>
  </Teleport>
</template>

<style scoped>
/* ===========================================================================
   全屏 Overlay 容器
   =========================================================================== */
.ai-pilot-root {
  position: fixed;
  inset: 0;
  z-index: 9200;                     /* 高于 SettingsPanel (9000) */
  background: transparent;            /* 无蒙层：游戏画面完全透出；点击仍被根容器拦截 */
  display: flex;
  flex-direction: column;
  font-family: inherit;
  color: #e6e9f5;
}

/* ===========================================================================
   顶部 Header
   =========================================================================== */
.ai-pilot-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 20px;
  background: linear-gradient(
    180deg,
    rgba(26, 15, 58, 0.95) 0%,
    rgba(16, 10, 40, 0.9) 100%
  );
  border-bottom: 1px solid rgba(147, 77, 255, 0.3);
  flex-shrink: 0;
  position: relative;
}

/* 进度条容器 */
.ai-pilot-progress {
  display: flex;
  gap: 24px;
  align-items: center;
  flex: 1;
}

.ai-pilot-progress.is-duel {
  gap: 32px;
}

/* 单侧进度 */
.progress-side {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
}

.provider-tag {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.5px;
  padding: 2px 8px;
  border-radius: 99px;
  text-transform: uppercase;
}

.provider-tag-a {
  background: rgba(147, 77, 255, 0.25);
  color: #ce93d8;
  border: 1px solid rgba(147, 77, 255, 0.4);
}

.provider-tag-b {
  background: rgba(0, 150, 255, 0.2);
  color: #81d4fa;
  border: 1px solid rgba(0, 150, 255, 0.35);
}

.progress-item {
  font-size: 13px;
  color: rgba(230, 233, 245, 0.75);
}

.progress-score {
  color: #ffd54f;
  font-weight: 600;
}

/* 中止按钮 */
.ai-pilot-abort-btn {
  padding: 8px 18px;
  background: rgba(198, 40, 40, 0.9);
  color: #fff;
  border: none;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s, opacity 0.15s;
  flex-shrink: 0;
}

.ai-pilot-abort-btn:hover:not(:disabled) {
  background: #c62828;
}

.ai-pilot-abort-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

/* 关闭按钮（非运行状态，绝对定位于右上角） */
.ai-pilot-close-btn {
  position: absolute;
  top: 12px;
  right: 16px;
  background: transparent;
  border: 1px solid rgba(230, 233, 245, 0.2);
  color: rgba(230, 233, 245, 0.5);
  font-size: 20px;
  line-height: 1;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s;
  display: flex;
  align-items: center;
  justify-content: center;
}

.ai-pilot-close-btn:hover {
  color: #e6e9f5;
  border-color: rgba(230, 233, 245, 0.5);
}

/* ===========================================================================
   中央思考气泡区
   =========================================================================== */
.ai-pilot-thinking {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 40px;
  padding: 20px 24px;
  flex-shrink: 0;
}

.ai-pilot-thinking.is-duel {
  justify-content: space-around;
}

/* ThinkingBubble 卡片 */
.thinking-bubble {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 14px 22px;
  background: rgba(0, 0, 0, 0.35);
  border: 1px solid rgba(77, 208, 225, 0.2);
  border-radius: 12px;
  min-width: 260px;
  transition: border-color 0.3s, background 0.3s, box-shadow 0.3s;
}

.thinking-bubble.is-thinking {
  background: rgba(0, 200, 255, 0.07);
  border-color: rgba(77, 208, 225, 0.5);
  box-shadow: 0 0 12px rgba(77, 208, 225, 0.15);
}

/* 水晶球 + 粒子 wrapper */
.thinking-orb-wrap {
  position: relative;
  width: 44px;
  height: 44px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.thinking-orb {
  font-size: 28px;
  line-height: 1;
  transition: transform 0.3s, filter 0.3s;
  user-select: none;
}
/* v1.9.x：DeepSeek 小机器人头像（白蓝渐变底 + 蓝鲸 logo + 蓝色外发光） */
.thinking-orb-svg {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background:
    radial-gradient(circle at 35% 28%, #ffffff 0%, #dbe6ff 55%, #a8bbf5 100%);
  box-shadow:
    0 0 12px 3px rgba(77, 107, 254, 0.9),
    0 0 28px 6px rgba(77, 107, 254, 0.5),
    inset -3px -4px 7px rgba(60, 80, 160, 0.4),
    inset 2px 3px 5px rgba(255, 255, 255, 0.9);
}
.thinking-orb-svg img {
  width: 62%;
  height: 62%;
  object-fit: contain;
  display: block;
}

/* solo 模式：气泡塞进顶栏中央的紧凑样式（整体内容居中显示） */
.thinking-bubble--compact {
  flex: 1 1 auto;
  min-width: 0;
  margin: 0 16px;
  padding: 6px 18px;
  gap: 10px;
  justify-content: center;
  background: rgba(0, 0, 0, 0.25);
  border-radius: 999px;
}
.thinking-orb-wrap--compact {
  width: 28px;
  height: 28px;
  flex: 0 0 auto;
}
.thinking-orb-svg--compact {
  width: 24px;
  height: 24px;
  box-shadow:
    0 0 6px 1px rgba(77, 107, 254, 0.85),
    0 0 14px 3px rgba(77, 107, 254, 0.4),
    inset -1px -2px 4px rgba(60, 80, 160, 0.35),
    inset 1px 1px 3px rgba(255, 255, 255, 0.85);
}
.thinking-text-wrap--compact {
  flex: 0 1 auto;
  min-width: 0;
  max-width: 640px;
  display: flex;
  align-items: center;
  gap: 10px;
}
.thinking-text--compact {
  margin: 0;
  font-size: 13px;
  line-height: 1.4;
  color: rgba(255, 255, 255, 0.92);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

/* thinking 时水晶球缓慢脉冲 */
.thinking-orb.orb-spin {
  animation: orb-pulse 2s ease-in-out infinite;
}

@keyframes orb-pulse {
  0%, 100% { transform: scale(1);    filter: brightness(1); }
  50%       { transform: scale(1.1); filter: brightness(1.35); }
}

/* 粒子环 */
.thinking-particles {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.particle {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 5px;
  height: 5px;
  margin: -2.5px 0 0 -2.5px;
  border-radius: 50%;
  background: #4dd0e1;
  animation: particle-orbit 1.6s linear infinite;
  animation-delay: calc((var(--i, 0) - 1) * 0.2s);
}

@keyframes particle-orbit {
  0% {
    transform:
      rotate(calc((var(--i, 1) - 1) * 45deg))
      translateX(20px)
      scale(0.5);
    opacity: 0;
  }
  30% {
    opacity: 1;
    transform:
      rotate(calc((var(--i, 1) - 1) * 45deg + 90deg))
      translateX(22px)
      scale(1);
  }
  70% {
    opacity: 1;
  }
  100% {
    transform:
      rotate(calc((var(--i, 1) - 1) * 45deg + 360deg))
      translateX(20px)
      scale(0.5);
    opacity: 0;
  }
}

/* 文字区 */
.thinking-text-wrap {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.provider-mini {
  font-size: 10px;
  color: rgba(230, 233, 245, 0.45);
  letter-spacing: 0.4px;
  text-transform: uppercase;
}

.thinking-text {
  margin: 0;
  font-size: 14px;
  color: #e6e9f5;
  line-height: 1.5;
  word-break: break-all;
}

/* ===========================================================================
   底部日志区
   =========================================================================== */
.ai-pilot-log {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding: 0 20px 16px;
}

.log-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 0 8px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  flex-shrink: 0;
}

.log-count {
  font-size: 12px;
  color: rgba(230, 233, 245, 0.5);
  letter-spacing: 0.3px;
}

.log-export-btn {
  padding: 5px 14px;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.18);
  color: #e6e9f5;
  border-radius: 5px;
  font-size: 12px;
  cursor: pointer;
  transition: background 0.15s;
}

.log-export-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.14);
}

.log-export-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

/* 日志滚动容器 */
.log-list {
  flex: 1;
  overflow-y: auto;
  margin: 0;
  padding: 6px 0;
  list-style: none;
  scrollbar-width: thin;
  scrollbar-color: rgba(147, 77, 255, 0.4) transparent;
}

.log-list::-webkit-scrollbar {
  width: 4px;
}

.log-list::-webkit-scrollbar-track {
  background: transparent;
}

.log-list::-webkit-scrollbar-thumb {
  background: rgba(147, 77, 255, 0.4);
  border-radius: 2px;
}

/* 日志条 */
.log-item {
  display: flex;
  align-items: baseline;
  gap: 6px;
  padding: 3px 6px;
  font-size: 12px;
  line-height: 1.6;
  border-radius: 3px;
}

.log-item:hover {
  background: rgba(255, 255, 255, 0.04);
}

.log-step {
  color: rgba(230, 233, 245, 0.28);
  font-size: 10px;
  min-width: 28px;
  flex-shrink: 0;
}

.log-time {
  color: rgba(230, 233, 245, 0.35);
  font-size: 10px;
  min-width: 64px;
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
}

.log-side {
  font-size: 10px;
  color: rgba(230, 233, 245, 0.4);
  flex-shrink: 0;
}

.log-kind-label {
  flex-shrink: 0;
  font-weight: 600;
}

.log-detail {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ── 日志条颜色（v3.2.0 文档 7.5 锁定） ── */
/* start: 紫色 */
.log-kind-start .log-kind-label,
.log-kind-start .log-detail {
  color: #ce93d8;
}

/* phase: 灰色 */
.log-kind-phase .log-kind-label,
.log-kind-phase .log-detail {
  color: rgba(230, 233, 245, 0.5);
}

/* thinking: 青色 */
.log-kind-thinking .log-kind-label,
.log-kind-thinking .log-detail {
  color: #4dd0e1;
}

/* decided: 金色 */
.log-kind-decided .log-kind-label,
.log-kind-decided .log-detail {
  color: #ffd54f;
}

/* auto: 灰色 */
.log-kind-auto .log-kind-label,
.log-kind-auto .log-detail {
  color: rgba(230, 233, 245, 0.45);
}

/* error: 红色 */
.log-kind-error .log-kind-label,
.log-kind-error .log-detail {
  color: #ef5350;
}

/* end: 紫色 */
.log-kind-end .log-kind-label,
.log-kind-end .log-detail {
  color: #ce93d8;
}

/* ===========================================================================
   中止确认弹窗
   =========================================================================== */
.ai-pilot-confirm-overlay {
  position: absolute;
  inset: 0;
  z-index: 10;
  background: rgba(8, 10, 22, 0.75);
  display: flex;
  align-items: center;
  justify-content: center;
}

.confirm-card {
  background: linear-gradient(135deg, #1c1040 0%, #110a2e 100%);
  border: 1px solid rgba(147, 77, 255, 0.45);
  border-radius: 10px;
  padding: 28px 32px;
  max-width: 400px;
  width: 90%;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6);
}

.confirm-title {
  margin: 0 0 12px;
  font-size: 16px;
  color: #ffd54f;
  font-weight: 700;
}

.confirm-body {
  margin: 0 0 20px;
  font-size: 14px;
  line-height: 1.7;
  color: rgba(230, 233, 245, 0.85);
}

.confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}

.confirm-btn {
  padding: 8px 20px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  border: none;
  transition: opacity 0.15s;
}

.confirm-btn:hover {
  opacity: 0.85;
}

.confirm-cancel {
  background: rgba(255, 255, 255, 0.1);
  color: #e6e9f5;
  border: 1px solid rgba(255, 255, 255, 0.2);
}

.confirm-danger {
  background: #c62828;
  color: #fff;
}

/* ===========================================================================
   Transition 动画（弹窗淡入淡出）
   =========================================================================== */
.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;
  transform: scale(0.96);
}

/* ===========================================================================
   日志浮动按钮（始终显示，避开手牌区）
   =========================================================================== */
.ai-pilot-fab {
  position: absolute;
  right: 18px;
  bottom: calc(150px + env(safe-area-inset-bottom, 0px));
  width: 52px;
  height: 52px;
  border-radius: 50%;
  border: 2px solid rgba(147, 77, 255, 0.5);
  background: linear-gradient(180deg, rgba(40, 22, 80, 0.95), rgba(16, 8, 36, 0.95));
  color: #e6e9f5;
  font-size: 22px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.2s, box-shadow 0.2s, border-color 0.2s, background 0.2s;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
  z-index: 2;
  -webkit-tap-highlight-color: transparent;
}
.ai-pilot-fab:hover {
  transform: scale(1.08);
  border-color: rgba(147, 77, 255, 0.9);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4), 0 0 0 6px rgba(147, 77, 255, 0.15);
}
.ai-pilot-fab:active { transform: scale(0.96); }
.ai-pilot-fab.is-open {
  background: linear-gradient(180deg, rgba(80, 22, 60, 0.95), rgba(36, 8, 24, 0.95));
  border-color: rgba(255, 80, 120, 0.5);
  font-size: 26px;
}

.fab-icon { line-height: 1; }
.fab-badge {
  position: absolute;
  top: -4px;
  right: -4px;
  min-width: 20px;
  height: 20px;
  padding: 0 6px;
  border-radius: 999px;
  background: #ff4d6d;
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 2px solid rgba(8, 10, 22, 0.95);
  animation: badge-pop 0.3s ease;
}
.fab-badge.badge-99 { font-size: 9px; padding: 0 4px; }
@keyframes badge-pop {
  0%   { transform: scale(0.4); opacity: 0; }
  60%  { transform: scale(1.15); opacity: 1; }
  100% { transform: scale(1); }
}

/* ===========================================================================
   日志抽屉（右侧滑入）
   =========================================================================== */
.ai-pilot-drawer {
  position: absolute;
  top: 80px;
  right: 0;
  bottom: calc(80px + env(safe-area-inset-bottom, 0px));
  width: 380px;
  max-width: 88vw;
  background: linear-gradient(180deg, rgba(20, 12, 44, 0.97), rgba(12, 8, 30, 0.97));
  border-left: 1px solid rgba(147, 77, 255, 0.3);
  border-top: 1px solid rgba(147, 77, 255, 0.2);
  border-bottom: 1px solid rgba(147, 77, 255, 0.2);
  border-top-left-radius: 14px;
  border-bottom-left-radius: 14px;
  box-shadow: -8px 0 30px rgba(0, 0, 0, 0.5);
  display: flex;
  flex-direction: column;
  z-index: 1;
  overflow: hidden;
}

.drawer-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  flex-shrink: 0;
}
.drawer-title {
  font-size: 13px;
  font-weight: 600;
  color: #e6e9f5;
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.drawer-count {
  font-size: 11px;
  color: rgba(230, 233, 245, 0.45);
  font-weight: 400;
}
.drawer-actions {
  display: flex;
  gap: 8px;
}
.drawer-action-btn {
  padding: 5px 12px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.15);
  color: #e6e9f5;
  border-radius: 5px;
  font-size: 12px;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
  -webkit-tap-highlight-color: transparent;
}
.drawer-action-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.12);
  border-color: rgba(147, 77, 255, 0.5);
}
.drawer-action-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.drawer-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 30px 20px;
  text-align: center;
  color: rgba(230, 233, 245, 0.4);
  font-size: 13px;
  line-height: 1.6;
}

/* 抽屉内的 log-list 需要左右内边距，避免条目贴边 */
.ai-pilot-drawer .log-list {
  padding: 6px 12px;
}

/* 抽屉滑入/滑出 */
.drawer-enter-active,
.drawer-leave-active {
  transition: transform 0.28s cubic-bezier(0.32, 0.72, 0, 1), opacity 0.2s ease;
}
.drawer-enter-from,
.drawer-leave-to {
  transform: translateX(100%);
  opacity: 0;
}

/* ===========================================================================
   移动端适配（窄屏 / 触摸友好）
   =========================================================================== */
@media (max-width: 640px) {
  .ai-pilot-fab {
    right: 14px;
    /* 移动端手牌往往更靠近底部，再往上抬一点避免误触 */
    bottom: calc(170px + env(safe-area-inset-bottom, 0px));
    width: 48px;
    height: 48px;
    font-size: 20px;
  }
  .ai-pilot-fab.is-open { font-size: 24px; }

  .ai-pilot-drawer {
    top: 70px;
    bottom: calc(70px + env(safe-area-inset-bottom, 0px));
    width: 92vw;
    max-width: 92vw;
  }
  .drawer-head { padding: 10px 12px; }
  .drawer-title { font-size: 12px; }
  .drawer-action-btn {
    padding: 7px 12px;
    font-size: 12px;
    min-height: 36px;  /* 触摸目标 ≥36pt */
  }
  .ai-pilot-drawer .log-list { padding: 6px 10px; }
  .log-item { font-size: 11px; padding: 4px 6px; }
}
</style>
