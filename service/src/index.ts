import express from 'express'
import type { RequestProps } from './types'
import type { ChatMessage } from './chatgpt'
import { chatReplyProcess, chatConfig, currentModel } from './chatgpt'
import { auth } from './middleware/auth'
import { limiter } from './middleware/limiter'
import { isNotEmptyString } from './utils/is'
import * as storage from './storage'
import { getAllTokens, syncFromOpenClaw, addToken, removeToken, getActiveTokens } from './codex'

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
    const { prompt, options = {}, systemMessage, temperature, top_p, model, history, apiBaseUrl, apiKey, files } = req.body as RequestProps & { apiBaseUrl?: string; apiKey?: string }

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

// ---- Codex OAuth Token Management ----

// List Codex tokens (masked)
router.get('/codex/tokens', auth, async (_req, res) => {
  try {
    // Sync from OpenClaw first
    syncFromOpenClaw()
    const tokens = getAllTokens()
    const now = Date.now()
    const masked = tokens.map(t => ({
      email: t.email,
      active: t.expires > now + 5 * 60 * 1000,
      expiresAt: new Date(t.expires).toISOString(),
      expiresIn: Math.max(0, Math.floor((t.expires - now) / 1000 / 60)) + ' min',
    }))
    res.json({ status: 'Success', data: masked })
  }
  catch (e: any) {
    res.json({ status: 'Fail', message: e.message, data: null })
  }
})

// Sync from OpenClaw
router.post('/codex/sync', auth, async (_req, res) => {
  try {
    const tokens = syncFromOpenClaw()
    res.json({ status: 'Success', data: { synced: tokens.length } })
  }
  catch (e: any) {
    res.json({ status: 'Fail', message: e.message, data: null })
  }
})

// Remove a token
router.delete('/codex/tokens/:email', auth, async (req, res) => {
  try {
    removeToken(req.params.email)
    res.json({ status: 'Success', data: null })
  }
  catch (e: any) {
    res.json({ status: 'Fail', message: e.message, data: null })
  }
})

app.use('', router)
app.use('/api', router)
app.set('trust proxy', 1)

app.listen(3002, () => globalThis.console.log('Server is running on port 3002'))
