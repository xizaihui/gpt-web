<script setup lang="ts">
import { computed } from 'vue'

interface Alert {
  id: string | number
  level: 'warning' | 'error' | 'info'
  title: string
  desc?: string
  time?: string
}

const props = defineProps<{ alerts?: Alert[] }>()

const defaultAlerts: Alert[] = [
  { id: 1, level: 'error', title: 'Claude 账号额度告急', desc: 'sk-ant-sid...a3f2 session 使用率 95%', time: '5 分钟前' },
  { id: 2, level: 'warning', title: '代理连接延迟升高', desc: 'proxy-hk-01 延迟 1.2s', time: '12 分钟前' },
  { id: 3, level: 'error', title: 'Token 失效', desc: 'Codex 账号 codex-04 登录态过期', time: '32 分钟前' },
  { id: 4, level: 'warning', title: 'Claude 7 日使用率偏高', desc: 'sk-ant-sid...91b2 达到 82%', time: '1 小时前' },
  { id: 5, level: 'info', title: '账号池自动重置', desc: '3 个账号额度已重置', time: '2 小时前' },
]

const list = computed(() => props.alerts && props.alerts.length ? props.alerts : defaultAlerts)

function dot(level: string) {
  if (level === 'error') return 'bg-[#dc2626]'
  if (level === 'warning') return 'bg-[#d97706]'
  return 'bg-[#6366f1]'
}
function badge(level: string) {
  if (level === 'error') return 'bg-[#fef2f2] text-[#dc2626] border-[#fecaca]'
  if (level === 'warning') return 'bg-[#fffbeb] text-[#d97706] border-[#fde68a]'
  return 'bg-[#eef2ff] text-[#6366f1] border-[#c7d2fe]'
}
function badgeText(level: string) {
  if (level === 'error') return '严重'
  if (level === 'warning') return '警告'
  return '信息'
}
</script>

<template>
  <div class="space-y-3">
    <div v-for="a in list" :key="a.id" class="relative pl-5">
      <span class="absolute left-0 top-1.5 w-2 h-2 rounded-full" :class="dot(a.level)" />
      <span class="absolute left-[3px] top-4 bottom-[-12px] w-px bg-[#e5e7eb]" />
      <div class="flex items-start justify-between gap-2">
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2">
            <span
              class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border"
              :class="badge(a.level)"
            >{{ badgeText(a.level) }}</span>
            <span class="text-sm font-medium text-[#18181b] truncate">{{ a.title }}</span>
          </div>
          <div v-if="a.desc" class="mt-0.5 text-xs text-[#71717a] truncate">{{ a.desc }}</div>
        </div>
        <span v-if="a.time" class="text-[10px] text-[#a1a1aa] whitespace-nowrap mt-0.5">{{ a.time }}</span>
      </div>
    </div>
  </div>
</template>
