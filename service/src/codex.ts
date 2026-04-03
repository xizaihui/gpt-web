/**
 * Codex Account Pool - ChatGPT Plus/Pro Subscription Token Management
 * 
 * Features:
 * - Multi-account OAuth token pool with round-robin load balancing
 * - Auto token refresh (refresh_token grant)
 * - JWT decode for account metadata (plan, email, accountId)
 * - Per-account SOCKS5 proxy support
 * - Usage tracking (request count, last used time, errors)
 * - OAuth authorization flow (PKCE) for adding new accounts
 */
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.join(__dirname, '..', 'data')
const POOL_FILE = path.join(DATA_DIR, 'codex-pool.json')

// OpenClaw auth profiles path
const OPENCLAW_AUTH = path.join(
  process.env.HOME || '/root',
  '.openclaw/agents/main/agent/auth-profiles.json'
)

// ── Constants ──
const CODEX_BASE_URL = 'https://chatgpt.com/backend-api'
const CODEX_ENDPOINT = '/codex/responses'
const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
const AUTHORIZE_URL = 'https://auth.openai.com/oauth/authorize'
const TOKEN_URL = 'https://auth.openai.com/oauth/token'
const SCOPE = 'openid profile email offline_access'
const TOKEN_REFRESH_BUFFER = 30 * 60 * 1000 // refresh 30 min before expiry

// ── Types ──
export interface CodexAccount {
  id: string                    // unique id (uuid)
  email: string                 // account email
  accessToken: string           // current access token
  refreshToken: string          // refresh token (long-lived)
  expiresAt: number             // access token expiry (ms timestamp)
  accountId: string             // chatgpt_account_id from JWT
  userId: string                // chatgpt_user_id from JWT
  plan: string                  // plus / pro / free
  status: 'active' | 'expired' | 'error' | 'disabled' // account status
  proxy?: string                // socks5://user:pass@host:port (optional)
  addedAt: number               // when added (ms timestamp)
  lastUsedAt: number            // last API call (ms timestamp)
  lastRefreshedAt: number       // last token refresh (ms timestamp)
  requestCount: number          // total requests made
  errorCount: number            // total errors
  lastError?: string            // last error message
  source: 'oauth' | 'openclaw' | 'manual' // how it was added
}

interface PoolStore {
  accounts: CodexAccount[]
  lastUpdated: number
  roundRobinIndex: number
}

// ── JWT Decode ──
function decodeJwt(token: string): any | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    let payload = parts[1]
    payload += '='.repeat(4 - (payload.length % 4))
    const decoded = Buffer.from(payload, 'base64url').toString('utf-8')
    return JSON.parse(decoded)
  } catch { return null }
}

function extractAccountInfo(accessToken: string): {
  email: string; accountId: string; userId: string; plan: string; expiresAt: number
} | null {
  const jwt = decodeJwt(accessToken)
  if (!jwt) return null
  const auth = jwt['https://api.openai.com/auth'] || {}
  const profile = jwt['https://api.openai.com/profile'] || {}
  return {
    email: profile.email || '',
    accountId: auth.chatgpt_account_id || '',
    userId: auth.chatgpt_user_id || '',
    plan: auth.chatgpt_plan_type || 'unknown',
    expiresAt: (jwt.exp || 0) * 1000,
  }
}

// ── Storage ──
function loadPool(): PoolStore {
  try {
    if (fs.existsSync(POOL_FILE)) {
      return JSON.parse(fs.readFileSync(POOL_FILE, 'utf-8'))
    }
  } catch {}
  return { accounts: [], lastUpdated: 0, roundRobinIndex: 0 }
}

function savePool(pool: PoolStore): void {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  pool.lastUpdated = Date.now()
  fs.writeFileSync(POOL_FILE, JSON.stringify(pool, null, 2))
}

// ── Token Refresh ──
async function refreshAccessToken(refreshToken: string, proxy?: string): Promise<{
  success: boolean; access?: string; refresh?: string; expires?: number; error?: string
}> {
  try {
    // TODO: proxy support via socks5 agent
    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: CLIENT_ID,
      }),
    })
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      return { success: false, error: `Refresh failed (${response.status}): ${text}` }
    }
    const json: any = await response.json()
    if (!json.access_token || !json.refresh_token || typeof json.expires_in !== 'number') {
      return { success: false, error: 'Token refresh response missing fields' }
    }
    return {
      success: true,
      access: json.access_token,
      refresh: json.refresh_token,
      expires: Date.now() + json.expires_in * 1000,
    }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
}

// ── Public API ──

/** Get all accounts (with masked tokens for API response) */
export function listAccounts(): Array<Omit<CodexAccount, 'accessToken' | 'refreshToken'> & { tokenPreview: string }> {
  const pool = loadPool()
  return pool.accounts.map(a => {
    const { accessToken, refreshToken, ...rest } = a
    return {
      ...rest,
      tokenPreview: accessToken ? `${accessToken.slice(0, 20)}...` : '(none)',
    }
  })
}

/** Get a single account by id */
export function getAccount(id: string): CodexAccount | null {
  const pool = loadPool()
  return pool.accounts.find(a => a.id === id) || null
}

/** Add account from OAuth tokens */
export function addAccount(
  accessToken: string, refreshToken: string, expiresAt: number,
  opts?: { proxy?: string; source?: 'oauth' | 'openclaw' | 'manual' }
): CodexAccount | null {
  const info = extractAccountInfo(accessToken)
  if (!info) return null

  const pool = loadPool()
  
  // Check if account already exists (by email or accountId)
  const existing = pool.accounts.findIndex(
    a => a.email === info.email || a.accountId === info.accountId
  )
  
  const account: CodexAccount = {
    id: existing >= 0 ? pool.accounts[existing].id : crypto.randomUUID(),
    email: info.email,
    accessToken,
    refreshToken,
    expiresAt: expiresAt || info.expiresAt,
    accountId: info.accountId,
    userId: info.userId,
    plan: info.plan,
    status: 'active',
    proxy: opts?.proxy,
    addedAt: existing >= 0 ? pool.accounts[existing].addedAt : Date.now(),
    lastUsedAt: existing >= 0 ? pool.accounts[existing].lastUsedAt : 0,
    lastRefreshedAt: Date.now(),
    requestCount: existing >= 0 ? pool.accounts[existing].requestCount : 0,
    errorCount: existing >= 0 ? pool.accounts[existing].errorCount : 0,
    source: opts?.source || 'manual',
  }

  if (existing >= 0) {
    pool.accounts[existing] = account
  } else {
    pool.accounts.push(account)
  }

  savePool(pool)
  console.log(`[CodexPool] ${existing >= 0 ? 'Updated' : 'Added'} account: ${info.email} (${info.plan})`)
  return account
}

/** Remove account by id */
export function removeAccount(id: string): boolean {
  const pool = loadPool()
  const before = pool.accounts.length
  pool.accounts = pool.accounts.filter(a => a.id !== id)
  if (pool.accounts.length < before) {
    savePool(pool)
    return true
  }
  return false
}

/** Update account settings (proxy, status) */
export function updateAccount(id: string, updates: {
  proxy?: string | null; status?: 'active' | 'disabled'
}): boolean {
  const pool = loadPool()
  const account = pool.accounts.find(a => a.id === id)
  if (!account) return false
  if (updates.proxy !== undefined) account.proxy = updates.proxy || undefined
  if (updates.status !== undefined) account.status = updates.status
  savePool(pool)
  return true
}

/** Sync accounts from OpenClaw auth profiles */
export function syncFromOpenClaw(): number {
  try {
    if (!fs.existsSync(OPENCLAW_AUTH)) return 0
    const data = JSON.parse(fs.readFileSync(OPENCLAW_AUTH, 'utf-8'))
    const profiles = data.profiles || {}
    let count = 0

    for (const [_key, profile] of Object.entries(profiles) as [string, any][]) {
      if (profile.provider === 'openai-codex' && profile.access) {
        const result = addAccount(
          profile.access, profile.refresh || '', profile.expires || 0,
          { source: 'openclaw' }
        )
        if (result) count++
      }
    }
    return count
  } catch (e) {
    console.error('[CodexPool] Failed to sync from OpenClaw:', e)
    return 0
  }
}

/** Refresh a specific account's token */
export async function refreshAccount(id: string): Promise<{ success: boolean; error?: string }> {
  const pool = loadPool()
  const account = pool.accounts.find(a => a.id === id)
  if (!account) return { success: false, error: 'Account not found' }
  if (!account.refreshToken) return { success: false, error: 'No refresh token' }

  const result = await refreshAccessToken(account.refreshToken, account.proxy)
  if (!result.success) {
    account.status = 'error'
    account.lastError = result.error
    account.errorCount++
    savePool(pool)
    return { success: false, error: result.error }
  }

  account.accessToken = result.access!
  account.refreshToken = result.refresh!
  account.expiresAt = result.expires!
  account.lastRefreshedAt = Date.now()
  account.status = 'active'
  account.lastError = undefined

  // Update JWT info
  const info = extractAccountInfo(result.access!)
  if (info) {
    account.plan = info.plan
    account.accountId = info.accountId
  }

  savePool(pool)
  console.log(`[CodexPool] Refreshed token for ${account.email}, expires in ${Math.floor((account.expiresAt - Date.now()) / 3600000)}h`)
  return { success: true }
}

/** Refresh all accounts that need it */
export async function refreshAllAccounts(): Promise<{ refreshed: number; failed: number }> {
  const pool = loadPool()
  let refreshed = 0, failed = 0
  const now = Date.now()

  for (const account of pool.accounts) {
    if (account.status === 'disabled') continue
    if (account.expiresAt > now + TOKEN_REFRESH_BUFFER) continue // not yet
    if (!account.refreshToken) {
      account.status = 'expired'
      failed++
      continue
    }

    const result = await refreshAccessToken(account.refreshToken, account.proxy)
    if (result.success) {
      account.accessToken = result.access!
      account.refreshToken = result.refresh!
      account.expiresAt = result.expires!
      account.lastRefreshedAt = now
      account.status = 'active'
      account.lastError = undefined
      const info = extractAccountInfo(result.access!)
      if (info) account.plan = info.plan
      refreshed++
    } else {
      account.status = 'error'
      account.lastError = result.error
      account.errorCount++
      failed++
    }
  }

  savePool(pool)
  return { refreshed, failed }
}

/** Get next available account (round-robin among active accounts) */
export function getNextAccount(): CodexAccount | null {
  const pool = loadPool()
  const now = Date.now()
  const active = pool.accounts.filter(
    a => a.status === 'active' && a.expiresAt > now + 5 * 60 * 1000
  )
  if (active.length === 0) return null

  pool.roundRobinIndex = (pool.roundRobinIndex + 1) % active.length
  const account = active[pool.roundRobinIndex]
  
  // Update last used
  const real = pool.accounts.find(a => a.id === account.id)!
  real.lastUsedAt = now
  real.requestCount++
  savePool(pool)

  return account
}

/** Record an error for an account */
export function recordError(id: string, error: string): void {
  const pool = loadPool()
  const account = pool.accounts.find(a => a.id === id)
  if (!account) return
  account.errorCount++
  account.lastError = error
  if (error.includes('401') || error.includes('403') || error.includes('expired')) {
    account.status = 'expired'
  }
  savePool(pool)
}

// ── OAuth Authorization Flow ──

interface PendingAuth {
  state: string
  verifier: string
  challenge: string
  redirectUri: string
  createdAt: number
}

const pendingAuths = new Map<string, PendingAuth>()

/** Start OAuth flow: returns authorization URL for user to visit */
export async function startOAuthFlow(): Promise<{
  authUrl: string; state: string
}> {
  // Generate PKCE
  const verifierBytes = crypto.randomBytes(32)
  const verifier = verifierBytes.toString('base64url')
  const challenge = crypto
    .createHash('sha256')
    .update(verifier)
    .digest('base64url')
  const state = crypto.randomBytes(16).toString('hex')

  // Use localhost:1455 as redirect URI (OpenAI's registered callback)
  // User will need to copy the redirect URL and paste it back
  const redirectUri = 'http://localhost:1455/auth/callback'

  const url = new URL(AUTHORIZE_URL)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', CLIENT_ID)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('scope', SCOPE)
  url.searchParams.set('code_challenge', challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set('state', state)
  url.searchParams.set('id_token_add_organizations', 'true')
  url.searchParams.set('codex_cli_simplified_flow', 'true')
  url.searchParams.set('originator', 'chatgpt-web')

  pendingAuths.set(state, {
    state, verifier, challenge,
    redirectUri,
    createdAt: Date.now(),
  })

  // Clean up old pending auths (>10 min)
  for (const [k, v] of pendingAuths) {
    if (Date.now() - v.createdAt > 10 * 60 * 1000) pendingAuths.delete(k)
  }

  return { authUrl: url.toString(), state }
}

/** Complete OAuth flow: exchange code for tokens */
export async function completeOAuthFlow(code: string, state: string, proxy?: string): Promise<{
  success: boolean; account?: CodexAccount; error?: string
}> {
  const pending = pendingAuths.get(state)
  if (!pending) {
    return { success: false, error: '授权已过期或无效，请重新发起' }
  }
  pendingAuths.delete(state)

  try {
    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: CLIENT_ID,
        code,
        code_verifier: pending.verifier,
        redirect_uri: pending.redirectUri,
      }),
    })

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      return { success: false, error: `Token exchange failed (${response.status}): ${text}` }
    }

    const json: any = await response.json()
    if (!json.access_token || !json.refresh_token) {
      return { success: false, error: 'Token response missing required fields' }
    }

    const expiresAt = Date.now() + (json.expires_in || 864000) * 1000
    const account = addAccount(json.access_token, json.refresh_token, expiresAt, {
      proxy, source: 'oauth',
    })

    if (!account) {
      return { success: false, error: 'Failed to extract account info from token' }
    }

    return { success: true, account }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
}

// ── Pool Stats ──
export function getPoolStats(): {
  total: number; active: number; expired: number; error: number; disabled: number
} {
  const pool = loadPool()
  const now = Date.now()
  return {
    total: pool.accounts.length,
    active: pool.accounts.filter(a => a.status === 'active' && a.expiresAt > now).length,
    expired: pool.accounts.filter(a => a.status === 'expired' || (a.status === 'active' && a.expiresAt <= now)).length,
    error: pool.accounts.filter(a => a.status === 'error').length,
    disabled: pool.accounts.filter(a => a.status === 'disabled').length,
  }
}

// ── Codex Chat API ──
export async function chatWithCodex(
  model: string,
  systemMessage: string | undefined,
  history: Array<{ role: string; content: string }> | undefined,
  message: string,
  onProgress: ((data: any) => void) | undefined,
): Promise<{ success: boolean; error?: string }> {
  const account = getNextAccount()
  if (!account) {
    return { success: false, error: '号池中没有可用的 ChatGPT 账号，请添加授权' }
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
  console.log(`[CodexPool] POST ${url} | model: ${model} | account: ${account.email} | input: ${input.length} msgs`)

  try {
    // TODO: proxy support via socks5 agent when account.proxy is set
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${account.accessToken}`,
        'accept': 'text/event-stream',
        'chatgpt-account-id': account.accountId,
      },
      body: JSON.stringify(requestBody),
    })

    if (!response.ok) {
      const errorText = await response.text()
      const errMsg = `Codex API error ${response.status}: ${errorText.slice(0, 200)}`
      recordError(account.id, errMsg)
      
      if (response.status === 401 || response.status === 403) {
        // Try to auto-refresh and retry once
        const refreshResult = await refreshAccount(account.id)
        if (refreshResult.success) {
          return chatWithCodex(model, systemMessage, history, message, onProgress)
        }
        return { success: false, error: `OAuth 令牌已过期 (${account.email})，刷新失败` }
      }
      return { success: false, error: errMsg }
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
        if (trimmed.startsWith('data: ')) {
          const data = trimmed.slice(6)
          if (data === '[DONE]') break

          try {
            const parsed = JSON.parse(data)
            const eventType = parsed.type

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

            if (eventType === 'response.created' && parsed.response) {
              responseModel = parsed.response.model || model
            }

            // Check for usage limit
            if (eventType === 'response.failed' || parsed.response?.status === 'failed') {
              const errDetail = parsed.response?.error?.message || 'Request failed'
              if (errDetail.includes('usage_limit_reached') || errDetail.includes('rate')) {
                recordError(account.id, 'Usage limit reached')
                return { success: false, error: `账号 ${account.email} 已达到使用限额` }
              }
            }

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
          } catch { /* skip */ }
        }
      }
    }

    if (finalUsage) {
      console.log(`[CodexPool] usage (${account.email}):`, JSON.stringify(finalUsage))
      onProgress?.({
        id: 'usage',
        text: fullText,
        role: 'assistant',
        model: responseModel,
        usage: finalUsage,
      })
    }

    return { success: true }
  } catch (e: any) {
    recordError(account.id, e.message)
    return { success: false, error: e.message }
  }
}

// ── Available Codex models ──
export const CODEX_MODELS = [
  { id: 'codex:gpt-5.4', name: 'GPT-5.4 (订阅)', provider: 'ChatGPT Plus', codexModel: 'gpt-5.4' },
]

// ── Auto-init: sync from OpenClaw + schedule refresh ──
syncFromOpenClaw()

// Refresh tokens every 4 hours
setInterval(async () => {
  const result = await refreshAllAccounts()
  if (result.refreshed > 0 || result.failed > 0) {
    console.log(`[CodexPool] Auto-refresh: ${result.refreshed} refreshed, ${result.failed} failed`)
  }
}, 4 * 60 * 60 * 1000)
