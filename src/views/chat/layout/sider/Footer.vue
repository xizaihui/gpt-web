<script setup lang='ts'>
import { ref, watch, onMounted } from 'vue'
import { useSettingStore } from '@/store'
import Icon from '@/components/common/Icon.vue'

const settingStore = useSettingStore()
const showPanel = ref(false)

// Local state
const contextRounds = ref(settingStore.contextRounds)
const apiBaseUrl = ref(settingStore.apiBaseUrl)
const apiKey = ref(settingStore.apiKey)
const showApiKey = ref(false)

const DEFAULT_URL = import.meta.env.VITE_DEFAULT_API_BASE_URL || ''

// Pool stats
const activeTab = ref<'api' | 'codex'>('api')

const codexModels = [
  { id: 'gpt-5.4', name: 'GPT-5.4' },
  { id: 'gpt-5.4-mini', name: 'GPT-5.4 Mini' },
]

function openPanel() {
  contextRounds.value = settingStore.contextRounds
  apiBaseUrl.value = settingStore.apiBaseUrl || DEFAULT_URL
  apiKey.value = settingStore.apiKey || ''
  showApiKey.value = false
  showPanel.value = true
}

function closePanel() {
  showPanel.value = false
}

function saveContextRounds() {
  const val = Math.max(0, Math.min(100, Math.round(contextRounds.value)))
  contextRounds.value = val
  settingStore.updateSetting({ contextRounds: val })
}

function saveApiConfig() {
  settingStore.updateSetting({
    apiBaseUrl: apiBaseUrl.value,
    apiKey: apiKey.value,
  })
}

// Status
const hasApiConfig = ref(false)
watch([() => settingStore.apiKey, () => settingStore.apiBaseUrl], () => {
  hasApiConfig.value = !!(settingStore.apiKey && settingStore.apiBaseUrl)
}, { immediate: true })

const statusText = ref('')
watch(hasApiConfig, () => {
  statusText.value = hasApiConfig.value ? 'API 已配置' : '未配置'
}, { immediate: true })
</script>

<template>
  <footer class="relative flex items-center px-3 py-3 flex-shrink-0 border-t border-[#e0e0e0]">
    <div
      class="flex items-center gap-2.5 flex-1 min-w-0 cursor-pointer rounded-lg px-1.5 py-1.5 -mx-1 hover:bg-[#ececec] transition-colors"
      @click="openPanel"
    >
      <div class="relative w-8 h-8 rounded-full bg-[#19c37d] flex items-center justify-center flex-shrink-0 text-white text-xs font-semibold">
        U
        <div
          class="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-[#f9f9f9]"
          :class="hasApiConfig ? 'bg-[#19c37d]' : 'bg-[#f59e0b]'"
        />
      </div>
      <div class="flex flex-col min-w-0">
        <span class="text-sm font-medium text-[#0d0d0d] truncate leading-tight">设置</span>
        <span class="text-[11px] text-[#999] truncate leading-tight">{{ statusText }}</span>
      </div>
      <Icon name="settings" :size="16" class="ml-auto text-[#999] flex-shrink-0" />
    </div>

    <!-- Settings Panel -->
    <Teleport to="body">
      <div v-if="showPanel" class="fixed inset-0 z-[200]" @click.self="closePanel">
        <div class="fixed left-0 bottom-0 w-[320px] max-h-[85vh] bg-white rounded-tr-2xl shadow-[0_-4px_32px_rgba(0,0,0,0.12)] border-t border-r border-[#e3e3e3] flex flex-col">
          <!-- Header -->
          <div class="flex items-center justify-between px-5 pt-5 pb-3 flex-shrink-0">
            <span class="text-[15px] font-semibold text-[#0d0d0d]">设置</span>
            <button class="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-[#f4f4f4] text-[#999] hover:text-[#0d0d0d] transition-colors" @click="closePanel">
              <Icon name="x" :size="16" />
            </button>
          </div>

          <!-- Tabs -->
          <div class="flex px-5 gap-1 mb-3 flex-shrink-0">
            <button class="tab-btn" :class="activeTab === 'api' ? 'tab-active' : 'tab-inactive'" @click="activeTab = 'api'">
              API 模式
            </button>
            <button class="tab-btn" :class="activeTab === 'codex' ? 'tab-active' : 'tab-inactive'" @click="activeTab = 'codex'">
              订阅模式
            </button>
          </div>

          <!-- Scrollable content — fixed height so tab switch doesn't jump -->
          <div class="overflow-y-auto flex-1 px-5 pb-5" style="height: 320px;">
            <!-- API Tab -->
            <div v-if="activeTab === 'api'" class="space-y-4">
              <section>
                <h3 class="section-title">API 配置</h3>
                <div class="mb-3">
                  <label class="field-label">Base URL</label>
                  <input v-model="apiBaseUrl" type="text" class="settings-input" placeholder="https://api.openai.com/v1" @change="saveApiConfig">
                </div>
                <div>
                  <label class="field-label">API Key</label>
                  <div class="relative">
                    <input v-model="apiKey" :type="showApiKey ? 'text' : 'password'" class="settings-input pr-9" placeholder="sk-..." @change="saveApiConfig">
                    <button class="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#999] hover:text-[#666] transition-colors" @click="showApiKey = !showApiKey">
                      <Icon :name="showApiKey ? 'eye-off' : 'eye'" :size="15" />
                    </button>
                  </div>
                </div>
              </section>
            </div>

            <!-- Codex Tab -->
            <div v-if="activeTab === 'codex'" class="space-y-4">
              <section>
                <h3 class="section-title">ChatGPT 官方订阅号</h3>
                <p class="text-[12px] text-[#666] mb-3 leading-relaxed">
                  体验 ChatGPT Plus/Pro 订阅额度调用 GPT-5.4，不消耗 API 余额。官方原版订阅号，不降智。
                </p>
                <label class="field-label">可用模型</label>
                <div class="space-y-1">
                  <div v-for="m in codexModels" :key="m.id" class="flex items-center gap-2 px-3 py-2 bg-[#f4f4f4] rounded-xl">
                    <span class="w-1.5 h-1.5 rounded-full bg-[#19c37d] flex-shrink-0" />
                    <span class="text-[13px] text-[#0d0d0d]">{{ m.name }}</span>
                  </div>
                </div>
              </section>
            </div>

            <!-- Separator -->
            <div class="border-t border-[#f0f0f0] my-4" />

            <!-- Context rounds (always visible) -->
            <section>
              <h3 class="section-title">对话设置</h3>
              <div>
                <div class="flex items-center justify-between mb-2">
                  <label class="field-label mb-0">上下文轮数</label>
                  <span class="text-xs text-[#999] tabular-nums">{{ contextRounds }} 轮</span>
                </div>
                <input
                  v-model.number="contextRounds"
                  type="range" min="0" max="50" step="1"
                  class="w-full h-1.5 bg-[#e5e5e5] rounded-full appearance-none cursor-pointer accent-[#0d0d0d]"
                  @input="saveContextRounds"
                >
                <div class="flex justify-between mt-1">
                  <span class="text-[11px] text-[#bbb]">关闭</span>
                  <span class="text-[11px] text-[#bbb]">50</span>
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>
    </Teleport>
  </footer>
</template>

<style scoped>
.settings-input { @apply w-full px-3 py-2 bg-[#f4f4f4] border border-[#e3e3e3] rounded-xl text-sm text-[#0d0d0d] outline-none transition-colors; }
.settings-input:focus { @apply border-[#999]; }
.section-title { @apply text-xs font-semibold text-[#999] uppercase tracking-wider mb-3; }
.field-label { @apply block text-[13px] font-medium text-[#0d0d0d] mb-1.5; }
.tab-btn { @apply flex items-center px-3 py-1.5 text-[13px] font-medium rounded-lg transition-colors; }
.tab-active { @apply bg-[#0d0d0d] text-white; }
.tab-inactive { @apply text-[#666] hover:bg-[#f4f4f4]; }

input[type="range"]::-webkit-slider-thumb {
  -webkit-appearance: none; appearance: none;
  width: 16px; height: 16px; border-radius: 50%;
  background: #0d0d0d; cursor: pointer;
  border: 2px solid white; box-shadow: 0 1px 3px rgba(0,0,0,0.2);
}
input[type="range"]::-moz-range-thumb {
  width: 16px; height: 16px; border-radius: 50%;
  background: #0d0d0d; cursor: pointer;
  border: 2px solid white; box-shadow: 0 1px 3px rgba(0,0,0,0.2);
}
</style>
