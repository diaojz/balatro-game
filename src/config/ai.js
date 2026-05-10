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
  }
}

export const DEFAULT_AI_SETTINGS = {
  enabled: false,
  provider: 'anthropic',
  apiKey: '',
  model: 'claude-haiku-4-5-20251001',
  maxTokens: 400,
  temperature: 0.3
}

// 节流：同一手牌（按 hand 内卡 id 排序后哈希）5 秒内禁止重复请求
export const COACH_THROTTLE_MS = 5000

// 请求超时：15 秒强制 abort
export const COACH_REQUEST_TIMEOUT_MS = 15000

// system prompt 模板
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
