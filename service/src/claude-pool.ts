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
import * as dotenv from 'dotenv'

dotenv.config()

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.join(__dirname, '..', 'data')
const POOL_FILE = path.join(DATA_DIR, 'claude-pool.json')
const PROXY_FILE = path.join(DATA_DIR, 'claude-proxies.json')

// ── Claude OAuth Constants ──
const AUTHORIZE_URL = 'https://claude.ai/oauth/authorize'
// Token endpoints
const TOKEN_URL = 'https://console.anthropic.com/v1/oauth/token'
const REFRESH_TOKEN_URL = 'https://claude.ai/v1/oauth/token' // Claude Code uses this for refresh
const API_BASE_URL = 'https://api.anthropic.com'
const CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e'
const REDIRECT_URI = 'https://console.anthropic.com/oauth/code/callback'
const SCOPE = 'org:create_api_key user:profile user:inference'
const ANTHROPIC_VERSION = '2023-06-01'
const CLAUDE_CLI_VERSION = '2.1.80'
// Beta flags must match official Claude Code CLI exactly
const BETA_FLAGS = 'claude-code-20250219,oauth-2025-04-20,interleaved-thinking-2025-05-14,prompt-caching-scope-2026-01-05'
const TOKEN_REFRESH_BUFFER = 10 * 60 * 1000 // refresh 10 min before expiry

// System prompt identity prefix — Claude Code injects this
const CLAUDE_CODE_SYSTEM_PREFIX = 'You are Claude Code, an interactive CLI tool that helps users with software engineering tasks.'

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

/** Build headers that exactly mimic Claude Code CLI to minimize detection */
function buildClaudeHeaders(accessToken: string, model: string): Record<string, string> {
  const billingHeader = `claude-cli/${CLAUDE_CLI_VERSION} (external, cli) model=${model}`
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'anthropic-version': ANTHROPIC_VERSION,
    'anthropic-beta': BETA_FLAGS,
    'anthropic-dangerous-direct-browser-access': 'true',
    'x-app': 'cli',
    'x-anthropic-billing-header': billingHeader,
    'user-agent': `claude-cli/${CLAUDE_CLI_VERSION} (external, cli)`,
  }
  // OAuth tokens (sk-ant-oat-*) use Bearer auth; session/API tokens use x-api-key
  if (accessToken.startsWith('sk-ant-oat-')) {
    headers['Authorization'] = `Bearer ${accessToken}`
  } else {
    headers['x-api-key'] = accessToken
  }
  return headers
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
    // Try primary refresh endpoint first (claude.ai), fallback to console
    for (const tokenUrl of [REFRESH_TOKEN_URL, TOKEN_URL]) {
      try {
        const response = await proxyFetch(tokenUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': `claude-cli/${CLAUDE_CLI_VERSION} (external, cli)`,
          },
          body: JSON.stringify({
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
            client_id: CLIENT_ID,
          }),
          proxy: proxyUrl,
        } as any)
        if (!response.ok) {
          if (tokenUrl === REFRESH_TOKEN_URL) continue // try fallback
          const text = await response.text().catch(() => '')
          return { success: false, error: `Refresh failed (${response.status}): ${text}` }
        }
        const json: any = await response.json()
        if (!json.access_token) {
          if (tokenUrl === REFRESH_TOKEN_URL) continue
          return { success: false, error: 'Token refresh response missing access_token' }
        }
        return {
          success: true,
          access: json.access_token,
          refresh: json.refresh_token || refreshToken,
          expires: Date.now() + (json.expires_in || 3600) * 1000,
        }
      } catch (e) {
        if (tokenUrl === REFRESH_TOKEN_URL) continue // try fallback
        throw e
      }
    }
    return { success: false, error: 'All refresh endpoints failed' }
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
// ── ClewdR Configuration ──
const CLEWDR_BASE_URL = process.env.CLEWDR_BASE_URL || 'http://216.167.78.220:8484'
const CLEWDR_API_KEY = process.env.CLEWDR_API_KEY || ''

// ── Optimization: Keep-alive HTTP agent for connection reuse (方案3) ──
import http from 'http'
const keepAliveAgent = new http.Agent({
  keepAlive: true,
  keepAliveMsecs: 30000,
  maxSockets: 10,
  maxFreeSockets: 5,
})

// ── Optimization: Warm-up pool for pre-bootstrapped connections (方案1) ──
interface WarmSlot {
  ready: boolean
  lastWarm: number
  warming: boolean
}

const warmPool: WarmSlot = {
  ready: false,
  lastWarm: 0,
  warming: false,
}

// Pre-warm ClewdR connection by sending a minimal request
// This forces ClewdR to bootstrap + establish TLS connection to claude.ai
async function warmUpClewdR(): Promise<void> {
  if (warmPool.warming) return
  warmPool.warming = true
  try {
    const url = `${CLEWDR_BASE_URL}/v1/chat/completions`
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${CLEWDR_API_KEY}`,
        'Connection': 'keep-alive',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 1,
        stream: false,
      }),
    })
    if (response.ok) {
      await response.text() // drain body
      warmPool.ready = true
      warmPool.lastWarm = Date.now()
      console.log('[ClaudePool/ClewdR] Warm-up successful, connection pre-established')
    }
  } catch (e: any) {
    console.warn('[ClaudePool/ClewdR] Warm-up failed:', e.message)
  }
  warmPool.warming = false
}

// Auto warm-up every 4 minutes (ClewdR idle timeout is ~5min)
setInterval(() => {
  const age = Date.now() - warmPool.lastWarm
  if (age > 4 * 60 * 1000) {
    warmUpClewdR()
  }
}, 60 * 1000)

// Initial warm-up on startup
setTimeout(() => warmUpClewdR(), 3000)

// ── Optimization: Request pipeline (方案2 - connection reuse) ──
// Track active requests to avoid concurrent bursts
let activeRequests = 0
const MAX_CONCURRENT = 2

export async function chatWithClaudePool(
  model: string,
  systemMessage: string | undefined,
  history: Array<{ role: string; content: string }> | undefined,
  message: string,
  onProgress: ((data: any) => void) | undefined,
  reasoning?: string,
): Promise<{ success: boolean; error?: string }> {
  // Wait if too many concurrent requests (方案2 - 并发控制)
  while (activeRequests >= MAX_CONCURRENT) {
    await new Promise(r => setTimeout(r, 100))
  }
  activeRequests++

  try {
    return await _doClewdRChat(model, systemMessage, history, message, onProgress, reasoning)
  } finally {
    activeRequests--
    // Trigger warm-up after request completes to keep connection alive
    warmPool.lastWarm = Date.now()
  }
}

async function _doClewdRChat(
  model: string,
  systemMessage: string | undefined,
  history: Array<{ role: string; content: string }> | undefined,
  message: string,
  onProgress: ((data: any) => void) | undefined,
  reasoning?: string,
): Promise<{ success: boolean; error?: string }> {
  // Build messages in OpenAI format (ClewdR accepts this)
  const messages: Array<{ role: string; content: string }> = []
  if (systemMessage) {
    messages.push({ role: 'system', content: systemMessage })
  }
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

  const url = `${CLEWDR_BASE_URL}/v1/chat/completions`
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${CLEWDR_API_KEY}`,
    'Connection': 'keep-alive',
  }

  console.log(`[ClaudePool/ClewdR] POST ${url} | model: ${model} | msgs: ${messages.length} | warm: ${warmPool.ready}`)

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
    })

    if (!response.ok) {
      const errorText = await response.text()
      const errMsg = `ClewdR error ${response.status}: ${errorText.slice(0, 200)}`
      console.error(`[ClaudePool/ClewdR] ${errMsg}`)
      return { success: false, error: errMsg }
    }

    // Parse SSE stream (OpenAI format from ClewdR)
    const reader = response.body as any
    const decoder = new TextDecoder()
    let fullText = ''
    let buffer = ''
    let responseModel = model
    let finalUsage: any = null
    const CHAR_DELAY = 8 // ms between characters for smooth fast typing

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
          const delta = parsed.choices?.[0]?.delta
          if (delta?.content) {
            const chars = [...delta.content]
            for (let i = 0; i < chars.length; i++) {
              fullText += chars[i]
              onProgress?.({
                id: parsed.id || 'msg',
                text: fullText,
                role: 'assistant',
                model: responseModel,
                detail: parsed,
              })
              if (i < chars.length - 1 && chars[i].trim()) {
                await new Promise(r => setTimeout(r, CHAR_DELAY))
              }
            }
          }
          if (parsed.usage) finalUsage = parsed.usage
          if (parsed.model) responseModel = parsed.model
        } catch { /* skip */ }
      }
    }

    // Estimate token usage if ClewdR didn't provide it
    if (!finalUsage) {
      const inputText = messages.map(m => typeof m.content === 'string' ? m.content : '').join('')
      const estInput = Math.ceil(inputText.length / 2)
      const estOutput = Math.ceil(fullText.length / 2)
      finalUsage = {
        prompt_tokens: estInput,
        completion_tokens: estOutput,
        total_tokens: estInput + estOutput,
      }
    }

    if (finalUsage) {
      finalUsage.total_tokens = (finalUsage.prompt_tokens || 0) + (finalUsage.completion_tokens || 0)
      console.log(`[ClaudePool/ClewdR] usage:`, JSON.stringify(finalUsage))
      onProgress?.({
        id: 'usage',
        text: fullText,
        role: 'assistant',
        model: responseModel,
        usage: finalUsage,
      })
    }

    console.log(`[ClaudePool/ClewdR] done | model: ${responseModel} | chars: ${fullText.length}`)
    return { success: true }
  } catch (e: any) {
    console.error(`[ClaudePool/ClewdR] error:`, e.message)
    return { success: false, error: e.message }
  }
}

// ── Available Claude models ──
export const CLAUDE_POOL_MODELS = [
  { id: 'claude-pool:claude-sonnet-4-6', name: 'Claude Sonnet 4.6 (订阅)', provider: 'Claude Pro', claudeModel: 'claude-sonnet-4-6' },
  { id: 'claude-pool:claude-opus-4-6', name: 'Claude Opus 4.6 (订阅)', provider: 'Claude Pro', claudeModel: 'claude-opus-4-6' },
]

// All models to probe
const PROBE_MODELS = [
  'claude-sonnet-4-6', 'claude-sonnet-4-20250514',
  'claude-opus-4-6', 'claude-opus-4-20250918',
  'claude-haiku-4-5', 'claude-haiku-4-5-20251001',
  'claude-3-haiku-20240307',
]

/** Probe which models an account can access + check token validity */
export async function probeClaudeAccount(accountId: string): Promise<{
  valid: boolean
  models: Array<{ model: string; available: boolean; error?: string }>
  error?: string
}> {
  const pool = loadPool()
  const account = pool.accounts.find(a => a.id === accountId)
  if (!account) return { valid: false, models: [], error: 'Account not found' }

  const results: Array<{ model: string; available: boolean; error?: string }> = []
  let anySuccess = false

  for (const model of PROBE_MODELS) {
    try {
      const headers = buildClaudeHeaders(account.accessToken, model)
      const proxyUrl = getProxyUrl(account.proxy)
      const response = await proxyFetch(`${API_BASE_URL}/v1/messages?beta=true`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: 'hi' }],
          max_tokens: 1,
          stream: false,
        }),
        proxy: proxyUrl,
      } as any)

      if (response.ok) {
        results.push({ model, available: true })
        anySuccess = true
        // Drain body
        try { await response.text() } catch {}
      } else {
        const text = await response.text().catch(() => '')
        const short = text.slice(0, 100)
        if (response.status === 401 || response.status === 403) {
          results.push({ model, available: false, error: `认证失败 (${response.status})` })
        } else if (response.status === 400 && text.includes('model')) {
          results.push({ model, available: false, error: '模型不可用' })
        } else if (response.status === 429) {
          results.push({ model, available: true, error: '限流中但可用' })
          anySuccess = true
        } else {
          results.push({ model, available: false, error: `${response.status}: ${short}` })
        }
      }
      // Small delay between probes to avoid rate limiting
      await new Promise(r => setTimeout(r, 500))
    } catch (e: any) {
      results.push({ model, available: false, error: e.message })
    }
  }

  // Update account status
  if (anySuccess) {
    account.status = 'active'
    account.lastError = undefined
  }
  savePool(pool)

  return { valid: anySuccess, models: results }
}

// ── Auto-refresh every 30 min ──
setInterval(async () => {
  const result = await refreshAllClaudeAccounts()
  if (result.refreshed > 0 || result.failed > 0) {
    console.log(`[ClaudePool] Auto-refresh: ${result.refreshed} refreshed, ${result.failed} failed`)
  }
}, 30 * 60 * 1000)
