<script setup lang='ts'>
import { ref, watch, onMounted } from 'vue'
import { useSettingStore } from '@/store'
import Icon from '@/components/common/Icon.vue'
import { fetchCodexTokens, syncCodexTokens, deleteCodexToken } from '@/api'

const settingStore = useSettingStore()
const showPanel = ref(false)

// Local state
const contextRounds = ref(settingStore.contextRounds)
const apiBaseUrl = ref(settingStore.apiBaseUrl)
const apiKey = ref(settingStore.apiKey)
const showApiKey = ref(false)

const DEFAULT_URL = import.meta.env.VITE_DEFAULT_API_BASE_URL || ''

// Codex tokens
const codexTokens = ref<Array<{ email: string; active: boolean; expiresAt: string; expiresIn: string }>>([])
const codexLoading = ref(false)
const activeTab = ref<'api' | 'codex'>('api')

function openPanel() {
  contextRounds.value = settingStore.contextRounds
  apiBaseUrl.value = settingStore.apiBaseUrl || DEFAULT_URL
  apiKey.value = settingStore.apiKey || ''
  showApiKey.value = false
  showPanel.value = true
  loadCodexTokens()
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

// Codex token management
async function loadCodexTokens() {
  try {
    codexLoading.value = true
    codexTokens.value = await fetchCodexTokens()
  }
  catch { codexTokens.value = [] }
  finally { codexLoading.value = false }
}

async function handleSyncCodex() {
  try {
    codexLoading.value = true
    await syncCodexTokens()
    await loadCodexTokens()
  }
  catch {}
  finally { codexLoading.value = false }
}

async function handleRemoveToken(email: string) {
  try {
    await deleteCodexToken(email)
    await loadCodexTokens()
  }
  catch {}
}

// Status
const hasApiConfig = ref(false)
const hasCodexToken = ref(false)
watch([() => settingStore.apiKey, () => settingStore.apiBaseUrl], () => {
  hasApiConfig.value = !!(settingStore.apiKey && settingStore.apiBaseUrl)
}, { immediate: true })
watch(codexTokens, (tokens) => {
  hasCodexToken.value = tokens.some(t => t.active)
}, { immediate: true })

const statusText = ref('')
watch([hasApiConfig, hasCodexToken], () => {
  if (hasApiConfig.value && hasCodexToken.value) statusText.value = 'API + 订阅'
  else if (hasApiConfig.value) statusText.value = 'API 已配置'
  else if (hasCodexToken.value) statusText.value = '订阅已授权'
  else statusText.value = '未配置'
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
          :class="(hasApiConfig || hasCodexToken) ? 'bg-[#19c37d]' : 'bg-[#f59e0b]'"
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
            <button
              class="tab-btn"
              :class="activeTab === 'api' ? 'tab-active' : 'tab-inactive'"
              @click="activeTab = 'api'"
            >
              API 模式
            </button>
            <button
              class="tab-btn"
              :class="activeTab === 'codex' ? 'tab-active' : 'tab-inactive'"
              @click="activeTab = 'codex'"
            >
              订阅模式
              <span v-if="hasCodexToken" class="w-1.5 h-1.5 rounded-full bg-[#19c37d] ml-1" />
            </button>
          </div>

          <!-- Scrollable content -->
          <div class="overflow-y-auto flex-1 px-5 pb-5">
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
                <div class="flex items-center justify-between mb-3">
                  <h3 class="section-title mb-0">ChatGPT 订阅</h3>
                  <button class="text-xs text-[#0066ff] hover:text-[#0044cc] font-medium transition-colors" @click="handleSyncCodex">
                    {{ codexLoading ? '同步中...' : '从 OpenClaw 同步' }}
                  </button>
                </div>

                <p class="text-[11px] text-[#999] mb-3 leading-relaxed">
                  使用 ChatGPT Plus/Pro 订阅额度，无需 API Key。选择模型 "GPT-5.4 (订阅)" 即可使用。
                </p>

                <!-- Token list -->
                <div v-if="codexTokens.length > 0" class="space-y-2">
                  <div
                    v-for="token in codexTokens"
                    :key="token.email"
                    class="flex items-center gap-2 p-2.5 bg-[#f9f9f9] rounded-xl border border-[#e8e8e8]"
                  >
                    <div class="w-2 h-2 rounded-full flex-shrink-0" :class="token.active ? 'bg-[#19c37d]' : 'bg-[#e5484d]'" />
                    <div class="flex-1 min-w-0">
                      <div class="text-[13px] text-[#0d0d0d] truncate font-medium">{{ token.email }}</div>
                      <div class="text-[11px] text-[#999]">
                        {{ token.active ? `剩余 ${token.expiresIn}` : '已过期' }}
                      </div>
                    </div>
                    <button
                      class="w-6 h-6 flex items-center justify-center rounded-md hover:bg-[#fee2e2] text-[#999] hover:text-[#e5484d] transition-colors flex-shrink-0"
                      title="移除"
                      @click="handleRemoveToken(token.email)"
                    >
                      <Icon name="x" :size="12" />
                    </button>
                  </div>
                </div>

                <div v-else class="text-center py-6">
                  <div class="text-[#ccc] mb-2">
                    <Icon name="circle" :size="32" class="mx-auto" />
                  </div>
                  <p class="text-xs text-[#999]">暂无已授权的账号</p>
                  <p class="text-[11px] text-[#bbb] mt-1">点击"从 OpenClaw 同步"导入已有授权</p>
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
.settings-input {
  @apply w-full px-3 py-2 bg-[#f4f4f4] border border-[#e3e3e3] rounded-xl text-sm text-[#0d0d0d] outline-none transition-colors;
}
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
