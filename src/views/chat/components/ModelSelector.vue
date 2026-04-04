<script setup lang="ts">
import { computed, ref } from 'vue'

interface ModelItem {
  label: string
  value: string
  desc?: string
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
          { label: 'GPT-5.4', value: 'codex:gpt-5.4', desc: '旗舰' },
          { label: 'GPT-5.4 Mini', value: 'codex:gpt-5.4-mini', desc: '轻量' },
        ],
      },
      {
        provider: 'Claude',
        color: '#d97706',
        models: [
          { label: 'Sonnet 4.6', value: 'claude-pool:claude-sonnet-4-6', desc: '均衡' },
          { label: 'Opus 4.6', value: 'claude-pool:claude-opus-4-6', desc: '旗舰' },
        ],
      },
      {
        provider: 'Gemini',
        color: '#4285f4',
        models: [
          { label: '3.1 Pro', value: 'gemini-sub:gemini-3.1-pro', desc: '旗舰' },
          { label: '3.1 Fast', value: 'gemini-sub:gemini-3.1-fast', desc: '轻量' },
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
          { label: 'GPT-5.4', value: 'gpt-5.4', desc: '旗舰' },
          { label: 'GPT-5.4 Mini', value: 'gpt-5.4-mini', desc: '轻量' },
        ],
      },
      {
        provider: 'Claude',
        color: '#d97706',
        models: [
          { label: 'Sonnet 4.6', value: 'claude-sonnet-4-6', desc: '均衡' },
          { label: 'Opus 4.6', value: 'claude-opus-4-6', desc: '旗舰' },
        ],
      },
      {
        provider: 'Gemini',
        color: '#4285f4',
        models: [
          { label: '3.1 Pro', value: 'gemini-3.1-pro', desc: '旗舰' },
          { label: '3.1 Fast', value: 'gemini-3.1-fast', desc: '轻量' },
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

// Auto-detect which tab the current model belongs to
const currentTab = computed(() => {
  for (const cat of MODEL_GROUPS) {
    for (const g of cat.groups) {
      if (g.models.some(m => m.value === props.modelValue)) return cat.key
    }
  }
  return 'sub'
})

// Set active tab to match current model on open
function openDropdown() {
  activeTab.value = currentTab.value
  showDropdown.value = !showDropdown.value
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
      <span
        class="w-2 h-2 rounded-full flex-shrink-0"
        :style="{ backgroundColor: selectedProvider.color }"
      />
      <span class="text-[14px] font-medium text-[#0d0d0d]">{{ selectedLabel }}</span>
      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#999" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="transition-transform" :class="showDropdown ? 'rotate-180' : ''">
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </button>

    <!-- Dropdown panel -->
    <div
      v-show="showDropdown"
      class="absolute left-0 top-full z-50 mt-1.5 w-[280px] bg-white rounded-xl shadow-[0_4px_24px_rgba(0,0,0,0.12)] border border-[#e5e5e5] overflow-hidden"
    >
      <!-- Tab bar -->
      <div class="flex border-b border-[#f0f0f0] bg-[#fafafa]">
        <button
          v-for="cat in MODEL_GROUPS"
          :key="cat.key"
          class="flex-1 py-2 text-[12px] font-medium transition-colors relative"
          :class="activeTab === cat.key ? 'text-[#0d0d0d]' : 'text-[#999] hover:text-[#666]'"
          @click="activeTab = cat.key"
        >
          {{ cat.label }}
          <div
            v-if="activeTab === cat.key"
            class="absolute bottom-0 left-1/2 -translate-x-1/2 w-8 h-[2px] bg-[#0d0d0d] rounded-full"
          />
        </button>
      </div>

      <!-- Model list -->
      <div class="p-1.5">
        <template v-for="cat in MODEL_GROUPS" :key="cat.key">
          <div v-show="activeTab === cat.key">
            <div v-for="(group, gi) in cat.groups" :key="group.provider" :class="gi > 0 ? 'mt-1' : ''">
              <!-- Provider label -->
              <div class="flex items-center gap-1.5 px-2 pt-1.5 pb-1">
                <span class="w-1.5 h-1.5 rounded-full" :style="{ backgroundColor: group.color }" />
                <span class="text-[11px] font-medium text-[#aaa]">{{ group.provider }}</span>
              </div>
              <!-- Model buttons in row -->
              <div class="flex gap-1 px-1.5">
                <button
                  v-for="model in group.models"
                  :key="model.value"
                  class="flex-1 py-1.5 px-2 rounded-lg text-left transition-all"
                  :class="isSelected(model.value)
                    ? 'bg-[#0d0d0d] text-white'
                    : 'bg-[#f5f5f5] hover:bg-[#ebebeb] text-[#333]'"
                  @click="selectModel(model.value)"
                >
                  <div class="text-[12px] font-medium leading-tight">{{ model.label }}</div>
                  <div
                    v-if="model.desc"
                    class="text-[10px] mt-0.5 leading-tight"
                    :class="isSelected(model.value) ? 'text-white/60' : 'text-[#999]'"
                  >{{ model.desc }}</div>
                </button>
              </div>
            </div>
          </div>
        </template>
      </div>
    </div>

    <!-- Click outside to close -->
    <Teleport to="body">
      <div v-if="showDropdown" class="fixed inset-0 z-40" @click="showDropdown = false" />
    </Teleport>
  </div>
</template>
