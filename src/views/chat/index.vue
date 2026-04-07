<script setup lang='ts'>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useDialog, useMessage } from 'naive-ui'
import { Message } from './components'
import ModelSelector from './components/ModelSelector.vue'
import Icon from '@/components/common/Icon.vue'
import { useScroll } from './hooks/useScroll'
import { useChat } from './hooks/useChat'
import HeaderComponent from './components/Header/index.vue'
import { useBasicLayout } from '@/hooks/useBasicLayout'
import { useChatStore, useSettingStore, useAppStore } from '@/store'
import { fetchChatAPIProcess } from '@/api'
import { t } from '@/locales'

let controller = new AbortController()

const route = useRoute()
const dialog = useDialog()
const ms = useMessage()

const chatStore = useChatStore()
const appStore = useAppStore()
const settingStore = useSettingStore()

const { isMobile } = useBasicLayout()
const { addChat, updateChat, updateChatSome, getChatByUuidAndIndex } = useChat()
const { scrollRef, scrollToBottom, scrollToBottomIfAtBottom } = useScroll()

const { uuid } = route.params as { uuid: string }

const dataSources = computed(() => chatStore.getChatByUuid(+uuid))

const prompt = ref<string>('')
const loading = ref<boolean>(false)
const inputRef = ref<HTMLTextAreaElement | null>(null)
const waitingForFirstToken = ref<boolean>(false)

// Model selection (persisted in localStorage)
const savedModel = localStorage.getItem('selectedModel')
const selectedModel = ref(savedModel || 'gpt-4o')

// File upload
const fileInputRef = ref<HTMLInputElement | null>(null)

interface AttachedFile {
  name: string
  type: string
  size: number
  base64: string
  previewUrl?: string
}

const attachedFiles = ref<AttachedFile[]>([])
const showAttachMenu = ref(false)

// Thinking / Reasoning toggle
const thinkingEnabled = ref(false)

// Thinking is only available for subscription GPT-5.4 models
const thinkingSupported = computed(() => {
  return selectedModel.value === 'codex:gpt-5.4' || selectedModel.value === 'codex:gpt-5.4-mini'
})

// Auto-disable thinking when switching to unsupported model
watch(selectedModel, () => {
  if (!thinkingSupported.value && thinkingEnabled.value) {
    thinkingEnabled.value = false
  }
})

function toggleThinking() {
  if (!thinkingSupported.value) return
  thinkingEnabled.value = !thinkingEnabled.value
}
const showRecentSubmenu = ref(false)

const MAX_FILE_SIZE = 20 * 1024 * 1024 // 20MB

// Recent files: metadata in localStorage (tiny), base64 in IndexedDB (large)
interface RecentFile {
  name: string
  type: string
  size: number
  addedAt: number
}

const MAX_RECENT_FILES = 10

// ── IndexedDB helpers for recent file blobs ──
const DB_NAME = 'recentFilesDB'
const DB_STORE = 'files'

function openRecentDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => { req.result.createObjectStore(DB_STORE) }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function saveRecentBlob(name: string, base64: string) {
  try {
    const db = await openRecentDB()
    const tx = db.transaction(DB_STORE, 'readwrite')
    tx.objectStore(DB_STORE).put(base64, name)
    db.close()
  } catch { /* IndexedDB unavailable — degrade silently */ }
}

async function loadRecentBlob(name: string): Promise<string | null> {
  try {
    const db = await openRecentDB()
    return new Promise((resolve) => {
      const tx = db.transaction(DB_STORE, 'readonly')
      const req = tx.objectStore(DB_STORE).get(name)
      req.onsuccess = () => { db.close(); resolve(req.result ?? null) }
      req.onerror = () => { db.close(); resolve(null) }
    })
  } catch { return null }
}

async function deleteRecentBlob(name: string) {
  try {
    const db = await openRecentDB()
    const tx = db.transaction(DB_STORE, 'readwrite')
    tx.objectStore(DB_STORE).delete(name)
    db.close()
  } catch { /* ignore */ }
}

// ── Recent files metadata (localStorage, no base64) ──
function getRecentFiles(): RecentFile[] {
  try {
    const raw = localStorage.getItem('recentFiles')
    if (!raw) return []
    // Migration: strip base64 from any old-format entries
    const parsed = JSON.parse(raw) as any[]
    return parsed.map(f => ({ name: f.name, type: f.type, size: f.size, addedAt: f.addedAt }))
  } catch { return [] }
}

function addToRecentFiles(file: { name: string; type: string; size: number; base64: string }) {
  // Save base64 to IndexedDB (async, fire-and-forget)
  saveRecentBlob(file.name, file.base64)

  // Save metadata to localStorage (tiny)
  const recents = getRecentFiles().filter(f => f.name !== file.name)
  recents.unshift({ name: file.name, type: file.type, size: file.size, addedAt: Date.now() })
  // Clean up evicted entries from IndexedDB
  if (recents.length > MAX_RECENT_FILES) {
    const evicted = recents.splice(MAX_RECENT_FILES)
    evicted.forEach(f => deleteRecentBlob(f.name))
  }
  localStorage.setItem('recentFiles', JSON.stringify(recents))
}

const recentFiles = ref<RecentFile[]>(getRecentFiles())

function handleFileSelect(event: Event) {
  const input = event.target as HTMLInputElement
  if (!input.files) return

  for (const file of Array.from(input.files)) {
    if (file.size > MAX_FILE_SIZE) {
      ms.warning(`文件 ${file.name} 超过 20MB 限制`)
      continue
    }
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      const base64 = result.split(',')[1]
      const entry: AttachedFile = {
        name: file.name,
        type: file.type || 'application/octet-stream',
        size: file.size,
        base64,
      }
      if (file.type.startsWith('image/')) {
        entry.previewUrl = URL.createObjectURL(file)
      }
      attachedFiles.value.push(entry)
      // Save to recent files
      addToRecentFiles({ name: file.name, type: file.type || 'application/octet-stream', size: file.size, base64 })
      recentFiles.value = getRecentFiles()
    }
    reader.readAsDataURL(file)
  }

  input.value = ''
  showAttachMenu.value = false
}

async function attachRecentFile(file: RecentFile) {
  // Check if already attached
  if (attachedFiles.value.some(f => f.name === file.name)) {
    ms.warning(`${file.name} 已添加`)
    return
  }
  // Load base64 from IndexedDB
  const base64 = await loadRecentBlob(file.name)
  if (!base64) {
    ms.error(`${file.name} 数据已过期，请重新上传`)
    return
  }
  const entry: AttachedFile = {
    name: file.name,
    type: file.type,
    size: file.size,
    base64,
  }
  if (file.type.startsWith('image/')) {
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    entry.previewUrl = URL.createObjectURL(new Blob([bytes], { type: file.type }))
  }
  attachedFiles.value.push(entry)
  showAttachMenu.value = false
  showRecentSubmenu.value = false
}

function openFilePicker() {
  showAttachMenu.value = false
  showRecentSubmenu.value = false
  fileInputRef.value?.click()
}

function toggleAttachMenu() {
  showAttachMenu.value = !showAttachMenu.value
  if (!showAttachMenu.value) showRecentSubmenu.value = false
  if (showAttachMenu.value) recentFiles.value = getRecentFiles()
}

function closeAttachMenu() {
  showAttachMenu.value = false
  showRecentSubmenu.value = false
}

function removeFile(index: number) {
  const file = attachedFiles.value[index]
  if (file.previewUrl) {
    URL.revokeObjectURL(file.previewUrl)
  }
  attachedFiles.value.splice(index, 1)
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatRecentDate(timestamp: number): string {
  const d = new Date(timestamp)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffMin = Math.floor(diffMs / 60000)
  if (diffMin < 1) return '刚刚'
  if (diffMin < 60) return `${diffMin} 分钟前`
  const diffHours = Math.floor(diffMin / 60)
  if (diffHours < 24) return `${diffHours} 小时前`
  const month = d.getMonth() + 1
  const day = d.getDate()
  const hours = String(d.getHours()).padStart(2, '0')
  const mins = String(d.getMinutes()).padStart(2, '0')
  return `${month}月${day}日 ${hours}:${mins}`
}

// Reset loading state on page load
dataSources.value.forEach((item, index) => {
  if (item.loading)
    updateChatSome(+uuid, index, { loading: false })
})

/**
 * Build conversation history from dataSources up to (but not including) `endIndex`.
 * Returns at most `contextRounds * 2` messages.
 */
function buildHistory(endIndex: number): Array<{ role: string; content: string }> {
  const rounds = settingStore.contextRounds
  if (rounds <= 0 || endIndex <= 0) return []

  const msgs = dataSources.value
  const history: Array<{ role: string; content: string }> = []

  for (let i = Math.min(endIndex - 1, msgs.length - 1); i >= 0 && history.length < rounds * 2; i--) {
    const msg = msgs[i]
    if (msg.error || msg.loading) continue
    if (!msg.text || msg.text.trim() === '') continue

    history.unshift({
      role: msg.inversion ? 'user' : 'assistant',
      content: msg.text,
    })
  }

  if (history.length > rounds * 2)
    return history.slice(history.length - rounds * 2)

  return history
}

/**
 * Shared streaming call: sends request and handles progress/errors.
 */
async function streamChat(
  message: string,
  targetIndex: number,
  history: Array<{ role: string; content: string }>,
  options: Chat.ConversationRequest,
  files?: Array<{ name: string; type: string; base64: string }>,
) {
  await fetchChatAPIProcess({
    prompt: message,
    options,
    model: selectedModel.value,
    apiBaseUrl: settingStore.apiBaseUrl,
    apiKey: settingStore.apiKey,
    files,
    signal: controller.signal,
    history,
    reasoning: thinkingEnabled.value ? 'high' : undefined,
    chatUuid: +uuid,
    onProgress: (data) => {
      waitingForFirstToken.value = false
      const responseModel = data.detail?.model || data.model || selectedModel.value
      const updateData: Partial<Chat.Chat> = {
        dateTime: new Date().toLocaleString(),
        text: data.text ?? '',
        inversion: false,
        error: false,
        loading: true,
        model: responseModel,
        conversationOptions: { conversationId: data.conversationId, parentMessageId: data.id },
        requestOptions: { prompt: message, options: { ...options } },
      }
      if (data.reasoning) {
        updateData.reasoning = data.reasoning
      }
      if (data.usage) {
        updateData.usage = data.usage
      }
      updateChat(+uuid, targetIndex, updateData as Chat.Chat)
      scrollToBottomIfAtBottom()
    },
  })
  updateChatSome(+uuid, targetIndex, { loading: false })
}

function handleStreamError(error: any, message: string, targetIndex: number, options: Chat.ConversationRequest) {
  // User cancelled
  if (error.name === 'AbortError' || error.message === 'canceled' || error.message?.includes('abort')) {
    updateChatSome(+uuid, targetIndex, { loading: false })
    scrollToBottomIfAtBottom()
    return
  }

  const errorMessage = error?.message ?? t('common.wrong')
  const currentChat = getChatByUuidAndIndex(+uuid, targetIndex)

  if (currentChat?.text && currentChat.text !== '') {
    updateChatSome(+uuid, targetIndex, {
      text: `${currentChat.text}\n[${errorMessage}]`,
      error: false,
      loading: false,
    })
    return
  }

  updateChat(+uuid, targetIndex, {
    dateTime: new Date().toLocaleString(),
    text: errorMessage,
    inversion: false,
    error: true,
    loading: false,
    conversationOptions: null,
    requestOptions: { prompt: message, options: { ...options } },
  })
  scrollToBottomIfAtBottom()
}

function handleSubmit() {
  onConversation()
}

async function onConversation() {
  let message = prompt.value

  if (loading.value)
    return

  if ((!message || message.trim() === '') && attachedFiles.value.length === 0)
    return

  // Capture files before clearing
  const filesToSend = attachedFiles.value.length > 0
    ? attachedFiles.value.map(f => ({ name: f.name, type: f.type, base64: f.base64 }))
    : undefined

  controller = new AbortController()

  // Build display text for the user message (include file names)
  let displayText = message
  if (filesToSend && filesToSend.length > 0) {
    const fileNames = filesToSend.map(f => `📎 ${f.name}`).join('\n')
    displayText = `${fileNames}\n\n${message}`
  }

  addChat(
    +uuid,
    {
      dateTime: new Date().toLocaleString(),
      text: displayText,
      inversion: true,
      error: false,
      conversationOptions: null,
      requestOptions: { prompt: message, options: null },
    },
  )
  scrollToBottom()

  loading.value = true
  waitingForFirstToken.value = true
  prompt.value = ''

  // Clear attached files and revoke preview URLs
  for (const f of attachedFiles.value) {
    if (f.previewUrl) URL.revokeObjectURL(f.previewUrl)
  }
  attachedFiles.value = []

  // Reset textarea height
  if (inputRef.value) {
    inputRef.value.style.height = '32px'
  }

  let options: Chat.ConversationRequest = {}

  addChat(
    +uuid,
    {
      dateTime: new Date().toLocaleString(),
      text: '',
      loading: true,
      inversion: false,
      error: false,
      conversationOptions: null,
      requestOptions: { prompt: message, options: { ...options } },
    },
  )
  scrollToBottom()

  try {
    const responseIndex = dataSources.value.length - 1
    // Build history from messages before the 2 we just added (user msg + assistant placeholder)
    const history = buildHistory(dataSources.value.length - 2)

    await streamChat(message, responseIndex, history, options, filesToSend)
  }
  catch (error: any) {
    handleStreamError(error, message, dataSources.value.length - 1, options)
  }
  finally {
    loading.value = false
    waitingForFirstToken.value = false
  }
}

async function onRegenerate(index: number) {
  if (loading.value)
    return

  controller = new AbortController()

  const { requestOptions } = dataSources.value[index]

  let message = requestOptions?.prompt ?? ''

  let options: Chat.ConversationRequest = {}

  if (requestOptions.options)
    options = { ...requestOptions.options }

  loading.value = true
  waitingForFirstToken.value = true

  updateChat(
    +uuid,
    index,
    {
      dateTime: new Date().toLocaleString(),
      text: '',
      inversion: false,
      error: false,
      loading: true,
      conversationOptions: null,
      requestOptions: { prompt: message, options: { ...options } },
    },
  )

  try {
    // Build history from messages before the regenerated one
    const regenHistory = buildHistory(index)

    await streamChat(message, index, regenHistory, options)
  }
  catch (error: any) {
    handleStreamError(error, message, index, options)
  }
  finally {
    loading.value = false
    waitingForFirstToken.value = false
  }
}

function handleDelete(index: number) {
  if (loading.value)
    return

  dialog.warning({
    title: t('chat.deleteMessage'),
    content: t('chat.deleteMessageConfirm'),
    positiveText: t('common.yes'),
    negativeText: t('common.no'),
    onPositiveClick: () => {
      chatStore.deleteChatByUuid(+uuid, index)
    },
  })
}

function handleEnter(event: KeyboardEvent) {
  if (!isMobile.value) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      handleSubmit()
    }
  }
  else {
    if (event.key === 'Enter' && event.ctrlKey) {
      event.preventDefault()
      handleSubmit()
    }
  }
}

function handleStop() {
  if (loading.value) {
    controller.abort()
    loading.value = false
  }
}

// Auto-resize textarea
function autoResize(event: Event) {
  const el = event.target as HTMLTextAreaElement
  el.style.height = '32px'
  el.style.height = `${Math.min(el.scrollHeight, 200)}px`
}

const buttonDisabled = computed(() => {
  return loading.value || (!prompt.value || prompt.value.trim() === '') && attachedFiles.value.length === 0
})

// Default model
const defaultModel = 'codex:gpt-5.4'
if (!savedModel) {
  selectedModel.value = defaultModel
}

// Suggestion items
const suggestions = [
  { icon: '✍️', text: '帮我写一篇文章', prompt: '帮我写一篇文章' },
  { icon: '🔬', text: '解释量子计算', prompt: '解释量子计算' },
  { icon: '💻', text: '写一段Python代码', prompt: '写一段Python代码' },
  { icon: '😄', text: '给我讲个笑话', prompt: '给我讲个笑话' },
]

function handleSuggestion(text: string) {
  prompt.value = text
  handleSubmit()
}

onMounted(async () => {
  // One-time migration from localStorage → backend SQLite
  await chatStore.migrateFromLocalStorage()
  // Load conversations list from backend
  await chatStore.loadConversations()
  // Load messages for active conversation
  if (chatStore.active) {
    await chatStore.loadMessages(chatStore.active)
    // Clear stale loading states from interrupted sessions
    const msgs = chatStore.getChatByUuid(chatStore.active)
    msgs.forEach((msg, idx) => {
      if (msg.loading) {
        updateChatSome(chatStore.active!, idx, { loading: false })
      }
    })
  }
  scrollToBottom()
})

onUnmounted(() => {
  if (loading.value)
    controller.abort()
})
</script>

<template>
  <div class="flex flex-col w-full h-full bg-white">
    <!-- Top bar -->
    <div class="flex items-center justify-between px-4 h-[52px] flex-shrink-0">
      <div class="flex items-center gap-1">
        <!-- Sidebar toggle (show when sidebar is collapsed on desktop) -->
        <button
          v-if="!isMobile && appStore.siderCollapsed"
          class="icon-btn text-[#0d0d0d]"
          @click="appStore.setSiderCollapsed(false)"
        >
          <Icon name="sidebar" :size="18" />
        </button>
        <!-- Mobile hamburger -->
        <HeaderComponent v-if="isMobile" />
      </div>
    </div>

    <!-- Click outside to close attach menu -->
    <div
      v-if="showAttachMenu"
      class="fixed inset-0 z-[55]"
      @click="closeAttachMenu"
    />

    <!-- Main scrollable area -->
    <main class="flex-1 overflow-hidden">
      <div id="scrollRef" ref="scrollRef" class="h-full overflow-y-auto" :class="!dataSources.length ? 'flex flex-col' : ''">
        <!-- Empty state: centered greeting + input -->
        <template v-if="!dataSources.length">
          <div class="flex-1" />
          <div class="flex flex-col items-center px-4 w-full max-w-[48rem] mx-auto">
            <h1 class="text-[32px] font-medium text-[#0d0d0d] mb-6">今天有什么计划？</h1>

            <!-- Centered input box -->
            <div class="w-full">
              <div class="relative flex flex-col bg-white rounded-3xl border border-[#d9d9e3] shadow-sm">
                <input
                  ref="fileInputRef"
                  type="file"
                  multiple
                  accept="image/*,.pdf,.txt,.md,.json,.csv,.xml,.py,.js,.ts,.java,.go,.rs,.c,.cpp,.h,.zip,.tar.gz"
                  class="hidden"
                  @change="handleFileSelect"
                >
                <!-- Attached files preview -->
                <div v-if="attachedFiles.length" class="flex flex-wrap gap-2 px-4 pt-3">
                  <div v-for="(file, idx) in attachedFiles" :key="file.name" class="relative group">
                    <div v-if="file.type.startsWith('image/')" class="w-14 h-14 rounded-lg overflow-hidden border border-[#e3e3e3]">
                      <img :src="file.previewUrl" :alt="file.name" class="w-full h-full object-cover" />
                    </div>
                    <div v-else class="flex items-center gap-2 px-3 py-2 bg-[#f4f4f4] rounded-lg border border-[#e3e3e3] max-w-[200px]">
                      <Icon name="file-text" :size="14" class="text-[#666] flex-shrink-0" :stroke-width="1.8" />
                      <span class="text-xs text-[#0d0d0d] truncate">{{ file.name }}</span>
                      <span class="text-[10px] text-[#999] whitespace-nowrap">{{ formatFileSize(file.size) }}</span>
                    </div>
                    <button class="absolute -top-1.5 -right-1.5 w-5 h-5 bg-[#666] text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity text-xs leading-none" @click="removeFile(idx)">×</button>
                  </div>
                </div>
                <!-- Textarea -->
                <div class="px-4 pt-4 pb-2">
                  <textarea
                    ref="inputRef"
                    v-model="prompt"
                    class="w-full bg-transparent resize-none outline-none text-[16px] text-[#0d0d0d] placeholder-[#999] leading-[1.5] max-h-[200px] min-h-[32px]"
                    placeholder="有问题，尽管问"
                    rows="1"
                    style="height: 32px;"
                    @input="autoResize"
                    @keydown="handleEnter"
                  />
                </div>
                <!-- Bottom toolbar -->
                <div class="flex items-center justify-between px-3 pb-[10px]">
                  <div class="flex items-center gap-0.5">
                    <!-- + Attach -->
                    <div class="relative">
                      <button class="icon-btn-sm text-[#666] hover:text-[#0d0d0d]" title="附件" @click="toggleAttachMenu">
                        <Icon name="plus" :size="20" :stroke-width="1.8" />
                      </button>
                      <div v-if="showAttachMenu" class="absolute bottom-full left-0 mb-2 w-[220px] menu-panel z-[60]">
                        <button class="menu-item" @click="openFilePicker" @mouseenter="showRecentSubmenu = false">
                          <Icon name="paperclip" :size="18" :stroke-width="1.8" />
                          <span>添加照片和文件</span>
                        </button>
                        <div class="relative">
                          <button class="menu-item" @mouseenter="showRecentSubmenu = true" @click="showRecentSubmenu = !showRecentSubmenu">
                            <Icon name="file" :size="18" :stroke-width="1.8" />
                            <span class="flex-1">近期文件</span>
                            <Icon name="chevron-right" :size="14" />
                          </button>
                          <div v-if="showRecentSubmenu" class="absolute left-full top-0 ml-1 w-[240px] menu-panel z-[61] max-h-[320px] overflow-y-auto" @mouseleave="showRecentSubmenu = false">
                            <button class="menu-item" @click="openFilePicker">
                              <Icon name="folder" :size="16" :stroke-width="1.8" />
                              <span>从库中添加</span>
                            </button>
                            <div v-if="recentFiles.length > 0" class="border-t border-[#f0f0f0] my-1" />
                            <div v-if="recentFiles.length > 0" class="px-4 pt-1.5 pb-1 text-[11px] font-medium text-[#999]">最近</div>
                            <button v-for="file in recentFiles" :key="file.name + file.addedAt" class="flex items-center gap-3 w-full px-4 py-2 text-sm text-[#0d0d0d] hover:bg-[#f4f4f4] transition-colors text-left" @click="attachRecentFile(file)">
                              <div class="w-5 h-5 flex items-center justify-center flex-shrink-0">
                                <Icon v-if="file.type.startsWith('image/')" name="image" :size="16" class="text-[#999]" :stroke-width="1.8" />
                                <Icon v-else name="circle" :size="16" class="text-[#999]" :stroke-width="1.8" />
                              </div>
                              <div class="flex-1 min-w-0">
                                <div class="truncate text-[13px]">{{ file.name }}</div>
                                <div class="text-[11px] text-[#999]">{{ formatRecentDate(file.addedAt) }}</div>
                              </div>
                            </button>
                            <div v-if="recentFiles.length === 0" class="px-4 py-3 text-[13px] text-[#999] text-center">暂无近期文件</div>
                          </div>
                        </div>
                      </div>
                    </div>
                    <!-- 思考 -->
                    <button
                      class="flex items-center gap-1.5 px-2.5 py-1 text-[13px] rounded-full transition-all font-medium"
                      :class="thinkingEnabled
                        ? 'text-[#0066ff] bg-blue-50 ring-1 ring-blue-200'
                        : thinkingSupported
                          ? 'text-[#b4b4b4] hover:text-[#666] hover:bg-[#f4f4f4]'
                          : 'text-[#d4d4d4] cursor-not-allowed'"
                      :disabled="!thinkingSupported"
                      @click="toggleThinking"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a8 8 0 0 0-8 8c0 3.4 2.1 6.3 5 7.4V20a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1v-2.6c2.9-1.1 5-4 5-7.4a8 8 0 0 0-8-8z" /><line x1="9" y1="23" x2="15" y2="23" /></svg>
                      <span>思考</span>
                      <template v-if="thinkingEnabled">
                        <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                      </template>
                    </button>
                    <!-- Model selector pills -->
                    <ModelSelector v-model="selectedModel" />
                  </div>
                  <div class="flex items-center gap-1">
                    <button class="icon-btn-sm text-[#666] hover:text-[#0d0d0d]"><Icon name="mic" :size="18" :stroke-width="1.8" /></button>
                    <button v-if="loading" class="flex items-center justify-center w-8 h-8 rounded-full bg-black hover:bg-[#2b2b2b] transition-colors" @click="handleStop"><Icon name="stop" :size="14" /></button>
                    <button v-else class="flex items-center justify-center w-8 h-8 rounded-full transition-all" :class="buttonDisabled ? 'bg-[#d9d9e3] text-white cursor-not-allowed' : 'bg-black text-white hover:bg-[#2b2b2b] cursor-pointer'" :disabled="buttonDisabled" @click="handleSubmit"><Icon name="arrow-up" :size="16" :stroke-width="2.5" /></button>
                  </div>
                </div>
              </div>
            </div>

            <!-- Suggestions (only in empty state) -->
            <div class="flex flex-wrap justify-center gap-2 mt-4 mb-2">
              <button
                v-for="s in suggestions"
                :key="s.text"
                class="flex items-center gap-1.5 px-3.5 py-2 text-[13px] text-[#666] bg-[#f9f9f9] hover:bg-[#f0f0f0] border border-[#e8e8e8] rounded-full transition-colors"
                @click="handleSuggestion(s.prompt)"
              >
                <span>{{ s.icon }}</span>
                <span>{{ s.text }}</span>
              </button>
            </div>

            <p class="text-center text-[11px] text-[#ccc] mt-2 leading-normal">
              AI 可能会犯错。请核查重要信息。
            </p>
          </div>
          <div class="flex-1" />
        </template>

        <!-- Messages -->
        <template v-else>
          <div class="max-w-[48rem] mx-auto px-4 py-6">
            <div id="image-wrapper">
              <Message
                v-for="(item, index) of dataSources"
                :key="`${item.dateTime}-${index}`"
                :date-time="item.dateTime"
                :text="item.text"
                :reasoning="item.reasoning"
                :inversion="item.inversion"
                :error="item.error"
                :loading="item.loading"
                :thinking="item.loading && thinkingEnabled"
                :model="item.model"
                :usage="item.usage"
                @regenerate="onRegenerate(index)"
                @delete="handleDelete(index)"
              />
            </div>
          </div>
        </template>
      </div>
    </main>

    <!-- Input area (only when there are messages — empty state has its own centered input) -->
    <footer v-if="dataSources.length" class="px-3 pb-3 pt-2 sm:px-4 sm:pb-4">
      <div class="max-w-[48rem] mx-auto">
        <!-- Input box -->
        <div class="relative flex flex-col bg-white rounded-3xl border border-[#d9d9e3] shadow-sm">
          <!-- Hidden file input -->
          <input
            ref="fileInputRef"
            type="file"
            multiple
            accept="image/*,.pdf,.txt,.md,.json,.csv,.xml,.py,.js,.ts,.java,.go,.rs,.c,.cpp,.h,.zip,.tar.gz"
            class="hidden"
            @change="handleFileSelect"
          >

          <!-- Attached files preview (above textarea) -->
          <div v-if="attachedFiles.length" class="flex flex-wrap gap-2 px-4 pt-3">
            <div v-for="(file, idx) in attachedFiles" :key="file.name" class="relative group">
              <!-- Image preview -->
              <div v-if="file.type.startsWith('image/')" class="w-14 h-14 rounded-lg overflow-hidden border border-[#e3e3e3]">
                <img :src="file.previewUrl" :alt="file.name" class="w-full h-full object-cover" />
              </div>
              <!-- File preview (non-image) -->
              <div v-else class="flex items-center gap-2 px-3 py-2 bg-[#f4f4f4] rounded-lg border border-[#e3e3e3] max-w-[200px]">
                <Icon name="file-text" :size="14" class="text-[#666] flex-shrink-0" :stroke-width="1.8" />
                <span class="text-xs text-[#0d0d0d] truncate">{{ file.name }}</span>
                <span class="text-[10px] text-[#999] whitespace-nowrap">{{ formatFileSize(file.size) }}</span>
              </div>
              <!-- Remove button -->
              <button
                class="absolute -top-1.5 -right-1.5 w-5 h-5 bg-[#666] text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity text-xs leading-none"
                @click="removeFile(idx)"
              >×</button>
            </div>
          </div>

          <!-- Textarea -->
          <div class="px-4 pt-4 pb-2">
            <textarea
              ref="inputRef"
              v-model="prompt"
              class="w-full bg-transparent resize-none outline-none text-[16px] text-[#0d0d0d] placeholder-[#999] leading-[1.5] max-h-[200px] min-h-[32px]"
              placeholder="有问题，尽管问"
              rows="1"
              style="height: 32px;"
              @input="autoResize"
              @keydown="handleEnter"
            />
          </div>

          <!-- Bottom toolbar -->
          <div class="flex items-center justify-between px-3 pb-[10px]">
            <!-- Left group: + attach, 思考, model pills -->
            <div class="flex items-center gap-0.5">
              <!-- + Attach button with dropdown menu -->
              <div class="relative">
                <button
                  class="icon-btn-sm text-[#666] hover:text-[#0d0d0d]"
                  title="附件"
                  @click="toggleAttachMenu"
                >
                  <Icon name="plus" :size="20" :stroke-width="1.8" />
                </button>

                <!-- Attach dropdown menu -->
                <div
                  v-if="showAttachMenu"
                  class="absolute bottom-full left-0 mb-2 w-[220px] menu-panel z-[60]"
                >
                  <button
                    class="menu-item"
                    @click="openFilePicker"
                    @mouseenter="showRecentSubmenu = false"
                  >
                    <Icon name="paperclip" :size="18" :stroke-width="1.8" />
                    <span>添加照片和文件</span>
                  </button>
                  <div class="relative">
                    <button
                      class="menu-item"
                      @mouseenter="showRecentSubmenu = true"
                      @click="showRecentSubmenu = !showRecentSubmenu"
                    >
                      <Icon name="file" :size="18" :stroke-width="1.8" />
                      <span class="flex-1">近期文件</span>
                      <Icon name="chevron-right" :size="14" />
                    </button>
                    <div
                      v-if="showRecentSubmenu"
                      class="absolute left-full top-0 ml-1 w-[240px] menu-panel z-[61] max-h-[320px] overflow-y-auto"
                      @mouseleave="showRecentSubmenu = false"
                    >
                      <button class="menu-item" @click="openFilePicker">
                        <Icon name="folder" :size="16" :stroke-width="1.8" />
                        <span>从库中添加</span>
                      </button>
                      <div v-if="recentFiles.length > 0" class="border-t border-[#f0f0f0] my-1" />
                      <div v-if="recentFiles.length > 0" class="px-4 pt-1.5 pb-1 text-[11px] font-medium text-[#999]">最近</div>
                      <button
                        v-for="file in recentFiles"
                        :key="file.name + file.addedAt"
                        class="flex items-center gap-3 w-full px-4 py-2 text-sm text-[#0d0d0d] hover:bg-[#f4f4f4] transition-colors text-left"
                        @click="attachRecentFile(file)"
                      >
                        <div class="w-5 h-5 flex items-center justify-center flex-shrink-0">
                          <Icon v-if="file.type.startsWith('image/')" name="image" :size="16" class="text-[#999]" :stroke-width="1.8" />
                          <Icon v-else name="circle" :size="16" class="text-[#999]" :stroke-width="1.8" />
                        </div>
                        <div class="flex-1 min-w-0">
                          <div class="truncate text-[13px]">{{ file.name }}</div>
                          <div class="text-[11px] text-[#999]">{{ formatRecentDate(file.addedAt) }}</div>
                        </div>
                      </button>
                      <div v-if="recentFiles.length === 0" class="px-4 py-3 text-[13px] text-[#999] text-center">暂无近期文件</div>
                    </div>
                  </div>
                </div>
              </div>
              <!-- 思考 pill toggle -->
              <button
                class="flex items-center gap-1.5 px-2.5 py-1 text-[13px] rounded-full transition-all font-medium"
                :class="thinkingEnabled
                  ? 'text-[#0066ff] bg-blue-50 ring-1 ring-blue-200'
                  : thinkingSupported
                    ? 'text-[#b4b4b4] hover:text-[#666] hover:bg-[#f4f4f4]'
                    : 'text-[#d4d4d4] cursor-not-allowed'"
                :disabled="!thinkingSupported"
                @click="toggleThinking"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M12 2a8 8 0 0 0-8 8c0 3.4 2.1 6.3 5 7.4V20a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1v-2.6c2.9-1.1 5-4 5-7.4a8 8 0 0 0-8-8z" />
                  <line x1="9" y1="23" x2="15" y2="23" />
                </svg>
                <span>思考</span>
                <template v-if="thinkingEnabled">
                  <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </template>
              </button>
              <!-- Model selector pills -->
              <ModelSelector v-model="selectedModel" />
            </div>

            <!-- Right group: mic, send/stop -->
            <div class="flex items-center gap-1">
              <button class="icon-btn-sm text-[#666] hover:text-[#0d0d0d]">
                <Icon name="mic" :size="18" :stroke-width="1.8" />
              </button>
              <button
                v-if="loading"
                class="flex items-center justify-center w-8 h-8 rounded-full bg-black hover:bg-[#2b2b2b] transition-colors"
                @click="handleStop"
              >
                <Icon name="stop" :size="14" />
              </button>
              <button
                v-else
                class="flex items-center justify-center w-8 h-8 rounded-full transition-all"
                :class="buttonDisabled ? 'bg-[#d9d9e3] text-white cursor-not-allowed' : 'bg-black text-white hover:bg-[#2b2b2b] cursor-pointer'"
                :disabled="buttonDisabled"
                @click="handleSubmit"
              >
                <Icon name="arrow-up" :size="16" :stroke-width="2.5" />
              </button>
            </div>
          </div>
        </div>

        <!-- Disclaimer -->
        <p class="text-center text-[11px] text-[#ccc] mt-2 leading-normal">
          AI 可能会犯错。请核查重要信息。
        </p>
      </div>
    </footer>

  </div>
</template>

<style scoped>
textarea {
  font-family: inherit;
  scrollbar-width: thin;
  scrollbar-color: rgba(0,0,0,0.1) transparent;
}
textarea::-webkit-scrollbar { width: 4px; }
textarea::-webkit-scrollbar-track { background: transparent; }
textarea::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.1); border-radius: 2px; }
textarea::placeholder { font-weight: 400; }

/* Reusable patterns */
.icon-btn {
  @apply flex items-center justify-center w-9 h-9 rounded-xl hover:bg-[#f4f4f4] transition-colors;
}
.icon-btn-sm {
  @apply flex items-center justify-center w-8 h-8 rounded-full hover:bg-[#f4f4f4] transition-colors;
}
.menu-item {
  @apply flex items-center gap-3 w-full px-4 py-2.5 text-sm text-[#0d0d0d] hover:bg-[#f4f4f4] transition-colors text-left;
}
.menu-panel {
  @apply bg-white rounded-xl shadow-[0_4px_24px_rgba(0,0,0,0.12)] border border-[#e8e8e8] py-1.5;
}
</style>
