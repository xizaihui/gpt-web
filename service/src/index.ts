import express from 'express'
import type { RequestProps } from './types'
import type { ChatMessage } from './chatgpt'
import { chatReplyProcess, chatConfig, currentModel } from './chatgpt'
import { auth } from './middleware/auth'
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

router.post('/chat-process', [auth, limiter], async (req, res) => {
  // Use proper SSE content type for true streaming
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no') // Disable nginx buffering
  res.flushHeaders()

  try {
    const { prompt, options = {}, systemMessage, temperature, top_p, model, history, apiBaseUrl, apiKey, files, reasoning } = req.body as RequestProps & { apiBaseUrl?: string; apiKey?: string; reasoning?: string }

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

// List all conversations (sidebar)
router.get('/conversations', auth, async (_req, res) => {
  try {
    const rows = storage.listConversations()
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
    const { uuid, title } = req.body
    storage.createConversation(uuid, title || '新对话')
    res.json({ status: 'Success', data: null })
  }
  catch (e: any) {
    res.json({ status: 'Fail', message: e.message, data: null })
  }
})

// Update conversation title
router.patch('/conversations/:uuid', auth, async (req, res) => {
  try {
    const uuid = Number(req.params.uuid)
    const { title } = req.body
    storage.updateConversationTitle(uuid, title)
    res.json({ status: 'Success', data: null })
  }
  catch (e: any) {
    res.json({ status: 'Fail', message: e.message, data: null })
  }
})

// Delete conversation
router.delete('/conversations/:uuid', auth, async (req, res) => {
  try {
    const uuid = Number(req.params.uuid)
    storage.deleteConversation(uuid)
    res.json({ status: 'Success', data: null })
  }
  catch (e: any) {
    res.json({ status: 'Fail', message: e.message, data: null })
  }
})

// Clear all conversations
router.delete('/conversations', auth, async (_req, res) => {
  try {
    storage.clearAllConversations()
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
    const uuid = Number(req.params.uuid)
    const index = Number(req.params.index)
    // Auto-create conversation if not exists
    if (!storage.getConversation(uuid)) {
      const title = req.body.text?.substring(0, 50) || '新对话'
      storage.createConversation(uuid, title)
    }
    storage.upsertMessage(uuid, index, req.body)
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
    const { history, chat } = req.body
    if (!history || !chat)
      throw new Error('Invalid state: need history and chat arrays')
    storage.importFullState({ history, chat })
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

app.use('', router)
app.use('/api', router)
app.set('trust proxy', 1)

app.listen(3002, () => globalThis.console.log('Server is running on port 3002'))
