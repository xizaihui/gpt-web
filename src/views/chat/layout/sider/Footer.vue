<script setup lang='ts'>
import { ref, watch } from 'vue'
import { useSettingStore, useChatStore } from '@/store'
import Icon from '@/components/common/Icon.vue'

const settingStore = useSettingStore()
const chatStore = useChatStore()
const showPanel = ref(false)

// Local state
const contextRounds = ref(settingStore.contextRounds)
const apiBaseUrl = ref(settingStore.apiBaseUrl)
const apiKey = ref(settingStore.apiKey)
const showApiKey = ref(false)
const clearing = ref(false)
const clearSuccess = ref(false)

const DEFAULT_URL = import.meta.env.VITE_DEFAULT_API_BASE_URL || ''

function openPanel() {
  contextRounds.value = settingStore.contextRounds
  apiBaseUrl.value = settingStore.apiBaseUrl || DEFAULT_URL
  apiKey.value = settingStore.apiKey || ''
  showApiKey.value = false
  clearSuccess.value = false
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

async function clearAllChats() {
  if (clearing.value) return
  clearing.value = true
  clearSuccess.value = false
  try {
    await chatStore.clearHistory()
    clearSuccess.value = true
    setTimeout(() => { clearSuccess.value = false }, 2000)
  } catch (e) {
    console.error('Failed to clear conversations:', e)
  } finally {
    clearing.value = false
  }
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

          <!-- Scrollable content -->
          <div class="overflow-y-auto flex-1 px-5 pb-5">
            <!-- API Config -->
            <section class="mb-4">
              <h3 class="section-title">API 配置</h3>
              <div class="mb-3">
                <label class="field-label">Base URL</label>
                <input v-model="apiBaseUrl" type="text" class="settings-input" placeholder="https://api.openai.com" @change="saveApiConfig">
                <p class="text-[11px] text-[#999] mt-1">/v1 可加可不加，系统会自动处理</p>
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

            <div class="border-t border-[#f0f0f0] my-4" />

            <!-- Context rounds -->
            <section class="mb-4">
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

            <div class="border-t border-[#f0f0f0] my-4" />

            <!-- Clear all chats -->
            <section>
              <h3 class="section-title">数据管理</h3>
              <button
                class="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-[13px] font-medium transition-all"
                :class="clearSuccess
                  ? 'bg-[#dcfce7] text-[#16a34a] border border-[#bbf7d0]'
                  : 'bg-[#fef2f2] text-[#dc2626] border border-[#fecaca] hover:bg-[#fee2e2]'"
                :disabled="clearing"
                @click="clearAllChats"
              >
                <template v-if="clearing">
                  <svg class="animate-spin" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
                  <span>清理中...</span>
                </template>
                <template v-else-if="clearSuccess">
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                  <span>已清理</span>
                </template>
                <template v-else>
                  <Icon name="trash-2" :size="14" :stroke-width="1.8" />
                  <span>清理所有聊天会话</span>
                </template>
              </button>
              <p class="text-[11px] text-[#999] mt-1.5 text-center">删除所有对话记录，此操作不可恢复</p>
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
