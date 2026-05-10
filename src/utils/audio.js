import { Howl, Howler } from 'howler'
import { BGM_TRACKS, SFX_LIBRARY, DEFAULT_VOLUME, AUDIO_STORAGE_KEY } from '../config/audio.js'

const sfxPool = {}        // name -> Howl
const bgmPool = {}        // track -> Howl
let currentBgm = null     // { track, howl }
let unlocked = false      // 是否已通过用户首次交互解锁

const settings = loadSettings()

function loadSettings() {
  try {
    const raw = localStorage.getItem(AUDIO_STORAGE_KEY)
    if (raw) return { ...DEFAULT_VOLUME, ...JSON.parse(raw) }
  } catch (_) { /* ignore */ }
  return { ...DEFAULT_VOLUME }
}

function saveSettings() {
  try {
    localStorage.setItem(AUDIO_STORAGE_KEY, JSON.stringify(settings))
  } catch (_) { /* ignore */ }
}

function effectiveVolume(layer, base) {
  if (settings.muted) return 0
  return Math.max(0, Math.min(1, base * settings.master * settings[layer]))
}

function ensureSfx(name) {
  if (sfxPool[name]) return sfxPool[name]
  const cfg = SFX_LIBRARY[name]
  if (!cfg) return null
  sfxPool[name] = new Howl({
    src: [cfg.src],
    volume: effectiveVolume('sfx', cfg.volume),
    preload: true,
    html5: false,
    onloaderror: () => { /* 资源缺失静默忽略，避免控制台噪声 */ },
    onplayerror: () => { /* 同上 */ }
  })
  return sfxPool[name]
}

function ensureBgm(track) {
  if (bgmPool[track]) return bgmPool[track]
  const cfg = BGM_TRACKS[track]
  if (!cfg) return null
  bgmPool[track] = new Howl({
    src: [cfg.src],
    loop: cfg.loop,
    volume: 0,                  // 实际音量由 fadeIn 控制
    html5: true,                // 长资源用 streaming
    onloaderror: () => { /* ignore */ },
    onplayerror: () => { /* ignore */ }
  })
  return bgmPool[track]
}

function applyAllVolumes() {
  for (const [name, howl] of Object.entries(sfxPool)) {
    howl.volume(effectiveVolume('sfx', SFX_LIBRARY[name].volume))
  }
  if (currentBgm?.howl) {
    currentBgm.howl.volume(effectiveVolume('bgm', 1))
  }
}

export function preloadSfx() {
  for (const name of Object.keys(SFX_LIBRARY)) ensureSfx(name)
}

export function unlock() {
  if (unlocked) return
  unlocked = true
  Howler.mute(settings.muted)
}

export function isUnlocked() {
  return unlocked
}

export function playSfx(name) {
  if (!unlocked || settings.muted) return
  const howl = ensureSfx(name)
  if (!howl) return
  howl.play()
}

export function playBgm(track) {
  if (!track) {
    stopBgm()
    return
  }
  if (currentBgm?.track === track) return
  const next = ensureBgm(track)
  if (!next) return

  if (currentBgm?.howl) {
    const old = currentBgm.howl
    const oldFade = BGM_TRACKS[currentBgm.track].fadeMs
    old.fade(old.volume(), 0, oldFade)
    setTimeout(() => old.stop(), oldFade + 50)
  }

  next.volume(0)
  next.play()
  next.fade(0, effectiveVolume('bgm', 1), BGM_TRACKS[track].fadeMs)
  currentBgm = { track, howl: next }
}

export function stopBgm() {
  if (!currentBgm?.howl) return
  const old = currentBgm.howl
  const fadeMs = BGM_TRACKS[currentBgm.track].fadeMs
  old.fade(old.volume(), 0, fadeMs)
  setTimeout(() => old.stop(), fadeMs + 50)
  currentBgm = null
}

export function getSettings() {
  return { ...settings }
}

export function updateSettings(patch) {
  Object.assign(settings, patch)
  saveSettings()
  if ('muted' in patch) Howler.mute(settings.muted)
  applyAllVolumes()
}
