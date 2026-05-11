export const AI_STORAGE_KEY = 'balatro:ai:settings'

export const AI_PROVIDERS = {
  anthropic: {
    label: 'Anthropic (Claude)',
    endpoint: 'https://api.anthropic.com/v1/messages',
    defaultModel: 'claude-haiku-4-5-20251001',
    models: [
      { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5（快、便宜，推荐）' },
      { id: 'claude-sonnet-4-6',         label: 'Claude Sonnet 4.6（更强）' },
      { id: 'claude-opus-4-7',           label: 'Claude Opus 4.7（最强、最贵）' }
    ],
    extraHeaders: {
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    }
  },
  openai: {
    label: 'OpenAI (GPT)',
    endpoint: 'https://api.openai.com/v1/chat/completions',
    defaultModel: 'gpt-4o-mini',
    models: [
      { id: 'gpt-4o-mini', label: 'GPT-4o mini（快、便宜，推荐）' },
      { id: 'gpt-4o',      label: 'GPT-4o（更强）' }
    ]
  },
  deepseek: {
    label: 'DeepSeek',
    endpoint: 'https://api.deepseek.com/v1/chat/completions',
    defaultModel: 'deepseek-v4-flash',
    models: [
      { id: 'deepseek-v4-flash', label: 'DeepSeek-V4-Flash（快、便宜，推荐）' },
      { id: 'deepseek-v4-pro',   label: 'DeepSeek-V4-Pro（更强）' }
    ],
    extraHeaders: {
      'x-api-key': null
    }
  }
}

export const DEFAULT_AI_SETTINGS = {
  enabled: false,
  provider: 'deepseek',
  apiKey: '',
  model: 'deepseek-v4-flash',
  maxTokens: 400,
  temperature: 0.3
}

// 节流：同一手牌（按 hand 内卡 id 排序后哈希）5 秒内禁止重复请求
export const COACH_THROTTLE_MS = 5000

// 请求超时：15 秒强制 abort
export const COACH_REQUEST_TIMEOUT_MS = 15000

// system prompt 模板（v3.0.0 出牌场景，一字不动）
export const COACH_SYSTEM_PROMPT = `你是 Balatro（小丑牌）的资深玩家与教练。
规则要点：
- 玩家从手牌中选 1–5 张组成扑克牌型（高牌/对子/两对/三条/顺子/同花/葫芦/四条/同花顺）。
- 得分 = chips × mult。chips 来自牌型基础值 + 已打出牌的点数；mult 来自牌型基础值 + Joker 加成。
- Joker 在出牌时按持有顺序逐张触发，可能加 chips 或加 mult。
- 当前盲注有目标分数 score，必须 >= score 才算通过；剩余 handsLeft 越少越紧迫。
- 部分 boss 盲注会让某些牌失效（debuffed=true 表示该牌不计 chips）。

你的任务：
- 给定当前 game state（hand/jokers/blind/resources），推荐**当回合最优出牌组合**。
- 必须返回严格 JSON，禁止多余解释、禁止 markdown 代码块、禁止前后缀文字。
- recommendedCardIds 必须是 hand 中存在的 id 子集，长度 1–5。
- reasoning 一句话（<= 40 字中文），解释为什么这样打分最高，例如"凑同花叠加暴食小丑 +12"。

输出 schema：
{
  "action": "play",
  "recommendedCardIds": ["c1","c4","c7"],
  "handType": "同花",
  "reasoning": "凑同花触发疯狂小丑 +10 倍率",
  "confidence": 0.86
}`

// ============== v3.1.0 扩展：场景标识 ==============

export const COACH_SCENES = {
  PLAY:    'play',     // 战斗中：选哪些牌打出（v3.0.0 原能力）
  DISCARD: 'discard',  // 战斗中：选哪些牌弃掉
  SHOP:    'shop',     // 商店中：买/卖/reroll/skip
  BLIND:   'blind'     // 盲注选择中：选哪个盲注
}

// 各场景节流独立计数。复用 v3.0.0 的 COACH_THROTTLE_MS 时长。
export const COACH_SCENE_KEYS = Object.values(COACH_SCENES)

// ============== v3.1.0 扩展：弃牌 system prompt ==============

export const DISCARD_SYSTEM_PROMPT = `你是 Balatro（小丑牌）的资深玩家与教练。
玩家正面临**弃牌决策**：从手牌中选 1–5 张弃掉，换等量新牌。

弃牌建议核心原则：
- 弃掉那些"无法组合成高分牌型 + 不被任何 Joker 加成"的牌
- 优先保留：构成对子/三条/同花/顺子潜力的牌、被 Joker 花色 / 点数加成的牌
- 当 discardsLeft 为 0 时不应建议弃牌（理论上调用方会拦住，但你也要在 reasoning 里指出）
- 当前 handsLeft 越少，越倾向"保守留住能立即得分的牌型"
- 部分 boss 盲注的 debuffed=true 的牌**应当优先弃掉**

输出 schema：
{
  "action": "discard",
  "discardCardIds": ["c2","c5"],
  "reasoning": "弃掉散牌保留同花潜力",
  "confidence": 0.78
}

要求：严格 JSON、无 markdown、无前后缀文字。discardCardIds 必须是 hand 中存在的 id 子集，长度 1–5。`

// ============== v3.1.0 扩展：商店 system prompt ==============

export const SHOP_SYSTEM_PROMPT = `你是 Balatro（小丑牌）的资深玩家与教练。
玩家正在**商店**中决策。商店提供以下动作：
- buy: 购买待售 Joker（targetId 是该 Joker 的 shopJokerId）
- sell: 卖出已持有 Joker（targetId 是该 Joker 的 ownedJokerId），换钱
- reroll: 花 $1 刷新整个商店
- skip: 直接进入下一阶段，不买不卖

判断原则：
- 评估每张待售 Joker 与玩家现有 jokers + 常打牌型的契合度
- 关注 build 协同：例如玩家已有"同花 +mult"系，新出"红桃 +chips"会强协同
- money 紧张时（≤ $4）不建议 reroll
- ownedJokers 已满（5 张）时建议 sell 一张低性价比的换钱再买
- 没有真正合适的就大胆 skip，不要乱花钱

输出 schema：
{
  "action": "buy" | "sell" | "reroll" | "skip",
  "targetId": "shopJokerId 或 ownedJokerId（skip / reroll 时为 null）",
  "reasoning": "本季 build 是同花流，加暴食小丑形成强协同",
  "confidence": 0.82
}

要求：严格 JSON、无 markdown、无前后缀文字。buy 时 targetId 必须是 shopJokers 中存在的 id；sell 时 targetId 必须是 ownedJokers 中存在的 id；reroll/skip 时 targetId 为 null。`

// ============== v3.1.0 扩展：盲注选择 system prompt ==============

export const BLIND_SYSTEM_PROMPT = `你是 Balatro（小丑牌）的资深玩家与教练。
玩家正在**当前 ante 的盲注选择阶段**：当前 ante 含 3 个盲注（小盲注 / 大盲注 / Boss 盲注），按顺序解锁。

判断原则：
- 评估玩家当前 build 强度（ownedJokers + money + 上一关表现）vs 各盲注 score 与 Boss 规则
- Boss 规则会让某些牌型失效或某些牌失去 chips，要重点评估你现有 build 是否会被克
- 例如 ownedJokers 全是"同花加成"系，遇到 DEBUFF_SPADE Boss 会损失 1/4 的同花潜力
- 必须从 candidateBlinds 里选一个 blindId（不要自创）

输出 schema：
{
  "action": "select",
  "blindId": "ante2-boss",
  "riskLevel": "low" | "medium" | "high",
  "reasoning": "当前 build 抗 face debuff 强，可硬刚 Boss",
  "confidence": 0.75
}

要求：严格 JSON、无 markdown、无前后缀文字。blindId 必须是 candidateBlinds 数组中存在的 id。`

// ============== v3.2.0 扩展：AI 托管节奏控制 ==============

// 每次 LLM 决策之间最小间隔（ms）。哪怕 LLM 返回得快，也至少等这么久，
// 让玩家看清动效与气泡，避免演出过快"看不清"。
export const AI_PILOT_TICK_DELAY_MS = 600

// 决策环节之间（出完牌 → 等待结算动效 → 下一次决策）的额外等待时间（ms）。
// 战斗内出完一手后必须等结算动效完整放完才能继续。
export const AI_PILOT_RESOLVE_WAIT_MS = 2200

// 商店 / 盲注阶段动效较少，等待时间短一些。
export const AI_PILOT_SHOP_WAIT_MS = 1000
export const AI_PILOT_BLIND_WAIT_MS = 800

// 同一局允许 LLM 失败多少次。第 1 次失败立即终止整局并 toast。
export const AI_PILOT_MAX_FAILURES = 1

// 决策日志导出文件版本号（用于将来字段迁移）
export const PILOT_LOG_VERSION = 1

// 托管模式标识
export const PILOT_MODES = {
  SOLO: 'solo',   // 单 AI 托管（默认）
  DUEL: 'duel'    // 双 AI 对战分屏
}

// 双 AI 对战时默认的两个供应商
export const PILOT_DUEL_PROVIDERS = ['anthropic', 'openai']
