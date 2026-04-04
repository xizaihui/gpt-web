<script setup lang="ts">
import { ref } from 'vue'
import { useSettingStore } from '@/store'

const settingStore = useSettingStore()

interface Props {
  modelValue: boolean
}

interface Emits {
  (e: 'update:modelValue', value: boolean): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

const DEFAULT_URL = import.meta.env.VITE_DEFAULT_API_BASE_URL || ''
const configBaseUrl = ref(settingStore.apiBaseUrl || DEFAULT_URL)
const configApiKey = ref(settingStore.apiKey || '')
const showApiKey = ref(false)

// Sync values when modal opens
function onOpen() {
  configBaseUrl.value = settingStore.apiBaseUrl || DEFAULT_URL
  configApiKey.value = settingStore.apiKey || ''
  showApiKey.value = false
}

// Watch for open
import { watch } from 'vue'
watch(() => props.modelValue, (v) => { if (v) onOpen() })

function save() {
  settingStore.updateSetting({
    apiBaseUrl: configBaseUrl.value,
    apiKey: configApiKey.value,
  })
  emit('update:modelValue', false)
}

function close() {
  emit('update:modelValue', false)
}
</script>

<template>
  <div v-if="modelValue" class="fixed inset-0 z-50 flex items-center justify-center">
    <div class="absolute inset-0 bg-black/40" @click="close" />
    <div class="relative bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6">
      <h2 class="text-lg font-semibold text-[#0d0d0d] mb-5">API 配置</h2>

      <div class="mb-4">
        <label class="block text-sm font-medium text-[#0d0d0d] mb-1.5">Base URL</label>
        <input
          v-model="configBaseUrl"
          type="text"
          class="w-full px-3 py-2.5 bg-[#f4f4f4] border border-[#e3e3e3] rounded-xl text-sm text-[#0d0d0d] outline-none focus:border-[#999] transition-colors"
          placeholder="https://api.openai.com"
        >
        <p class="text-[11px] text-[#999] mt-1">/v1 可加可不加，系统会自动处理</p>
      </div>

      <div class="mb-6">
        <label class="block text-sm font-medium text-[#0d0d0d] mb-1.5">API Key</label>
        <div class="relative">
          <input
            v-model="configApiKey"
            :type="showApiKey ? 'text' : 'password'"
            class="w-full px-3 py-2.5 pr-10 bg-[#f4f4f4] border border-[#e3e3e3] rounded-xl text-sm text-[#0d0d0d] outline-none focus:border-[#999] transition-colors"
            placeholder="sk-..."
          >
          <button
            class="absolute right-3 top-1/2 -translate-y-1/2 text-[#999] hover:text-[#666] transition-colors"
            @click="showApiKey = !showApiKey"
          >
            <svg v-if="!showApiKey" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
            <svg v-else xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
              <line x1="1" y1="1" x2="23" y2="23" />
            </svg>
          </button>
        </div>
      </div>

      <div class="flex flex-col gap-2">
        <button
          class="w-full py-2.5 bg-[#0d0d0d] text-white text-sm font-medium rounded-xl hover:bg-black transition-colors"
          @click="save"
        >
          保存
        </button>
        <button
          class="w-full py-2 text-sm text-[#666] hover:text-[#0d0d0d] transition-colors"
          @click="close"
        >
          取消
        </button>
      </div>
    </div>
  </div>
</template>
