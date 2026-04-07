<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { fetchKiroPoolStatus, testKiroGateway } from '@/api'

const poolData = ref<any>({ total_accounts: 0, active_sessions: 0, accounts: [] })
const loading = ref(false)
const testLoading = ref(false)
const testResult = ref<any>(null)
const expandedId = ref<string | null>(null)

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
    const res = await fetchKiroPoolStatus()
    poolData.value = res.data || res
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

onMounted(loadData)

function authLabel(t: string) {
  const map: Record<string, string> = {
    aws_sso_oidc: 'AWS SSO',
    refresh_token: 'Refresh Token',
    json_creds: 'JSON 凭证',
    sqlite_db: 'SQLite DB',
  }
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
          <p class="text-sm text-[#71717a] mt-0.5">管理 Kiro 账号池 · Session 监控 · 连通测试</p>
        </div>
        <div class="flex gap-2">
          <button class="btn-secondary" @click="loadData" :disabled="loading">{{ loading ? '加载中...' : '🔄 刷新' }}</button>
          <button class="btn-secondary" @click="handleTest" :disabled="testLoading">{{ testLoading ? '测试中...' : '🧪 测试连通' }}</button>
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
        <div class="px-5 py-3 border-b border-[#e5e7eb] text-xs font-medium text-[#71717a] grid grid-cols-[80px_1fr_90px_90px_100px_60px_60px] gap-2">
          <span>ID</span><span>来源</span><span>活跃Session</span><span>总请求</span><span>认证类型</span><span>错误</span><span>状态</span>
        </div>
        <div v-if="accounts.length === 0" class="px-5 py-8 text-center text-sm text-[#a1a1aa]">
          {{ loading ? '加载中...' : '暂无账号' }}
        </div>
        <div v-for="a in accounts" :key="a.id">
          <div
            class="grid grid-cols-[80px_1fr_90px_90px_100px_60px_60px] gap-2 px-5 py-3 items-center hover:bg-[#fafafa] cursor-pointer text-sm border-t border-[#f0f0f0]"
            @click="expandedId = expandedId === a.id ? null : a.id"
          >
            <div class="font-mono text-xs text-[#18181b] font-medium">{{ a.id }}</div>
            <div class="text-xs text-[#52525b] truncate">{{ a.source }}</div>
            <div class="text-xs font-medium" :class="a.active_sessions > 0 ? 'text-emerald-600' : 'text-[#a1a1aa]'">{{ a.active_sessions }}</div>
            <div class="text-xs text-[#52525b]">{{ a.total_requests }}</div>
            <div class="text-xs text-[#71717a]">{{ authLabel(a.auth_type) }}</div>
            <div class="text-xs" :class="a.error_count > 0 ? 'text-red-600 font-medium' : 'text-[#a1a1aa]'">{{ a.error_count }}</div>
            <span class="text-xs px-2 py-0.5 rounded-full w-fit" :class="a.disabled ? 'text-red-600 bg-red-50' : 'text-emerald-600 bg-emerald-50'">
              {{ a.disabled ? '禁用' : '正常' }}
            </span>
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
                <div class="text-[11px] font-semibold text-[#18181b] uppercase tracking-wide">使用统计</div>
                <div><b>活跃 Session:</b> {{ a.active_sessions }}</div>
                <div><b>总请求数:</b> {{ a.total_requests }}</div>
                <div><b>状态:</b> {{ a.disabled ? '已禁用' : '正常运行' }}</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Info -->
      <div class="mt-6 px-4 py-3 bg-[#f4f4f5] rounded-xl text-xs text-[#71717a] space-y-1">
        <p>💡 Kiro Gateway 使用无状态 API 模式（类似 OpenAI），每次请求携带完整消息历史。</p>
        <p>Session 绑定基于首条消息 hash，5 分钟无活动自动释放。后台每 60 秒清理一次。</p>
        <p>添加账号：将 Kiro CLI 的 data.sqlite3 放入 KIRO_POOL_DIR 目录，重启 Gateway 即可。</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.btn-primary { @apply inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-[#18181b] text-white rounded-md hover:bg-[#27272a] transition-colors disabled:opacity-50 disabled:cursor-not-allowed; }
.btn-secondary { @apply inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-[#e5e7eb] text-[#52525b] rounded-md hover:bg-[#f4f4f5] transition-colors; }
</style>
