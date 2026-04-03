<script setup lang="ts">
import { ref, onMounted } from 'vue'
import Icon from '@/components/common/Icon.vue'
import { fetchProxies, createProxy, deleteProxy, updateProxyConfig, testProxyConnection, fetchPoolAccounts, updatePoolAccount } from '@/api'

const proxies = ref<any[]>([])
const accounts = ref<any[]>([])
const loading = ref(false)
const showAdd = ref(false)
const newName = ref('')
const newUrl = ref('')
const addLoading = ref(false)
const testResults = ref<Record<string, { loading: boolean; result?: any }>>({})

// Assign dialog
const showAssign = ref(false)
const assignProxyId = ref('')
const assignProxyName = ref('')

async function loadData() {
  loading.value = true
  try {
    const [p, a] = await Promise.all([fetchProxies(), fetchPoolAccounts()])
    proxies.value = p
    accounts.value = a
  } catch {}
  loading.value = false
}

onMounted(loadData)

async function handleAdd() {
  if (!newName.value.trim() || !newUrl.value.trim()) return
  addLoading.value = true
  try {
    await createProxy(newName.value.trim(), newUrl.value.trim())
    newName.value = ''; newUrl.value = ''; showAdd.value = false
    await loadData()
  } catch (e: any) { alert(e.message) }
  addLoading.value = false
}

async function handleDelete(id: string, name: string) {
  if (!confirm(`删除代理 "${name}"？已绑定此代理的账号将变为直连。`)) return
  try { await deleteProxy(id); await loadData() } catch (e: any) { alert(e.message) }
}

async function handleToggle(id: string, status: string) {
  try { await updateProxyConfig(id, { status: status === 'disabled' ? 'active' : 'disabled' }); await loadData() } catch {}
}

async function handleTest(id: string) {
  testResults.value[id] = { loading: true }
  try {
    const result = await testProxyConnection(id)
    testResults.value[id] = { loading: false, result }
    await loadData()
  } catch (e: any) {
    testResults.value[id] = { loading: false, result: { success: false, error: e.message } }
  }
}

function openAssign(proxyId: string, proxyName: string) {
  assignProxyId.value = proxyId
  assignProxyName.value = proxyName
  showAssign.value = true
}

async function assignToAccount(accountId: string, proxyId: string | null) {
  try {
    await updatePoolAccount(accountId, { proxy: proxyId })
    await loadData()
  } catch {}
}

function getProxyName(proxyId?: string) {
  if (!proxyId) return '直连'
  const p = proxies.value.find(px => px.id === proxyId)
  return p ? p.name : '未知'
}

function getAccountsForProxy(proxyId: string) {
  return accounts.value.filter(a => a.proxy === proxyId)
}

function statusDot(s: string) {
  if (s === 'active') return 'bg-emerald-500'
  if (s === 'error') return 'bg-red-500'
  return 'bg-zinc-400'
}
</script>

<template>
  <div class="flex-1 overflow-y-auto">
    <!-- Header -->
    <div class="sticky top-0 z-10 bg-white/80 backdrop-blur-md border-b border-[#e5e7eb]">
      <div class="flex items-center justify-between h-14 px-6">
        <div>
          <h1 class="text-base font-semibold text-[#18181b] leading-none">代理管理</h1>
          <p class="text-xs text-[#a1a1aa] mt-0.5">配置代理，实现每个账号独立 IP</p>
        </div>
        <button class="btn-primary" @click="showAdd = true">
          <Icon name="plus" :size="14" />
          <span>添加代理</span>
        </button>
      </div>
    </div>

    <div class="p-6 max-w-[1200px] space-y-6">
      <!-- Info card -->
      <div class="flex items-start gap-3 p-4 bg-blue-50 border border-blue-100 rounded-lg">
        <Icon name="shield" :size="16" class="text-blue-500 mt-0.5 flex-shrink-0" />
        <div class="text-xs text-blue-700 leading-relaxed">
          <p class="font-medium mb-1">为什么需要代理？</p>
          <p>多个 ChatGPT Plus 账号使用同一 IP 会增加被风控的风险。给每个账号绑定独立代理，请求将通过不同 IP 发出，更安全。</p>
          <p class="mt-1">支持 <code class="bg-blue-100 px-1 rounded">http://</code>、<code class="bg-blue-100 px-1 rounded">https://</code>、<code class="bg-blue-100 px-1 rounded">socks5://</code> 协议。格式示例：<code class="bg-blue-100 px-1 rounded">socks5://user:pass@1.2.3.4:1080</code></p>
        </div>
      </div>

      <!-- Proxy list -->
      <div class="card overflow-hidden">
        <div class="flex items-center justify-between px-5 py-3.5 border-b border-[#e5e7eb]">
          <div class="flex items-center gap-2">
            <h2 class="text-sm font-semibold text-[#18181b]">代理列表</h2>
            <span class="text-[11px] text-[#a1a1aa] bg-[#f4f4f5] px-1.5 py-0.5 rounded-md font-medium">{{ proxies.length }}</span>
          </div>
        </div>

        <!-- Table header -->
        <div class="grid grid-cols-[200px_1fr_120px_120px_80px_120px] px-5 py-2 text-[11px] font-medium text-[#a1a1aa] uppercase tracking-wider border-b border-[#f4f4f5] bg-[#fafafa]">
          <div>名称</div>
          <div>地址</div>
          <div>出口 IP</div>
          <div>绑定账号</div>
          <div>状态</div>
          <div class="text-right">操作</div>
        </div>

        <!-- Empty -->
        <div v-if="proxies.length === 0" class="py-16 text-center">
          <Icon name="shield" :size="32" class="mx-auto text-[#d4d4d8] mb-3" />
          <p class="text-sm text-[#71717a]">暂无代理</p>
          <p class="text-xs text-[#a1a1aa] mt-1">添加代理后可绑定到账号</p>
        </div>

        <!-- Rows -->
        <div v-for="proxy in proxies" :key="proxy.id" class="grid grid-cols-[200px_1fr_120px_120px_80px_120px] px-5 py-3 items-center border-b border-[#f4f4f5] last:border-0 hover:bg-[#fafafa] transition-colors">
          <!-- Name -->
          <div class="flex items-center gap-2">
            <span class="w-1.5 h-1.5 rounded-full flex-shrink-0" :class="statusDot(proxy.status)" />
            <span class="text-sm font-medium text-[#18181b] truncate">{{ proxy.name }}</span>
          </div>

          <!-- URL -->
          <div class="text-xs text-[#52525b] font-mono truncate pr-4">{{ proxy.url }}</div>

          <!-- IP (test result) -->
          <div>
            <template v-if="testResults[proxy.id]?.loading">
              <span class="text-xs text-[#a1a1aa] animate-pulse">测试中...</span>
            </template>
            <template v-else-if="testResults[proxy.id]?.result">
              <span v-if="testResults[proxy.id].result.success" class="text-xs text-emerald-600 font-mono">
                {{ testResults[proxy.id].result.ip }}
                <span class="text-[10px] text-[#a1a1aa] ml-1">{{ testResults[proxy.id].result.latency }}ms</span>
              </span>
              <span v-else class="text-xs text-red-500 truncate">失败</span>
            </template>
            <template v-else>
              <span class="text-xs text-[#d4d4d8]">未测试</span>
            </template>
          </div>

          <!-- Bound accounts -->
          <div>
            <div class="flex items-center gap-1">
              <span class="text-xs text-[#52525b]">{{ getAccountsForProxy(proxy.id).length }} 个</span>
              <button class="text-[10px] text-blue-600 hover:text-blue-800" @click="openAssign(proxy.id, proxy.name)">管理</button>
            </div>
          </div>

          <!-- Status -->
          <div>
            <span class="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full"
              :class="proxy.status === 'active' ? 'bg-emerald-50 text-emerald-700' : proxy.status === 'error' ? 'bg-red-50 text-red-700' : 'bg-zinc-100 text-zinc-500'"
            >
              {{ proxy.status === 'active' ? '正常' : proxy.status === 'error' ? '异常' : '禁用' }}
            </span>
          </div>

          <!-- Actions -->
          <div class="flex items-center justify-end gap-1">
            <button class="icon-btn" title="测试连接" @click="handleTest(proxy.id)"><Icon name="activity" :size="14" /></button>
            <button class="icon-btn" :title="proxy.status === 'disabled' ? '启用' : '禁用'" @click="handleToggle(proxy.id, proxy.status)">
              <Icon :name="proxy.status === 'disabled' ? 'zap' : 'power'" :size="14" />
            </button>
            <button class="icon-btn hover:!text-red-500 hover:!bg-red-50" title="删除" @click="handleDelete(proxy.id, proxy.name)"><Icon name="trash" :size="14" /></button>
          </div>
        </div>
      </div>

      <!-- Account-Proxy binding overview -->
      <div class="card overflow-hidden">
        <div class="px-5 py-3.5 border-b border-[#e5e7eb]">
          <h2 class="text-sm font-semibold text-[#18181b]">账号代理绑定</h2>
          <p class="text-[11px] text-[#a1a1aa] mt-0.5">查看和修改每个账号的代理配置</p>
        </div>

        <div v-for="acc in accounts" :key="acc.id" class="flex items-center justify-between px-5 py-3 border-b border-[#f4f4f5] last:border-0 hover:bg-[#fafafa]">
          <div class="flex items-center gap-3 min-w-0">
            <div class="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0"
              :class="acc.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-zinc-100 text-zinc-500'"
            >
              {{ acc.email?.charAt(0)?.toUpperCase() }}
            </div>
            <div class="min-w-0">
              <div class="text-sm text-[#18181b] truncate">{{ acc.email }}</div>
            </div>
          </div>

          <div class="flex items-center gap-3">
            <div class="flex items-center gap-1.5">
              <span class="w-1.5 h-1.5 rounded-full" :class="acc.proxy ? 'bg-emerald-500' : 'bg-zinc-300'" />
              <span class="text-xs" :class="acc.proxy ? 'text-[#18181b]' : 'text-[#a1a1aa]'">{{ getProxyName(acc.proxy) }}</span>
            </div>
            <select
              class="text-xs border border-[#e5e7eb] rounded-md px-2 py-1.5 bg-white text-[#52525b] outline-none focus:border-[#18181b] cursor-pointer min-w-[140px]"
              :value="acc.proxy || ''"
              @change="assignToAccount(acc.id, ($event.target as HTMLSelectElement).value || null)"
            >
              <option value="">直连（无代理）</option>
              <option v-for="p in proxies.filter(px => px.status !== 'disabled')" :key="p.id" :value="p.id">
                {{ p.name }}
              </option>
            </select>
          </div>
        </div>
      </div>
    </div>

    <!-- Add Proxy Dialog -->
    <Teleport to="body">
      <Transition name="fade">
        <div v-if="showAdd" class="fixed inset-0 z-50">
          <div class="absolute inset-0 bg-black/50 backdrop-blur-sm" @click="showAdd = false" />
          <div class="absolute inset-0 flex items-center justify-center p-4">
            <div class="relative bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden" @click.stop>
              <div class="flex items-center justify-between px-6 py-4 border-b border-[#e5e7eb]">
                <h3 class="text-base font-semibold text-[#18181b]">添加代理</h3>
                <button class="icon-btn" @click="showAdd = false"><Icon name="x" :size="16" /></button>
              </div>
              <div class="px-6 py-5 space-y-4">
                <div>
                  <label class="block text-xs font-medium text-[#18181b] mb-1.5">名称</label>
                  <input v-model="newName" class="input-field" placeholder="例如：美国节点1" />
                </div>
                <div>
                  <label class="block text-xs font-medium text-[#18181b] mb-1.5">代理地址</label>
                  <input v-model="newUrl" class="input-field font-mono" placeholder="socks5://user:pass@host:port" />
                  <p class="text-[10px] text-[#a1a1aa] mt-1.5">支持 socks5://、http://、https:// 协议</p>
                </div>
              </div>
              <div class="flex items-center justify-end gap-2 px-6 py-4 border-t border-[#e5e7eb] bg-[#fafafa]">
                <button class="btn-ghost" @click="showAdd = false">取消</button>
                <button class="btn-primary" :disabled="addLoading || !newName.trim() || !newUrl.trim()" @click="handleAdd">
                  {{ addLoading ? '添加中...' : '添加' }}
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
.input-field { @apply w-full px-3 py-2 text-sm bg-white border border-[#e5e7eb] rounded-md outline-none focus:border-[#18181b] transition-colors text-[#18181b]; }

.fade-enter-active, .fade-leave-active { transition: opacity 0.15s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
