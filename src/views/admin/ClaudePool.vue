<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { fetchClewdrCookies, addClewdrCookie, deleteClewdrCookie, testClewdr } from '@/api'

const cookieData = ref<any>({ valid: [], exhausted: [], invalid: [] })
const loading = ref(false)
const testLoading = ref(false)
const testResult = ref<any>(null)

// Add dialog
const showAddDialog = ref(false)
const cookieInput = ref('')
const proxyInput = ref('')
const addLoading = ref(false)

const allCookies = computed(() => {
  const valid = (cookieData.value.valid || []).map((c: any) => ({ ...c, _status: 'valid' }))
  const exhausted = (cookieData.value.exhausted || []).map((c: any) => ({ ...c, _status: 'exhausted' }))
  const invalid = (cookieData.value.invalid || []).map((c: any) => ({ ...c, _status: 'invalid' }))
  return [...valid, ...exhausted, ...invalid]
})

const stats = computed(() => ({
  total: allCookies.value.length,
  valid: (cookieData.value.valid || []).length,
  exhausted: (cookieData.value.exhausted || []).length,
  invalid: (cookieData.value.invalid || []).length,
}))

async function loadData() {
  loading.value = true
  try {
    cookieData.value = await fetchClewdrCookies()
  } catch (e: any) {
    console.error('Failed to load cookies:', e)
  }
  loading.value = false
}

onMounted(loadData)

async function handleAdd() {
  const cookie = cookieInput.value.trim()
  if (!cookie) return
  addLoading.value = true
  try {
    await addClewdrCookie(cookie, proxyInput.value.trim() || undefined)
    cookieInput.value = ''
    proxyInput.value = ''
    showAddDialog.value = false
    await loadData()
  } catch (e: any) {
    alert(e.message || '添加失败')
  }
  addLoading.value = false
}

async function handleDelete(cookie: any) {
  const cookieStr = cookie.cookie || cookie.cookie_str
  if (!cookieStr) return
  const short = cookieStr.slice(0, 30) + '...'
  if (!confirm(`确定删除 ${short}？`)) return
  try {
    await deleteClewdrCookie(cookieStr)
    await loadData()
  } catch (e: any) {
    alert(e.message || '删除失败')
  }
}

async function handleTest() {
  testLoading.value = true
  testResult.value = null
  try {
    testResult.value = await testClewdr()
  } catch (e: any) {
    testResult.value = { ok: false, content: e.message }
  }
  testLoading.value = false
}

function ellipse(s: string, n = 20) {
  if (!s) return '-'
  return s.length > n ? s.slice(0, n) + '...' : s
}

function statusLabel(s: string) {
  if (s === 'valid') return '可用'
  if (s === 'exhausted') return '耗尽'
  return '无效'
}

function statusColor(s: string) {
  if (s === 'valid') return 'text-emerald-600 bg-emerald-50'
  if (s === 'exhausted') return 'text-amber-600 bg-amber-50'
  return 'text-red-600 bg-red-50'
}

function formatUsage(u: any) {
  if (!u) return '-'
  const input = u.total_input_tokens || 0
  const output = u.total_output_tokens || 0
  if (input === 0 && output === 0) return '-'
  return `↑${(input / 1000).toFixed(1)}K ↓${(output / 1000).toFixed(1)}K`
}

// Expanded row
const expandedCookie = ref<string | null>(null)
</script>

<template>
  <div class="flex-1 overflow-y-auto p-6">
    <div class="max-w-5xl mx-auto">
      <!-- Header -->
      <div class="flex items-center justify-between mb-6">
        <div>
          <h1 class="text-xl font-semibold text-[#18181b]">ClewdR 账号管理</h1>
          <p class="text-sm text-[#71717a] mt-0.5">管理 Claude 订阅账号 · Cookie + 代理</p>
        </div>
        <div class="flex gap-2">
          <button class="btn-secondary" @click="loadData" :disabled="loading">
            {{ loading ? '加载中...' : '🔄 刷新' }}
          </button>
          <button class="btn-secondary" @click="handleTest" :disabled="testLoading">
            {{ testLoading ? '测试中...' : '🧪 测试连通' }}
          </button>
          <button class="btn-primary" @click="showAddDialog = true">
            ➕ 添加账号
          </button>
        </div>
      </div>

      <!-- Test result -->
      <div v-if="testResult" class="mb-4 px-4 py-3 rounded-xl border text-sm" :class="testResult.ok ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-red-50 border-red-200 text-red-700'">
        {{ testResult.ok ? '✅ 连通成功' : '❌ 连通失败' }}：{{ testResult.content || testResult.statusCode }}
      </div>

      <!-- Stats -->
      <div class="grid grid-cols-4 gap-3 mb-6">
        <div v-for="(v, k) in { '总计': stats.total, '可用': stats.valid, '耗尽': stats.exhausted, '无效': stats.invalid }" :key="k" class="bg-white rounded-xl border border-[#e5e7eb] px-4 py-3">
          <div class="text-[11px] text-[#71717a] font-medium">{{ k }}</div>
          <div class="text-2xl font-semibold text-[#18181b] mt-0.5">{{ v }}</div>
        </div>
      </div>

      <!-- Cookie List -->
      <div class="bg-white rounded-xl border border-[#e5e7eb] overflow-hidden">
        <div class="px-5 py-3 border-b border-[#e5e7eb] text-xs font-medium text-[#71717a] grid grid-cols-[1fr_70px_100px_100px_60px] gap-2">
          <span>Cookie</span><span>状态</span><span>代理</span><span>用量</span><span>操作</span>
        </div>
        <div v-if="allCookies.length === 0" class="px-5 py-8 text-center text-sm text-[#a1a1aa]">
          {{ loading ? '加载中...' : '暂无账号，点击"添加账号"开始' }}
        </div>
        <div v-for="c in allCookies" :key="c.cookie">
          <div
            class="grid grid-cols-[1fr_70px_100px_100px_60px] gap-2 px-5 py-3 items-center hover:bg-[#fafafa] cursor-pointer text-sm border-t border-[#f0f0f0]"
            @click="expandedCookie = expandedCookie === c.cookie ? null : c.cookie"
          >
            <div class="truncate font-mono text-xs text-[#18181b]">{{ ellipse(c.cookie, 35) }}</div>
            <span class="text-xs px-2 py-0.5 rounded-full w-fit" :class="statusColor(c._status)">{{ statusLabel(c._status) }}</span>
            <div class="text-xs text-[#71717a] truncate">{{ c.proxy || '全局' }}</div>
            <div class="text-xs text-[#71717a]">{{ formatUsage(c.lifetime_usage) }}</div>
            <div class="flex gap-1">
              <button class="p-1 hover:bg-red-50 rounded text-red-500" title="删除" @click.stop="handleDelete(c)">🗑️</button>
            </div>
          </div>
          <!-- Expanded detail -->
          <div v-if="expandedCookie === c.cookie" class="px-5 py-3 bg-[#fafafa] border-t border-[#f0f0f0] text-xs text-[#52525b] space-y-1">
            <div><b>Cookie:</b> <span class="font-mono break-all">{{ c.cookie }}</span></div>
            <div v-if="c.proxy"><b>独立代理:</b> {{ c.proxy }}</div>
            <div v-if="c.token"><b>OAuth Token:</b> {{ ellipse(c.token?.access_token || '-', 40) }}</div>
            <div v-if="c.reset_time"><b>重置时间:</b> {{ new Date(c.reset_time * 1000).toLocaleString('zh-CN') }}</div>
            <div><b>Session 用量:</b> {{ formatUsage(c.session_usage) }}</div>
            <div><b>周用量:</b> {{ formatUsage(c.weekly_usage) }}</div>
            <div><b>总用量:</b> {{ formatUsage(c.lifetime_usage) }}</div>
            <div v-if="c.supports_claude_1m_sonnet !== undefined"><b>1M Sonnet:</b> {{ c.supports_claude_1m_sonnet ? '✅' : '❌' }}</div>
            <div v-if="c.supports_claude_1m_opus !== undefined"><b>1M Opus:</b> {{ c.supports_claude_1m_opus ? '✅' : '❌' }}</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Add Account Dialog -->
    <Teleport to="body">
      <div v-if="showAddDialog" class="fixed inset-0 z-50 flex items-center justify-center bg-black/30" @click.self="showAddDialog = false">
        <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6">
          <h2 class="text-lg font-semibold text-[#18181b] mb-4">添加 Claude 账号</h2>

          <div class="mb-3">
            <label class="block text-xs font-medium text-[#52525b] mb-1">Session Cookie</label>
            <textarea
              v-model="cookieInput"
              rows="3"
              class="w-full px-3 py-2 bg-[#f4f4f5] border border-[#e5e7eb] rounded-xl text-xs font-mono outline-none focus:border-[#999]"
              placeholder="sk-ant-sid02-..."
            />
            <p class="text-[10px] text-[#a1a1aa] mt-1">从浏览器 DevTools → Application → Cookies 中复制 sessionKey 的值</p>
          </div>

          <div class="mb-4">
            <label class="block text-xs font-medium text-[#52525b] mb-1">独立代理 (可选)</label>
            <input
              v-model="proxyInput"
              class="w-full px-3 py-2 bg-[#f4f4f5] border border-[#e5e7eb] rounded-xl text-xs outline-none focus:border-[#999]"
              placeholder="socks5://user:pass@host:port"
            />
            <p class="text-[10px] text-[#a1a1aa] mt-1">不填则使用全局代理。建议每个账号用不同的固定 IP</p>
          </div>

          <div class="flex gap-2">
            <button class="btn-secondary flex-1 justify-center" @click="showAddDialog = false">取消</button>
            <button class="btn-primary flex-1 justify-center" :disabled="addLoading || !cookieInput.trim()" @click="handleAdd">
              {{ addLoading ? '添加中...' : '添加' }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.btn-primary { @apply inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-[#18181b] text-white rounded-md hover:bg-[#27272a] transition-colors disabled:opacity-50 disabled:cursor-not-allowed; }
.btn-secondary { @apply inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-[#e5e7eb] text-[#52525b] rounded-md hover:bg-[#f4f4f5] transition-colors; }
</style>
