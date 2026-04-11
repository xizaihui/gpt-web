<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { fetchClewdrCookies } from '@/api'
import Icon from '@/components/common/Icon.vue'
import UsageTrendChart from './components/UsageTrendChart.vue'
import ModelDistributionPie from './components/ModelDistributionPie.vue'
import AlertList from './components/AlertList.vue'
import QuotaProgressBar from './components/QuotaProgressBar.vue'

const cookieData = ref<any>({ valid: [], exhausted: [], invalid: [] })
const loading = ref(false)

async function load() {
  loading.value = true
  try { cookieData.value = await fetchClewdrCookies() }
  catch (e) { console.error(e) }
  loading.value = false
}
onMounted(load)

const stats = computed(() => {
  const valid = (cookieData.value.valid || []).length
  const exhausted = (cookieData.value.exhausted || []).length
  const invalid = (cookieData.value.invalid || []).length
  const total = valid + exhausted + invalid
  const allValid = cookieData.value.valid || []
  const avg = allValid.length
    ? allValid.reduce((s: number, c: any) => s + (c.session_utilization || 0), 0) / allValid.length
    : 0
  return { total, healthy: valid, exhausted, invalid, avgUsage: Math.round(avg) }
})

const providerDist = computed(() => [
  { name: 'Claude', value: stats.value.total, color: '#18181b' },
  { name: 'Codex', value: 0, color: '#6366f1' },
  { name: 'Gemini', value: 0, color: '#22c55e' },
  { name: 'Kiro', value: 0, color: '#f59e0b' },
])

const recentAudits = [
  { time: '11:42', user: 'admin', action: '批量添加 Cookie', target: '3 个账号', level: 'info' },
  { time: '11:15', user: 'admin', action: '禁用账号', target: 'sk-ant-…a3f2', level: 'warn' },
  { time: '10:58', user: 'admin', action: '更新代理', target: 'proxy-hk-01', level: 'info' },
  { time: '09:20', user: 'system', action: '自动重置额度', target: '5 个账号', level: 'info' },
  { time: '08:03', user: 'admin', action: '登录', target: '127.0.0.1', level: 'info' },
]

</script>

<template>
  <div class="p-6 space-y-5">
    <!-- Stat cards -->
    <div class="grid grid-cols-4 gap-4">
      <div class="rounded-xl border border-[#e5e7eb] bg-white p-5">
        <div class="flex items-center justify-between">
          <span class="text-xs text-[#71717a]">总账号数</span>
          <Icon name="users" :size="14" class="text-[#a1a1aa]" />
        </div>
        <div class="mt-2 text-2xl font-semibold text-[#18181b] tabular-nums">{{ stats.total }}</div>
        <div class="mt-1 text-[11px] text-[#a1a1aa]">Claude · 全部状态</div>
      </div>
      <div class="rounded-xl border border-[#e5e7eb] bg-white p-5">
        <div class="flex items-center justify-between">
          <span class="text-xs text-[#71717a]">健康账号</span>
          <Icon name="check-circle" :size="14" class="text-[#16a34a]" />
        </div>
        <div class="mt-2 text-2xl font-semibold text-[#16a34a] tabular-nums">{{ stats.healthy }}</div>
        <div class="mt-1 text-[11px] text-[#a1a1aa]">可用率 {{ stats.total ? Math.round(stats.healthy / stats.total * 100) : 0 }}%</div>
      </div>
      <div class="rounded-xl border border-[#e5e7eb] bg-white p-5">
        <div class="flex items-center justify-between">
          <span class="text-xs text-[#71717a]">平均使用率</span>
          <Icon name="activity" :size="14" class="text-[#a1a1aa]" />
        </div>
        <div class="mt-2 text-2xl font-semibold text-[#18181b] tabular-nums">{{ stats.avgUsage }}%</div>
        <div class="mt-3"><QuotaProgressBar :value="stats.avgUsage" :show-text="false" :height="5" /></div>
      </div>
      <div class="rounded-xl border border-[#e5e7eb] bg-white p-5">
        <div class="flex items-center justify-between">
          <span class="text-xs text-[#71717a]">异常告警</span>
          <Icon name="alert-triangle" :size="14" class="text-[#d97706]" />
        </div>
        <div class="mt-2 text-2xl font-semibold text-[#dc2626] tabular-nums">{{ stats.invalid + stats.exhausted }}</div>
        <div class="mt-1 text-[11px] text-[#a1a1aa]">{{ stats.exhausted }} 耗尽 · {{ stats.invalid }} 失效</div>
      </div>
    </div>

    <!-- Main grid -->
    <div class="grid grid-cols-3 gap-4">
      <!-- Trend -->
      <div class="col-span-2 rounded-xl border border-[#e5e7eb] bg-white p-5">
        <UsageTrendChart :height="220" />
      </div>
      <!-- Provider dist -->
      <div class="rounded-xl border border-[#e5e7eb] bg-white p-5">
        <div class="text-sm font-medium text-[#18181b] mb-3">Provider 分布</div>
        <ModelDistributionPie :data="providerDist" :size="150" />
      </div>
    </div>

    <div class="grid grid-cols-3 gap-4">
      <!-- Recent audit -->
      <div class="col-span-2 rounded-xl border border-[#e5e7eb] bg-white p-5">
        <div class="flex items-center justify-between mb-3">
          <div class="text-sm font-medium text-[#18181b]">最近操作</div>
          <button class="text-[11px] text-[#71717a] hover:text-[#18181b]">查看全部 →</button>
        </div>
        <div class="divide-y divide-[#f4f4f5]">
          <div v-for="(a, i) in recentAudits" :key="i" class="flex items-center gap-3 py-2.5 text-xs">
            <span class="text-[#a1a1aa] tabular-nums w-10">{{ a.time }}</span>
            <span class="px-1.5 py-0.5 rounded text-[10px] bg-[#f4f4f5] text-[#71717a] font-medium">{{ a.user }}</span>
            <span class="text-[#18181b] flex-1">{{ a.action }}</span>
            <span class="text-[#71717a] font-mono text-[10px]">{{ a.target }}</span>
          </div>
        </div>
        <p class="mt-2 text-[10px] text-[#a1a1aa]">* 示例数据,后端审计接口开发中</p>
      </div>
      <!-- Alerts -->
      <div class="rounded-xl border border-[#e5e7eb] bg-white p-5">
        <div class="flex items-center justify-between mb-3">
          <div class="text-sm font-medium text-[#18181b]">告警</div>
          <span class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] bg-[#fef2f2] text-[#dc2626] font-medium">5</span>
        </div>
        <AlertList />
      </div>
    </div>
  </div>
</template>
