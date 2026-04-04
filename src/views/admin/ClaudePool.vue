<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { fetchClewdrCookies, addClewdrCookie, deleteClewdrCookie, testClewdr } from '@/api'

const cookieData = ref<any>({ valid: [], exhausted: [], invalid: [] })
const loading = ref(false)
const testLoading = ref(false)
const testResult = ref<any>(null)

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

// Average quota utilization across all valid cookies
const avgQuota = computed(() => {
  const valid = cookieData.value.valid || []
  if (valid.length === 0) return { session: 0, weekly: 0 }
  const session = valid.reduce((s: number, c: any) => s + (c.session_utilization || 0), 0) / valid.length
  const weekly = valid.reduce((s: number, c: any) => s + (c.seven_day_utilization || 0), 0) / valid.length
  return { session: Math.round(session), weekly: Math.round(weekly) }
})

async function loadData() {
  loading.value = true
  try { cookieData.value = await fetchClewdrCookies() }
  catch (e: any) { console.error('Failed to load cookies:', e) }
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
  } catch (e: any) { alert(e.message || '添加失败') }
  addLoading.value = false
}

async function handleDelete(cookie: any) {
  const cookieStr = cookie.cookie || cookie.cookie_str
  if (!cookieStr) return
  if (!confirm(`确定删除 ...${cookieStr.slice(-20)}？`)) return
  try { await deleteClewdrCookie(cookieStr); await loadData() }
  catch (e: any) { alert(e.message || '删除失败') }
}

async function handleTest() {
  testLoading.value = true
  testResult.value = null
  try { testResult.value = await testClewdr() }
  catch (e: any) { testResult.value = { ok: false, content: e.message } }
  testLoading.value = false
}

function ellipse(s: string, n = 20) {
  return !s ? '-' : s.length > n ? s.slice(0, n) + '...' : s
}

function statusLabel(s: string) {
  return s === 'valid' ? '可用' : s === 'exhausted' ? '耗尽' : '无效'
}
function statusColor(s: string) {
  return s === 'valid' ? 'text-emerald-600 bg-emerald-50' : s === 'exhausted' ? 'text-amber-600 bg-amber-50' : 'text-red-600 bg-red-50'
}

function quotaColor(pct: number) {
  if (pct >= 80) return 'text-red-600'
  if (pct >= 50) return 'text-amber-600'
  return 'text-emerald-600'
}
function barColor(pct: number) {
  if (pct >= 80) return 'bg-red-500'
  if (pct >= 50) return 'bg-amber-500'
  return 'bg-emerald-500'
}

function formatTokens(n: number) {
  if (!n) return '0'
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M'
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K'
  return String(n)
}

function formatTime(iso: string) {
  if (!iso) return '-'
  try { return new Date(iso).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) }
  catch { return '-' }
}

const expandedCookie = ref<string | null>(null)
</script>

<template>
  <div class="flex-1 overflow-y-auto p-6">
    <div class="max-w-5xl mx-auto">
      <!-- Header -->
      <div class="flex items-center justify-between mb-6">
        <div>
          <h1 class="text-xl font-semibold text-[#18181b]">ClewdR 账号管理</h1>
          <p class="text-sm text-[#71717a] mt-0.5">管理 Claude 订阅账号 · 配额监控 · Cookie + 代理</p>
        </div>
        <div class="flex gap-2">
          <button class="btn-secondary" @click="loadData" :disabled="loading">{{ loading ? '加载中...' : '🔄 刷新' }}</button>
          <button class="btn-secondary" @click="handleTest" :disabled="testLoading">{{ testLoading ? '测试中...' : '🧪 测试' }}</button>
          <button class="btn-primary" @click="showAddDialog = true">➕ 添加账号</button>
        </div>
      </div>

      <!-- Test result -->
      <div v-if="testResult" class="mb-4 px-4 py-3 rounded-xl border text-sm" :class="testResult.ok ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-red-50 border-red-200 text-red-700'">
        {{ testResult.ok ? '✅ 连通成功' : '❌ 连通失败' }}：{{ testResult.content || testResult.statusCode }}
      </div>

      <!-- Stats + Quota Overview -->
      <div class="grid grid-cols-6 gap-3 mb-6">
        <div v-for="(v, k) in { '总计': stats.total, '可用': stats.valid, '耗尽': stats.exhausted, '无效': stats.invalid }" :key="k" class="bg-white rounded-xl border border-[#e5e7eb] px-4 py-3">
          <div class="text-[11px] text-[#71717a] font-medium">{{ k }}</div>
          <div class="text-2xl font-semibold text-[#18181b] mt-0.5">{{ v }}</div>
        </div>
        <!-- Average Session Quota -->
        <div class="bg-white rounded-xl border border-[#e5e7eb] px-4 py-3">
          <div class="text-[11px] text-[#71717a] font-medium">会话配额(均)</div>
          <div class="text-2xl font-semibold mt-0.5" :class="quotaColor(avgQuota.session)">{{ avgQuota.session }}%</div>
          <div class="w-full h-1.5 bg-[#f0f0f0] rounded-full mt-1.5">
            <div class="h-full rounded-full transition-all" :class="barColor(avgQuota.session)" :style="{ width: Math.min(avgQuota.session, 100) + '%' }" />
          </div>
        </div>
        <!-- Average Weekly Quota -->
        <div class="bg-white rounded-xl border border-[#e5e7eb] px-4 py-3">
          <div class="text-[11px] text-[#71717a] font-medium">7天配额(均)</div>
          <div class="text-2xl font-semibold mt-0.5" :class="quotaColor(avgQuota.weekly)">{{ avgQuota.weekly }}%</div>
          <div class="w-full h-1.5 bg-[#f0f0f0] rounded-full mt-1.5">
            <div class="h-full rounded-full transition-all" :class="barColor(avgQuota.weekly)" :style="{ width: Math.min(avgQuota.weekly, 100) + '%' }" />
          </div>
        </div>
      </div>

      <!-- Cookie List -->
      <div class="bg-white rounded-xl border border-[#e5e7eb] overflow-hidden">
        <div class="px-5 py-3 border-b border-[#e5e7eb] text-xs font-medium text-[#71717a] grid grid-cols-[1fr_60px_90px_90px_90px_50px] gap-2">
          <span>Cookie</span><span>状态</span><span>会话配额</span><span>7天配额</span><span>代理</span><span>操作</span>
        </div>
        <div v-if="allCookies.length === 0" class="px-5 py-8 text-center text-sm text-[#a1a1aa]">
          {{ loading ? '加载中...' : '暂无账号，点击"添加账号"开始' }}
        </div>
        <div v-for="c in allCookies" :key="c.cookie">
          <div
            class="grid grid-cols-[1fr_60px_90px_90px_90px_50px] gap-2 px-5 py-3 items-center hover:bg-[#fafafa] cursor-pointer text-sm border-t border-[#f0f0f0]"
            @click="expandedCookie = expandedCookie === c.cookie ? null : c.cookie"
          >
            <!-- Cookie -->
            <div class="truncate font-mono text-xs text-[#18181b]">...{{ c.cookie.slice(-24) }}</div>
            <!-- Status -->
            <span class="text-xs px-2 py-0.5 rounded-full w-fit" :class="statusColor(c._status)">{{ statusLabel(c._status) }}</span>
            <!-- Session Quota -->
            <div class="flex items-center gap-1.5">
              <div class="flex-1 h-1.5 bg-[#f0f0f0] rounded-full">
                <div class="h-full rounded-full transition-all" :class="barColor(c.session_utilization || 0)" :style="{ width: Math.min(c.session_utilization || 0, 100) + '%' }" />
              </div>
              <span class="text-[11px] font-medium w-8 text-right" :class="quotaColor(c.session_utilization || 0)">{{ c.session_utilization || 0 }}%</span>
            </div>
            <!-- 7-day Quota -->
            <div class="flex items-center gap-1.5">
              <div class="flex-1 h-1.5 bg-[#f0f0f0] rounded-full">
                <div class="h-full rounded-full transition-all" :class="barColor(c.seven_day_utilization || 0)" :style="{ width: Math.min(c.seven_day_utilization || 0, 100) + '%' }" />
              </div>
              <span class="text-[11px] font-medium w-8 text-right" :class="quotaColor(c.seven_day_utilization || 0)">{{ c.seven_day_utilization || 0 }}%</span>
            </div>
            <!-- Proxy -->
            <div class="text-xs text-[#71717a] truncate">{{ c.proxy || '全局' }}</div>
            <!-- Actions -->
            <div><button class="p-1 hover:bg-red-50 rounded text-red-500" title="删除" @click.stop="handleDelete(c)">🗑️</button></div>
          </div>

          <!-- Expanded Detail -->
          <div v-if="expandedCookie === c.cookie" class="px-5 py-4 bg-[#fafafa] border-t border-[#f0f0f0] text-xs text-[#52525b]">
            <div class="grid grid-cols-2 gap-x-8 gap-y-2">
              <!-- Left Column: Quota Details -->
              <div class="space-y-3">
                <div class="text-[11px] font-semibold text-[#18181b] uppercase tracking-wide">配额详情</div>

                <!-- Session Window -->
                <div>
                  <div class="flex justify-between mb-1">
                    <span>会话窗口 (5h)</span>
                    <span class="font-medium" :class="quotaColor(c.session_utilization || 0)">{{ c.session_utilization || 0 }}%</span>
                  </div>
                  <div class="w-full h-2 bg-[#e5e7eb] rounded-full">
                    <div class="h-full rounded-full transition-all" :class="barColor(c.session_utilization || 0)" :style="{ width: Math.min(c.session_utilization || 0, 100) + '%' }" />
                  </div>
                  <div class="text-[10px] text-[#a1a1aa] mt-0.5">重置: {{ formatTime(c.session_resets_at) }}</div>
                </div>

                <!-- 7-day Window -->
                <div>
                  <div class="flex justify-between mb-1">
                    <span>7天窗口</span>
                    <span class="font-medium" :class="quotaColor(c.seven_day_utilization || 0)">{{ c.seven_day_utilization || 0 }}%</span>
                  </div>
                  <div class="w-full h-2 bg-[#e5e7eb] rounded-full">
                    <div class="h-full rounded-full transition-all" :class="barColor(c.seven_day_utilization || 0)" :style="{ width: Math.min(c.seven_day_utilization || 0, 100) + '%' }" />
                  </div>
                  <div class="text-[10px] text-[#a1a1aa] mt-0.5">重置: {{ formatTime(c.seven_day_resets_at) }}</div>
                </div>

                <!-- Opus/Sonnet separate -->
                <div v-if="c.seven_day_opus_utilization > 0 || c.seven_day_sonnet_utilization > 0" class="space-y-2">
                  <div v-if="c.seven_day_opus_utilization !== undefined">
                    <div class="flex justify-between mb-0.5">
                      <span>Opus 7天</span>
                      <span class="font-medium" :class="quotaColor(c.seven_day_opus_utilization || 0)">{{ c.seven_day_opus_utilization || 0 }}%</span>
                    </div>
                    <div class="w-full h-1.5 bg-[#e5e7eb] rounded-full">
                      <div class="h-full rounded-full bg-purple-500" :style="{ width: Math.min(c.seven_day_opus_utilization || 0, 100) + '%' }" />
                    </div>
                  </div>
                  <div v-if="c.seven_day_sonnet_utilization !== undefined">
                    <div class="flex justify-between mb-0.5">
                      <span>Sonnet 7天</span>
                      <span class="font-medium" :class="quotaColor(c.seven_day_sonnet_utilization || 0)">{{ c.seven_day_sonnet_utilization || 0 }}%</span>
                    </div>
                    <div class="w-full h-1.5 bg-[#e5e7eb] rounded-full">
                      <div class="h-full rounded-full bg-blue-500" :style="{ width: Math.min(c.seven_day_sonnet_utilization || 0, 100) + '%' }" />
                    </div>
                  </div>
                </div>
              </div>

              <!-- Right Column: Account Info -->
              <div class="space-y-2">
                <div class="text-[11px] font-semibold text-[#18181b] uppercase tracking-wide">账号信息</div>
                <div><b>Cookie:</b> <span class="font-mono break-all select-all">{{ c.cookie }}</span></div>
                <div v-if="c.proxy"><b>独立代理:</b> {{ c.proxy }}</div>
                <div v-if="c.token"><b>OAuth Token:</b> {{ ellipse(c.token?.access_token || '-', 40) }}</div>
                <div>
                  <b>模型支持:</b>
                  <span v-if="c.supports_claude_1m_sonnet" class="ml-1 text-[10px] px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded">1M Sonnet ✅</span>
                  <span v-if="c.supports_claude_1m_opus" class="ml-1 text-[10px] px-1.5 py-0.5 bg-purple-50 text-purple-600 rounded">1M Opus ✅</span>
                </div>

                <!-- Token Usage -->
                <div class="mt-2 text-[11px] font-semibold text-[#18181b] uppercase tracking-wide">Token 用量</div>
                <div class="grid grid-cols-3 gap-2 text-center">
                  <div class="bg-white rounded-lg border border-[#e5e7eb] p-2">
                    <div class="text-[10px] text-[#a1a1aa]">会话</div>
                    <div class="text-xs font-medium">↑{{ formatTokens(c.session_usage?.total_input_tokens || 0) }}</div>
                    <div class="text-xs font-medium">↓{{ formatTokens(c.session_usage?.total_output_tokens || 0) }}</div>
                  </div>
                  <div class="bg-white rounded-lg border border-[#e5e7eb] p-2">
                    <div class="text-[10px] text-[#a1a1aa]">本周</div>
                    <div class="text-xs font-medium">↑{{ formatTokens(c.weekly_usage?.total_input_tokens || 0) }}</div>
                    <div class="text-xs font-medium">↓{{ formatTokens(c.weekly_usage?.total_output_tokens || 0) }}</div>
                  </div>
                  <div class="bg-white rounded-lg border border-[#e5e7eb] p-2">
                    <div class="text-[10px] text-[#a1a1aa]">累计</div>
                    <div class="text-xs font-medium">↑{{ formatTokens(c.lifetime_usage?.total_input_tokens || 0) }}</div>
                    <div class="text-xs font-medium">↓{{ formatTokens(c.lifetime_usage?.total_output_tokens || 0) }}</div>
                  </div>
                </div>

                <!-- Per-model usage -->
                <div v-if="(c.session_usage?.opus_input_tokens || 0) + (c.session_usage?.sonnet_input_tokens || 0) > 0" class="grid grid-cols-2 gap-2 text-center">
                  <div class="bg-purple-50 rounded-lg p-1.5">
                    <div class="text-[10px] text-purple-500">Opus</div>
                    <div class="text-[11px] font-medium text-purple-700">↑{{ formatTokens(c.session_usage?.opus_input_tokens || 0) }} ↓{{ formatTokens(c.session_usage?.opus_output_tokens || 0) }}</div>
                  </div>
                  <div class="bg-blue-50 rounded-lg p-1.5">
                    <div class="text-[10px] text-blue-500">Sonnet</div>
                    <div class="text-[11px] font-medium text-blue-700">↑{{ formatTokens(c.session_usage?.sonnet_input_tokens || 0) }} ↓{{ formatTokens(c.session_usage?.sonnet_output_tokens || 0) }}</div>
                  </div>
                </div>
              </div>
            </div>
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
            <textarea v-model="cookieInput" rows="3" class="w-full px-3 py-2 bg-[#f4f4f5] border border-[#e5e7eb] rounded-xl text-xs font-mono outline-none focus:border-[#999]" placeholder="sk-ant-sid02-..." />
            <p class="text-[10px] text-[#a1a1aa] mt-1">浏览器 F12 → Application → Cookies → claude.ai → 复制 sessionKey</p>
          </div>
          <div class="mb-4">
            <label class="block text-xs font-medium text-[#52525b] mb-1">独立代理 (可选)</label>
            <input v-model="proxyInput" class="w-full px-3 py-2 bg-[#f4f4f5] border border-[#e5e7eb] rounded-xl text-xs outline-none focus:border-[#999]" placeholder="socks5://user:pass@host:port" />
            <p class="text-[10px] text-[#a1a1aa] mt-1">不填则使用全局代理。建议每个账号配独立固定 IP</p>
          </div>
          <div class="flex gap-2">
            <button class="btn-secondary flex-1 justify-center" @click="showAddDialog = false">取消</button>
            <button class="btn-primary flex-1 justify-center" :disabled="addLoading || !cookieInput.trim()" @click="handleAdd">{{ addLoading ? '添加中...' : '添加' }}</button>
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
