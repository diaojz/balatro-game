/**
 * game-actor.js — v3.2.0 AI 托管模式的游戏动作执行手
 *
 * createGameActor({ refs, actions }) 工厂函数接收：
 *   refs    — 一组 ref/computed，actor 用来读当前状态做前置校验
 *   actions — 一组回调，actor 用来"动手"执行操作
 *
 * 返回 9 个 action 方法：
 *   playHand / discard / buyJoker / sellJoker / reroll /
 *   skipShop / selectBlind / proceedToShop / startNextAnte
 *
 * 设计原则：
 *   - 不调用 LLM（不 import ai-coach）
 *   - 不直接修改 ref（一切通过 actions 间接调用，setHandSelection 除外——
 *     它是 hand 内 selected 标记的写入，是 actor 与 actions 协作的桥梁）
 *   - 不碰 DOM（零 document.querySelector / getElementById / classList）
 *   - 每个方法做严格前置校验，校验不过返回 { ok: false, reason } 而非抛错
 *   - async 接口：允许 actions 回调本身是异步的（例如动效结算）
 */

// ─────────────────────────────────────────────────────────────────────────────
// 合法 reason 字符串集合（供 ai-pilot.js / 测试代码参考）
// ─────────────────────────────────────────────────────────────────────────────
export const ACTOR_REASONS = {
  WRONG_PHASE:         'wrong_phase',
  NO_HANDS_LEFT:       'no_hands_left',
  NO_DISCARDS_LEFT:    'no_discards_left',
  INVALID_CARD_IDS:    'invalid_card_ids',
  JOKER_NOT_IN_SHOP:   'joker_not_in_shop',
  JOKER_NOT_OWNED:     'joker_not_owned',
  INSUFFICIENT_MONEY:  'insufficient_money',
  INVALID_BLIND_ID:    'invalid_blind_id',
  BLIND_LOCKED:        'blind_locked',
  ACTOR_MISCONFIGURED: 'actor_misconfigured',
}

// ─────────────────────────────────────────────────────────────────────────────
// 工厂函数
// ─────────────────────────────────────────────────────────────────────────────

/**
 * createGameActor
 *
 * @param {{ refs: object, actions: object }} param0
 * @param {object} param0.refs - 由 App.vue（或 createGameState 工厂）提供的全套响应式状态引用：
 *   {
 *     runPhase:         Ref<string>      // 当前阶段：'setup'|'blind-select'|'battle'|'reward'|'shop'|'pack'|'game-over'
 *     hand:             Ref<Card[]>      // 手牌列表，每张牌有 { id, rank, suit, selected, ... }
 *     handsLeft:        Ref<number>      // 剩余可出牌次数
 *     discardsLeft:     Ref<number>      // 剩余可弃牌次数
 *     money:            Ref<number>      // 当前金币
 *     shopJokers:       Ref<Joker[]>     // 商店中的 Joker 列表（原始，无 shopJokerId）
 *     shopJokersWithIds:Ref<Joker[]>     // 商店 Joker 列表（含 shopJokerId: `sh_${i}`）
 *     ownedJokers:      Ref<Joker[]>     // 持有的 Joker 列表（原始，无 ownedJokerId）
 *     ownedJokersWithIds:Ref<Joker[]>    // 持有 Joker 列表（含 ownedJokerId: `oj_${i}`）
 *     candidateBlinds:  Ref<Blind[]>     // 当前 ante 可选盲注列表（含 canChallenge）
 *                                        // 对应 App.vue 的 availableBlindOptions
 *   }
 * @param {object} param0.actions - App.vue 暴露的业务动作回调：
 *   {
 *     playHand():           void|Promise   // 出牌（读 hand 中 selected===true 的牌）
 *     discard():            void|Promise   // 弃牌（读 hand 中 selected===true 的牌）
 *     buyJoker(joker):      void|Promise   // 购买商店中的 Joker（传整个 joker 对象）
 *     sellJoker(joker):     void|Promise   // 卖出持有的 Joker（传整个 joker 对象）
 *     rerollShop():         void|Promise   // 刷新商店
 *     skipShop():           void|Promise   // 跳过/离开商店（对应 App.vue 的 closeShop）
 *     selectBlind(blindId): void|Promise   // 选择盲注（传 blindId 字符串）
 *     proceedToShop():      void|Promise   // 结算页进入商店（某些版本可能直接走 openShop）
 *     startNextAnte():      void|Promise   // 开启下一 ante（可选，部分版本自动触发）
 *     setSelection(ids):    void|Promise   // 可选：用 cardId 数组设置手牌选中状态
 *                                          // 如果 actions 不提供，actor 内部直接写 refs.hand
 *   }
 * @returns 9 个 action 方法对象
 */
export function createGameActor({ refs, actions }) {
  // ── 完整性检查：关键字段缺失时每个方法都返回 actor_misconfigured ──
  const requiredRefs = ['runPhase', 'hand', 'handsLeft', 'discardsLeft', 'money']
  const missingRefs = requiredRefs.filter(k => !refs || refs[k] === undefined)

  const requiredActions = ['playHand', 'discard', 'buyJoker', 'sellJoker', 'rerollShop', 'skipShop', 'selectBlind']
  const missingActions = requiredActions.filter(k => !actions || typeof actions[k] !== 'function')

  if (missingRefs.length > 0 || missingActions.length > 0) {
    const reason = ACTOR_REASONS.ACTOR_MISCONFIGURED
    const detail = [
      missingRefs.length   ? `缺少 refs: ${missingRefs.join(', ')}`   : '',
      missingActions.length ? `缺少 actions: ${missingActions.join(', ')}` : '',
    ].filter(Boolean).join('；')
    console.warn(`[game-actor] 配置不完整：${detail}`)

    // 所有方法均返回 Promise<{ ok: false, reason: 'actor_misconfigured' }>
    // 使用 async 保持与正常方法一致的异步接口
    const stub = async () => ({ ok: false, reason, detail })
    return {
      playHand:      stub,
      discard:       stub,
      buyJoker:      stub,
      sellJoker:     stub,
      reroll:        stub,
      skipShop:      stub,
      selectBlind:   stub,
      proceedToShop: stub,
      startNextAnte: stub,
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 内部 helper：把 cardIds 写入 hand 的 selected 标记
  //
  // App.vue 的 playHand() / discardCards() 通过 `selectedCards` computed
  // （hand.value.filter(c => c.selected)）读取已选牌。
  // actor 在调用 actions.playHand / actions.discard 前，必须先把目标牌
  // 的 selected 设为 true、其余设为 false。
  //
  // 优先走 actions.setSelection（如果 App.vue 将来暴露这个接口）；
  // 否则直接写 refs.hand（原地 map 替换，不触发整个 hand ref 的替换，
  // 避免 Vue 模板大范围 diff）。
  // ─────────────────────────────────────────────────────────────────────────
  function setHandSelection(cardIds) {
    const idSet = new Set(cardIds)
    if (typeof actions.setSelection === 'function') {
      // 让 App.vue 自己处理 selection 状态
      actions.setSelection(Array.from(idSet))
    } else {
      // 直接写 hand 内每张牌的 selected 标记
      // 用整体替换（而非 forEach 原地修改），确保 Vue 响应式更新触发
      refs.hand.value = refs.hand.value.map(c => ({
        ...c,
        selected: idSet.has(c.id),
      }))
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 校验 cardIds 是否合法（数组、1-5 张、全部在手牌中）
  // ─────────────────────────────────────────────────────────────────────────
  function validateCardIds(cardIds) {
    if (!Array.isArray(cardIds) || cardIds.length < 1 || cardIds.length > 5) {
      return { valid: false, reason: ACTOR_REASONS.INVALID_CARD_IDS }
    }
    const handIdSet = new Set(refs.hand.value.map(c => c.id))
    if (!cardIds.every(id => handIdSet.has(id))) {
      return { valid: false, reason: ACTOR_REASONS.INVALID_CARD_IDS }
    }
    return { valid: true }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 9 个 action 方法
  // ─────────────────────────────────────────────────────────────────────────

  // ── 1. playHand(cardIds) ─────────────────────────────────────────────────
  /**
   * 出牌
   * @param {string[]} cardIds - 要出的牌 id 数组（1-5 张）
   * 前置：runPhase === 'battle' && handsLeft > 0 && cardIds 全在 hand 内
   */
  async function playHand(cardIds) {
    if (refs.runPhase.value !== 'battle') {
      return { ok: false, reason: ACTOR_REASONS.WRONG_PHASE }
    }
    if (refs.handsLeft.value <= 0) {
      return { ok: false, reason: ACTOR_REASONS.NO_HANDS_LEFT }
    }
    const check = validateCardIds(cardIds)
    if (!check.valid) return { ok: false, reason: check.reason }

    setHandSelection(cardIds)
    await actions.playHand()
    return { ok: true }
  }

  // ── 2. discard(cardIds) ──────────────────────────────────────────────────
  /**
   * 弃牌
   * @param {string[]} cardIds - 要弃的牌 id 数组（1-5 张）
   * 前置：runPhase === 'battle' && discardsLeft > 0 && cardIds 全在 hand 内
   */
  async function discard(cardIds) {
    if (refs.runPhase.value !== 'battle') {
      return { ok: false, reason: ACTOR_REASONS.WRONG_PHASE }
    }
    if (refs.discardsLeft.value <= 0) {
      return { ok: false, reason: ACTOR_REASONS.NO_DISCARDS_LEFT }
    }
    const check = validateCardIds(cardIds)
    if (!check.valid) return { ok: false, reason: check.reason }

    setHandSelection(cardIds)
    await actions.discard()
    return { ok: true }
  }

  // ── 3. buyJoker(shopJokerId) ─────────────────────────────────────────────
  /**
   * 购买商店中的 Joker
   * @param {string} shopJokerId - 商店 Joker 的唯一标识（格式 `sh_${index}`）
   * 前置：runPhase === 'shop' && shopJokerId 在 shopJokersWithIds 中 && money >= price
   *
   * 注意：shopJokersWithIds 是 computed，每次商店刷新都会重建索引，
   *       shopJokerId 仅在单次商店周期内有效。
   */
  async function buyJoker(shopJokerId) {
    if (refs.runPhase.value !== 'shop') {
      return { ok: false, reason: ACTOR_REASONS.WRONG_PHASE }
    }

    // 优先从 shopJokersWithIds（含 shopJokerId 字段）查找
    const withIds = refs.shopJokersWithIds?.value ?? []
    const joker = withIds.find(j => j.shopJokerId === shopJokerId)
    if (!joker) {
      return { ok: false, reason: ACTOR_REASONS.JOKER_NOT_IN_SHOP }
    }
    if (refs.money.value < joker.price) {
      return { ok: false, reason: ACTOR_REASONS.INSUFFICIENT_MONEY }
    }

    // 传整个 joker 对象给 App.vue 的 buyJoker(joker)
    await actions.buyJoker(joker)
    return { ok: true }
  }

  // ── 4. sellJoker(ownedJokerId) ───────────────────────────────────────────
  /**
   * 卖出持有的 Joker
   * @param {string} ownedJokerId - 持有 Joker 的唯一标识（格式 `oj_${index}`）
   * 前置：runPhase === 'shop' && ownedJokerId 在 ownedJokersWithIds 中
   */
  async function sellJoker(ownedJokerId) {
    if (refs.runPhase.value !== 'shop') {
      return { ok: false, reason: ACTOR_REASONS.WRONG_PHASE }
    }

    const withIds = refs.ownedJokersWithIds?.value ?? []
    const joker = withIds.find(j => j.ownedJokerId === ownedJokerId)
    if (!joker) {
      return { ok: false, reason: ACTOR_REASONS.JOKER_NOT_OWNED }
    }

    // 传整个 joker 对象给 App.vue 的 sellJoker(joker)
    await actions.sellJoker(joker)
    return { ok: true }
  }

  // ── 5. reroll() ──────────────────────────────────────────────────────────
  /**
   * 刷新商店
   * 前置：runPhase === 'shop' && money >= 1（App.vue 内刷新费用固定 $1）
   */
  async function reroll() {
    if (refs.runPhase.value !== 'shop') {
      return { ok: false, reason: ACTOR_REASONS.WRONG_PHASE }
    }
    if (refs.money.value < 1) {
      return { ok: false, reason: ACTOR_REASONS.INSUFFICIENT_MONEY }
    }

    await actions.rerollShop()
    return { ok: true }
  }

  // ── 6. skipShop() ────────────────────────────────────────────────────────
  /**
   * 跳过/离开商店（等价于点"跳过"按钮）
   * 前置：runPhase === 'shop' 或 'pack'
   *
   * pack 阶段兼容处理（v3.2.0 AI 不处理卡包，统一跳过）：
   *   - 当 runPhase === 'pack' 时，优先走 actions.skipPack（若存在），
   *     否则复用 actions.skipShop（语义上等效——都是"跳过当前阶段进入下一步"）。
   */
  async function skipShop() {
    const phase = refs.runPhase.value
    if (phase !== 'shop' && phase !== 'pack') {
      return { ok: false, reason: ACTOR_REASONS.WRONG_PHASE }
    }

    if (phase === 'pack' && typeof actions.skipPack === 'function') {
      await actions.skipPack()
    } else {
      await actions.skipShop()
    }
    return { ok: true }
  }

  // ── 7. selectBlind(blindId) ──────────────────────────────────────────────
  /**
   * 选择并开始挑战某个盲注
   * @param {string} blindId - 盲注的 id 字符串（如 'small-blind-1'）
   * 前置：runPhase === 'blind-select' && blindId 在 candidateBlinds 中 && canChallenge === true
   *
   * 命名说明：
   *   refs 端叫 candidateBlinds（对应 App.vue 的 availableBlindOptions computed）
   *   actions 端叫 selectBlind（对应 App.vue 的 selectBlind(blindId) 函数）
   *   两者名字不同，但语义对齐：candidateBlinds 是"本 ante 可选的盲注列表"，
   *   selectBlind 是"用 blindId 触发进入 battle"的动作。
   */
  async function selectBlind(blindId) {
    if (refs.runPhase.value !== 'blind-select') {
      return { ok: false, reason: ACTOR_REASONS.WRONG_PHASE }
    }

    const candidateBlinds = refs.candidateBlinds?.value ?? []
    const target = candidateBlinds.find(b => b.id === blindId)
    if (!target) {
      return { ok: false, reason: ACTOR_REASONS.INVALID_BLIND_ID }
    }
    if (!target.canChallenge) {
      return { ok: false, reason: ACTOR_REASONS.BLIND_LOCKED }
    }

    // actions.selectBlind 对应 App.vue 的 selectBlind(blindId)，传 blindId 字符串
    await actions.selectBlind(blindId)
    return { ok: true }
  }

  // ── 8. proceedToShop() ───────────────────────────────────────────────────
  /**
   * 结算页（reward）自动进入商店
   * 前置：runPhase === 'reward'
   *
   * 在当前 v3.1.0 实现中，passBlind() 会在 setTimeout 后自动调用 openShop()，
   * runPhase 自动跳 shop，不需要玩家额外点击。
   * 但为了让 ai-pilot 在 reward 阶段有明确的"我已知晓结算"行为，
   * actor 提供此方法：若 actions.proceedToShop 存在则调用，否则直接返回 ok。
   */
  async function proceedToShop() {
    if (refs.runPhase.value !== 'reward') {
      return { ok: false, reason: ACTOR_REASONS.WRONG_PHASE }
    }

    if (typeof actions.proceedToShop === 'function') {
      await actions.proceedToShop()
    }
    // 当前版本 passBlind → openShop 是自动的，这里即使 actions 为空也 ok
    return { ok: true }
  }

  // ── 9. startNextAnte() ───────────────────────────────────────────────────
  /**
   * 开启下一 ante（Boss 盲注通过后，若版本需要手动触发）
   * 前置：无强制 phase 约束（某些版本在 shop/blind-select 之间有中间态）
   *
   * 当前 v3.1.0 中，ante 推进是 closeShop() 自动完成的，
   * 此方法作为保留接口，若 actions.startNextAnte 未定义则静默成功。
   */
  async function startNextAnte() {
    if (typeof actions.startNextAnte === 'function') {
      await actions.startNextAnte()
    }
    return { ok: true }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 返回方法集合
  // ─────────────────────────────────────────────────────────────────────────
  return {
    playHand,
    discard,
    buyJoker,
    sellJoker,
    reroll,
    skipShop,
    selectBlind,
    proceedToShop,
    startNextAnte,
  }
}
