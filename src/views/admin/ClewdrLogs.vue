<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { fetchClewdrLogs, fetchClewdrLogStats } from '@/api'

const loading = ref(false)
const logs = ref<any[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const stats = ref<any>(null)

// Filters
const filterModel = ref('')
const filterSessionId = ref('')
const filterDateFrom = ref('')
const filterDateTo = ref('')

async function loadLogs() {
  loading.value = true
  try {
    const params: any = { page: page.value, pageSize: pageSize.value }
    if (filterModel.value) params.model = filterModel.value
    if (filterSessionId.value) params.session_id = filterSessionId.value
    if (filterDateFrom.value) params.date_from = filterDateFrom.value
    if (filterDateTo.value) params.date_to = filterDateTo.value
    const res = await fetchClewdrLogs(params)
    logs.value = res.data || []
    total.value = res.total || 0
  } catch (e) { console.error(e) }
  loading.value = false
}

async function loadStats() {
  try {
    const params: any = {}
    if (filterDateFrom.value) params.date_from = filterDateFrom.value
    if (filterDateTo.value) params.date_to = filterDateTo.value
    stats.value = await fetchClewdrLogStats(params)
  } catch (e) { console.error(e) }
}

async function loadAll() {
  await Promise.all([loadLogs(), loadStats()])
}

onMounted(loadAll)

const totalPages = computed(() => Math.ceil(total.value / pageSize.value) || 1)

function prevPage() { if (page.value > 1) { page.value--; loadLogs() } }
function nextPage() { if (page.value < totalPages.value) { page.value++; loadLogs() } }
function applyFilter() { page.value = 1; loadAll() }
function resetFilter() {
  filterModel.value = ''
  filterSessionId.value = ''
  filterDateFrom.value = ''
  filterDateTo.value = ''
  page.value = 1
  loadAll()
}

function formatTokens(n: number) {
  if (!n) return '0'
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M'
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K'
  return String(n)
}

function formatDuration(ms: number) {
  if (ms < 1000) return ms + 'ms'
  return (ms / 1000).toFixed(1) + 's'
}
</script>

<template>
  <div class="flex-1 overflow-y-auto p-6">
    <div class="max-w-6xl mx-auto">
      <!-- Header -->
      <div class="flex items-center justify-between mb-6">
        <div>
          <h1 class="text-xl font-semibold text-[#18181b]">ClewdR 请求日志</h1>
          <p class="text-sm text-[#71717a] mt-0.5">所有经过 ClewdR 的请求记录 · 可与 NewAPI 对账</p>
        </div>
        <button class="btn-secondary" @click="loadAll" :disabled="loading">{{ loading ? '加载中...' : '🔄 刷新' }}</button>
      </div>

      <!-- Stats -->
      <div v-if="stats" class="grid grid-cols-5 gap-3 mb-6">
        <div class="bg-white rounded-xl border border-[#e5e7eb] px-4 py-3">
          <div class="text-[11px] text-[#71717a] font-medium">总请求</div>
          <div class="text-2xl font-semibold text-[#18181b] mt-0.5">{{ stats.total_requests || 0 }}</div>
        </div>
        <div class="bg-white rounded-xl border border-[#e5e7eb] px-4 py-3">
          <div class="text-[11px] text-[#71717a] font-medium">输入 Tokens</div>
          <div class="text-2xl font-semibold text-[#18181b] mt-0.5">{{ formatTokens(stats.total_input_tokens || 0) }}</div>
        </div>
        <div class="bg-white rounded-xl border border-[#e5e7eb] px-4 py-3">
          <div class="text-[11px] text-[#71717a] font-medium">输出 Tokens</div>
          <div class="text-2xl font-semibold text-[#18181b] mt-0.5">{{ formatTokens(stats.total_output_tokens || 0) }}</div>
        </div>
        <div class="bg-white rounded-xl border border-[#e5e7eb] px-4 py-3">
          <div class="text-[11px] text-[#71717a] font-medium">缓存读</div>
          <div class="text-2xl font-semibold text-emerald-600 mt-0.5">{{ formatTokens(stats.total_cache_read_tokens || 0) }}</div>
        </div>
        <div class="bg-white rounded-xl border border-[#e5e7eb] px-4 py-3">
          <div class="text-[11px] text-[#71717a] font-medium">缓存写</div>
          <div class="text-2xl font-semibold text-amber-600 mt-0.5">{{ formatTokens(stats.total_cache_write_tokens || 0) }}</div>
        </div>
      </div>

      <!-- Model breakdown -->
      <div v-if="stats?.models?.length" class="bg-white rounded-xl border border-[#e5e7eb] p-4 mb-6">
        <div class="text-xs font-medium text-[#71717a] mb-3">按模型统计</div>
        <div class="grid grid-cols-2 gap-3">
          <div v-for="m in stats.models" :key="m.model" class="flex items-center justify-between bg-[#fafafa] rounded-lg px-3 py-2">
            <span class="text-sm font-medium text-[#18181b]">{{ m.model || '未知' }}</span>
            <div class="flex gap-3 text-xs text-[#71717a]">
              <span>{{ m.count }}次</span>
              <span>↑{{ formatTokens(m.input_tokens) }}</span>
              <span>↓{{ formatTokens(m.output_tokens) }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Filters -->
      <div class="flex gap-2 mb-4 items-center">
        <input v-model="filterModel" class="px-3 py-1.5 text-xs border border-[#e5e7eb] rounded-lg bg-white outline-none w-40" placeholder="模型筛选" />
        <input v-model="filterSessionId" class="px-3 py-1.5 text-xs border border-[#e5e7eb] rounded-lg bg-white outline-none w-48" placeholder="Session ID" />
        <input v-model="filterDateFrom" type="date" class="px-3 py-1.5 text-xs border border-[#e5e7eb] rounded-lg bg-white outline-none" />
        <span class="text-xs text-[#a1a1aa]">至</span>
        <input v-model="filterDateTo" type="date" class="px-3 py-1.5 text-xs border border-[#e5e7eb] rounded-lg bg-white outline-none" />
        <button class="btn-primary" @click="applyFilter">筛选</button>
        <button class="btn-secondary" @click="resetFilter">重置</button>
      </div>

      <!-- Log Table -->
      <div class="bg-white rounded-xl border border-[#e5e7eb] overflow-hidden">
        <div class="px-5 py-3 border-b border-[#e5e7eb] text-xs font-medium text-[#71717a] grid grid-cols-[140px_120px_140px_70px_70px_70px_70px_70px] gap-2">
          <span>时间</span><span>模型</span><span>账号</span><span>输入</span><span>输出</span><span>缓存读</span><span>缓存写</span><span>耗时</span>
        </div>
        <div v-if="logs.length === 0" class="px-5 py-8 text-center text-sm text-[#a1a1aa]">
          {{ loading ? '加载中...' : '暂无日志' }}
        </div>
        <div v-for="log in logs" :key="log.id" class="grid grid-cols-[140px_120px_140px_70px_70px_70px_70px_70px] gap-2 px-5 py-2.5 items-center text-xs border-t border-[#f0f0f0] hover:bg-[#fafafa]">
          <span class="text-[#52525b]">{{ log.created_at }}</span>
          <span class="font-medium text-[#18181b] truncate">{{ log.model }}</span>
          <span class="text-[#71717a] truncate" :title="log.cookie_email">{{ log.cookie_email || '-' }}</span>
          <span class="text-[#18181b]">{{ formatTokens(log.input_tokens) }}</span>
          <span class="text-[#18181b]">{{ formatTokens(log.output_tokens) }}</span>
          <span class="text-emerald-600">{{ formatTokens(log.cache_read_tokens) }}</span>
          <span class="text-amber-600">{{ formatTokens(log.cache_write_tokens) }}</span>
          <span class="text-[#71717a]">{{ formatDuration(log.duration_ms) }}</span>
        </div>
      </div>

      <!-- Pagination -->
      <div class="flex items-center justify-between mt-4">
        <span class="text-xs text-[#71717a]">共 {{ total }} 条</span>
        <div class="flex gap-2">
          <button class="btn-secondary" :disabled="page <= 1" @click="prevPage">上一页</button>
          <span class="text-xs text-[#52525b] leading-8">{{ page }} / {{ totalPages }}</span>
          <button class="btn-secondary" :disabled="page >= totalPages" @click="nextPage">下一页</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.btn-primary { @apply inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-[#18181b] text-white rounded-md hover:bg-[#27272a] transition-colors disabled:opacity-50 disabled:cursor-not-allowed; }
.btn-secondary { @apply inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-[#e5e7eb] text-[#52525b] rounded-md hover:bg-[#f4f4f5] transition-colors disabled:opacity-50; }
</style>
