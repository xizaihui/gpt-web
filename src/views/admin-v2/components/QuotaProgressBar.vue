<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{ value: number; showText?: boolean; height?: number }>(), {
  showText: true,
  height: 8,
})

const clamped = computed(() => Math.max(0, Math.min(100, Number(props.value) || 0)))
const color = computed(() => {
  const v = clamped.value
  if (v >= 80) return '#dc2626'
  if (v >= 50) return '#d97706'
  return '#16a34a'
})
const bgColor = computed(() => {
  const v = clamped.value
  if (v >= 80) return '#fef2f2'
  if (v >= 50) return '#fffbeb'
  return '#f0fdf4'
})
</script>

<template>
  <div class="flex items-center gap-2 min-w-0">
    <div
      class="flex-1 rounded-full overflow-hidden"
      :style="{ height: `${height}px`, backgroundColor: bgColor }"
    >
      <div
        class="h-full transition-all duration-500 rounded-full"
        :style="{ width: `${clamped}%`, backgroundColor: color }"
      />
    </div>
    <span
      v-if="showText"
      class="text-xs font-medium tabular-nums w-10 text-right"
      :style="{ color }"
    >{{ clamped.toFixed(0) }}%</span>
  </div>
</template>
