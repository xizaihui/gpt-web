<script setup lang="ts">
import { computed, ref } from 'vue'
import { useSettingStore } from '@/store'

const settingStore = useSettingStore()

interface ModelItem {
  label: string
  value: string
}

interface Category {
  key: string
  label: string
  badge?: string
  badgeColor?: string
  desc: string
  models: ModelItem[]
}

const CATEGORIES: Category[] = [
  {
    key: 'sub',
    label: '订阅',
    badge: 'PLUS',
    badgeColor: '#9333ea',
    desc: '体验官方 Plus 会员功能',
    models: [
      { label: 'GPT-5.4', value: 'codex:gpt-5.4' },
      { label: 'GPT-5.4 Mini', value: 'codex:gpt-5.4-mini' },
      { label: 'Claude Opus 4.6', value: 'claude-pool:claude-opus-4-6' },
      { label: 'Claude Sonnet 4.6', value: 'claude-pool:claude-sonnet-4-6' },
    ],
  },
  {
    key: 'api',
    label: 'API',
    desc: '接入 API，使用自己的 Key 配额',
    models: [
      { label: 'GPT-5.4', value: 'gpt-5.4' },
      { label: 'GPT-5.4 Mini', value: 'gpt-5.4-mini' },
      { label: 'Claude Opus 4.6', value: 'claude-opus-4-6' },
      { label: 'Claude Sonnet 4.6', value: 'claude-sonnet-4-6' },
    ],
  },
]

const ALL_MODELS = CATEGORIES.flatMap(c => c.models)

interface Props { modelValue: string }
interface Emits { (e: 'update:modelValue', value: string): void }

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

const showModeDropdown = ref(false)
const showModelDropdown = ref(false)

// Determine current category from selected model
const currentCategory = computed(() => {
  for (const cat of CATEGORIES) {
    if (cat.models.some(m => m.value === props.modelValue)) return cat.key
  }
  return 'sub'
})

const currentCategoryObj = computed(() => {
  return CATEGORIES.find(c => c.key === currentCategory.value) || CATEGORIES[0]
})

const selectedLabel = computed(() => {
  const m = ALL_MODELS.find(m => m.value === props.modelValue)
  return m ? m.label : 'GPT-5.4'
})

// Models for current category
const currentModels = computed(() => {
  return currentCategoryObj.value.models
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
  const newCat = CATEGORIES.find(c => c.key === key)
  if (!newCat) return

  // Find equivalent model in new category by index
  const oldCat = currentCategoryObj.value
  const currentIndex = oldCat.models.findIndex(m => m.value === props.modelValue)
  const idx = currentIndex >= 0 && currentIndex < newCat.models.length ? currentIndex : 0
  const newModel = newCat.models[idx]

  emit('update:modelValue', newModel.value)
  localStorage.setItem('selectedModel', newModel.value)
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
        <span>{{ currentCategoryObj.label }}</span>
        <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      <!-- Mode dropdown -->
      <div
        v-if="showModeDropdown"
        class="absolute bottom-full left-0 mb-2 w-[220px] bg-white rounded-2xl shadow-[0_4px_24px_rgba(0,0,0,0.12)] border border-[#e8e8e8] p-1.5 z-[60]"
      >
        <button
          v-for="cat in CATEGORIES"
          :key="cat.key"
          class="flex items-start gap-3 w-full px-3 py-2.5 rounded-xl text-left transition-all"
          :class="currentCategory === cat.key
            ? 'bg-[#f4f4f4]'
            : 'hover:bg-[#f9f9f9]'"
          @click="selectMode(cat.key)"
        >
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-1.5">
              <span class="text-[14px] font-medium text-[#0d0d0d]">{{ cat.label }}</span>
              <span
                v-if="cat.badge"
                class="text-[10px] font-bold px-1.5 py-0.5 rounded-md text-white leading-none"
                :style="{ backgroundColor: cat.badgeColor }"
              >{{ cat.badge }}</span>
            </div>
            <div class="text-[12px] text-[#999] mt-0.5">{{ cat.desc }}</div>
          </div>
          <!-- Checkmark -->
          <svg v-if="currentCategory === cat.key" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#0d0d0d" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="mt-0.5 flex-shrink-0">
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
        <span>{{ selectedLabel }}</span>
        <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      <!-- Model dropdown -->
      <div
        v-if="showModelDropdown"
        class="absolute bottom-full left-0 mb-2 w-[200px] bg-white rounded-2xl shadow-[0_4px_24px_rgba(0,0,0,0.12)] border border-[#e8e8e8] p-1.5 z-[60]"
      >
        <button
          v-for="model in currentModels"
          :key="model.value"
          class="flex items-center justify-between w-full px-3 py-2 rounded-xl text-[13px] transition-all"
          :class="props.modelValue === model.value
            ? 'bg-[#f4f4f4] text-[#0d0d0d] font-medium'
            : 'text-[#555] hover:bg-[#f9f9f9]'"
          @click="selectModel(model.value)"
        >
          <span>{{ model.label }}</span>
          <svg v-if="props.modelValue === model.value" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#0d0d0d" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </button>
      </div>
    </div>
  </div>
</template>
