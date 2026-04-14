<script setup lang="ts">
import { ref, computed } from 'vue'

const props = withDefaults(defineProps<{
  data24h?: number[]
  data7d?: number[]
  height?: number
}>(), {
  height: 160,
})

const range = ref<'24h' | '7d'>('24h')

// default mock data if not provided
const mock24h = Array.from({ length: 24 }, (_, i) => {
  const base = 20 + Math.sin(i / 4) * 15 + Math.random() * 10
  return Math.max(0, Math.round(base))
})
const mock7d = Array.from({ length: 7 }, () => Math.round(30 + Math.random() * 50))

const data = computed(() => {
  if (range.value === '24h') return props.data24h && props.data24h.length ? props.data24h : mock24h
  return props.data7d && props.data7d.length ? props.data7d : mock7d
})

const labels = computed(() => {
  if (range.value === '24h') return Array.from({ length: 24 }, (_, i) => `${i}h`)
  return ['一', '二', '三', '四', '五', '六', '日']
})

const width = 560
const padding = { top: 16, right: 12, bottom: 24, left: 32 }

const chart = computed(() => {
  const d = data.value
  const h = props.height
  const innerW = width - padding.left - padding.right
  const innerH = h - padding.top - padding.bottom
  const max = Math.max(...d, 10)
  const min = 0
  const stepX = d.length > 1 ? innerW / (d.length - 1) : 0

  const pts = d.map((v, i) => {
    const x = padding.left + i * stepX
    const y = padding.top + innerH - ((v - min) / (max - min)) * innerH
    return { x, y, v }
  })

  const linePath = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
  const areaPath = `${linePath} L${pts[pts.length - 1].x.toFixed(1)},${padding.top + innerH} L${pts[0].x.toFixed(1)},${padding.top + innerH} Z`

  // y-axis ticks
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(t => ({
    y: padding.top + innerH - t * innerH,
    value: Math.round(min + t * (max - min)),
  }))

  return { pts, linePath, areaPath, max, innerH, innerW, ticks }
})
</script>

<template>
  <div class="w-full">
    <div class="flex items-center justify-between mb-2">
      <div class="text-sm font-medium text-[#18181b]">使用趋势</div>
      <div class="inline-flex rounded-md border border-[#e5e7eb] p-0.5 bg-white">
        <button
          class="px-2.5 py-1 text-xs rounded transition-colors"
          :class="range === '24h' ? 'bg-[#18181b] text-white' : 'text-[#71717a] hover:text-[#18181b]'"
          @click="range = '24h'"
        >24h</button>
        <button
          class="px-2.5 py-1 text-xs rounded transition-colors"
          :class="range === '7d' ? 'bg-[#18181b] text-white' : 'text-[#71717a] hover:text-[#18181b]'"
          @click="range = '7d'"
        >7d</button>
      </div>
    </div>
    <svg :viewBox="`0 0 ${width} ${height}`" class="w-full" :style="{ height: `${height}px` }">
      <defs>
        <linearGradient id="usageGradient" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stop-color="#18181b" stop-opacity="0.15" />
          <stop offset="100%" stop-color="#18181b" stop-opacity="0" />
        </linearGradient>
      </defs>
      <!-- grid -->
      <g>
        <line
          v-for="(t, i) in chart.ticks"
          :key="i"
          :x1="padding.left"
          :x2="width - padding.right"
          :y1="t.y"
          :y2="t.y"
          stroke="#f4f4f5"
          stroke-width="1"
        />
        <text
          v-for="(t, i) in chart.ticks"
          :key="`t${i}`"
          :x="padding.left - 6"
          :y="t.y + 3"
          text-anchor="end"
          fill="#a1a1aa"
          font-size="9"
        >{{ t.value }}</text>
      </g>
      <!-- area -->
      <path :d="chart.areaPath" fill="url(#usageGradient)" />
      <!-- line -->
      <path :d="chart.linePath" fill="none" stroke="#18181b" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
      <!-- points -->
      <g>
        <circle
          v-for="(p, i) in chart.pts"
          :key="i"
          :cx="p.x"
          :cy="p.y"
          r="2"
          fill="#18181b"
        />
      </g>
      <!-- x labels: sample every few -->
      <g>
        <text
          v-for="(label, i) in labels"
          :key="`x${i}`"
          v-show="range === '7d' || i % 4 === 0"
          :x="chart.pts[i]?.x"
          :y="height - 6"
          text-anchor="middle"
          fill="#a1a1aa"
          font-size="9"
        >{{ label }}</text>
      </g>
    </svg>
  </div>
</template>
