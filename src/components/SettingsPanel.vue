<script setup>
import { reactive, ref, watch } from 'vue'
import * as audio from '../utils/audio.js'
import * as ai from '../utils/ai-coach.js'

defineProps({ open: Boolean })
const emit = defineEmits(['close'])

const activeTab = ref('audio')

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

// AI 设置
const aiSettings = reactive({ ...ai.getSettings() })
const pingStatus = ref('idle')  // idle | pinging | ok | fail
const pingMessage = ref('')

// AI providers 展开为 flat array
const providerKeys = Object.keys(aiSettings.provider
  ? { [aiSettings.provider]: {} }
  : {})

const availableModels = ref(getModelsForProvider(aiSettings.provider))
function getModelsForProvider(providerKey) {
  const providers = { anthropic: 'Anthropic (Claude)', openai: 'OpenAI (GPT)' }
  // 从 ai config 获取模型列表
  try {
    const cfg = { anthropic: { models: [
      { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5（快、便宜，推荐）' },
      { id: 'claude-sonnet-4-6',         label: 'Claude Sonnet 4.6（更强）' },
      { id: 'claude-opus-4-7',           label: 'Claude Opus 4.7（最强、最贵）' }
    ]}, openai: { models: [
      { id: 'gpt-4o-mini', label: 'GPT-4o mini（快、便宜，推荐）' },
      { id: 'gpt-4o',      label: 'GPT-4o（更强）' }
    ]}, deepseek: { models: [
      { id: 'deepseek-v4-flash', label: 'DeepSeek-V4-Flash（快、便宜，推荐）' },
      { id: 'deepseek-v4-pro',   label: 'DeepSeek-V4-Pro（更强）' }
    ]}}
    return cfg[providerKey]?.models || []
  } catch (_) { return [] }
}

watch(() => aiSettings.provider, (p) => {
  const models = getModelsForProvider(p)
  availableModels.value = models
  if (models.length > 0) {
    aiSettings.model = models[0].id
  }
})

function saveAiSettings() {
  ai.updateSettings({
    enabled: aiSettings.enabled,
    provider: aiSettings.provider,
    apiKey: aiSettings.apiKey,
    model: aiSettings.model
  })
}

watch(() => aiSettings.enabled, saveAiSettings)
watch(() => aiSettings.provider, saveAiSettings)
watch(() => aiSettings.apiKey, saveAiSettings)
watch(() => aiSettings.model, saveAiSettings)

async function testConnection() {
  pingStatus.value = 'pinging'
  pingMessage.value = ''
  try {
    await ai.pingProvider()
    pingStatus.value = 'ok'
    pingMessage.value = '连接正常'
  } catch (e) {
    pingStatus.value = 'fail'
    pingMessage.value = `连接失败：${e.detail || e.reason || '未知错误'}`
  }
}
</script>

<template>
  <Transition name="fade">
    <div v-if="open" class="settings-overlay" @click.self="emit('close')">
      <div class="settings-panel">
        <header class="settings-header">
          <h2>设置</h2>
          <button class="settings-close" data-no-sfx="true" @click="emit('close')">×</button>
        </header>

        <!-- 标签切换 -->
        <div class="settings-tabs">
          <button
            class="settings-tab"
            :class="{ active: activeTab === 'audio' }"
            data-no-sfx="true"
            @click="activeTab = 'audio'"
          >音频</button>
          <button
            class="settings-tab"
            :class="{ active: activeTab === 'ai' }"
            data-no-sfx="true"
            @click="activeTab = 'ai'"
          >AI 教练</button>
        </div>

        <!-- 音频标签页 -->
        <section v-if="activeTab === 'audio'" class="settings-section">
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
        </section>

        <!-- AI 教练标签页 -->
        <section v-if="activeTab === 'ai'" class="settings-section">
          <div class="settings-row settings-row-toggle">
            <label>启用 AI 教练</label>
            <button
              class="settings-toggle"
              :class="{ 'is-on': aiSettings.enabled }"
              data-no-sfx="true"
              @click="aiSettings.enabled = !aiSettings.enabled"
            >{{ aiSettings.enabled ? '已启用' : '已关闭' }}</button>
          </div>

          <div class="settings-row">
            <label>AI 供应商</label>
            <select v-model="aiSettings.provider" class="settings-select" data-no-sfx="true">
              <option value="anthropic">Anthropic (Claude)</option>
              <option value="openai">OpenAI (GPT)</option>
              <option value="deepseek">DeepSeek</option>
            </select>
          </div>

          <div class="settings-row">
            <label>API Key</label>
            <input
              type="password"
              autocomplete="new-password"
              class="settings-input"
              placeholder="sk-...（仅保存在你的浏览器，不会上传）"
              v-model="aiSettings.apiKey"
              data-no-sfx="true"
            />
          </div>

          <div class="settings-row">
            <label>模型</label>
            <select v-model="aiSettings.model" class="settings-select" data-no-sfx="true">
              <option v-for="m in availableModels" :key="m.id" :value="m.id">{{ m.label }}</option>
            </select>
          </div>

          <div class="settings-row settings-row-action">
            <label></label>
            <button
              class="settings-test-btn"
              :disabled="pingStatus === 'pinging' || !aiSettings.apiKey"
              data-no-sfx="true"
              @click="testConnection"
            >{{ pingStatus === 'pinging' ? '测试中…' : '测试连接' }}</button>
            <span
              v-if="pingStatus === 'ok' || pingStatus === 'fail'"
              class="settings-test-status"
              :class="{ ok: pingStatus === 'ok', fail: pingStatus === 'fail' }"
            >{{ pingStatus === 'ok' ? '✓' : '✗' }} {{ pingMessage }}</span>
          </div>

          <p class="settings-security-note">
            Key 仅保存在本地 localStorage，刷新页面后保留，关闭浏览器不丢失，但若清空站点数据会丢失。请勿在公共电脑使用此功能。
          </p>
        </section>

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
  max-height: 90vh;
  overflow-y: auto;
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

/* 标签栏 */
.settings-tabs {
  display: flex; gap: 0;
  margin-bottom: 16px;
  border-bottom: 1px solid rgba(255,255,255,.1);
}
.settings-tab {
  flex: 1;
  padding: 8px 12px;
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  color: #8b8aa3;
  font-family: inherit;
  font-size: 12px;
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s;
}
.settings-tab.active {
  color: var(--gold, #ffd166);
  border-bottom-color: var(--gold, #ffd166);
}

.settings-section { min-height: 200px; }

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

/* AI 设置控件 */
.settings-select,
.settings-input {
  width: 100%;
  padding: 6px 10px;
  background: #110b1e;
  border: 1px solid rgba(255,255,255,.15);
  border-radius: 6px;
  color: #f5f5f5;
  font-family: inherit;
  font-size: 11px;
}
.settings-input::placeholder { color: #6b6478; }
.settings-row-action {
  grid-template-columns: 96px 1fr auto;
  gap: 8px;
}
.settings-test-btn {
  padding: 6px 14px;
  border-radius: 6px;
  border: 1px solid var(--gold, #ffd166);
  background: transparent;
  color: var(--gold, #ffd166);
  font-family: inherit;
  font-size: 10px;
  cursor: pointer;
}
.settings-test-btn:disabled {
  opacity: 0.4;
  cursor: default;
}
.settings-test-status {
  font-size: 10px;
  white-space: nowrap;
}
.settings-test-status.ok   { color: #62d18b; }
.settings-test-status.fail { color: #ef476f; }

.settings-security-note {
  margin: 16px 0 0;
  font-size: 9px;
  color: #8b8aa3;
  line-height: 1.6;
}

.settings-footer { margin-top: 18px; text-align: center; }

.fade-enter-active, .fade-leave-active { transition: opacity 0.18s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
