<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { addClewdrCookieBatch, fetchProxies } from '@/api'

const props = defineProps<{ show: boolean }>()
const emit = defineEmits<{
  (e: 'update:show', v: boolean): void
  (e: 'done'): void
}>()

const text = ref('')
const proxy = ref('')
const proxies = ref<any[]>([])
const loading = ref(false)
const result = ref<any | null>(null)

watch(() => props.show, async (v) => {
  if (v) {
    text.value = ''
    proxy.value = ''
    result.value = null
    try { proxies.value = await fetchProxies() } catch { proxies.value = [] }
  }
})

function isValid(c: string) {
  const t = c.trim()
  return t.startsWith('sk-ant-sid') && t.length >= 50
}

const parsed = computed(() => {
  const lines = text.value.split('\n').map(l => l.trim()).filter(l => l.length > 0)
  const valid = lines.filter(isValid)
  const invalid = lines.filter(l => !isValid(l))
  return { total: lines.length, valid, invalid }
})

async function submit() {
  if (parsed.value.valid.length === 0) return
  loading.value = true
  result.value = null
  try {
    const r = await addClewdrCookieBatch(parsed.value.valid, proxy.value || undefined)
    result.value = r
    emit('done')
  }
  catch (e: any) {
    result.value = { error: e?.message || '提交失败' }
  }
  loading.value = false
}

function close() {
  if (loading.value) return
  emit('update:show', false)
}
</script>

<template>
  <Teleport to="body">
    <div v-if="show" class="fixed inset-0 z-50 flex items-center justify-center">
      <div class="absolute inset-0 bg-black/40" @click="close" />
      <div class="relative w-[600px] max-w-[92vw] max-h-[85vh] rounded-xl bg-white shadow-xl border border-[#e5e7eb] flex flex-col">
        <div class="flex items-center justify-between px-5 py-4 border-b border-[#e5e7eb]">
          <h3 class="text-base font-semibold text-[#18181b]">批量添加 Claude Cookie</h3>
          <button class="text-[#71717a] hover:text-[#18181b] text-lg leading-none" @click="close">×</button>
        </div>
        <div class="flex-1 overflow-y-auto p-5 space-y-4">
          <div>
            <label class="block text-xs font-medium text-[#71717a] mb-1.5">Cookie 列表 (每行一个)</label>
            <textarea
              v-model="text"
              rows="10"
              placeholder="sk-ant-sid...&#10;sk-ant-sid...&#10;sk-ant-sid..."
              class="w-full rounded-md border border-[#e5e7eb] px-3 py-2 text-xs font-mono text-[#18181b] focus:outline-none focus:border-[#18181b] resize-none"
            />
            <div v-if="parsed.total > 0" class="mt-2 flex items-center gap-3 text-xs">
              <span class="text-[#71717a]">检测到 <span class="font-semibold text-[#18181b]">{{ parsed.total }}</span> 个</span>
              <span class="text-[#16a34a]">✓ {{ parsed.valid.length }} 有效</span>
              <span v-if="parsed.invalid.length" class="text-[#dc2626]">✗ {{ parsed.invalid.length }} 无效</span>
            </div>
          </div>
          <div>
            <label class="block text-xs font-medium text-[#71717a] mb-1.5">代理 (可选)</label>
            <select
              v-model="proxy"
              class="w-full rounded-md border border-[#e5e7eb] px-3 py-2 text-xs text-[#18181b] focus:outline-none focus:border-[#18181b] bg-white"
            >
              <option value="">不使用代理</option>
              <option v-for="p in proxies" :key="p.id" :value="p.url">{{ p.name }} — {{ p.url }}</option>
            </select>
          </div>
          <div v-if="result" class="rounded-md border border-[#e5e7eb] p-3 bg-[#fafafa]">
            <div v-if="result.error" class="text-xs text-[#dc2626]">{{ result.error }}</div>
            <div v-else class="text-xs text-[#18181b]">
              <div class="font-medium mb-1">提交结果</div>
              <pre class="text-[10px] text-[#71717a] overflow-x-auto">{{ JSON.stringify(result, null, 2) }}</pre>
            </div>
          </div>
        </div>
        <div class="flex items-center justify-end gap-2 px-5 py-3 border-t border-[#e5e7eb] bg-[#fafafa] rounded-b-xl">
          <button
            class="px-3 py-1.5 text-xs rounded-md border border-[#e5e7eb] text-[#71717a] hover:text-[#18181b] hover:bg-white transition-colors"
            :disabled="loading"
            @click="close"
          >取消</button>
          <button
            class="px-3 py-1.5 text-xs rounded-md bg-[#18181b] text-white hover:bg-[#27272a] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            :disabled="loading || parsed.valid.length === 0"
            @click="submit"
          >{{ loading ? '提交中…' : `提交 ${parsed.valid.length} 个` }}</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
