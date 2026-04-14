<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { fetchProxies, createProxy, deleteProxy, testProxyConnection } from '@/api'
import Icon from '@/components/common/Icon.vue'

const proxies = ref<any[]>([])
const loading = ref(false)
const showAdd = ref(false)
const newName = ref('')
const newUrl = ref('')
const testing = ref<Record<string, boolean>>({})
const testResults = ref<Record<string, any>>({})

async function load() {
  loading.value = true
  try { proxies.value = await fetchProxies() } catch (e) { console.error(e); proxies.value = [] }
  loading.value = false
}
onMounted(load)

async function handleCreate() {
  if (!newName.value.trim() || !newUrl.value.trim()) return
  try {
    await createProxy(newName.value.trim(), newUrl.value.trim())
    newName.value = ''
    newUrl.value = ''
    showAdd.value = false
    await load()
  } catch (e: any) { alert(e?.message || '创建失败') }
}

async function handleDelete(p: any) {
  if (!confirm(`删除代理 ${p.name}?`)) return
  try { await deleteProxy(p.id); await load() } catch (e: any) { alert(e?.message || '删除失败') }
}

async function handleTest(p: any) {
  testing.value = { ...testing.value, [p.id]: true }
  try {
    const r = await testProxyConnection(p.id)
    testResults.value = { ...testResults.value, [p.id]: r }
  } catch (e: any) {
    testResults.value = { ...testResults.value, [p.id]: { success: false, error: e?.message } }
  }
  testing.value = { ...testing.value, [p.id]: false }
}
</script>

<template>
  <div class="p-6 space-y-4">
    <div class="flex items-center justify-between">
      <div>
        <h2 class="text-base font-semibold text-[#18181b]">代理节点</h2>
        <p class="text-xs text-[#71717a] mt-0.5">管理账号出站代理 · 共 {{ proxies.length }} 个节点</p>
      </div>
      <button
        class="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md bg-[#18181b] text-white hover:bg-[#27272a]"
        @click="showAdd = !showAdd"
      >
        <Icon name="plus" :size="12" />
        添加代理
      </button>
    </div>

    <div v-if="showAdd" class="rounded-xl border border-[#e5e7eb] bg-white p-4 space-y-3">
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="block text-[11px] text-[#71717a] mb-1">名称</label>
          <input
            v-model="newName"
            type="text"
            placeholder="proxy-hk-01"
            class="w-full px-3 py-1.5 text-xs rounded-md border border-[#e5e7eb] focus:outline-none focus:border-[#18181b]"
          >
        </div>
        <div>
          <label class="block text-[11px] text-[#71717a] mb-1">URL</label>
          <input
            v-model="newUrl"
            type="text"
            placeholder="http://user:pass@host:port"
            class="w-full px-3 py-1.5 text-xs rounded-md border border-[#e5e7eb] font-mono focus:outline-none focus:border-[#18181b]"
          >
        </div>
      </div>
      <div class="flex justify-end gap-2">
        <button class="px-3 py-1.5 text-xs rounded-md border border-[#e5e7eb] text-[#71717a]" @click="showAdd = false">取消</button>
        <button class="px-3 py-1.5 text-xs rounded-md bg-[#18181b] text-white" @click="handleCreate">创建</button>
      </div>
    </div>

    <div class="rounded-xl border border-[#e5e7eb] bg-white overflow-hidden">
      <table class="w-full text-xs">
        <thead class="bg-[#fafafa] text-[#71717a]">
          <tr>
            <th class="px-4 py-2.5 text-left font-medium">名称</th>
            <th class="px-4 py-2.5 text-left font-medium">URL</th>
            <th class="px-4 py-2.5 text-left font-medium w-32">状态</th>
            <th class="px-4 py-2.5 text-left font-medium w-40">最近测试</th>
            <th class="px-4 py-2.5 text-right font-medium w-40">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="loading"><td colspan="5" class="px-4 py-8 text-center text-[#a1a1aa]">加载中...</td></tr>
          <tr v-else-if="proxies.length === 0"><td colspan="5" class="px-4 py-8 text-center text-[#a1a1aa]">暂无代理节点</td></tr>
          <tr v-for="p in proxies" :key="p.id" class="border-t border-[#f4f4f5] hover:bg-[#fafafa]">
            <td class="px-4 py-3 font-medium text-[#18181b]">{{ p.name }}</td>
            <td class="px-4 py-3 font-mono text-[#71717a] text-[10px]">{{ p.url }}</td>
            <td class="px-4 py-3">
              <span
                class="inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium border"
                :class="p.status === 'active'
                  ? 'bg-[#f0fdf4] text-[#16a34a] border-[#bbf7d0]'
                  : 'bg-[#f4f4f5] text-[#71717a] border-[#e5e7eb]'"
              >{{ p.status || 'unknown' }}</span>
            </td>
            <td class="px-4 py-3 text-[#71717a]">
              <span v-if="testResults[p.id]?.success" class="text-[#16a34a]">✓ {{ testResults[p.id].latency }}ms</span>
              <span v-else-if="testResults[p.id]" class="text-[#dc2626]">✗ {{ testResults[p.id].error || '失败' }}</span>
              <span v-else>—</span>
            </td>
            <td class="px-4 py-3 text-right">
              <button
                class="text-[11px] text-[#71717a] hover:text-[#18181b] mr-3"
                :disabled="testing[p.id]"
                @click="handleTest(p)"
              >{{ testing[p.id] ? '测试中…' : '测试' }}</button>
              <button
                class="text-[11px] text-[#dc2626] hover:underline"
                @click="handleDelete(p)"
              >删除</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
