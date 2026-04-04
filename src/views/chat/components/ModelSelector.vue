<script setup lang="ts">
import { computed, ref } from 'vue'
import { useSettingStore } from '@/store'

const settingStore = useSettingStore()

interface ModelItem {
  label: string
  value: string
  desc?: string
  descColor?: string // custom color for desc tag
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

const showDropdown = ref(false)
const activeTab = ref('sub')
const showApiWarning = ref(false)

const hasApiConfig = computed(() => {
  return !!(settingStore.apiBaseUrl?.trim() || settingStore.apiKey?.trim())
})

const currentTab = computed(() => {
  for (const cat of MODEL_GROUPS) {
    for (const g of cat.groups) {
      if (g.models.some(m => m.value === props.modelValue)) return cat.key
    }
  }
  return 'sub'
})

function openDropdown() {
  activeTab.value = currentTab.value
  showApiWarning.value = false
  showDropdown.value = !showDropdown.value
}

function switchTab(key: string) {
  showApiWarning.value = key === 'api' && !hasApiConfig.value
  activeTab.value = key
}

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

function selectModel(value: string) {
  emit('update:modelValue', value)
  localStorage.setItem('selectedModel', value)
  showDropdown.value = false
}

function isSelected(value: string) {
  return props.modelValue === value
}
</script>

<template>
  <div class="relative">
    <!-- Trigger button -->
    <button
      class="flex items-center gap-1.5 hover:bg-[#f4f4f4] rounded-lg px-2.5 py-1 transition-colors"
      @click="openDropdown"
    >
      <span class="w-2 h-2 rounded-full flex-shrink-0" :style="{ backgroundColor: selectedProvider.color }" />
      <span class="text-[14px] font-medium text-[#0d0d0d]">{{ selectedLabel }}</span>
      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#999" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="transition-transform" :class="showDropdown ? 'rotate-180' : ''">
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </button>

    <!-- Dropdown panel -->
    <div
      v-show="showDropdown"
      class="absolute left-0 top-full z-50 mt-1.5 w-[300px] bg-white rounded-2xl shadow-[0_8px_32px_rgba(0,0,0,0.12)] border border-[#ebebeb] overflow-hidden"
    >
      <!-- Tab bar -->
      <div class="flex border-b border-[#f0f0f0] bg-[#fafafa]">
        <button
          v-for="cat in MODEL_GROUPS"
          :key="cat.key"
          class="flex-1 py-2.5 text-[13px] font-medium transition-colors relative"
          :class="activeTab === cat.key ? 'text-[#0d0d0d]' : 'text-[#bbb] hover:text-[#888]'"
          @click="switchTab(cat.key)"
        >
          {{ cat.label }}
          <div
            v-if="activeTab === cat.key"
            class="absolute bottom-0 left-1/2 -translate-x-1/2 w-6 h-[2px] bg-[#0d0d0d] rounded-full"
          />
        </button>
      </div>

      <!-- API config warning -->
      <div v-if="showApiWarning && activeTab === 'api'" class="mx-3 mt-2.5 px-3 py-2 rounded-xl bg-amber-50 border border-amber-200">
        <div class="text-[12px] text-amber-700 font-semibold">⚠️ 未配置 API</div>
        <div class="text-[11px] text-amber-600 mt-0.5">请先在设置中填写 Base URL 和 API Key</div>
      </div>

      <!-- Model list -->
      <div class="p-2">
        <template v-for="cat in MODEL_GROUPS" :key="cat.key">
          <div v-show="activeTab === cat.key" class="space-y-0.5">
            <div v-for="(group, gi) in cat.groups" :key="group.provider" :class="gi > 0 ? 'mt-2' : 'mt-1'">
              <!-- Provider label -->
              <div class="flex items-center gap-1.5 px-2 pb-1.5">
                <span class="w-[6px] h-[6px] rounded-full flex-shrink-0" :style="{ backgroundColor: group.color }" />
                <span class="text-[11px] font-semibold tracking-wide uppercase" :style="{ color: group.color }">{{ group.provider }}</span>
              </div>
              <!-- Model buttons -->
              <div class="grid grid-cols-2 gap-1.5 px-1">
                <button
                  v-for="model in group.models"
                  :key="model.value"
                  class="relative flex flex-col items-start px-3 py-2.5 rounded-xl text-left transition-all"
                  :class="isSelected(model.value)
                    ? 'bg-[#0d0d0d] text-white shadow-sm'
                    : 'bg-[#f5f5f5] hover:bg-[#ececec] text-[#1a1a1a]'"
                  @click="selectModel(model.value)"
                >
                  <!-- Model name -->
                  <span class="text-[13px] font-semibold leading-snug tracking-tight">{{ model.label }}</span>
                  <!-- Desc tag -->
                  <span
                    v-if="model.desc"
                    class="mt-1 text-[11px] font-medium leading-none px-1.5 py-0.5 rounded-md"
                    :style="isSelected(model.value)
                      ? 'background:rgba(255,255,255,0.15); color:rgba(255,255,255,0.85)'
                      : `background:${model.descColor}18; color:${model.descColor}`"
                  >{{ model.desc }}</span>
                </button>
              </div>
            </div>
          </div>
        </template>
      </div>

      <!-- Bottom padding -->
      <div class="h-1.5" />
    </div>

    <!-- Click outside to close -->
    <Teleport to="body">
      <div v-if="showDropdown" class="fixed inset-0 z-40" @click="showDropdown = false" />
    </Teleport>
  </div>
</template>
