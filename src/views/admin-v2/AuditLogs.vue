<script setup lang="ts">
import { ref, computed } from 'vue'
import Icon from '@/components/common/Icon.vue'

interface LogItem {
  id: number
  time: string
  user: string
  action: string
  resource: string
  target: string
  ip: string
  level: 'info' | 'warn' | 'error'
}

// Mock data — 后端接口开发中
const mockLogs: LogItem[] = [
  { id: 1, time: '2026-04-11 11:42:15', user: 'admin', action: 'cookie.batch_add', resource: 'claude', target: '3 个账号', ip: '127.0.0.1', level: 'info' },
  { id: 2, time: '2026-04-11 11:15:02', user: 'admin', action: 'cookie.disable', resource: 'claude', target: 'sk-ant-…a3f2', ip: '127.0.0.1', level: 'warn' },
  { id: 3, time: '2026-04-11 10:58:47', user: 'admin', action: 'proxy.update', resource: 'proxy', target: 'proxy-hk-01', ip: '127.0.0.1', level: 'info' },
  { id: 4, time: '2026-04-11 09:20:00', user: 'system', action: 'quota.auto_reset', resource: 'claude', target: '5 个账号', ip: '-', level: 'info' },
  { id: 5, time: '2026-04-11 08:03:21', user: 'admin', action: 'auth.login', resource: 'system', target: 'web ui', ip: '127.0.0.1', level: 'info' },
  { id: 6, time: '2026-04-10 23:51:04', user: 'system', action: 'cookie.auto_disable', resource: 'claude', target: 'sk-ant-…91b2', ip: '-', level: 'error' },
  { id: 7, time: '2026-04-10 22:01:18', user: 'admin', action: 'cookie.add', resource: 'claude', target: 'sk-ant-…77ac', ip: '127.0.0.1', level: 'info' },
  { id: 8, time: '2026-04-10 18:44:33', user: 'admin', action: 'settings.update', resource: 'system', target: 'alert_threshold', ip: '127.0.0.1', level: 'info' },
  { id: 9, time: '2026-04-10 15:30:09', user: 'admin', action: 'proxy.create', resource: 'proxy', target: 'proxy-sg-02', ip: '127.0.0.1', level: 'info' },
  { id: 10, time: '2026-04-10 12:05:52', user: 'system', action: 'cookie.health_check', resource: 'claude', target: '12 个账号', ip: '-', level: 'info' },
]

const search = ref('')
const levelFilter = ref<'all' | 'info' | 'warn' | 'error'>('all')

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  return mockLogs.filter((l) => {
    if (levelFilter.value !== 'all' && l.level !== levelFilter.value) return false
    if (!q) return true
    return `${l.action} ${l.target} ${l.user}`.toLowerCase().includes(q)
  })
})

function levelClass(l: string) {
  if (l === 'error') return 'bg-[#fef2f2] text-[#dc2626] border-[#fecaca]'
  if (l === 'warn') return 'bg-[#fffbeb] text-[#d97706] border-[#fde68a]'
  return 'bg-[#f4f4f5] text-[#71717a] border-[#e5e7eb]'
}
</script>

<template>
  <div class="p-6 space-y-4">
    <div>
      <h2 class="text-base font-semibold text-[#18181b]">审计日志</h2>
      <p class="text-xs text-[#71717a] mt-0.5">记录所有账号池、代理、系统配置的变更操作</p>
    </div>

    <div class="rounded-xl border border-[#e5e7eb] bg-white">
      <div class="flex items-center gap-2 px-4 py-3 border-b border-[#e5e7eb]">
        <div class="relative flex-1 max-w-xs">
          <Icon name="search" :size="14" class="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#a1a1aa]" />
          <input
            v-model="search"
            type="text"
            placeholder="搜索操作 / 用户 / 目标..."
            class="w-full pl-8 pr-3 py-1.5 text-xs rounded-md border border-[#e5e7eb] focus:outline-none focus:border-[#18181b]"
          >
        </div>
        <select
          v-model="levelFilter"
          class="px-2.5 py-1.5 text-xs rounded-md border border-[#e5e7eb] bg-white text-[#18181b] focus:outline-none focus:border-[#18181b]"
        >
          <option value="all">全部级别</option>
          <option value="info">info</option>
          <option value="warn">warn</option>
          <option value="error">error</option>
        </select>
        <div class="flex-1" />
        <span class="text-[11px] text-[#a1a1aa]">{{ filtered.length }} 条记录 · 示例数据</span>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full text-xs">
          <thead class="bg-[#fafafa] text-[#71717a]">
            <tr>
              <th class="px-4 py-2.5 text-left font-medium w-44">时间</th>
              <th class="px-4 py-2.5 text-left font-medium w-16">级别</th>
              <th class="px-4 py-2.5 text-left font-medium w-20">用户</th>
              <th class="px-4 py-2.5 text-left font-medium">操作</th>
              <th class="px-4 py-2.5 text-left font-medium">资源</th>
              <th class="px-4 py-2.5 text-left font-medium">目标</th>
              <th class="px-4 py-2.5 text-left font-medium w-28">IP</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="l in filtered" :key="l.id" class="border-t border-[#f4f4f5] hover:bg-[#fafafa]">
              <td class="px-4 py-2.5 text-[#71717a] tabular-nums font-mono text-[10px]">{{ l.time }}</td>
              <td class="px-4 py-2.5">
                <span class="inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium border" :class="levelClass(l.level)">{{ l.level }}</span>
              </td>
              <td class="px-4 py-2.5 text-[#18181b]">{{ l.user }}</td>
              <td class="px-4 py-2.5 font-mono text-[#18181b]">{{ l.action }}</td>
              <td class="px-4 py-2.5 text-[#71717a]">{{ l.resource }}</td>
              <td class="px-4 py-2.5 text-[#18181b]">{{ l.target }}</td>
              <td class="px-4 py-2.5 text-[#71717a] font-mono text-[10px]">{{ l.ip }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
