export const AUDIO_STORAGE_KEY = 'balatro:audio:settings'

export const DEFAULT_VOLUME = {
  master: 0.8,
  bgm: 0.6,
  sfx: 0.9,
  muted: false
}

// 音频走 public 目录，路径基于 BASE_URL（dev=/，prod=/balatro-game/）
const AUDIO_BASE = `${import.meta.env.BASE_URL}assets/audio/`

export const BGM_TRACKS = {
  menu:   { src: `${AUDIO_BASE}bgm/menu.mp3`,   loop: true,  fadeMs: 600 },
  battle: { src: `${AUDIO_BASE}bgm/battle.mp3`, loop: true,  fadeMs: 600 },
  shop:   { src: `${AUDIO_BASE}bgm/shop.mp3`,   loop: true,  fadeMs: 600 },
  win:    { src: `${AUDIO_BASE}bgm/win.mp3`,    loop: false, fadeMs: 400 },
  lose:   { src: `${AUDIO_BASE}bgm/lose.mp3`,   loop: false, fadeMs: 400 }
}

export const SFX_LIBRARY = {
  cardDeal:     { src: `${AUDIO_BASE}sfx/card-deal.mp3`,     volume: 0.6 },
  cardSelect:   { src: `${AUDIO_BASE}sfx/card-select.mp3`,   volume: 0.5 },
  cardPlay:     { src: `${AUDIO_BASE}sfx/card-play.mp3`,     volume: 0.8 },
  cardDiscard:  { src: `${AUDIO_BASE}sfx/card-discard.mp3`,  volume: 0.7 },
  jokerTrigger: { src: `${AUDIO_BASE}sfx/joker-trigger.mp3`, volume: 0.9 },
  scoreTick:    { src: `${AUDIO_BASE}sfx/score-tick.mp3`,    volume: 0.4 },
  uiClick:      { src: `${AUDIO_BASE}sfx/ui-click.mp3`,      volume: 0.6 },
  uiHover:      { src: `${AUDIO_BASE}sfx/ui-hover.mp3`,      volume: 0.3 },
  shopBuy:      { src: `${AUDIO_BASE}sfx/shop-buy.mp3`,      volume: 0.8 },
  shopSell:     { src: `${AUDIO_BASE}sfx/shop-sell.mp3`,     volume: 0.7 },
  shopReroll:   { src: `${AUDIO_BASE}sfx/shop-reroll.mp3`,   volume: 0.7 },
  blindPass:    { src: `${AUDIO_BASE}sfx/blind-pass.mp3`,    volume: 0.9 },
  bossDefeat:   { src: `${AUDIO_BASE}sfx/boss-defeat.mp3`,   volume: 1.0 },
  winStinger:   { src: `${AUDIO_BASE}sfx/win-stinger.mp3`,   volume: 1.0 },
  loseStinger:  { src: `${AUDIO_BASE}sfx/lose-stinger.mp3`,  volume: 0.9 }
}

// runPhase 字符串 → BGM track key
// 项目实际 phase 命名：setup / blind-select / battle / reward / shop / pack / game-over
// game-over 不直接映射，由 App.vue watch 内根据 gameWon 派生 win/lose
export const PHASE_TO_BGM = {
  'setup':        'menu',
  'blind-select': 'battle',
  'battle':       'battle',
  'reward':       'battle',
  'shop':         'shop',
  'pack':         'shop'
}
