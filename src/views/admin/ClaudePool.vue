<script setup lang="ts">
import { ref, onMounted } from 'vue'
import Icon from '@/components/common/Icon.vue'
import {
  fetchClaudePoolStats, fetchClaudeAccounts, removeClaudeAccount,
  updateClaudeAccountApi, refreshClaudeAccountApi, refreshAllClaudeAccountsApi,
  addClaudeToken, startClaudeOAuthApi, completeClaudeOAuthApi,
  fetchClaudeProxies, createClaudeProxy, deleteClaudeProxy, testClaudeProxyApi,
} from '@/api'

const stats = ref({ total: 0, active: 0, expired: 0, error: 0, disabled: 0 })
const accounts = ref<any[]>([])
const proxies = ref<any[]>([])
const loading = ref(false)
const expandedId = ref<string | null>(null)

// Add token dialog
const showAddDialog = ref(false)
const addMode = ref<'token' | 'oauth'>('token')
const tokenInput = ref('')
const emailInput = ref('')
const proxyInput = ref('')
const addLoading = ref(false)

// OAuth
const oauthUrl = ref('')
const oauthState = ref('')
const oauthCode = ref('')

// Proxy dialog
const showProxyDialog = ref(false)
const proxyName = ref('')
const proxyUrl = ref('')

async function loadData() {
  loading.value = true
  try {
    const [s, a, p] = await Promise.all([fetchClaudePoolStats(), fetchClaudeAccounts(), fetchClaudeProxies()])
    stats.value = s; accounts.value = a; proxies.value = p
  } catch {}
  loading.value = false
}

onMounted(loadData)

async function handleAddToken() {
  if (!tokenInput.value.trim()) return
  addLoading.value = true
  try {
    await addClaudeToken(tokenInput.value.trim(), emailInput.value.trim() || undefined, proxyInput.value || undefined)
    tokenInput.value = ''; emailInput.value = ''; showAddDialog.value = false
    await loadData()
  } catch (e: any) { alert(e.message || '添加失败') }
  addLoading.value = false
}

async function handleStartOAuth() {
  addLoading.value = true
  try {
    const result = await startClaudeOAuthApi()
    oauthUrl.value = result.authUrl; oauthState.value = result.state
    addMode.value = 'oauth'
    window.open(result.authUrl, '_blank')
  } catch (e: any) { alert(e.message) }
  addLoading.value = false
}

async function handleCompleteOAuth() {
  if (!oauthCode.value.trim()) return
  addLoading.value = true
  try {
    await completeClaudeOAuthApi(oauthCode.value.trim(), oauthState.value, proxyInput.value || undefined)
    oauthCode.value = ''; oauthUrl.value = ''; showAddDialog.value = false; addMode.value = 'token'
    await loadData()
  } catch (e: any) { alert(e.message || '授权失败') }
  addLoading.value = false
}

async function handleRemove(id: string) {
  if (!confirm('确定删除此账号？')) return
  await removeClaudeAccount(id); await loadData()
}

async function handleRefresh(id: string) {
  try { await refreshClaudeAccountApi(id); await loadData() }
  catch (e: any) { alert(e.message || '刷新失败') }
}

async function handleRefreshAll() {
  try { await refreshAllClaudeAccountsApi(); await loadData() }
  catch {}
}

async function handleToggle(id: string, current: string) {
  await updateClaudeAccountApi(id, { status: current === 'active' ? 'disabled' : 'active' })
  await loadData()
}

async function handleAddProxy() {
  if (!proxyUrl.value.trim()) return
  await createClaudeProxy(proxyName.value || 'Unnamed', proxyUrl.value.trim())
  proxyName.value = ''; proxyUrl.value = ''; showProxyDialog.value = false
  await loadData()
}

async function handleDeleteProxy(id: string) {
  if (!confirm('确定删除？')) return
  await deleteClaudeProxy(id); await loadData()
}

async function handleTestProxy(id: string) {
  const result = await testClaudeProxyApi(id)
  alert(result.success ? `连通 ✅ IP: ${result.ip} 延迟: ${result.latency}ms` : `失败: ${result.error}`)
  await loadData()
}

function formatTime(ts: number) {
  if (!ts) return '-'
  return new Date(ts).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function statusColor(s: string) {
  return s === 'active' ? 'text-emerald-600 bg-emerald-50' : s === 'error' ? 'text-red-600 bg-red-50' : s === 'expired' ? 'text-amber-600 bg-amber-50' : 'text-zinc-400 bg-zinc-100'
}
</script>

<template>
  <div class="flex-1 overflow-y-auto p-6">
    <div class="max-w-5xl mx-auto">
      <!-- Header -->
      <div class="flex items-center justify-between mb-6">
        <div>
          <h1 class="text-xl font-semibold text-[#18181b]">Claude 号池管理</h1>
          <p class="text-sm text-[#71717a] mt-0.5">管理 Claude Pro/Max 订阅账号</p>
        </div>
        <div class="flex gap-2">
          <button class="btn-secondary" @click="handleRefreshAll">
            <Icon name="refresh" :size="14" /> 刷新全部
          </button>
          <button class="btn-primary" @click="showAddDialog = true; addMode = 'token'">
            <Icon name="plus" :size="14" /> 添加账号
          </button>
        </div>
      </div>

      <!-- Stats -->
      <div class="grid grid-cols-5 gap-3 mb-6">
        <div v-for="(v, k) in { '总计': stats.total, '活跃': stats.active, '过期': stats.expired, '错误': stats.error, '禁用': stats.disabled }" :key="k" class="bg-white rounded-xl border border-[#e5e7eb] px-4 py-3">
          <div class="text-[11px] text-[#71717a] font-medium">{{ k }}</div>
          <div class="text-2xl font-semibold text-[#18181b] mt-0.5">{{ v }}</div>
        </div>
      </div>

      <!-- Accounts -->
      <div class="bg-white rounded-xl border border-[#e5e7eb] overflow-hidden mb-6">
        <div class="px-5 py-3 border-b border-[#e5e7eb] text-xs font-medium text-[#71717a] grid grid-cols-[1fr_80px_80px_100px_100px_90px] gap-2">
          <span>账号</span><span>状态</span><span>来源</span><span>过期时间</span><span>最后使用</span><span>操作</span>
        </div>
        <div v-if="accounts.length === 0" class="px-5 py-8 text-center text-sm text-[#a1a1aa]">暂无账号</div>
        <div v-for="acc in accounts" :key="acc.id">
          <div class="grid grid-cols-[1fr_80px_80px_100px_100px_90px] gap-2 px-5 py-3 items-center hover:bg-[#fafafa] cursor-pointer text-sm" @click="expandedId = expandedId === acc.id ? null : acc.id">
            <div class="truncate font-medium text-[#18181b]">{{ acc.email }}</div>
            <span class="text-xs px-2 py-0.5 rounded-full w-fit" :class="statusColor(acc.status)">{{ acc.status }}</span>
            <span class="text-xs text-[#71717a]">{{ acc.source }}</span>
            <span class="text-xs text-[#71717a]">{{ formatTime(acc.expiresAt) }}</span>
            <span class="text-xs text-[#71717a]">{{ formatTime(acc.lastUsedAt) }}</span>
            <div class="flex gap-1">
              <button class="p-1 hover:bg-[#f4f4f5] rounded" title="刷新" @click.stop="handleRefresh(acc.id)"><Icon name="refresh" :size="14" /></button>
              <button class="p-1 hover:bg-[#f4f4f5] rounded" :title="acc.status === 'active' ? '禁用' : '启用'" @click.stop="handleToggle(acc.id, acc.status)"><Icon :name="acc.status === 'active' ? 'eye-off' : 'eye'" :size="14" /></button>
              <button class="p-1 hover:bg-red-50 rounded text-red-500" title="删除" @click.stop="handleRemove(acc.id)"><Icon name="trash" :size="14" /></button>
            </div>
          </div>
          <!-- Expanded detail -->
          <div v-if="expandedId === acc.id" class="px-5 py-3 bg-[#fafafa] border-t border-[#f0f0f0] text-xs text-[#52525b] grid grid-cols-2 gap-2">
            <div>Token: {{ acc.tokenPreview }}</div>
            <div>请求数: {{ acc.requestCount }} | 错误: {{ acc.errorCount }}</div>
            <div>Plan: {{ acc.plan }}</div>
            <div v-if="acc.lastError" class="text-red-500 col-span-2">错误: {{ acc.lastError }}</div>
          </div>
        </div>
      </div>

      <!-- Proxies -->
      <div class="bg-white rounded-xl border border-[#e5e7eb] overflow-hidden">
        <div class="flex items-center justify-between px-5 py-3 border-b border-[#e5e7eb]">
          <span class="text-sm font-medium text-[#18181b]">Claude 代理</span>
          <button class="btn-secondary text-xs" @click="showProxyDialog = true"><Icon name="plus" :size="12" /> 添加</button>
        </div>
        <div v-if="proxies.length === 0" class="px-5 py-6 text-center text-sm text-[#a1a1aa]">暂无代理</div>
        <div v-for="p in proxies" :key="p.id" class="flex items-center gap-3 px-5 py-3 hover:bg-[#fafafa] text-sm border-t border-[#f0f0f0]">
          <div class="flex-1 min-w-0">
            <div class="font-medium text-[#18181b] truncate">{{ p.name }}</div>
            <div class="text-xs text-[#71717a] truncate">{{ p.url }}</div>
          </div>
          <span class="text-xs px-2 py-0.5 rounded-full" :class="statusColor(p.status)">{{ p.status }}</span>
          <button class="p-1 hover:bg-[#f4f4f5] rounded" @click="handleTestProxy(p.id)"><Icon name="zap" :size="14" /></button>
          <button class="p-1 hover:bg-red-50 rounded text-red-500" @click="handleDeleteProxy(p.id)"><Icon name="trash" :size="14" /></button>
        </div>
      </div>
    </div>

    <!-- Add Account Dialog -->
    <Teleport to="body">
      <div v-if="showAddDialog" class="fixed inset-0 z-50 flex items-center justify-center bg-black/30" @click.self="showAddDialog = false">
        <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6">
          <h2 class="text-lg font-semibold text-[#18181b] mb-4">添加 Claude 账号</h2>

          <!-- Tabs -->
          <div class="flex gap-2 mb-4">
            <button class="px-3 py-1.5 text-xs rounded-lg" :class="addMode === 'token' ? 'bg-[#18181b] text-white' : 'bg-[#f4f4f5] text-[#71717a]'" @click="addMode = 'token'">Setup Token</button>
            <button class="px-3 py-1.5 text-xs rounded-lg" :class="addMode === 'oauth' ? 'bg-[#18181b] text-white' : 'bg-[#f4f4f5] text-[#71717a]'" @click="addMode = 'oauth'">OAuth 授权</button>
          </div>

          <!-- Token mode -->
          <div v-if="addMode === 'token'">
            <div class="mb-3">
              <label class="block text-xs font-medium text-[#52525b] mb-1">Token</label>
              <textarea v-model="tokenInput" rows="3" class="w-full px-3 py-2 bg-[#f4f4f5] border border-[#e5e7eb] rounded-xl text-xs outline-none focus:border-[#999]" placeholder="粘贴 setup-token 或 sk-ant-oat-* token" />
              <p class="text-[10px] text-[#a1a1aa] mt-1">运行 claude setup-token 获取，或直接粘贴 access token</p>
            </div>
            <div class="mb-3">
              <label class="block text-xs font-medium text-[#52525b] mb-1">备注名 (可选)</label>
              <input v-model="emailInput" class="w-full px-3 py-2 bg-[#f4f4f5] border border-[#e5e7eb] rounded-xl text-xs outline-none focus:border-[#999]" placeholder="如：我的 Claude Pro" />
            </div>
            <button class="btn-primary w-full justify-center" :disabled="addLoading || !tokenInput.trim()" @click="handleAddToken">
              {{ addLoading ? '添加中...' : '添加账号' }}
            </button>
          </div>

          <!-- OAuth mode -->
          <div v-if="addMode === 'oauth'">
            <div v-if="!oauthUrl">
              <p class="text-sm text-[#52525b] mb-3">通过浏览器登录 Claude 账号授权</p>
              <button class="btn-primary w-full justify-center" :disabled="addLoading" @click="handleStartOAuth">
                {{ addLoading ? '生成中...' : '开始授权' }}
              </button>
            </div>
            <div v-else>
              <p class="text-xs text-[#52525b] mb-2">已在新窗口打开授权页面，登录后将回调 code 粘贴到下方：</p>
              <input v-model="oauthCode" class="w-full px-3 py-2 bg-[#f4f4f5] border border-[#e5e7eb] rounded-xl text-xs outline-none focus:border-[#999] mb-3" placeholder="粘贴授权码 (code)" />
              <button class="btn-primary w-full justify-center" :disabled="addLoading || !oauthCode.trim()" @click="handleCompleteOAuth">
                {{ addLoading ? '验证中...' : '完成授权' }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- Add Proxy Dialog -->
    <Teleport to="body">
      <div v-if="showProxyDialog" class="fixed inset-0 z-50 flex items-center justify-center bg-black/30" @click.self="showProxyDialog = false">
        <div class="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-6">
          <h2 class="text-lg font-semibold text-[#18181b] mb-4">添加 Claude 代理</h2>
          <div class="mb-3">
            <label class="block text-xs font-medium text-[#52525b] mb-1">名称</label>
            <input v-model="proxyName" class="w-full px-3 py-2 bg-[#f4f4f5] border border-[#e5e7eb] rounded-xl text-xs outline-none focus:border-[#999]" placeholder="如：美国节点" />
          </div>
          <div class="mb-4">
            <label class="block text-xs font-medium text-[#52525b] mb-1">代理地址</label>
            <input v-model="proxyUrl" class="w-full px-3 py-2 bg-[#f4f4f5] border border-[#e5e7eb] rounded-xl text-xs outline-none focus:border-[#999]" placeholder="socks5://user:pass@host:port" />
          </div>
          <button class="btn-primary w-full justify-center" :disabled="!proxyUrl.trim()" @click="handleAddProxy">添加</button>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.btn-primary { @apply inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-[#18181b] text-white rounded-md hover:bg-[#27272a] transition-colors disabled:opacity-50 disabled:cursor-not-allowed; }
.btn-secondary { @apply inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-[#e5e7eb] text-[#52525b] rounded-md hover:bg-[#f4f4f5] transition-colors; }
</style>
