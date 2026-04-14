<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  data?: Array<{ name: string; value: number; color?: string }>
  size?: number
}>(), {
  size: 180,
})

const defaultData = [
  { name: 'Opus', value: 35, color: '#18181b' },
  { name: 'Sonnet', value: 48, color: '#6366f1' },
  { name: 'Haiku', value: 17, color: '#22c55e' },
]

const items = computed(() => {
  const raw = (props.data && props.data.length ? props.data : defaultData).filter(d => d.value > 0)
  const total = raw.reduce((s, d) => s + d.value, 0) || 1
  const palette = ['#18181b', '#6366f1', '#22c55e', '#f59e0b', '#ec4899', '#06b6d4']
  return raw.map((d, i) => ({
    ...d,
    color: d.color || palette[i % palette.length],
    pct: (d.value / total) * 100,
  }))
})

const arcs = computed(() => {
  const r = props.size / 2
  const cx = r
  const cy = r
  const R = r - 4
  const rInner = R * 0.6
  let acc = 0
  const total = items.value.reduce((s, d) => s + d.value, 0) || 1
  return items.value.map((d) => {
    const start = (acc / total) * Math.PI * 2 - Math.PI / 2
    acc += d.value
    const end = (acc / total) * Math.PI * 2 - Math.PI / 2
    const large = end - start > Math.PI ? 1 : 0
    const x1 = cx + R * Math.cos(start)
    const y1 = cy + R * Math.sin(start)
    const x2 = cx + R * Math.cos(end)
    const y2 = cy + R * Math.sin(end)
    const xi1 = cx + rInner * Math.cos(end)
    const yi1 = cy + rInner * Math.sin(end)
    const xi2 = cx + rInner * Math.cos(start)
    const yi2 = cy + rInner * Math.sin(start)
    const path = [
      `M ${x1} ${y1}`,
      `A ${R} ${R} 0 ${large} 1 ${x2} ${y2}`,
      `L ${xi1} ${yi1}`,
      `A ${rInner} ${rInner} 0 ${large} 0 ${xi2} ${yi2}`,
      'Z',
    ].join(' ')
    return { ...d, path }
  })
})
</script>

<template>
  <div class="flex items-center gap-4">
    <svg :width="size" :height="size" :viewBox="`0 0 ${size} ${size}`">
      <path v-for="a in arcs" :key="a.name" :d="a.path" :fill="a.color" />
      <text
        :x="size / 2"
        :y="size / 2 - 4"
        text-anchor="middle"
        fill="#71717a"
        font-size="10"
      >模型分布</text>
      <text
        :x="size / 2"
        :y="size / 2 + 12"
        text-anchor="middle"
        fill="#18181b"
        font-size="16"
        font-weight="600"
      >{{ items.length }}</text>
    </svg>
    <div class="flex-1 space-y-2">
      <div v-for="a in items" :key="a.name" class="flex items-center gap-2 text-xs">
        <span class="w-2.5 h-2.5 rounded-sm" :style="{ backgroundColor: a.color }" />
        <span class="text-[#18181b] font-medium flex-1">{{ a.name }}</span>
        <span class="text-[#71717a] tabular-nums">{{ a.pct.toFixed(1) }}%</span>
      </div>
    </div>
  </div>
</template>
