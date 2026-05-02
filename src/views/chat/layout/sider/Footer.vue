<script setup lang='ts'>
import { computed, onMounted, ref, watch } from 'vue'
import { useSettingStore, useChatStore } from '@/store'
import Icon from '@/components/common/Icon.vue'
import { fetchNewApiSession, type NewApiSessionInfo, type NewApiTokenInfo } from '@/api'

const settingStore = useSettingStore()
const chatStore = useChatStore()
const showPanel = ref(false)

const contextRounds = ref(settingStore.contextRounds)
const apiMode = ref<'newapi' | 'custom'>(settingStore.apiMode || 'newapi')
const apiBaseUrl = ref(settingStore.apiBaseUrl)
const apiKey = ref(settingStore.apiKey)
const selectedTokenId = ref<number | null>(settingStore.newApiTokenId)
const newApiSession = ref<NewApiSessionInfo | null>(null)
const newApiLoading = ref(false)
const newApiError = ref('')
const showApiKey = ref(false)
const clearing = ref(false)
const clearSuccess = ref(false)
const showConfirm = ref(false)

const DEFAULT_URL = import.meta.env.VITE_DEFAULT_API_BASE_URL || ''

const enabledTokens = computed(() => (newApiSession.value?.tokens || []).filter(token => token.status === 1))
const selectedToken = computed(() => enabledTokens.value.find(token => token.id === selectedTokenId.value) || null)
const hasCustomApiConfig = computed(() => !!(settingStore.apiKey && settingStore.apiBaseUrl))
const hasNewApiConfig = computed(() => settingStore.apiMode === 'newapi' && !!settingStore.newApiTokenId)
const hasApiConfig = computed(() => hasNewApiConfig.value || hasCustomApiConfig.value)

const statusText = computed(() => {
  if (hasNewApiConfig.value)
    return `New API - ${settingStore.newApiTokenName || '已选择令牌'}`
  if (hasCustomApiConfig.value)
    return '自定义 API 已配置'
  return '未配置'
})

function tokenQuotaText(token: NewApiTokenInfo) {
  if (token.unlimited_quota)
    return '无限额度'
  return `剩余额度 ${token.remain_quota ?? 0}`
}

function tokenStatusText(token: NewApiTokenInfo) {
  if (token.status === 1)
    return '启用'
  if (token.status === 2)
    return '已禁用'
  if (token.status === 3)
    return '已过期'
  if (token.status === 4)
    return '已耗尽'
  return '不可用'
}

function saveContextRounds() {
  const val = Math.max(0, Math.min(100, Math.round(contextRounds.value)))
  contextRounds.value = val
  settingStore.updateSetting({ contextRounds: val })
}

function saveCustomApiConfig() {
  settingStore.updateSetting({
    apiMode: 'custom',
    apiBaseUrl: apiBaseUrl.value,
    apiKey: apiKey.value,
  })
}

function selectApiMode(mode: 'newapi' | 'custom') {
  apiMode.value = mode
  if (mode === 'newapi') {
    const token = selectedToken.value || enabledTokens.value[0]
    selectedTokenId.value = token?.id ?? null
    settingStore.updateSetting({
      apiMode: 'newapi',
      apiBaseUrl: newApiSession.value?.base_url || apiBaseUrl.value,
      newApiTokenId: token?.id ?? null,
      newApiTokenName: token?.name ?? '',
    })
    return
  }
  settingStore.updateSetting({ apiMode: 'custom' })
}

function selectToken(token: NewApiTokenInfo) {
  if (token.status !== 1)
    return
  selectedTokenId.value = token.id
  settingStore.updateSetting({
    apiMode: 'newapi',
    apiBaseUrl: newApiSession.value?.base_url || apiBaseUrl.value,
    newApiTokenId: token.id,
    newApiTokenName: token.name,
  })
}

async function refreshNewApiSession(autoSelect = false) {
  newApiLoading.value = true
  newApiError.value = ''
  try {
    const session = await fetchNewApiSession()
    newApiSession.value = session
    apiBaseUrl.value = session.base_url || apiBaseUrl.value

    const current = enabledTokens.value.find(token => token.id === selectedTokenId.value)
    const token = current || enabledTokens.value[0]
    if ((autoSelect || apiMode.value === 'newapi') && token) {
      selectedTokenId.value = token.id
      settingStore.updateSetting({
        apiMode: 'newapi',
        apiBaseUrl: session.base_url,
        newApiTokenId: token.id,
        newApiTokenName: token.name,
      })
    }
  }
  catch (error: any) {
    newApiSession.value = null
    newApiError.value = error?.message || '无法读取 New API 登录状态'
  }
  finally {
    newApiLoading.value = false
  }
}

function openPanel() {
  contextRounds.value = settingStore.contextRounds
  apiMode.value = settingStore.apiMode || 'newapi'
  apiBaseUrl.value = settingStore.apiBaseUrl || DEFAULT_URL
  apiKey.value = settingStore.apiKey || ''
  selectedTokenId.value = settingStore.newApiTokenId
  showApiKey.value = false
  clearSuccess.value = false
  showPanel.value = true
  refreshNewApiSession(apiMode.value === 'newapi')
}

function closePanel() {
  showPanel.value = false
}

async function clearAllChats() {
  if (clearing.value) return
  clearing.value = true
  clearSuccess.value = false
  try {
    await chatStore.clearHistory()
    clearSuccess.value = true
    showConfirm.value = false
    setTimeout(() => { clearSuccess.value = false }, 2000)
  } catch (e) {
    console.error('Failed to clear conversations:', e)
  } finally {
    clearing.value = false
  }
}

watch(() => settingStore.newApiTokenId, value => {
  selectedTokenId.value = value
})

onMounted(() => {
  refreshNewApiSession(apiMode.value === 'newapi')
})
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

    <Teleport to="body">
      <div v-if="showPanel" class="fixed inset-0 z-[200]" @click.self="closePanel">
        <div class="fixed left-0 bottom-0 w-[420px] max-w-[92vw] max-h-[88vh] bg-white rounded-tr-2xl shadow-[0_-4px_32px_rgba(0,0,0,0.12)] border-t border-r border-[#e3e3e3] flex flex-col">
          <div class="flex items-center justify-between px-5 pt-5 pb-3 flex-shrink-0">
            <div>
              <div class="text-[15px] font-semibold text-[#0d0d0d]">连接设置</div>
              <div class="text-[12px] text-[#999] mt-0.5">选择本次聊天使用的 New API 令牌</div>
            </div>
            <button class="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-[#f4f4f4] text-[#999] hover:text-[#0d0d0d] transition-colors" @click="closePanel">
              <Icon name="x" :size="16" />
            </button>
          </div>

          <div class="overflow-y-auto flex-1 px-5 pb-5">
            <section class="mb-5">
              <div class="grid grid-cols-2 gap-1 rounded-xl bg-[#f4f4f4] p-1">
                <button
                  class="mode-tab"
                  :class="apiMode === 'newapi' ? 'mode-tab-active' : 'text-[#777]'"
                  @click="selectApiMode('newapi')"
                >New API 账号</button>
                <button
                  class="mode-tab"
                  :class="apiMode === 'custom' ? 'mode-tab-active' : 'text-[#777]'"
                  @click="selectApiMode('custom')"
                >自定义 API</button>
              </div>
            </section>

            <section v-if="apiMode === 'newapi'" class="mb-5">
              <div class="rounded-2xl border border-[#e8e8e8] bg-[#fbfbfb] p-4">
                <div class="flex items-start justify-between gap-3">
                  <div class="min-w-0">
                    <div class="text-[13px] font-medium text-[#0d0d0d]">
                      {{ newApiSession?.user?.display_name || newApiSession?.user?.username || 'New API 用户' }}
                    </div>
                    <div class="mt-1 truncate text-[12px] text-[#888]">
                      {{ newApiSession?.base_url || apiBaseUrl || '等待 New API 登录状态' }}
                    </div>
                  </div>
                  <button class="soft-btn" :disabled="newApiLoading" @click="refreshNewApiSession(true)">
                    {{ newApiLoading ? '同步中' : '同步' }}
                  </button>
                </div>

                <div v-if="newApiError" class="mt-3 rounded-xl border border-[#fed7aa] bg-[#fff7ed] px-3 py-2 text-[12px] text-[#c2410c]">
                  {{ newApiError }}
                </div>
              </div>

              <div class="mt-4 flex items-center justify-between">
                <h3 class="section-title mb-0">可用令牌</h3>
                <span class="text-[11px] text-[#999]">{{ enabledTokens.length }} 个启用</span>
              </div>

              <div v-if="enabledTokens.length" class="mt-2 space-y-2">
                <button
                  v-for="token in enabledTokens"
                  :key="token.id"
                  class="token-card"
                  :class="selectedTokenId === token.id ? 'token-card-active' : ''"
                  @click="selectToken(token)"
                >
                  <div class="flex items-center gap-3 min-w-0">
                    <div class="radio-dot" :class="selectedTokenId === token.id ? 'radio-dot-active' : ''" />
                    <div class="min-w-0 text-left">
                      <div class="truncate text-[13px] font-medium text-[#0d0d0d]">{{ token.name }}</div>
                      <div class="mt-0.5 truncate text-[11px] text-[#999]">{{ token.key }}</div>
                    </div>
                  </div>
                  <div class="ml-3 text-right flex-shrink-0">
                    <div class="text-[11px] font-medium text-[#16a34a]">{{ tokenStatusText(token) }}</div>
                    <div class="mt-0.5 text-[11px] text-[#999]">{{ tokenQuotaText(token) }}</div>
                  </div>
                </button>
              </div>

              <div v-else class="mt-2 rounded-2xl border border-dashed border-[#ddd] px-4 py-6 text-center">
                <div class="text-[13px] font-medium text-[#0d0d0d]">没有可用令牌</div>
                <div class="mt-1 text-[12px] text-[#999]">请在 New API 的 API 密钥页面创建或启用一个令牌。</div>
              </div>
            </section>

            <section v-else class="mb-5">
              <h3 class="section-title">自定义 API</h3>
              <div class="mb-3">
                <label class="field-label">Base URL</label>
                <input v-model="apiBaseUrl" type="text" class="settings-input" placeholder="https://api.openai.com" @change="saveCustomApiConfig">
                <p class="text-[11px] text-[#999] mt-1">/v1 可加可不加，系统会自动处理。</p>
              </div>
              <div>
                <label class="field-label">API Key</label>
                <div class="relative">
                  <input v-model="apiKey" :type="showApiKey ? 'text' : 'password'" class="settings-input pr-9" placeholder="sk-..." @change="saveCustomApiConfig">
                  <button class="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#999] hover:text-[#666] transition-colors" @click="showApiKey = !showApiKey">
                    <Icon :name="showApiKey ? 'eye-off' : 'eye'" :size="15" />
                  </button>
                </div>
              </div>
            </section>

            <div class="border-t border-[#f0f0f0] my-4" />

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

            <section>
              <h3 class="section-title">数据管理</h3>
              <button
                v-if="clearSuccess"
                class="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-[13px] font-medium bg-[#dcfce7] text-[#16a34a] border border-[#bbf7d0]"
              >
                <Icon name="check" :size="14" />
                <span>已清理</span>
              </button>
              <button
                v-else
                class="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-[13px] font-medium bg-[#fef2f2] text-[#dc2626] border border-[#fecaca] hover:bg-[#fee2e2] transition-all"
                @click="showConfirm = true"
              >
                <Icon name="trash" :size="14" :stroke-width="1.8" />
                <span>清理所有聊天会话</span>
              </button>
              <p class="text-[11px] text-[#999] mt-1.5 text-center">删除所有对话记录，此操作不可恢复。</p>
            </section>
          </div>
        </div>
      </div>

      <Transition name="fade">
        <div v-if="showConfirm" class="fixed inset-0 z-[300] flex items-center justify-center" @click.self="showConfirm = false">
          <div class="absolute inset-0 bg-black/40" />
          <div class="relative bg-white rounded-2xl shadow-2xl w-[340px] mx-4 overflow-hidden">
            <div class="flex justify-center pt-6 pb-2">
              <div class="w-12 h-12 rounded-full bg-[#fef2f2] flex items-center justify-center">
                <Icon name="trash" :size="22" class="text-[#dc2626]" :stroke-width="1.8" />
              </div>
            </div>
            <div class="px-6 pb-5 text-center">
              <h3 class="text-[16px] font-semibold text-[#0d0d0d] mb-1.5">确认清理所有会话？</h3>
              <p class="text-[13px] text-[#666] leading-relaxed">所有聊天记录将被永久删除，无法撤销。</p>
            </div>
            <div class="flex border-t border-[#f0f0f0]">
              <button
                class="flex-1 py-3 text-[14px] font-medium text-[#666] hover:bg-[#f9f9f9] transition-colors border-r border-[#f0f0f0]"
                @click="showConfirm = false"
              >取消</button>
              <button
                class="flex-1 py-3 text-[14px] font-medium text-[#dc2626] hover:bg-[#fef2f2] transition-colors flex items-center justify-center gap-1.5"
                :disabled="clearing"
                @click="clearAllChats"
              >
                <span>{{ clearing ? '清理中...' : '确认清理' }}</span>
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </footer>
</template>

<style scoped>
.settings-input { @apply w-full px-3 py-2 bg-[#f4f4f4] border border-[#e3e3e3] rounded-xl text-sm text-[#0d0d0d] outline-none transition-colors; }
.settings-input:focus { @apply border-[#999]; }
.section-title { @apply text-xs font-semibold text-[#999] uppercase tracking-wider mb-3; }
.field-label { @apply block text-[13px] font-medium text-[#0d0d0d] mb-1.5; }
.mode-tab { @apply h-9 rounded-lg text-[13px] font-medium transition-all; }
.mode-tab-active { @apply bg-white text-[#0d0d0d] shadow-sm; }
.soft-btn { @apply h-8 px-3 rounded-lg bg-white border border-[#e5e5e5] text-[12px] font-medium text-[#0d0d0d] transition-colors; }
.soft-btn:hover { background: #f4f4f4; }
.soft-btn:disabled { opacity: 0.6; }
.token-card { @apply w-full flex items-center justify-between gap-3 rounded-2xl border border-[#ececec] bg-white px-3 py-3 transition-all; }
.token-card:hover { background: #fbfbfb; border-color: #d8d8d8; }
.token-card-active { @apply border-[#0d0d0d] bg-[#fafafa]; }
.radio-dot { @apply w-4 h-4 rounded-full border border-[#cfcfcf] flex-shrink-0; }
.radio-dot-active { border: 5px solid #0d0d0d; }

.fade-enter-active, .fade-leave-active { transition: opacity 0.15s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }

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
