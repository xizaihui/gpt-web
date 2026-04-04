<script setup lang="ts">
import { computed, ref } from 'vue'

// Model data — organized by subscription vs API
const MODEL_GROUPS = [
  {
    category: '订阅',
    groups: [
      {
        provider: 'ChatGPT Plus',
        icon: '💎',
        models: [
          { label: 'GPT-5.4', value: 'codex:gpt-5.4' },
          { label: 'GPT-5.4 Mini', value: 'codex:gpt-5.4-mini' },
        ],
      },
      {
        provider: 'Claude Pro',
        icon: '🟣',
        models: [
          { label: 'Claude Sonnet 4.6', value: 'claude-pool:claude-sonnet-4-6' },
          { label: 'Claude Opus 4.6', value: 'claude-pool:claude-opus-4-6' },
        ],
      },
      {
        provider: 'Gemini Advanced',
        icon: '🔵',
        models: [
          { label: 'Gemini 3.1 Pro', value: 'gemini-sub:gemini-3.1-pro' },
          { label: 'Gemini 3.1 Fast', value: 'gemini-sub:gemini-3.1-fast' },
        ],
      },
    ],
  },
  {
    category: 'API',
    groups: [
      {
        provider: 'OpenAI',
        icon: '🟢',
        models: [
          { label: 'GPT-5.4', value: 'gpt-5.4' },
          { label: 'GPT-5.4 Mini', value: 'gpt-5.4-mini' },
        ],
      },
      {
        provider: 'Anthropic',
        icon: '🟠',
        models: [
          { label: 'Claude Sonnet 4.6', value: 'claude-sonnet-4-6' },
          { label: 'Claude Opus 4.6', value: 'claude-opus-4-6' },
        ],
      },
      {
        provider: 'Google',
        icon: '🔷',
        models: [
          { label: 'Gemini 3.1 Pro', value: 'gemini-3.1-pro' },
          { label: 'Gemini 3.1 Fast', value: 'gemini-3.1-fast' },
        ],
      },
    ],
  },
]

const ALL_MODELS = MODEL_GROUPS.flatMap(c => c.groups.flatMap(g => g.models))

interface Props {
  modelValue: string
}

interface Emits {
  (e: 'update:modelValue', value: string): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

const showDropdown = ref(false)

const selectedLabel = computed(() => {
  const m = ALL_MODELS.find(m => m.value === props.modelValue)
  return m ? m.label : 'ChatGPT'
})

const selectedIcon = computed(() => {
  for (const cat of MODEL_GROUPS) {
    for (const g of cat.groups) {
      if (g.models.some(m => m.value === props.modelValue))
        return g.icon
    }
  }
  return '🤖'
})

function selectModel(value: string) {
  emit('update:modelValue', value)
  localStorage.setItem('selectedModel', value)
  showDropdown.value = false
}
</script>

<template>
  <div class="relative">
    <button
      class="flex items-center gap-1.5 text-lg font-semibold text-[#0d0d0d] hover:bg-[#f4f4f4] rounded-xl px-3 py-1.5 transition-colors"
      @click="showDropdown = !showDropdown"
    >
      <span class="text-base">{{ selectedIcon }}</span>
      <span>{{ selectedLabel }}</span>
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="transition-transform" :class="showDropdown ? 'rotate-180' : ''">
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </button>

    <!-- Dropdown -->
    <div
      v-show="showDropdown"
      class="absolute left-0 top-full z-50 mt-1 w-[320px] bg-white rounded-2xl shadow-[0_0_36px_rgba(0,0,0,0.1)] border border-[#e3e3e3]/50 py-2 overflow-hidden max-h-[70vh] overflow-y-auto"
    >
      <div v-for="(cat, ci) in MODEL_GROUPS" :key="cat.category">
        <!-- Category header -->
        <div v-if="ci > 0" class="border-t border-[#e8e8e8] my-1.5" />
        <div class="px-3 pt-2 pb-1 text-[10px] font-bold text-[#b0b0b0] uppercase tracking-widest">
          {{ cat.category }}
        </div>

        <div v-for="(group, gi) in cat.groups" :key="group.provider">
          <div v-if="gi > 0" class="border-t border-[#f0f0f0] my-0.5 mx-3" />
          <div class="px-3 pt-1.5 pb-0.5 text-[11px] font-semibold text-[#999] flex items-center gap-1">
            <span>{{ group.icon }}</span>
            <span>{{ group.provider }}</span>
          </div>
          <button
            v-for="model in group.models"
            :key="model.value"
            class="flex items-center w-full px-3 py-2 text-sm text-left hover:bg-[#f4f4f4] rounded-xl transition-colors text-[#0d0d0d]"
            @click="selectModel(model.value)"
          >
            <span class="flex-1">{{ model.label }}</span>
            <svg
              v-if="modelValue === model.value"
              xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="text-[#0d0d0d]"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </button>
        </div>
      </div>
    </div>

    <!-- Click outside to close -->
    <Teleport to="body">
      <div v-if="showDropdown" class="fixed inset-0 z-40" @click="showDropdown = false" />
    </Teleport>
  </div>
</template>
