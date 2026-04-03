<script setup lang='ts'>
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import Sider from './sider/index.vue'
import Permission from './Permission.vue'
import { useBasicLayout } from '@/hooks/useBasicLayout'
import { useAppStore, useAuthStore, useChatStore } from '@/store'

const router = useRouter()
const appStore = useAppStore()
const chatStore = useChatStore()
const authStore = useAuthStore()
router.replace({ name: 'Chat', params: { uuid: chatStore.active } })
const { isMobile } = useBasicLayout()
const collapsed = computed(() => appStore.siderCollapsed)
const needPermission = computed(() => !!authStore.session?.auth && !authStore.token)
</script>

<template>
  <div class="h-full flex bg-white">
    <Sider />
    <div v-if="isMobile && !collapsed" class="fixed inset-0 z-40 bg-black/20 backdrop-blur-[2px]" @click="appStore.setSiderCollapsed(true)" />
    <div class="flex-1 flex flex-col h-full overflow-hidden">
      <RouterView v-slot="{ Component, route }">
        <component :is="Component" :key="route.fullPath" />
      </RouterView>
    </div>
    <Permission :visible="needPermission" />
  </div>
</template>
