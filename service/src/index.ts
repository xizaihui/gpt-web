import express from 'express'
import type { RequestProps } from './types'
import type { ChatMessage } from './chatgpt'
import { chatReplyProcess, chatConfig, currentModel } from './chatgpt'
import { auth, auth } from './middleware/auth'
import { limiter } from './middleware/limiter'
import { isNotEmptyString } from './utils/is'
import * as storage from './storage'
import {
  listAccounts, getAccount, addAccount, removeAccount, updateAccount,
  syncFromOpenClaw, refreshAccount, refreshAllAccounts, getPoolStats,
  startOAuthFlow, completeOAuthFlow,
  queryAccountQuota, queryAllQuotas,
  listProxies, addProxy, removeProxy, updateProxy, testProxy,
} from './codex'
import {
  CLAUDE_POOL_MODELS,
} from './claude-pool'
import { runMigrations } from './dao/schema.js'
import { migrateFromJson } from './dao/migrate-from-json.js'
import { queryClewdrSystemLogs, getClewdrServiceStatus } from "./clewdr-logs-ssh.js"
import { handleChatCompletions, handleModelsList } from "./openai-gateway"
import { initAudit } from "./audit"

const app = express()
const router = express.Router()

app.use(express.static('public'))
app.use(express.json({ limit: '50mb' }))

const allowedOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map(s => s.trim())
  : null // null = allow all (dev mode)

app.all('*', (req, res, next) => {
  const origin = req.headers.origin || ''
  if (allowedOrigins) {
    if (allowedOrigins.includes(origin)) {
      res.header('Access-Control-Allow-Origin', origin)
    }
    // else: no CORS header → browser blocks it
  }
  else {
    res.header('Access-Control-Allow-Origin', '*')
  }
  res.header('Access-Control-Allow-Headers', 'authorization, Content-Type')
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS')
  if (req.method === 'OPTIONS') {
    res.sendStatus(204)
    return
  }
  next()
})


// ─── OpenAI Compatible API Gateway ───
const GATEWAY_KEYS = (process.env.CODEX_GATEWAY_KEYS || 'sk-codex-b75101b217d751c2c2bf9eaa2a8216adc313a7361fbb9aed').split(',').map(s => s.trim()).filter(Boolean)

function gatewayAuth(req, res, next) {
  const auth = req.headers.authorization || ''
  const key = auth.replace(/^Bearer\s+/i, '')
  if (!key || !GATEWAY_KEYS.includes(key)) {
    return res.status(401).json({ error: { message: 'Invalid API key', type: 'invalid_api_key', code: 'invalid_api_key' } })
  }
  next()
}

router.post('/openai/v1/chat/completions', gatewayAuth, handleChatCompletions)
router.get('/openai/v1/models', gatewayAuth, handleModelsList)

router.post('/chat-process', [auth, limiter], async (req, res) => {
  console.log(`[chat-process] model=${req.body?.model} chatUuid=${req.body?.chatUuid} clientId=${(req.headers['x-client-id'] as string) || 'default'}`)
  // Use proper SSE content type for true streaming
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no') // Disable nginx buffering
  res.flushHeaders()

  try {
    const { prompt, options = {}, systemMessage, temperature, top_p, model, history, apiBaseUrl, apiKey, files, reasoning, chatUuid } = req.body as RequestProps & { apiBaseUrl?: string; apiKey?: string; reasoning?: string; chatUuid?: number }

    const clientId = getClientId(req)
    // Per-chat session id: each chat window gets its own Claude conversation
    const sessionId = chatUuid ? `${clientId}:${chatUuid}` : clientId

    // Handle client disconnect
    let clientDisconnected = false
    req.on('close', () => { clientDisconnected = true })

    await chatReplyProcess({
      message: prompt,
      lastContext: options,
      process: (chat: ChatMessage) => {
        if (clientDisconnected) return
        // Send as SSE event
        res.write(`data: ${JSON.stringify(chat)}\n\n`)
      },
      systemMessage,
      temperature,
      top_p,
      model,
      history,
      apiBaseUrl,
      apiKey,
      files,
      reasoning,
      sessionId,
    } as any)

    // Send done signal
    if (!clientDisconnected) {
      res.write('data: [DONE]\n\n')
    }
  }
  catch (error) {
    // Send error as SSE event
    res.write(`data: ${JSON.stringify({ error: true, message: (error as any)?.message || 'Unknown error' })}\n\n`)
  }
  finally {
    res.end()
  }
})

router.post('/config', auth, async (req, res) => {
  try {
    const response = await chatConfig()
    res.send(response)
  }
  catch (error) {
    res.send({ status: 'Fail', message: (error as any)?.message || 'Failed to get config', data: null })
  }
})

router.post('/session', async (req, res) => {
  try {
    const AUTH_SECRET_KEY = process.env.AUTH_SECRET_KEY
    const hasAuth = isNotEmptyString(AUTH_SECRET_KEY)
    res.send({ status: 'Success', message: '', data: { auth: hasAuth, model: currentModel() } })
  }
  catch (error) {
    res.send({ status: 'Fail', message: (error as any).message, data: null })
  }
})

router.post('/verify', async (req, res) => {
  try {
    const { token } = req.body as { token: string }
    if (!token)
      throw new Error('Secret key is empty')

    if (process.env.AUTH_SECRET_KEY !== token)
      throw new Error('密钥无效 | Secret key is invalid')

    res.send({ status: 'Success', message: 'Verify successfully', data: null })
  }
  catch (error) {
    res.send({ status: 'Fail', message: (error as any).message, data: null })
  }
})

// ---- Storage API (protected by auth when AUTH_SECRET_KEY is set) ----

/** Extract client ID from request header */
function getClientId(req: any): string {
  return (req.headers['x-client-id'] as string) || 'default'
}

// List all conversations (sidebar)
router.get('/conversations', auth, async (req, res) => {
  try {
    const clientId = getClientId(req)
    const rows = storage.listConversations(clientId)
    const history = rows.map(r => ({ uuid: r.uuid, title: r.title, isEdit: false }))
    res.json({ status: 'Success', data: history })
  }
  catch (e: any) {
    res.json({ status: 'Fail', message: e.message, data: null })
  }
})

// Create conversation
router.post('/conversations', auth, async (req, res) => {
  try {
    const clientId = getClientId(req)
    const { uuid, title } = req.body
    storage.createConversation(uuid, title || '新对话', clientId)
    res.json({ status: 'Success', data: null })
  }
  catch (e: any) {
    res.json({ status: 'Fail', message: e.message, data: null })
  }
})

// Update conversation title
router.patch('/conversations/:uuid', auth, async (req, res) => {
  try {
    const clientId = getClientId(req)
    const uuid = Number(req.params.uuid)
    const { title } = req.body
    storage.updateConversationTitle(uuid, title, clientId)
    res.json({ status: 'Success', data: null })
  }
  catch (e: any) {
    res.json({ status: 'Fail', message: e.message, data: null })
  }
})

// Delete conversation
router.delete('/conversations/:uuid', auth, async (req, res) => {
  try {
    const clientId = getClientId(req)
    const uuid = Number(req.params.uuid)
    storage.deleteConversation(uuid, clientId)
    res.json({ status: 'Success', data: null })
  }
  catch (e: any) {
    res.json({ status: 'Fail', message: e.message, data: null })
  }
})

// Clear all conversations
router.delete('/conversations', auth, async (req, res) => {
  try {
    const clientId = getClientId(req)
    storage.clearAllConversations(clientId)
    res.json({ status: 'Success', data: null })
  }
  catch (e: any) {
    res.json({ status: 'Fail', message: e.message, data: null })
  }
})

// Get messages for a conversation
router.get('/conversations/:uuid/messages', auth, async (req, res) => {
  try {
    const uuid = Number(req.params.uuid)
    const rows = storage.listMessages(uuid)
    const messages = rows.map(storage.deserializeMessage)
    res.json({ status: 'Success', data: messages })
  }
  catch (e: any) {
    res.json({ status: 'Fail', message: e.message, data: null })
  }
})

// Upsert a single message (add or update)
router.put('/conversations/:uuid/messages/:index', auth, async (req, res) => {
  try {
    const clientId = getClientId(req)
    const uuid = Number(req.params.uuid)
    const index = Number(req.params.index)
    storage.upsertMessage(uuid, index, req.body, clientId)
    res.json({ status: 'Success', data: null })
  }
  catch (e: any) {
    res.json({ status: 'Fail', message: e.message, data: null })
  }
})

// Delete a single message
router.delete('/conversations/:uuid/messages/:index', auth, async (req, res) => {
  try {
    const uuid = Number(req.params.uuid)
    const index = Number(req.params.index)
    storage.deleteMessage(uuid, index)
    res.json({ status: 'Success', data: null })
  }
  catch (e: any) {
    res.json({ status: 'Fail', message: e.message, data: null })
  }
})

// Clear all messages in a conversation
router.delete('/conversations/:uuid/messages', auth, async (req, res) => {
  try {
    const uuid = Number(req.params.uuid)
    storage.clearMessages(uuid)
    res.json({ status: 'Success', data: null })
  }
  catch (e: any) {
    res.json({ status: 'Fail', message: e.message, data: null })
  }
})

// Import full state from localStorage (migration endpoint)
router.post('/conversations/import', auth, async (req, res) => {
  try {
    const clientId = getClientId(req)
    const { history, chat } = req.body
    if (!history || !chat)
      throw new Error('Invalid state: need history and chat arrays')
    storage.importFullState({ history, chat }, clientId)
    res.json({ status: 'Success', data: { imported: history.length } })
  }
  catch (e: any) {
    res.json({ status: 'Fail', message: e.message, data: null })
  }
})

// ---- Codex Account Pool Management ----

// Pool stats overview
router.get('/codex/pool/stats', auth, async (_req, res) => {
  try {
    const stats = getPoolStats()
    res.json({ status: 'Success', data: stats })
  } catch (e: any) {
    res.json({ status: 'Fail', message: e.message, data: null })
  }
})

// List all accounts (tokens masked)
router.get('/codex/pool/accounts', auth, async (_req, res) => {
  try {
    const accounts = listAccounts()
    res.json({ status: 'Success', data: accounts })
  } catch (e: any) {
    res.json({ status: 'Fail', message: e.message, data: null })
  }
})

// Sync from OpenClaw
router.post('/codex/pool/sync', auth, async (_req, res) => {
  try {
    const count = syncFromOpenClaw()
    res.json({ status: 'Success', data: { synced: count } })
  } catch (e: any) {
    res.json({ status: 'Fail', message: e.message, data: null })
  }
})

// Remove account
router.delete('/codex/pool/accounts/:id', auth, async (req, res) => {
  try {
    const ok = removeAccount(req.params.id)
    if (!ok) throw new Error('Account not found')
    res.json({ status: 'Success', data: null })
  } catch (e: any) {
    res.json({ status: 'Fail', message: e.message, data: null })
  }
})

// Update account (proxy, status)
router.patch('/codex/pool/accounts/:id', auth, async (req, res) => {
  try {
    const ok = updateAccount(req.params.id, req.body)
    if (!ok) throw new Error('Account not found')
    res.json({ status: 'Success', data: null })
  } catch (e: any) {
    res.json({ status: 'Fail', message: e.message, data: null })
  }
})

// Refresh single account token
router.post('/codex/pool/accounts/:id/refresh', auth, async (req, res) => {
  try {
    const result = await refreshAccount(req.params.id)
    if (!result.success) throw new Error(result.error)
    res.json({ status: 'Success', data: null })
  } catch (e: any) {
    res.json({ status: 'Fail', message: e.message, data: null })
  }
})

// Refresh all account tokens
router.post('/codex/pool/refresh-all', auth, async (_req, res) => {
  try {
    const result = await refreshAllAccounts()
    res.json({ status: 'Success', data: result })
  } catch (e: any) {
    res.json({ status: 'Fail', message: e.message, data: null })
  }
})

// Start OAuth authorization flow
router.post('/codex/oauth/start', auth, async (_req, res) => {
  try {
    const result = await startOAuthFlow()
    res.json({ status: 'Success', data: result })
  } catch (e: any) {
    res.json({ status: 'Fail', message: e.message, data: null })
  }
})

// OAuth callback (GET - browser redirect from OpenAI)
router.get('/codex/oauth/callback', async (req, res) => {
  const { code, state, error } = req.query as Record<string, string>
  if (error) {
    res.send(`<html><body><h2>授权失败</h2><p>${error}</p><script>window.close()</script></body></html>`)
    return
  }
  if (!code || !state) {
    res.send('<html><body><h2>参数缺失</h2><script>window.close()</script></body></html>')
    return
  }
  try {
    const result = await completeOAuthFlow(code, state)
    if (result.success && result.account) {
      res.send(`<html><body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f9f9f9">
        <div style="text-align:center;padding:40px;background:white;border-radius:16px;box-shadow:0 2px 16px rgba(0,0,0,0.08)">
          <div style="font-size:48px;margin-bottom:16px">✅</div>
          <h2 style="margin:0 0 8px;color:#0d0d0d">授权成功</h2>
          <p style="color:#666;margin:0 0 4px">${result.account.email}</p>
          <p style="color:#999;font-size:14px;margin:0">Plan: ${result.account.plan}</p>
          <p style="color:#999;font-size:13px;margin:16px 0 0">可以关闭此页面了</p>
        </div>
      </body></html>`)
    } else {
      res.send(`<html><body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f9f9f9">
        <div style="text-align:center;padding:40px;background:white;border-radius:16px;box-shadow:0 2px 16px rgba(0,0,0,0.08)">
          <div style="font-size:48px;margin-bottom:16px">❌</div>
          <h2 style="margin:0 0 8px;color:#e5484d">授权失败</h2>
          <p style="color:#666;margin:0">${result.error || 'Unknown error'}</p>
        </div>
      </body></html>`)
    }
  } catch (e: any) {
    res.send(`<html><body><h2>Error</h2><p>${e.message}</p></body></html>`)
  }
})

// Complete OAuth with manual code paste
router.post('/codex/oauth/complete', auth, async (req, res) => {
  try {
    const { code, state, proxy } = req.body
    if (!code || !state) throw new Error('Missing code or state')
    const result = await completeOAuthFlow(code, state, proxy)
    if (!result.success) throw new Error(result.error)
    res.json({ status: 'Success', data: { email: result.account?.email, plan: result.account?.plan } })
  } catch (e: any) {
    res.json({ status: 'Fail', message: e.message, data: null })
  }
})

// Query quota for a single account
router.get('/codex/pool/accounts/:id/quota', auth, async (req, res) => {
  try {
    const quota = await queryAccountQuota(req.params.id)
    if (!quota) throw new Error('Account not found')
    res.json({ status: 'Success', data: quota })
  } catch (e: any) {
    res.json({ status: 'Fail', message: e.message, data: null })
  }
})

// Query quota for all accounts
router.get('/codex/pool/quotas', auth, async (_req, res) => {
  try {
    const quotas = await queryAllQuotas()
    res.json({ status: 'Success', data: quotas })
  } catch (e: any) {
    res.json({ status: 'Fail', message: e.message, data: null })
  }
})

// ---- Proxy Management ----

router.get('/codex/proxies', auth, async (_req, res) => {
  try {
    res.json({ status: 'Success', data: listProxies() })
  } catch (e: any) {
    res.json({ status: 'Fail', message: e.message, data: null })
  }
})

router.post('/codex/proxies', auth, async (req, res) => {
  try {
    const { name, url } = req.body
    if (!name || !url) throw new Error('name and url required')
    const proxy = addProxy(name, url)
    res.json({ status: 'Success', data: proxy })
  } catch (e: any) {
    res.json({ status: 'Fail', message: e.message, data: null })
  }
})

router.patch('/codex/proxies/:id', auth, async (req, res) => {
  try {
    const ok = updateProxy(req.params.id, req.body)
    if (!ok) throw new Error('Proxy not found')
    res.json({ status: 'Success', data: null })
  } catch (e: any) {
    res.json({ status: 'Fail', message: e.message, data: null })
  }
})

router.delete('/codex/proxies/:id', auth, async (req, res) => {
  try {
    const ok = removeProxy(req.params.id)
    if (!ok) throw new Error('Proxy not found')
    res.json({ status: 'Success', data: null })
  } catch (e: any) {
    res.json({ status: 'Fail', message: e.message, data: null })
  }
})

router.post('/codex/proxies/:id/test', auth, async (req, res) => {
  try {
    const result = await testProxy(req.params.id)
    res.json({ status: 'Success', data: result })
  } catch (e: any) {
    res.json({ status: 'Fail', message: e.message, data: null })
  }
})

// ── ClewdR Admin API (proxy to ClewdR backend) ──

const CLEWDR_ADMIN_URL = process.env.CLEWDR_BASE_URL || 'http://38.150.32.190:8484'
const CLEWDR_ADMIN_PW = process.env.CLEWDR_ADMIN_KEY || 'ptqtgtBQbVyYgLttNKa3ETBJT3nPD2DGaE98JaXNg2ewmrDxsRP9N48ZtALKtxMa'

async function clewdrFetch(path: string, options: any = {}): Promise<any> {
  const url = `${CLEWDR_ADMIN_URL}${path}`
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30000)
  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${CLEWDR_ADMIN_PW}`,
        ...options.headers,
      },
    })
    clearTimeout(timeout)
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`ClewdR ${res.status}: ${text.slice(0, 200)}`)
    }
    const contentType = res.headers.get('content-type') || ''
    if (contentType.includes('json')) return res.json()
    return res.text()
  } catch (e: any) {
    clearTimeout(timeout)
    if (e.name === 'AbortError') throw new Error('ClewdR 请求超时 (30s)')
    throw e
  }
}

// Get all cookies (accounts)
router.get('/clewdr/cookies', auth, async (_req, res) => {
  try {
    const data = await clewdrFetch('/api/cookies?refresh=true')
    res.json({ status: 'Success', data })
  } catch (e: any) { res.json({ status: 'Fail', message: e.message }) }
})

// Add a cookie (account) — ClewdR uses /api/cookie (singular) for POST
router.post('/clewdr/cookies', auth, async (req, res) => {
  try {
    const { cookie, proxy } = req.body
    if (!cookie) throw new Error('cookie is required')
    // 格式校验
    const trimmed = cookie.trim()
    if (!trimmed.startsWith('sk-ant-sid')) {
      throw new Error('Cookie 格式错误：必须以 sk-ant-sid 开头')
    }
    if (trimmed.length < 50) {
      throw new Error('Cookie 格式错误：长度不足')
    }
    const body: any = { cookie: trimmed }
    if (proxy) body.proxy = proxy.trim()
    const result = await clewdrFetch('/api/cookie', {
      method: 'POST',
      body: JSON.stringify(body),
    })
    res.json({ status: 'Success', data: result })
  } catch (e: any) {
    res.json({ status: 'Fail', message: e.message || '添加 Cookie 失败' })
  }
})

// 批量添加 cookies
router.post('/clewdr/cookies/batch', auth, async (req, res) => {
  try {
    const { cookies, proxy } = req.body
    if (!Array.isArray(cookies) || cookies.length === 0) {
      throw new Error('cookies 数组不能为空')
    }
    if (cookies.length > 100) {
      throw new Error('单次最多添加 100 个 cookie')
    }
    const results: { cookie: string; success: boolean; error?: string }[] = []
    // 限制 5 并发
    const concurrency = 5
    for (let i = 0; i < cookies.length; i += concurrency) {
      const batch = cookies.slice(i, i + concurrency)
      const promises = batch.map(async (c: string) => {
        const trimmed = c.trim()
        if (!trimmed) return { cookie: '(empty)', success: false, error: '空字符串' }
        if (!trimmed.startsWith('sk-ant-sid')) {
          return { cookie: trimmed.slice(0, 20) + '...', success: false, error: '格式错误' }
        }
        try {
          const body: any = { cookie: trimmed }
          if (proxy) body.proxy = proxy.trim()
          await clewdrFetch('/api/cookie', { method: 'POST', body: JSON.stringify(body) })
          return { cookie: trimmed.slice(0, 20) + '...', success: true }
        } catch (e: any) {
          return { cookie: trimmed.slice(0, 20) + '...', success: false, error: e.message }
        }
      })
      results.push(...await Promise.all(promises))
    }
    const successCount = results.filter(r => r.success).length
    res.json({ status: 'Success', data: { total: results.length, success: successCount, failed: results.length - successCount, results } })
  } catch (e: any) {
    res.json({ status: 'Fail', message: e.message })
  }
})

// Delete a cookie (account) — ClewdR uses /api/cookie (singular) for DELETE
router.delete('/clewdr/cookies', auth, async (req, res) => {
  try {
    const { cookie } = req.body
    if (!cookie) throw new Error('cookie is required')
    await clewdrFetch('/api/cookie', {
      method: 'DELETE',
      body: JSON.stringify({ cookie }),
    })
    res.json({ status: 'Success' })
  } catch (e: any) { res.json({ status: 'Fail', message: e.message }) }
})

// Update cookie — ClewdR uses /api/cookie (singular) for PUT
router.put('/clewdr/cookies', auth, async (req, res) => {
  try {
    await clewdrFetch('/api/cookie', {
      method: 'PUT',
      body: JSON.stringify(req.body),
    })
    res.json({ status: 'Success' })
  } catch (e: any) { res.json({ status: 'Fail', message: e.message }) }
})

// Get ClewdR config
router.get('/clewdr/config', auth, async (_req, res) => {
  try {
    const data = await clewdrFetch('/api/config')
    res.json({ status: 'Success', data })
  } catch (e: any) { res.json({ status: 'Fail', message: e.message }) }
})

// Update ClewdR config
router.post('/clewdr/config', auth, async (req, res) => {
  try {
    await clewdrFetch('/api/config', {
      method: 'POST',
      body: JSON.stringify(req.body),
    })
    res.json({ status: 'Success' })
  } catch (e: any) { res.json({ status: 'Fail', message: e.message }) }
})

// Get available models
router.get('/clewdr/models', auth, async (_req, res) => {
  try {
    const data = await clewdrFetch('/api/models')
    res.json({ status: 'Success', data })
  } catch (e: any) { res.json({ status: 'Fail', message: e.message }) }
})

// Test a cookie by sending a minimal request
router.post('/clewdr/test', auth, async (req, res) => {
  try {
    const apiKey = process.env.CLEWDR_API_KEY || ''
    const testRes = await fetch(`${CLEWDR_ADMIN_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: req.body.model || 'claude-sonnet-4-6',
        messages: [{ role: 'user', content: 'say ok' }],
        max_tokens: 5,
        stream: false,
      }),
    })
    const data = await testRes.json()
    const content = data?.choices?.[0]?.message?.content || ''
    res.json({ status: 'Success', data: { ok: testRes.ok, content, statusCode: testRes.status } })
  } catch (e: any) { res.json({ status: 'Fail', message: e.message }) }
})

// Disable a cookie: remove from ClewdR + save to local disabled list
router.post('/clewdr/cookies/disable', auth, async (req, res) => {
  try {
    const { cookie, proxy } = req.body
    if (!cookie) throw new Error('cookie is required')
    // Remove from ClewdR
    await clewdrFetch('/api/cookie', { method: 'DELETE', body: JSON.stringify({ cookie }) })
    // Save to local disabled list
    storage.disableCookie(cookie, proxy || '')
    res.json({ status: 'Success' })
  } catch (e: any) { res.json({ status: 'Fail', message: e.message }) }
})

// Enable a cookie: remove from disabled list + add back to ClewdR
router.post('/clewdr/cookies/enable', auth, async (req, res) => {
  try {
    const { cookie } = req.body
    if (!cookie) throw new Error('cookie is required')
    const info = storage.enableCookie(cookie)
    // Add back to ClewdR
    const body: any = { cookie }
    if (info?.proxy) body.proxy = info.proxy
    await clewdrFetch('/api/cookie', { method: 'POST', body: JSON.stringify(body) })
    res.json({ status: 'Success' })
  } catch (e: any) { res.json({ status: 'Fail', message: e.message }) }
})

// Get disabled cookies list
router.get('/clewdr/cookies/disabled', auth, async (_req, res) => {
  try {
    res.json({ status: 'Success', data: storage.listDisabledCookies() })
  } catch (e: any) { res.json({ status: 'Fail', message: e.message }) }
})

// ClewdR request logs (proxy to ClewdR API)
router.get('/clewdr/logs', auth, async (req, res) => {
  try {
    const qs = new URLSearchParams(req.query as any).toString()
    const r = await clewdrFetch(`/api/logs?${qs}`, { method: 'GET' })
    const data = r
    res.json(data)
  } catch (e: any) { res.json({ status: 'Fail', message: e.message }) }
})

router.get('/clewdr/logs/stats', auth, async (req, res) => {
  try {
    const qs = new URLSearchParams(req.query as any).toString()
    const r = await clewdrFetch(`/api/logs/stats?${qs}`, { method: 'GET' })
    const data = r
    res.json(data)
  } catch (e: any) { res.json({ status: 'Fail', message: e.message }) }
})

// ── Kiro Gateway Admin API ──

const KIRO_GW_URL = process.env.KIRO_GW_BASE_URL || 'http://43.165.172.3:8000'
const KIRO_GW_KEY = process.env.KIRO_GW_API_KEY || ''

async function kiroGwFetch(path: string, options: any = {}): Promise<any> {
  const url = `${KIRO_GW_URL}${path}`
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${KIRO_GW_KEY}`,
      ...options.headers,
    },
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`KiroGW ${res.status}: ${text.slice(0, 200)}`)
  }
  const ct = res.headers.get('content-type') || ''
  if (ct.includes('json')) return res.json()
  return res.text()
}

router.get('/kiro/pool-status', auth, async (_req, res) => {
  try {
    const data = await kiroGwFetch('/v1/pool/status')
    res.json({ status: 'Success', data })
  } catch (e: any) { res.json({ status: 'Fail', message: e.message }) }
})

router.get('/kiro/sessions', auth, async (_req, res) => {
  try {
    const data = await kiroGwFetch('/v1/pool/sessions')
    res.json({ status: 'Success', data })
  } catch (e: any) { res.json({ status: 'Success', data: [] }) }
})

router.post('/kiro/accounts/:id/disable', auth, async (req, res) => {
  try {
    await kiroGwFetch(`/v1/pool/accounts/${req.params.id}/disable`, { method: 'POST' })
    res.json({ status: 'Success' })
  } catch (e: any) { res.json({ status: 'Fail', message: e.message }) }
})

router.post('/kiro/accounts/:id/enable', auth, async (req, res) => {
  try {
    await kiroGwFetch(`/v1/pool/accounts/${req.params.id}/enable`, { method: 'POST' })
    res.json({ status: 'Success' })
  } catch (e: any) { res.json({ status: 'Fail', message: e.message }) }
})

router.post('/kiro/test', auth, async (_req, res) => {
  try {
    const data = await kiroGwFetch('/v1/models')
    res.json({ status: 'Success', data: { ok: true, models: data?.data?.length || 0 } })
  } catch (e: any) { res.json({ status: 'Fail', message: e.message }) }
})

router.post('/kiro/accounts/upload', auth, async (req, res) => {
  try {
    const { filename, data: fileData, label } = req.body
    if (!filename || !fileData) throw new Error('filename and data (base64) are required')
    const buf = Buffer.from(fileData, 'base64')
    // Build multipart form data manually
    const boundary = '----KiroUpload' + Date.now()
    const parts: Buffer[] = []
    // file part
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`))
    parts.push(buf)
    parts.push(Buffer.from('\r\n'))
    // label part
    if (label) {
      parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="label"\r\n\r\n${label}\r\n`))
    }
    parts.push(Buffer.from(`--${boundary}--\r\n`))
    const body = Buffer.concat(parts)
    const r = await fetch(`${KIRO_GW_URL}/v1/pool/accounts/upload`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${KIRO_GW_KEY}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body,
    })
    if (!r.ok) throw new Error(`KiroGW ${r.status}: ${(await r.text()).slice(0, 200)}`)
    const result = await r.json()
    res.json({ status: 'Success', data: result })
  } catch (e: any) { res.json({ status: 'Fail', message: e.message }) }
})

router.delete('/kiro/accounts/:id', auth, async (req, res) => {
  try {
    const r = await fetch(`${KIRO_GW_URL}/v1/pool/accounts/${req.params.id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${KIRO_GW_KEY}` },
    })
    if (!r.ok) throw new Error(`KiroGW ${r.status}: ${(await r.text()).slice(0, 200)}`)
    res.json({ status: 'Success' })
  } catch (e: any) { res.json({ status: 'Fail', message: e.message }) }
})

router.post('/kiro/accounts/:id/test', auth, async (req, res) => {
  try {
    const data = await kiroGwFetch(`/v1/pool/accounts/${req.params.id}/test`, { method: 'POST' })
    res.json({ status: 'Success', data })
  } catch (e: any) { res.json({ status: 'Fail', message: e.message }) }
})

// ─── Request Logs ──────────────────────────────────────────────────

router.get('/log/list', auth, async (req, res) => {
  try {
    const result = storage.queryRequestLogs({
      page: Number(req.query.page) || 1,
      pageSize: Number(req.query.pageSize) || 20,
      model: req.query.model as string,
      client_id: req.query.client_id as string,
      date_from: req.query.date_from as string,
      date_to: req.query.date_to as string,
    })
    res.json({ status: 'Success', data: result })
  } catch (e: any) { res.json({ status: 'Fail', message: e.message }) }
})

router.get('/log/stats', auth, async (req, res) => {
  try {
    const stats = storage.getLogStats(req.query.date_from as string, req.query.date_to as string)
    res.json({ status: 'Success', data: stats })
  } catch (e: any) { res.json({ status: 'Fail', message: e.message }) }
})

router.get('/log/settings', auth, async (_req, res) => {
  try {
    res.json({ status: 'Success', data: { retention_days: storage.getLogSetting('retention_days') } })
  } catch (e: any) { res.json({ status: 'Fail', message: e.message }) }
})

router.post('/log/settings', auth, async (req, res) => {
  try {
    const { retention_days } = req.body
    if (retention_days) {
      const days = parseInt(String(retention_days), 10)
      if (isNaN(days) || days < 1 || days > 365) throw new Error('retention_days must be 1-365')
      storage.setLogSetting('retention_days', String(days))
    }
    storage.purgeOldLogs()
    res.json({ status: 'Success' })
  } catch (e: any) { res.json({ status: 'Fail', message: e.message }) }
})

// ── Gemini Gateway Admin API ──

const GEMINI_GW_URL = process.env.GEMINI_GW_BASE_URL || 'http://154.36.173.198:8001'
const GEMINI_GW_KEY = process.env.GEMINI_GW_API_KEY || 'gemini-gw-xz527-secret-key'

async function geminiGwFetch(path: string, options: any = {}): Promise<any> {
  const url = `${GEMINI_GW_URL}${path}`
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${GEMINI_GW_KEY}`,
      ...options.headers,
    },
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`GeminiGW ${res.status}: ${text.slice(0, 200)}`)
  }
  const ct = res.headers.get('content-type') || ''
  if (ct.includes('json')) return res.json()
  return res.text()
}

router.get('/gemini/pool-status', auth, async (_req, res) => {
  try {
    const data = await geminiGwFetch('/api/pool')
    res.json({ status: 'Success', data })
  } catch (e: any) { res.json({ status: 'Fail', message: e.message }) }
})

router.post('/gemini/pool/add', auth, async (req, res) => {
  try {
    const data = await geminiGwFetch('/api/pool/add', { method: 'POST', body: JSON.stringify(req.body) })
    res.json({ status: 'Success', data })
  } catch (e: any) { res.json({ status: 'Fail', message: e.message }) }
})

router.post('/gemini/pool/:label/disable', auth, async (req, res) => {
  try {
    await geminiGwFetch(`/api/pool/${req.params.label}/disable`, { method: 'POST' })
    res.json({ status: 'Success' })
  } catch (e: any) { res.json({ status: 'Fail', message: e.message }) }
})

router.post('/gemini/pool/:label/enable', auth, async (req, res) => {
  try {
    await geminiGwFetch(`/api/pool/${req.params.label}/enable`, { method: 'POST' })
    res.json({ status: 'Success' })
  } catch (e: any) { res.json({ status: 'Fail', message: e.message }) }
})

router.delete('/gemini/pool/:label', auth, async (req, res) => {
  try {
    const r = await fetch(`${GEMINI_GW_URL}/api/pool/${req.params.label}`, {
      method: 'DELETE', headers: { 'Authorization': `Bearer ${GEMINI_GW_KEY}` },
    })
    if (!r.ok) throw new Error(`GeminiGW ${r.status}`)
    res.json({ status: 'Success' })
  } catch (e: any) { res.json({ status: 'Fail', message: e.message }) }
})

router.post('/gemini/pool/:label/test', auth, async (req, res) => {
  try {
    const data = await geminiGwFetch(`/api/pool/${req.params.label}/test`, { method: 'POST' })
    res.json({ status: 'Success', data })
  } catch (e: any) { res.json({ status: 'Fail', message: e.message }) }
})

router.post('/gemini/pool/:label/proxy', auth, async (req, res) => {
  try {
    const data = await geminiGwFetch(`/api/pool/${req.params.label}/proxy`, { method: 'POST', body: JSON.stringify(req.body) })
    res.json({ status: 'Success', data })
  } catch (e: any) { res.json({ status: 'Fail', message: e.message }) }
})

router.post('/gemini/test', auth, async (_req, res) => {
  try {
    const data = await geminiGwFetch('/v1/models')
    res.json({ status: 'Success', data: { ok: true, models: data?.data?.length || 0 } })
  } catch (e: any) { res.json({ status: 'Fail', data: { ok: false, message: e.message } }) }
})

router.get('/gemini/logs', auth, async (req, res) => {
  try {
    const qs = new URLSearchParams()
    for (const [k, v] of Object.entries(req.query)) { if (v) qs.set(k, String(v)) }
    const data = await geminiGwFetch(`/api/logs?${qs}`)
    res.json({ status: 'Success', data })
  } catch (e: any) { res.json({ status: 'Fail', message: e.message }) }
})

router.get('/gemini/logs/stats', auth, async (_req, res) => {
  try {
    const data = await geminiGwFetch('/api/logs/stats')
    res.json({ status: 'Success', data })
  } catch (e: any) { res.json({ status: 'Fail', message: e.message }) }
})

app.use('', router)
app.use('/api', router)
app.set('trust proxy', 1)

// Admin V2: 启动时建表
try {
  runMigrations()
  // 首次启动时从 JSON 迁移 (用环境变量 ADMIN_V2_MIGRATE=1 控制)
  if (process.env.ADMIN_V2_MIGRATE === '1') {
    migrateFromJson()
  }
} catch (e) {
  console.error('[Admin V2] DAO initialization failed:', e)
}

// ── ClewdR System Logs (SSH → journalctl) ──

router.get("/clewdr/system-logs", auth, async (req, res) => {
  try {
    const params = {
      lines: Number(req.query.lines) || 200,
      since: req.query.since as string,
      until: req.query.until as string,
      grep: req.query.grep as string,
      priority: req.query.priority as string,
      unit: (req.query.unit as string) || "clewdr",
    }
    const result = await queryClewdrSystemLogs(params)
    res.json({ status: "Success", data: result })
  } catch (e: any) {
    res.json({ status: "Fail", message: e.message || "Failed to fetch logs" })
  }
})

router.get("/clewdr/service-status", auth, async (_req, res) => {
  try {
    const status = await getClewdrServiceStatus()
    res.json({ status: "Success", data: status })
  } catch (e: any) {
    res.json({ status: "Fail", message: e.message || "Failed to get service status" })
  }
})

initAudit();
app.listen(3002, () => globalThis.console.log('Server is running on port 3002'))
