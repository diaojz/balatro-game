<script setup>
import { ref, computed, onMounted, onBeforeUnmount, nextTick, watch } from 'vue'
import { createDeck, identifyHand } from './utils/poker.js'
import { calculateScore, buildScoreSequence } from './utils/scoring.js'
import { BLINDS, TOTAL_ANTES } from './config/blinds.js'
import { getRandomJoker } from './config/jokers.js'
import { PHASE_TO_BGM } from './config/audio.js'
import * as audio from './utils/audio.js'
import gsap from 'gsap'
import {
  burstParticles,
  burstJokerParticles,
  flyToTable,
  floatNumber,
  flyToHud,
  pulseHudCol
} from './utils/animation.js'
import PlayingCard from './components/PlayingCard.vue'
import JokerCard from './components/JokerCard.vue'
import ScoreCounter from './components/ScoreCounter.vue'
import SettingsPanel from './components/SettingsPanel.vue'
import OrientationGuard from './components/OrientationGuard.vue'
import JokerDetailPopover from './components/JokerDetailPopover.vue'
import AiCoachOverlay from './components/AiCoachOverlay.vue'
import AiPilotMode from './components/AiPilotMode.vue'
import { requestDiscardAdvice, requestShopAdvice, requestBlindAdvice, serializePlayState, serializeBlindState, getSettings, hasProviderConfigured } from './utils/ai-coach.js'
import { runAutoPilot, AiPilotAbort } from './utils/ai-pilot.js'
import { createGameActor } from './utils/game-actor.js'

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

const settingsOpen = ref(false)
function openSettings() { settingsOpen.value = true }
function closeSettings() { settingsOpen.value = false }

// 长按 Joker 弹出详情浮窗（移动端取代桌面 hover tooltip 的详细描述）
const detailJoker = ref(null)
const detailContext = ref('owned')
function showJokerDetail(joker, context = 'owned') {
  detailJoker.value = joker
  detailContext.value = context
}
function closeJokerDetail() { detailJoker.value = null }

// AI 教练推荐高亮
const aiRecommendedCardIds = ref([])
// v1.10.0：弃牌推荐 ids 占位，A6 接入弃牌 AI 时正式赋值
const aiDiscardRecommendedIds = ref([])

/**
 * v1.10.0 A4：商店建议对象
 * 结构同 validateShopAdvice 返回值：{ scene, action, targetId, reasoning, confidence }
 * action: 'buy' | 'sell' | 'reroll' | 'skip'
 * targetId: shopJokerId / ownedJokerId（reroll/skip 时为 null）
 */
const aiShopAdvice = ref(null)

// v1.10.0 A6：弃牌模式开关。true = 当前处于弃牌建议场景，PlayingCard 红色高亮由 aiDiscardRecommendedIds 驱动
const isDiscardMode = ref(false)

/**
 * 切换弃牌模式。
 * 进入时清空出牌推荐高亮，离开时清空弃牌推荐高亮。
 * UI 入口留给 A7 AiCoachOverlay scene='discard' 分支调用。
 */
function toggleDiscardMode() {
  if (isDiscardMode.value) {
    // 退出弃牌模式：清空弃牌推荐
    isDiscardMode.value = false
    aiDiscardRecommendedIds.value = []
  } else {
    // 进入弃牌模式：清空出牌推荐，避免两种高亮同时显示
    isDiscardMode.value = true
    aiRecommendedCardIds.value = []
  }
}

/**
 * 触发弃牌 AI 建议。
 * - 前端先拦 discardsLeft <= 0，避免无谓 LLM 调用
 * - ai-coach.js requestDiscardAdvice 内部同样检查（双重兜底）
 * - 成功后填充 aiDiscardRecommendedIds，PlayingCard 红色脉冲自动生效
 * - 失败时静默 console.error，不污染 UI
 * A7 整合 AiCoachOverlay 时，由 scene='discard' 分支调用此函数。
 */
async function requestDiscardAdviceNow() {
  if (discardsLeft.value <= 0) {
    showToastMessage('本回合已无弃牌次数', 'warning')
    return
  }
  try {
    const result = await requestDiscardAdvice({
      hand: hand.value,
      ownedJokers: ownedJokers.value,
      blind: blind.value,
      handsLeft: handsLeft.value,
      discardsLeft: discardsLeft.value,
      money: money.value,
      lastPlayedHand: lastPlayedHand.value,
      totalScore: totalScore.value
    })
    aiDiscardRecommendedIds.value = result.discardCardIds
  } catch (e) {
    console.error('[AI Discard Advice] 失败：', e?.reason ?? e?.message ?? e)
    // 不污染 UI：catch 吞掉，aiDiscardRecommendedIds 保持不变
  }
}

// dev 环境：暴露到 window，供浏览器 console 手工调用验证
if (import.meta.env.DEV) {
  window.__test_requestDiscardAdvice = requestDiscardAdviceNow
}

/**
 * v1.10.0 A7：onAiRecommend 重写为 4 路分发
 * AiCoachOverlay 现在 emit 整个 advice 对象（不再是 ids 数组）
 * @param {Object} advice - 整个 advice 对象，含 scene 字段
 */
function onAiRecommend(advice) {
  if (!advice || !advice.scene) return
  switch (advice.scene) {
    case 'play':
      // 出牌建议：高亮 recommendedCardIds
      aiRecommendedCardIds.value = advice.recommendedCardIds || []
      aiDiscardRecommendedIds.value = []
      break
    case 'discard':
      // 弃牌建议：高亮 discardCardIds，自动切入弃牌模式
      aiDiscardRecommendedIds.value = advice.discardCardIds || []
      aiRecommendedCardIds.value = []
      isDiscardMode.value = true
      break
    case 'shop':
      // 商店建议：整个 advice 存入 aiShopAdvice，由 shopRecommendedKindOf 计算高亮
      aiShopAdvice.value = advice
      break
    case 'blind':
      // 盲注建议：整个 advice 存入 aiBlindAdvice，由 blindRecommendedKindOf 计算高亮
      aiBlindAdvice.value = advice
      break
  }
}

/**
 * v1.10.0 A7：onAiClear 清空所有 4 路 advice
 */
function onAiClear() {
  aiRecommendedCardIds.value = []
  aiDiscardRecommendedIds.value = []
  aiShopAdvice.value = null
  aiBlindAdvice.value = null
}

function onAiToast(payload) {
  showToastMessage(payload.text, payload.type === 'warn' ? 'warning' : 'info')
}

/**
 * v1.10.0：按 cardId 返回推荐类型枚举
 * - 出牌建议命中 → 'play'（金色高亮）
 * - 弃牌建议命中 → 'discard'（红色高亮）
 * - 否则 → null
 * 弃牌路径数据源（aiDiscardRecommendedIds）在 A6 接通，本步以空数组占位。
 * @param {string} cardId
 * @returns {'play' | 'discard' | null}
 */
function recommendedKindOf(cardId) {
  if (aiDiscardRecommendedIds.value.includes(cardId)) return 'discard'
  if (aiRecommendedCardIds.value.includes(cardId)) return 'play'
  return null
}

// ========== v1.11.0 B4：createGameState 工厂 ==========
// 把所有游戏核心 ref 与派生 computed 集中创建。
// 单 AI 托管模式调用一次，双 AI 对战（未来）可调用两次各自独立。
// AI 教练相关 ref（aiScene/aiVisible/aiPayload/aiRecommendedCardIds 等）不属于游戏核心 state，
// 保留在 App.vue 顶层，不纳入工厂。

function createGameState() {
  // ---- 15 个游戏核心 ref ----
  const deck             = ref([])
  const discardPile      = ref([])
  const hand             = ref([])
  const playedCards      = ref([])
  const ownedJokers      = ref([])
  const shopJokers       = ref([])
  const currentBlind     = ref(0)
  const totalScore       = ref(0)
  const handsLeft        = ref(4)
  const discardsLeft     = ref(3)
  const money            = ref(4)
  const lastPlayedHand   = ref(null)
  const lastScore        = ref(0)
  const completedBlindIds = ref([])
  const runPhase         = ref(RUN_PHASES.SETUP)

  // ---- 派生 computed（沿用 v1.10.0 已实现的逻辑）----

  /** 当前盲注对象（同 v1.10.0 的 blind computed） */
  const blind = computed(() => BLINDS[currentBlind.value] ?? BLINDS[0])

  /** 当前 ante 编号 */
  const currentAnte = computed(() => blind.value?.ante ?? 1)

  /** 当前 ante 全部盲注列表 */
  const currentAnteBlinds = computed(() => BLINDS.filter(item => item.ante === currentAnte.value))

  /**
   * 可选盲注列表（带状态标注）。
   * 文档别名 candidateBlinds，同时以 availableBlindOptions 暴露保持向后兼容。
   */
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

  /**
   * 商店区 Joker 加稳定 shopJokerId（格式：sh_0、sh_1、sh_2）
   * 用于 serializeShopState / AI 建议 targetId 匹配
   */
  const shopJokersWithIds = computed(() =>
    shopJokers.value.map((j, i) => ({ ...j, shopJokerId: `sh_${i}` }))
  )

  /**
   * 已拥有 Joker 加稳定 ownedJokerId（格式：oj_0 … oj_4）
   * 用于 serializeShopState / AI 建议 targetId 匹配
   */
  const ownedJokersWithIds = computed(() =>
    ownedJokers.value.map((j, i) => ({ ...j, ownedJokerId: `oj_${i}` }))
  )

  return {
    // refs
    deck, discardPile, hand, playedCards, ownedJokers, shopJokers,
    currentBlind, totalScore, handsLeft, discardsLeft, money,
    lastPlayedHand, lastScore, completedBlindIds, runPhase,
    // computeds
    blind, currentAnte, currentAnteBlinds, availableBlindOptions,
    candidateBlinds: availableBlindOptions, // 文档别名，供 ai-pilot.js 使用
    shopJokersWithIds, ownedJokersWithIds
  }
}

// 创建主 game state 实例（默认单 AI 托管 / 玩家手动操作共用同一份 state）
const gameState = createGameState()

// 解构出来，保持现有所有引用（deck.value / hand.value 等）完全不变
const {
  deck, discardPile, hand, playedCards, ownedJokers, shopJokers,
  currentBlind, totalScore, handsLeft, discardsLeft, money,
  lastPlayedHand, lastScore, completedBlindIds, runPhase,
  blind, currentAnte, currentAnteBlinds, availableBlindOptions,
  shopJokersWithIds, ownedJokersWithIds
} = gameState

// ========== v1.11.0 B6：AI 托管启停三件套 ==========

/** 当前托管 overlay 是否可见 */
const pilotVisible = ref(false)
/** 托管模式：'solo' | 'duel' */
const pilotMode = ref('solo')
/** 决策日志条目列表 */
const pilotLog = ref([])
/** 主循环是否正在运行 */
const pilotIsRunning = ref(false)
/** AbortController 实例（let，不做响应式） */
let pilotAbortCtrl = null

/**
 * 供应商 key → 显示标签
 * @param {string} name
 * @returns {string}
 */
function providerLabelOf(name) {
  return { anthropic: 'Claude', openai: 'GPT', deepseek: 'DeepSeek' }[name] ?? name ?? '未知'
}

/** 当前全局供应商的显示标签 */
const pilotProviderLabel = computed(() => providerLabelOf(getSettings().provider))

/** 是否满足启动单人托管的条件 */
const canStartSoloPilot = computed(() => {
  const s = getSettings()
  return !!(s.enabled && hasProviderConfigured(s.provider))
})

/** 不满足时的提示文案 */
const soloPilotDisabledReason = computed(() => {
  const s = getSettings()
  if (!s.enabled) return 'AI 未启用，请先到设置中启用'
  if (!hasProviderConfigured(s.provider)) return '当前供应商未配置 API Key'
  return ''
})

/**
 * 向 pilotLog 追加一条事件
 * @param {string} side  - 'A'（主 AI）或 'B'（对战 AI）
 * @param {object} event - 任意事件对象，at 字段若缺失则自动填充
 */
function pushPilotEvent(side, event) {
  pilotLog.value.push({
    step: pilotLog.value.length,
    at: event.at ?? Date.now(),
    side,
    ...event
  })
}

/**
 * 把 gameState refs + App.vue 已有方法包装为 game-actor 所需的 actions 对象。
 *
 * 接口对照：
 *   actor actions key   → App.vue 函数         说明
 *   ─────────────────────────────────────────────────────
 *   playHand()          → playHand()           同名，无需转换
 *   discard()           → discardCards()        名字不同，做映射
 *   buyJoker(joker)     → buyJoker(joker)       同名，actor 已查好完整 joker 对象传入
 *   sellJoker(joker)    → sellJoker(joker)      同名，actor 已查好完整 joker 对象传入
 *   rerollShop()        → rerollShop()          同名
 *   skipShop()          → closeShop()           名字不同，做映射
 *   selectBlind(id)     → selectBlind(id)       同名，传 blindId 字符串
 *   proceedToShop()     → （不存在，passBlind 自动走 openShop，actor 内有容错）
 *   startNextAnte()     → （不存在，closeShop 自动推进 ante，actor 内有容错）
 */
function makeActionsFor() {
  return {
    playHand:   () => playHand(),
    discard:    () => discardCards(),
    buyJoker:   (joker) => buyJoker(joker),
    sellJoker:  (joker) => sellJoker(joker),
    rerollShop: () => rerollShop(),
    skipShop:   () => closeShop(),
    selectBlind:(blindId) => selectBlind(blindId),
    // proceedToShop 不显式提供，game-actor 内部有 ?. 容错
    // startNextAnte 不显式提供，game-actor 内部有 ?. 容错
  }
}

/**
 * 把游戏状态重置到"准备开始一局"的状态，并进入 blind-select 阶段。
 * 直接复用已有的 initGame()，它内部会调 showBlindSelect()。
 */
function initGameStateForRun() {
  initGame()
}

/**
 * 启动单人 AI 托管模式。
 * 1. 检查 canStartSoloPilot；不满足则 toast 原因并退出
 * 2. 重置 game state（initGame → blind-select）
 * 3. 创建 AbortController + game-actor
 * 4. 展示 AiPilotMode overlay
 * 5. 调用 runAutoPilot 主循环
 */
async function startSoloPilot() {
  if (!canStartSoloPilot.value) {
    showToastMessage(soloPilotDisabledReason.value, 'warning')
    return
  }

  pilotMode.value = 'solo'
  pilotLog.value = []
  pilotIsRunning.value = true
  pilotVisible.value = true
  pilotAbortCtrl = new AbortController()

  // 重置游戏状态到 blind-select
  initGameStateForRun()
  await nextTick()

  const actor = createGameActor({
    refs: gameState,
    actions: makeActionsFor()
  })

  try {
    await runAutoPilot({
      actor,
      refs: gameState,
      signal: pilotAbortCtrl.signal,
      onTick: (event) => pushPilotEvent('A', event),
      providerHint: null // solo 用全局当前 provider，不 override
    })
  } catch (err) {
    if (err instanceof AiPilotAbort) {
      pushPilotEvent('A', { kind: 'end', at: Date.now(), reason: 'aborted' })
    } else {
      pushPilotEvent('A', { kind: 'error', at: Date.now(), error: { reason: err?.message ?? String(err) } })
    }
  } finally {
    pilotIsRunning.value = false
    pilotAbortCtrl = null
  }
}

/**
 * 中止当前 AI 托管，把控制权交还给玩家。
 * 游戏状态保留，玩家可继续手动操作。
 */
function abortPilot() {
  if (pilotAbortCtrl) {
    pilotAbortCtrl.abort()
    showToastMessage('AI 托管已中止，控制权交还给你', 'info')
  }
}

/**
 * 导出决策日志为 JSON 文件（浏览器 download blob 方式）。
 * 文件格式：{ version: 1, mode, exportedAt, entries: [...] }
 */
function exportPilotLog() {
  const payload = {
    version: 1,
    mode: pilotMode.value,
    exportedAt: new Date().toISOString(),
    entries: pilotLog.value
  }
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `balatro-pilot-log-${Date.now()}.json`
  a.click()
  URL.revokeObjectURL(url)
}

// ========== v1.10.0 A7：scene-aware 水晶球 computed ==========

/**
 * 当前应向 AiCoachOverlay 传递的 scene 字符串
 * - battle + 弃牌模式 → 'discard'
 * - battle + 出牌模式 → 'play'
 * - shop → 'shop'
 * - blind-select → 'blind'
 * - 其他 → null（Overlay 隐藏）
 */
const aiScene = computed(() => {
  if (runPhase.value === RUN_PHASES.BATTLE) return isDiscardMode.value ? 'discard' : 'play'
  if (runPhase.value === RUN_PHASES.SHOP) return 'shop'
  if (runPhase.value === RUN_PHASES.BLIND_SELECT) return 'blind'
  return null
})

/**
 * 是否显示 AiCoachOverlay（由 aiScene 驱动）
 */
const aiVisible = computed(() => aiScene.value !== null)

/**
 * 按 aiScene 组装对应 payload 传给 AiCoachOverlay
 * Overlay 内部会把 payload 传给对应的 request*Advice 函数
 */
const aiPayload = computed(() => {
  if (!aiScene.value) return null
  if (aiScene.value === 'play' || aiScene.value === 'discard') {
    return {
      hand: hand.value,
      ownedJokers: ownedJokers.value,
      blind: blind.value,
      handsLeft: handsLeft.value,
      discardsLeft: discardsLeft.value,
      money: money.value,
      lastPlayedHand: lastPlayedHand.value,
      totalScore: totalScore.value
    }
  }
  if (aiScene.value === 'shop') {
    return {
      shopJokers: shopJokersWithIds.value,
      ownedJokers: ownedJokersWithIds.value,
      money: money.value,
      currentAnte: currentAnte.value,
      blind: blind.value,
      lastPlayedHand: lastPlayedHand.value
    }
  }
  if (aiScene.value === 'blind') {
    return {
      candidateBlinds: availableBlindOptions.value,
      ownedJokers: ownedJokers.value,
      money: money.value,
      currentAnte: currentAnte.value,
      totalScore: totalScore.value,
      lastPlayedHand: lastPlayedHand.value
    }
  }
  return null
})

/**
 * 根据 aiShopAdvice 推断某个 Joker 的推荐类型
 * - action === 'buy' && targetId === joker.shopJokerId → 'buy'（金色）
 * - action === 'sell' && targetId === joker.ownedJokerId → 'sell'（红色）
 * - action === 'reroll' / 'skip'：不针对具体 Joker，全部返回 null；气泡文案由 Overlay 显示
 * @param {string} jokerId - shopJokerId 或 ownedJokerId
 * @returns {'buy' | 'sell' | null}
 */
function shopRecommendedKindOf(jokerId) {
  if (!aiShopAdvice.value) return null
  const { action, targetId } = aiShopAdvice.value
  if (action === 'buy' && targetId === jokerId) return 'buy'
  if (action === 'sell' && targetId === jokerId) return 'sell'
  return null
}

/**
 * 触发商店 AI 建议（A7 将把调用权交给 AiCoachOverlay；
 * 本步暴露此函数，A7 可通过 ref 或 provide/inject 直接调用）
 * 调用时机：runPhase === 'shop' 下点击水晶球
 */
/**
 * 商店阶段 AI 建议触发入口
 * A7 将把调用权转交 AiCoachOverlay（scene='shop' 分支），届时此函数仍可作为 fallback。
 * 当前本步暂不接任何 UI 入口，等 A7 统一整合 Overlay 后调用。
 */
async function requestShopAdviceNow() {
  if (runPhase.value !== RUN_PHASES.SHOP) return
  try {
    const result = await requestShopAdvice({
      shopJokers: shopJokersWithIds.value,
      ownedJokers: ownedJokersWithIds.value,
      money: money.value,
      currentAnte: currentAnte.value,
      blind: blind.value,
      lastPlayedHand: lastPlayedHand.value
    })
    aiShopAdvice.value = result
    // 调试：验证商店气泡数据结构（A7 接通 Overlay 后移除）
    console.log('[AI Shop Advice]', result)
  } catch (e) {
    aiShopAdvice.value = null
    showToastMessage(
      e?.reason === 'invalid_response' ? 'AI 返回了不可解析的结果' : `AI 建议失败：${e?.detail ?? e?.message ?? e}`,
      'warning'
    )
  }
}

// ========== v1.10.0 A5：盲注决策建议数据流 ==========

/**
 * AI 盲注选择建议结果
 * 结构：{ scene, action, blindId, riskLevel, reasoning, confidence }
 * blindId 对应 candidateBlinds 中某项的 id
 * @type {import('vue').Ref<{blindId:string,riskLevel:string,reasoning:string,confidence:number|null}|null>}
 */
const aiBlindAdvice = ref(null)

/**
 * 风险等级英文 → 中文映射
 * @param {'low'|'medium'|'high'|string} level
 * @returns {'低'|'中'|'高'|'未知'}
 */
function riskLabel(level) {
  const map = { low: '低', medium: '中', high: '高' }
  return map[level] ?? '未知'
}

/**
 * 判断指定盲注 ID 是否被 AI 推荐
 * 盲注推荐只有"推荐选这个"一种状态，没有"避开"
 * @param {string} blindId
 * @returns {'recommend' | null}
 */
function blindRecommendedKindOf(blindId) {
  if (!aiBlindAdvice.value) return null
  return aiBlindAdvice.value.blindId === blindId ? 'recommend' : null
}

/**
 * 触发盲注阶段 AI 建议
 * 调用时机：runPhase === 'blind-select'
 * 当前不接任何 UI 入口，A7 统一由 AiCoachOverlay scene='blind' 分支调用
 */
async function requestBlindAdviceNow() {
  if (runPhase.value !== RUN_PHASES.BLIND_SELECT) return
  // candidateBlinds 为空时跳过
  const candidates = availableBlindOptions.value
  if (!candidates || candidates.length === 0) return
  try {
    const payload = serializeBlindState({
      candidateBlinds: candidates,
      currentAnte: currentAnte.value,
      ownedJokers: ownedJokers.value,
      money: money.value,
      totalScore: totalScore.value,
      lastPlayedHand: lastPlayedHand.value
    })
    const result = await requestBlindAdvice(payload)
    // 兜底：LLM 返回的 blindId 不在 candidateBlinds 中时 console.warn（不影响 UI）
    const candidateIds = candidates.map(b => b.id)
    if (!candidateIds.includes(result.blindId)) {
      console.warn('[AI Blind Advice] 返回的 blindId 不在候选列表中：', result.blindId, '候选：', candidateIds)
    }
    aiBlindAdvice.value = result
    // 调试：验证盲注建议数据结构（A7 接通 Overlay 后移除）
    console.log('[AI Blind Advice]', result)
  } catch (e) {
    console.error('[AI Blind Advice] 失败：', e?.reason ?? e?.message ?? e)
    // 不污染 UI：catch 吞掉，aiBlindAdvice 保持不变（不主动清空，让用户看到上次建议）
  }
}

// 游戏核心 ref（deck/discardPile/hand 等 15 个）已通过 createGameState() 解构，此处不再重复声明。
const gameWon = ref(false)
const showPlayedCards = ref(false)
const maxJokers = 5
const HAND_SIZE = 8

const effectiveHandSize = computed(() => {
  if (blind.value?.bossRule?.key === 'LOW_HAND_SIZE') return HAND_SIZE - 1
  return HAND_SIZE
})
const triggeredJokerIds = ref([])
const shimmeringJokerIds = ref([])
const handCardRefs = ref([])
const playedCardRefs = ref([])
const playTableRef = ref(null)
const hudChipsRef = ref(null)
const hudMultRef = ref(null)
const showScoreFloat = ref(false)
const isResolvingHand = ref(false)
const battleChips = ref(0)
const battleMult = ref(1)
const showFinalFormula = ref(false)
const finalFormula = ref({ chips: 0, mult: 1, score: 0 })

// 本 ante 历史（用于 The Pillar 的 DEBUFF_PREVIOUS 与 The Ox 的 MOST_HAND_PENALTY）
const antePlayedCardKeys = ref(new Set())
const anteHandTypeCounts = ref({})
const mostPlayedHandTypeKey = ref(null)

function applyAntePillarDebuff(cards) {
  if (blind.value?.bossRule?.key !== 'DEBUFF_PREVIOUS') return
  cards.forEach(card => {
    const key = `${card.rank}-${card.suit}`
    if (antePlayedCardKeys.value.has(key)) {
      card.debuffed = true
    }
  })
}
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
// runPhase、completedBlindIds 已通过 createGameState() 解构，此处不再重复声明。
const selectedDeckOption = ref(STARTER_DECK_OPTIONS[0].key)
const selectedDifficultyOption = ref(DIFFICULTY_OPTIONS[0].key)
const selectedBlindId = ref(null)

const selectedDeckConfig = computed(
  () => STARTER_DECK_OPTIONS.find(option => option.key === selectedDeckOption.value) ?? STARTER_DECK_OPTIONS[0]
)
const selectedDifficultyConfig = computed(
  () => DIFFICULTY_OPTIONS.find(option => option.key === selectedDifficultyOption.value) ?? DIFFICULTY_OPTIONS[0]
)
// blind、currentAnte、currentAnteBlinds、availableBlindOptions 已通过 createGameState() 解构，此处不再重复声明。
const currentBlindProgress = computed(() => {
  const total = currentAnteBlinds.value.length
  const cleared = currentAnteBlinds.value.filter(item => completedBlindIds.value.includes(item.id)).length
  return `${cleared}/${total}`
})
const selectedCards = computed(() => hand.value.filter(card => card.selected))
const selectedCardCount = computed(() => selectedCards.value.length)
const canPlaySelectedCards = computed(
  () => !isResolvingHand.value && selectedCardCount.value >= 1 && selectedCardCount.value <= 5
)
const displayChips = computed(() => {
  if (isResolvingHand.value) return battleChips.value
  return selectedScorePreview.value.totalChips ?? 0
})
const displayMult = computed(() => {
  if (isResolvingHand.value) return battleMult.value
  return selectedScorePreview.value.totalMult ?? 1
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
    return { handType: null, totalChips: 0, totalMult: 1, score: 0 }
  }

  const handType = identifyHand(selectedCards.value)
  const events = buildScoreSequence(
    selectedCards.value,
    handType,
    ownedJokers.value,
    blind.value?.bossRule
  )
  const finalEvent = events[events.length - 1]
  return {
    handType,
    totalChips: finalEvent.chips,
    totalMult: finalEvent.mult,
    score: finalEvent.score
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
  // v1.10.0 A4：加入 shopJokerId 以供 shopRecommendedKindOf 使用
  shopJokers.value.map((joker, i) => {
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
      shopJokerId: `sh_${i}`,
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
  antePlayedCardKeys.value = new Set()
  anteHandTypeCounts.value = {}
  mostPlayedHandTypeKey.value = null
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

  // v1.10.0 A5：点击选择盲注后立即清空 AI 盲注推荐高亮
  aiBlindAdvice.value = null
  // v1.10.0 A6：进入 battle 时清空弃牌推荐高亮 + 弃牌模式
  aiDiscardRecommendedIds.value = []
  isDiscardMode.value = false

  // 进入 boss 之前冻结 most-played handType，供 The Ox 使用
  if (targetBlind.bossRule?.key === 'MOST_HAND_PENALTY') {
    let max = 0
    let topKey = null
    Object.entries(anteHandTypeCounts.value).forEach(([k, v]) => {
      if (v > max) {
        max = v
        topKey = k
      }
    })
    mostPlayedHandTypeKey.value = topKey
  } else {
    mostPlayedHandTypeKey.value = null
  }

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
  const size = effectiveHandSize.value
  const newCards = drawCards(size)
  applyAntePillarDebuff(newCards)
  hand.value = newCards
  scheduleReorderAfterDeal(size)
  audio.playSfx('cardDeal')
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

const isReorderingHand = ref(false)

/**
 * 用 FLIP 思路把手牌从当前 DOM 位置滑到排序后的目标位置：
 * 1) 记录每张牌的当前位置
 * 2) 应用排序（数据层重排）
 * 3) nextTick 后用 gsap.fromTo 让每张牌从旧位置滑动到新位置
 *
 * 全程 power2.out 0.35s，与 PlayingCard 入场（power2.out 0.4s）
 * 共享同一动画语言，让发牌→理牌的衔接连续。
 */
async function reorderHand() {
  if (isReorderingHand.value) return
  const sorted = getSortedHand(hand.value)
  const sameOrder = sorted.every((c, i) => c.id === hand.value[i]?.id)
  if (sameOrder) return

  isReorderingHand.value = true

  const oldRectsById = new Map()
  hand.value.forEach((card, i) => {
    const el = handCardRefs.value[i]?.cardRef
    if (el) oldRectsById.set(card.id, el.getBoundingClientRect())
  })

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
        duration: 0.35,
        ease: 'power2.out',
        clearProps: 'transform'
      }
    )
  })

  setTimeout(() => {
    isReorderingHand.value = false
  }, 360)
}

/**
 * 入场结束时机 = (newCardCount-1)×60 stagger + 400 duration。
 * 不再额外等 60ms 缓冲，让"发完"和"开始理"零间隙衔接，
 * 避免出现"先静止再突然滑动"的不连贯感。
 */
function scheduleReorderAfterDeal(newCardCount) {
  const totalEnterMs = Math.max(0, newCardCount - 1) * 60 + 400
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
  const needed = effectiveHandSize.value - hand.value.length
  if (needed > 0) {
    const newCards = drawCards(needed)
    applyAntePillarDebuff(newCards)
    hand.value.push(...newCards)
    scheduleReorderAfterDeal(needed)
    audio.playSfx('cardDeal')
  }
  onAiClear()
}

function toggleCard(card) {
  if (isResolvingHand.value || isReorderingHand.value) return
  if (!card.selected && selectedCardCount.value >= 5) {
    showToastMessage('最多只能选择 5 张牌', 'warning')
    return
  }
  card.selected = !card.selected
  if (card.selected) audio.playSfx('cardSelect')
}

async function playHand() {
  if (isResolvingHand.value) return
  onAiClear()
  const selected = selectedCards.value

  if (selected.length === 0) {
    showToastMessage('请先选择牌', 'warning')
    return
  }

  const handType = identifyHand(selected)
  const events = buildScoreSequence(selected, handType, ownedJokers.value, blind.value?.bossRule)
  const finalEvent = events[events.length - 1]
  const selectedSnapshot = [...selected]
  const selectedIds = new Set(selectedSnapshot.map(c => c.id))

  isResolvingHand.value = true
  handsLeft.value--
  lastPlayedHand.value = handType
  lastScore.value = 0
  triggeredJokerIds.value = []
  showPlayedCards.value = true
  audio.playSfx('cardPlay')

  // 1) 给每张已选牌 cloneNode 副本，挂到 body 上 fixed 定位
  //    原牌 visibility:hidden 保留占位（避免 hand-fan 立即 reflow）
  //    副本完全脱离 Vue 响应式，GSAP 操作不会被 :style patch 覆盖
  const orderedSelected = hand.value.filter(c => selectedIds.has(c.id))
  const cloneByCardId = new Map()
  const sourceElByCardId = new Map()

  hand.value.forEach((card, idx) => {
    if (!selectedIds.has(card.id)) return
    const sourceEl = handCardRefs.value[idx]?.cardRef
    if (!sourceEl) return
    sourceElByCardId.set(card.id, sourceEl)

    const rect = sourceEl.getBoundingClientRect()
    const clone = sourceEl.cloneNode(true)
    // 副本必须去掉 .selected：scoped CSS .playing-card.selected 自带
    // transform: translateY(-22px)，会和 GSAP 的 inline transform 冲突跳变
    clone.classList.remove('selected')
    clone.style.cssText = `
      position: fixed;
      left: ${rect.left}px;
      top: ${rect.top}px;
      width: ${rect.width}px;
      height: ${rect.height}px;
      margin: 0;
      z-index: 120;
      pointer-events: none;
      will-change: transform, opacity;
      transform: none;
    `
    document.body.appendChild(clone)
    cloneByCardId.set(card.id, clone)

    sourceEl.style.visibility = 'hidden'
  })

  // 2) 副本飞到桌面中央，按 selected 顺序错位排开
  const targetEl = playTableRef.value
  if (targetEl) {
    const dst = targetEl.getBoundingClientRect()
    const cardWidth = 88
    const cardHeight = 124
    const gap = 14
    const totalWidth = orderedSelected.length * cardWidth + Math.max(0, orderedSelected.length - 1) * gap
    const startLeft = dst.left + dst.width / 2 - totalWidth / 2
    const targetTop = dst.top + dst.height / 2 - cardHeight / 2

    orderedSelected.forEach((card, orderIdx) => {
      const clone = cloneByCardId.get(card.id)
      if (!clone) return
      const cloneRect = clone.getBoundingClientRect()
      const targetLeft = startLeft + orderIdx * (cardWidth + gap)
      const dx = targetLeft - cloneRect.left
      const dy = targetTop - cloneRect.top
      gsap.to(clone, {
        x: dx,
        y: dy,
        scale: 1.05,
        duration: 0.5,
        ease: 'power2.out',
        delay: orderIdx * 0.04
      })
    })
    await wait(560)
    targetEl.classList.add('impact')
    setTimeout(() => targetEl.classList.remove('impact'), 460)
  }

  // 3) screen-shake
  const shell = document.querySelector('.balatro-shell')
  shell?.classList.add('screen-shake')
  setTimeout(() => shell?.classList.remove('screen-shake'), 360)

  // 4) base：HUD 重置为牌型基础值
  battleChips.value = events[0].chips
  battleMult.value = events[0].mult
  await wait(360)

  // 5) 逐事件检验：飘字飞向 HUD，HUD 接收脉冲，battleChips/Mult 在到达瞬间跳值
  for (let i = 1; i < events.length - 1; i++) {
    const ev = events[i]
    if (ev.type === 'card') {
      const clone = cloneByCardId.get(ev.card.id)
      if (ev.debuffed) {
        if (clone) {
          // 被 debuff 的牌：仅轻微抖动 + 灰字 DEBUFF，不向 HUD 飘
          gsap.fromTo(
            clone,
            { x: '-=4' },
            { x: '+=4', duration: 0.12, yoyo: true, repeat: 3, ease: 'power1.inOut', clearProps: 'x' }
          )
          floatNumber(clone, 'DEBUFF', {
            color: '#8e7aa8',
            glow: 'rgba(142,122,168,0.6)',
            size: 18
          })
        }
        await wait(300)
      } else {
        if (clone) {
          gsap.to(clone, {
            y: '-=18',
            duration: 0.2,
            ease: 'power2.out',
            yoyo: true,
            repeat: 1
          })
          flyToHud(clone, hudChipsRef.value, `+${ev.chipsDelta}`, {
            color: '#5ac8fa',
            glow: 'rgba(90,200,250,0.85)',
            size: 26,
            duration: 0.5,
            onArrive: () => {
              pulseHudCol(hudChipsRef.value)
              battleChips.value = ev.totalChips
            }
          })
        } else {
          battleChips.value = ev.totalChips
        }
        await wait(400)
      }
    } else if (ev.type === 'joker') {
      const jokerId = ev.joker.id
      triggeredJokerIds.value = [...triggeredJokerIds.value, jokerId]
      audio.playSfx('jokerTrigger')
      const jokerEls = document.querySelectorAll('.joker-bar .joker-bar-row .joker-card:not(.empty)')
      const jokerEl = jokerEls[ev.jokerIndex]
      if (jokerEl) {
        burstJokerParticles(jokerEl, 10)
        if (ev.chipsDelta) {
          flyToHud(jokerEl, hudChipsRef.value, `+${ev.chipsDelta}`, {
            color: '#5ac8fa',
            glow: 'rgba(90,200,250,0.85)',
            size: 26,
            duration: 0.55,
            onArrive: () => {
              pulseHudCol(hudChipsRef.value)
              battleChips.value = ev.totalChips
            }
          })
        }
        if (ev.multDelta) {
          flyToHud(jokerEl, hudMultRef.value, `+${ev.multDelta}`, {
            color: '#ff5e7e',
            glow: 'rgba(255,94,126,0.85)',
            size: 26,
            duration: 0.55,
            onArrive: () => {
              pulseHudCol(hudMultRef.value)
              battleMult.value = ev.totalMult
            }
          })
        }
        if (!ev.chipsDelta && !ev.multDelta) {
          // 兜底：effect 没改 chips/mult（理论上 buildScoreSequence 已过滤）
          battleChips.value = ev.totalChips
          battleMult.value = ev.totalMult
        }
      } else {
        battleChips.value = ev.totalChips
        battleMult.value = ev.totalMult
      }
      await wait(620)
      triggeredJokerIds.value = triggeredJokerIds.value.filter(id => id !== jokerId)
    }
  }

  // 6) final 公式爆炸：中央弹出 chips × mult = score 大字
  await wait(180)
  finalFormula.value = {
    chips: finalEvent.chips,
    mult: finalEvent.mult,
    score: finalEvent.score
  }
  lastScore.value = finalEvent.score
  showFinalFormula.value = true
  await wait(1500)

  // 7) 公式 score 数字飞向 HUD 总分进度条，触发 totalScore 跳值
  const progressEl = document.querySelector('.hud-progress')
  const formulaEl = document.querySelector('.final-formula .ff-score')
  if (progressEl && formulaEl) {
    flyToHud(formulaEl, progressEl, `+${finalEvent.score}`, {
      color: '#ffd166',
      glow: 'rgba(255,209,102,0.95)',
      size: 36,
      duration: 0.55,
      onArrive: () => {
        totalScore.value += finalEvent.score
      }
    })
    await wait(560)
  } else {
    totalScore.value += finalEvent.score
  }
  showFinalFormula.value = false
  await wait(220)

  // 7) 副本淡出（自销毁）
  cloneByCardId.forEach(clone => {
    gsap.to(clone, {
      opacity: 0,
      scale: 0.85,
      duration: 0.28,
      ease: 'power2.in',
      onComplete: () => clone.remove()
    })
  })
  await wait(310)

  // 8) snapshot 剩余牌位置 → 数据移除 → FLIP 紧凑过渡
  const remainingCards = hand.value.filter(c => !selectedIds.has(c.id))
  const oldRectsById = new Map()
  remainingCards.forEach(card => {
    const idx = hand.value.findIndex(c => c.id === card.id)
    const el = handCardRefs.value[idx]?.cardRef
    if (el) oldRectsById.set(card.id, el.getBoundingClientRect())
  })

  discardPile.value.push(...selectedSnapshot.map(c => ({ ...c, selected: false })))
  hand.value = remainingCards
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
      { x: 0, y: 0, duration: 0.3, ease: 'power2.out', clearProps: 'transform' }
    )
  })

  // 8.5) Boss 后处理（按规则触发副作用）
  // - 非 boss：累加 ante 历史，供下一关 The Pillar / The Ox 使用
  if (blind.value.type !== 'boss') {
    selectedSnapshot.forEach(card => {
      antePlayedCardKeys.value.add(`${card.rank}-${card.suit}`)
    })
    anteHandTypeCounts.value = {
      ...anteHandTypeCounts.value,
      [handType.key]: (anteHandTypeCounts.value[handType.key] ?? 0) + 1
    }
  }
  // - The Ox：本回合若打出 most-played handType，金钱归零
  if (
    blind.value.bossRule?.key === 'MOST_HAND_PENALTY' &&
    mostPlayedHandTypeKey.value === handType.key &&
    money.value > 0
  ) {
    money.value = 0
    showToastMessage(`The Ox 触发：金钱清零！`, 'error')
  }
  // - The Hook：随机弃 2 张
  if (blind.value.bossRule?.key === 'DRAW_2_DISCARD' && hand.value.length > 0) {
    const drawCount = Math.min(2, hand.value.length)
    const indices = []
    while (indices.length < drawCount) {
      const idx = Math.floor(Math.random() * hand.value.length)
      if (!indices.includes(idx)) indices.push(idx)
    }
    const toDiscard = indices.map(i => hand.value[i])
    hand.value = hand.value.filter((_, i) => !indices.includes(i))
    discardPile.value.push(...toDiscard.map(c => ({ ...c, selected: false })))
    showToastMessage(`The Hook 触发：随机弃 ${drawCount} 张`, 'warning')
  }

  // 9) 清场
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
  onAiClear()
  // v1.10.0 A6：实际弃牌时同步清空弃牌推荐高亮 + 退出弃牌模式
  aiDiscardRecommendedIds.value = []
  isDiscardMode.value = false
  const selected = selectedCards.value

  if (selected.length === 0) {
    showToastMessage('请选择要弃掉的牌', 'warning')
    return
  }

  if (discardsLeft.value === 0) {
    showToastMessage('弃牌次数已用完', 'error')
    return
  }

  audio.playSfx('cardDiscard')
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
    audio.playSfx('bossDefeat')
    burstParticles(36)
    // 进入下一 ante，重置 ante 历史
    antePlayedCardKeys.value = new Set()
    anteHandTypeCounts.value = {}
    mostPlayedHandTypeKey.value = null
  } else {
    audio.playSfx('blindPass')
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

  // v1.10.0 A4：刷新商店时清空 AI 建议高亮
  aiShopAdvice.value = null
  money.value -= 1
  audio.playSfx('shopReroll')
  openShop()
  showToastMessage('商店已刷新', 'info')
}

function closeShop() {
  // v1.10.0 A4：跳过商店时清空 AI 建议高亮
  aiShopAdvice.value = null
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

  // v1.10.0 A4：购买后清空 AI 建议高亮
  aiShopAdvice.value = null
  money.value -= joker.price
  ownedJokers.value.push({ ...joker })
  shopJokers.value = shopJokers.value.filter(item => item.id !== joker.id)
  audio.playSfx('shopBuy')
  showToastMessage(`购买了 ${joker.name}`, 'success')
}

function sellJoker(joker) {
  // v1.10.0 A4：卖出后清空 AI 建议高亮
  aiShopAdvice.value = null
  const sellPrice = Math.floor(joker.price / 2)
  money.value += sellPrice
  ownedJokers.value = ownedJokers.value.filter(item => item !== joker)
  audio.playSfx('shopSell')
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

function unlockOnFirstInteraction() {
  audio.unlock()
  audio.preloadSfx()
  if (runPhase.value === RUN_PHASES.GAME_OVER) {
    audio.playBgm(gameWon.value ? 'win' : 'lose')
  } else {
    const track = PHASE_TO_BGM[runPhase.value]
    if (track) audio.playBgm(track)
  }
  window.removeEventListener('pointerdown', unlockOnFirstInteraction)
  window.removeEventListener('keydown', unlockOnFirstInteraction)
}

function delegateButtonSfx(e) {
  const target = e.target
  if (!(target instanceof Element)) return
  const btn = target.closest('button, [role="button"]')
  if (!btn) return
  if (btn.dataset.noSfx === 'true') return
  if (e.type === 'pointerdown') audio.playSfx('uiClick')
  else if (e.type === 'pointerenter') audio.playSfx('uiHover')
}

watch(runPhase, (next) => {
  if (next === RUN_PHASES.GAME_OVER) {
    audio.playSfx(gameWon.value ? 'winStinger' : 'loseStinger')
    audio.playBgm(gameWon.value ? 'win' : 'lose')
    return
  }
  // v1.10.0 A7：阶段切换时统一清空所有 4 路 AI 建议（onAiClear 内部清空全部）
  onAiClear()
  // 退出 battle 时重置弃牌模式
  if (next !== RUN_PHASES.BATTLE) isDiscardMode.value = false
  const track = PHASE_TO_BGM[next]
  audio.playBgm(track)
}, { immediate: false })

onMounted(() => {
  setRunPhase(RUN_PHASES.SETUP)
  window.addEventListener('pointerdown', unlockOnFirstInteraction)
  window.addEventListener('keydown', unlockOnFirstInteraction)
  document.addEventListener('pointerdown', delegateButtonSfx)
  document.addEventListener('pointerenter', delegateButtonSfx, true)
})

onBeforeUnmount(() => {
  window.removeEventListener('pointerdown', unlockOnFirstInteraction)
  window.removeEventListener('keydown', unlockOnFirstInteraction)
  document.removeEventListener('pointerdown', delegateButtonSfx)
  document.removeEventListener('pointerenter', delegateButtonSfx, true)
})
</script>

<template>
  <div class="balatro-shell">
    <!-- 全局设置入口（任意 phase 可见） -->
    <button
      class="hud-icon-btn settings-trigger"
      data-no-sfx="true"
      aria-label="设置"
      @click="openSettings"
    >⚙</button>
    <SettingsPanel :open="settingsOpen" @close="closeSettings" />

    <!-- 牌型弹出 banner -->
    <Transition name="hand-type-pop">
      <div
        v-if="showPlayedCards && lastPlayedHand"
        class="hand-type-banner"
      >
        {{ lastPlayedHand.name }}
      </div>
    </Transition>

    <!-- final 公式爆炸（取代原 +score 飘字） -->
    <Transition name="final-formula">
      <div v-if="showFinalFormula" class="final-formula">
        <span class="ff-chips">{{ finalFormula.chips }}</span>
        <span class="ff-op">×</span>
        <span class="ff-mult">{{ finalFormula.mult }}</span>
        <span class="ff-op">=</span>
        <span class="ff-score">{{ finalFormula.score }}</span>
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

            <!-- v1.11.0 B6：AI 托管模式入口 -->
            <button
              class="btn-ai-pilot"
              :disabled="!canStartSoloPilot"
              :title="soloPilotDisabledReason || 'AI 自动完成 blind-select → battle → shop 全循环'"
              @click="startSoloPilot"
            >
              🔮 AI 托管模式
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
                <span class="chip-tag muted">底注 {{ currentAnte }}/{{ TOTAL_ANTES }}</span>
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
                boss: blindOption.type === 'boss',
                'blind-card-recommended': blindRecommendedKindOf(blindOption.id) === 'recommend'
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
            <!-- v1.10.0 A7：盲注阶段水晶球 -->
            <AiCoachOverlay
              :visible="aiVisible && isBlindSelectPhase"
              :scene="aiScene"
              :payload="aiPayload"
              @recommend="onAiRecommend"
              @clear="onAiClear"
              @toast="onAiToast"
            />
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
              <!-- v1.10.0 A7：商店阶段水晶球 -->
              <AiCoachOverlay
                :visible="aiVisible && isShopPhase"
                :scene="aiScene"
                :payload="aiPayload"
                @recommend="onAiRecommend"
                @clear="onAiClear"
                @toast="onAiToast"
              />
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
                  <!-- v1.10.0 A4：接入商店建议高亮（buy） -->
                  <JokerCard
                    :joker="joker"
                    size="shop"
                    :show-tooltip="false"
                    :shimmering="shimmeringJokerIds.includes(joker.id)"
                    context="shop"
                    :recommended="shopRecommendedKindOf(joker.shopJokerId)"
                    @longpress="showJokerDetail"
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
              <!-- v1.10.0 A4：接入商店建议高亮（sell），用 ownedJokersWithIds 提供稳定 ownedJokerId -->
              <JokerCard
                v-for="(joker, idx) in ownedJokersWithIds"
                :key="joker.id"
                :joker="joker"
                size="normal"
                context="owned"
                :recommended="shopRecommendedKindOf(joker.ownedJokerId)"
                @click="requestSellJoker(joker)"
                @longpress="showJokerDetail"
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
            {{ gameWon ? `击败全部 ${TOTAL_ANTES} 层底注` : `你未能击败 ${blind.name}` }}
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
            <div class="hud-score-col chips" ref="hudChipsRef">
              <span class="hud-score-val chips-color">
                <ScoreCounter :value="displayChips" :duration="0.4" />
              </span>
              <span class="hud-score-label">筹码</span>
            </div>
            <div class="hud-score-col mult" ref="hudMultRef">
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
              <span class="hud-meta-val">{{ currentAnte }}/{{ TOTAL_ANTES }}</span>
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

        <!-- AI 教练 + 弃牌模式切换 + 设置（战斗阶段 HUD 顶部右侧） -->
        <div class="hud-top-right">
          <!-- 弃牌模式开关：出牌 ↔ 弃牌 -->
          <button
            class="discard-mode-btn"
            :class="{ 'is-discard-mode': isDiscardMode }"
            :title="isDiscardMode ? '切换到出牌模式' : '切换到弃牌模式'"
            data-no-sfx="true"
            @click="toggleDiscardMode"
          >
            {{ isDiscardMode ? '出' : '弃' }}
          </button>
          <!-- v1.10.0 A7：battle 阶段统一用 scene-aware AiCoachOverlay -->
          <AiCoachOverlay
            :visible="aiVisible && isBattlePhase"
            :scene="aiScene"
            :payload="aiPayload"
            @recommend="onAiRecommend"
            @clear="onAiClear"
            @toast="onAiToast"
          />
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
              context="owned"
              :triggering="triggeredJokerIds.includes(joker.id)"
              @longpress="showJokerDetail"
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
            <div v-if="selectedScorePreview.handType" class="preview-formula">
              <span class="formula-hand-type">{{ selectedScorePreview.handType.name }}</span>
              <span class="formula-row">
                <span class="formula-chips">{{ selectedScorePreview.totalChips }}</span>
                <span class="formula-op">×</span>
                <span class="formula-mult">{{ selectedScorePreview.totalMult }}</span>
                <span class="formula-op">=</span>
                <span class="formula-score">{{ selectedScorePreview.score }}</span>
              </span>
            </div>
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
              :recommended="recommendedKindOf(card.id)"
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

    <!-- 移动端：长按 Joker 详情浮窗 -->
    <JokerDetailPopover
      :open="detailJoker !== null"
      :joker="detailJoker"
      :context="detailContext"
      @close="closeJokerDetail"
    />

    <!-- v1.11.0 B6：AI 托管模式全屏 overlay（内部 Teleport 到 body） -->
    <AiPilotMode
      :visible="pilotVisible"
      :mode="pilotMode"
      :refsA="gameState"
      :providerLabelA="pilotProviderLabel"
      :log="pilotLog"
      :is-running="pilotIsRunning"
      @abort="abortPilot"
      @export-log="exportPilotLog"
      @close="pilotVisible = false"
    />

    <!-- 移动端：横屏遮罩（z-index 最高，最后挂载） -->
    <OrientationGuard />
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

/* v1.11.0 B6：AI 托管模式入口按钮（金紫色调） */
.btn-ai-pilot {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  margin-top: 10px;
  padding: 13px 28px;
  font-size: 14px;
  font-weight: 900;
  letter-spacing: 1px;
  border-radius: 14px;
  border: 2px solid rgba(179, 136, 255, 0.4);
  background: linear-gradient(180deg, #7c3aed, #4c1d95);
  color: #f3e8ff;
  box-shadow: 0 4px 0 rgba(0,0,0,.4), 0 0 16px rgba(124, 58, 237, 0.3);
  cursor: pointer;
  user-select: none;
  transition: transform 0.15s ease, box-shadow 0.15s ease, opacity 0.15s ease;
}
.btn-ai-pilot:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 6px 0 rgba(0,0,0,.4), 0 0 24px rgba(124, 58, 237, 0.5);
}
.btn-ai-pilot:disabled {
  opacity: 0.4;
  cursor: not-allowed;
  transform: none;
}

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

/* v1.10.0 A5：AI 推荐盲注 — 金色描边 + 金色脉冲阴影 */
.blind-card-recommended {
  border-color: #f0b94f;
  box-shadow: 0 12px 24px rgba(0,0,0,.45), 0 0 0 3px rgba(240,185,79,.45);
  animation: blind-card-recommend-pulse 1.5s ease-in-out infinite;
}
@keyframes blind-card-recommend-pulse {
  0%, 100% { box-shadow: 0 12px 24px rgba(0,0,0,.45), 0 0 16px 4px rgba(240,185,79,.35); }
  50%      { box-shadow: 0 12px 24px rgba(0,0,0,.45), 0 0 28px 8px rgba(240,185,79,.75); }
}

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
.preview-formula {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}
.formula-hand-type {
  font-family: 'Press Start 2P', monospace;
  font-size: 16px;
  color: var(--purple);
  letter-spacing: 2px;
  text-shadow: 0 2px 0 rgba(0,0,0,0.6);
}
.formula-row {
  display: inline-flex;
  align-items: baseline;
  gap: 14px;
  font-family: 'Press Start 2P', monospace;
  font-weight: 900;
}
.formula-row .formula-chips {
  color: var(--chips);
  font-size: 30px;
  text-shadow: 0 2px 0 rgba(0,0,0,0.7), 0 0 14px rgba(90,200,250,0.55);
}
.formula-row .formula-mult {
  color: var(--mult);
  font-size: 30px;
  text-shadow: 0 2px 0 rgba(0,0,0,0.7), 0 0 14px rgba(255,94,126,0.55);
}
.formula-row .formula-score {
  color: var(--gold);
  font-size: 34px;
  text-shadow: 0 2px 0 rgba(0,0,0,0.7), 0 0 16px rgba(255,209,102,0.7);
}
.formula-row .formula-op {
  color: var(--text-dim);
  font-size: 22px;
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
  .blind-select-cards {
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

/* 全局设置齿轮按钮（fixed 右上角，所有 phase 可见） */
.hud-icon-btn.settings-trigger {
  position: fixed;
  top: 16px;
  right: 16px;
  width: 44px;
  height: 44px;
  border-radius: 12px;
  background: rgba(20, 14, 36, 0.78);
  border: 1px solid rgba(255, 209, 102, 0.45);
  color: #ffd166;
  font-size: 20px;
  cursor: pointer;
  z-index: 250;
  display: grid;
  place-items: center;
  transition: transform 0.15s ease, background 0.15s ease;
  box-shadow: 0 4px 0 rgba(0, 0, 0, 0.45);
}
.hud-icon-btn.settings-trigger:hover {
  transform: rotate(45deg);
  background: rgba(40, 26, 70, 0.9);
}

/* AI 教练：战斗 HUD 顶部右侧容器 */
.hud-top-right {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 10px;
  padding: 0 6px;
}

/* v1.10.0 A7：弃牌模式切换按钮 */
.discard-mode-btn {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: 2px solid var(--gold, #ffd166);
  background: radial-gradient(circle at 35% 30%, #2d1f55, #1a1330 80%);
  color: var(--gold, #ffd166);
  font-family: 'Press Start 2P', monospace;
  font-size: 10px;
  cursor: pointer;
  display: grid;
  place-items: center;
  box-shadow: 0 0 8px 1px rgba(255, 209, 102, .35);
  transition: border-color 0.2s, box-shadow 0.2s;
}
.discard-mode-btn:hover {
  box-shadow: 0 0 14px 3px rgba(255, 209, 102, .65);
}
.discard-mode-btn.is-discard-mode {
  border-color: var(--danger, #e34b6f);
  color: var(--danger, #e34b6f);
  box-shadow: 0 0 8px 1px rgba(227, 75, 111, .45);
}
.discard-mode-btn.is-discard-mode:hover {
  box-shadow: 0 0 14px 3px rgba(227, 75, 111, .8);
}
</style>
