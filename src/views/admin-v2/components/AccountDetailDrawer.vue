<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import QuotaProgressBar from './QuotaProgressBar.vue'
import ResetCountdown from './ResetCountdown.vue'
import UsageTrendChart from './UsageTrendChart.vue'
import ModelDistributionPie from './ModelDistributionPie.vue'

const props = defineProps<{ show: boolean; account?: any }>()
const emit = defineEmits<{ (e: 'update:show', v: boolean): void }>()

const tab = ref<'basic' | 'quota' | 'model' | 'history' | 'events'>('basic')

watch(() => props.show, (v) => { if (v) tab.value = 'basic' })

function close() { emit('update:show', false) }

function mask(s: string | undefined) {
  if (!s) return '—'
  if (s.length <= 12) return s
  return `${s.slice(0, 10)}…${s.slice(-6)}`
}

const account = computed(() => props.account || {})
const session = computed(() => Number(account.value.session_utilization || 0))
const weekly = computed(() => Number(account.value.seven_day_utilization || 0))

const tabs = [
  { key: 'basic', label: '基本信息' },
  { key: 'quota', label: '额度' },
  { key: 'model', label: '模型分布' },
  { key: 'history', label: '使用历史' },
  { key: 'events', label: '事件' },
] as const

const mockHistory = Array.from({ length: 12 }, (_, i) => ({
  id: i,
  time: `2026-04-${10 - Math.floor(i / 4)} ${String(23 - i).padStart(2, '0')}:${String((i * 7) % 60).padStart(2, '0')}`,
  model: ['claude-opus-4', 'claude-sonnet-4', 'claude-haiku-4'][i % 3],
  tokens: 1200 + i * 180,
  status: i % 5 === 0 ? 'error' : 'ok',
}))

const mockEvents = [
  { time: '2026-04-10 14:32', type: 'quota-reset', title: '额度自动重置', desc: 'session 使用率归零' },
  { time: '2026-04-09 08:15', type: 'enable', title: '账号启用', desc: '手动启用' },
  { time: '2026-04-08 22:01', type: 'error', title: 'API 错误', desc: 'rate_limit_error x3' },
  { time: '2026-04-05 10:00', type: 'create', title: '账号创建', desc: '通过批量导入添加' },
]
</script>

<template>
  <Teleport to="body">
    <div v-if="show" class="fixed inset-0 z-50">
      <div class="absolute inset-0 bg-black/30" @click="close" />
      <aside class="absolute right-0 top-0 bottom-0 w-[600px] max-w-[95vw] bg-white shadow-2xl border-l border-[#e5e7eb] flex flex-col">
        <div class="flex items-center justify-between px-5 py-4 border-b border-[#e5e7eb]">
          <div>
            <h3 class="text-base font-semibold text-[#18181b]">账号详情</h3>
            <p class="text-xs text-[#71717a] font-mono mt-0.5">{{ mask(account.cookie || account.label || account.id) }}</p>
          </div>
          <button class="text-[#71717a] hover:text-[#18181b] text-lg leading-none" @click="close">×</button>
        </div>
        <div class="flex items-center gap-1 px-5 pt-3 border-b border-[#e5e7eb]">
          <button
            v-for="t in tabs"
            :key="t.key"
            class="px-3 py-2 text-xs font-medium border-b-2 transition-colors -mb-px"
            :class="tab === t.key
              ? 'border-[#18181b] text-[#18181b]'
              : 'border-transparent text-[#71717a] hover:text-[#18181b]'"
            @click="tab = t.key"
          >{{ t.label }}</button>
        </div>
        <div class="flex-1 overflow-y-auto p-5">
          <!-- Basic -->
          <div v-if="tab === 'basic'" class="space-y-3">
            <div v-for="(v, k) in (account || {})" :key="k" class="flex items-start gap-3 text-xs py-2 border-b border-[#f4f4f5]">
              <span class="w-32 text-[#71717a] flex-shrink-0">{{ k }}</span>
              <span class="flex-1 text-[#18181b] font-mono break-all">{{ typeof v === 'object' ? JSON.stringify(v) : String(v) }}</span>
            </div>
          </div>
          <!-- Quota -->
          <div v-else-if="tab === 'quota'" class="space-y-4">
            <div class="grid grid-cols-2 gap-3">
              <div class="rounded-lg border border-[#e5e7eb] p-4">
                <div class="text-xs text-[#71717a] mb-1">Session 使用率</div>
                <div class="text-2xl font-semibold text-[#18181b] tabular-nums">{{ session.toFixed(0) }}%</div>
                <div class="mt-3"><QuotaProgressBar :value="session" :show-text="false" :height="6" /></div>
              </div>
              <div class="rounded-lg border border-[#e5e7eb] p-4">
                <div class="text-xs text-[#71717a] mb-1">7 日使用率</div>
                <div class="text-2xl font-semibold text-[#18181b] tabular-nums">{{ weekly.toFixed(0) }}%</div>
                <div class="mt-3"><QuotaProgressBar :value="weekly" :show-text="false" :height="6" /></div>
              </div>
            </div>
            <div class="rounded-lg border border-[#e5e7eb] p-4">
              <div class="flex items-center justify-between mb-2">
                <div class="text-xs text-[#71717a]">重置倒计时</div>
                <ResetCountdown :reset-at="account.reset_at" />
              </div>
            </div>
            <div class="rounded-lg border border-[#e5e7eb] p-4">
              <UsageTrendChart />
            </div>
          </div>
          <!-- Model -->
          <div v-else-if="tab === 'model'">
            <div class="rounded-lg border border-[#e5e7eb] p-5">
              <ModelDistributionPie />
            </div>
            <p class="mt-3 text-[10px] text-[#a1a1aa]">* 当前数据为示例,后端聚合接口开发中</p>
          </div>
          <!-- History -->
          <div v-else-if="tab === 'history'">
            <div class="rounded-lg border border-[#e5e7eb] overflow-hidden">
              <table class="w-full text-xs">
                <thead class="bg-[#fafafa] text-[#71717a]">
                  <tr>
                    <th class="text-left px-3 py-2 font-medium">时间</th>
                    <th class="text-left px-3 py-2 font-medium">模型</th>
                    <th class="text-right px-3 py-2 font-medium">Tokens</th>
                    <th class="text-right px-3 py-2 font-medium">状态</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="h in mockHistory" :key="h.id" class="border-t border-[#f4f4f5]">
                    <td class="px-3 py-2 text-[#71717a] tabular-nums">{{ h.time }}</td>
                    <td class="px-3 py-2 text-[#18181b]">{{ h.model }}</td>
                    <td class="px-3 py-2 text-right text-[#18181b] tabular-nums">{{ h.tokens.toLocaleString() }}</td>
                    <td class="px-3 py-2 text-right">
                      <span
                        class="inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium"
                        :class="h.status === 'ok' ? 'bg-[#f0fdf4] text-[#16a34a]' : 'bg-[#fef2f2] text-[#dc2626]'"
                      >{{ h.status }}</span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p class="mt-3 text-[10px] text-[#a1a1aa]">* 示例数据,后端接口开发中</p>
          </div>
          <!-- Events -->
          <div v-else-if="tab === 'events'" class="space-y-0">
            <div v-for="(ev, i) in mockEvents" :key="i" class="relative pl-6 pb-5">
              <span class="absolute left-0 top-1 w-2.5 h-2.5 rounded-full bg-[#18181b] border-2 border-white ring-2 ring-[#e5e7eb]" />
              <span v-if="i < mockEvents.length - 1" class="absolute left-[4px] top-4 bottom-0 w-px bg-[#e5e7eb]" />
              <div class="text-[10px] text-[#a1a1aa] tabular-nums">{{ ev.time }}</div>
              <div class="mt-0.5 text-sm font-medium text-[#18181b]">{{ ev.title }}</div>
              <div class="text-xs text-[#71717a]">{{ ev.desc }}</div>
            </div>
            <p class="text-[10px] text-[#a1a1aa]">* 示例数据</p>
          </div>
        </div>
      </aside>
    </div>
  </Teleport>
</template>
