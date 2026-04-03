<script setup lang='ts'>
import { ref, watch } from 'vue'
import { useSettingStore } from '@/store'
import Icon from '@/components/common/Icon.vue'

const settingStore = useSettingStore()
const showPanel = ref(false)

// Local state (synced on open)
const contextRounds = ref(settingStore.contextRounds)
const apiBaseUrl = ref(settingStore.apiBaseUrl)
const apiKey = ref(settingStore.apiKey)
const showApiKey = ref(false)

const DEFAULT_URL = import.meta.env.VITE_DEFAULT_API_BASE_URL || ''

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

// Mask API key display
function maskedKey(key: string): string {
  if (!key) return ''
  if (key.length <= 8) return '••••••••'
  return key.slice(0, 4) + '••••••••' + key.slice(-4)
}

// Connection status indicator
const hasApiConfig = ref(false)
watch([() => settingStore.apiKey, () => settingStore.apiBaseUrl], () => {
  hasApiConfig.value = !!(settingStore.apiKey && settingStore.apiBaseUrl)
}, { immediate: true })
</script>

<template>
  <footer class="relative flex items-center px-3 py-3 flex-shrink-0 border-t border-[#e0e0e0]">
    <div
      class="flex items-center gap-2.5 flex-1 min-w-0 cursor-pointer rounded-lg px-1.5 py-1.5 -mx-1 hover:bg-[#ececec] transition-colors"
      @click="openPanel"
    >
      <!-- Avatar -->
      <div class="relative w-8 h-8 rounded-full bg-[#19c37d] flex items-center justify-center flex-shrink-0 text-white text-xs font-semibold">
        U
        <!-- Status dot -->
        <div
          class="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-[#f9f9f9]"
          :class="hasApiConfig ? 'bg-[#19c37d]' : 'bg-[#f59e0b]'"
        />
      </div>
      <div class="flex flex-col min-w-0">
        <span class="text-sm font-medium text-[#0d0d0d] truncate leading-tight">设置</span>
        <span class="text-[11px] text-[#999] truncate leading-tight">
          {{ hasApiConfig ? '已配置' : '未配置 API' }}
        </span>
      </div>
      <Icon name="settings" :size="16" class="ml-auto text-[#999] flex-shrink-0" />
    </div>

    <!-- Settings Panel -->
    <Teleport to="body">
      <div v-if="showPanel" class="fixed inset-0 z-[200]" @click.self="closePanel">
        <!-- Panel slides up from bottom-left aligned with sidebar -->
        <div
          class="fixed left-0 bottom-0 w-[260px] max-h-[80vh] bg-white rounded-tr-2xl rounded-tl-0 shadow-[0_-4px_32px_rgba(0,0,0,0.12)] border-t border-r border-[#e3e3e3] overflow-y-auto"
        >
          <!-- Header -->
          <div class="sticky top-0 bg-white flex items-center justify-between px-5 pt-5 pb-3">
            <span class="text-[15px] font-semibold text-[#0d0d0d]">设置</span>
            <button
              class="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-[#f4f4f4] text-[#999] hover:text-[#0d0d0d] transition-colors"
              @click="closePanel"
            >
              <Icon name="x" :size="16" />
            </button>
          </div>

          <div class="px-5 pb-5 space-y-5">
            <!-- Section: API Configuration -->
            <section>
              <h3 class="text-xs font-semibold text-[#999] uppercase tracking-wider mb-3">API 配置</h3>

              <!-- Base URL -->
              <div class="mb-3">
                <label class="block text-[13px] font-medium text-[#0d0d0d] mb-1.5">Base URL</label>
                <input
                  v-model="apiBaseUrl"
                  type="text"
                  class="settings-input"
                  placeholder="https://api.openai.com/v1"
                  @change="saveApiConfig"
                >
              </div>

              <!-- API Key -->
              <div>
                <label class="block text-[13px] font-medium text-[#0d0d0d] mb-1.5">API Key</label>
                <div class="relative">
                  <input
                    v-model="apiKey"
                    :type="showApiKey ? 'text' : 'password'"
                    class="settings-input pr-9"
                    placeholder="sk-..."
                    @change="saveApiConfig"
                  >
                  <button
                    class="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#999] hover:text-[#666] transition-colors"
                    @click="showApiKey = !showApiKey"
                  >
                    <Icon :name="showApiKey ? 'eye-off' : 'eye'" :size="15" />
                  </button>
                </div>
              </div>
            </section>

            <div class="border-t border-[#f0f0f0]" />

            <!-- Section: Conversation -->
            <section>
              <h3 class="text-xs font-semibold text-[#999] uppercase tracking-wider mb-3">对话设置</h3>

              <!-- Context Rounds -->
              <div>
                <div class="flex items-center justify-between mb-2">
                  <label class="text-[13px] font-medium text-[#0d0d0d]">上下文轮数</label>
                  <span class="text-xs text-[#999] tabular-nums">{{ contextRounds }} 轮</span>
                </div>
                <input
                  v-model.number="contextRounds"
                  type="range"
                  min="0"
                  max="50"
                  step="1"
                  class="w-full h-1.5 bg-[#e5e5e5] rounded-full appearance-none cursor-pointer accent-[#0d0d0d]"
                  @input="saveContextRounds"
                >
                <div class="flex justify-between mt-1">
                  <span class="text-[11px] text-[#bbb]">关闭</span>
                  <span class="text-[11px] text-[#bbb]">50</span>
                </div>
                <p class="text-[11px] text-[#999] mt-1">
                  每次发送时携带最近 {{ contextRounds }} 轮对话
                </p>
              </div>
            </section>
          </div>
        </div>
      </div>
    </Teleport>
  </footer>
</template>

<style scoped>
.settings-input {
  @apply w-full px-3 py-2 bg-[#f4f4f4] border border-[#e3e3e3] rounded-xl text-sm text-[#0d0d0d] outline-none transition-colors;
}
.settings-input:focus {
  @apply border-[#999];
}
/* Range slider thumb */
input[type="range"]::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #0d0d0d;
  cursor: pointer;
  border: 2px solid white;
  box-shadow: 0 1px 3px rgba(0,0,0,0.2);
}
input[type="range"]::-moz-range-thumb {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #0d0d0d;
  cursor: pointer;
  border: 2px solid white;
  box-shadow: 0 1px 3px rgba(0,0,0,0.2);
}
</style>
