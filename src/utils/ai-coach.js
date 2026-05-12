import {
  AI_PROVIDERS,
  AI_STORAGE_KEY,
  DEFAULT_AI_SETTINGS,
  LEGACY_MODEL_MIGRATION,
  COACH_THROTTLE_MS,
  COACH_REQUEST_TIMEOUT_MS,
  COACH_SYSTEM_PROMPT,
  COACH_SCENES,
  COACH_SCENE_KEYS,
  PROMPT_STORAGE_KEY,
  DEFAULT_PROMPTS
} from '../config/ai.js'

export class AiCoachError extends Error {
  constructor(reason, detail) {
    super(reason)
    this.reason = reason
    this.detail = detail
  }
}

// v3.2.0：发布-订阅集合，用于通知外部（App.vue）settings 已变更
const settingsSubscribers = new Set()

/**
 * 订阅 settings 变更事件。每当 saveSettings 执行后，所有已注册的回调都会被调用。
 * @param {Function} callback - 无参回调
 * @returns {Function} 取消订阅的函数（调用后回调不再触发）
 */
export function subscribeSettings(callback) {
  settingsSubscribers.add(callback)
  return () => settingsSubscribers.delete(callback)
}

/** 通知所有订阅者；调用点仅限 saveSettings，统一触发一次 */
function notifySettingsChange() {
  settingsSubscribers.forEach(cb => {
    try { cb() } catch (e) { console.error('[ai-coach] settings subscriber error:', e) }
  })
}

const settings = loadSettings()

// 节流字典：4 个场景独立计数
const lastRequest = Object.fromEntries(COACH_SCENE_KEYS.map(k => [k, { fp: null, at: 0 }]))

/**
 * 从 localStorage 加载设置，并在读取时执行 v3.2.0 的迁移逻辑：
 * - 若旧数据只有顶层 `apiKey` 而 `providers` 子树不存在，则把 `apiKey` 复制到
 *   `providers[provider].apiKey`，确保新旧字段同步，不丢失用户已配置的 Key。
 */
function loadSettings() {
  try {
    const raw = localStorage.getItem(AI_STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      // 构造默认 providers 子树，避免字段缺失
      const defaultProviders = {
        anthropic: { apiKey: '' },
        openai:    { apiKey: '' },
        deepseek:  { apiKey: '' }
      }
      // 先把 parsed.providers 与 defaultProviders 深度合并
      const mergedProviders = {
        ...defaultProviders,
        ...(parsed.providers || {})
      }
      // 对每个供应商确保有 apiKey 字段
      for (const key of Object.keys(defaultProviders)) {
        if (!mergedProviders[key] || typeof mergedProviders[key] !== 'object') {
          mergedProviders[key] = { apiKey: '' }
        } else if (!mergedProviders[key].apiKey) {
          mergedProviders[key] = { ...mergedProviders[key], apiKey: '' }
        }
      }

      const merged = { ...DEFAULT_AI_SETTINGS, ...parsed, providers: mergedProviders }

      // v3.2.0 迁移：旧用户只有顶层 apiKey，把它复制到当前 provider 的 providers 子树
      // 触发条件：providers[currentProvider].apiKey 为空 但 顶层 apiKey 有值
      const currentProvider = merged.provider || DEFAULT_AI_SETTINGS.provider
      if (merged.apiKey && !mergedProviders[currentProvider]?.apiKey) {
        mergedProviders[currentProvider] = {
          ...mergedProviders[currentProvider],
          apiKey: merged.apiKey
        }
        merged.providers = mergedProviders
      }

      // 把老用户 localStorage 里残留的 v3 model id 迁移到 v4（DeepSeek V4 发布于 2026-04 底）
      if (merged.model && LEGACY_MODEL_MIGRATION[merged.model]) {
        merged.model = LEGACY_MODEL_MIGRATION[merged.model]
      }

      return merged
    }
  } catch (_) { /* ignore */ }

  // 全新用户：初始化 providers 子树
  return {
    ...DEFAULT_AI_SETTINGS,
    providers: {
      anthropic: { apiKey: '' },
      openai:    { apiKey: '' },
      deepseek:  { apiKey: '' }
    }
  }
}

function saveSettings() {
  try {
    localStorage.setItem(AI_STORAGE_KEY, JSON.stringify(settings))
  } catch (_) { /* ignore */ }
  // v3.2.0：settings 写入后通知所有订阅者，驱动 App.vue computed 重新计算
  notifySettingsChange()
}

export function getSettings() {
  return { ...settings }
}

/**
 * 更新全局设置。
 * v3.2.0 扩展：
 * - 若 patch 里包含 `apiKey` 且与原值不同，才同步写入 `providers[currentProvider].apiKey`。
 *   切换 provider 时 SettingsPanel 会重发整个 patch（含 apiKey），此时 apiKey 实际未变，
 *   不应把当前 Key 污染到新 provider 的子树（fix v3.2.0）。
 * - 切换供应商时自动跟随该供应商默认模型（v3.0.0 逻辑保留）。
 */
export function updateSettings(patch) {
  const prevApiKey = settings.apiKey
  Object.assign(settings, patch)
  // 切换供应商时自动跟随该供应商默认模型
  if ('provider' in patch && !('model' in patch)) {
    settings.model = AI_PROVIDERS[settings.provider].defaultModel
  }
  // 仅当顶层 apiKey 实际变化时，同步写入当前 provider 的子树
  if ('apiKey' in patch && patch.apiKey !== prevApiKey) {
    const pKey = settings.provider || DEFAULT_AI_SETTINGS.provider
    if (!settings.providers) settings.providers = {}
    if (!settings.providers[pKey]) settings.providers[pKey] = {}
    settings.providers[pKey].apiKey = settings.apiKey
  }
  saveSettings()
}

// ============== v3.2.0 新增：多供应商 Key 管理工具 ==============

/**
 * 解析指定 provider 应使用的 API Key。
 * providers 子树是权威数据源（loadSettings 启动时已迁移旧用户的顶层 apiKey）。
 * fix v3.2.0：去掉顶层 apiKey fallback，避免切 provider 后用错误的 Key 假阳性。
 *
 * @param {string} providerKey - 供应商标识，如 'anthropic' | 'openai' | 'deepseek'
 * @param {object} [snap=settings] - 可注入一个 settings 快照，用于 per-call 透传
 * @returns {string} API Key，可能为空字符串
 */
function resolveApiKey(providerKey, snap = settings) {
  const fromProviders = snap.providers?.[providerKey]?.apiKey
  if (fromProviders) return fromProviders
  // 极端兜底：providers 子树缺失（loadSettings 应保证不会发生），且当前 provider 匹配
  if (!snap.providers && providerKey === (snap.provider || DEFAULT_AI_SETTINGS.provider)) {
    return snap.apiKey || ''
  }
  return ''
}

/**
 * 检查指定供应商是否已配置 API Key。
 * 用于双 AI 对战入口的按钮置灰判断。
 *
 * @param {string} providerKey - 供应商标识
 * @returns {boolean}
 */
export function hasProviderConfigured(providerKey) {
  return Boolean(resolveApiKey(providerKey))
}

/**
 * 更新指定供应商的 API Key（不影响其他供应商和全局状态）。
 * 供未来多 Key 配置 UI 或 B6 双 AI 启停按钮调用。
 *
 * @param {string} providerKey - 供应商标识
 * @param {string} apiKey - 新的 API Key
 */
export function updateProviderApiKey(providerKey, apiKey) {
  if (!settings.providers) settings.providers = {}
  if (!settings.providers[providerKey]) settings.providers[providerKey] = {}
  settings.providers[providerKey].apiKey = apiKey
  // 若更新的是当前 provider，同步顶层 apiKey 保持兼容
  if (providerKey === settings.provider) {
    settings.apiKey = apiKey
  }
  saveSettings()
}

// ============== v3.2.1：自定义提示词读写 ==============
//
// 数据流：localStorage[PROMPT_STORAGE_KEY] = { play, discard, shop, blind }
// 空串或缺失字段 → fallback 到 DEFAULT_PROMPTS[scene]
// 自定义版直接覆盖默认，4 个 requestXxxAdvice 在调用 LLM 时读取生效值。

/**
 * 读取当前生效的 system prompt（自定义优先，默认 fallback）
 * @param {'play'|'discard'|'shop'|'blind'} scene
 * @returns {string}
 */
export function getActivePrompt(scene) {
  try {
    const raw = localStorage.getItem(PROMPT_STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      const userPrompt = parsed?.[scene]
      if (typeof userPrompt === 'string' && userPrompt.trim()) {
        return userPrompt
      }
    }
  } catch (_) { /* ignore */ }
  return DEFAULT_PROMPTS[scene] ?? ''
}

/**
 * 读取用户自定义覆写状态（不 fallback；空串 = 未自定义）
 * SettingsPanel 用它判断"已自定义"徽章
 * @returns {{ play: string, discard: string, shop: string, blind: string }}
 */
export function getCustomPrompts() {
  try {
    const raw = localStorage.getItem(PROMPT_STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      return {
        play:    typeof parsed?.play === 'string'    ? parsed.play    : '',
        discard: typeof parsed?.discard === 'string' ? parsed.discard : '',
        shop:    typeof parsed?.shop === 'string'    ? parsed.shop    : '',
        blind:   typeof parsed?.blind === 'string'   ? parsed.blind   : ''
      }
    }
  } catch (_) { /* ignore */ }
  return { play: '', discard: '', shop: '', blind: '' }
}

/**
 * 保存指定场景的自定义 prompt。空串 = 恢复默认（移除自定义）
 * @param {'play'|'discard'|'shop'|'blind'} scene
 * @param {string} value
 */
export function setCustomPrompt(scene, value) {
  const current = getCustomPrompts()
  current[scene] = typeof value === 'string' ? value : ''
  try {
    localStorage.setItem(PROMPT_STORAGE_KEY, JSON.stringify(current))
  } catch (_) { /* ignore */ }
}

/**
 * 恢复指定场景的默认 prompt（删除自定义版）
 * @param {'play'|'discard'|'shop'|'blind'} scene
 */
export function resetCustomPrompt(scene) {
  setCustomPrompt(scene, '')
}

// ============== 序列化函数 ==============

/**
 * 出牌 / 弃牌场景共用：把游戏状态序列化为 LLM 可消费的最小 payload
 * 字段名遵循 v3.0.0 现有代码（blind.targetScore / lastPlayedHand.name 保持）
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
    // lastPlayedHand.name 对应现有代码字段（v3.0.0 中 lastPlayedHand 是 hand 识别结果，用 .name）
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

// ============== Payload 构建器（接收 systemPrompt 参数 + settings 快照）==============
// v3.2.0：所有 builder 接收 snap（settings 快照）而非直接读模块全局 settings，
// 使 per-call provider 透传并发安全（方案 Y：无注入时默认 snap = settings）。

/**
 * @param {string} systemPrompt
 * @param {object} payload
 * @param {object} snap - settings 快照（含 model / maxTokens / temperature 与已解析的 apiKey）
 */
function buildDeepSeekPayload(systemPrompt, payload, snap) {
  // DeepSeek v4 系列（v4-flash / v4-pro）是推理模型：先生成 reasoning_content 推理链再产 content。
  // 推理链动辄数百 token，默认 maxTokens=800 不够（实测推理被截断在 400 token 未出 JSON 结论）；
  // 给 v4 至少 4096 让推理跑完。同时去 response_format json_object——推理模型在 reasoning 里
  // 用自然语言思考，强制 JSON mode 反而干扰；最终 JSON 由 parseRawJson 从混合文本中提取。
  const isReasoner = /v4/i.test(snap.model || '')
  const effectiveMaxTokens = isReasoner ? Math.max(snap.maxTokens, 4096) : snap.maxTokens

  const body = {
    model: snap.model,
    max_tokens: effectiveMaxTokens,
    temperature: snap.temperature,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: `当前游戏状态：\n${JSON.stringify(payload, null, 2)}\n\n请输出 JSON。` }
    ]
  }
  if (!isReasoner) {
    body.response_format = { type: 'json_object' }
  }

  return {
    body,
    headers: {
      'content-type': 'application/json',
      'authorization': `Bearer ${snap._resolvedApiKey}`
    },
    parseResponse: (json) => {
      // v3 chat 模型把回答放 content；v4 推理模型（v4-flash / v4-pro）把回答放 reasoning_content，
      // content 字段为空字符串。同时兼容两种，让用户切到任意 model 都能正常解析。
      const msg = json?.choices?.[0]?.message
      return msg?.content || msg?.reasoning_content || ''
    }
  }
}

function buildAnthropicPayload(systemPrompt, payload, snap) {
  return {
    body: {
      model: snap.model,
      max_tokens: snap.maxTokens,
      temperature: snap.temperature,
      system: systemPrompt,
      messages: [
        { role: 'user', content: `当前游戏状态：\n${JSON.stringify(payload, null, 2)}\n\n请输出 JSON。` }
      ]
    },
    headers: {
      'content-type': 'application/json',
      'x-api-key': snap._resolvedApiKey,
      ...AI_PROVIDERS.anthropic.extraHeaders
    },
    parseResponse: (json) => json?.content?.[0]?.text ?? ''
  }
}

function buildOpenAIPayload(systemPrompt, payload, snap) {
  return {
    body: {
      model: snap.model,
      max_tokens: snap.maxTokens,
      temperature: snap.temperature,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: `当前游戏状态：\n${JSON.stringify(payload, null, 2)}\n\n请输出 JSON。` }
      ]
    },
    headers: {
      'content-type': 'application/json',
      'authorization': `Bearer ${snap._resolvedApiKey}`
    },
    parseResponse: (json) => json?.choices?.[0]?.message?.content ?? ''
  }
}

/**
 * 构建一个 settings 快照，注入已解析的 apiKey（_resolvedApiKey）。
 * 这样 builder 和 callLLM 只需读快照，不依赖模块级 settings 可变状态，
 * 从而在 per-call provider 切换时并发安全。
 *
 * @param {string|null} providerOverride - 临时切换的供应商标识，null 表示使用全局 settings.provider
 * @returns {object} 包含 _resolvedApiKey 的 settings 快照副本
 */
function buildSettingsSnapshot(providerOverride = null) {
  const effectiveProvider = providerOverride || settings.provider
  const resolvedKey = resolveApiKey(effectiveProvider)
  return {
    ...settings,
    provider: effectiveProvider,
    // _resolvedApiKey 是内部临时字段，builder 用它，不会持久化
    _resolvedApiKey: resolvedKey
  }
}

// ============== LLM 调用内核 ==============

/**
 * 所有场景共用的 LLM fetch 内核。
 * v3.2.0：接收可选 `snap`（settings 快照），实现 per-call provider 透传。
 *   - snap 由 buildSettingsSnapshot(providerOverride) 生成，含 _resolvedApiKey
 *   - 无 snap 时默认使用全局 settings（v3.0.0 / v3.1.0 行为完全等价）
 *
 * @param {string} systemPrompt - 当前场景的 system prompt
 * @param {object} userJsonPayload - 已序列化的游戏状态
 * @param {object} [snap] - settings 快照（可选）；缺省时等价 v3.1.0 行为
 * @returns {Promise<object>} 已解析的 JSON 对象
 */
async function callLLM(systemPrompt, userJsonPayload, snap) {
  // 若调用方未传 snap，使用全局 settings 构造默认快照
  const s = snap ?? buildSettingsSnapshot()

  if (!s.enabled) throw new AiCoachError('disabled')
  if (!s._resolvedApiKey) throw new AiCoachError('no_api_key')

  const provider = AI_PROVIDERS[s.provider]
  if (!provider) throw new AiCoachError('unknown_provider', s.provider)

  const built = s.provider === 'anthropic'
    ? buildAnthropicPayload(systemPrompt, userJsonPayload, s)
    : s.provider === 'deepseek'
      ? buildDeepSeekPayload(systemPrompt, userJsonPayload, s)
      : buildOpenAIPayload(systemPrompt, userJsonPayload, s)

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
  // 第一步：剥 markdown 代码块后整体 parse（v3 chat 路径，最快）
  const stripped = rawText.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim()
  try {
    return JSON.parse(stripped)
  } catch (_) { /* 继续退路 */ }

  // 第二步：从混合文本中提取最外层 { ... }（v4 推理模型路径）
  // 推理链常见格式："我考虑一下... 输出 JSON。{...}"——JSON 嵌在文本最后
  const match = stripped.match(/\{[\s\S]*\}/)
  if (match) {
    try {
      return JSON.parse(match[0])
    } catch (_) { /* fall through */ }
  }

  throw new AiCoachError('invalid_response', `非 JSON: ${rawText.slice(0, 120)}`)
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
//
// v3.2.0 方案 Y：每个函数新增可选 `options` 参数（默认 = {}），不破坏 v3.1.0 签名。
// options.providerOverride {string|null} — 临时指定供应商（用于双 AI 对战 per-call 透传）。
// 无 options / options.providerOverride = null 时，行为与 v3.1.0 完全等价。

/**
 * 出牌建议（继承 v3.0.0，重命名）
 * @param {object} gameState - 游戏状态
 * @param {object} [options={}]
 * @param {string|null} [options.providerOverride] - 临时供应商（null=使用全局设置）
 */
export async function requestPlayAdvice(gameState, options = {}) {
  checkThrottle(COACH_SCENES.PLAY, fingerprint('play', gameState))
  const state = serializePlayState(gameState)
  const snap = buildSettingsSnapshot(options.providerOverride ?? null)
  const advice = await callLLM(getActivePrompt('play'), state, snap)
  return validatePlayAdvice(advice, gameState.hand)
}

/**
 * 旧名别名，保持向后兼容——v3.0.0 的 AiCoachOverlay.vue 不需要任何修改
 */
export const requestCoachAdvice = requestPlayAdvice

/**
 * 弃牌建议（v3.1.0 新增）
 * @param {object} gameState - 游戏状态
 * @param {object} [options={}]
 * @param {string|null} [options.providerOverride] - 临时供应商
 */
export async function requestDiscardAdvice(gameState, options = {}) {
  if (gameState.discardsLeft <= 0) {
    throw new AiCoachError('no_discards_left', '本回合已无弃牌次数')
  }
  checkThrottle(COACH_SCENES.DISCARD, fingerprint('discard', gameState))
  const state = serializePlayState(gameState)  // 弃牌与出牌共享 game state shape
  const snap = buildSettingsSnapshot(options.providerOverride ?? null)
  const advice = await callLLM(getActivePrompt('discard'), state, snap)
  return validateDiscardAdvice(advice, gameState.hand)
}

/**
 * 商店建议（v3.1.0 新增）
 * @param {object} shopState - 商店状态
 * @param {object} [options={}]
 * @param {string|null} [options.providerOverride] - 临时供应商
 */
export async function requestShopAdvice(shopState, options = {}) {
  checkThrottle(COACH_SCENES.SHOP, fingerprint('shop', shopState))
  const state = serializeShopState(shopState)
  const snap = buildSettingsSnapshot(options.providerOverride ?? null)
  const advice = await callLLM(getActivePrompt('shop'), state, snap)
  return validateShopAdvice(advice, shopState)
}

/**
 * 盲注选择建议（v3.1.0 新增）
 * @param {object} blindState - 盲注状态
 * @param {object} [options={}]
 * @param {string|null} [options.providerOverride] - 临时供应商
 */
export async function requestBlindAdvice(blindState, options = {}) {
  checkThrottle(COACH_SCENES.BLIND, fingerprint('blind', blindState))
  const state = serializeBlindState(blindState)
  const snap = buildSettingsSnapshot(options.providerOverride ?? null)
  const advice = await callLLM(getActivePrompt('blind'), state, snap)
  return validateBlindAdvice(advice, blindState.candidateBlinds)
}

// ============== 设置面板：测试连接 ==============

/**
 * 向 LLM 供应商发送最小 payload，确认 API Key 与网络可用。
 * v3.2.0：使用 resolveApiKey 读取当前供应商的 Key（新旧字段兼容）。
 */
export async function pingProvider() {
  const provider = AI_PROVIDERS[settings.provider]
  if (!provider) throw new AiCoachError('unknown_provider')
  const resolvedKey = resolveApiKey(settings.provider)
  if (!resolvedKey) throw new AiCoachError('no_api_key')

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
  // 构造快照，让 builder 通过 snap._resolvedApiKey 拿到 Key
  const snap = { ...settings, _resolvedApiKey: resolvedKey }
  const built = settings.provider === 'anthropic'
    ? buildAnthropicPayload(COACH_SYSTEM_PROMPT, minimalState, snap)
    : settings.provider === 'deepseek'
      ? buildDeepSeekPayload(COACH_SYSTEM_PROMPT, minimalState, snap)
      : buildOpenAIPayload(COACH_SYSTEM_PROMPT, minimalState, snap)

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
