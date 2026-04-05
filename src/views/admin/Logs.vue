<script setup lang="ts">
import { ref, reactive, onMounted, computed, h } from 'vue'
import {
  NDataTable, NCard, NSpace, NButton, NInput, NSelect, NDatePicker,
  NStatistic, NGrid, NGi, NPagination, NPopover, NTag, NSpin, useMessage,
} from 'naive-ui'

const message = useMessage()
const loading = ref(false)
const statsLoading = ref(false)

// State
const logs = ref<any[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const filters = reactive({ model: '', client_id: '', date_range: null as [number, number] | null })
const stats = ref<any>({})
const retentionDays = ref('7')

const API_BASE = '/api'

async function apiFetch(path: string, opts?: any) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('SECRET_TOKEN') || ''}` },
    ...opts,
  })
  return res.json()
}

// Format date range to string
function fmtDate(ts: number) {
  return new Date(ts).toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' })
}

async function fetchLogs() {
  loading.value = true
  try {
    const params = new URLSearchParams({
      page: String(page.value),
      pageSize: String(pageSize.value),
    })
    if (filters.model) params.set('model', filters.model)
    if (filters.client_id) params.set('client_id', filters.client_id)
    if (filters.date_range) {
      params.set('date_from', fmtDate(filters.date_range[0]))
      params.set('date_to', fmtDate(filters.date_range[1]))
    }
    const res = await apiFetch(`/log/list?${params}`)
    if (res.status === 'Success') {
      logs.value = res.data.data
      total.value = res.data.total
    }
  } finally { loading.value = false }
}

async function fetchStats() {
  statsLoading.value = true
  try {
    const params = new URLSearchParams()
    if (filters.date_range) {
      params.set('date_from', fmtDate(filters.date_range[0]))
      params.set('date_to', fmtDate(filters.date_range[1]))
    }
    const res = await apiFetch(`/log/stats?${params}`)
    if (res.status === 'Success') stats.value = res.data
  } finally { statsLoading.value = false }
}

async function fetchSettings() {
  const res = await apiFetch('/log/settings')
  if (res.status === 'Success') retentionDays.value = res.data.retention_days || '7'
}

async function saveSettings() {
  const res = await apiFetch('/log/settings', {
    method: 'POST',
    body: JSON.stringify({ retention_days: retentionDays.value }),
  })
  if (res.status === 'Success') message.success('保存成功')
  else message.error(res.message || '保存失败')
}

function search() {
  page.value = 1
  fetchLogs()
  fetchStats()
}

function onPageChange(p: number) {
  page.value = p
  fetchLogs()
}

// Cost formatting
function fmtCost(v: number) {
  if (!v) return '$0'
  if (v < 0.0001) return `$${v.toFixed(6)}`
  return `$${v.toFixed(4)}`
}

function fmtTokens(v: number) {
  if (!v) return '0'
  if (v >= 1000000) return `${(v / 1000000).toFixed(1)}M`
  if (v >= 1000) return `${(v / 1000).toFixed(1)}K`
  return String(v)
}

// Model tag color
function modelColor(model: string) {
  if (!model) return 'default'
  const m = model.toLowerCase()
  if (m.includes('opus')) return 'warning'
  if (m.includes('sonnet')) return 'success'
  return 'info'
}

// Table columns
const columns = [
  { title: '时间', key: 'created_at', width: 160, ellipsis: true },
  {
    title: '模型', key: 'model', width: 180,
    render: (row: any) => h(NTag, { size: 'small', type: modelColor(row.model), bordered: false }, () => row.model || '-'),
  },
  { title: '客户端', key: 'client_id', width: 100, ellipsis: true },
  { title: '输入', key: 'input_tokens', width: 70, render: (row: any) => fmtTokens(row.input_tokens) },
  { title: '输出', key: 'output_tokens', width: 70, render: (row: any) => fmtTokens(row.output_tokens) },
  { title: '缓存读', key: 'cache_read_tokens', width: 80, render: (row: any) => fmtTokens(row.cache_read_tokens) },
  { title: '缓存写', key: 'cache_write_tokens', width: 80, render: (row: any) => fmtTokens(row.cache_write_tokens) },
  {
    title: '费用', key: 'total_cost', width: 100,
    render: (row: any) => h(NPopover, { trigger: 'hover' }, {
      trigger: () => h('span', { style: 'cursor:pointer;color:#18a058;font-weight:500' }, fmtCost(row.total_cost)),
      default: () => h('div', { style: 'font-size:12px;line-height:1.8' }, [
        h('div', `输入: ${fmtCost(row.input_cost)} (${fmtTokens(row.input_tokens)} tokens)`),
        h('div', `输出: ${fmtCost(row.output_cost)} (${fmtTokens(row.output_tokens)} tokens)`),
        h('div', `缓存读: ${fmtCost(row.cache_read_cost)} (${fmtTokens(row.cache_read_tokens)} tokens)`),
        h('div', `缓存写: ${fmtCost(row.cache_write_cost)} (${fmtTokens(row.cache_write_tokens)} tokens)`),
        h('div', { style: 'border-top:1px solid #eee;margin-top:4px;padding-top:4px;font-weight:600' },
          `合计: ${fmtCost(row.total_cost)}`),
      ]),
    }),
  },
  { title: '耗时', key: 'duration_ms', width: 80, render: (row: any) => row.duration_ms ? `${(row.duration_ms / 1000).toFixed(1)}s` : '-' },
]

const retentionOptions = [
  { label: '3 天', value: '3' },
  { label: '7 天', value: '7' },
  { label: '15 天', value: '15' },
  { label: '30 天', value: '30' },
]

const todayCost = computed(() => fmtCost(stats.value?.today?.cost || 0))
const todayRequests = computed(() => stats.value?.today?.requests || 0)
const totalCost = computed(() => fmtCost(stats.value?.summary?.total_cost || 0))
const totalRequests = computed(() => stats.value?.summary?.total_requests || 0)

onMounted(() => {
  fetchLogs()
  fetchStats()
  fetchSettings()
})
</script>

<template>
  <div class="p-6 space-y-5 overflow-y-auto h-full">
    <h2 class="text-lg font-semibold text-[#18181b]">请求日志</h2>

    <!-- Stats Cards -->
    <NGrid :cols="4" :x-gap="12" :y-gap="12">
      <NGi>
        <NCard size="small" :bordered="true">
          <NStatistic label="今日费用" :value="todayCost" />
        </NCard>
      </NGi>
      <NGi>
        <NCard size="small" :bordered="true">
          <NStatistic label="今日请求" :value="todayRequests" />
        </NCard>
      </NGi>
      <NGi>
        <NCard size="small" :bordered="true">
          <NStatistic label="总费用" :value="totalCost" />
        </NCard>
      </NGi>
      <NGi>
        <NCard size="small" :bordered="true">
          <NStatistic label="总请求" :value="totalRequests" />
        </NCard>
      </NGi>
    </NGrid>

    <!-- Filters -->
    <NCard size="small" :bordered="true">
      <NSpace align="center" :wrap="true">
        <NDatePicker
          v-model:value="filters.date_range"
          type="daterange"
          clearable
          size="small"
          style="width: 260px"
        />
        <NInput v-model:value="filters.model" placeholder="模型" size="small" clearable style="width: 160px" />
        <NInput v-model:value="filters.client_id" placeholder="客户端ID" size="small" clearable style="width: 140px" />
        <NButton type="primary" size="small" @click="search">搜索</NButton>
      </NSpace>
    </NCard>

    <!-- Table -->
    <NSpin :show="loading">
      <NDataTable
        :columns="columns"
        :data="logs"
        :bordered="true"
        :single-line="false"
        size="small"
        :row-key="(row: any) => row.id"
        :scroll-x="1000"
      />
    </NSpin>

    <!-- Pagination -->
    <div class="flex justify-between items-center">
      <NPagination
        v-model:page="page"
        :page-count="Math.ceil(total / pageSize)"
        :page-size="pageSize"
        size="small"
        @update:page="onPageChange"
      />
      <span class="text-xs text-gray-400">共 {{ total }} 条</span>
    </div>

    <!-- Settings -->
    <NCard size="small" title="设置" :bordered="true">
      <NSpace align="center">
        <span class="text-sm">日志保留天数：</span>
        <NSelect
          v-model:value="retentionDays"
          :options="retentionOptions"
          size="small"
          style="width: 100px"
        />
        <NButton size="small" type="primary" @click="saveSettings">保存</NButton>
      </NSpace>
    </NCard>
  </div>
</template>
