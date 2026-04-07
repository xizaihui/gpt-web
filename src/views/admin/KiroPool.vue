<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { fetchKiroPoolStatus, fetchKiroSessions, testKiroGateway, uploadKiroAccount, deleteKiroAccount, disableKiroAccount, enableKiroAccount, testKiroAccount } from '@/api'

const poolData = ref<any>({ total_accounts: 0, active_sessions: 0, accounts: [] })
const sessionsData = ref<any[]>([])
const loading = ref(false)
const testLoading = ref(false)
const testResult = ref<any>(null)
const expandedId = ref<string | null>(null)

const showAddDialog = ref(false)
const uploadLabel = ref('')
const uploadFile = ref<File | null>(null)
const uploadLoading = ref(false)

const accounts = computed(() => poolData.value.accounts || [])

const stats = computed(() => {
  const accts = accounts.value
  return {
    total: poolData.value.total_accounts || 0,
    sessions: poolData.value.active_sessions || 0,
    requests: accts.reduce((s: number, a: any) => s + (a.total_requests || 0), 0),
    errors: accts.reduce((s: number, a: any) => s + (a.error_count || 0), 0),
    disabled: accts.filter((a: any) => a.disabled).length,
  }
})

async function loadData() {
  loading.value = true
  try {
    const [poolRes, sessRes] = await Promise.all([
      fetchKiroPoolStatus(),
      fetchKiroSessions().catch(() => ({ data: { sessions: [] } })),
    ])
    poolData.value = poolRes.data || poolRes
    sessionsData.value = (sessRes.data?.sessions || sessRes.sessions || [])
  } catch (e: any) { console.error('Failed to load Kiro pool:', e) }
  loading.value = false
}

async function handleTest() {
  testLoading.value = true
  testResult.value = null
  try {
    const res = await testKiroGateway()
    testResult.value = res.data || res
  } catch (e: any) { testResult.value = { ok: false, message: e.message } }
  testLoading.value = false
}

async function handleUpload() {
  if (!uploadFile.value) return
  uploadLoading.value = true
  try {
    const buf = await uploadFile.value.arrayBuffer()
    const base64 = btoa(String.fromCharCode(...new Uint8Array(buf)))
    await uploadKiroAccount(uploadFile.value.name, base64, uploadLabel.value.trim() || undefined)
    uploadFile.value = null
    uploadLabel.value = ''
    showAddDialog.value = false
    await loadData()
  } catch (e: any) { alert(e.message || '上传失败') }
  uploadLoading.value = false
}

async function handleDisable(a: any) {
  if (!confirm(`确定禁用 ${a.id}？`)) return
  try { await disableKiroAccount(a.id); await loadData() }
  catch (e: any) { alert(e.message || '操作失败') }
}

async function handleEnable(a: any) {
  try { await enableKiroAccount(a.id); await loadData() }
  catch (e: any) { alert(e.message || '操作失败') }
}

async function handleDelete(a: any) {
  if (!confirm(`确定删除 ${a.id}？凭证文件也会被删除！`)) return
  try { await deleteKiroAccount(a.id); await loadData() }
  catch (e: any) { alert(e.message || '删除失败') }
}

async function handleTestAccount(a: any) {
  try {
    const res = await testKiroAccount(a.id)
    const d = res.data || res
    alert(d.status === 'ok' ? `✅ ${a.id} Token 有效` : `❌ ${a.id} 错误: ${d.error}`)
  } catch (e: any) { alert(`❌ 测试失败: ${e.message}`) }
}

function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  uploadFile.value = input.files?.[0] || null
}

onMounted(loadData)

function authLabel(t: string) {
  const map: Record<string, string> = { aws_sso_oidc: 'AWS SSO', refresh_token: 'Refresh Token', json_creds: 'JSON', sqlite_db: 'SQLite' }
  return map[t] || t
}
</script>

<template>
  <div class="flex-1 overflow-y-auto p-6">
    <div class="max-w-5xl mx-auto">
      <!-- Header -->
      <div class="flex items-center justify-between mb-6">
        <div>
          <h1 class="text-xl font-semibold text-[#18181b]">Kiro Gateway 管理</h1>
          <p class="text-sm text-[#71717a] mt-0.5">管理 Kiro 账号池 · Session 监控 · 上传凭证</p>
        </div>
        <div class="flex gap-2">
          <button class="btn-secondary" @click="loadData" :disabled="loading">{{ loading ? '加载中...' : '🔄 刷新' }}</button>
          <button class="btn-secondary" @click="handleTest" :disabled="testLoading">{{ testLoading ? '测试中...' : '🧪 测试' }}</button>
          <button class="btn-primary" @click="showAddDialog = true">➕ 添加账号</button>
        </div>
      </div>

      <!-- Test result -->
      <div v-if="testResult" class="mb-4 px-4 py-3 rounded-xl border text-sm" :class="testResult.ok ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-red-50 border-red-200 text-red-700'">
        {{ testResult.ok ? `✅ 连通成功 · ${testResult.models || 0} 个模型可用` : `❌ 连通失败：${testResult.message || '未知错误'}` }}
      </div>

      <!-- Stats -->
      <div class="grid grid-cols-5 gap-3 mb-6">
        <div class="bg-white rounded-xl border border-[#e5e7eb] px-4 py-3">
          <div class="text-[11px] text-[#71717a] font-medium">总账号</div>
          <div class="text-2xl font-semibold text-[#18181b] mt-0.5">{{ stats.total }}</div>
        </div>
        <div class="bg-white rounded-xl border border-[#e5e7eb] px-4 py-3">
          <div class="text-[11px] text-[#71717a] font-medium">活跃 Session</div>
          <div class="text-2xl font-semibold text-emerald-600 mt-0.5">{{ stats.sessions }}</div>
        </div>
        <div class="bg-white rounded-xl border border-[#e5e7eb] px-4 py-3">
          <div class="text-[11px] text-[#71717a] font-medium">总请求</div>
          <div class="text-2xl font-semibold text-[#18181b] mt-0.5">{{ stats.requests }}</div>
        </div>
        <div class="bg-white rounded-xl border border-[#e5e7eb] px-4 py-3">
          <div class="text-[11px] text-[#71717a] font-medium">错误数</div>
          <div class="text-2xl font-semibold mt-0.5" :class="stats.errors > 0 ? 'text-red-600' : 'text-[#18181b]'">{{ stats.errors }}</div>
        </div>
        <div class="bg-white rounded-xl border border-[#e5e7eb] px-4 py-3">
          <div class="text-[11px] text-[#71717a] font-medium">已禁用</div>
          <div class="text-2xl font-semibold mt-0.5" :class="stats.disabled > 0 ? 'text-amber-600' : 'text-[#18181b]'">{{ stats.disabled }}</div>
        </div>
      </div>

      <!-- Account List -->
      <div class="bg-white rounded-xl border border-[#e5e7eb] overflow-hidden">
        <div class="px-5 py-3 border-b border-[#e5e7eb] text-xs font-medium text-[#71717a] grid grid-cols-[80px_1fr_80px_80px_90px_50px_50px_100px] gap-2">
          <span>ID</span><span>来源</span><span>Session</span><span>请求</span><span>认证</span><span>错误</span><span>状态</span><span>操作</span>
        </div>
        <div v-if="accounts.length === 0" class="px-5 py-8 text-center text-sm text-[#a1a1aa]">
          {{ loading ? '加载中...' : '暂无账号，点击"添加账号"上传凭证文件' }}
        </div>
        <div v-for="a in accounts" :key="a.id">
          <div
            class="grid grid-cols-[80px_1fr_80px_80px_90px_50px_50px_100px] gap-2 px-5 py-3 items-center hover:bg-[#fafafa] cursor-pointer text-sm border-t border-[#f0f0f0]"
            @click="expandedId = expandedId === a.id ? null : a.id"
          >
            <div class="font-mono text-xs text-[#18181b] font-medium">{{ a.id }}</div>
            <div class="text-xs text-[#52525b] truncate">{{ a.source }}</div>
            <div class="text-xs font-medium" :class="a.active_sessions > 0 ? 'text-emerald-600' : 'text-[#a1a1aa]'">{{ a.active_sessions }}</div>
            <div class="text-xs text-[#52525b]">{{ a.total_requests }}</div>
            <div class="text-xs text-[#71717a]">{{ authLabel(a.auth_type) }}</div>
            <div class="text-xs" :class="a.error_count > 0 ? 'text-red-600 font-medium' : 'text-[#a1a1aa]'">{{ a.error_count }}</div>
            <span class="text-xs px-1.5 py-0.5 rounded-full w-fit" :class="a.disabled ? 'text-red-600 bg-red-50' : 'text-emerald-600 bg-emerald-50'">
              {{ a.disabled ? '禁用' : '正常' }}
            </span>
            <div class="flex gap-1" @click.stop>
              <button class="p-1 hover:bg-blue-50 rounded text-blue-500 text-xs" title="测试" @click="handleTestAccount(a)">🔍</button>
              <button v-if="!a.disabled" class="p-1 hover:bg-amber-50 rounded text-amber-500 text-xs" title="禁用" @click="handleDisable(a)">⏸️</button>
              <button v-else class="p-1 hover:bg-emerald-50 rounded text-emerald-500 text-xs" title="启用" @click="handleEnable(a)">▶️</button>
              <button class="p-1 hover:bg-red-50 rounded text-red-500 text-xs" title="删除" @click="handleDelete(a)">🗑️</button>
            </div>
          </div>

          <!-- Expanded Detail -->
          <div v-if="expandedId === a.id" class="px-5 py-4 bg-[#fafafa] border-t border-[#f0f0f0] text-xs text-[#52525b]">
            <div class="grid grid-cols-2 gap-x-8 gap-y-2">
              <div class="space-y-2">
                <div class="text-[11px] font-semibold text-[#18181b] uppercase tracking-wide">账号详情</div>
                <div><b>ID:</b> {{ a.id }}</div>
                <div><b>来源:</b> {{ a.source }}</div>
                <div><b>认证类型:</b> {{ authLabel(a.auth_type) }}</div>
                <div><b>错误次数:</b> {{ a.error_count }}</div>
              </div>
              <div class="space-y-2">
                <div class="text-[11px] font-semibold text-[#18181b] uppercase tracking-wide">Session 绑定</div>
                <div v-if="sessionsData.filter(s => s.account_id === a.id).length === 0" class="text-[#a1a1aa]">无活跃 Session</div>
                <div v-for="s in sessionsData.filter(s => s.account_id === a.id)" :key="s.session_id" class="bg-white rounded-lg border border-[#e5e7eb] p-2">
                  <div class="font-mono text-[10px]">{{ s.session_id }}</div>
                  <div class="text-[10px] text-[#a1a1aa] mt-0.5">请求 {{ s.request_count }} 次 · 空闲 {{ s.idle_seconds }}s</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Info -->
      <div class="mt-6 px-4 py-3 bg-[#f4f4f5] rounded-xl text-xs text-[#71717a] space-y-1">
        <p>💡 添加账号：本地运行 <code class="bg-white px-1 rounded">kiro login</code> 登录新的 AWS Builder ID，然后上传生成的 <code class="bg-white px-1 rounded">data.sqlite3</code> 文件。</p>
        <p>📁 文件位置：macOS <code class="bg-white px-1 rounded">~/Library/Application Support/kiro-cli/data.sqlite3</code> · Linux <code class="bg-white px-1 rounded">~/.local/share/kiro-cli/data.sqlite3</code></p>
        <p>🔄 Token 自动续期，refresh_token 过期后需重新 login 并上传。Session 5 分钟无活动自动释放。</p>
      </div>
    </div>

    <!-- Upload Dialog -->
    <Teleport to="body">
      <div v-if="showAddDialog" class="fixed inset-0 z-50 flex items-center justify-center bg-black/30" @click.self="showAddDialog = false">
        <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6">
          <h2 class="text-lg font-semibold text-[#18181b] mb-4">添加 Kiro 账号</h2>
          <div class="mb-3">
            <label class="block text-xs font-medium text-[#52525b] mb-1">凭证文件</label>
            <input type="file" accept=".sqlite3,.json" @change="onFileChange" class="w-full text-xs file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-medium file:bg-[#f4f4f5] file:text-[#52525b] hover:file:bg-[#e5e7eb]" />
            <p class="text-[10px] text-[#a1a1aa] mt-1">支持 .sqlite3（Kiro CLI）或 .json（手动导出）凭证文件</p>
          </div>
          <div class="mb-4">
            <label class="block text-xs font-medium text-[#52525b] mb-1">标签 (可选)</label>
            <input v-model="uploadLabel" class="w-full px-3 py-2 bg-[#f4f4f5] border border-[#e5e7eb] rounded-xl text-xs outline-none focus:border-[#999]" placeholder="例如：account-02、test-user" />
            <p class="text-[10px] text-[#a1a1aa] mt-1">用于区分不同账号，不填则自动生成</p>
          </div>
          <div class="flex gap-2">
            <button class="btn-secondary flex-1 justify-center" @click="showAddDialog = false">取消</button>
            <button class="btn-primary flex-1 justify-center" :disabled="uploadLoading || !uploadFile" @click="handleUpload">{{ uploadLoading ? '上传中...' : '上传' }}</button>
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
