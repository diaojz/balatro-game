import {
  AI_PROVIDERS,
  AI_STORAGE_KEY,
  DEFAULT_AI_SETTINGS,
  COACH_THROTTLE_MS,
  COACH_REQUEST_TIMEOUT_MS,
  COACH_SYSTEM_PROMPT,
  DISCARD_SYSTEM_PROMPT,
  SHOP_SYSTEM_PROMPT,
  BLIND_SYSTEM_PROMPT,
  COACH_SCENES,
  COACH_SCENE_KEYS
} from '../config/ai.js'

export class AiCoachError extends Error {
  constructor(reason, detail) {
    super(reason)
    this.reason = reason
    this.detail = detail
  }
}

const settings = loadSettings()

// 节流字典：4 个场景独立计数
const lastRequest = Object.fromEntries(COACH_SCENE_KEYS.map(k => [k, { fp: null, at: 0 }]))

function loadSettings() {
  try {
    const raw = localStorage.getItem(AI_STORAGE_KEY)
    if (raw) return { ...DEFAULT_AI_SETTINGS, ...JSON.parse(raw) }
  } catch (_) { /* ignore */ }
  return { ...DEFAULT_AI_SETTINGS }
}

function saveSettings() {
  try {
    localStorage.setItem(AI_STORAGE_KEY, JSON.stringify(settings))
  } catch (_) { /* ignore */ }
}

export function getSettings() {
  return { ...settings }
}

export function updateSettings(patch) {
  Object.assign(settings, patch)
  // 切换供应商时自动跟随该供应商默认模型
  if ('provider' in patch && !('model' in patch)) {
    settings.model = AI_PROVIDERS[settings.provider].defaultModel
  }
  saveSettings()
}

// ============== 序列化函数 ==============

/**
 * 出牌 / 弃牌场景共用：把游戏状态序列化为 LLM 可消费的最小 payload
 * 字段名遵循 v1.9.0 现有代码（blind.targetScore / lastPlayedHand.name 保持）
 */
export function serializePlayState({ hand, ownedJokers, blind, handsLeft, discardsLeft, money, lastPlayedHand, totalScore }) {
  return {
    blind: {
      name: blind?.name,
      type: blind?.type,
      score: blind?.targetScore,
      bossRuleKey: blind?.bossRule?.key ?? null,
      bossRuleText: blind?.bossRule?.description ?? null
    },
    resources: {
      handsLeft, discardsLeft, money,
      currentScore: totalScore
    },
    hand: hand.map(c => ({
      id: c.id,
      rank: c.rank,
      suit: c.suit,
      debuffed: !!c.debuffed
    })),
    jokers: (ownedJokers || []).map(j => ({
      id: j.id,
      name: j.name,
      description: j.description
    })),
    // lastPlayedHand.name 对应现有代码字段（v1.9.0 中 lastPlayedHand 是 hand 识别结果，用 .name）
    lastPlayedHand: lastPlayedHand
      ? {
          handType: lastPlayedHand.name,
          score: lastPlayedHand.score ?? 0
        }
      : null
  }
}

/**
 * 商店场景序列化
 */
export function serializeShopState({ shopJokers, ownedJokers, money, currentAnte, blind, lastPlayedHand }) {
  return {
    resources: { money, currentAnte, nextBlind: blind?.name ?? null },
    shopJokers: (shopJokers || []).map(j => ({
      shopJokerId: j.shopJokerId,
      id: j.id,
      name: j.name,
      description: j.description,
      price: j.price,
      rarity: j.rarity
    })),
    ownedJokers: (ownedJokers || []).map(j => ({
      ownedJokerId: j.ownedJokerId,
      id: j.id,
      name: j.name,
      description: j.description,
      sellValue: j.sellValue ?? Math.ceil((j.price || 2) / 2)
    })),
    rerollCost: 1,
    lastPlayedHand: lastPlayedHand
      ? { handType: lastPlayedHand.name, score: lastPlayedHand.score ?? 0 }
      : null
  }
}

/**
 * 盲注选择场景序列化
 */
export function serializeBlindState({ candidateBlinds, ownedJokers, money, currentAnte, totalScore, lastPlayedHand }) {
  return {
    resources: { money, currentAnte, currentScore: totalScore },
    candidateBlinds: (candidateBlinds || []).map(b => ({
      id: b.id,
      name: b.name,
      type: b.type,
      score: b.score,
      reward: b.reward,
      bossRuleKey: b.bossRule?.key ?? null,
      bossRuleText: b.bossRule?.description ?? null,
      isCompleted: !!b.isCompleted,
      isUnlocked: !!b.isUnlocked
    })),
    ownedJokers: (ownedJokers || []).map(j => ({
      id: j.id,
      name: j.name,
      description: j.description
    })),
    lastPlayedHand: lastPlayedHand
      ? { handType: lastPlayedHand.name, score: lastPlayedHand.score ?? 0 }
      : null
  }
}

// ============== 工具函数 ==============

/**
 * 生成稳定指纹字符串，用于节流去重
 */
function fingerprint(scene, state) {
  if (scene === 'play' || scene === 'discard') {
    return `${scene}|${(state.hand || []).map(c => c.id).sort().join(',')}|${state.discardsLeft}`
  }
  if (scene === 'shop') {
    return `shop|${(state.shopJokers || []).map(j => j.shopJokerId).sort().join(',')}|${state.money}`
  }
  if (scene === 'blind') {
    return `blind|${(state.candidateBlinds || []).map(b => b.id).sort().join(',')}|${state.currentAnte}`
  }
  return `${scene}|*`
}

/**
 * 按 scene 独立节流检查；相同 fingerprint 在 COACH_THROTTLE_MS 内禁止重复请求
 */
function checkThrottle(scene, fp) {
  const slot = lastRequest[scene]
  const now = Date.now()
  if (slot.fp === fp && now - slot.at < COACH_THROTTLE_MS) {
    throw new AiCoachError('throttled', `请等待 ${Math.ceil((COACH_THROTTLE_MS - (now - slot.at)) / 1000)}s`)
  }
  slot.fp = fp
  slot.at = now
}

/**
 * 把 confidence 数值夹到 [0, 1]，非数字返回 null
 */
function clampConfidence(v) {
  if (typeof v !== 'number') return null
  return Math.max(0, Math.min(1, v))
}

// ============== Payload 构建器（接收 systemPrompt 参数）==============

function buildDeepSeekPayload(systemPrompt, payload) {
  return {
    body: {
      model: settings.model,
      max_tokens: settings.maxTokens,
      temperature: settings.temperature,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: `当前游戏状态：\n${JSON.stringify(payload, null, 2)}\n\n请输出 JSON。` }
      ]
    },
    headers: {
      'content-type': 'application/json',
      'authorization': `Bearer ${settings.apiKey}`
    },
    parseResponse: (json) => json?.choices?.[0]?.message?.content ?? ''
  }
}

function buildAnthropicPayload(systemPrompt, payload) {
  return {
    body: {
      model: settings.model,
      max_tokens: settings.maxTokens,
      temperature: settings.temperature,
      system: systemPrompt,
      messages: [
        { role: 'user', content: `当前游戏状态：\n${JSON.stringify(payload, null, 2)}\n\n请输出 JSON。` }
      ]
    },
    headers: {
      'content-type': 'application/json',
      'x-api-key': settings.apiKey,
      ...AI_PROVIDERS.anthropic.extraHeaders
    },
    parseResponse: (json) => json?.content?.[0]?.text ?? ''
  }
}

function buildOpenAIPayload(systemPrompt, payload) {
  return {
    body: {
      model: settings.model,
      max_tokens: settings.maxTokens,
      temperature: settings.temperature,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: `当前游戏状态：\n${JSON.stringify(payload, null, 2)}\n\n请输出 JSON。` }
      ]
    },
    headers: {
      'content-type': 'application/json',
      'authorization': `Bearer ${settings.apiKey}`
    },
    parseResponse: (json) => json?.choices?.[0]?.message?.content ?? ''
  }
}

// ============== LLM 调用内核 ==============

/**
 * 所有场景共用的 LLM fetch 内核
 * @param {string} systemPrompt - 当前场景的 system prompt
 * @param {object} userJsonPayload - 已序列化的游戏状态
 * @returns {Promise<object>} 已解析的 JSON 对象
 */
async function callLLM(systemPrompt, userJsonPayload) {
  if (!settings.enabled) throw new AiCoachError('disabled')
  if (!settings.apiKey)  throw new AiCoachError('no_api_key')

  const provider = AI_PROVIDERS[settings.provider]
  if (!provider) throw new AiCoachError('unknown_provider', settings.provider)

  const built = settings.provider === 'anthropic'
    ? buildAnthropicPayload(systemPrompt, userJsonPayload)
    : settings.provider === 'deepseek'
      ? buildDeepSeekPayload(systemPrompt, userJsonPayload)
      : buildOpenAIPayload(systemPrompt, userJsonPayload)

  const ctrl = new AbortController()
  const timeout = setTimeout(() => ctrl.abort(), COACH_REQUEST_TIMEOUT_MS)

  let resp
  try {
    resp = await fetch(provider.endpoint, {
      method: 'POST',
      headers: built.headers,
      body: JSON.stringify(built.body),
      signal: ctrl.signal
    })
  } catch (e) {
    clearTimeout(timeout)
    if (e.name === 'AbortError') throw new AiCoachError('timeout')
    throw new AiCoachError('network', e.message)
  }
  clearTimeout(timeout)

  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    throw new AiCoachError('http_error', `${resp.status} ${text.slice(0, 120)}`)
  }
  const json = await resp.json().catch(() => null)
  const rawText = built.parseResponse(json)
  if (!rawText) throw new AiCoachError('empty_response')
  return parseRawJson(rawText)
}

function parseRawJson(rawText) {
  try {
    // 容错：有些模型仍可能裹一层 ```json ... ```，剥掉
    const cleaned = rawText.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim()
    return JSON.parse(cleaned)
  } catch (e) {
    throw new AiCoachError('invalid_response', `非 JSON: ${rawText.slice(0, 80)}`)
  }
}

// ============== 校验函数 ==============

function validatePlayAdvice(advice, hand) {
  if (!advice || typeof advice !== 'object') throw new AiCoachError('invalid_response', '空对象')
  if (!Array.isArray(advice.recommendedCardIds) || advice.recommendedCardIds.length < 1 || advice.recommendedCardIds.length > 5) {
    throw new AiCoachError('invalid_response', 'recommendedCardIds 长度非法')
  }
  const handIdSet = new Set(hand.map(c => c.id))
  if (!advice.recommendedCardIds.every(id => handIdSet.has(id))) {
    throw new AiCoachError('invalid_response', '推荐牌不在手牌中')
  }
  return {
    scene: 'play',
    action: advice.action ?? 'play',
    recommendedCardIds: advice.recommendedCardIds,
    handType: String(advice.handType ?? '').slice(0, 32),
    reasoning: String(advice.reasoning ?? '').slice(0, 80),
    confidence: clampConfidence(advice.confidence)
  }
}

function validateDiscardAdvice(advice, hand) {
  if (!advice || !Array.isArray(advice.discardCardIds) || advice.discardCardIds.length < 1 || advice.discardCardIds.length > 5) {
    throw new AiCoachError('invalid_response', 'discardCardIds 长度非法')
  }
  const handIdSet = new Set(hand.map(c => c.id))
  if (!advice.discardCardIds.every(id => handIdSet.has(id))) {
    throw new AiCoachError('invalid_response', '推荐弃牌不在手牌中')
  }
  return {
    scene: 'discard',
    action: 'discard',
    discardCardIds: advice.discardCardIds,
    reasoning: String(advice.reasoning ?? '').slice(0, 80),
    confidence: clampConfidence(advice.confidence)
  }
}

function validateShopAdvice(advice, shopState) {
  const allowed = new Set(['buy', 'sell', 'reroll', 'skip'])
  if (!advice || !allowed.has(advice.action)) {
    throw new AiCoachError('invalid_response', `action 非法: ${advice?.action}`)
  }
  if (advice.action === 'buy') {
    const ids = new Set((shopState.shopJokers || []).map(j => j.shopJokerId))
    if (!ids.has(advice.targetId)) throw new AiCoachError('invalid_response', 'buy targetId 不在商店中')
  }
  if (advice.action === 'sell') {
    const ids = new Set((shopState.ownedJokers || []).map(j => j.ownedJokerId))
    if (!ids.has(advice.targetId)) throw new AiCoachError('invalid_response', 'sell targetId 不在背包中')
  }
  return {
    scene: 'shop',
    action: advice.action,
    targetId: advice.targetId ?? null,
    reasoning: String(advice.reasoning ?? '').slice(0, 80),
    confidence: clampConfidence(advice.confidence)
  }
}

function validateBlindAdvice(advice, candidateBlinds) {
  const ids = new Set((candidateBlinds || []).map(b => b.id))
  if (!advice || !ids.has(advice.blindId)) {
    throw new AiCoachError('invalid_response', `blindId 不在候选盲注中`)
  }
  const validRisk = ['low', 'medium', 'high']
  return {
    scene: 'blind',
    action: 'select',
    blindId: advice.blindId,
    riskLevel: validRisk.includes(advice.riskLevel) ? advice.riskLevel : 'medium',
    reasoning: String(advice.reasoning ?? '').slice(0, 80),
    confidence: clampConfidence(advice.confidence)
  }
}

// ============== 四个对外函数 ==============

/**
 * 出牌建议（继承 v1.9.0，重命名）
 */
export async function requestPlayAdvice(gameState) {
  checkThrottle(COACH_SCENES.PLAY, fingerprint('play', gameState))
  const state = serializePlayState(gameState)
  const advice = await callLLM(COACH_SYSTEM_PROMPT, state)
  return validatePlayAdvice(advice, gameState.hand)
}

/**
 * 旧名别名，保持向后兼容——v1.9.0 的 AiCoachOverlay.vue 不需要任何修改
 */
export const requestCoachAdvice = requestPlayAdvice

/**
 * 弃牌建议（v1.10.0 新增）
 */
export async function requestDiscardAdvice(gameState) {
  if (gameState.discardsLeft <= 0) {
    throw new AiCoachError('no_discards_left', '本回合已无弃牌次数')
  }
  checkThrottle(COACH_SCENES.DISCARD, fingerprint('discard', gameState))
  const state = serializePlayState(gameState)  // 弃牌与出牌共享 game state shape
  const advice = await callLLM(DISCARD_SYSTEM_PROMPT, state)
  return validateDiscardAdvice(advice, gameState.hand)
}

/**
 * 商店建议（v1.10.0 新增）
 */
export async function requestShopAdvice(shopState) {
  checkThrottle(COACH_SCENES.SHOP, fingerprint('shop', shopState))
  const state = serializeShopState(shopState)
  const advice = await callLLM(SHOP_SYSTEM_PROMPT, state)
  return validateShopAdvice(advice, shopState)
}

/**
 * 盲注选择建议（v1.10.0 新增）
 */
export async function requestBlindAdvice(blindState) {
  checkThrottle(COACH_SCENES.BLIND, fingerprint('blind', blindState))
  const state = serializeBlindState(blindState)
  const advice = await callLLM(BLIND_SYSTEM_PROMPT, state)
  return validateBlindAdvice(advice, blindState.candidateBlinds)
}

// ============== 设置面板：测试连接 ==============

/**
 * 向 LLM 供应商发送最小 payload，确认 API Key 与网络可用
 */
export async function pingProvider() {
  const provider = AI_PROVIDERS[settings.provider]
  if (!provider) throw new AiCoachError('unknown_provider')
  if (!settings.apiKey) throw new AiCoachError('no_api_key')

  const minimalState = {
    blind: { name: 'test', type: 'small', score: 1, bossRuleKey: null, bossRuleText: null },
    resources: { handsLeft: 4, discardsLeft: 3, money: 0, currentScore: 0 },
    hand: [
      { id: 'tH1', rank: 14, suit: 'hearts',   debuffed: false },
      { id: 'tS1', rank: 14, suit: 'spades',   debuffed: false }
    ],
    jokers: [],
    lastPlayedHand: null
  }
  const built = settings.provider === 'anthropic'
    ? buildAnthropicPayload(COACH_SYSTEM_PROMPT, minimalState)
    : settings.provider === 'deepseek'
      ? buildDeepSeekPayload(COACH_SYSTEM_PROMPT, minimalState)
      : buildOpenAIPayload(COACH_SYSTEM_PROMPT, minimalState)

  const ctrl = new AbortController()
  const timeout = setTimeout(() => ctrl.abort(), COACH_REQUEST_TIMEOUT_MS)
  try {
    const resp = await fetch(provider.endpoint, {
      method: 'POST',
      headers: built.headers,
      body: JSON.stringify(built.body),
      signal: ctrl.signal
    })
    clearTimeout(timeout)
    if (!resp.ok) {
      const text = await resp.text().catch(() => '')
      throw new AiCoachError('http_error', `${resp.status} ${text.slice(0, 120)}`)
    }
    return { ok: true }
  } catch (e) {
    clearTimeout(timeout)
    if (e instanceof AiCoachError) throw e
    if (e.name === 'AbortError') throw new AiCoachError('timeout')
    throw new AiCoachError('network', e.message)
  }
}
