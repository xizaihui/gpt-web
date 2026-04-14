<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import Icon from '@/components/common/Icon.vue'
import { fetchClewdrLogs, fetchClewdrLogStats } from '@/api'

// Data
const logs = ref<any[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(30)
const loading = ref(false)
const stats = ref<any>(null)
const statsLoading = ref(false)

// Filters
const filterModel = ref('')
const filterSessionId = ref('')
const filterDateFrom = ref('')
const filterDateTo = ref('')

// Header detail drawer
const showHeaders = ref(false)
const currentHeaders = ref<Record<string, string>>({})
const currentLogId = ref(0)

// Auto-refresh
const autoRefresh = ref(false)
let refreshTimer: ReturnType<typeof setInterval> | null = null

async function load() {
  loading.value = true
  try {
    const params: Record<string, any> = {
      page: String(page.value),
      pageSize: String(pageSize.value),
    }
    if (filterModel.value) params.model = filterModel.value
    if (filterSessionId.value) params.session_id = filterSessionId.value
    if (filterDateFrom.value) params.date_from = filterDateFrom.value
    if (filterDateTo.value) params.date_to = filterDateTo.value
    const data = await fetchClewdrLogs(params)
    logs.value = data.data || []
    total.value = data.total || 0
  } catch (e: any) {
    console.error('Failed to load logs:', e)
  }
  loading.value = false
}

async function loadStats() {
  statsLoading.value = true
  try {
    const params: Record<string, any> = {}
    if (filterDateFrom.value) params.date_from = filterDateFrom.value
    if (filterDateTo.value) params.date_to = filterDateTo.value
    stats.value = await fetchClewdrLogStats(params)
  } catch (e: any) {
    console.error('Failed to load stats:', e)
  }
  statsLoading.value = false
}

function search() {
  page.value = 1
  load()
  loadStats()
}

function resetFilters() {
  filterModel.value = ''
  filterSessionId.value = ''
  filterDateFrom.value = ''
  filterDateTo.value = ''
  search()
}

function goPage(p: number) {
  page.value = p
  load()
}

function openHeaders(row: any) {
  currentLogId.value = row.id
  try {
    currentHeaders.value = row.request_headers ? JSON.parse(row.request_headers) : {}
  } catch {
    currentHeaders.value = { _raw: row.request_headers || '(empty)' }
  }
  showHeaders.value = true
}

// Formatting helpers
function fmtTokens(v: number) {
  if (!v) return '0'
  if (v >= 1000000) return `${(v / 1000000).toFixed(1)}M`
  if (v >= 1000) return `${(v / 1000).toFixed(1)}K`
  return String(v)
}

function fmtDuration(ms: number) {
  if (!ms) return '-'
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function fmtTime(t: string) {
  if (!t) return '-'
  // "2026-04-14 01:22:04" → show as-is (already UTC from ClewdR)
  return t
}

function formatBadge(f: string) {
  if (!f) return { text: '?', cls: 'bg-[#f4f4f5] text-[#71717a] border-[#e5e7eb]' }
  if (f === 'OpenAI') return { text: 'OAI', cls: 'bg-[#eef2ff] text-[#6366f1] border-[#c7d2fe]' }
  return { text: 'Claude', cls: 'bg-[#fef3c7] text-[#d97706] border-[#fde68a]' }
}

function modelBadge(m: string) {
  if (!m) return 'bg-[#f4f4f5] text-[#71717a]'
  const ml = m.toLowerCase()
  if (ml.includes('opus')) return 'bg-[#fef2f2] text-[#dc2626]'
  if (ml.includes('sonnet')) return 'bg-[#ecfdf5] text-[#059669]'
  if (ml.includes('haiku')) return 'bg-[#eff6ff] text-[#2563eb]'
  return 'bg-[#f4f4f5] text-[#71717a]'
}

// Detect request format from headers
function detectFormat(row: any): string {
  if (!row.request_headers) return row.api_format || '?'
  try {
    const h = JSON.parse(row.request_headers)
    const ua = (h['user-agent'] || '').toLowerCase()
    const hasAnthropicVersion = !!h['anthropic-version']
    const parts: string[] = []
    // API format
    parts.push(row.api_format || '?')
    // Client hint
    if (ua.includes('go-http-client')) parts.push('Go/NewAPI')
    else if (ua.includes('python')) parts.push('Python')
    else if (ua.includes('node') || ua.includes('axios')) parts.push('Node')
    else if (ua.includes('curl')) parts.push('curl')
    else if (ua) parts.push(ua.split('/')[0])
    return parts.join(' · ')
  } catch { return row.api_format || '?' }
}

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)))

const pageRange = computed(() => {
  const t = totalPages.value
  const c = page.value
  const range: number[] = []
  const start = Math.max(1, c - 2)
  const end = Math.min(t, c + 2)
  for (let i = start; i <= end; i++) range.push(i)
  return range
})

// Stats summary
const statsSummary = computed(() => {
  if (!stats.value) return null
  return {
    totalRequests: stats.value.total_requests || 0,
    totalInput: stats.value.total_input_tokens || 0,
    totalOutput: stats.value.total_output_tokens || 0,
    totalCacheRead: stats.value.total_cache_read_tokens || 0,
    totalCacheWrite: stats.value.total_cache_write_tokens || 0,
    models: stats.value.models || [],
  }
})

// Auto-refresh toggle
watch(autoRefresh, (v) => {
  if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null }
  if (v) {
    refreshTimer = setInterval(() => load(), 10000)
  }
})

onMounted(() => {
  load()
  loadStats()
})
</script>

<template>
  <div class="p-6 space-y-4 overflow-y-auto h-full">
    <!-- Header -->
    <div class="flex items-center justify-between">
      <div>
        <h2 class="text-base font-semibold text-[#18181b]">请求日志</h2>
        <p class="text-xs text-[#71717a] mt-0.5">ClewdR 所有 API 请求记录，含 Headers 详情</p>
      </div>
      <div class="flex items-center gap-2">
        <button
          class="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border transition-colors"
          :class="autoRefresh ? 'bg-[#ecfdf5] text-[#059669] border-[#a7f3d0]' : 'bg-white text-[#71717a] border-[#e5e7eb] hover:border-[#18181b]'"
          @click="autoRefresh = !autoRefresh"
        >
          <span class="w-1.5 h-1.5 rounded-full" :class="autoRefresh ? 'bg-[#059669] animate-pulse' : 'bg-[#d4d4d8]'" />
          {{ autoRefresh ? '自动刷新中' : '自动刷新' }}
        </button>
        <button
          class="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border border-[#e5e7eb] bg-white text-[#71717a] hover:text-[#18181b] hover:border-[#18181b] transition-colors"
          @click="load(); loadStats()"
        >
          <Icon name="refresh-cw" :size="12" />
          刷新
        </button>
      </div>
    </div>

    <!-- Stats Cards -->
    <div v-if="statsSummary" class="grid grid-cols-5 gap-3">
      <div class="rounded-lg border border-[#e5e7eb] bg-white px-4 py-3">
        <div class="text-[10px] text-[#a1a1aa] uppercase tracking-wider">总请求</div>
        <div class="text-lg font-semibold text-[#18181b] mt-0.5">{{ fmtTokens(statsSummary.totalRequests) }}</div>
      </div>
      <div class="rounded-lg border border-[#e5e7eb] bg-white px-4 py-3">
        <div class="text-[10px] text-[#a1a1aa] uppercase tracking-wider">输入 Tokens</div>
        <div class="text-lg font-semibold text-[#18181b] mt-0.5">{{ fmtTokens(statsSummary.totalInput) }}</div>
      </div>
      <div class="rounded-lg border border-[#e5e7eb] bg-white px-4 py-3">
        <div class="text-[10px] text-[#a1a1aa] uppercase tracking-wider">输出 Tokens</div>
        <div class="text-lg font-semibold text-[#18181b] mt-0.5">{{ fmtTokens(statsSummary.totalOutput) }}</div>
      </div>
      <div class="rounded-lg border border-[#e5e7eb] bg-white px-4 py-3">
        <div class="text-[10px] text-[#a1a1aa] uppercase tracking-wider">缓存读取</div>
        <div class="text-lg font-semibold text-[#059669] mt-0.5">{{ fmtTokens(statsSummary.totalCacheRead) }}</div>
      </div>
      <div class="rounded-lg border border-[#e5e7eb] bg-white px-4 py-3">
        <div class="text-[10px] text-[#a1a1aa] uppercase tracking-wider">缓存写入</div>
        <div class="text-lg font-semibold text-[#d97706] mt-0.5">{{ fmtTokens(statsSummary.totalCacheWrite) }}</div>
      </div>
    </div>

    <!-- Model Distribution -->
    <div v-if="statsSummary && statsSummary.models.length" class="rounded-xl border border-[#e5e7eb] bg-white">
      <div class="px-4 py-2.5 border-b border-[#e5e7eb]">
        <span class="text-xs font-medium text-[#18181b]">模型分布</span>
      </div>
      <div class="flex flex-wrap gap-2 px-4 py-3">
        <div
          v-for="m in statsSummary.models" :key="m.model"
          class="flex items-center gap-2 px-3 py-1.5 rounded-md border border-[#e5e7eb] bg-[#fafafa] text-xs"
        >
          <span class="font-medium text-[#18181b]">{{ m.model || '(unknown)' }}</span>
          <span class="text-[#a1a1aa]">×{{ m.count }}</span>
          <span class="text-[#71717a]">{{ fmtTokens(m.input_tokens) }}↓ {{ fmtTokens(m.output_tokens) }}↑</span>
        </div>
      </div>
    </div>

    <!-- Filters -->
    <div class="rounded-xl border border-[#e5e7eb] bg-white">
      <div class="flex items-center gap-2 px-4 py-3 flex-wrap">
        <div class="relative flex-shrink-0" style="width: 160px">
          <Icon name="search" :size="14" class="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#a1a1aa]" />
          <input
            v-model="filterModel"
            type="text"
            placeholder="模型名..."
            class="w-full pl-8 pr-3 py-1.5 text-xs rounded-md border border-[#e5e7eb] focus:outline-none focus:border-[#18181b]"
            @keyup.enter="search"
          >
        </div>
        <input
          v-model="filterSessionId"
          type="text"
          placeholder="Session ID..."
          class="px-3 py-1.5 text-xs rounded-md border border-[#e5e7eb] focus:outline-none focus:border-[#18181b]"
          style="width: 180px"
          @keyup.enter="search"
        >
        <input
          v-model="filterDateFrom"
          type="date"
          class="px-2.5 py-1.5 text-xs rounded-md border border-[#e5e7eb] focus:outline-none focus:border-[#18181b]"
        >
        <span class="text-xs text-[#a1a1aa]">至</span>
        <input
          v-model="filterDateTo"
          type="date"
          class="px-2.5 py-1.5 text-xs rounded-md border border-[#e5e7eb] focus:outline-none focus:border-[#18181b]"
        >
        <button
          class="px-3 py-1.5 text-xs rounded-md bg-[#18181b] text-white hover:bg-[#27272a] transition-colors"
          @click="search"
        >搜索</button>
        <button
          class="px-3 py-1.5 text-xs rounded-md border border-[#e5e7eb] text-[#71717a] hover:text-[#18181b] hover:border-[#18181b] transition-colors"
          @click="resetFilters"
        >重置</button>
        <div class="flex-1" />
        <span class="text-[11px] text-[#a1a1aa]">共 {{ total }} 条</span>
      </div>
    </div>

    <!-- Table -->
    <div class="rounded-xl border border-[#e5e7eb] bg-white overflow-hidden">
      <div v-if="loading" class="flex items-center justify-center py-12">
        <Icon name="loader" :size="20" class="text-[#a1a1aa] animate-spin" />
        <span class="ml-2 text-xs text-[#a1a1aa]">加载中...</span>
      </div>
      <div v-else class="overflow-x-auto">
        <table class="w-full text-xs">
          <thead class="bg-[#fafafa] text-[#71717a] sticky top-0">
            <tr>
              <th class="px-3 py-2.5 text-left font-medium w-40">时间</th>
              <th class="px-3 py-2.5 text-left font-medium w-36">模型</th>
              <th class="px-3 py-2.5 text-left font-medium w-28">格式 / 客户端</th>
              <th class="px-3 py-2.5 text-left font-medium w-36">Cookie</th>
              <th class="px-3 py-2.5 text-right font-medium w-16">输入</th>
              <th class="px-3 py-2.5 text-right font-medium w-16">输出</th>
              <th class="px-3 py-2.5 text-right font-medium w-16">缓存读</th>
              <th class="px-3 py-2.5 text-right font-medium w-16">缓存写</th>
              <th class="px-3 py-2.5 text-right font-medium w-16">耗时</th>
              <th class="px-3 py-2.5 text-center font-medium w-16">Headers</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in logs" :key="row.id"
              class="border-t border-[#f4f4f5] hover:bg-[#fafafa] transition-colors"
            >
              <td class="px-3 py-2 text-[#71717a] tabular-nums font-mono text-[10px]">{{ fmtTime(row.created_at) }}</td>
              <td class="px-3 py-2">
                <span class="inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium" :class="modelBadge(row.model)">
                  {{ row.model || '-' }}
                </span>
              </td>
              <td class="px-3 py-2">
                <span class="inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium border" :class="formatBadge(row.api_format).cls">
                  {{ detectFormat(row) }}
                </span>
              </td>
              <td class="px-3 py-2 text-[#71717a] font-mono text-[10px] truncate max-w-[140px]" :title="row.cookie_email">
                {{ row.cookie_email || '-' }}
              </td>
              <td class="px-3 py-2 text-right tabular-nums text-[#18181b]">{{ fmtTokens(row.input_tokens) }}</td>
              <td class="px-3 py-2 text-right tabular-nums text-[#18181b]">{{ fmtTokens(row.output_tokens) }}</td>
              <td class="px-3 py-2 text-right tabular-nums text-[#059669]">{{ fmtTokens(row.cache_read_tokens) }}</td>
              <td class="px-3 py-2 text-right tabular-nums text-[#d97706]">{{ fmtTokens(row.cache_write_tokens) }}</td>
              <td class="px-3 py-2 text-right tabular-nums text-[#71717a]">{{ fmtDuration(row.duration_ms) }}</td>
              <td class="px-3 py-2 text-center">
                <button
                  v-if="row.request_headers"
                  class="inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium bg-[#eef2ff] text-[#6366f1] border border-[#c7d2fe] hover:bg-[#e0e7ff] transition-colors"
                  @click="openHeaders(row)"
                >
                  <Icon name="code" :size="10" />
                  查看
                </button>
                <span v-else class="text-[#d4d4d8]">—</span>
              </td>
            </tr>
            <tr v-if="!logs.length && !loading">
              <td colspan="10" class="px-4 py-12 text-center text-[#a1a1aa] text-xs">暂无日志数据</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Pagination -->
    <div v-if="totalPages > 1" class="flex items-center justify-center gap-1">
      <button
        class="px-2.5 py-1 text-xs rounded border border-[#e5e7eb] hover:border-[#18181b] transition-colors disabled:opacity-30"
        :disabled="page <= 1"
        @click="goPage(page - 1)"
      >上一页</button>
      <button
        v-for="p in pageRange" :key="p"
        class="px-2.5 py-1 text-xs rounded border transition-colors"
        :class="p === page ? 'bg-[#18181b] text-white border-[#18181b]' : 'border-[#e5e7eb] hover:border-[#18181b]'"
        @click="goPage(p)"
      >{{ p }}</button>
      <button
        class="px-2.5 py-1 text-xs rounded border border-[#e5e7eb] hover:border-[#18181b] transition-colors disabled:opacity-30"
        :disabled="page >= totalPages"
        @click="goPage(page + 1)"
      >下一页</button>
    </div>

    <!-- Headers Drawer / Modal -->
    <Teleport to="body">
      <div v-if="showHeaders" class="fixed inset-0 z-50 flex items-center justify-center">
        <div class="absolute inset-0 bg-black/30" @click="showHeaders = false" />
        <div class="relative bg-white rounded-xl shadow-2xl w-[640px] max-h-[80vh] flex flex-col overflow-hidden">
          <div class="flex items-center justify-between px-5 py-3.5 border-b border-[#e5e7eb]">
            <div>
              <h3 class="text-sm font-semibold text-[#18181b]">请求 Headers</h3>
              <p class="text-[10px] text-[#a1a1aa] mt-0.5">Log #{{ currentLogId }}</p>
            </div>
            <button
              class="w-7 h-7 rounded-md flex items-center justify-center hover:bg-[#f4f4f5] transition-colors"
              @click="showHeaders = false"
            >
              <Icon name="x" :size="16" class="text-[#71717a]" />
            </button>
          </div>
          <div class="flex-1 overflow-y-auto p-5">
            <table class="w-full text-xs">
              <tbody>
                <tr v-for="(val, key) in currentHeaders" :key="key" class="border-b border-[#f4f4f5]">
                  <td class="py-2 pr-4 font-mono font-medium text-[#6366f1] whitespace-nowrap align-top">{{ key }}</td>
                  <td class="py-2 font-mono text-[#18181b] break-all">{{ val }}</td>
                </tr>
              </tbody>
            </table>
            <div v-if="!Object.keys(currentHeaders).length" class="text-center text-[#a1a1aa] py-8">
              无 Header 数据
            </div>
          </div>
          <div class="px-5 py-3 border-t border-[#e5e7eb] flex justify-end">
            <button
              class="px-4 py-1.5 text-xs rounded-md bg-[#18181b] text-white hover:bg-[#27272a] transition-colors"
              @click="showHeaders = false"
            >关闭</button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
