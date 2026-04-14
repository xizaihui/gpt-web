<script setup lang='ts'>
import { computed, nextTick, ref, onMounted, onUnmounted } from 'vue'
import { NInput } from 'naive-ui'
import { useAppStore, useChatStore } from '@/store'
import Icon from '@/components/common/Icon.vue'
import { useBasicLayout } from '@/hooks/useBasicLayout'

const { isMobile } = useBasicLayout()

const appStore = useAppStore()
const chatStore = useChatStore()

const dataSources = computed(() => chatStore.history)

// Group chats: pinned first, then by time
const groupedChats = computed(() => {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const yesterday = new Date(today.getTime() - 86400000)
  const last7Days = new Date(today.getTime() - 7 * 86400000)
  const last30Days = new Date(today.getTime() - 30 * 86400000)

  const groups: { label: string; items: Array<{ item: Chat.History; index: number }> }[] = [
    { label: '📌 置顶', items: [] },
    { label: '今天', items: [] },
    { label: '昨天', items: [] },
    { label: '最近 7 天', items: [] },
    { label: '最近 30 天', items: [] },
    { label: '更早', items: [] },
  ]

  dataSources.value.forEach((item, originalIndex) => {
    if (item.pinned) {
      groups[0].items.push({ item, index: originalIndex })
      return
    }

    const chatDate = new Date(item.uuid)
    if (chatDate >= today) groups[1].items.push({ item, index: originalIndex })
    else if (chatDate >= yesterday) groups[2].items.push({ item, index: originalIndex })
    else if (chatDate >= last7Days) groups[3].items.push({ item, index: originalIndex })
    else if (chatDate >= last30Days) groups[4].items.push({ item, index: originalIndex })
    else groups[5].items.push({ item, index: originalIndex })
  })

  return groups.filter(g => g.items.length > 0)
})

const hoveredUuid = ref<number | null>(null)
const menuOpenUuid = ref<number | null>(null)
const menuPosition = ref({ top: 0, left: 0 })

function openMenu(uuid: number, event: MouseEvent) {
  event.stopPropagation()
  event.preventDefault()

  const btn = event.currentTarget as HTMLElement
  const rect = btn.getBoundingClientRect()

  // Position menu to the right of the three-dot button
  menuPosition.value = {
    top: rect.bottom + 4,
    left: rect.left,
  }

  // Ensure menu doesn't go below viewport
  nextTick(() => {
    const menuHeight = 160 // approximate menu height
    if (menuPosition.value.top + menuHeight > window.innerHeight) {
      menuPosition.value.top = rect.top - menuHeight - 4
    }
  })

  menuOpenUuid.value = menuOpenUuid.value === uuid ? null : uuid
}

function closeMenu() {
  menuOpenUuid.value = null
}

// Close menu on outside click
function handleDocumentClick(e: MouseEvent) {
  if (menuOpenUuid.value !== null) {
    closeMenu()
  }
}

onMounted(() => {
  document.addEventListener('click', handleDocumentClick)
})

onUnmounted(() => {
  document.removeEventListener('click', handleDocumentClick)
})

async function handleSelect({ uuid }: Chat.History) {
  if (isActive(uuid))
    return

  if (chatStore.active)
    await chatStore.updateHistory(chatStore.active, { isEdit: false })
  await chatStore.setActive(uuid)

  if (isMobile.value)
    appStore.setSiderCollapsed(true)
}

function handleRename(item: Chat.History, event?: MouseEvent) {
  event?.stopPropagation()
  closeMenu()
  chatStore.updateHistory(item.uuid, { isEdit: true })  // isEdit is local-only, no backend call needed
}

function handleSaveRename(item: Chat.History, event?: KeyboardEvent | MouseEvent) {
  event?.stopPropagation()
  chatStore.updateHistory(item.uuid, { isEdit: false, title: item.title })
}

function handleEnter(item: Chat.History, event: KeyboardEvent) {
  event?.stopPropagation()
  if (event.key === 'Enter')
    chatStore.updateHistory(item.uuid, { isEdit: false, title: item.title })
}

async function handlePin(item: Chat.History, event?: MouseEvent) {
  event?.stopPropagation()
  closeMenu()
  await chatStore.updateHistory(item.uuid, { pinned: !item.pinned })
}

async function handleDelete(index: number, event?: MouseEvent) {
  event?.stopPropagation()
  closeMenu()
  await chatStore.deleteHistory(index)
  if (isMobile.value)
    appStore.setSiderCollapsed(true)
}

function isActive(uuid: number) {
  return chatStore.active === uuid
}
</script>

<template>
  <div class="h-full overflow-y-auto px-1.5 scrollbar-thin">
    <div class="flex flex-col">
      <template v-if="!dataSources.length">
        <div class="flex flex-col items-center mt-4 text-center text-[#999]">
          <span class="text-xs">暂无对话</span>
        </div>
      </template>
      <template v-else>
        <div v-for="group in groupedChats" :key="group.label">
          <!-- Group header -->
          <div class="px-2 py-1.5 mt-3 first:mt-0 text-xs font-semibold text-[#666] select-none">
            {{ group.label }}
          </div>
          <!-- Chat items -->
          <div
            v-for="{ item, index } of group.items"
            :key="item.uuid"
            class="relative"
            @mouseenter="hoveredUuid = item.uuid"
            @mouseleave="hoveredUuid = null"
          >
            <a
              class="relative flex items-center px-2 py-2 rounded-lg cursor-pointer text-sm text-[#0d0d0d] transition-colors group/item"
              :class="isActive(item.uuid) ? 'bg-[#ececec]' : 'hover:bg-[#ececec]'"
              @click="handleSelect(item)"
            >
              <div class="relative flex-1 overflow-hidden whitespace-nowrap text-ellipsis min-w-0">
                <NInput
                  v-if="item.isEdit"
                  v-model:value="item.title"
                  size="tiny"
                  class="sidebar-input"
                  @keypress="handleEnter(item, $event)"
                />
                <span v-else>{{ item.title }}</span>
              </div>

              <!-- Three-dot menu button — always takes space, opacity toggles -->
              <div
                v-if="!item.isEdit"
                class="flex items-center ml-1 flex-shrink-0 transition-opacity"
                :class="(hoveredUuid === item.uuid || isActive(item.uuid) || menuOpenUuid === item.uuid) ? 'opacity-100' : 'opacity-0'"
              >
                <button
                  class="flex items-center justify-center w-7 h-7 rounded-md text-[#666] hover:text-[#0d0d0d] hover:bg-[#ddd] transition-colors"
                  @click="openMenu(item.uuid, $event)"
                >
                  <Icon name="more-vertical" :size="16" />
                </button>
              </div>

              <!-- Edit mode: save button -->
              <div
                v-if="item.isEdit"
                class="flex items-center gap-0.5 ml-1 flex-shrink-0"
              >
                <button
                  class="p-1 text-[#666] hover:text-[#0d0d0d] rounded transition-colors"
                  @click="handleSaveRename(item, $event)"
                >
                  <Icon name="check" :size="14" />
                </button>
              </div>

              <!-- Gradient fade for long text — always present, color changes on hover/active -->
              <div
                v-if="!item.isEdit"
                class="absolute right-0 top-0 bottom-0 w-12 pointer-events-none transition-colors"
                :class="(isActive(item.uuid) || hoveredUuid === item.uuid) ? 'bg-gradient-to-l from-[#ececec]' : 'bg-gradient-to-l from-white'"
              />
            </a>
          </div>
        </div>
      </template>
    </div>
  </div>

  <!-- Context menu (teleported to body) -->
  <Teleport to="body">
    <div
      v-if="menuOpenUuid !== null"
      class="fixed z-[200]"
      :style="{ top: menuPosition.top + 'px', left: menuPosition.left + 'px' }"
      @click.stop
    >
      <div class="bg-white rounded-xl shadow-[0_4px_24px_rgba(0,0,0,0.12)] border border-[#e8e8e8] py-1.5 min-w-[180px] overflow-hidden">
        <!-- Pin / Unpin -->
        <button
          v-for="{ item, index } of groupedChats.flatMap(g => g.items).filter(({ item }) => item.uuid === menuOpenUuid)"
          :key="'pin-' + item.uuid"
          class="flex items-center gap-3 w-full px-4 py-2.5 text-sm text-[#0d0d0d] hover:bg-[#f4f4f4] transition-colors text-left"
          @click="handlePin(item, $event)"
        >
          <Icon name="pin" :size="18" :stroke-width="1.8" />
          <span>{{ item.pinned ? '取消置顶' : '置顶聊天' }}</span>
        </button>

        <!-- Rename -->
        <button
          v-for="{ item } of groupedChats.flatMap(g => g.items).filter(({ item }) => item.uuid === menuOpenUuid)"
          :key="'rename-' + item.uuid"
          class="flex items-center gap-3 w-full px-4 py-2.5 text-sm text-[#0d0d0d] hover:bg-[#f4f4f4] transition-colors text-left"
          @click="handleRename(item, $event)"
        >
          <Icon name="edit-2" :size="18" :stroke-width="1.8" />
          <span>重命名</span>
        </button>

        <div class="border-t border-[#f0f0f0] my-1" />

        <!-- Delete (red) -->
        <button
          v-for="{ item, index } of groupedChats.flatMap(g => g.items).filter(({ item }) => item.uuid === menuOpenUuid)"
          :key="'del-' + item.uuid"
          class="flex items-center gap-3 w-full px-4 py-2.5 text-sm text-[#ef4444] hover:bg-red-50 transition-colors text-left"
          @click="handleDelete(index, $event)"
        >
          <Icon name="trash" :size="18" :stroke-width="1.8" />
          <span>删除</span>
        </button>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.scrollbar-thin::-webkit-scrollbar {
  width: 4px;
}
.scrollbar-thin::-webkit-scrollbar-track {
  background: transparent;
}
.scrollbar-thin::-webkit-scrollbar-thumb {
  background: rgba(0,0,0,0.08);
  border-radius: 2px;
}
.scrollbar-thin::-webkit-scrollbar-thumb:hover {
  background: rgba(0,0,0,0.15);
}
</style>
