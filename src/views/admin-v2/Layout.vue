<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Icon from '@/components/common/Icon.vue'

const route = useRoute()
const router = useRouter()
const collapsed = ref(false)

const navItems = [
  { path: '/admin-v2/dashboard', label: '仪表盘', icon: 'activity', desc: '全池汇总 · 告警' },
  { path: '/admin-v2/pool', label: '账号池', icon: 'users', desc: '统一管理多 Provider 账号' },
  { path: '/admin-v2/proxies', label: '代理管理', icon: 'shield', desc: '配置代理节点' },
  { path: '/admin-v2/logs', label: '请求日志', icon: 'scroll', desc: 'ClewdR API 请求记录 · Headers 详情' },
  { path: '/admin-v2/settings', label: '设置', icon: 'sliders', desc: '系统参数与告警阈值' },
  { path: '/admin-v2/codex-pool', label: 'ChatGPT 号池', icon: 'bot', desc: 'Codex/ChatGPT OAuth 账号管理' },
  { path: '/admin-v2/clewdr-logs', label: 'ClewdR 日志', icon: 'terminal', desc: '实时系统日志 · SSH journalctl' },
]

const currentPath = computed(() => route.path)
const currentItem = computed(() => navItems.find(i => currentPath.value.startsWith(i.path)))

function navigate(path: string) { router.push(path) }
</script>

<template>
  <div class="flex h-screen bg-[#fafafa] dark:bg-[#09090b]">
    <!-- Sidebar -->
    <aside
      class="flex flex-col border-r border-[#e5e7eb] bg-white transition-all duration-200 flex-shrink-0"
      :class="collapsed ? 'w-16' : 'w-60'"
    >
      <div class="flex items-center h-14 px-4 border-b border-[#e5e7eb]">
        <div class="flex items-center gap-2.5 min-w-0">
          <div class="w-7 h-7 rounded-lg bg-gradient-to-br from-[#18181b] to-[#6366f1] flex items-center justify-center flex-shrink-0">
            <Icon name="zap" :size="14" class="text-white" :stroke-width="2.5" />
          </div>
          <div v-if="!collapsed" class="min-w-0">
            <div class="text-sm font-semibold text-[#18181b] truncate leading-tight">Admin V2</div>
            <div class="text-[10px] text-[#a1a1aa] leading-tight">预览 · Preview</div>
          </div>
        </div>
      </div>

      <nav class="flex-1 py-3 px-2 space-y-0.5 overflow-y-auto">
        <button
          v-for="item in navItems"
          :key="item.path"
          class="flex items-center gap-2.5 w-full rounded-md text-sm transition-colors"
          :class="[
            currentPath.startsWith(item.path)
              ? 'bg-[#f4f4f5] text-[#18181b] font-medium'
              : 'text-[#71717a] hover:text-[#18181b] hover:bg-[#f4f4f5]',
            collapsed ? 'justify-center px-2 py-2' : 'px-3 py-2',
          ]"
          :title="collapsed ? item.label : ''"
          @click="navigate(item.path)"
        >
          <Icon :name="item.icon" :size="16" class="flex-shrink-0" />
          <span v-if="!collapsed">{{ item.label }}</span>
        </button>
      </nav>

      <div class="border-t border-[#e5e7eb] p-2 space-y-0.5">
        <button
          class="flex items-center gap-2.5 w-full rounded-md px-3 py-2 text-sm text-[#71717a] hover:text-[#18181b] hover:bg-[#f4f4f5] transition-colors"
          :class="collapsed ? 'justify-center px-2' : ''"
          @click="router.push('/admin')"
        >
          <Icon name="arrow-left" :size="16" class="flex-shrink-0" />
          <span v-if="!collapsed">返回旧版 Admin</span>
        </button>
        <button
          class="flex items-center gap-2.5 w-full rounded-md px-3 py-2 text-sm text-[#71717a] hover:text-[#18181b] hover:bg-[#f4f4f5] transition-colors"
          :class="collapsed ? 'justify-center px-2' : ''"
          @click="collapsed = !collapsed"
        >
          <Icon :name="collapsed ? 'chevron-right' : 'sidebar'" :size="16" class="flex-shrink-0" />
          <span v-if="!collapsed">收起侧栏</span>
        </button>
      </div>
    </aside>

    <!-- Main -->
    <main class="flex-1 flex flex-col min-w-0 overflow-hidden">
      <!-- Top bar -->
      <header class="h-14 border-b border-[#e5e7eb] bg-white px-6 flex items-center justify-between flex-shrink-0">
        <div class="min-w-0">
          <h1 class="text-sm font-semibold text-[#18181b]">{{ currentItem?.label || 'Admin V2' }}</h1>
          <p class="text-[11px] text-[#a1a1aa] leading-tight">{{ currentItem?.desc || '' }}</p>
        </div>
        <div class="flex items-center gap-3">
          <span class="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-[#eef2ff] text-[#6366f1] text-[10px] font-medium border border-[#c7d2fe]">
            <span class="w-1.5 h-1.5 rounded-full bg-[#6366f1] animate-pulse" />
            Preview Build
          </span>
          <div class="flex items-center gap-2 text-xs">
            <div class="w-7 h-7 rounded-full bg-[#f4f4f5] flex items-center justify-center text-[#71717a] font-semibold">A</div>
            <span class="text-[#71717a]">admin</span>
          </div>
          <button
            class="text-xs text-[#71717a] hover:text-[#18181b] transition-colors"
            @click="router.push('/')"
          >退出</button>
        </div>
      </header>
      <div class="flex-1 overflow-y-auto">
        <router-view />
      </div>
    </main>
  </div>
</template>
