<script setup lang='ts'>
import { ref } from 'vue'
import { useSettingStore } from '@/store'
import Icon from '@/components/common/Icon.vue'

const settingStore = useSettingStore()
const showSettings = ref(false)
const contextRounds = ref(settingStore.contextRounds)

function toggleSettings() {
  showSettings.value = !showSettings.value
  // Sync from store when opening
  if (showSettings.value) {
    contextRounds.value = settingStore.contextRounds
  }
}

function saveContextRounds() {
  const val = Math.max(0, Math.min(100, Math.round(contextRounds.value)))
  contextRounds.value = val
  settingStore.updateSetting({ contextRounds: val })
}

function closeSettings() {
  showSettings.value = false
}
</script>

<template>
  <footer class="relative flex items-center px-3 py-3 flex-shrink-0 border-t border-[#ececec]">
    <div
      class="flex items-center gap-2.5 flex-1 min-w-0 cursor-pointer rounded-lg px-1 py-1 -mx-1 hover:bg-[#f4f4f4] transition-colors"
      @click="toggleSettings"
    >
      <!-- User avatar circle -->
      <div class="w-8 h-8 rounded-full bg-[#19c37d] flex items-center justify-center flex-shrink-0 text-white text-xs font-semibold">
        U
      </div>
      <div class="flex items-center gap-2 min-w-0">
        <span class="text-sm text-[#0d0d0d] truncate">用户</span>
        <span class="inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium bg-[#f4f4f4] text-[#666] rounded-md flex-shrink-0">Plus</span>
      </div>
    </div>

    <!-- Settings popover -->
    <div
      v-if="showSettings"
      class="absolute bottom-full left-0 right-0 mb-2 mx-1.5 z-[101]"
    >
      <div class="bg-white rounded-xl shadow-[0_4px_24px_rgba(0,0,0,0.12)] border border-[#e8e8e8] p-4">
        <div class="flex items-center justify-between mb-3">
          <span class="text-sm font-semibold text-[#0d0d0d]">对话设置</span>
          <button
            class="text-[#999] hover:text-[#0d0d0d] transition-colors"
            @click="closeSettings"
          >
            <Icon name="x" :size="16" />
          </button>
        </div>

        <!-- Context Rounds -->
        <div class="mb-1">
          <div class="flex items-center justify-between mb-2">
            <label class="text-xs font-medium text-[#666]">上下文轮数</label>
            <span class="text-xs text-[#999]">0 = 不带上下文</span>
          </div>
          <div class="flex items-center gap-3">
            <input
              v-model.number="contextRounds"
              type="range"
              min="0"
              max="50"
              step="1"
              class="flex-1 h-1.5 bg-[#e5e5e5] rounded-full appearance-none cursor-pointer accent-[#0d0d0d]"
              @input="saveContextRounds"
            >
            <input
              v-model.number="contextRounds"
              type="number"
              min="0"
              max="100"
              class="w-14 px-2 py-1 text-sm text-center text-[#0d0d0d] bg-[#f4f4f4] border border-[#e3e3e3] rounded-lg outline-none focus:border-[#999]"
              @input="saveContextRounds"
            >
          </div>
          <p class="text-[11px] text-[#999] mt-1.5">
            每次发送消息时携带最近 {{ contextRounds }} 轮对话作为上下文
          </p>
        </div>
      </div>
    </div>

    <!-- Click outside to close -->
    <Teleport to="body">
      <div
        v-if="showSettings"
        class="fixed inset-0 z-[99]"
        @click="closeSettings"
      />
    </Teleport>
  </footer>
</template>

<style scoped>
/* Custom range slider thumb */
input[type="range"]::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #0d0d0d;
  cursor: pointer;
  border: 2px solid white;
  box-shadow: 0 1px 3px rgba(0,0,0,0.2);
}
input[type="range"]::-moz-range-thumb {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #0d0d0d;
  cursor: pointer;
  border: 2px solid white;
  box-shadow: 0 1px 3px rgba(0,0,0,0.2);
}
</style>
