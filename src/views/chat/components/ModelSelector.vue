<script setup lang="ts">
import { computed, ref } from 'vue'
import { useSettingStore } from '@/store'

const settingStore = useSettingStore()

interface ModelItem {
  label: string
  value: string
  desc?: string
  descColor?: string
}

interface ProviderGroup {
  provider: string
  color: string
  models: ModelItem[]
}

interface Category {
  key: string
  label: string
  groups: ProviderGroup[]
}

const MODEL_GROUPS: Category[] = [
  {
    key: 'sub',
    label: '订阅',
    groups: [
      {
        provider: 'OpenAI',
        color: '#10a37f',
        models: [
          { label: 'GPT-5.4', value: 'codex:gpt-5.4', desc: '旗舰', descColor: '#10a37f' },
          { label: 'GPT-5.4 Mini', value: 'codex:gpt-5.4-mini', desc: '轻量', descColor: '#6b7280' },
        ],
      },
      {
        provider: 'Claude',
        color: '#d97706',
        models: [
          { label: 'Opus 4.6', value: 'claude-pool:claude-opus-4-6', desc: '旗舰', descColor: '#d97706' },
          { label: 'Sonnet 4.6', value: 'claude-pool:claude-sonnet-4-6', desc: '均衡', descColor: '#3b82f6' },
        ],
      },
      {
        provider: 'Gemini',
        color: '#4285f4',
        models: [
          { label: '3.1 Pro', value: 'gemini-sub:gemini-3.1-pro', desc: '旗舰', descColor: '#4285f4' },
          { label: '3.1 Fast', value: 'gemini-sub:gemini-3.1-fast', desc: '轻量', descColor: '#6b7280' },
        ],
      },
    ],
  },
  {
    key: 'api',
    label: 'API',
    groups: [
      {
        provider: 'OpenAI',
        color: '#10a37f',
        models: [
          { label: 'GPT-5.4', value: 'gpt-5.4', desc: '旗舰', descColor: '#10a37f' },
          { label: 'GPT-5.4 Mini', value: 'gpt-5.4-mini', desc: '轻量', descColor: '#6b7280' },
        ],
      },
      {
        provider: 'Claude',
        color: '#d97706',
        models: [
          { label: 'Opus 4.6', value: 'claude-opus-4-6', desc: '旗舰', descColor: '#d97706' },
          { label: 'Sonnet 4.6', value: 'claude-sonnet-4-6', desc: '均衡', descColor: '#3b82f6' },
        ],
      },
      {
        provider: 'Gemini',
        color: '#4285f4',
        models: [
          { label: '3.1 Pro', value: 'gemini-3.1-pro', desc: '旗舰', descColor: '#4285f4' },
          { label: '3.1 Fast', value: 'gemini-3.1-fast', desc: '轻量', descColor: '#6b7280' },
        ],
      },
    ],
  },
]

const ALL_MODELS = MODEL_GROUPS.flatMap(c => c.groups.flatMap(g => g.models))

interface Props { modelValue: string }
interface Emits { (e: 'update:modelValue', value: string): void }

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

const showModeDropdown = ref(false)
const showModelDropdown = ref(false)

const hasApiConfig = computed(() => {
  return !!(settingStore.apiBaseUrl?.trim() || settingStore.apiKey?.trim())
})

// Determine current category (sub/api) from selected model
const currentCategory = computed(() => {
  for (const cat of MODEL_GROUPS) {
    for (const g of cat.groups) {
      if (g.models.some(m => m.value === props.modelValue)) return cat.key
    }
  }
  return 'sub'
})

const currentCategoryLabel = computed(() => {
  const cat = MODEL_GROUPS.find(c => c.key === currentCategory.value)
  return cat ? cat.label : '订阅'
})

const selectedLabel = computed(() => {
  const m = ALL_MODELS.find(m => m.value === props.modelValue)
  return m ? m.label : 'GPT-5.4'
})

const selectedProvider = computed(() => {
  for (const cat of MODEL_GROUPS) {
    for (const g of cat.groups) {
      if (g.models.some(m => m.value === props.modelValue)) return g
    }
  }
  return MODEL_GROUPS[0].groups[0]
})

// Get models for current category
const currentModels = computed(() => {
  const cat = MODEL_GROUPS.find(c => c.key === currentCategory.value)
  return cat ? cat.groups : []
})

function toggleModeDropdown() {
  showModeDropdown.value = !showModeDropdown.value
  showModelDropdown.value = false
}

function toggleModelDropdown() {
  showModelDropdown.value = !showModelDropdown.value
  showModeDropdown.value = false
}

function selectMode(key: string) {
  if (key === 'api' && !hasApiConfig.value) {
    // Still switch but warn
  }
  // Find the equivalent model in the new category
  const newCat = MODEL_GROUPS.find(c => c.key === key)
  if (!newCat) return

  // Try to find same provider + same position model
  const currentProviderName = selectedProvider.value.provider
  const currentModelIndex = selectedProvider.value.models.findIndex(m => m.value === props.modelValue)

  for (const g of newCat.groups) {
    if (g.provider === currentProviderName && g.models[currentModelIndex]) {
      emit('update:modelValue', g.models[currentModelIndex].value)
      localStorage.setItem('selectedModel', g.models[currentModelIndex].value)
      showModeDropdown.value = false
      return
    }
  }
  // Fallback: first model in new category
  const first = newCat.groups[0]?.models[0]
  if (first) {
    emit('update:modelValue', first.value)
    localStorage.setItem('selectedModel', first.value)
  }
  showModeDropdown.value = false
}

function selectModel(value: string) {
  emit('update:modelValue', value)
  localStorage.setItem('selectedModel', value)
  showModelDropdown.value = false
}

function closeAll() {
  showModeDropdown.value = false
  showModelDropdown.value = false
}
</script>

<template>
  <!-- Click outside overlay -->
  <Teleport to="body">
    <div v-if="showModeDropdown || showModelDropdown" class="fixed inset-0 z-[55]" @click="closeAll" />
  </Teleport>

  <div class="flex items-center gap-1">
    <!-- Mode pill (订阅/API) -->
    <div class="relative">
      <button
        class="flex items-center gap-1 px-2.5 py-1 text-[13px] rounded-full transition-all font-medium"
        :class="showModeDropdown
          ? 'text-[#0d0d0d] bg-[#ececec]'
          : 'text-[#b4b4b4] hover:text-[#666] hover:bg-[#f4f4f4]'"
        @click="toggleModeDropdown"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
        <span>{{ currentCategoryLabel }}</span>
        <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      <!-- Mode dropdown (pops up) -->
      <div
        v-if="showModeDropdown"
        class="absolute bottom-full left-0 mb-2 w-[120px] bg-white rounded-xl shadow-[0_4px_24px_rgba(0,0,0,0.12)] border border-[#e8e8e8] py-1 z-[60]"
      >
        <button
          v-for="cat in MODEL_GROUPS"
          :key="cat.key"
          class="flex items-center justify-between w-full px-3 py-2 text-[13px] hover:bg-[#f4f4f4] transition-colors"
          :class="currentCategory === cat.key ? 'text-[#0d0d0d] font-medium' : 'text-[#666]'"
          @click="selectMode(cat.key)"
        >
          <span>{{ cat.label }}</span>
          <svg v-if="currentCategory === cat.key" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </button>
      </div>
    </div>

    <!-- Model pill -->
    <div class="relative">
      <button
        class="flex items-center gap-1 px-2.5 py-1 text-[13px] rounded-full transition-all font-medium"
        :class="showModelDropdown
          ? 'text-[#0d0d0d] bg-[#ececec]'
          : 'text-[#b4b4b4] hover:text-[#666] hover:bg-[#f4f4f4]'"
        @click="toggleModelDropdown"
      >
        <span class="w-[6px] h-[6px] rounded-full flex-shrink-0" :style="{ backgroundColor: selectedProvider.color }" />
        <span>{{ selectedLabel }}</span>
        <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      <!-- Model dropdown (pops up) -->
      <div
        v-if="showModelDropdown"
        class="absolute bottom-full left-0 mb-2 w-[240px] bg-white rounded-xl shadow-[0_4px_24px_rgba(0,0,0,0.12)] border border-[#e8e8e8] py-1.5 z-[60]"
      >
        <!-- API warning -->
        <div v-if="currentCategory === 'api' && !hasApiConfig" class="mx-2 mb-1.5 px-2.5 py-1.5 rounded-lg bg-amber-50 border border-amber-200">
          <div class="text-[11px] text-amber-700 font-semibold">⚠️ 未配置 API</div>
          <div class="text-[10px] text-amber-600 mt-0.5">请先在设置中填写 Base URL 和 API Key</div>
        </div>

        <div v-for="(group, gi) in currentModels" :key="group.provider" :class="gi > 0 ? 'mt-1.5' : ''">
          <!-- Provider label -->
          <div class="flex items-center gap-1.5 px-3 pb-1" :class="gi > 0 ? 'pt-1.5 border-t border-[#f0f0f0]' : ''">
            <span class="w-[5px] h-[5px] rounded-full" :style="{ backgroundColor: group.color }" />
            <span class="text-[10px] font-semibold tracking-wide uppercase" :style="{ color: group.color }">{{ group.provider }}</span>
          </div>
          <!-- Model items -->
          <button
            v-for="model in group.models"
            :key="model.value"
            class="flex items-center justify-between w-full px-3 py-1.5 text-[13px] hover:bg-[#f4f4f4] transition-colors"
            :class="props.modelValue === model.value ? 'text-[#0d0d0d] font-medium' : 'text-[#555]'"
            @click="selectModel(model.value)"
          >
            <div class="flex items-center gap-2">
              <span>{{ model.label }}</span>
              <span
                v-if="model.desc"
                class="text-[10px] px-1.5 py-0.5 rounded-md font-medium"
                :style="`background:${model.descColor}15; color:${model.descColor}`"
              >{{ model.desc }}</span>
            </div>
            <svg v-if="props.modelValue === model.value" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
