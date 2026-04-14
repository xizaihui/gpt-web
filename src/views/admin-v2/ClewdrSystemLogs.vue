<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from 'vue'
import Icon from '@/components/common/Icon.vue'
import { fetchClewdrSystemLogs, fetchClewdrServiceStatus } from '@/api'

// Service status
const serviceStatus = ref<any>(null)
const statusLoading = ref(false)

// Log data
const logs = ref<string[]>([])
const logCount = ref(0)
const truncated = ref(false)
const loading = ref(false)
const error = ref('')

// Filters
const filterGrep = ref('')
const filterPriority = ref('')
const filterSince = ref('')
const filterLines = ref(200)

// Auto-refresh
const autoRefresh = ref(false)
let refreshTimer: ReturnType<typeof setInterval> | null = null
const refreshInterval = ref(5) // seconds

// Scroll
const logContainer = ref<HTMLElement | null>(null)
const autoScroll = ref(true)
const showScrollBtn = ref(false)

// Parsed log entries
interface LogEntry {
  raw: string
  timestamp: string
  level: 'error' | 'warn' | 'info' | 'debug' | 'trace'
  message: string
}

const parsedLogs = computed<LogEntry[]>(() => {
  return logs.value.map(line => {
    // Parse journalctl short-iso format:
    // 2026-04-10T22:28:15+0800 hostname clewdr[pid]: message
    const match = line.match(/^(\d{4}-\d{2}-\d{2}T[\d:]+[^\s]*)\s+\S+\s+\S+:\s*(.*)$/)
    const timestamp = match ? match[1] : ''
    const message = match ? match[2] : line

    // Detect log level from message content
    let level: LogEntry['level'] = 'info'
    const lower = message.toLowerCase()
    if (lower.includes('error') || lower.includes('err ') || lower.includes('panic') || lower.includes('fatal')) {
      level = 'error'
    } else if (lower.includes('warn') || lower.includes('warning')) {
      level = 'warn'
    } else if (lower.includes('debug')) {
      level = 'debug'
    } else if (lower.includes('trace')) {
      level = 'trace'
    }

    return { raw: line, timestamp, level, message }
  })
})

// Filtered display logs
const displayLogs = computed(() => {
  if (!filterGrep.value) return parsedLogs.value
  const term = filterGrep.value.toLowerCase()
  return parsedLogs.value.filter(l => l.raw.toLowerCase().includes(term))
})

// Stats
const errorCount = computed(() => parsedLogs.value.filter(l => l.level === 'error').length)
const warnCount = computed(() => parsedLogs.value.filter(l => l.level === 'warn').length)

async function loadServiceStatus() {
  statusLoading.value = true
  try {
    serviceStatus.value = await fetchClewdrServiceStatus()
  } catch (e: any) {
    console.error('Failed to load service status:', e)
  }
  statusLoading.value = false
}

async function loadLogs() {
  loading.value = true
  error.value = ''
  try {
    const params: Record<string, any> = {
      lines: filterLines.value,
    }
    if (filterSince.value) params.since = filterSince.value
    if (filterPriority.value) params.priority = filterPriority.value
    // Don't send grep to backend — we filter client-side for instant feedback
    const result = await fetchClewdrSystemLogs(params)
    logs.value = result.logs || []
    logCount.value = result.count || 0
    truncated.value = result.truncated || false

    if (autoScroll.value) {
      await nextTick()
      scrollToBottom()
    }
  } catch (e: any) {
    error.value = e.message || 'Failed to fetch logs'
  }
  loading.value = false
}

function scrollToBottom() {
  if (logContainer.value) {
    logContainer.value.scrollTop = logContainer.value.scrollHeight
  }
}

function handleScroll() {
  if (!logContainer.value) return
  const { scrollTop, scrollHeight, clientHeight } = logContainer.value
  const atBottom = scrollHeight - scrollTop - clientHeight < 50
  showScrollBtn.value = !atBottom
  // If user scrolled to bottom manually, re-enable auto-scroll
  if (atBottom) autoScroll.value = true
  else autoScroll.value = false
}

function toggleAutoRefresh() {
  autoRefresh.value = !autoRefresh.value
  if (autoRefresh.value) {
    startAutoRefresh()
  } else {
    stopAutoRefresh()
  }
}

function startAutoRefresh() {
  stopAutoRefresh()
  refreshTimer = setInterval(() => {
    loadLogs()
  }, refreshInterval.value * 1000)
}

function stopAutoRefresh() {
  if (refreshTimer) {
    clearInterval(refreshTimer)
    refreshTimer = null
  }
}

watch(refreshInterval, () => {
  if (autoRefresh.value) startAutoRefresh()
})

// Quick time filters
function setQuickTime(value: string) {
  filterSince.value = value
  loadLogs()
}

function resetFilters() {
  filterGrep.value = ''
  filterPriority.value = ''
  filterSince.value = ''
  filterLines.value = 200
  loadLogs()
}

function levelColor(level: string) {
  switch (level) {
    case 'error': return 'text-red-500'
    case 'warn': return 'text-amber-500'
    case 'debug': return 'text-blue-400'
    case 'trace': return 'text-gray-400'
    default: return 'text-[#d4d4d8]'
  }
}

function levelBg(level: string) {
  switch (level) {
    case 'error': return 'bg-red-500/10 border-l-2 border-l-red-500/50'
    case 'warn': return 'bg-amber-500/5 border-l-2 border-l-amber-500/30'
    default: return ''
  }
}

onMounted(() => {
  loadServiceStatus()
  loadLogs()
})

onUnmounted(() => {
  stopAutoRefresh()
})
</script>

<template>
  <div class="flex-1 overflow-y-auto p-6 bg-[#fafafa]">
    <div class="max-w-7xl mx-auto">
      <!-- Header -->
      <div class="flex items-center justify-between mb-5">
        <div>
          <h1 class="text-xl font-semibold text-[#18181b]">ClewdR 系统日志</h1>
          <p class="text-sm text-[#71717a] mt-0.5">实时查看 ClewdR 服务日志 · SSH 到 38.150.32.190 读取 journalctl</p>
        </div>
        <div class="flex items-center gap-2">
          <!-- Auto-refresh toggle -->
          <button
            class="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors"
            :class="autoRefresh
              ? 'bg-emerald-500 text-white hover:bg-emerald-600'
              : 'border border-[#e5e7eb] text-[#52525b] hover:bg-[#f4f4f5]'"
            @click="toggleAutoRefresh"
          >
            <Icon :name="autoRefresh ? 'pause' : 'play'" :size="12" />
            {{ autoRefresh ? '停止自动刷新' : '自动刷新' }}
          </button>
          <select
            v-if="autoRefresh"
            v-model.number="refreshInterval"
            class="px-2 py-1.5 text-xs border border-[#e5e7eb] rounded-md bg-white outline-none"
          >
            <option :value="3">3s</option>
            <option :value="5">5s</option>
            <option :value="10">10s</option>
            <option :value="30">30s</option>
          </select>
          <button class="btn-secondary" @click="loadLogs" :disabled="loading">
            <Icon name="refresh-cw" :size="12" :class="{'animate-spin': loading}" />
            刷新
          </button>
        </div>
      </div>

      <!-- Service Status Bar -->
      <div class="grid grid-cols-5 gap-3 mb-5">
        <div class="bg-white rounded-xl border border-[#e5e7eb] px-4 py-3">
          <div class="text-[11px] text-[#71717a] font-medium">服务状态</div>
          <div class="flex items-center gap-1.5 mt-1">
            <span
              class="w-2 h-2 rounded-full"
              :class="serviceStatus?.active ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'"
            />
            <span class="text-sm font-semibold" :class="serviceStatus?.active ? 'text-emerald-600' : 'text-red-500'">
              {{ serviceStatus?.status || '加载中...' }}
            </span>
          </div>
        </div>
        <div class="bg-white rounded-xl border border-[#e5e7eb] px-4 py-3">
          <div class="text-[11px] text-[#71717a] font-medium">运行时间</div>
          <div class="text-lg font-semibold text-[#18181b] mt-0.5">{{ serviceStatus?.uptime || '-' }}</div>
        </div>
        <div class="bg-white rounded-xl border border-[#e5e7eb] px-4 py-3">
          <div class="text-[11px] text-[#71717a] font-medium">内存占用</div>
          <div class="text-lg font-semibold text-[#18181b] mt-0.5">{{ serviceStatus?.memory || '-' }}</div>
        </div>
        <div class="bg-white rounded-xl border border-[#e5e7eb] px-4 py-3">
          <div class="text-[11px] text-[#71717a] font-medium">错误</div>
          <div class="text-lg font-semibold mt-0.5" :class="errorCount > 0 ? 'text-red-500' : 'text-[#18181b]'">
            {{ errorCount }}
          </div>
        </div>
        <div class="bg-white rounded-xl border border-[#e5e7eb] px-4 py-3">
          <div class="text-[11px] text-[#71717a] font-medium">警告</div>
          <div class="text-lg font-semibold mt-0.5" :class="warnCount > 0 ? 'text-amber-500' : 'text-[#18181b]'">
            {{ warnCount }}
          </div>
        </div>
      </div>

      <!-- Filters -->
      <div class="bg-white rounded-xl border border-[#e5e7eb] p-4 mb-4">
        <div class="flex flex-wrap items-center gap-3">
          <!-- Search -->
          <div class="relative flex-1 min-w-[200px]">
            <Icon name="search" :size="14" class="absolute left-3 top-1/2 -translate-y-1/2 text-[#a1a1aa]" />
            <input
              v-model="filterGrep"
              class="w-full pl-9 pr-3 py-2 text-xs border border-[#e5e7eb] rounded-lg bg-white outline-none focus:border-[#a1a1aa] transition-colors"
              placeholder="搜索日志内容... (实时过滤)"
            />
          </div>

          <!-- Priority -->
          <select
            v-model="filterPriority"
            class="px-3 py-2 text-xs border border-[#e5e7eb] rounded-lg bg-white outline-none"
            @change="loadLogs"
          >
            <option value="">全部级别</option>
            <option value="err">仅错误</option>
            <option value="warning">警告及以上</option>
            <option value="info">信息及以上</option>
            <option value="debug">调试及以上</option>
          </select>

          <!-- Lines -->
          <select
            v-model.number="filterLines"
            class="px-3 py-2 text-xs border border-[#e5e7eb] rounded-lg bg-white outline-none"
            @change="loadLogs"
          >
            <option :value="50">50 行</option>
            <option :value="100">100 行</option>
            <option :value="200">200 行</option>
            <option :value="500">500 行</option>
            <option :value="1000">1000 行</option>
            <option :value="2000">2000 行</option>
          </select>

          <!-- Quick time buttons -->
          <div class="flex gap-1">
            <button class="px-2 py-1.5 text-[11px] rounded-md border border-[#e5e7eb] hover:bg-[#f4f4f5] text-[#52525b]" @click="setQuickTime('5 minutes ago')">5分钟</button>
            <button class="px-2 py-1.5 text-[11px] rounded-md border border-[#e5e7eb] hover:bg-[#f4f4f5] text-[#52525b]" @click="setQuickTime('30 minutes ago')">30分钟</button>
            <button class="px-2 py-1.5 text-[11px] rounded-md border border-[#e5e7eb] hover:bg-[#f4f4f5] text-[#52525b]" @click="setQuickTime('1 hour ago')">1小时</button>
            <button class="px-2 py-1.5 text-[11px] rounded-md border border-[#e5e7eb] hover:bg-[#f4f4f5] text-[#52525b]" @click="setQuickTime('today')">今天</button>
            <button class="px-2 py-1.5 text-[11px] rounded-md border border-[#e5e7eb] hover:bg-[#f4f4f5] text-[#52525b]" @click="setQuickTime('yesterday')">昨天</button>
          </div>

          <button class="text-xs text-[#71717a] hover:text-[#18181b]" @click="resetFilters">重置</button>
        </div>

        <div v-if="filterSince" class="mt-2 flex items-center gap-1.5">
          <span class="text-[11px] text-[#71717a]">时间范围:</span>
          <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#f4f4f5] text-[11px] text-[#52525b]">
            {{ filterSince }}
            <button class="hover:text-red-500" @click="filterSince = ''; loadLogs()">×</button>
          </span>
        </div>
      </div>

      <!-- Log Viewer -->
      <div class="bg-[#18181b] rounded-xl border border-[#27272a] overflow-hidden relative">
        <!-- Top bar -->
        <div class="flex items-center justify-between px-4 py-2 bg-[#09090b] border-b border-[#27272a]">
          <div class="flex items-center gap-3">
            <div class="flex gap-1.5">
              <span class="w-3 h-3 rounded-full bg-[#ef4444]/80" />
              <span class="w-3 h-3 rounded-full bg-[#eab308]/80" />
              <span class="w-3 h-3 rounded-full bg-[#22c55e]/80" />
            </div>
            <span class="text-[11px] text-[#71717a] font-mono">clewdr@38.150.32.190 — journalctl</span>
          </div>
          <div class="flex items-center gap-2 text-[11px] text-[#71717a]">
            <span v-if="truncated" class="text-amber-400">⚠ 已截断</span>
            <span>{{ displayLogs.length }} / {{ logCount }} 行</span>
            <span v-if="autoRefresh" class="text-emerald-400 flex items-center gap-1">
              <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              LIVE
            </span>
          </div>
        </div>

        <!-- Error state -->
        <div v-if="error" class="px-4 py-8 text-center">
          <div class="text-red-400 text-sm mb-2">⚠ {{ error }}</div>
          <button class="text-xs text-[#71717a] hover:text-white underline" @click="loadLogs">重试</button>
        </div>

        <!-- Log content -->
        <div
          v-else
          ref="logContainer"
          class="font-mono text-xs leading-5 overflow-y-auto overflow-x-auto"
          style="max-height: 600px; min-height: 300px;"
          @scroll="handleScroll"
        >
          <div v-if="loading && logs.length === 0" class="px-4 py-8 text-center text-[#71717a]">
            加载日志中...
          </div>
          <div v-else-if="displayLogs.length === 0" class="px-4 py-8 text-center text-[#71717a]">
            {{ filterGrep ? '没有匹配的日志' : '暂无日志' }}
          </div>
          <div v-else class="py-1">
            <div
              v-for="(entry, idx) in displayLogs"
              :key="idx"
              class="px-4 py-[2px] hover:bg-[#27272a]/50 whitespace-pre-wrap break-all"
              :class="levelBg(entry.level)"
            >
              <span v-if="entry.timestamp" class="text-[#52525b] select-none">{{ entry.timestamp }} </span>
              <span :class="levelColor(entry.level)">{{ entry.message }}</span>
            </div>
          </div>
        </div>

        <!-- Scroll to bottom button -->
        <transition name="fade">
          <button
            v-if="showScrollBtn"
            class="absolute bottom-4 right-4 w-8 h-8 rounded-full bg-[#3f3f46] text-white flex items-center justify-center shadow-lg hover:bg-[#52525b] transition-colors"
            @click="autoScroll = true; scrollToBottom()"
            title="滚动到底部"
          >
            <Icon name="chevron-down" :size="16" />
          </button>
        </transition>
      </div>

      <!-- Footer info -->
      <div class="mt-3 flex items-center justify-between text-[11px] text-[#a1a1aa]">
        <span>数据来源: SSH → 38.150.32.190 → journalctl -u clewdr</span>
        <span v-if="serviceStatus?.pid">PID: {{ serviceStatus.pid }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.btn-secondary {
  @apply inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-[#e5e7eb] text-[#52525b] rounded-md hover:bg-[#f4f4f5] transition-colors disabled:opacity-50;
}

.fade-enter-active, .fade-leave-active { transition: opacity 0.2s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }

/* Custom scrollbar for dark log viewer */
div[ref="logContainer"]::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}
div[ref="logContainer"]::-webkit-scrollbar-track {
  background: transparent;
}
div[ref="logContainer"]::-webkit-scrollbar-thumb {
  background: #3f3f46;
  border-radius: 3px;
}
</style>
