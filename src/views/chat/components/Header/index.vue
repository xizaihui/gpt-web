<script lang="ts" setup>
import { computed } from 'vue'
import { useAppStore } from '@/store'

const appStore = useAppStore()
const collapsed = computed(() => appStore.siderCollapsed)

function handleUpdateCollapsed() {
  appStore.setSiderCollapsed(!collapsed.value)
}
</script>

<template>
  <button
    class="flex items-center justify-center w-9 h-9 rounded-xl hover:bg-[#f4f4f4] transition-colors text-[#0d0d0d]"
    @click="handleUpdateCollapsed"
  >
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  </button>
</template>
