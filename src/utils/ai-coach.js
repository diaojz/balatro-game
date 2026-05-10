import {
  AI_PROVIDERS,
  AI_STORAGE_KEY,
  DEFAULT_AI_SETTINGS,
  COACH_THROTTLE_MS,
  COACH_REQUEST_TIMEOUT_MS,
  COACH_SYSTEM_PROMPT
} from '../config/ai.js'

export class AiCoachError extends Error {
  constructor(reason, detail) {
    super(reason)
    this.reason = reason
    this.detail = detail
  }
}

const settings = loadSettings()
let lastRequestKey = null
let lastRequestAt = 0

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

// 把游戏状态序列化为 LLM 可消费的最小 payload
export function serializeGameState({ hand, ownedJokers, blind, handsLeft, discardsLeft, money, lastPlayedHand, totalScore }) {
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
    lastPlayedHand: lastPlayedHand
      ? {
          handType: lastPlayedHand.name,
          score: lastScore || 0
        }
      : null
  }
}

function buildAnthropicPayload(state) {
  return {
    body: {
      model: settings.model,
      max_tokens: settings.maxTokens,
      temperature: settings.temperature,
      system: COACH_SYSTEM_PROMPT,
      messages: [
        { role: 'user', content: `当前游戏状态：\n${JSON.stringify(state, null, 2)}\n\n请输出 JSON。` }
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

function buildOpenAIPayload(state) {
  return {
    body: {
      model: settings.model,
      max_tokens: settings.maxTokens,
      temperature: settings.temperature,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: COACH_SYSTEM_PROMPT },
        { role: 'user',   content: `当前游戏状态：\n${JSON.stringify(state, null, 2)}\n\n请输出 JSON。` }
      ]
    },
    headers: {
      'content-type': 'application/json',
      'authorization': `Bearer ${settings.apiKey}`
    },
    parseResponse: (json) => json?.choices?.[0]?.message?.content ?? ''
  }
}

function parseAdvice(rawText, hand) {
  let advice
  try {
    // 容错：有些模型仍可能裹一层 ```json ... ```，剥掉
    const cleaned = rawText.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim()
    advice = JSON.parse(cleaned)
  } catch (e) {
    throw new AiCoachError('invalid_response', `非 JSON: ${rawText.slice(0, 80)}`)
  }
  if (!advice || typeof advice !== 'object') {
    throw new AiCoachError('invalid_response', '空对象')
  }
  if (!Array.isArray(advice.recommendedCardIds) || advice.recommendedCardIds.length < 1 || advice.recommendedCardIds.length > 5) {
    throw new AiCoachError('invalid_response', 'recommendedCardIds 长度非法')
  }
  const handIdSet = new Set(hand.map(c => c.id))
  const allInHand = advice.recommendedCardIds.every(id => handIdSet.has(id))
  if (!allInHand) {
    throw new AiCoachError('invalid_response', '推荐牌不在手牌中')
  }
  return {
    action: advice.action ?? 'play',
    recommendedCardIds: advice.recommendedCardIds,
    handType: String(advice.handType ?? ''),
    reasoning: String(advice.reasoning ?? '').slice(0, 80),
    confidence: typeof advice.confidence === 'number' ? Math.max(0, Math.min(1, advice.confidence)) : null
  }
}

function handFingerprint(hand) {
  return hand.map(c => c.id).sort().join('|')
}

export async function requestCoachAdvice(gameState) {
  if (!settings.enabled) throw new AiCoachError('disabled')
  if (!settings.apiKey)  throw new AiCoachError('no_api_key')

  const fp = handFingerprint(gameState.hand)
  const now = Date.now()
  if (fp === lastRequestKey && now - lastRequestAt < COACH_THROTTLE_MS) {
    throw new AiCoachError('throttled', `请等待 ${Math.ceil((COACH_THROTTLE_MS - (now - lastRequestAt)) / 1000)}s`)
  }
  lastRequestKey = fp
  lastRequestAt = now

  const provider = AI_PROVIDERS[settings.provider]
  if (!provider) throw new AiCoachError('unknown_provider', settings.provider)

  const state = serializeGameState(gameState)
  const built = settings.provider === 'anthropic'
    ? buildAnthropicPayload(state)
    : buildOpenAIPayload(state)

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

  return parseAdvice(rawText, gameState.hand)
}

// 用于设置面板里的「测试连接」按钮：发送一个最小 payload，只确认能往返
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
    ? buildAnthropicPayload(minimalState)
    : buildOpenAIPayload(minimalState)

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
