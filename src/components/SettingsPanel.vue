<script setup>
import { computed, reactive, ref, watch } from 'vue'
import * as audio from '../utils/audio.js'
import * as ai from '../utils/ai-coach.js'
import { AI_PROVIDERS, DEFAULT_PROMPTS } from '../config/ai.js'

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

function getModelsForProvider(providerKey) {
  return AI_PROVIDERS[providerKey]?.models || []
}
const availableModels = ref(getModelsForProvider(aiSettings.provider))

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

// ============== 提示词自定义（v3.2.1）==============

const promptScenes = [
  { key: 'play',    label: '出牌',  hint: '战斗中：让 AI 推荐"打出哪几张牌"的组合' },
  { key: 'discard', label: '弃牌',  hint: '战斗中：让 AI 推荐"弃掉哪几张牌"换新' },
  { key: 'shop',    label: '商店',  hint: '商店中：让 AI 推荐"买 / 卖 / 刷新 / 跳过"' },
  { key: 'blind',   label: '盲注',  hint: '盲注阶段：让 AI 推荐"选哪个盲注"' }
]

const activeScene = ref('play')

const currentSceneHint = computed(() =>
  promptScenes.find(s => s.key === activeScene.value)?.hint || ''
)

// 初始值：若用户已自定义则用自定义版，否则用默认 prompt
const _initialCustom = ai.getCustomPrompts()
const promptDrafts = reactive({
  play:    _initialCustom.play    || DEFAULT_PROMPTS.play,
  discard: _initialCustom.discard || DEFAULT_PROMPTS.discard,
  shop:    _initialCustom.shop    || DEFAULT_PROMPTS.shop,
  blind:   _initialCustom.blind   || DEFAULT_PROMPTS.blind
})

const customizedFlags = reactive({
  play:    Boolean(_initialCustom.play),
  discard: Boolean(_initialCustom.discard),
  shop:    Boolean(_initialCustom.shop),
  blind:   Boolean(_initialCustom.blind)
})

const currentCharCount = computed(() =>
  (promptDrafts[activeScene.value] || '').length
)

function isCustomized(scene) {
  return customizedFlags[scene]
}

// textarea 输入：与默认完全相同 → 标记为未自定义 + 删除存储；否则保存自定义版
function onPromptInput() {
  const scene = activeScene.value
  const draft = promptDrafts[scene]
  if (draft === DEFAULT_PROMPTS[scene]) {
    ai.setCustomPrompt(scene, '')
    customizedFlags[scene] = false
  } else {
    ai.setCustomPrompt(scene, draft)
    customizedFlags[scene] = true
  }
}

function resetPrompt(scene) {
  promptDrafts[scene] = DEFAULT_PROMPTS[scene]
  ai.resetCustomPrompt(scene)
  customizedFlags[scene] = false
}

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
      <div class="settings-panel" :class="{ 'settings-panel-wide': activeTab === 'prompts' }">
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
          <button
            class="settings-tab"
            :class="{ active: activeTab === 'prompts' }"
            data-no-sfx="true"
            @click="activeTab = 'prompts'"
          >提示词</button>
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

        <!-- 提示词标签页 -->
        <section v-if="activeTab === 'prompts'" class="settings-section prompts-section">
          <!-- 场景切换器 -->
          <div class="prompt-scene-tabs">
            <button
              v-for="s in promptScenes"
              :key="s.key"
              class="prompt-scene-tab"
              :class="{ active: activeScene === s.key }"
              data-no-sfx="true"
              @click="activeScene = s.key"
            >
              <span class="prompt-scene-label">{{ s.label }}</span>
              <span v-if="isCustomized(s.key)" class="prompt-customized-dot" title="已自定义">●</span>
            </button>
          </div>

          <p class="prompt-scene-hint">{{ currentSceneHint }}</p>

          <!-- 编辑区 -->
          <div class="prompt-edit-wrap">
            <textarea
              v-model="promptDrafts[activeScene]"
              class="prompt-textarea"
              spellcheck="false"
              data-no-sfx="true"
              @input="onPromptInput"
            ></textarea>
            <div class="prompt-meta">
              <span class="prompt-meta-left">
                <span class="prompt-char-count">{{ currentCharCount }} 字符</span>
                <span v-if="isCustomized(activeScene)" class="prompt-status-tag is-custom">已自定义</span>
                <span v-else class="prompt-status-tag is-default">默认</span>
              </span>
              <button
                class="prompt-reset-btn"
                data-no-sfx="true"
                :disabled="!isCustomized(activeScene)"
                @click="resetPrompt(activeScene)"
              >恢复默认</button>
            </div>
          </div>

          <p class="prompt-note">
            修改后立即生效（下一次 AI 决策时使用）。把内容改回默认 = 自动恢复未自定义状态。
            想让 AI 更聪明？在原 prompt 基础上补充：牌型基础分表、当前持有 Joker 列表、Boss 规则示例。
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

/* ============== 提示词标签页（v3.2.1）============== */

.settings-panel-wide { width: min(680px, 94vw); }

.prompts-section { min-height: 460px; }

.prompt-scene-tabs {
  display: flex;
  gap: 6px;
  margin-bottom: 10px;
}
.prompt-scene-tab {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 7px 6px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 7px;
  color: #8b8aa3;
  font-family: inherit;
  font-size: 10px;
  cursor: pointer;
  transition: color 0.15s, background 0.15s, border-color 0.15s, transform 0.1s;
}
.prompt-scene-tab:hover { color: #cfcde3; }
.prompt-scene-tab:active { transform: translateY(1px); }
.prompt-scene-tab.active {
  color: var(--gold, #ffd166);
  background: rgba(255, 209, 102, 0.12);
  border-color: var(--gold, #ffd166);
  box-shadow: 0 0 0 1px rgba(255, 209, 102, 0.2) inset;
}
.prompt-customized-dot {
  color: #62d18b;
  font-size: 8px;
  line-height: 1;
}

.prompt-scene-hint {
  margin: 0 0 10px;
  font-size: 10px;
  color: #8b8aa3;
  line-height: 1.5;
}

.prompt-edit-wrap {
  background: #110b1e;
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 10px;
  overflow: hidden;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04), 0 6px 0 rgba(0, 0, 0, 0.35);
}
.prompt-textarea {
  width: 100%;
  box-sizing: border-box;
  display: block;
  min-height: 320px;
  max-height: 56vh;
  padding: 14px 16px;
  background: transparent;
  border: none;
  color: #f0eef9;
  font-family: 'SF Mono', 'Menlo', 'Consolas', monospace;
  font-size: 11px;
  line-height: 1.7;
  resize: vertical;
  outline: none;
  white-space: pre-wrap;
  word-break: break-word;
  overflow-y: auto;
  tab-size: 2;
}
.prompt-textarea::-webkit-scrollbar { width: 8px; }
.prompt-textarea::-webkit-scrollbar-track { background: transparent; }
.prompt-textarea::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.12);
  border-radius: 4px;
}
.prompt-textarea::-webkit-scrollbar-thumb:hover { background: rgba(255, 255, 255, 0.22); }

.prompt-meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 14px;
  background: rgba(0, 0, 0, 0.35);
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}
.prompt-meta-left {
  display: flex;
  align-items: center;
  gap: 10px;
}
.prompt-char-count {
  font-size: 9px;
  color: #6b6478;
  font-family: 'SF Mono', monospace;
}
.prompt-status-tag {
  display: inline-block;
  padding: 2px 7px;
  border-radius: 999px;
  font-size: 8px;
  letter-spacing: 0.5px;
}
.prompt-status-tag.is-default {
  color: #6b6478;
  background: rgba(255, 255, 255, 0.04);
}
.prompt-status-tag.is-custom {
  color: #62d18b;
  background: rgba(98, 209, 139, 0.12);
  border: 1px solid rgba(98, 209, 139, 0.3);
}
.prompt-reset-btn {
  padding: 5px 12px;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  background: transparent;
  color: #f5f5f5;
  font-family: inherit;
  font-size: 9px;
  cursor: pointer;
  transition: opacity 0.15s, border-color 0.15s, color 0.15s;
}
.prompt-reset-btn:disabled {
  opacity: 0.3;
  cursor: default;
}
.prompt-reset-btn:not(:disabled):hover {
  border-color: var(--danger, #e34b6f);
  color: var(--danger, #e34b6f);
}

.prompt-note {
  margin: 14px 0 0;
  font-size: 9px;
  color: #8b8aa3;
  line-height: 1.7;
}

.fade-enter-active, .fade-leave-active { transition: opacity 0.18s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
