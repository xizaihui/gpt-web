<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Icon from '@/components/common/Icon.vue'

const route = useRoute()
const router = useRouter()
const collapsed = ref(false)

const navItems = [
  { path: '/admin/pool', label: '号池管理', icon: 'users', description: '管理 ChatGPT 订阅账号' },
  { path: '/admin/claude-pool', label: 'Claude 号池', icon: 'brain', description: '管理 Claude Pro 订阅账号' },
  { path: '/admin/clewdr-logs', label: 'ClewdR 日志', icon: 'scroll', description: 'ClewdR 请求日志 · 对账' },
  { path: '/admin/proxies', label: '代理管理', icon: 'shield', description: '配置账号代理 IP' },
  { path: '/admin/logs', label: '请求日志', icon: 'file-text', description: '请求日志与费用统计' },
]

const currentPath = computed(() => route.path)

function navigate(path: string) {
  router.push(path)
}
</script>

<template>
  <div class="flex h-screen bg-[#fafafa] dark:bg-[#09090b]">
    <!-- Sidebar -->
    <aside
      class="flex flex-col border-r border-[#e5e7eb] bg-white transition-all duration-200 flex-shrink-0"
      :class="collapsed ? 'w-16' : 'w-60'"
    >
      <!-- Logo -->
      <div class="flex items-center h-14 px-4 border-b border-[#e5e7eb]">
        <div class="flex items-center gap-2.5 min-w-0">
          <div class="w-7 h-7 rounded-lg bg-[#18181b] flex items-center justify-center flex-shrink-0">
            <Icon name="zap" :size="14" class="text-white" :stroke-width="2.5" />
          </div>
          <span v-if="!collapsed" class="text-sm font-semibold text-[#18181b] truncate">ChatGPT Admin</span>
        </div>
      </div>

      <!-- Nav -->
      <nav class="flex-1 py-3 px-2 space-y-0.5 overflow-y-auto">
        <button
          v-for="item in navItems"
          :key="item.path"
          class="flex items-center gap-2.5 w-full rounded-md text-sm transition-colors"
          :class="[
            currentPath === item.path
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

      <!-- Bottom: collapse toggle + back -->
      <div class="border-t border-[#e5e7eb] p-2 space-y-0.5">
        <button
          class="flex items-center gap-2.5 w-full rounded-md px-3 py-2 text-sm text-[#71717a] hover:text-[#18181b] hover:bg-[#f4f4f5] transition-colors"
          :class="collapsed ? 'justify-center px-2' : ''"
          @click="router.push('/')"
        >
          <Icon name="arrow-left" :size="16" class="flex-shrink-0" />
          <span v-if="!collapsed">返回聊天</span>
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

    <!-- Main content -->
    <main class="flex-1 flex flex-col min-w-0 overflow-hidden">
      <router-view />
    </main>
  </div>
</template>
