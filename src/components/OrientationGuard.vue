<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import * as audio from '../utils/audio.js'

const isLandscape = ref(false)
let mql = null
let bgmSnapshot = null

function check() {
  const landscape = window.innerWidth > window.innerHeight && window.innerWidth < 1024
  if (landscape && !isLandscape.value) {
    bgmSnapshot = audio.getCurrentBgmTrack?.() ?? null
    audio.stopBgm()
  } else if (!landscape && isLandscape.value && bgmSnapshot) {
    audio.playBgm(bgmSnapshot)
    bgmSnapshot = null
  }
  isLandscape.value = landscape
}

onMounted(() => {
  check()
  mql = window.matchMedia('(orientation: landscape)')
  mql.addEventListener?.('change', check)
  window.addEventListener('resize', check)
})

onBeforeUnmount(() => {
  mql?.removeEventListener?.('change', check)
  window.removeEventListener('resize', check)
})
</script>

<template>
  <Transition name="fade">
    <div v-if="isLandscape" class="orientation-guard">
      <div class="orientation-icon" aria-hidden="true">
        <div class="phone-frame"></div>
        <div class="rotate-arrow"></div>
      </div>
      <p class="orientation-text">请竖屏游玩</p>
      <p class="orientation-sub">这款游戏专为竖屏设计</p>
    </div>
  </Transition>
</template>

<style scoped>
.orientation-guard {
  position: fixed; inset: 0;
  background: var(--bg-deep, #0a0816);
  z-index: 500;
  display: grid; place-items: center; align-content: center;
  gap: 18px;
  font-family: 'Press Start 2P', monospace;
  color: #f5f5f5;
  padding-top:   env(safe-area-inset-top, 0);
  padding-bottom: env(safe-area-inset-bottom, 0);
}
.orientation-icon {
  position: relative;
  width: 80px; height: 80px;
  display: grid; place-items: center;
}
.phone-frame {
  width: 36px; height: 60px;
  border: 3px solid var(--gold, #ffd166);
  border-radius: 6px;
  animation: phone-rotate 1.6s ease-in-out infinite;
}
.rotate-arrow {
  position: absolute;
  width: 0; height: 0;
  border-left: 8px solid transparent;
  border-right: 8px solid transparent;
  border-bottom: 12px solid var(--gold, #ffd166);
  top: 6px; right: -2px;
  animation: arrow-flicker 1.6s ease-in-out infinite;
}
@keyframes phone-rotate {
  0%, 100% { transform: rotate(-90deg); }
  50%      { transform: rotate(0deg); }
}
@keyframes arrow-flicker {
  0%, 100% { opacity: 0.3; }
  50%      { opacity: 1; }
}
.orientation-text { font-size: 18px; color: var(--gold, #ffd166); }
.orientation-sub  { font-size: 11px; color: #8b8aa3; }

.fade-enter-active, .fade-leave-active { transition: opacity 0.2s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
