<script setup>
defineProps({
  open: Boolean,
  joker: { type: Object, default: null },
  context: { type: String, default: 'owned' }  // 'shop' | 'owned'
})
const emit = defineEmits(['close'])

const rarityLabel = {
  common: '常见',
  uncommon: '罕见',
  rare: '稀有',
  legendary: '传说'
}
</script>

<template>
  <Transition name="popover">
    <div v-if="open && joker" class="popover-overlay" @click.self="emit('close')">
      <div class="popover-panel">
        <header class="popover-header">
          <span class="popover-rarity" :class="`rarity-${joker.rarity}`">
            {{ rarityLabel[joker.rarity] }}
          </span>
          <h3>{{ joker.name }}</h3>
        </header>
        <p class="popover-desc">{{ joker.description }}</p>
        <footer class="popover-footer">
          <span v-if="context === 'shop'">价格 ${{ joker.price }}</span>
          <span v-else>出售价 ${{ Math.floor(joker.price / 2) }}</span>
          <button class="btn-ghost-sm" data-no-sfx="true" @click="emit('close')">关闭</button>
        </footer>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.popover-overlay {
  position: fixed; inset: 0;
  background: rgba(10, 8, 22, 0.6);
  backdrop-filter: blur(4px);
  z-index: 280;
  display: flex; align-items: flex-end; justify-content: center;
}
.popover-panel {
  width: min(420px, 100vw);
  background: var(--panel-bg, #1a1330);
  border-top: 2px solid var(--gold, #ffd166);
  border-radius: 16px 16px 0 0;
  padding: 16px 20px;
  padding-bottom: max(env(safe-area-inset-bottom), 16px);
  font-family: 'Press Start 2P', monospace;
  color: #f5f5f5;
}
.popover-header { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.popover-header h3 { font-size: 14px; }
.popover-rarity {
  padding: 2px 8px; border-radius: 999px;
  font-size: 10px; line-height: 1;
}
.popover-rarity.rarity-common    { background: #4a6fa5; }
.popover-rarity.rarity-uncommon  { background: #5bc97a; }
.popover-rarity.rarity-rare      { background: #e34b6f; }
.popover-rarity.rarity-legendary { background: #b577ff; }
.popover-desc {
  font-size: 11px; line-height: 1.6;
  color: #d8d4ec;
  margin: 12px 0 16px;
}
.popover-footer {
  display: flex; align-items: center; justify-content: space-between;
  font-size: 11px;
}
.btn-ghost-sm {
  background: transparent; color: #f5f5f5;
  border: 1px solid rgba(255,255,255,.25);
  border-radius: 6px;
  padding: 4px 12px;
  font-family: inherit; font-size: 10px;
  cursor: pointer;
}

.popover-enter-active, .popover-leave-active {
  transition: opacity 0.2s ease;
}
.popover-enter-active .popover-panel,
.popover-leave-active .popover-panel {
  transition: transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.popover-enter-from { opacity: 0; }
.popover-enter-from .popover-panel { transform: translateY(100%); }
.popover-leave-to { opacity: 0; }
.popover-leave-to .popover-panel { transform: translateY(100%); }
</style>
