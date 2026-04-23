<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { fetchKiroUsage, fetchKiroHistory, refreshKiroQuotas, disableKiroAccount, enableKiroAccount, testKiroAccount, startKiroLogin, checkKiroLogin, completeKiroLogin, cancelKiroLogin, updateKiroAccountProxy, deleteKiroAccount } from '@/api'

interface KiroAccount {
  id: string
  source: string
  ok: boolean
  auth_type?: string
  subscription?: { title?: string; type?: string; overage_capability?: string }
  limit?: number
  used?: number
  remaining?: number
  percent?: number
  unit?: string
  overage?: { status?: string; used?: number; cap?: number; rate?: number; currency?: string; charges?: number }
  free_trial?: { status?: string; used?: number; limit?: number; expiry?: number } | null
  days_until_reset?: number
  next_date_reset?: number
  disabled?: boolean
  active_sessions?: number
  total_requests?: number
  error?: string
  proxy_url?: string | null
}

interface UsageResponse {
  accounts: KiroAccount[]
  total: number
  summary: {
    ok_count: number
    error_count: number
    total_limit: number
    total_used: number
    total_remaining: number
    percent: number
    unit: string
    free_trial_used: number
    free_trial_limit: number
  }
}

const usage = ref<UsageResponse | null>(null)
const history = ref<{ series: any[]; latest: any[]; bucket_seconds: number; hours: number } | null>(null)
const loading = ref(false)
const refreshing = ref(false)
const historyHours = ref<number>(24)
const selectedAccountId = ref<string>('all')
const autoRefreshTimer = ref<number | null>(null)

// Table state
const searchQuery = ref('')
const statusFilter = ref<string>('all')
const currentPage = ref(1)
const pageSize = 20

// Inline proxy editing
const editingProxyId = ref<string | null>(null)
const editingProxyValue = ref('')

// Account action states
const testingIds = ref<Set<string>>(new Set())
const testResults = ref<Record<string, { ok: boolean; msg: string }>>({})

// Login flow state
type LoginState = 'idle' | 'starting' | 'waiting' | 'completing' | 'success' | 'error'
const loginState = ref<LoginState>('idle')
const loginLabel = ref('')
const loginUrl = ref('')
const loginSshCmd = ref('')
const loginPort = ref(3128)
const loginError = ref('')
const loginResult = ref<any>(null)
const loginPollTimer = ref<number | null>(null)
const loginShowDialog = ref(false)
const loginCountdown = ref(300)
const loginCountdownTimer = ref<number | null>(null)

// Copy feedback
const copySuccess = ref('')

// History chart
const showHistory = ref(false)

// Computed: filtered & paginated accounts
const filteredAccounts = computed(() => {
  if (!usage.value) return []
  let list = usage.value.accounts
  if (searchQuery.value) {
    const q = searchQuery.value.toLowerCase()
    list = list.filter(a => a.id.toLowerCase().includes(q) || a.source.toLowerCase().includes(q) || (a.auth_type || '').toLowerCase().includes(q))
  }
  if (statusFilter.value !== 'all') {
    list = list.filter(a => {
      if (statusFilter.value === 'active') return !a.disabled && !a.error
      if (statusFilter.value === 'disabled') return a.disabled
      if (statusFilter.value === 'error') return !!a.error
      return true
    })
  }
  return list
})

const totalPages = computed(() => Math.max(1, Math.ceil(filteredAccounts.value.length / pageSize)))
const paginatedAccounts = computed(() => {
  const start = (currentPage.value - 1) * pageSize
  return filteredAccounts.value.slice(start, start + pageSize)
})

watch([searchQuery, statusFilter], () => { currentPage.value = 1 })

// Data loading
async function loadUsage(refresh = false) {
  loading.value = true
  try { usage.value = await fetchKiroUsage(refresh) } catch (e) { console.error('Failed to load kiro usage', e) }
  loading.value = false
}

async function loadHistory() {
  try {
    history.value = await fetchKiroHistory({ hours: historyHours.value, accountId: selectedAccountId.value === 'all' ? undefined : selectedAccountId.value })
  } catch (e) { console.error('Failed to load kiro history', e) }
}

async function handleRefreshQuotas() {
  refreshing.value = true
  try { await refreshKiroQuotas(); await loadUsage(true) } catch {}
  refreshing.value = false
}

// Account actions
async function handleTest(id: string) {
  testingIds.value.add(id)
  try {
    const res: any = await testKiroAccount(id)
    testResults.value[id] = { ok: res.token_valid, msg: res.token_valid ? 'Token 有效' : 'Token 无效' }
  } catch (e: any) {
    testResults.value[id] = { ok: false, msg: e?.message || '测试失败' }
  }
  testingIds.value.delete(id)
  setTimeout(() => { delete testResults.value[id] }, 3000)
}

async function handleToggle(acct: KiroAccount) {
  try {
    if (acct.disabled) { await enableKiroAccount(acct.id) } else { await disableKiroAccount(acct.id) }
    await loadUsage()
  } catch {}
}

async function handleDelete(acct: KiroAccount) {
  if (!window.confirm(`确定删除账号 ${acct.id}（${acct.source}）？此操作不可恢复。`)) return
  try { await deleteKiroAccount(acct.id); await loadUsage() } catch {}
}

// Proxy inline edit
function startEditProxy(acct: KiroAccount) {
  editingProxyId.value = acct.id
  editingProxyValue.value = acct.proxy_url || ''
}

async function saveProxy(id: string) {
  try { await updateKiroAccountProxy(id, editingProxyValue.value || null); await loadUsage() } catch {}
  editingProxyId.value = null
}

function cancelEditProxy() { editingProxyId.value = null }

// Login flow
function stopLoginPolling() {
  if (loginPollTimer.value) { clearInterval(loginPollTimer.value); loginPollTimer.value = null }
  if (loginCountdownTimer.value) { clearInterval(loginCountdownTimer.value); loginCountdownTimer.value = null }
}

async function handleStartLogin() {
  loginShowDialog.value = true
  loginState.value = 'starting'
  loginError.value = ''
  loginResult.value = null
  try {
    const res: any = await startKiroLogin()
    if (res?.state === 'waiting') {
      loginLabel.value = res.label
      loginUrl.value = res.url
      loginSshCmd.value = res.ssh_tunnel_command
      loginPort.value = res.local_port || 3128
      loginState.value = 'waiting'
      loginCountdown.value = 300
      loginPollTimer.value = window.setInterval(pollLoginStatus, 2000)
      loginCountdownTimer.value = window.setInterval(() => {
        loginCountdown.value--
        if (loginCountdown.value <= 0) { stopLoginPolling(); loginState.value = 'error'; loginError.value = '登录超时（5分钟）' }
      }, 1000)
    } else {
      loginState.value = 'error'
      loginError.value = res?.error || '启动失败'
    }
  } catch (e: any) {
    loginState.value = 'error'
    loginError.value = e?.message || '启动失败'
  }
}

async function pollLoginStatus() {
  if (!loginLabel.value || loginState.value !== 'waiting') return
  try {
    const res: any = await checkKiroLogin(loginLabel.value)
    if (res?.state === 'complete' || res?.state === 'logged_in') {
      stopLoginPolling()
      loginState.value = 'completing'
      try {
        const result: any = await completeKiroLogin(loginLabel.value)
        loginResult.value = result
        loginState.value = 'success'
        await loadUsage()
      } catch (e: any) {
        loginState.value = 'error'
        loginError.value = e?.message || '上架失败'
      }
    } else if (res?.state === 'error' || res?.state === 'expired') {
      stopLoginPolling()
      loginState.value = 'error'
      loginError.value = res?.error || '登录失败'
    }
  } catch { /* ignore poll errors */ }
}

async function handleCancelLogin() {
  stopLoginPolling()
  if (loginLabel.value) { try { await cancelKiroLogin(loginLabel.value) } catch {} }
  loginState.value = 'idle'
  loginShowDialog.value = false
}

function handleCloseLoginDialog() {
  stopLoginPolling()
  loginState.value = 'idle'
  loginShowDialog.value = false
}

function formatCountdown(s: number) {
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${m}:${sec.toString().padStart(2, '0')}`
}

function copyToClipboard(text: string, label = '') {
  const fallback = () => {
    const ta = document.createElement('textarea')
    ta.value = text; ta.style.position = 'fixed'; ta.style.left = '-9999px'
    document.body.appendChild(ta); ta.select()
    try { document.execCommand('copy'); showCopyTip(label) } catch {}
    document.body.removeChild(ta)
  }
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(() => showCopyTip(label)).catch(fallback)
  } else { fallback() }
}

function showCopyTip(label: string) {
  copySuccess.value = label || '已复制'
  setTimeout(() => { copySuccess.value = '' }, 1500)
}

function getStatusBadge(acct: KiroAccount) {
  if (acct.disabled) return { text: '已禁用', cls: 'bg-zinc-100 text-zinc-500' }
  if (acct.error) return { text: '错误', cls: 'bg-red-50 text-red-600' }
  return { text: '活跃', cls: 'bg-emerald-50 text-emerald-600' }
}

function fmtNum(n: number | undefined) {
  if (n === undefined || n === null) return '-'
  return n.toLocaleString('en-US', { maximumFractionDigits: 1 })
}

// History chart rendering
function renderChart() {
  if (!history.value?.series?.length) return
  const canvas = document.getElementById('kiro-history-canvas') as HTMLCanvasElement
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const { series } = history.value
  const W = canvas.width = canvas.offsetWidth * 2
  const H = canvas.height = canvas.offsetHeight * 2
  ctx.scale(2, 2)
  const w = W / 2, h = H / 2
  const pad = { t: 20, r: 20, b: 30, l: 50 }

  ctx.clearRect(0, 0, w, h)

  // Merge all timestamps
  const allTs = new Set<number>()
  series.forEach((s: any) => s.data.forEach((d: any) => allTs.add(d.ts)))
  const timestamps = [...allTs].sort((a, b) => a - b)
  if (timestamps.length < 2) return

  const minT = timestamps[0], maxT = timestamps[timestamps.length - 1]
  let maxV = 0
  series.forEach((s: any) => s.data.forEach((d: any) => { if (d.value > maxV) maxV = d.value }))
  if (maxV === 0) maxV = 1

  const xScale = (t: number) => pad.l + (t - minT) / (maxT - minT) * (w - pad.l - pad.r)
  const yScale = (v: number) => pad.t + (1 - v / maxV) * (h - pad.t - pad.b)

  // Grid
  ctx.strokeStyle = '#f4f4f5'
  ctx.lineWidth = 0.5
  for (let i = 0; i <= 4; i++) {
    const y = pad.t + i * (h - pad.t - pad.b) / 4
    ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke()
    ctx.fillStyle = '#a1a1aa'; ctx.font = '10px sans-serif'; ctx.textAlign = 'right'
    ctx.fillText(fmtNum(maxV * (1 - i / 4)), pad.l - 5, y + 3)
  }

  // X labels
  const labelCount = Math.min(6, timestamps.length)
  ctx.fillStyle = '#a1a1aa'; ctx.font = '10px sans-serif'; ctx.textAlign = 'center'
  for (let i = 0; i < labelCount; i++) {
    const idx = Math.floor(i * (timestamps.length - 1) / (labelCount - 1))
    const t = timestamps[idx]
    const d = new Date(t * 1000)
    ctx.fillText(`${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`, xScale(t), h - pad.b + 15)
  }

  // Lines
  const colors = ['#2563eb', '#16a34a', '#ea580c', '#9333ea', '#dc2626', '#0891b2', '#ca8a04', '#6366f1']
  series.forEach((s: any, si: number) => {
    const sorted = [...s.data].sort((a: any, b: any) => a.ts - b.ts)
    if (sorted.length < 2) return
    ctx.strokeStyle = colors[si % colors.length]
    ctx.lineWidth = 1.5
    ctx.beginPath()
    sorted.forEach((d: any, i: number) => {
      const x = xScale(d.ts), y = yScale(d.value)
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
    })
    ctx.stroke()
  })

  // Legend
  ctx.font = '10px sans-serif'
  let lx = pad.l
  series.forEach((s: any, si: number) => {
    ctx.fillStyle = colors[si % colors.length]
    ctx.fillRect(lx, 4, 12, 3)
    ctx.fillStyle = '#71717a'
    ctx.fillText(s.label || s.account_id, lx + 15, 10)
    lx += ctx.measureText(s.label || s.account_id).width + 30
  })
}

// Lifecycle
onMounted(async () => {
  await loadUsage()
  autoRefreshTimer.value = window.setInterval(() => loadUsage(), 60000)
})

onBeforeUnmount(() => {
  if (autoRefreshTimer.value) clearInterval(autoRefreshTimer.value)
  stopLoginPolling()
})

watch([historyHours, selectedAccountId], () => { if (showHistory.value) loadHistory() })
watch(showHistory, (v) => { if (v) loadHistory() })
watch(() => history.value, () => { setTimeout(renderChart, 50) }, { deep: true })
</script>

<template>
  <div class="space-y-4">
    <!-- Summary Cards -->
    <div v-if="usage?.summary" class="grid grid-cols-2 md:grid-cols-5 gap-3">
      <div class="rounded-lg border border-zinc-200 bg-white p-4">
        <div class="text-xs font-medium text-zinc-500">总额度</div>
        <div class="text-2xl font-semibold text-zinc-900 mt-1">{{ usage.summary.total_limit.toLocaleString() }}</div>
        <div class="text-[10px] text-zinc-400 mt-0.5">{{ usage.summary.unit }}</div>
      </div>
      <div class="rounded-lg border border-zinc-200 bg-white p-4">
        <div class="text-xs font-medium text-zinc-500">已用</div>
        <div class="text-2xl font-semibold text-zinc-900 mt-1">{{ usage.summary.total_used.toLocaleString() }}</div>
        <div class="h-1.5 rounded-full bg-zinc-100 mt-2">
          <div class="h-full rounded-full transition-all" :class="usage.summary.percent > 80 ? 'bg-red-500' : usage.summary.percent > 50 ? 'bg-amber-500' : 'bg-emerald-500'" :style="{ width: Math.min(usage.summary.percent, 100) + '%' }" />
        </div>
      </div>
      <div class="rounded-lg border border-zinc-200 bg-white p-4">
        <div class="text-xs font-medium text-zinc-500">剩余</div>
        <div class="text-2xl font-semibold text-zinc-900 mt-1">{{ usage.summary.total_remaining.toLocaleString() }}</div>
        <div class="text-[10px] text-zinc-400 mt-0.5">{{ (100 - usage.summary.percent).toFixed(1) }}%</div>
      </div>
      <div class="rounded-lg border border-zinc-200 bg-white p-4">
        <div class="text-xs font-medium text-zinc-500">账号</div>
        <div class="text-2xl font-semibold text-zinc-900 mt-1">{{ usage.total }}</div>
        <div class="text-[10px] text-zinc-400 mt-0.5">
          <span class="text-emerald-600">{{ usage.summary.ok_count }} 正常</span>
          <span v-if="usage.summary.error_count" class="text-red-500 ml-1">{{ usage.summary.error_count }} 异常</span>
        </div>
      </div>
      <div v-if="usage.summary.free_trial_limit > 0" class="rounded-lg border border-blue-200 bg-blue-50/50 p-4">
        <div class="text-xs font-medium text-blue-600">🎁 赠送额度</div>
        <div class="text-2xl font-semibold text-blue-700 mt-1">{{ usage.summary.free_trial_limit.toLocaleString() }}</div>
        <div class="text-[10px] text-blue-500 mt-0.5">已用 {{ usage.summary.free_trial_used.toLocaleString() }}</div>
      </div>
    </div>

    <!-- Toolbar -->
    <div class="flex flex-wrap items-center gap-2">
      <input v-model="searchQuery" type="text" placeholder="搜索账号 ID / 来源 / 类型..." class="h-8 rounded-md border border-zinc-200 bg-white px-3 text-xs text-zinc-700 placeholder:text-zinc-400 focus:outline-none focus:ring-1 focus:ring-zinc-400 w-56" />
      <select v-model="statusFilter" class="h-8 rounded-md border border-zinc-200 bg-white px-2 text-xs text-zinc-700 focus:outline-none focus:ring-1 focus:ring-zinc-400">
        <option value="all">全部状态</option>
        <option value="active">正常</option>
        <option value="disabled">已禁用</option>
        <option value="error">异常</option>
      </select>
      <div class="flex-1" />
      <button @click="showHistory = !showHistory" class="h-8 rounded-md border border-zinc-200 bg-white px-3 text-xs text-zinc-700 hover:bg-zinc-50 transition-colors">
        {{ showHistory ? '隐藏图表' : '用量图表' }}
      </button>
      <button @click="handleRefreshQuotas" :disabled="refreshing" class="h-8 rounded-md border border-zinc-200 bg-white px-3 text-xs text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 transition-colors">
        {{ refreshing ? '刷新中...' : '刷新额度' }}
      </button>
      <button @click="handleStartLogin" class="h-8 rounded-md bg-zinc-900 px-3 text-xs text-white hover:bg-zinc-800 transition-colors">
        + 添加账号
      </button>
    </div>

    <!-- History Chart (collapsible) -->
    <div v-if="showHistory" class="rounded-lg border border-zinc-200 bg-white p-4">
      <div class="flex items-center gap-3 mb-3">
        <div class="text-xs font-medium text-zinc-700">用量历史</div>
        <select v-model="historyHours" class="h-7 rounded border border-zinc-200 bg-white px-2 text-[11px] text-zinc-600">
          <option :value="6">6h</option><option :value="12">12h</option><option :value="24">24h</option><option :value="72">3d</option><option :value="168">7d</option>
        </select>
        <select v-model="selectedAccountId" class="h-7 rounded border border-zinc-200 bg-white px-2 text-[11px] text-zinc-600">
          <option value="all">全部账号</option>
          <option v-for="a in (usage?.accounts || [])" :key="a.id" :value="a.id">{{ a.id }}</option>
        </select>
      </div>
      <div class="h-48 w-full">
        <canvas ref="chartCanvas" class="w-full h-full" />
      </div>
    </div>

    <!-- Accounts Table -->
    <div class="rounded-lg border border-zinc-200 bg-white overflow-hidden">
      <div v-if="loading && !usage" class="p-8 text-center text-xs text-zinc-400">加载中...</div>
      <table v-else class="w-full text-xs">
        <thead>
          <tr class="border-b border-zinc-100 bg-zinc-50/50">
            <th class="text-left font-medium text-zinc-500 px-3 py-2">ID</th>
            <th class="text-left font-medium text-zinc-500 px-3 py-2">类型</th>
            <th class="text-left font-medium text-zinc-500 px-3 py-2">订阅</th>
            <th class="text-left font-medium text-zinc-500 px-3 py-2 min-w-[160px]">额度</th>
            <th class="text-center font-medium text-zinc-500 px-3 py-2">会话</th>
            <th class="text-center font-medium text-zinc-500 px-3 py-2">请求</th>
            <th class="text-left font-medium text-zinc-500 px-3 py-2">代理</th>
            <th class="text-center font-medium text-zinc-500 px-3 py-2">状态</th>
            <th class="text-right font-medium text-zinc-500 px-3 py-2">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="acct in paginatedAccounts" :key="acct.id" class="border-b border-zinc-50 hover:bg-zinc-50/50 transition-colors" :class="{ 'opacity-50': acct.disabled }">
            <!-- ID -->
            <td class="px-3 py-2">
              <div class="font-mono text-zinc-900">{{ acct.id }}</div>
              <div class="text-[10px] text-zinc-400 truncate max-w-[140px]">{{ acct.source }}</div>
            </td>
            <!-- Auth type -->
            <td class="px-3 py-2">
              <span class="inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium" :class="acct.auth_type === 'kiro_desktop' ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-zinc-200 bg-zinc-50 text-zinc-600'">
                {{ acct.auth_type || 'unknown' }}
              </span>
            </td>
            <!-- Subscription -->
            <td class="px-3 py-2 text-zinc-600">{{ acct.subscription?.title || '-' }}</td>
            <!-- Quota -->
            <td class="px-3 py-2">
              <div class="flex items-center gap-2">
                <div class="flex-1">
                  <div class="h-1.5 rounded-full bg-zinc-100">
                    <div class="h-full rounded-full transition-all" :class="(acct.percent || 0) > 80 ? 'bg-red-500' : (acct.percent || 0) > 50 ? 'bg-amber-500' : 'bg-emerald-500'" :style="{ width: Math.min(acct.percent || 0, 100) + '%' }" />
                  </div>
                </div>
                <span class="text-[10px] text-zinc-500 whitespace-nowrap">{{ (acct.used || 0).toLocaleString() }} / {{ (acct.limit || 0).toLocaleString() }}</span>
              </div>
              <div v-if="acct.days_until_reset" class="text-[10px] text-zinc-400 mt-0.5">{{ acct.days_until_reset }}d 后重置</div>
              <div v-if="acct.free_trial" class="text-[10px] mt-0.5"><span class="inline-flex items-center rounded px-1 py-0.5 bg-blue-50 text-blue-600 border border-blue-200">🎁 赠送 {{ acct.free_trial.used }}/{{ acct.free_trial.limit }}<template v-if="acct.free_trial.expiry"> · {{ new Date(acct.free_trial.expiry * 1000).toLocaleDateString("zh-CN") }} 到期</template></span></div>
            </td>
            <!-- Sessions -->
            <td class="px-3 py-2 text-center text-zinc-600">{{ acct.active_sessions ?? 0 }}</td>
            <!-- Requests -->
            <td class="px-3 py-2 text-center text-zinc-600">{{ (acct.total_requests ?? 0).toLocaleString() }}</td>
            <!-- Proxy -->
            <td class="px-3 py-2">
              <div v-if="editingProxyId === acct.id" class="flex items-center gap-1">
                <input v-model="editingProxyValue" @keyup.enter="saveProxy(acct.id)" @keyup.escape="cancelEditProxy" class="h-6 flex-1 rounded border border-zinc-300 px-1.5 text-[10px] font-mono focus:outline-none focus:ring-1 focus:ring-zinc-400 min-w-[120px]" placeholder="socks5://user:pass@host:port" autofocus />
                <button @click="saveProxy(acct.id)" class="text-emerald-600 hover:text-emerald-700 text-[10px]">✓</button>
                <button @click="cancelEditProxy" class="text-zinc-400 hover:text-zinc-600 text-[10px]">✗</button>
              </div>
              <div v-else @click="startEditProxy(acct)" class="cursor-pointer hover:text-zinc-900 transition-colors group">
                <span v-if="acct.proxy_url" class="font-mono text-[10px] text-zinc-600 group-hover:text-zinc-900 truncate block max-w-[160px]">{{ acct.proxy_url }}</span>
                <span v-else class="text-zinc-300 text-[10px]">点击设置</span>
              </div>
            </td>
            <!-- Status -->
            <td class="px-3 py-2 text-center">
              <span v-if="acct.disabled" class="inline-flex items-center rounded-md border border-zinc-200 bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-500">已禁用</span>
              <span v-else-if="acct.error" class="inline-flex items-center rounded-md border border-red-200 bg-red-50 px-1.5 py-0.5 text-[10px] font-medium text-red-600">异常</span>
              <span v-else class="inline-flex items-center rounded-md border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600">正常</span>
              <div v-if="testResults[acct.id]" class="text-[10px] mt-0.5" :class="testResults[acct.id].ok ? 'text-emerald-600' : 'text-red-500'">{{ testResults[acct.id].msg }}</div>
            </td>
            <!-- Actions -->
            <td class="px-3 py-2 text-right">
              <div class="flex items-center justify-end gap-1">
                <button @click="handleTest(acct.id)" :disabled="testingIds.has(acct.id)" class="h-6 rounded border border-zinc-200 px-2 text-[10px] text-zinc-600 hover:bg-zinc-50 disabled:opacity-50 transition-colors">
                  {{ testingIds.has(acct.id) ? '...' : '测试' }}
                </button>
                <button @click="handleToggle(acct)" class="h-6 rounded border px-2 text-[10px] transition-colors" :class="acct.disabled ? 'border-emerald-200 text-emerald-600 hover:bg-emerald-50' : 'border-amber-200 text-amber-600 hover:bg-amber-50'">
                  {{ acct.disabled ? '启用' : '禁用' }}
                </button>
                <button @click="handleDelete(acct)" class="h-6 rounded border border-red-200 px-2 text-[10px] text-red-500 hover:bg-red-50 transition-colors">删除</button>
              </div>
            </td>
          </tr>
          <tr v-if="paginatedAccounts.length === 0">
            <td colspan="9" class="px-3 py-8 text-center text-zinc-400">无匹配账号</td>
          </tr>
        </tbody>
      </table>

      <!-- Pagination -->
      <div v-if="totalPages > 1" class="flex items-center justify-between px-3 py-2 border-t border-zinc-100 bg-zinc-50/30">
        <div class="text-[10px] text-zinc-400">共 {{ filteredAccounts.length }} 个账号</div>
        <div class="flex items-center gap-1">
          <button @click="currentPage = Math.max(1, currentPage - 1)" :disabled="currentPage <= 1" class="h-6 w-6 rounded border border-zinc-200 text-[10px] text-zinc-600 hover:bg-zinc-50 disabled:opacity-30">&lt;</button>
          <span class="text-[10px] text-zinc-500 px-2">{{ currentPage }} / {{ totalPages }}</span>
          <button @click="currentPage = Math.min(totalPages, currentPage + 1)" :disabled="currentPage >= totalPages" class="h-6 w-6 rounded border border-zinc-200 text-[10px] text-zinc-600 hover:bg-zinc-50 disabled:opacity-30">&gt;</button>
        </div>
      </div>
    </div>

    <!-- Login Dialog -->
    <Teleport to="body">
      <div v-if="loginShowDialog" class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" @click.self="loginState === 'success' || loginState === 'error' ? handleCloseLoginDialog() : null">
        <div class="bg-white rounded-xl shadow-2xl w-[520px] max-h-[80vh] overflow-y-auto">
          <div class="flex items-center justify-between px-5 py-3 border-b border-zinc-100">
            <h3 class="text-sm font-semibold text-zinc-900">添加 Kiro 账号</h3>
            <span v-if="loginState === 'waiting'" class="text-xs text-zinc-400 font-mono">{{ formatCountdown(loginCountdown) }}</span>
          </div>

          <div class="px-5 py-4">
            <!-- Starting -->
            <div v-if="loginState === 'starting'" class="text-center py-8">
              <div class="animate-spin inline-block w-6 h-6 border-2 border-zinc-300 border-t-zinc-900 rounded-full mb-3" />
              <div class="text-xs text-zinc-500">正在初始化登录会话...</div>
            </div>

            <!-- Waiting for login -->
            <div v-else-if="loginState === 'waiting'" class="space-y-4">
              <div class="rounded-lg border border-amber-200 bg-amber-50 p-3">
                <div class="text-xs font-medium text-amber-800">ℹ️ 请在无痕模式中完成以下步骤</div>
              </div>

              <div class="space-y-3">
                <div>
                  <div class="text-xs font-medium text-zinc-700 mb-1.5">第 1 步：打开 SSH 隧道</div>
                  <div class="flex items-center gap-2">
                    <code class="flex-1 text-[11px] bg-zinc-50 rounded-md px-3 py-2 font-mono text-zinc-800 break-all select-all border border-zinc-200">{{ loginSshCmd }}</code>
                    <button class="shrink-0 h-7 px-2 text-[10px] rounded-md border border-zinc-200 hover:bg-zinc-50 transition-colors" @click="copyToClipboard(loginSshCmd, 'SSH')">{{ copySuccess === 'SSH' ? '✓' : '复制' }}</button>
                  </div>
                  <div class="text-[10px] text-zinc-400 mt-1">在 PowerShell / Terminal 中运行，密码 Adm@xz527，保持窗口不关</div>
                </div>

                <div>
                  <div class="text-xs font-medium text-zinc-700 mb-1.5">第 2 步：浏览器打开登录链接</div>
                  <div class="flex items-center gap-2">
                    <a :href="loginUrl" target="_blank" rel="noopener" class="flex-1 text-[11px] bg-zinc-50 rounded-md px-3 py-2 font-mono text-blue-600 break-all hover:underline select-all border border-zinc-200">{{ loginUrl }}</a>
                    <button class="shrink-0 h-7 px-2 text-[10px] rounded-md border border-zinc-200 hover:bg-zinc-50 transition-colors" @click="copyToClipboard(loginUrl, '链接')">{{ copySuccess === '链接' ? '✓' : '复制' }}</button>
                  </div>
                  <div class="text-[10px] text-zinc-400 mt-1">点击链接直接打开（无痕模式），用 Google 账号登录</div>
                </div>

                <div>
                  <div class="text-xs font-medium text-zinc-700 mb-1.5">第 3 步：等待自动检测</div>
                  <div class="flex items-center gap-2 text-[11px] text-zinc-500">
                    <div class="animate-pulse w-2 h-2 rounded-full bg-emerald-500" />
                    正在检测登录状态...（每 2 秒自动检查）
                  </div>
                </div>
              </div>
            </div>

            <!-- Completing -->
            <div v-else-if="loginState === 'completing'" class="text-center py-8">
              <div class="animate-spin inline-block w-6 h-6 border-2 border-emerald-300 border-t-emerald-600 rounded-full mb-3" />
              <div class="text-xs text-zinc-500">登录成功，正在上架到号池...</div>
            </div>

            <!-- Success -->
            <div v-else-if="loginState === 'success'" class="text-center py-6 space-y-3">
              <div class="text-3xl">🎉</div>
              <div class="text-sm font-medium text-emerald-600">账号添加成功！</div>
              <div v-if="loginResult" class="text-xs text-zinc-500">
                账号 ID: {{ loginResult.account_id }} · 文件: {{ loginResult.filename }}
              </div>
            </div>

            <!-- Error -->
            <div v-else-if="loginState === 'error'" class="text-center py-6 space-y-3">
              <div class="text-3xl">❌</div>
              <div class="text-sm font-medium text-red-600">添加失败</div>
              <div class="text-xs text-zinc-500">{{ loginError }}</div>
            </div>
          </div>

          <div class="flex justify-end gap-2 px-5 py-3 border-t border-zinc-100">
            <button v-if="loginState === 'waiting'" @click="handleCancelLogin" class="h-8 px-3 text-xs rounded-md border border-zinc-200 text-zinc-600 hover:bg-zinc-50 transition-colors">取消</button>
            <button v-if="loginState === 'success' || loginState === 'error'" @click="handleCloseLoginDialog" class="h-8 px-3 text-xs rounded-md bg-zinc-900 text-white hover:bg-zinc-800 transition-colors">关闭</button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
