<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { fetchGeminiPoolStatus, addGeminiAccount, disableGeminiAccount, enableGeminiAccount, deleteGeminiAccount, testGeminiAccount, setGeminiProxy, testGeminiGateway, fetchGeminiLogs, fetchGeminiLogStats } from '@/api'

const poolData = ref<any>({ total: 0, active: 0, accounts: [] })
const loading = ref(false)
const testLoading = ref(false)
const testResult = ref<any>(null)
const expandedLabel = ref<string | null>(null)

// Add dialog
const showAddDialog = ref(false)
const addForm = ref({ secure_1psid: '', secure_1psidts: '', label: '', proxy: '' })
const addLoading = ref(false)

// Proxy dialog
const showProxyDialog = ref(false)
const proxyTarget = ref<any>(null)
const proxyValue = ref('')

// Logs
const showLogs = ref(false)
const logs = ref<any[]>([])
const logStats = ref<any>({})
const logPage = ref(1)
const logTotal = ref(0)
const logLoading = ref(false)

const accounts = computed(() => poolData.value.accounts || [])
const stats = computed(() => {
  const accts = accounts.value
  return {
    total: poolData.value.total || 0,
    active: poolData.value.active || 0,
    requests: accts.reduce((s: number, a: any) => s + (a.total_requests || 0), 0),
    errors: accts.reduce((s: number, a: any) => s + (a.error_count || 0), 0),
    tokens: accts.reduce((s: number, a: any) => s + (a.total_tokens || 0), 0),
    disabled: accts.filter((a: any) => a.disabled).length,
  }
})

async function loadData() {
  loading.value = true
  try {
    const res = await fetchGeminiPoolStatus()
    poolData.value = res.data || res
  } catch (e: any) { console.error(e) }
  loading.value = false
}

async function handleTest() {
  testLoading.value = true; testResult.value = null
  try {
    const res = await testGeminiGateway()
    testResult.value = res.data || res
  } catch (e: any) { testResult.value = { ok: false, message: e.message } }
  testLoading.value = false
}

async function handleAdd() {
  if (!addForm.value.secure_1psid.trim()) return
  addLoading.value = true
  try {
    await addGeminiAccount(addForm.value)
    addForm.value = { secure_1psid: '', secure_1psidts: '', label: '', proxy: '' }
    showAddDialog.value = false
    await loadData()
  } catch (e: any) { alert(e.message || '添加失败') }
  addLoading.value = false
}

async function handleDisable(a: any) {
  if (!confirm(`确定禁用 ${a.label}？`)) return
  try { await disableGeminiAccount(a.label); await loadData() }
  catch (e: any) { alert(e.message) }
}
async function handleEnable(a: any) {
  try { await enableGeminiAccount(a.label); await loadData() }
  catch (e: any) { alert(e.message) }
}
async function handleDelete(a: any) {
  if (!confirm(`确定删除 ${a.label}？`)) return
  try { await deleteGeminiAccount(a.label); await loadData() }
  catch (e: any) { alert(e.message) }
}
async function handleTestAccount(a: any) {
  try {
    const res = await testGeminiAccount(a.label)
    const d = res.data || res
    alert(d.status === 'ok' ? `✅ ${a.label} 正常: ${d.response}` : `❌ ${a.label}: ${d.error}`)
  } catch (e: any) { alert(`❌ ${e.message}`) }
}

function openProxy(a: any) {
  proxyTarget.value = a; proxyValue.value = a.proxy || ''; showProxyDialog.value = true
}
async function saveProxy() {
  if (!proxyTarget.value) return
  try {
    await setGeminiProxy(proxyTarget.value.label, proxyValue.value.trim())
    showProxyDialog.value = false
    await loadData()
  } catch (e: any) { alert(e.message) }
}

async function loadLogs() {
  logLoading.value = true
  try {
    const [logsRes, statsRes] = await Promise.all([
      fetchGeminiLogs({ page: logPage.value, pageSize: 30 }),
      fetchGeminiLogStats(),
    ])
    const ld = logsRes.data || logsRes
    logs.value = ld.logs || []
    logTotal.value = ld.total || 0
    logStats.value = statsRes.data || statsRes
  } catch (e: any) { console.error(e) }
  logLoading.value = false
}

function toggleLogs() {
  showLogs.value = !showLogs.value
  if (showLogs.value) loadLogs()
}

function fmtTime(ts: number) {
  return new Date(ts * 1000).toLocaleString('zh-CN', { hour12: false })
}

onMounted(loadData)
</script>

<template>
  <div class="flex-1 overflow-y-auto p-6">
    <div class="max-w-5xl mx-auto">
      <!-- Header -->
      <div class="flex items-center justify-between mb-6">
        <div>
          <h1 class="text-xl font-semibold text-[#18181b]">Gemini Gateway 管理</h1>
          <p class="text-sm text-[#71717a] mt-0.5">管理 Gemini 号池 · Cookie 管理 · 代理配置 · 请求日志</p>
        </div>
        <div class="flex gap-2">
          <button class="btn-secondary" @click="loadData" :disabled="loading">{{ loading ? '...' : '🔄 刷新' }}</button>
          <button class="btn-secondary" @click="handleTest" :disabled="testLoading">{{ testLoading ? '...' : '🧪 测试' }}</button>
          <button class="btn-secondary" @click="toggleLogs">📊 日志</button>
          <button class="btn-primary" @click="showAddDialog = true">➕ 添加账号</button>
        </div>
      </div>

      <!-- Test result -->
      <div v-if="testResult" class="mb-4 px-4 py-3 rounded-xl border text-sm" :class="testResult.ok ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-red-50 border-red-200 text-red-700'">
        {{ testResult.ok ? `✅ 连通成功 · ${testResult.models || 0} 个模型` : `❌ ${testResult.message || '连通失败'}` }}
      </div>

      <!-- Stats -->
      <div class="grid grid-cols-5 gap-3 mb-6">
        <div class="stat-card"><div class="stat-label">总账号</div><div class="stat-value">{{ stats.total }}</div></div>
        <div class="stat-card"><div class="stat-label">活跃</div><div class="stat-value text-emerald-600">{{ stats.active }}</div></div>
        <div class="stat-card"><div class="stat-label">总请求</div><div class="stat-value">{{ stats.requests }}</div></div>
        <div class="stat-card"><div class="stat-label">总 Token</div><div class="stat-value">{{ (stats.tokens / 1000).toFixed(1) }}k</div></div>
        <div class="stat-card"><div class="stat-label">错误</div><div class="stat-value" :class="stats.errors > 0 ? 'text-red-600' : ''">{{ stats.errors }}</div></div>
      </div>

      <!-- Account List -->
      <div class="bg-white rounded-xl border border-[#e5e7eb] overflow-hidden">
        <div class="px-5 py-3 border-b border-[#e5e7eb] text-xs font-medium text-[#71717a] grid grid-cols-[100px_60px_80px_80px_1fr_50px_60px_120px] gap-2">
          <span>标签</span><span>状态</span><span>请求</span><span>Token</span><span>代理</span><span>错误</span><span>使用中</span><span>操作</span>
        </div>
        <div v-if="accounts.length === 0" class="px-5 py-8 text-center text-sm text-[#a1a1aa]">
          {{ loading ? '加载中...' : '暂无账号，点击"添加账号"' }}
        </div>
        <div v-for="a in accounts" :key="a.label">
          <div
            class="grid grid-cols-[100px_60px_80px_80px_1fr_50px_60px_120px] gap-2 px-5 py-3 items-center hover:bg-[#fafafa] cursor-pointer text-sm border-t border-[#f0f0f0]"
            @click="expandedLabel = expandedLabel === a.label ? null : a.label"
          >
            <div class="font-mono text-xs font-medium text-[#18181b] truncate">{{ a.label }}</div>
            <span class="text-xs px-1.5 py-0.5 rounded-full w-fit" :class="a.disabled ? 'text-red-600 bg-red-50' : 'text-emerald-600 bg-emerald-50'">
              {{ a.disabled ? '禁用' : '正常' }}
            </span>
            <div class="text-xs text-[#52525b]">{{ a.total_requests }}</div>
            <div class="text-xs text-[#52525b]">{{ (a.total_tokens / 1000).toFixed(1) }}k</div>
            <div class="text-xs text-[#71717a] truncate">{{ a.proxy || '直连' }}</div>
            <div class="text-xs" :class="a.error_count > 0 ? 'text-red-600 font-medium' : 'text-[#a1a1aa]'">{{ a.error_count }}</div>
            <div class="text-xs text-[#52525b]">{{ a.in_use }}</div>
            <div class="flex gap-1" @click.stop>
              <button class="op-btn text-blue-500 hover:bg-blue-50" title="测试" @click="handleTestAccount(a)">🔍</button>
              <button class="op-btn text-purple-500 hover:bg-purple-50" title="代理" @click="openProxy(a)">🌐</button>
              <button v-if="!a.disabled" class="op-btn text-amber-500 hover:bg-amber-50" title="禁用" @click="handleDisable(a)">⏸️</button>
              <button v-else class="op-btn text-emerald-500 hover:bg-emerald-50" title="启用" @click="handleEnable(a)">▶️</button>
              <button class="op-btn text-red-500 hover:bg-red-50" title="删除" @click="handleDelete(a)">🗑️</button>
            </div>
          </div>
          <!-- Expanded -->
          <div v-if="expandedLabel === a.label" class="px-5 py-4 bg-[#fafafa] border-t border-[#f0f0f0] text-xs text-[#52525b]">
            <div class="grid grid-cols-3 gap-4">
              <div><b>标签:</b> {{ a.label }}</div>
              <div><b>PSIDTS:</b> {{ a.has_psidts ? '✅ 已配置' : '❌ 未配置' }}</div>
              <div><b>代理:</b> {{ a.proxy || '无' }}</div>
              <div><b>总请求:</b> {{ a.total_requests }}</div>
              <div><b>总 Token:</b> {{ a.total_tokens }}</div>
              <div><b>错误次数:</b> {{ a.error_count }}</div>
              <div><b>最后使用:</b> {{ a.last_used ? fmtTime(a.last_used) : '从未' }}</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Logs Panel -->
      <div v-if="showLogs" class="mt-6">
        <div class="flex items-center justify-between mb-3">
          <h2 class="text-lg font-semibold text-[#18181b]">请求日志</h2>
          <div class="flex gap-2 text-xs text-[#71717a]">
            <span>总请求: {{ logStats.total_requests || 0 }}</span>
            <span>·</span>
            <span>总 Token: {{ ((logStats.total_tokens || 0) / 1000).toFixed(1) }}k</span>
            <span>·</span>
            <span>错误率: {{ logStats.error_rate || 0 }}%</span>
            <button class="ml-2 btn-secondary text-xs" @click="loadLogs" :disabled="logLoading">刷新</button>
          </div>
        </div>
        <div class="bg-white rounded-xl border border-[#e5e7eb] overflow-hidden">
          <div class="px-4 py-2 border-b border-[#e5e7eb] text-[11px] font-medium text-[#71717a] grid grid-cols-[140px_80px_100px_70px_70px_60px_50px_1fr] gap-2">
            <span>时间</span><span>账号</span><span>模型</span><span>Prompt</span><span>Completion</span><span>耗时</span><span>状态</span><span>IP</span>
          </div>
          <div v-if="logs.length === 0" class="px-4 py-6 text-center text-sm text-[#a1a1aa]">暂无日志</div>
          <div v-for="l in logs" :key="l.id" class="grid grid-cols-[140px_80px_100px_70px_70px_60px_50px_1fr] gap-2 px-4 py-2 text-xs border-t border-[#f0f0f0] hover:bg-[#fafafa]">
            <div class="text-[#52525b]">{{ fmtTime(l.timestamp) }}</div>
            <div class="font-mono text-[#18181b]">{{ l.account }}</div>
            <div class="text-[#52525b]">{{ l.model }}</div>
            <div>{{ l.prompt_tokens }}</div>
            <div>{{ l.completion_tokens }}</div>
            <div>{{ l.duration_ms }}ms</div>
            <div :class="l.status === 'ok' ? 'text-emerald-600' : 'text-red-600'">{{ l.status }}</div>
            <div class="text-[#a1a1aa] truncate">{{ l.client_ip }}</div>
          </div>
        </div>
        <!-- Pagination -->
        <div v-if="logTotal > 30" class="flex justify-center gap-2 mt-3">
          <button class="btn-secondary text-xs" :disabled="logPage <= 1" @click="logPage--; loadLogs()">上一页</button>
          <span class="text-xs text-[#71717a] py-1">{{ logPage }} / {{ Math.ceil(logTotal / 30) }}</span>
          <button class="btn-secondary text-xs" :disabled="logPage >= Math.ceil(logTotal / 30)" @click="logPage++; loadLogs()">下一页</button>
        </div>
      </div>

      <!-- Info -->
      <div class="mt-6 px-4 py-3 bg-[#f4f4f5] rounded-xl text-xs text-[#71717a] space-y-1">
        <p>💡 获取 Cookie：登录 <a href="https://gemini.google.com" target="_blank" class="underline">gemini.google.com</a> → F12 → Network → 复制 <code class="bg-white px-1 rounded">__Secure-1PSID</code> 和 <code class="bg-white px-1 rounded">__Secure-1PSIDTS</code></p>
        <p>🌐 代理格式：<code class="bg-white px-1 rounded">http://user:pass@host:port</code> 或 <code class="bg-white px-1 rounded">socks5://host:port</code></p>
        <p>🔄 Cookie 自动续期，长时间不用可能需要重新获取。建议用无痕模式登录获取 Cookie。</p>
      </div>
    </div>

    <!-- Add Dialog -->
    <Teleport to="body">
      <div v-if="showAddDialog" class="fixed inset-0 z-50 flex items-center justify-center bg-black/30" @click.self="showAddDialog = false">
        <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6">
          <h2 class="text-lg font-semibold text-[#18181b] mb-4">添加 Gemini 账号</h2>
          <div class="space-y-3">
            <div>
              <label class="block text-xs font-medium text-[#52525b] mb-1">__Secure-1PSID *</label>
              <textarea v-model="addForm.secure_1psid" rows="2" class="input-field" placeholder="从 Cookie 中复制"></textarea>
            </div>
            <div>
              <label class="block text-xs font-medium text-[#52525b] mb-1">__Secure-1PSIDTS</label>
              <input v-model="addForm.secure_1psidts" class="input-field" placeholder="可选，部分账号需要" />
            </div>
            <div>
              <label class="block text-xs font-medium text-[#52525b] mb-1">标签</label>
              <input v-model="addForm.label" class="input-field" placeholder="例如：google-01" />
            </div>
            <div>
              <label class="block text-xs font-medium text-[#52525b] mb-1">代理</label>
              <input v-model="addForm.proxy" class="input-field" placeholder="http://host:port 或留空直连" />
            </div>
          </div>
          <div class="flex gap-2 mt-4">
            <button class="btn-secondary flex-1 justify-center" @click="showAddDialog = false">取消</button>
            <button class="btn-primary flex-1 justify-center" :disabled="addLoading || !addForm.secure_1psid.trim()" @click="handleAdd">{{ addLoading ? '...' : '添加' }}</button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- Proxy Dialog -->
    <Teleport to="body">
      <div v-if="showProxyDialog" class="fixed inset-0 z-50 flex items-center justify-center bg-black/30" @click.self="showProxyDialog = false">
        <div class="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-6">
          <h2 class="text-lg font-semibold text-[#18181b] mb-4">配置代理 — {{ proxyTarget?.label }}</h2>
          <input v-model="proxyValue" class="input-field" placeholder="http://host:port 或留空直连" />
          <div class="flex gap-2 mt-4">
            <button class="btn-secondary flex-1 justify-center" @click="showProxyDialog = false">取消</button>
            <button class="btn-primary flex-1 justify-center" @click="saveProxy">保存</button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.btn-primary { @apply inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-[#18181b] text-white rounded-md hover:bg-[#27272a] transition-colors disabled:opacity-50 disabled:cursor-not-allowed; }
.btn-secondary { @apply inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-[#e5e7eb] text-[#52525b] rounded-md hover:bg-[#f4f4f5] transition-colors; }
.stat-card { @apply bg-white rounded-xl border border-[#e5e7eb] px-4 py-3; }
.stat-label { @apply text-[11px] text-[#71717a] font-medium; }
.stat-value { @apply text-2xl font-semibold text-[#18181b] mt-0.5; }
.op-btn { @apply p-1 rounded text-xs; }
.input-field { @apply w-full px-3 py-2 bg-[#f4f4f5] border border-[#e5e7eb] rounded-xl text-xs outline-none focus:border-[#999]; }
</style>
