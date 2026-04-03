import type { GenericAbortSignal } from 'axios'
import { post } from '@/utils/request'
import { useAuthStore, useSettingStore } from '@/store'

// ---- Base URL helper ----
function apiUrl(path: string): string {
  const base = import.meta.env.VITE_GLOB_API_URL || '/api'
  return `${base}${path}`
}

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  try {
    const authStore = useAuthStore()
    if (authStore.token)
      headers.Authorization = `Bearer ${authStore.token}`
  }
  catch {
    // Store not yet initialized — skip auth header
  }
  return headers
}

async function apiGet<T = any>(path: string): Promise<T> {
  const res = await fetch(apiUrl(path), { headers: authHeaders() })
  const json = await res.json()
  if (json.status !== 'Success') throw new Error(json.message || 'API error')
  return json.data
}

async function apiPost<T = any>(path: string, data?: any): Promise<T> {
  const res = await fetch(apiUrl(path), {
    method: 'POST',
    headers: authHeaders(),
    body: data ? JSON.stringify(data) : undefined,
  })
  const json = await res.json()
  if (json.status !== 'Success') throw new Error(json.message || 'API error')
  return json.data
}

async function apiPut<T = any>(path: string, data?: any): Promise<T> {
  const res = await fetch(apiUrl(path), {
    method: 'PUT',
    headers: authHeaders(),
    body: data ? JSON.stringify(data) : undefined,
  })
  const json = await res.json()
  if (json.status !== 'Success') throw new Error(json.message || 'API error')
  return json.data
}

async function apiPatch<T = any>(path: string, data?: any): Promise<T> {
  const res = await fetch(apiUrl(path), {
    method: 'PATCH',
    headers: authHeaders(),
    body: data ? JSON.stringify(data) : undefined,
  })
  const json = await res.json()
  if (json.status !== 'Success') throw new Error(json.message || 'API error')
  return json.data
}

async function apiDelete<T = any>(path: string): Promise<T> {
  const res = await fetch(apiUrl(path), { method: 'DELETE', headers: authHeaders() })
  const json = await res.json()
  if (json.status !== 'Success') throw new Error(json.message || 'API error')
  return json.data
}

// ---- Storage API (conversations + messages) ----

export function fetchConversations(): Promise<Array<{ uuid: number; title: string; isEdit: boolean }>> {
  return apiGet('/conversations')
}

export function createConversation(uuid: number, title: string): Promise<void> {
  return apiPost('/conversations', { uuid, title })
}

export function updateConversationTitle(uuid: number, title: string): Promise<void> {
  return apiPatch(`/conversations/${uuid}`, { title })
}

export function deleteConversation(uuid: number): Promise<void> {
  return apiDelete(`/conversations/${uuid}`)
}

export function clearAllConversations(): Promise<void> {
  return apiDelete('/conversations')
}

export function fetchMessages(uuid: number): Promise<Chat.Chat[]> {
  return apiGet(`/conversations/${uuid}/messages`)
}

export function saveMessage(uuid: number, index: number, msg: Partial<Chat.Chat>): Promise<void> {
  return apiPut(`/conversations/${uuid}/messages/${index}`, msg)
}

export function deleteMessage(uuid: number, index: number): Promise<void> {
  return apiDelete(`/conversations/${uuid}/messages/${index}`)
}

export function clearMessages(uuid: number): Promise<void> {
  return apiDelete(`/conversations/${uuid}/messages`)
}

export function importState(state: { history: any[]; chat: any[] }): Promise<{ imported: number }> {
  return apiPost('/conversations/import', state)
}

// ---- Codex Account Pool API ----

export function fetchPoolStats(): Promise<{ total: number; active: number; expired: number; error: number; disabled: number }> {
  return apiGet('/codex/pool/stats')
}

export function fetchPoolAccounts(): Promise<any[]> {
  return apiGet('/codex/pool/accounts')
}

export function syncPool(): Promise<{ synced: number }> {
  return apiPost('/codex/pool/sync')
}

export function removePoolAccount(id: string): Promise<void> {
  return apiDelete(`/codex/pool/accounts/${encodeURIComponent(id)}`)
}

export function updatePoolAccount(id: string, data: { proxy?: string | null; status?: string }): Promise<void> {
  return apiPatch(`/codex/pool/accounts/${encodeURIComponent(id)}`, data)
}

export function refreshPoolAccount(id: string): Promise<void> {
  return apiPost(`/codex/pool/accounts/${encodeURIComponent(id)}/refresh`)
}

export function refreshAllPoolAccounts(): Promise<{ refreshed: number; failed: number }> {
  return apiPost('/codex/pool/refresh-all')
}

export function startOAuth(): Promise<{ authUrl: string; state: string }> {
  return apiPost('/codex/oauth/start')
}

export function completeOAuth(code: string, state: string, proxy?: string): Promise<{ email: string; plan: string }> {
  return apiPost('/codex/oauth/complete', { code, state, proxy })
}

export function fetchAccountQuota(id: string): Promise<any> {
  return apiGet(`/codex/pool/accounts/${encodeURIComponent(id)}/quota`)
}

export function fetchAllQuotas(): Promise<any[]> {
  return apiGet('/codex/pool/quotas')
}

export function fetchChatAPI<T = any>(
  prompt: string,
  options?: { conversationId?: string; parentMessageId?: string },
  signal?: GenericAbortSignal,
) {
  return post<T>({
    url: '/chat',
    data: { prompt, options },
    signal,
  })
}

export function fetchChatConfig<T = any>() {
  return post<T>({
    url: '/config',
  })
}

/**
 * Stream chat via native fetch + ReadableStream (SSE).
 * Much smoother than Axios onDownloadProgress hack.
 */
export async function fetchChatAPIProcess<T = any>(
  params: {
    prompt: string
    options?: { conversationId?: string; parentMessageId?: string }
    signal?: AbortSignal
    onProgress?: (data: any) => void
    model?: string
    apiBaseUrl?: string
    apiKey?: string
    files?: Array<{ name: string; type: string; base64: string }>
    history?: Array<{ role: string; content: string }>
  },
): Promise<void> {
  const settingStore = useSettingStore()
  const authStore = useAuthStore()

  const data: Record<string, any> = {
    prompt: params.prompt,
    options: params.options,
  }

  if (params.model)
    data.model = params.model

  if (params.files && params.files.length > 0)
    data.files = params.files

  if (params.history && params.history.length > 0)
    data.history = params.history

  const apiBaseUrl = params.apiBaseUrl || settingStore.apiBaseUrl
  const apiKey = params.apiKey || settingStore.apiKey

  if (apiBaseUrl) data.apiBaseUrl = apiBaseUrl
  if (apiKey) data.apiKey = apiKey

  if (authStore.isChatGPTAPI) {
    data.systemMessage = settingStore.systemMessage
    data.temperature = settingStore.temperature
    data.top_p = settingStore.top_p
  }

  // Build full URL (relative to current origin)
  const baseUrl = import.meta.env.VITE_GLOB_API_URL || '/api'
  const url = `${baseUrl}/chat-process`

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  const token = authStore.token
  if (token)
    headers.Authorization = `Bearer ${token}`

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(data),
    signal: params.signal,
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`请求失败 (${response.status}): ${text}`)
  }

  if (!response.body)
    throw new Error('浏览器不支持流式响应')

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })

      // Parse SSE lines
      const lines = buffer.split('\n')
      // Keep the last potentially incomplete line in the buffer
      buffer = lines.pop() || ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        if (!trimmed.startsWith('data: ')) continue

        const payload = trimmed.slice(6)
        if (payload === '[DONE]') return

        try {
          const parsed = JSON.parse(payload)

          // Check for server-side error
          if (parsed.error) {
            throw new Error(parsed.message || '服务端错误')
          }

          params.onProgress?.(parsed)
        }
        catch (e: any) {
          // If it's our thrown error, re-throw it
          if (e.message && (e.message.includes('服务端错误') || e.message.includes('API error')))
            throw e
          // Otherwise skip unparseable SSE lines
        }
      }
    }
  }
  finally {
    reader.releaseLock()
  }
}

export function fetchSession<T>() {
  return post<T>({
    url: '/session',
  })
}

export function fetchVerify<T>(token: string) {
  return post<T>({
    url: '/verify',
    data: { token },
  })
}
