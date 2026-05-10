<script setup>
import { reactive, watch } from 'vue'
import * as audio from '../utils/audio.js'

defineProps({ open: Boolean })
const emit = defineEmits(['close'])

const local = reactive({
  master: Math.round(audio.getSettings().master * 100),
  bgm:    Math.round(audio.getSettings().bgm    * 100),
  sfx:    Math.round(audio.getSettings().sfx    * 100),
  muted:  audio.getSettings().muted
})

watch(local, () => {
  audio.updateSettings({
    master: local.master / 100,
    bgm:    local.bgm    / 100,
    sfx:    local.sfx    / 100,
    muted:  local.muted
  })
}, { deep: true })
</script>

<template>
  <Transition name="fade">
    <div v-if="open" class="settings-overlay" @click.self="emit('close')">
      <div class="settings-panel">
        <header class="settings-header">
          <h2>设置</h2>
          <button class="settings-close" data-no-sfx="true" @click="emit('close')">×</button>
        </header>

        <div class="settings-row">
          <label>主音量</label>
          <input type="range" min="0" max="100" v-model.number="local.master" data-no-sfx="true" />
          <span class="settings-value">{{ local.master }}</span>
        </div>

        <div class="settings-row">
          <label>BGM 音量</label>
          <input type="range" min="0" max="100" v-model.number="local.bgm" data-no-sfx="true" />
          <span class="settings-value">{{ local.bgm }}</span>
        </div>

        <div class="settings-row">
          <label>音效音量</label>
          <input type="range" min="0" max="100" v-model.number="local.sfx" data-no-sfx="true" />
          <span class="settings-value">{{ local.sfx }}</span>
        </div>

        <div class="settings-row settings-row-toggle">
          <label>静音</label>
          <button
            class="settings-toggle"
            :class="{ 'is-on': local.muted }"
            data-no-sfx="true"
            @click="local.muted = !local.muted"
          >{{ local.muted ? '已静音' : '开启' }}</button>
        </div>

        <footer class="settings-footer">
          <button class="btn-primary" @click="emit('close')">关闭</button>
        </footer>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.settings-overlay {
  position: fixed; inset: 0;
  background: rgba(10, 8, 22, 0.78);
  backdrop-filter: blur(6px);
  display: grid; place-items: center;
  z-index: 300;
}
.settings-panel {
  width: min(420px, 92vw);
  background: var(--panel-bg, #1a1330);
  border: 2px solid var(--gold, #ffd166);
  border-radius: 16px;
  padding: 20px 24px;
  box-shadow: 0 18px 0 rgba(0,0,0,.55);
  font-family: 'Press Start 2P', monospace;
  color: #f5f5f5;
}
.settings-header {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 16px;
}
.settings-header h2 { font-size: 18px; color: var(--gold, #ffd166); }
.settings-close {
  width: 32px; height: 32px; border-radius: 8px;
  background: transparent; color: #f5f5f5;
  border: 1px solid rgba(255,255,255,.2);
  font-size: 18px; cursor: pointer;
}
.settings-row {
  display: grid; grid-template-columns: 96px 1fr 40px;
  align-items: center; gap: 12px;
  margin: 12px 0;
}
.settings-row label { font-size: 12px; }
.settings-row input[type=range] { width: 100%; accent-color: var(--gold, #ffd166); }
.settings-value { text-align: right; font-size: 12px; color: var(--gold, #ffd166); }
.settings-row-toggle { grid-template-columns: 96px 1fr; }
.settings-toggle {
  padding: 6px 14px; border-radius: 999px;
  border: 1px solid rgba(255,255,255,.25);
  background: transparent; color: #f5f5f5;
  font-family: inherit; font-size: 11px; cursor: pointer;
}
.settings-toggle.is-on {
  background: var(--danger, #e34b6f); border-color: var(--danger, #e34b6f);
}
.settings-footer { margin-top: 18px; text-align: center; }

.fade-enter-active, .fade-leave-active { transition: opacity 0.18s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
