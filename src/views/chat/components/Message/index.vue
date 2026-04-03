<script setup lang='ts'>
import { computed, ref } from 'vue'
import { useMessage } from 'naive-ui'
import AvatarComponent from './Avatar.vue'
import TextComponent from './Text.vue'
import Icon from '@/components/common/Icon.vue'
import { t } from '@/locales'
import { copyToClip } from '@/utils/copy'

interface Props {
  dateTime?: string
  text?: string
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
        <div v-if="loading && (!text || text.trim() === '')" class="typing-indicator flex items-center gap-1 py-2">
          <span class="dot" /><span class="dot" /><span class="dot" />
        </div>
        <!-- Message text -->
        <div v-else class="text-base leading-[1.6] text-[#0d0d0d]">
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
.typing-indicator .dot {
  @apply inline-block h-2 w-2 rounded-full bg-[#999];
  animation: typing-bounce 1.4s ease-in-out infinite both;
}
.typing-indicator .dot:nth-child(1) { animation-delay: 0s; }
.typing-indicator .dot:nth-child(2) { animation-delay: 0.16s; }
.typing-indicator .dot:nth-child(3) { animation-delay: 0.32s; }
@keyframes typing-bounce {
  0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
  40% { transform: scale(1); opacity: 1; }
}
</style>
