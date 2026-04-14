<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue'

const props = withDefaults(defineProps<{ resetAt?: number | string | null; label?: string }>(), {
  resetAt: null,
  label: '',
})

const now = ref(Date.now())
let timer: number | null = null

onMounted(() => {
  timer = window.setInterval(() => { now.value = Date.now() }, 1000)
})
onUnmounted(() => {
  if (timer) window.clearInterval(timer)
})

const resetMs = computed(() => {
  if (!props.resetAt) return 0
  const v = typeof props.resetAt === 'string' ? Date.parse(props.resetAt) : Number(props.resetAt)
  if (v < 1e12) return v * 1000
  return v
})

const remaining = computed(() => Math.max(0, resetMs.value - now.value))

const display = computed(() => {
  if (!props.resetAt) return '—'
  const ms = remaining.value
  if (ms <= 0) return '已重置'
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  const s = Math.floor((ms % 60_000) / 1000)
  if (h >= 24) {
    const d = Math.floor(h / 24)
    return d + '天 ' + (h % 24) + '小时'
  }
  if (h > 0) return h + '小时 ' + m + '分'
  if (m > 0) return m + '分 ' + s + '秒'
  return s + '秒'
})

const tone = computed(() => {
  if (!props.resetAt) return 'text-[#a1a1aa]'
  const ms = remaining.value
  if (ms <= 0) return 'text-[#71717a]'
  if (ms < 3600_000) return 'text-[#dc2626]'
  if (ms < 6 * 3600_000) return 'text-[#d97706]'
  return 'text-[#16a34a]'
})
</script>

<template>
  <div class="inline-flex items-center gap-1">
    <span v-if="label" class="text-[10px] text-[#a1a1aa] font-medium w-5">{{ label }}</span>
    <span class="text-xs tabular-nums font-medium" :class="tone">{{ display }}</span>
  </div>
</template>
