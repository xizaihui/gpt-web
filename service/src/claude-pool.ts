/**
 * Claude Account Pool - Anthropic Pro/Max Subscription Token Management
 * 
 * Features:
 * - Multi-account OAuth token pool with round-robin load balancing
 * - Auto token refresh (refresh_token grant)
 * - OAuth PKCE flow (Claude Code style) for adding new accounts
 * - Per-account proxy support (HTTP/HTTPS/SOCKS5)
 * - Anti-detection headers (mimics official Claude Code CLI)
 * - Usage tracking (request count, last used time, errors)
 */
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { fileURLToPath } from 'url'
import { ProxyAgent, fetch as undiciFetch } from 'undici'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.join(__dirname, '..', 'data')
const POOL_FILE = path.join(DATA_DIR, 'claude-pool.json')
const PROXY_FILE = path.join(DATA_DIR, 'claude-proxies.json')

// ── Claude OAuth Constants ──
const AUTHORIZE_URL = 'https://claude.ai/oauth/authorize'
const TOKEN_URL = 'https://console.anthropic.com/v1/oauth/token'
const API_BASE_URL = 'https://api.anthropic.com'
const CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e'
const REDIRECT_URI = 'https://console.anthropic.com/oauth/code/callback'
const SCOPE = 'org:create_api_key user:profile user:inference'
const ANTHROPIC_VERSION = '2023-06-01'
const CLAUDE_CLI_VERSION = '2.2.0'
const BETA_FLAGS = 'oauth-2025-04-20,claude-code-20250219,prompt-caching-2024-07-31,extended-cache-ttl-2025-04-11'
const TOKEN_REFRESH_BUFFER = 10 * 60 * 1000 // refresh 10 min before expiry

// ── Proxy-aware fetch ──
function proxyFetch(url: string | URL, init?: RequestInit & { proxy?: string }): Promise<Response> {
  const proxyUrl = init?.proxy
  if (!proxyUrl) return fetch(url, init as any)
  const dispatcher = new ProxyAgent({ uri: proxyUrl })
  const { proxy: _, ...rest } = init || {}
  return undiciFetch(url as any, { ...rest, dispatcher } as any) as unknown as Promise<Response>
}

// ── Proxy Management ──
export interface ClaudeProxyConfig {
  id: string
  name: string
  url: string
  status: 'active' | 'error' | 'disabled'
  addedAt: number
  lastTestedAt: number
  lastError?: string
}

interface ProxyStore {
  proxies: ClaudeProxyConfig[]
  lastUpdated: number
}

function loadProxies(): ProxyStore {
  try {
    if (fs.existsSync(PROXY_FILE)) return JSON.parse(fs.readFileSync(PROXY_FILE, 'utf-8'))
  } catch {}
  return { proxies: [], lastUpdated: 0 }
}

function saveProxies(store: ProxyStore): void {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  store.lastUpdated = Date.now()
  fs.writeFileSync(PROXY_FILE, JSON.stringify(store, null, 2))
}

export function listClaudeProxies(): ClaudeProxyConfig[] {
  return loadProxies().proxies
}

export function addClaudeProxy(name: string, url: string): ClaudeProxyConfig {
  const store = loadProxies()
  const existing = store.proxies.findIndex(p => p.url === url)
  const proxy: ClaudeProxyConfig = {
    id: existing >= 0 ? store.proxies[existing].id : crypto.randomUUID(),
    name, url, status: 'active',
    addedAt: existing >= 0 ? store.proxies[existing].addedAt : Date.now(),
    lastTestedAt: 0,
  }
  if (existing >= 0) store.proxies[existing] = proxy
  else store.proxies.push(proxy)
  saveProxies(store)
  return proxy
}

export function removeClaudeProxy(id: string): boolean {
  const store = loadProxies()
  const before = store.proxies.length
  store.proxies = store.proxies.filter(p => p.id !== id)
  if (store.proxies.length < before) {
    const pool = loadPool()
    for (const acc of pool.accounts) {
      if (acc.proxy === id) acc.proxy = undefined
    }
    savePool(pool)
    saveProxies(store)
    return true
  }
  return false
}

export function updateClaudeProxy(id: string, updates: { name?: string; url?: string; status?: 'active' | 'disabled' }): boolean {
  const store = loadProxies()
  const proxy = store.proxies.find(p => p.id === id)
  if (!proxy) return false
  if (updates.name !== undefined) proxy.name = updates.name
  if (updates.url !== undefined) proxy.url = updates.url
  if (updates.status !== undefined) proxy.status = updates.status
  saveProxies(store)
  return true
}

export async function testClaudeProxy(id: string): Promise<{ success: boolean; ip?: string; latency?: number; error?: string }> {
  const store = loadProxies()
  const proxy = store.proxies.find(p => p.id === id)
  if (!proxy) return { success: false, error: 'Proxy not found' }
  const start = Date.now()
  try {
    const resp = await proxyFetch('https://api.ipify.org?format=json', {
      proxy: proxy.url, headers: { 'Accept': 'application/json' },
    } as any)
    const data: any = await resp.json()
    proxy.status = 'active'
    proxy.lastTestedAt = Date.now()
    proxy.lastError = undefined
    saveProxies(store)
    return { success: true, ip: data.ip, latency: Date.now() - start }
  } catch (e: any) {
    proxy.status = 'error'
    proxy.lastTestedAt = Date.now()
    proxy.lastError = e.message
    saveProxies(store)
    return { success: false, error: e.message }
  }
}

function getProxyUrl(proxyId?: string): string | undefined {
  if (!proxyId) return undefined
  const store = loadProxies()
  const proxy = store.proxies.find(p => p.id === proxyId && p.status === 'active')
  return proxy?.url
}

// ── Account Types ──
export interface ClaudeAccount {
  id: string
  email: string
  accessToken: string
  refreshToken: string
  expiresAt: number
  plan: string              // pro / max / free
  status: 'active' | 'expired' | 'error' | 'disabled'
  proxy?: string
  addedAt: number
  lastUsedAt: number
  lastRefreshedAt: number
  requestCount: number
  errorCount: number
  lastError?: string
  source: 'oauth' | 'setup-token' | 'manual'
}

interface PoolStore {
  accounts: ClaudeAccount[]
  lastUpdated: number
  roundRobinIndex: number
}

// ── Storage ──
function loadPool(): PoolStore {
  try {
    if (fs.existsSync(POOL_FILE)) return JSON.parse(fs.readFileSync(POOL_FILE, 'utf-8'))
  } catch {}
  return { accounts: [], lastUpdated: 0, roundRobinIndex: 0 }
}

function savePool(pool: PoolStore): void {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  pool.lastUpdated = Date.now()
  fs.writeFileSync(POOL_FILE, JSON.stringify(pool, null, 2))
}

// ── Token Helpers ──

/** Build headers that mimic Claude Code CLI to reduce detection risk */
function buildClaudeHeaders(accessToken: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'x-api-key': accessToken,
    'anthropic-version': ANTHROPIC_VERSION,
    'anthropic-beta': BETA_FLAGS,
    'anthropic-dangerous-direct-browser-access': 'true',
    'x-app': 'cli',
    'user-agent': `claude-cli/${CLAUDE_CLI_VERSION} (external, cli)`,
  }
}

/** Extract basic info from token (Anthropic tokens are opaque, not JWT) */
function extractTokenInfo(accessToken: string): { email: string; plan: string } {
  // Anthropic OAuth tokens are opaque (sk-ant-oat-*), not JWT
  // We'll get user info from a profile endpoint or just store what we know
  return { email: '', plan: 'pro' }
}

// ── Token Refresh ──
async function refreshAccessToken(refreshToken: string, proxyId?: string): Promise<{
  success: boolean; access?: string; refresh?: string; expires?: number; error?: string
}> {
  try {
    const proxyUrl = getProxyUrl(proxyId)
    const response = await proxyFetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'anthropic',
      },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: CLIENT_ID,
      }),
      proxy: proxyUrl,
    } as any)
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      return { success: false, error: `Refresh failed (${response.status}): ${text}` }
    }
    const json: any = await response.json()
    if (!json.access_token) {
      return { success: false, error: 'Token refresh response missing access_token' }
    }
    return {
      success: true,
      access: json.access_token,
      refresh: json.refresh_token || refreshToken, // some flows don't rotate refresh
      expires: Date.now() + (json.expires_in || 3600) * 1000,
    }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
}

// ── Public API ──

export function listClaudeAccounts(): Array<Omit<ClaudeAccount, 'accessToken' | 'refreshToken'> & { tokenPreview: string }> {
  const pool = loadPool()
  return pool.accounts.map(a => {
    const { accessToken, refreshToken, ...rest } = a
    return { ...rest, tokenPreview: accessToken ? `${accessToken.slice(0, 20)}...` : '(none)' }
  })
}

export function addClaudeAccount(
  accessToken: string, refreshToken: string, expiresAt: number,
  opts?: { email?: string; plan?: string; proxy?: string; source?: ClaudeAccount['source'] }
): ClaudeAccount {
  const pool = loadPool()
  
  // Check for existing by token prefix (first 30 chars)
  const tokenPrefix = accessToken.slice(0, 30)
  const existing = pool.accounts.findIndex(a => a.accessToken.slice(0, 30) === tokenPrefix)
  
  const account: ClaudeAccount = {
    id: existing >= 0 ? pool.accounts[existing].id : crypto.randomUUID(),
    email: opts?.email || (existing >= 0 ? pool.accounts[existing].email : `claude-${Date.now()}`),
    accessToken,
    refreshToken,
    expiresAt: expiresAt || Date.now() + 3600 * 1000,
    plan: opts?.plan || 'pro',
    status: 'active',
    proxy: opts?.proxy,
    addedAt: existing >= 0 ? pool.accounts[existing].addedAt : Date.now(),
    lastUsedAt: existing >= 0 ? pool.accounts[existing].lastUsedAt : 0,
    lastRefreshedAt: Date.now(),
    requestCount: existing >= 0 ? pool.accounts[existing].requestCount : 0,
    errorCount: existing >= 0 ? pool.accounts[existing].errorCount : 0,
    source: opts?.source || 'manual',
  }

  if (existing >= 0) pool.accounts[existing] = account
  else pool.accounts.push(account)
  savePool(pool)
  console.log(`[ClaudePool] ${existing >= 0 ? 'Updated' : 'Added'} account: ${account.email} (${account.plan})`)
  return account
}

/** Add account from setup-token (the token string from `claude setup-token`) */
export function addFromSetupToken(setupToken: string, opts?: { email?: string; proxy?: string }): ClaudeAccount | null {
  try {
    // setup-token is a base64-encoded JSON with accessToken, refreshToken, expiresAt
    const decoded = Buffer.from(setupToken, 'base64').toString('utf-8')
    const data = JSON.parse(decoded)
    
    if (data.accessToken && data.refreshToken) {
      return addClaudeAccount(
        data.accessToken, data.refreshToken, data.expiresAt || Date.now() + 3600 * 1000,
        { email: opts?.email || data.email, plan: data.plan || 'pro', proxy: opts?.proxy, source: 'setup-token' }
      )
    }
    
    // If it's just a raw token (sk-ant-oat-*), treat as access token only
    if (setupToken.startsWith('sk-ant-')) {
      return addClaudeAccount(setupToken, '', Date.now() + 24 * 3600 * 1000, {
        email: opts?.email, plan: 'pro', proxy: opts?.proxy, source: 'setup-token',
      })
    }
    
    return null
  } catch {
    // Not base64 JSON — might be a raw token
    if (setupToken.startsWith('sk-ant-')) {
      return addClaudeAccount(setupToken, '', Date.now() + 24 * 3600 * 1000, {
        email: opts?.email, plan: 'pro', proxy: opts?.proxy, source: 'setup-token',
      })
    }
    return null
  }
}

export function removeClaudeAccount(id: string): boolean {
  const pool = loadPool()
  const before = pool.accounts.length
  pool.accounts = pool.accounts.filter(a => a.id !== id)
  if (pool.accounts.length < before) { savePool(pool); return true }
  return false
}

export function updateClaudeAccount(id: string, updates: {
  proxy?: string | null; status?: 'active' | 'disabled'; email?: string; plan?: string
}): boolean {
  const pool = loadPool()
  const account = pool.accounts.find(a => a.id === id)
  if (!account) return false
  if (updates.proxy !== undefined) account.proxy = updates.proxy || undefined
  if (updates.status !== undefined) account.status = updates.status
  if (updates.email !== undefined) account.email = updates.email
  if (updates.plan !== undefined) account.plan = updates.plan
  savePool(pool)
  return true
}

export async function refreshClaudeAccount(id: string): Promise<{ success: boolean; error?: string }> {
  const pool = loadPool()
  const account = pool.accounts.find(a => a.id === id)
  if (!account) return { success: false, error: 'Account not found' }
  if (!account.refreshToken) return { success: false, error: 'No refresh token (setup-token accounts need manual re-auth)' }

  const result = await refreshAccessToken(account.refreshToken, account.proxy)
  if (!result.success) {
    account.status = 'error'
    account.lastError = result.error
    account.errorCount++
    savePool(pool)
    return { success: false, error: result.error }
  }

  account.accessToken = result.access!
  if (result.refresh) account.refreshToken = result.refresh
  account.expiresAt = result.expires!
  account.lastRefreshedAt = Date.now()
  account.status = 'active'
  account.lastError = undefined
  savePool(pool)
  console.log(`[ClaudePool] Refreshed token for ${account.email}`)
  return { success: true }
}

export async function refreshAllClaudeAccounts(): Promise<{ refreshed: number; failed: number }> {
  const pool = loadPool()
  let refreshed = 0, failed = 0
  const now = Date.now()
  for (const account of pool.accounts) {
    if (account.status === 'disabled') continue
    if (account.expiresAt > now + TOKEN_REFRESH_BUFFER) continue
    if (!account.refreshToken) { account.status = 'expired'; failed++; continue }
    const result = await refreshAccessToken(account.refreshToken, account.proxy)
    if (result.success) {
      account.accessToken = result.access!
      if (result.refresh) account.refreshToken = result.refresh
      account.expiresAt = result.expires!
      account.lastRefreshedAt = now
      account.status = 'active'
      account.lastError = undefined
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

export function getNextClaudeAccount(): ClaudeAccount | null {
  const pool = loadPool()
  const now = Date.now()
  const active = pool.accounts.filter(a => a.status === 'active' && a.expiresAt > now + 60000)
  if (active.length === 0) return null
  pool.roundRobinIndex = (pool.roundRobinIndex + 1) % active.length
  const account = active[pool.roundRobinIndex]
  const real = pool.accounts.find(a => a.id === account.id)!
  real.lastUsedAt = now
  real.requestCount++
  savePool(pool)
  return account
}

function recordClaudeError(id: string, error: string): void {
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

export function getClaudePoolStats(): {
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

// ── OAuth PKCE Flow ──

interface PendingAuth {
  state: string
  verifier: string
  createdAt: number
}

const pendingAuths = new Map<string, PendingAuth>()

export function startClaudeOAuth(): { authUrl: string; state: string } {
  const verifierBytes = crypto.randomBytes(32)
  const verifier = verifierBytes.toString('base64url')
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url')
  const state = verifier // Claude Code uses verifier as state

  const url = new URL(AUTHORIZE_URL)
  url.searchParams.set('code', 'true')
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', CLIENT_ID)
  url.searchParams.set('redirect_uri', REDIRECT_URI)
  url.searchParams.set('scope', SCOPE)
  url.searchParams.set('code_challenge', challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set('state', state)

  pendingAuths.set(state, { state, verifier, createdAt: Date.now() })

  // Clean old
  for (const [k, v] of pendingAuths) {
    if (Date.now() - v.createdAt > 10 * 60 * 1000) pendingAuths.delete(k)
  }

  return { authUrl: url.toString(), state }
}

export async function completeClaudeOAuth(code: string, state: string, proxy?: string): Promise<{
  success: boolean; account?: ClaudeAccount; error?: string
}> {
  const pending = pendingAuths.get(state)
  if (!pending) return { success: false, error: '授权已过期或无效，请重新发起' }
  pendingAuths.delete(state)

  try {
    const proxyUrl = proxy ? getProxyUrl(proxy) || proxy : undefined
    const response = await proxyFetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'anthropic',
      },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code,
        code_verifier: pending.verifier,
        client_id: CLIENT_ID,
        redirect_uri: REDIRECT_URI,
      }),
      proxy: proxyUrl,
    } as any)

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      return { success: false, error: `Token exchange failed (${response.status}): ${text}` }
    }

    const json: any = await response.json()
    if (!json.access_token) {
      return { success: false, error: 'Token response missing access_token' }
    }

    const expiresAt = Date.now() + (json.expires_in || 3600) * 1000
    const account = addClaudeAccount(
      json.access_token, json.refresh_token || '', expiresAt,
      { proxy, source: 'oauth' }
    )
    return { success: true, account }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
}

// ── Claude Chat API (Messages API) ──
export async function chatWithClaudePool(
  model: string,
  systemMessage: string | undefined,
  history: Array<{ role: string; content: string }> | undefined,
  message: string,
  onProgress: ((data: any) => void) | undefined,
  reasoning?: string,
): Promise<{ success: boolean; error?: string }> {
  const account = getNextClaudeAccount()
  if (!account) {
    return { success: false, error: 'Claude 号池中没有可用账号，请添加授权' }
  }

  // Build messages in Anthropic format
  const messages: Array<{ role: string; content: string }> = []
  if (history && Array.isArray(history)) {
    for (const msg of history) {
      messages.push({ role: msg.role, content: msg.content })
    }
  }
  messages.push({ role: 'user', content: message })

  const requestBody: Record<string, any> = {
    model,
    messages,
    max_tokens: 16384,
    stream: true,
  }

  // System message
  if (systemMessage) {
    requestBody.system = [{ type: 'text', text: systemMessage }]
  }

  // Extended thinking
  if (reasoning && reasoning !== 'none') {
    requestBody.thinking = { type: 'enabled', budget_tokens: 10000 }
  }

  const url = `${API_BASE_URL}/v1/messages?beta=true`
  const headers = buildClaudeHeaders(account.accessToken)

  console.log(`[ClaudePool] POST ${url} | model: ${model} | account: ${account.email} | msgs: ${messages.length}`)

  try {
    const proxyUrl = getProxyUrl(account.proxy)
    const response = await proxyFetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
      proxy: proxyUrl,
    } as any)

    if (!response.ok) {
      const errorText = await response.text()
      const errMsg = `Claude API error ${response.status}: ${errorText.slice(0, 200)}`
      recordClaudeError(account.id, errMsg)

      if (response.status === 401 || response.status === 403) {
        const refreshResult = await refreshClaudeAccount(account.id)
        if (refreshResult.success) {
          return chatWithClaudePool(model, systemMessage, history, message, onProgress, reasoning)
        }
        return { success: false, error: `Claude OAuth 令牌已过期 (${account.email})，刷新失败` }
      }
      return { success: false, error: errMsg }
    }

    // Parse SSE stream
    const reader = response.body as any
    const decoder = new TextDecoder()
    let fullText = ''
    let thinkingText = ''
    let buffer = ''
    let responseModel = model
    let finalUsage: any = null

    for await (const chunk of reader) {
      buffer += decoder.decode(chunk, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('data: ')) continue
        const data = trimmed.slice(6)
        if (data === '[DONE]') break

        try {
          const parsed = JSON.parse(data)
          const eventType = parsed.type

          // Content text delta
          if (eventType === 'content_block_delta' && parsed.delta?.type === 'text_delta') {
            fullText += parsed.delta.text
            onProgress?.({
              id: parsed.index || 'msg',
              text: fullText,
              reasoning: thinkingText || undefined,
              role: 'assistant',
              model: responseModel,
              detail: parsed,
            })
          }

          // Thinking delta
          if (eventType === 'content_block_delta' && parsed.delta?.type === 'thinking_delta') {
            thinkingText += parsed.delta.thinking
            onProgress?.({
              id: 'thinking',
              text: fullText,
              reasoning: thinkingText,
              role: 'assistant',
              model: responseModel,
              detail: parsed,
            })
          }

          // Message start — get model
          if (eventType === 'message_start' && parsed.message) {
            responseModel = parsed.message.model || model
            if (reasoning && reasoning !== 'none') {
              responseModel += '-thinking'
            }
          }

          // Message delta — usage
          if (eventType === 'message_delta' && parsed.usage) {
            finalUsage = {
              prompt_tokens: 0,
              completion_tokens: parsed.usage.output_tokens || 0,
              total_tokens: parsed.usage.output_tokens || 0,
            }
          }

          // Message start usage (input tokens)
          if (eventType === 'message_start' && parsed.message?.usage) {
            const u = parsed.message.usage
            if (!finalUsage) finalUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
            finalUsage.prompt_tokens = u.input_tokens || 0
            finalUsage.total_tokens = (finalUsage.prompt_tokens || 0) + (finalUsage.completion_tokens || 0)
            if (u.cache_read_input_tokens || u.cache_creation_input_tokens) {
              finalUsage.prompt_tokens_details = {
                cached_tokens: u.cache_read_input_tokens || 0,
                cache_write_tokens: u.cache_creation_input_tokens || 0,
              }
            }
          }
        } catch { /* skip */ }
      }
    }

    // Final usage update
    if (finalUsage) {
      finalUsage.total_tokens = (finalUsage.prompt_tokens || 0) + (finalUsage.completion_tokens || 0)
      console.log(`[ClaudePool] usage (${account.email}):`, JSON.stringify(finalUsage))
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
    recordClaudeError(account.id, e.message)
    return { success: false, error: e.message }
  }
}

// ── Available Claude models ──
export const CLAUDE_POOL_MODELS = [
  { id: 'claude-pool:claude-sonnet-4-20250514', name: 'Claude Sonnet 4 (订阅)', provider: 'Claude Pro', claudeModel: 'claude-sonnet-4-20250514' },
  { id: 'claude-pool:claude-opus-4-20250918', name: 'Claude Opus 4 (订阅)', provider: 'Claude Pro', claudeModel: 'claude-opus-4-20250918' },
]

// ── Auto-refresh every 30 min ──
setInterval(async () => {
  const result = await refreshAllClaudeAccounts()
  if (result.refreshed > 0 || result.failed > 0) {
    console.log(`[ClaudePool] Auto-refresh: ${result.refreshed} refreshed, ${result.failed} failed`)
  }
}, 30 * 60 * 1000)
