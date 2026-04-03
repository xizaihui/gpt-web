/**
 * Codex OAuth Token Manager
 * Manages OpenAI Codex OAuth tokens: read from OpenClaw profiles or local storage,
 * auto-refresh when expired, and provide access tokens for API calls.
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.join(__dirname, '..', 'data')
const TOKEN_FILE = path.join(DATA_DIR, 'codex-tokens.json')

// OpenClaw auth profiles path
const OPENCLAW_AUTH = path.join(
  process.env.HOME || '/root',
  '.openclaw/agents/main/agent/auth-profiles.json'
)

const CODEX_BASE_URL = 'https://chatgpt.com/backend-api'
const CODEX_ENDPOINT = '/codex/responses'

export interface CodexToken {
  email: string
  access: string
  refresh: string
  expires: number // ms timestamp
  provider: string
}

interface TokenStore {
  tokens: CodexToken[]
  lastUpdated: number
}

// ── Token storage ──

function loadTokenStore(): TokenStore {
  try {
    if (fs.existsSync(TOKEN_FILE)) {
      return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf-8'))
    }
  } catch {}
  return { tokens: [], lastUpdated: 0 }
}

function saveTokenStore(store: TokenStore): void {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  store.lastUpdated = Date.now()
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(store, null, 2))
}

// ── Sync from OpenClaw ──

export function syncFromOpenClaw(): CodexToken[] {
  try {
    if (!fs.existsSync(OPENCLAW_AUTH)) return []
    const data = JSON.parse(fs.readFileSync(OPENCLAW_AUTH, 'utf-8'))
    const profiles = data.profiles || {}
    const tokens: CodexToken[] = []

    for (const [key, profile] of Object.entries(profiles) as [string, any][]) {
      if (profile.provider === 'openai-codex' && profile.access) {
        tokens.push({
          email: profile.email || key.replace('openai-codex:', ''),
          access: profile.access,
          refresh: profile.refresh || '',
          expires: profile.expires || 0,
          provider: 'openai-codex',
        })
      }
    }

    if (tokens.length > 0) {
      const store = loadTokenStore()
      // Merge: update existing, add new
      for (const t of tokens) {
        const idx = store.tokens.findIndex(s => s.email === t.email)
        if (idx >= 0) {
          store.tokens[idx] = t
        } else {
          store.tokens.push(t)
        }
      }
      saveTokenStore(store)
    }

    return tokens
  } catch (e) {
    console.error('[Codex] Failed to sync from OpenClaw:', e)
    return []
  }
}

// ── Token management ──

export function getActiveTokens(): CodexToken[] {
  const store = loadTokenStore()
  // Filter non-expired tokens (with 5 min buffer)
  const now = Date.now()
  return store.tokens.filter(t => t.expires > now + 5 * 60 * 1000)
}

export function getAllTokens(): CodexToken[] {
  return loadTokenStore().tokens
}

export function addToken(token: CodexToken): void {
  const store = loadTokenStore()
  const idx = store.tokens.findIndex(t => t.email === token.email)
  if (idx >= 0) {
    store.tokens[idx] = token
  } else {
    store.tokens.push(token)
  }
  saveTokenStore(store)
}

export function removeToken(email: string): void {
  const store = loadTokenStore()
  store.tokens = store.tokens.filter(t => t.email !== email)
  saveTokenStore(store)
}

// ── Get best available token (round-robin or first valid) ──

let lastTokenIndex = 0

export function getBestToken(): CodexToken | null {
  // First try syncing from OpenClaw if local store is empty
  let tokens = getActiveTokens()
  if (tokens.length === 0) {
    syncFromOpenClaw()
    tokens = getActiveTokens()
  }
  if (tokens.length === 0) return null

  // Round-robin
  lastTokenIndex = (lastTokenIndex + 1) % tokens.length
  return tokens[lastTokenIndex]
}

// ── Codex API call ──

export async function chatWithCodex(
  model: string,
  systemMessage: string | undefined,
  history: Array<{ role: string; content: string }> | undefined,
  message: string,
  onProgress: ((data: any) => void) | undefined,
): Promise<{ success: boolean; error?: string }> {
  const token = getBestToken()
  if (!token) {
    return { success: false, error: '没有可用的 ChatGPT OAuth 令牌，请在设置中配置' }
  }

  // Build input in Responses API format
  const input: Array<{ role: string; content: string }> = []

  if (history && Array.isArray(history)) {
    for (const msg of history) {
      input.push({ role: msg.role, content: msg.content })
    }
  }

  input.push({ role: 'user', content: message })

  const requestBody: Record<string, any> = {
    model,
    instructions: systemMessage || 'You are a helpful assistant.',
    input,
    store: false,
    stream: true,
  }

  const url = `${CODEX_BASE_URL}${CODEX_ENDPOINT}`
  console.log(`[Codex] POST ${url} | model: ${model} | account: ${token.email} | input: ${input.length} msgs`)

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token.access}`,
      'accept': 'text/event-stream',
    },
    body: JSON.stringify(requestBody),
  })

  if (!response.ok) {
    const errorText = await response.text()
    // Check if token expired
    if (response.status === 401 || response.status === 403) {
      return { success: false, error: `OAuth 令牌已过期 (${token.email})，请重新授权` }
    }
    return { success: false, error: `Codex API error ${response.status}: ${errorText}` }
  }

  const reader = response.body as any
  const decoder = new TextDecoder()
  let fullText = ''
  let buffer = ''
  let responseModel = model
  let finalUsage: any = null

  for await (const chunk of reader) {
    buffer += decoder.decode(chunk, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      const trimmed = line.trim()

      // Parse SSE: "event: xxx" and "data: {...}"
      if (trimmed.startsWith('data: ')) {
        const data = trimmed.slice(6)
        if (data === '[DONE]') break

        try {
          const parsed = JSON.parse(data)
          const eventType = parsed.type

          // Text delta
          if (eventType === 'response.output_text.delta' && parsed.delta) {
            fullText += parsed.delta
            onProgress?.({
              id: parsed.item_id || 'msg',
              text: fullText,
              role: 'assistant',
              model: responseModel,
              detail: parsed,
            })
          }

          // Response created - get model info
          if (eventType === 'response.created' && parsed.response) {
            responseModel = parsed.response.model || model
          }

          // Response completed - get usage
          if (eventType === 'response.completed' && parsed.response) {
            const usage = parsed.response.usage
            if (usage) {
              finalUsage = {
                prompt_tokens: usage.input_tokens || 0,
                completion_tokens: usage.output_tokens || 0,
                total_tokens: usage.total_tokens || ((usage.input_tokens || 0) + (usage.output_tokens || 0)),
                prompt_tokens_details: {
                  cached_tokens: usage.input_tokens_details?.cached_tokens || 0,
                },
              }
            }
          }
        } catch {
          // skip unparseable
        }
      }
    }
  }

  // Send final update with usage
  if (finalUsage) {
    console.log(`[Codex] usage:`, JSON.stringify(finalUsage))
    onProgress?.({
      id: 'usage',
      text: fullText,
      role: 'assistant',
      model: responseModel,
      usage: finalUsage,
    })
  }

  return { success: true }
}

// ── Available Codex models ──

export const CODEX_MODELS = [
  { id: 'codex:gpt-5.4', name: 'GPT-5.4 (订阅)', provider: 'ChatGPT Plus', codexModel: 'gpt-5.4' },
]

// ── Init: sync on startup ──
syncFromOpenClaw()
