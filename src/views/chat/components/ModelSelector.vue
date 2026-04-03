<script setup lang="ts">
import { computed, ref } from 'vue'

// Model data — single source of truth
const MODEL_GROUPS = [
  {
    provider: 'ChatGPT Plus',
    models: [
      { label: 'GPT-5.4 (订阅)', value: 'codex:gpt-5.4' },
    ],
  },
  {
    provider: 'OpenAI',
    models: [
      { label: 'GPT-4o', value: 'gpt-4o' },
      { label: 'GPT-4o Mini', value: 'gpt-4o-mini' },
    ],
  },
  {
    provider: 'Anthropic',
    models: [
      { label: 'Claude Opus 4.6', value: 'claude-opus-4-6' },
      { label: 'Claude Sonnet 4.6', value: 'claude-sonnet-4-6' },
    ],
  },
  {
    provider: 'Google',
    models: [
      { label: 'Gemini 2.5 Pro', value: 'gemini-2.5-pro' },
      { label: 'Gemini 2.5 Flash', value: 'gemini-2.5-flash' },
    ],
  },
  {
    provider: 'DeepSeek',
    models: [
      { label: 'DeepSeek V3', value: 'deepseek-chat' },
      { label: 'DeepSeek R1', value: 'deepseek-reasoner' },
    ],
  },
]

const ALL_MODELS = MODEL_GROUPS.flatMap(g => g.models)

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
      <span>{{ selectedLabel }}</span>
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="transition-transform" :class="showDropdown ? 'rotate-180' : ''">
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </button>

    <!-- Dropdown -->
    <div
      v-show="showDropdown"
      class="absolute left-0 top-full z-50 mt-1 w-[340px] bg-white rounded-2xl shadow-[0_0_36px_rgba(0,0,0,0.1)] border border-[#e3e3e3]/50 py-2 overflow-hidden"
    >
      <div v-for="(group, gi) in MODEL_GROUPS" :key="group.provider">
        <div v-if="gi > 0" class="border-t border-[#f0f0f0] my-1" />
        <div class="px-3 pt-2 pb-1 text-[11px] font-semibold text-[#999] tracking-wide">
          {{ group.provider }}
        </div>
        <button
          v-for="model in group.models"
          :key="model.value"
          class="flex items-center w-full px-3 py-2.5 text-sm text-left hover:bg-[#f4f4f4] rounded-xl mx-0 transition-colors text-[#0d0d0d]"
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

    <!-- Click outside to close -->
    <Teleport to="body">
      <div v-if="showDropdown" class="fixed inset-0 z-40" @click="showDropdown = false" />
    </Teleport>
  </div>
</template>
