<script setup lang="ts">
import { ref, onMounted } from 'vue'
import Icon from '@/components/common/Icon.vue'
import {
  fetchPoolStats, fetchPoolAccounts, syncPool,
  removePoolAccount, updatePoolAccount, refreshPoolAccount,
  refreshAllPoolAccounts, startOAuth, completeOAuth,
  fetchAllQuotas,
} from '@/api'

// ── State ──
const stats = ref({ total: 0, active: 0, expired: 0, error: 0, disabled: 0 })
const accounts = ref<any[]>([])
const quotas = ref<Record<string, any>>({}) // keyed by account id
const loading = ref(false)
const quotaLoading = ref(false)
const oauthUrl = ref('')
const oauthState = ref('')
const showOAuthDialog = ref(false)
const pasteUrl = ref('')
const oauthLoading = ref(false)
const editProxy = ref<{ id: string; proxy: string } | null>(null)

// ── Load data ──
async function loadData() {
  loading.value = true
  try {
    const [s, a] = await Promise.all([fetchPoolStats(), fetchPoolAccounts()])
    stats.value = s
    accounts.value = a
  } catch {}
  loading.value = false
}

async function loadQuotas() {
  quotaLoading.value = true
  try {
    const list = await fetchAllQuotas()
    const map: Record<string, any> = {}
    for (const q of list) map[q.id] = q
    quotas.value = map
  } catch {}
  quotaLoading.value = false
}

onMounted(async () => {
  await loadData()
  loadQuotas() // load quotas in background (takes a few seconds per account)
})

// ── Actions ──
async function handleSync() {
  loading.value = true
  try {
    const result = await syncPool()
    await loadData()
    if (result.synced > 0) alert(`同步成功，导入 ${result.synced} 个账号`)
    else alert('没有新账号可同步')
  } catch (e: any) { alert(e.message) }
  loading.value = false
}

async function handleRefreshAll() {
  loading.value = true
  try {
    const result = await refreshAllPoolAccounts()
    await loadData()
    alert(`刷新完成：${result.refreshed} 成功，${result.failed} 失败`)
  } catch (e: any) { alert(e.message) }
  loading.value = false
}

async function handleRefreshQuotas() {
  await loadQuotas()
}

async function handleRefreshOne(id: string) {
  try {
    await refreshPoolAccount(id)
    await loadData()
  } catch (e: any) { alert(`刷新失败: ${e.message}`) }
}

async function handleRemove(id: string, email: string) {
  if (!confirm(`确定要移除 ${email}？`)) return
  try {
    await removePoolAccount(id)
    await loadData()
  } catch (e: any) { alert(e.message) }
}

async function handleToggle(id: string, currentStatus: string) {
  const newStatus = currentStatus === 'disabled' ? 'active' : 'disabled'
  try {
    await updatePoolAccount(id, { status: newStatus })
    await loadData()
  } catch (e: any) { alert(e.message) }
}

async function handleSaveProxy(id: string, proxy: string) {
  try {
    await updatePoolAccount(id, { proxy: proxy || null })
    editProxy.value = null
    await loadData()
  } catch (e: any) { alert(e.message) }
}

async function handleStartOAuth() {
  try {
    const result = await startOAuth()
    oauthUrl.value = result.authUrl
    oauthState.value = result.state
    pasteUrl.value = ''
    showOAuthDialog.value = true
  } catch (e: any) { alert(e.message) }
}

async function handleCompleteOAuth() {
  if (!pasteUrl.value.trim()) { alert('请粘贴回调地址'); return }
  oauthLoading.value = true
  try {
    let code = '', state = ''
    try {
      const url = new URL(pasteUrl.value.trim())
      code = url.searchParams.get('code') || ''
      state = url.searchParams.get('state') || ''
    } catch {
      code = pasteUrl.value.trim()
      state = oauthState.value
    }
    if (!code) { alert('无法从粘贴的内容中提取授权码'); oauthLoading.value = false; return }
    const result = await completeOAuth(code, state || oauthState.value)
    alert(`授权成功！\n账号：${result.email}\n套餐：${result.plan}`)
    showOAuthDialog.value = false
    await loadData()
    loadQuotas()
  } catch (e: any) { alert(`授权失败：${e.message}`) }
  oauthLoading.value = false
}

function closeOAuthDialog() { showOAuthDialog.value = false; loadData() }

// ── Helpers ──
function statusBadge(status: string) {
  switch (status) {
    case 'active': return { text: '正常', cls: 'bg-green-100 text-green-700' }
    case 'expired': return { text: '已过期', cls: 'bg-red-100 text-red-700' }
    case 'error': return { text: '错误', cls: 'bg-orange-100 text-orange-700' }
    case 'disabled': return { text: '已禁用', cls: 'bg-gray-100 text-gray-500' }
    default: return { text: status, cls: 'bg-gray-100 text-gray-500' }
  }
}

function timeAgo(ts: number) {
  if (!ts) return '-'
  const diff = Date.now() - ts
  if (diff < 60000) return '刚刚'
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`
  return `${Math.floor(diff / 86400000)} 天前`
}

function expiresIn(ts: number) {
  const diff = ts - Date.now()
  if (diff <= 0) return '已过期'
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时`
  return `${Math.floor(diff / 86400000)} 天`
}

function formatResetTime(ts: number) {
  if (!ts) return '-'
  const d = new Date(ts)
  const month = d.getMonth() + 1
  const day = d.getDate()
  const hour = d.getHours().toString().padStart(2, '0')
  const min = d.getMinutes().toString().padStart(2, '0')
  return `${month}月${day}日 ${hour}:${min}`
}

function formatResetAfter(seconds: number) {
  if (!seconds || seconds <= 0) return '-'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h > 24) return `${Math.floor(h / 24)}天${h % 24}小时`
  if (h > 0) return `${h}小时${m}分`
  return `${m}分钟`
}

function usageColor(percent: number) {
  if (percent < 0) return 'text-gray-400'
  if (percent <= 30) return 'text-green-600'
  if (percent <= 70) return 'text-amber-500'
  return 'text-red-500'
}

function usageBarColor(percent: number) {
  if (percent <= 30) return 'bg-green-500'
  if (percent <= 70) return 'bg-amber-400'
  return 'bg-red-500'
}
</script>

<template>
  <div class="min-h-screen bg-[#f5f5f5]">
    <!-- Header -->
    <header class="bg-white border-b border-[#e5e5e5] px-6 py-4 sticky top-0 z-10">
      <div class="max-w-6xl mx-auto flex items-center justify-between">
        <div class="flex items-center gap-3">
          <router-link to="/" class="text-[#999] hover:text-[#666] transition-colors">
            ← 返回聊天
          </router-link>
          <h1 class="text-lg font-semibold text-[#0d0d0d]">ChatGPT 号池管理</h1>
        </div>
        <div class="flex items-center gap-2">
          <button class="admin-btn btn-secondary" :disabled="loading" @click="handleSync">
            从 OpenClaw 同步
          </button>
          <button class="admin-btn btn-secondary" :disabled="quotaLoading" @click="handleRefreshQuotas">
            {{ quotaLoading ? '查询中...' : '刷新配额' }}
          </button>
          <button class="admin-btn btn-secondary" :disabled="loading" @click="handleRefreshAll">
            全部刷新Token
          </button>
          <button class="admin-btn btn-primary" @click="handleStartOAuth">
            + 添加账号
          </button>
        </div>
      </div>
    </header>

    <main class="max-w-6xl mx-auto px-6 py-6 space-y-6">
      <!-- Stats Cards -->
      <div class="grid grid-cols-5 gap-4">
        <div class="stat-card">
          <div class="stat-value">{{ stats.total }}</div>
          <div class="stat-label">总计</div>
        </div>
        <div class="stat-card">
          <div class="stat-value text-green-600">{{ stats.active }}</div>
          <div class="stat-label">活跃</div>
        </div>
        <div class="stat-card">
          <div class="stat-value text-red-500">{{ stats.expired }}</div>
          <div class="stat-label">过期</div>
        </div>
        <div class="stat-card">
          <div class="stat-value text-orange-500">{{ stats.error }}</div>
          <div class="stat-label">错误</div>
        </div>
        <div class="stat-card">
          <div class="stat-value text-gray-400">{{ stats.disabled }}</div>
          <div class="stat-label">已禁用</div>
        </div>
      </div>

      <!-- Account List -->
      <div class="bg-white rounded-xl border border-[#e5e5e5] overflow-hidden">
        <div class="px-5 py-3 border-b border-[#f0f0f0] flex items-center justify-between">
          <h2 class="text-[15px] font-semibold text-[#0d0d0d]">账号列表</h2>
          <span class="text-xs text-[#999]">{{ accounts.length }} 个账号</span>
        </div>

        <div v-if="accounts.length === 0" class="py-16 text-center">
          <p class="text-[#999] mb-2">暂无账号</p>
          <p class="text-xs text-[#bbb]">点击"添加账号"通过 OAuth 授权添加 ChatGPT Plus 账号</p>
        </div>

        <div v-else class="divide-y divide-[#f0f0f0]">
          <div
            v-for="acc in accounts"
            :key="acc.id"
            class="px-5 py-4 hover:bg-[#fafafa] transition-colors"
          >
            <div class="flex items-start gap-4">
              <div class="flex-1 min-w-0">
                <!-- Row 1: Email + badges -->
                <div class="flex items-center gap-2 mb-2">
                  <span class="font-medium text-[#0d0d0d]">{{ acc.email }}</span>
                  <span class="px-2 py-0.5 text-[11px] font-medium rounded-full" :class="statusBadge(acc.status).cls">
                    {{ statusBadge(acc.status).text }}
                  </span>
                  <span class="px-2 py-0.5 text-[11px] font-medium rounded-full bg-blue-50 text-blue-600">
                    {{ acc.plan }}
                  </span>
                  <span class="text-[11px] text-[#bbb]">{{ acc.source }}</span>
                </div>

                <!-- Row 2: Quota bars -->
                <div v-if="quotas[acc.id]" class="mb-3 p-3 bg-[#fafafa] rounded-xl border border-[#f0f0f0]">
                  <div class="grid grid-cols-2 gap-4">
                    <!-- Daily quota -->
                    <div>
                      <div class="flex items-center justify-between mb-1.5">
                        <span class="text-xs font-medium text-[#666]">⚡ 日配额</span>
                        <span class="text-xs font-bold tabular-nums" :class="usageColor(quotas[acc.id].primaryUsedPercent)">
                          {{ quotas[acc.id].primaryUsedPercent >= 0 ? quotas[acc.id].primaryUsedPercent + '%' : '—' }}
                        </span>
                      </div>
                      <div class="w-full h-2 bg-[#e5e5e5] rounded-full overflow-hidden">
                        <div
                          class="h-full rounded-full transition-all duration-500"
                          :class="usageBarColor(quotas[acc.id].primaryUsedPercent)"
                          :style="{ width: Math.max(0, quotas[acc.id].primaryUsedPercent) + '%' }"
                        />
                      </div>
                      <div class="flex items-center justify-between mt-1">
                        <span class="text-[10px] text-[#bbb]">
                          窗口 {{ quotas[acc.id].primaryWindowMinutes / 60 }}小时
                        </span>
                        <span class="text-[10px] text-[#bbb]">
                          {{ formatResetAfter(quotas[acc.id].primaryResetAfterSeconds) }}后重置
                        </span>
                      </div>
                    </div>

                    <!-- Weekly quota -->
                    <div>
                      <div class="flex items-center justify-between mb-1.5">
                        <span class="text-xs font-medium text-[#666]">📊 周配额</span>
                        <span class="text-xs font-bold tabular-nums" :class="usageColor(quotas[acc.id].secondaryUsedPercent)">
                          {{ quotas[acc.id].secondaryUsedPercent >= 0 ? quotas[acc.id].secondaryUsedPercent + '%' : '—' }}
                        </span>
                      </div>
                      <div class="w-full h-2 bg-[#e5e5e5] rounded-full overflow-hidden">
                        <div
                          class="h-full rounded-full transition-all duration-500"
                          :class="usageBarColor(quotas[acc.id].secondaryUsedPercent)"
                          :style="{ width: Math.max(0, quotas[acc.id].secondaryUsedPercent) + '%' }"
                        />
                      </div>
                      <div class="flex items-center justify-between mt-1">
                        <span class="text-[10px] text-[#bbb]">
                          窗口 {{ Math.floor(quotas[acc.id].secondaryWindowMinutes / 60 / 24) }}天
                        </span>
                        <span class="text-[10px] text-[#bbb]">
                          {{ formatResetTime(quotas[acc.id].secondaryResetAt) }} 重置
                        </span>
                      </div>
                    </div>
                  </div>
                  <!-- Error -->
                  <div v-if="quotas[acc.id].error" class="mt-2 text-[11px] text-red-400">
                    配额查询失败: {{ quotas[acc.id].error }}
                  </div>
                </div>
                <div v-else-if="quotaLoading" class="mb-3 p-3 bg-[#fafafa] rounded-xl border border-[#f0f0f0] text-center">
                  <span class="text-xs text-[#999]">配额查询中...</span>
                </div>

                <!-- Row 3: Details grid -->
                <div class="grid grid-cols-4 gap-x-6 gap-y-1 text-xs text-[#999]">
                  <div>
                    <span class="text-[#bbb]">Token：</span>
                    <span :class="acc.expiresAt > Date.now() ? 'text-green-600' : 'text-red-500'">
                      {{ expiresIn(acc.expiresAt) }}
                    </span>
                  </div>
                  <div>
                    <span class="text-[#bbb]">请求：</span>
                    <span>{{ acc.requestCount }}</span>
                  </div>
                  <div>
                    <span class="text-[#bbb]">错误：</span>
                    <span :class="acc.errorCount > 0 ? 'text-orange-500' : ''">{{ acc.errorCount }}</span>
                  </div>
                  <div>
                    <span class="text-[#bbb]">最近：</span>
                    <span>{{ timeAgo(acc.lastUsedAt) }}</span>
                  </div>
                </div>

                <!-- Proxy -->
                <div class="flex items-center gap-2 mt-2 text-xs">
                  <span class="text-[#bbb]">代理：</span>
                  <template v-if="editProxy?.id === acc.id">
                    <input
                      v-model="editProxy.proxy"
                      class="flex-1 max-w-xs px-2 py-1 border border-[#ddd] rounded text-xs"
                      placeholder="socks5://user:pass@host:port"
                      @keyup.enter="handleSaveProxy(acc.id, editProxy!.proxy)"
                    >
                    <button class="text-blue-500 hover:text-blue-700" @click="handleSaveProxy(acc.id, editProxy!.proxy)">保存</button>
                    <button class="text-[#999] hover:text-[#666]" @click="editProxy = null">取消</button>
                  </template>
                  <template v-else>
                    <span class="text-[#666]">{{ acc.proxy || '无' }}</span>
                    <button class="text-blue-500 hover:text-blue-700" @click="editProxy = { id: acc.id, proxy: acc.proxy || '' }">编辑</button>
                  </template>
                </div>

                <!-- Last error -->
                <div v-if="acc.lastError" class="mt-1 text-xs text-red-400 truncate max-w-xl">
                  {{ acc.lastError }}
                </div>
              </div>

              <!-- Actions -->
              <div class="flex items-center gap-1.5 flex-shrink-0">
                <button class="action-btn" title="刷新Token" @click="handleRefreshOne(acc.id)">🔄</button>
                <button class="action-btn" :title="acc.status === 'disabled' ? '启用' : '禁用'" @click="handleToggle(acc.id, acc.status)">
                  {{ acc.status === 'disabled' ? '✅' : '⏸' }}
                </button>
                <button class="action-btn hover:!bg-red-50 hover:!text-red-500" title="移除" @click="handleRemove(acc.id, acc.email)">🗑</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>

    <!-- OAuth Dialog -->
    <Teleport to="body">
      <div v-if="showOAuthDialog" class="fixed inset-0 bg-black/40 z-50 flex items-center justify-center" @click.self="closeOAuthDialog">
        <div class="bg-white rounded-2xl shadow-2xl w-[520px] max-h-[85vh] overflow-auto">
          <div class="px-6 pt-6 pb-4">
            <h3 class="text-lg font-semibold text-[#0d0d0d] mb-4">添加 ChatGPT 账号</h3>
            <div class="space-y-4">
              <div class="p-4 bg-blue-50 rounded-xl text-sm text-blue-800 leading-relaxed">
                <p class="font-medium mb-2">第一步：打开授权链接</p>
                <p class="text-xs mb-2">复制下方链接到浏览器打开，登录你的 ChatGPT 账号并授权</p>
                <div class="flex items-center gap-2 p-2 bg-white rounded-lg">
                  <input :value="oauthUrl" readonly class="flex-1 text-xs text-[#666] bg-transparent outline-none truncate font-mono" />
                  <button
                    class="text-xs text-blue-600 hover:text-blue-800 font-medium flex-shrink-0 px-2 py-1 bg-blue-100 rounded"
                    @click="navigator.clipboard.writeText(oauthUrl); ($event.target as HTMLElement).textContent = '已复制'"
                  >
                    复制
                  </button>
                </div>
              </div>
              <div class="p-4 bg-amber-50 rounded-xl text-sm text-amber-800 leading-relaxed">
                <p class="font-medium mb-2">第二步：粘贴回调地址</p>
                <p class="text-xs mb-2">授权后浏览器会跳转到 <code class="bg-amber-100 px-1 rounded">localhost:1455</code> 的地址（页面可能报错，正常），复制地址栏<strong>完整网址</strong>粘贴到这里：</p>
                <textarea
                  v-model="pasteUrl"
                  class="w-full h-20 px-3 py-2 text-xs bg-white border border-amber-200 rounded-lg outline-none font-mono resize-none"
                  placeholder="http://localhost:1455/auth/callback?code=xxx&state=yyy"
                />
              </div>
            </div>
          </div>
          <div class="px-6 pb-6 flex justify-end gap-2">
            <button class="admin-btn btn-secondary" @click="closeOAuthDialog">取消</button>
            <button class="admin-btn btn-primary" :disabled="oauthLoading || !pasteUrl.trim()" @click="handleCompleteOAuth">
              {{ oauthLoading ? '验证中...' : '完成授权' }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.stat-card { @apply bg-white rounded-xl border border-[#e5e5e5] px-5 py-4 text-center; }
.stat-value { @apply text-2xl font-bold text-[#0d0d0d]; }
.stat-label { @apply text-xs text-[#999] mt-1; }
.admin-btn { @apply px-4 py-2 text-sm font-medium rounded-xl transition-colors disabled:opacity-50; }
.btn-primary { @apply bg-[#0d0d0d] text-white hover:bg-[#333]; }
.btn-secondary { @apply bg-[#f4f4f4] text-[#0d0d0d] hover:bg-[#e8e8e8] border border-[#e3e3e3]; }
.action-btn { @apply w-8 h-8 flex items-center justify-center rounded-lg hover:bg-[#f4f4f4] text-sm transition-colors; }
</style>
