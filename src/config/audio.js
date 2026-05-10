export const AUDIO_STORAGE_KEY = 'balatro:audio:settings'

export const DEFAULT_VOLUME = {
  master: 0.8,
  bgm: 0.6,
  sfx: 0.9,
  muted: false
}

export const BGM_TRACKS = {
  menu:   { src: '/src/assets/audio/bgm/menu.mp3',   loop: true,  fadeMs: 600 },
  battle: { src: '/src/assets/audio/bgm/battle.mp3', loop: true,  fadeMs: 600 },
  shop:   { src: '/src/assets/audio/bgm/shop.mp3',   loop: true,  fadeMs: 600 },
  win:    { src: '/src/assets/audio/bgm/win.mp3',    loop: false, fadeMs: 400 },
  lose:   { src: '/src/assets/audio/bgm/lose.mp3',   loop: false, fadeMs: 400 }
}

export const SFX_LIBRARY = {
  cardDeal:     { src: '/src/assets/audio/sfx/card-deal.mp3',     volume: 0.6 },
  cardSelect:   { src: '/src/assets/audio/sfx/card-select.mp3',   volume: 0.5 },
  cardPlay:     { src: '/src/assets/audio/sfx/card-play.mp3',     volume: 0.8 },
  cardDiscard:  { src: '/src/assets/audio/sfx/card-discard.mp3',  volume: 0.7 },
  jokerTrigger: { src: '/src/assets/audio/sfx/joker-trigger.mp3', volume: 0.9 },
  scoreTick:    { src: '/src/assets/audio/sfx/score-tick.mp3',    volume: 0.4 },
  uiClick:      { src: '/src/assets/audio/sfx/ui-click.mp3',      volume: 0.6 },
  uiHover:      { src: '/src/assets/audio/sfx/ui-hover.mp3',      volume: 0.3 },
  shopBuy:      { src: '/src/assets/audio/sfx/shop-buy.mp3',      volume: 0.8 },
  shopSell:     { src: '/src/assets/audio/sfx/shop-sell.mp3',     volume: 0.7 },
  shopReroll:   { src: '/src/assets/audio/sfx/shop-reroll.mp3',   volume: 0.7 },
  blindPass:    { src: '/src/assets/audio/sfx/blind-pass.mp3',    volume: 0.9 },
  bossDefeat:   { src: '/src/assets/audio/sfx/boss-defeat.mp3',   volume: 1.0 },
  winStinger:   { src: '/src/assets/audio/sfx/win-stinger.mp3',   volume: 1.0 },
  loseStinger:  { src: '/src/assets/audio/sfx/lose-stinger.mp3',  volume: 0.9 }
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
