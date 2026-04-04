<script setup lang='ts'>
import { computed, ref } from 'vue'
import { useMessage } from 'naive-ui'
import AvatarComponent from './Avatar.vue'
import TextComponent from './Text.vue'
import Icon from '@/components/common/Icon.vue'
import { t } from '@/locales'
import { copyToClip } from '@/utils/copy'

const reasoningExpanded = ref(false)

interface Props {
  dateTime?: string
  text?: string
  reasoning?: string
  inversion?: boolean
  error?: boolean
  loading?: boolean
  model?: string
  usage?: Chat.TokenUsage | null
}

interface Emit {
  (ev: 'regenerate'): void
  (ev: 'delete'): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emit>()
const message = useMessage()
const textRef = ref<HTMLElement>()
const asRawText = ref(props.inversion)
const messageRef = ref<HTMLElement>()

function handleRegenerate() {
  messageRef.value?.scrollIntoView()
  emit('regenerate')
}

async function handleCopy() {
  try {
    await copyToClip(props.text || '')
    message.success(t('chat.copied'))
  }
  catch {
    message.error(t('chat.copyFailed'))
  }
}

const cachedTokens = computed(() => {
  if (!props.usage) return 0
  const u = props.usage as any
  if (u.cache_read_input_tokens) return u.cache_read_input_tokens
  if (u.prompt_tokens_details?.cached_tokens) return u.prompt_tokens_details.cached_tokens
  if (u.claude_cache_read_tokens) return u.claude_cache_read_tokens
  return 0
})

const cacheWriteTokens = computed(() => {
  if (!props.usage) return 0
  const u = props.usage as any
  if (u.cache_creation_input_tokens) return u.cache_creation_input_tokens
  const c5 = u.claude_cache_creation_5_m_tokens || 0
  const c1 = u.claude_cache_creation_1_h_tokens || 0
  return c5 + c1
})
</script>

<template>
  <div ref="messageRef" class="group" :class="[inversion ? 'flex justify-end mb-4' : 'mb-6']">
    <!-- User Message -->
    <div v-if="inversion" class="max-w-[75%]">
      <div class="inline-block rounded-[22px] bg-[#f4f4f4] px-5 py-3">
        <div class="text-base leading-[1.6] text-[#0d0d0d]">
          <TextComponent ref="textRef" :inversion="inversion" :error="error" :text="text" :loading="loading" :as-raw-text="asRawText" />
        </div>
      </div>
      <div class="mt-1 flex h-5 justify-end opacity-0 transition-opacity group-hover:opacity-100">
        <button class="p-0.5 text-[#b4b4b4] transition-colors hover:text-[#0d0d0d]" @click="handleCopy">
          <Icon name="copy" :size="14" />
        </button>
      </div>
    </div>

    <!-- Assistant Message -->
    <div v-else class="flex gap-3">
      <AvatarComponent :image="false" class="mt-1 flex-shrink-0" />
      <div class="min-w-0 flex-1">
        <!-- Typing indicator -->
        <div v-if="loading && (!text || text.trim() === '') && !reasoning" class="py-2">
          <!-- Thinking mode: text indicator -->
          <span v-if="model && model.includes('-thinking')" class="thinking-text text-[13px] font-medium text-[#0066ff]">思考中...</span>
          <!-- Normal mode: pulsing dots -->
          <div v-else class="flex items-center gap-[5px]">
            <span class="typing-dot" />
            <span class="typing-dot [animation-delay:0.2s]" />
            <span class="typing-dot [animation-delay:0.4s]" />
          </div>
        </div>
        <!-- Reasoning / Thinking block -->
        <div v-if="reasoning" class="mb-3">
          <button
            class="flex items-center gap-1.5 text-[13px] font-medium transition-colors"
            :class="loading && !text ? 'text-[#0066ff]' : 'text-[#999] hover:text-[#666]'"
            @click="reasoningExpanded = !reasoningExpanded"
          >
            <svg
              v-if="loading && !text"
              class="animate-spin" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"
            >
              <path d="M21 12a9 9 0 1 1-6.219-8.56" />
            </svg>
            <svg
              v-else
              xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
            >
              <path d="M12 2a8 8 0 0 0-8 8c0 3.4 2.1 6.3 5 7.4V20a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1v-2.6c2.9-1.1 5-4 5-7.4a8 8 0 0 0-8-8z" />
              <line x1="9" y1="23" x2="15" y2="23" />
            </svg>
            <span>{{ loading && !text ? '思考中...' : '已思考' }}</span>
            <svg
              xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"
              class="transition-transform" :class="reasoningExpanded ? 'rotate-180' : ''"
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
          <div v-show="reasoningExpanded" class="mt-2 pl-3 border-l-2 border-[#e3e3e3] text-[13px] leading-[1.7] text-[#666] whitespace-pre-wrap">
            {{ reasoning }}
          </div>
        </div>
        <!-- Message text -->
        <div v-if="text" class="text-base leading-[1.6] text-[#0d0d0d]">
          <TextComponent ref="textRef" :inversion="inversion" :error="error" :text="text" :loading="loading" :as-raw-text="asRawText" />
        </div>
        <!-- Action row -->
        <div v-if="!loading" class="mt-2 flex items-center gap-1.5">
          <span v-if="model" class="mr-1 select-none text-xs font-medium text-[#888]">{{ model }}</span>
          <button class="action-btn" title="复制" @click="handleCopy"><Icon name="copy" :stroke-width="2.2" /></button>
          <button class="action-btn" title="重新生成" @click="handleRegenerate"><Icon name="refresh" :stroke-width="2.2" /></button>
          <button class="action-btn" title="有帮助"><Icon name="thumbs-up" :stroke-width="2.2" /></button>
          <button class="action-btn" title="没帮助"><Icon name="thumbs-down" :stroke-width="2.2" /></button>

          <!-- Token usage -->
          <div v-if="usage && usage.total_tokens" class="ml-2 flex items-center gap-1 border-l border-[#e3e3e3] pl-2">
            <Icon name="clock" :size="12" class="text-[#aaa]" />
            <span class="select-none whitespace-nowrap text-[11px] text-[#aaa]">
              {{ usage.prompt_tokens ?? 0 }} 入
              <template v-if="cachedTokens > 0"><span class="text-[#10a37f]">({{ cachedTokens }} 缓存读)</span></template>
              <template v-if="cacheWriteTokens > 0"><span class="text-[#e8912d]">({{ cacheWriteTokens }} 缓存写)</span></template>
              · {{ usage.completion_tokens ?? 0 }} 出
              · {{ usage.total_tokens }} 总
            </span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.action-btn {
  @apply p-1 text-[#888] transition-colors hover:text-[#0d0d0d];
}
.typing-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #b4b4b4;
  animation: dot-pulse 1.2s ease-in-out infinite;
}
@keyframes dot-pulse {
  0%, 80%, 100% { opacity: 0.3; transform: scale(0.85); }
  40% { opacity: 1; transform: scale(1); }
}
.thinking-text {
  animation: thinking-breathe 1.5s ease-in-out infinite;
}
@keyframes thinking-breathe {
  0%, 100% { opacity: 0.5; }
  50% { opacity: 1; }
}
</style>
