<script setup lang='ts'>
import type { CSSProperties } from 'vue'
import { computed, ref, watch } from 'vue'
import List from './List.vue'
import Footer from './Footer.vue'
import Icon from '@/components/common/Icon.vue'
import { useAppStore, useChatStore } from '@/store'
import { useBasicLayout } from '@/hooks/useBasicLayout'
import { t } from '@/locales'

const appStore = useAppStore()
const chatStore = useChatStore()

const { isMobile } = useBasicLayout()

const collapsed = computed(() => appStore.siderCollapsed)
const showSearchModal = ref(false)
const searchQuery = ref('')

async function handleAdd() {
  await chatStore.addHistory({ title: t('chat.newChatTitle'), uuid: Date.now(), isEdit: false })
  if (isMobile.value)
    appStore.setSiderCollapsed(true)
  showSearchModal.value = false
}

function handleToggleSidebar() {
  appStore.setSiderCollapsed(true)
}

function openSearch() {
  searchQuery.value = ''
  showSearchModal.value = true
}

// Search: filter + group history
const searchResults = computed(() => {
  const history = chatStore.history
  const q = searchQuery.value.toLowerCase().trim()
  const filtered = q ? history.filter(h => h.title.toLowerCase().includes(q)) : history

  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const yesterday = new Date(today.getTime() - 86400000)
  const last7Days = new Date(today.getTime() - 7 * 86400000)
  const last30Days = new Date(today.getTime() - 30 * 86400000)

  const groups: { label: string; items: Chat.History[] }[] = [
    { label: '今天', items: [] },
    { label: '昨天', items: [] },
    { label: '前 7 天', items: [] },
    { label: '前 30 天', items: [] },
    { label: '更早', items: [] },
  ]

  filtered.forEach((item) => {
    const d = new Date(item.uuid)
    if (d >= today) groups[0].items.push(item)
    else if (d >= yesterday) groups[1].items.push(item)
    else if (d >= last7Days) groups[2].items.push(item)
    else if (d >= last30Days) groups[3].items.push(item)
    else groups[4].items.push(item)
  })

  return groups.filter(g => g.items.length > 0)
})

async function selectSearchResult(item: Chat.History) {
  await chatStore.setActive(item.uuid)
  showSearchModal.value = false
  if (isMobile.value)
    appStore.setSiderCollapsed(true)
}

const siderStyle = computed<CSSProperties>(() => {
  if (isMobile.value) {
    return {
      position: 'fixed',
      zIndex: 50,
      height: '100%',
    }
  }
  return {}
})

const mobileSafeArea = computed(() => {
  if (isMobile.value) {
    return {
      paddingBottom: 'env(safe-area-inset-bottom)',
    }
  }
  return {}
})

watch(
  isMobile,
  (val) => {
    appStore.setSiderCollapsed(val)
  },
  {
    immediate: true,
    flush: 'post',
  },
)
</script>

<template>
  <div
    v-show="!collapsed"
    class="flex flex-col w-[260px] flex-shrink-0 bg-[#f9f9f9] h-full border-r border-[#e0e0e0]"
    :style="siderStyle"
  >
    <div class="flex flex-col h-full" :style="mobileSafeArea">
      <!-- Top row: OpenAI logo + sidebar toggle -->
      <div class="flex items-center justify-between h-[52px] px-3 flex-shrink-0">
        <!-- OpenAI logo -->
        <div class="flex items-center justify-center w-9 h-9">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.998 5.998 0 0 0-3.998 2.9 6.05 6.05 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.05 6.05 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855l-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v3.005l-2.607 1.5-2.602-1.5z" fill="#0d0d0d"/>
          </svg>
        </div>
        <!-- Sidebar toggle -->
        <button
          class="flex items-center justify-center w-9 h-9 rounded-lg hover:bg-[#ececec] transition-colors text-[#0d0d0d]"
          @click="handleToggleSidebar"
        >
          <Icon name="sidebar" :size="18" />
        </button>
      </div>

      <!-- Navigation: 新聊天 + 搜索聊天 (official ChatGPT icons) -->
      <nav class="px-1.5 mt-1 flex-shrink-0">
        <button
          class="flex items-center gap-3 w-full px-3 py-2 text-sm text-[#0d0d0d] hover:bg-[#ececec] rounded-lg transition-colors text-left"
          @click="handleAdd"
        >
          <Icon name="pen-square" :size="18" />
          <span>新聊天</span>
        </button>
        <button
          class="flex items-center gap-3 w-full px-3 py-2 text-sm text-[#0d0d0d] hover:bg-[#ececec] rounded-lg transition-colors text-left"
          @click="openSearch"
        >
          <Icon name="search" :size="18" />
          <span>搜索聊天</span>
        </button>
      </nav>

      <!-- Chat history section -->
      <div class="flex-1 min-h-0 overflow-hidden mt-2">
        <div class="px-3 mt-4 mb-1">
          <span class="text-xs font-semibold text-[#666] select-none">你的聊天</span>
        </div>
        <List />
      </div>

      <!-- Footer -->
      <Footer />
    </div>
  </div>

  <!-- Search Modal (centered overlay like OpenAI) -->
  <Teleport to="body">
    <div v-if="showSearchModal" class="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh]">
      <!-- Backdrop -->
      <div class="absolute inset-0 bg-black/30" @click="showSearchModal = false" />
      <!-- Modal -->
      <div class="relative w-full max-w-[560px] mx-4 bg-white rounded-2xl shadow-[0_25px_50px_-12px_rgba(0,0,0,0.25)] overflow-hidden max-h-[60vh] flex flex-col">
        <!-- Search input row -->
        <div class="flex items-center gap-3 px-5 py-4 border-b border-[#f0f0f0]">
          <Icon name="search" :size="18" class="flex-shrink-0 text-[#999]" />
          <input
            v-model="searchQuery"
            class="flex-1 text-base text-[#0d0d0d] placeholder-[#999] outline-none bg-transparent"
            placeholder="搜索聊天..."
            autofocus
            @keydown.esc="showSearchModal = false"
          >
          <button
            class="flex items-center justify-center w-7 h-7 rounded-md hover:bg-[#f4f4f4] text-[#999] hover:text-[#0d0d0d] transition-colors flex-shrink-0"
            @click="showSearchModal = false"
          >
            <Icon name="x" :size="16" />
          </button>
        </div>

        <!-- Results -->
        <div class="overflow-y-auto flex-1 py-1">
          <!-- New chat option -->
          <button
            class="flex items-center gap-3 w-full px-5 py-3 text-sm text-[#0d0d0d] hover:bg-[#f4f4f4] transition-colors text-left"
            @click="handleAdd"
          >
            <Icon name="pen-square" :size="16" />
            <span class="font-medium">新聊天</span>
          </button>

          <!-- Grouped results -->
          <div v-for="group in searchResults" :key="group.label">
            <div class="px-5 pt-3 pb-1 text-xs font-medium text-[#999]">
              {{ group.label }}
            </div>
            <button
              v-for="item in group.items"
              :key="item.uuid"
              class="flex items-center gap-3 w-full px-5 py-2.5 text-sm text-[#0d0d0d] hover:bg-[#f4f4f4] transition-colors text-left"
              @click="selectSearchResult(item)"
            >
              <Icon name="circle" :size="16" class="flex-shrink-0 text-[#999]" :stroke-width="1.5" />
              <span class="truncate">{{ item.title }}</span>
            </button>
          </div>

          <!-- Empty state -->
          <div v-if="searchQuery && searchResults.length === 0" class="px-5 py-8 text-center text-sm text-[#999]">
            没有找到匹配的聊天
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
