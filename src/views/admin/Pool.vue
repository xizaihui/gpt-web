<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
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
const quotas = ref<Record<string, any>>({})
const loading = ref(false)
const quotaLoading = ref(false)
const oauthUrl = ref('')
const oauthState = ref('')
const showOAuthDialog = ref(false)
const pasteUrl = ref('')
const oauthLoading = ref(false)
const editProxy = ref<{ id: string; proxy: string } | null>(null)
const expandedId = ref<string | null>(null)

// ── Load ──
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

onMounted(async () => { await loadData(); loadQuotas() })

// ── Actions ──
async function handleSync() {
  loading.value = true
  try { const r = await syncPool(); await loadData(); loadQuotas() } catch {}
  loading.value = false
}
async function handleRefreshAll() {
  loading.value = true
  try { await refreshAllPoolAccounts(); await loadData() } catch {}
  loading.value = false
}
async function handleRefreshQuotas() { await loadQuotas() }
async function handleRefreshOne(id: string) {
  try { await refreshPoolAccount(id); await loadData() } catch (e: any) { alert(e.message) }
}
async function handleRemove(id: string, email: string) {
  if (!confirm(`确定移除 ${email}？`)) return
  try { await removePoolAccount(id); await loadData() } catch (e: any) { alert(e.message) }
}
async function handleToggle(id: string, status: string) {
  try { await updatePoolAccount(id, { status: status === 'disabled' ? 'active' : 'disabled' }); await loadData() } catch {}
}
async function handleSaveProxy(id: string, proxy: string) {
  try { await updatePoolAccount(id, { proxy: proxy || null }); editProxy.value = null; await loadData() } catch {}
}
async function handleStartOAuth() {
  try { const r = await startOAuth(); oauthUrl.value = r.authUrl; oauthState.value = r.state; pasteUrl.value = ''; showOAuthDialog.value = true } catch (e: any) { alert(e.message) }
}
async function handleCompleteOAuth() {
  if (!pasteUrl.value.trim()) return
  oauthLoading.value = true
  try {
    let code = '', state = ''
    try { const u = new URL(pasteUrl.value.trim()); code = u.searchParams.get('code') || ''; state = u.searchParams.get('state') || '' } catch { code = pasteUrl.value.trim(); state = oauthState.value }
    if (!code) { alert('无法提取授权码'); oauthLoading.value = false; return }
    await completeOAuth(code, state || oauthState.value)
    showOAuthDialog.value = false; await loadData(); loadQuotas()
  } catch (e: any) { alert(e.message) }
  oauthLoading.value = false
}

function toggleExpand(id: string) { expandedId.value = expandedId.value === id ? null : id }

// ── Helpers ──
function statusConfig(s: string) {
  const map: Record<string, { label: string; dot: string; bg: string; text: string }> = {
    active:   { label: '正常',   dot: 'bg-emerald-500', bg: 'bg-emerald-50',  text: 'text-emerald-700' },
    expired:  { label: '已过期', dot: 'bg-red-500',     bg: 'bg-red-50',      text: 'text-red-700' },
    error:    { label: '异常',   dot: 'bg-amber-500',   bg: 'bg-amber-50',    text: 'text-amber-700' },
    disabled: { label: '已禁用', dot: 'bg-zinc-400',    bg: 'bg-zinc-100',    text: 'text-zinc-500' },
  }
  return map[s] || map.disabled
}
function timeAgo(ts: number) {
  if (!ts) return '从未'
  const d = Date.now() - ts
  if (d < 60000) return '刚刚'
  if (d < 3600000) return `${Math.floor(d / 60000)}分钟前`
  if (d < 86400000) return `${Math.floor(d / 3600000)}小时前`
  return `${Math.floor(d / 86400000)}天前`
}
function expiresIn(ts: number) {
  const d = ts - Date.now()
  if (d <= 0) return '已过期'
  if (d < 3600000) return `${Math.floor(d / 60000)}分钟`
  if (d < 86400000) return `${Math.floor(d / 3600000)}小时`
  return `${(d / 86400000).toFixed(1)}天`
}
function resetTime(ts: number) {
  if (!ts) return '-'
  const d = new Date(ts)
  return `${(d.getMonth()+1).toString().padStart(2,'0')}-${d.getDate().toString().padStart(2,'0')} ${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`
}
function resetAfter(s: number) {
  if (!s || s <= 0) return '-'
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60)
  if (h > 24) return `${Math.floor(h/24)}天${h%24}时`
  return h > 0 ? `${h}时${m}分` : `${m}分`
}
function barColor(p: number) {
  if (p <= 30) return 'bg-emerald-500'
  if (p <= 70) return 'bg-amber-400'
  return 'bg-red-500'
}
function textColor(p: number) {
  if (p < 0) return 'text-zinc-400'
  if (p <= 30) return 'text-emerald-600'
  if (p <= 70) return 'text-amber-600'
  return 'text-red-600'
}
</script>

<template>
  <div class="flex-1 overflow-y-auto">
    <!-- Header bar -->
    <div class="sticky top-0 z-10 bg-white/80 backdrop-blur-md border-b border-[#e5e7eb]">
      <div class="flex items-center justify-between h-14 px-6">
        <div>
          <h1 class="text-base font-semibold text-[#18181b] leading-none">号池管理</h1>
          <p class="text-xs text-[#a1a1aa] mt-0.5">管理 ChatGPT Plus/Pro 订阅账号</p>
        </div>
        <div class="flex items-center gap-2">
          <button class="btn-ghost" :disabled="loading" @click="handleSync">
            <Icon name="download" :size="14" />
            <span>同步</span>
          </button>
          <button class="btn-ghost" :disabled="quotaLoading" @click="handleRefreshQuotas">
            <Icon name="activity" :size="14" :class="quotaLoading ? 'animate-pulse' : ''" />
            <span>{{ quotaLoading ? '查询中' : '刷新配额' }}</span>
          </button>
          <button class="btn-ghost" :disabled="loading" @click="handleRefreshAll">
            <Icon name="refresh" :size="14" />
            <span>刷新Token</span>
          </button>
          <button class="btn-primary" @click="handleStartOAuth">
            <Icon name="plus" :size="14" />
            <span>添加账号</span>
          </button>
        </div>
      </div>
    </div>

    <div class="p-6 space-y-6 max-w-[1200px]">
      <!-- Stat cards -->
      <div class="grid grid-cols-5 gap-4">
        <div v-for="item in [
          { label: '总计', value: stats.total, icon: 'users', color: 'text-[#18181b]' },
          { label: '活跃', value: stats.active, icon: 'zap', color: 'text-emerald-600' },
          { label: '过期', value: stats.expired, icon: 'clock', color: 'text-red-500' },
          { label: '异常', value: stats.error, icon: 'alert-triangle', color: 'text-amber-500' },
          { label: '禁用', value: stats.disabled, icon: 'power', color: 'text-zinc-400' },
        ]" :key="item.label" class="card p-4">
          <div class="flex items-center justify-between mb-2">
            <span class="text-xs font-medium text-[#71717a]">{{ item.label }}</span>
            <Icon :name="item.icon" :size="14" class="text-[#a1a1aa]" />
          </div>
          <div class="text-2xl font-bold tracking-tight" :class="item.color">{{ item.value }}</div>
        </div>
      </div>

      <!-- Account table -->
      <div class="card overflow-hidden">
        <div class="flex items-center justify-between px-5 py-3.5 border-b border-[#e5e7eb]">
          <div class="flex items-center gap-2">
            <h2 class="text-sm font-semibold text-[#18181b]">账号列表</h2>
            <span class="text-[11px] text-[#a1a1aa] bg-[#f4f4f5] px-1.5 py-0.5 rounded-md font-medium">{{ accounts.length }}</span>
          </div>
        </div>

        <!-- Table header -->
        <div class="grid grid-cols-[1fr_100px_100px_100px_90px_80px_100px] px-5 py-2 text-[11px] font-medium text-[#a1a1aa] uppercase tracking-wider border-b border-[#f4f4f5] bg-[#fafafa]">
          <div>账号</div>
          <div>套餐</div>
          <div>日配额</div>
          <div>周配额</div>
          <div>请求数</div>
          <div>状态</div>
          <div class="text-right">操作</div>
        </div>

        <!-- Empty -->
        <div v-if="accounts.length === 0" class="py-20 text-center">
          <Icon name="users" :size="32" class="mx-auto text-[#d4d4d8] mb-3" />
          <p class="text-sm text-[#71717a]">暂无账号</p>
          <p class="text-xs text-[#a1a1aa] mt-1">点击"添加账号"通过 OAuth 授权</p>
        </div>

        <!-- Rows -->
        <div v-for="acc in accounts" :key="acc.id" class="border-b border-[#f4f4f5] last:border-0">
          <!-- Main row -->
          <div
            class="grid grid-cols-[1fr_100px_100px_100px_90px_80px_100px] px-5 py-3 items-center hover:bg-[#fafafa] cursor-pointer transition-colors"
            @click="toggleExpand(acc.id)"
          >
            <!-- Email -->
            <div class="flex items-center gap-3 min-w-0">
              <div class="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                :class="acc.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-zinc-100 text-zinc-500'"
              >
                {{ acc.email?.charAt(0)?.toUpperCase() }}
              </div>
              <div class="min-w-0">
                <div class="text-sm font-medium text-[#18181b] truncate">{{ acc.email }}</div>
                <div class="text-[11px] text-[#a1a1aa]">Token {{ expiresIn(acc.expiresAt) }}</div>
              </div>
            </div>

            <!-- Plan -->
            <div>
              <span class="inline-flex items-center text-[11px] font-medium px-2 py-0.5 rounded-full bg-blue-50 text-blue-700">
                {{ acc.plan }}
              </span>
            </div>

            <!-- Daily quota -->
            <div v-if="quotas[acc.id]">
              <div class="flex items-center gap-2">
                <div class="flex-1 h-1.5 bg-[#e4e4e7] rounded-full overflow-hidden">
                  <div class="h-full rounded-full transition-all" :class="barColor(quotas[acc.id].primaryUsedPercent)" :style="{ width: Math.max(0, quotas[acc.id].primaryUsedPercent) + '%' }" />
                </div>
                <span class="text-xs font-medium tabular-nums w-8 text-right" :class="textColor(quotas[acc.id].primaryUsedPercent)">{{ quotas[acc.id].primaryUsedPercent }}%</span>
              </div>
            </div>
            <div v-else class="text-xs text-[#d4d4d8]">{{ quotaLoading ? '...' : '-' }}</div>

            <!-- Weekly quota -->
            <div v-if="quotas[acc.id]">
              <div class="flex items-center gap-2">
                <div class="flex-1 h-1.5 bg-[#e4e4e7] rounded-full overflow-hidden">
                  <div class="h-full rounded-full transition-all" :class="barColor(quotas[acc.id].secondaryUsedPercent)" :style="{ width: Math.max(0, quotas[acc.id].secondaryUsedPercent) + '%' }" />
                </div>
                <span class="text-xs font-medium tabular-nums w-8 text-right" :class="textColor(quotas[acc.id].secondaryUsedPercent)">{{ quotas[acc.id].secondaryUsedPercent }}%</span>
              </div>
            </div>
            <div v-else class="text-xs text-[#d4d4d8]">{{ quotaLoading ? '...' : '-' }}</div>

            <!-- Requests -->
            <div class="text-sm tabular-nums text-[#52525b]">{{ acc.requestCount }}</div>

            <!-- Status -->
            <div>
              <span class="inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-0.5 rounded-full" :class="[statusConfig(acc.status).bg, statusConfig(acc.status).text]">
                <span class="w-1.5 h-1.5 rounded-full" :class="statusConfig(acc.status).dot" />
                {{ statusConfig(acc.status).label }}
              </span>
            </div>

            <!-- Actions -->
            <div class="flex items-center justify-end gap-1" @click.stop>
              <button class="icon-btn" title="刷新Token" @click="handleRefreshOne(acc.id)"><Icon name="refresh" :size="14" /></button>
              <button class="icon-btn" :title="acc.status === 'disabled' ? '启用' : '禁用'" @click="handleToggle(acc.id, acc.status)">
                <Icon :name="acc.status === 'disabled' ? 'zap' : 'power'" :size="14" />
              </button>
              <button class="icon-btn hover:!text-red-500 hover:!bg-red-50" title="移除" @click="handleRemove(acc.id, acc.email)"><Icon name="trash" :size="14" /></button>
            </div>
          </div>

          <!-- Expanded detail -->
          <div v-if="expandedId === acc.id" class="px-5 pb-4 pt-0 bg-[#fafafa]">
            <div class="grid grid-cols-2 gap-4">
              <!-- Quota detail card -->
              <div class="bg-white rounded-lg border border-[#e5e7eb] p-4">
                <h4 class="text-xs font-semibold text-[#71717a] uppercase tracking-wider mb-3">配额详情</h4>
                <div v-if="quotas[acc.id]" class="space-y-3">
                  <!-- Daily -->
                  <div>
                    <div class="flex items-center justify-between mb-1">
                      <span class="text-xs text-[#52525b]">⚡ 日配额</span>
                      <span class="text-xs font-bold tabular-nums" :class="textColor(quotas[acc.id].primaryUsedPercent)">{{ quotas[acc.id].primaryUsedPercent }}%</span>
                    </div>
                    <div class="w-full h-2 bg-[#e4e4e7] rounded-full overflow-hidden">
                      <div class="h-full rounded-full transition-all duration-500" :class="barColor(quotas[acc.id].primaryUsedPercent)" :style="{ width: quotas[acc.id].primaryUsedPercent + '%' }" />
                    </div>
                    <div class="flex justify-between mt-1 text-[10px] text-[#a1a1aa]">
                      <span>窗口 {{ quotas[acc.id].primaryWindowMinutes / 60 }}小时</span>
                      <span>{{ resetAfter(quotas[acc.id].primaryResetAfterSeconds) }}后重置</span>
                    </div>
                  </div>
                  <!-- Weekly -->
                  <div>
                    <div class="flex items-center justify-between mb-1">
                      <span class="text-xs text-[#52525b]">📊 周配额</span>
                      <span class="text-xs font-bold tabular-nums" :class="textColor(quotas[acc.id].secondaryUsedPercent)">{{ quotas[acc.id].secondaryUsedPercent }}%</span>
                    </div>
                    <div class="w-full h-2 bg-[#e4e4e7] rounded-full overflow-hidden">
                      <div class="h-full rounded-full transition-all duration-500" :class="barColor(quotas[acc.id].secondaryUsedPercent)" :style="{ width: quotas[acc.id].secondaryUsedPercent + '%' }" />
                    </div>
                    <div class="flex justify-between mt-1 text-[10px] text-[#a1a1aa]">
                      <span>窗口 {{ Math.floor(quotas[acc.id].secondaryWindowMinutes / 60 / 24) }}天</span>
                      <span>{{ resetTime(quotas[acc.id].secondaryResetAt) }} 重置</span>
                    </div>
                  </div>
                </div>
                <div v-else class="text-xs text-[#a1a1aa] py-4 text-center">
                  {{ quotaLoading ? '查询中...' : '点击"刷新配额"加载' }}
                </div>
              </div>

              <!-- Account detail card -->
              <div class="bg-white rounded-lg border border-[#e5e7eb] p-4">
                <h4 class="text-xs font-semibold text-[#71717a] uppercase tracking-wider mb-3">账号信息</h4>
                <div class="space-y-2.5">
                  <div class="detail-row"><span class="detail-label">来源</span><span class="detail-value">{{ acc.source }}</span></div>
                  <div class="detail-row"><span class="detail-label">Token 有效期</span><span class="detail-value" :class="acc.expiresAt > Date.now() ? 'text-emerald-600' : 'text-red-500'">{{ expiresIn(acc.expiresAt) }}</span></div>
                  <div class="detail-row"><span class="detail-label">请求次数</span><span class="detail-value">{{ acc.requestCount }}</span></div>
                  <div class="detail-row"><span class="detail-label">错误次数</span><span class="detail-value" :class="acc.errorCount > 0 ? 'text-amber-600' : ''">{{ acc.errorCount }}</span></div>
                  <div class="detail-row"><span class="detail-label">最近使用</span><span class="detail-value">{{ timeAgo(acc.lastUsedAt) }}</span></div>
                  <div class="detail-row">
                    <span class="detail-label">代理</span>
                    <div class="flex items-center gap-1.5">
                      <template v-if="editProxy?.id === acc.id">
                        <input v-model="editProxy.proxy" class="text-xs px-2 py-1 border border-[#d4d4d8] rounded-md w-48 outline-none focus:border-[#18181b]" placeholder="socks5://user:pass@host:port" @keyup.enter="handleSaveProxy(acc.id, editProxy!.proxy)" />
                        <button class="text-[11px] text-blue-600 hover:text-blue-800" @click="handleSaveProxy(acc.id, editProxy!.proxy)">保存</button>
                        <button class="text-[11px] text-[#a1a1aa]" @click="editProxy = null">取消</button>
                      </template>
                      <template v-else>
                        <span class="detail-value font-mono">{{ acc.proxy || '无' }}</span>
                        <button class="text-[11px] text-blue-600 hover:text-blue-800" @click="editProxy = { id: acc.id, proxy: acc.proxy || '' }">编辑</button>
                      </template>
                    </div>
                  </div>
                  <div v-if="acc.lastError" class="detail-row">
                    <span class="detail-label">最近错误</span>
                    <span class="detail-value text-red-500 truncate max-w-[240px]">{{ acc.lastError }}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- OAuth Dialog -->
    <Teleport to="body">
      <Transition name="fade">
        <div v-if="showOAuthDialog" class="fixed inset-0 z-50">
          <div class="absolute inset-0 bg-black/50 backdrop-blur-sm" @click="showOAuthDialog = false" />
          <div class="absolute inset-0 flex items-center justify-center p-4">
            <div class="relative bg-white rounded-xl shadow-2xl w-full max-w-lg overflow-hidden" @click.stop>
              <!-- Dialog header -->
              <div class="flex items-center justify-between px-6 py-4 border-b border-[#e5e7eb]">
                <div>
                  <h3 class="text-base font-semibold text-[#18181b]">添加 ChatGPT 账号</h3>
                  <p class="text-xs text-[#a1a1aa] mt-0.5">通过 OAuth 授权绑定 Plus/Pro 订阅</p>
                </div>
                <button class="icon-btn" @click="showOAuthDialog = false"><Icon name="x" :size="16" /></button>
              </div>

              <div class="px-6 py-5 space-y-4">
                <!-- Step 1 -->
                <div>
                  <div class="flex items-center gap-2 mb-2">
                    <span class="w-5 h-5 rounded-full bg-[#18181b] text-white text-[10px] font-bold flex items-center justify-center">1</span>
                    <span class="text-sm font-medium text-[#18181b]">打开授权链接</span>
                  </div>
                  <p class="text-xs text-[#71717a] mb-2 ml-7">复制链接到浏览器，登录 ChatGPT 账号并授权</p>
                  <div class="flex items-center gap-2 ml-7">
                    <input :value="oauthUrl" readonly class="flex-1 text-xs text-[#52525b] bg-[#fafafa] border border-[#e5e7eb] rounded-md px-3 py-2 outline-none font-mono truncate" />
                    <button class="btn-ghost flex-shrink-0" @click="navigator.clipboard.writeText(oauthUrl)">
                      <Icon name="copy" :size="14" />
                      <span>复制</span>
                    </button>
                  </div>
                </div>

                <!-- Step 2 -->
                <div>
                  <div class="flex items-center gap-2 mb-2">
                    <span class="w-5 h-5 rounded-full bg-[#18181b] text-white text-[10px] font-bold flex items-center justify-center">2</span>
                    <span class="text-sm font-medium text-[#18181b]">粘贴回调地址</span>
                  </div>
                  <p class="text-xs text-[#71717a] mb-2 ml-7">
                    授权后浏览器跳转到 <code class="text-[11px] bg-[#f4f4f5] px-1 py-0.5 rounded">localhost:1455</code> 地址（页面报错正常），复制地址栏完整网址粘贴：
                  </p>
                  <textarea
                    v-model="pasteUrl"
                    class="w-full ml-7 max-w-[calc(100%-28px)] h-20 px-3 py-2 text-xs bg-[#fafafa] border border-[#e5e7eb] rounded-md outline-none font-mono resize-none focus:border-[#18181b] transition-colors"
                    placeholder="http://localhost:1455/auth/callback?code=xxx&state=yyy"
                  />
                </div>
              </div>

              <!-- Dialog footer -->
              <div class="flex items-center justify-end gap-2 px-6 py-4 border-t border-[#e5e7eb] bg-[#fafafa]">
                <button class="btn-ghost" @click="showOAuthDialog = false">取消</button>
                <button class="btn-primary" :disabled="oauthLoading || !pasteUrl.trim()" @click="handleCompleteOAuth">
                  {{ oauthLoading ? '验证中...' : '完成授权' }}
                </button>
              </div>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.card { @apply bg-white rounded-lg border border-[#e5e7eb]; }
.btn-primary { @apply inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-[#18181b] text-white rounded-md hover:bg-[#27272a] transition-colors disabled:opacity-50 disabled:cursor-not-allowed; }
.btn-ghost { @apply inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#52525b] rounded-md border border-[#e5e7eb] hover:bg-[#f4f4f5] hover:text-[#18181b] transition-colors disabled:opacity-50; }
.icon-btn { @apply w-7 h-7 flex items-center justify-center rounded-md text-[#71717a] hover:text-[#18181b] hover:bg-[#f4f4f5] transition-colors; }
.detail-row { @apply flex items-center justify-between py-1 border-b border-[#f4f4f5] last:border-0; }
.detail-label { @apply text-[11px] text-[#a1a1aa]; }
.detail-value { @apply text-xs text-[#52525b] font-medium; }

.fade-enter-active, .fade-leave-active { transition: opacity 0.15s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
