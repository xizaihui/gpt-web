<script setup lang="ts">
import { ref } from 'vue'
import Icon from '@/components/common/Icon.vue'

const section = ref<'general' | 'alerts' | 'pool' | 'about'>('general')

// Mock 本地状态,暂不对接接口
const form = ref({
  siteName: 'ChatGPT Web',
  theme: 'auto',
  autoRefreshSec: 30,
  alertSessionThreshold: 80,
  alertWeeklyThreshold: 70,
  alertOnTokenExpire: true,
  poolHealthCheckSec: 300,
  poolAutoDisableErrorCount: 5,
})

function save() {
  alert('设置已保存 (示例,未对接后端接口)')
}

const sections = [
  { key: 'general', label: '通用', icon: 'settings' },
  { key: 'alerts', label: '告警阈值', icon: 'bell' },
  { key: 'pool', label: '账号池策略', icon: 'users' },
  { key: 'about', label: '关于', icon: 'info' },
] as const
</script>

<template>
  <div class="p-6">
    <div class="flex gap-5">
      <!-- Side nav -->
      <aside class="w-48 flex-shrink-0">
        <div class="text-xs font-medium text-[#71717a] px-2 pb-2">系统设置</div>
        <nav class="space-y-0.5">
          <button
            v-for="s in sections"
            :key="s.key"
            class="flex items-center gap-2 w-full rounded-md px-2.5 py-2 text-xs transition-colors"
            :class="section === s.key
              ? 'bg-[#f4f4f5] text-[#18181b] font-medium'
              : 'text-[#71717a] hover:text-[#18181b] hover:bg-[#f4f4f5]'"
            @click="section = s.key"
          >
            <Icon :name="s.icon" :size="13" />
            {{ s.label }}
          </button>
        </nav>
      </aside>

      <!-- Content -->
      <div class="flex-1 max-w-2xl">
        <div class="rounded-xl border border-[#e5e7eb] bg-white">
          <div class="px-5 py-4 border-b border-[#e5e7eb]">
            <h3 class="text-sm font-semibold text-[#18181b]">
              {{ sections.find(s => s.key === section)?.label }}
            </h3>
          </div>
          <div class="p-5 space-y-5">
            <!-- General -->
            <template v-if="section === 'general'">
              <div>
                <label class="block text-xs font-medium text-[#18181b] mb-1">站点名称</label>
                <input v-model="form.siteName" class="w-full px-3 py-1.5 text-xs rounded-md border border-[#e5e7eb] focus:outline-none focus:border-[#18181b]">
              </div>
              <div>
                <label class="block text-xs font-medium text-[#18181b] mb-1">主题</label>
                <select v-model="form.theme" class="w-full px-3 py-1.5 text-xs rounded-md border border-[#e5e7eb] bg-white focus:outline-none focus:border-[#18181b]">
                  <option value="auto">跟随系统</option>
                  <option value="light">浅色</option>
                  <option value="dark">深色</option>
                </select>
              </div>
              <div>
                <label class="block text-xs font-medium text-[#18181b] mb-1">自动刷新间隔 (秒)</label>
                <input v-model.number="form.autoRefreshSec" type="number" class="w-full px-3 py-1.5 text-xs rounded-md border border-[#e5e7eb] focus:outline-none focus:border-[#18181b]">
                <p class="mt-1 text-[10px] text-[#a1a1aa]">仪表盘和账号池页面的自动刷新周期</p>
              </div>
            </template>

            <!-- Alerts -->
            <template v-else-if="section === 'alerts'">
              <div>
                <label class="block text-xs font-medium text-[#18181b] mb-1">Session 使用率告警阈值 (%)</label>
                <input v-model.number="form.alertSessionThreshold" type="number" min="0" max="100" class="w-full px-3 py-1.5 text-xs rounded-md border border-[#e5e7eb] focus:outline-none focus:border-[#18181b]">
                <p class="mt-1 text-[10px] text-[#a1a1aa]">单账号 session 使用率超过此值触发告警</p>
              </div>
              <div>
                <label class="block text-xs font-medium text-[#18181b] mb-1">7 日使用率告警阈值 (%)</label>
                <input v-model.number="form.alertWeeklyThreshold" type="number" min="0" max="100" class="w-full px-3 py-1.5 text-xs rounded-md border border-[#e5e7eb] focus:outline-none focus:border-[#18181b]">
              </div>
              <label class="flex items-center gap-2 text-xs text-[#18181b] cursor-pointer">
                <input v-model="form.alertOnTokenExpire" type="checkbox" class="rounded border-[#d4d4d8]">
                Token 失效时告警
              </label>
            </template>

            <!-- Pool -->
            <template v-else-if="section === 'pool'">
              <div>
                <label class="block text-xs font-medium text-[#18181b] mb-1">健康检查间隔 (秒)</label>
                <input v-model.number="form.poolHealthCheckSec" type="number" class="w-full px-3 py-1.5 text-xs rounded-md border border-[#e5e7eb] focus:outline-none focus:border-[#18181b]">
              </div>
              <div>
                <label class="block text-xs font-medium text-[#18181b] mb-1">自动禁用错误次数阈值</label>
                <input v-model.number="form.poolAutoDisableErrorCount" type="number" class="w-full px-3 py-1.5 text-xs rounded-md border border-[#e5e7eb] focus:outline-none focus:border-[#18181b]">
                <p class="mt-1 text-[10px] text-[#a1a1aa]">连续错误超过此次数后自动禁用账号</p>
              </div>
            </template>

            <!-- About -->
            <template v-else>
              <div class="space-y-3 text-xs">
                <div class="flex justify-between border-b border-[#f4f4f5] pb-2">
                  <span class="text-[#71717a]">版本</span>
                  <span class="text-[#18181b] font-mono">Admin V2 · Preview</span>
                </div>
                <div class="flex justify-between border-b border-[#f4f4f5] pb-2">
                  <span class="text-[#71717a]">构建阶段</span>
                  <span class="text-[#18181b]">阶段 4 · UI 原型</span>
                </div>
                <div class="flex justify-between border-b border-[#f4f4f5] pb-2">
                  <span class="text-[#71717a]">数据源</span>
                  <span class="text-[#18181b]">Claude: 真实 API · 其他: Mock</span>
                </div>
                <div class="text-[11px] text-[#a1a1aa] pt-2 leading-relaxed">
                  本页面为新版 Admin 界面预览,用于快速验证 UI 效果。部分数据(模型分布、使用历史、事件、审计日志)目前使用示例数据,待后端接口(阶段 2/3)就绪后切换为真实数据。
                </div>
              </div>
            </template>
          </div>
          <div v-if="section !== 'about'" class="flex justify-end gap-2 px-5 py-3 border-t border-[#e5e7eb] bg-[#fafafa] rounded-b-xl">
            <button class="px-3 py-1.5 text-xs rounded-md border border-[#e5e7eb] text-[#71717a] hover:text-[#18181b]">重置</button>
            <button class="px-3 py-1.5 text-xs rounded-md bg-[#18181b] text-white hover:bg-[#27272a]" @click="save">保存</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
