import Database from 'better-sqlite3'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DB_PATH = path.join(__dirname, '..', 'data', 'chat.db')

// Ensure data directory exists
import fs from 'fs'
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true })

const db = new Database(DB_PATH, {})

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

// Create tables (for fresh DBs — includes client_id from the start)
db.exec(`
  CREATE TABLE IF NOT EXISTS conversations (
    uuid       INTEGER PRIMARY KEY,
    client_id  TEXT NOT NULL DEFAULT 'default',
    title      TEXT NOT NULL DEFAULT '新对话',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS messages (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL REFERENCES conversations(uuid) ON DELETE CASCADE,
    "index"         INTEGER NOT NULL,
    text            TEXT NOT NULL DEFAULT '',
    inversion       INTEGER NOT NULL DEFAULT 0,
    error           INTEGER NOT NULL DEFAULT 0,
    loading         INTEGER NOT NULL DEFAULT 0,
    model           TEXT,
    date_time       TEXT,
    usage_json      TEXT,
    request_options  TEXT,
    conversation_options TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(conversation_id, "index")
  );

  CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id);
`)

// Migration: add client_id column if missing (existing DBs that were created before this feature)
try {
  db.exec(`ALTER TABLE conversations ADD COLUMN client_id TEXT NOT NULL DEFAULT 'default'`)
  console.log('[Storage] Migrated: added client_id column to conversations')
} catch {
  // Column already exists — ignore
}

// Create index after migration ensures column exists
db.exec(`CREATE INDEX IF NOT EXISTS idx_conversations_client ON conversations(client_id)`)

// ---------- Conversations ----------

export interface ConversationRow {
  uuid: number
  client_id: string
  title: string
  created_at: string
  updated_at: string
}

export interface MessageRow {
  id: number
  conversation_id: number
  index: number
  text: string
  inversion: boolean
  error: boolean
  loading: boolean
  model: string | null
  date_time: string | null
  usage_json: string | null
  request_options: string | null
  conversation_options: string | null
}

const stmts = {
  // Conversations
  listConversations: db.prepare(`
    SELECT uuid, client_id, title, created_at, updated_at FROM conversations WHERE client_id = ? ORDER BY updated_at DESC
  `),
  getConversation: db.prepare(`SELECT * FROM conversations WHERE uuid = ?`),
  insertConversation: db.prepare(`
    INSERT INTO conversations (uuid, client_id, title) VALUES (@uuid, @client_id, @title)
  `),
  updateConversationTitle: db.prepare(`
    UPDATE conversations SET title = @title, updated_at = datetime('now') WHERE uuid = @uuid AND client_id = @client_id
  `),
  touchConversation: db.prepare(`
    UPDATE conversations SET updated_at = datetime('now') WHERE uuid = ?
  `),
  deleteConversation: db.prepare(`DELETE FROM conversations WHERE uuid = @uuid AND client_id = @client_id`),
  clearConversations: db.prepare(`DELETE FROM conversations WHERE client_id = ?`),

  // Messages
  listMessages: db.prepare(`
    SELECT * FROM messages WHERE conversation_id = ? ORDER BY "index" ASC
  `),
  insertMessage: db.prepare(`
    INSERT INTO messages (conversation_id, "index", text, inversion, error, loading, model, date_time, usage_json, request_options, conversation_options)
    VALUES (@conversation_id, @index, @text, @inversion, @error, @loading, @model, @date_time, @usage_json, @request_options, @conversation_options)
  `),
  upsertMessage: db.prepare(`
    INSERT INTO messages (conversation_id, "index", text, inversion, error, loading, model, date_time, usage_json, request_options, conversation_options)
    VALUES (@conversation_id, @index, @text, @inversion, @error, @loading, @model, @date_time, @usage_json, @request_options, @conversation_options)
    ON CONFLICT(conversation_id, "index") DO UPDATE SET
      text = excluded.text,
      inversion = excluded.inversion,
      error = excluded.error,
      loading = excluded.loading,
      model = excluded.model,
      date_time = excluded.date_time,
      usage_json = excluded.usage_json,
      request_options = excluded.request_options,
      conversation_options = excluded.conversation_options
  `),
  deleteMessage: db.prepare(`
    DELETE FROM messages WHERE conversation_id = @conversation_id AND "index" = @index
  `),
  clearMessages: db.prepare(`DELETE FROM messages WHERE conversation_id = ?`),
}

// ---- API ----

export function listConversations(clientId: string = 'default'): ConversationRow[] {
  return stmts.listConversations.all(clientId) as ConversationRow[]
}

export function getConversation(uuid: number): ConversationRow | undefined {
  return stmts.getConversation.get(uuid) as ConversationRow | undefined
}

export function createConversation(uuid: number, title: string, clientId: string = 'default'): void {
  stmts.insertConversation.run({ uuid, client_id: clientId, title })
}

export function updateConversationTitle(uuid: number, title: string, clientId: string = 'default'): void {
  stmts.updateConversationTitle.run({ uuid, client_id: clientId, title })
}

export function deleteConversation(uuid: number, clientId: string = 'default'): void {
  stmts.deleteConversation.run({ uuid, client_id: clientId })
}

export function clearAllConversations(clientId: string = 'default'): void {
  stmts.clearConversations.run(clientId)
}

export function listMessages(conversationId: number): MessageRow[] {
  return stmts.listMessages.all(conversationId) as MessageRow[]
}

function serializeMsg(conversationId: number, index: number, msg: any) {
  return {
    conversation_id: conversationId,
    index,
    text: msg.text ?? '',
    inversion: msg.inversion ? 1 : 0,
    error: msg.error ? 1 : 0,
    loading: 0, // never persist loading state
    model: msg.model ?? null,
    date_time: msg.dateTime ?? null,
    usage_json: msg.usage ? JSON.stringify(msg.usage) : null,
    request_options: msg.requestOptions ? JSON.stringify(msg.requestOptions) : null,
    conversation_options: msg.conversationOptions ? JSON.stringify(msg.conversationOptions) : null,
  }
}

export function upsertMessage(conversationId: number, index: number, msg: any, clientId: string = 'default'): void {
  // Auto-create conversation if it doesn't exist
  if (!stmts.getConversation.get(conversationId)) {
    stmts.insertConversation.run({ uuid: conversationId, client_id: clientId, title: '新对话' })
  }
  stmts.upsertMessage.run(serializeMsg(conversationId, index, msg))
  stmts.touchConversation.run(conversationId)
}

export function deleteMessage(conversationId: number, index: number): void {
  stmts.deleteMessage.run({ conversation_id: conversationId, index })
}

export function clearMessages(conversationId: number): void {
  stmts.clearMessages.run(conversationId)
}

// Bulk save: full sync of a conversation's messages (used for import/migration)
export const bulkSaveMessages = db.transaction((conversationId: number, messages: any[]) => {
  stmts.clearMessages.run(conversationId)
  for (let i = 0; i < messages.length; i++) {
    stmts.insertMessage.run(serializeMsg(conversationId, i, messages[i]))
  }
  stmts.touchConversation.run(conversationId)
})

// Full state import (from localStorage migration)
export const importFullState = db.transaction((state: { history: any[]; chat: any[] }, clientId: string = 'default') => {
  for (const hist of state.history) {
    const existing = stmts.getConversation.get(hist.uuid)
    if (!existing) {
      stmts.insertConversation.run({ uuid: hist.uuid, client_id: clientId, title: hist.title || '新对话' })
    }
  }
  for (const chatItem of state.chat) {
    stmts.clearMessages.run(chatItem.uuid)
    const messages = chatItem.data || []
    for (let i = 0; i < messages.length; i++) {
      stmts.insertMessage.run(serializeMsg(chatItem.uuid, i, messages[i]))
    }
    stmts.touchConversation.run(chatItem.uuid)
  }
})

export function deserializeMessage(row: MessageRow) {
  return {
    dateTime: row.date_time,
    text: row.text,
    inversion: !!row.inversion,
    error: !!row.error,
    loading: false,
    model: row.model,
    usage: row.usage_json ? JSON.parse(row.usage_json) : undefined,
    requestOptions: row.request_options ? JSON.parse(row.request_options) : undefined,
    conversationOptions: row.conversation_options ? JSON.parse(row.conversation_options) : undefined,
  }
}

export default db

// ═══════════════════════════════════════════════════════════════════
// Request Logs & Cost Tracking
// ═══════════════════════════════════════════════════════════════════

// Shanghai time helper
function shanghaiNow(): string {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }).replace('T', ' ')
}

// Schema
db.exec(`
  CREATE TABLE IF NOT EXISTS request_logs (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at      TEXT NOT NULL,
    model           TEXT NOT NULL DEFAULT '',
    client_id       TEXT NOT NULL DEFAULT '',
    input_tokens    INTEGER NOT NULL DEFAULT 0,
    output_tokens   INTEGER NOT NULL DEFAULT 0,
    cache_read_tokens  INTEGER NOT NULL DEFAULT 0,
    cache_write_tokens INTEGER NOT NULL DEFAULT 0,
    input_cost      REAL NOT NULL DEFAULT 0,
    output_cost     REAL NOT NULL DEFAULT 0,
    cache_read_cost REAL NOT NULL DEFAULT 0,
    cache_write_cost REAL NOT NULL DEFAULT 0,
    total_cost      REAL NOT NULL DEFAULT 0,
    duration_ms     INTEGER NOT NULL DEFAULT 0,
    session_id      TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX IF NOT EXISTS idx_logs_created ON request_logs(created_at);
  CREATE INDEX IF NOT EXISTS idx_logs_model ON request_logs(model);

  CREATE TABLE IF NOT EXISTS log_settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  INSERT OR IGNORE INTO log_settings (key, value) VALUES ('retention_days', '7');
`)

// Price table (per 1M tokens, USD)
const PRICING: Record<string, { input: number; output: number; cache_read: number; cache_write: number }> = {
  opus: { input: 5.0, output: 25.0, cache_read: 0.496, cache_write: 6.248 },
  sonnet: { input: 3.0, output: 15.0, cache_read: 0.3, cache_write: 3.75 },
}

function getPricing(model: string) {
  const m = (model || '').toLowerCase()
  if (m.includes('opus')) return PRICING.opus
  return PRICING.sonnet // default
}

export interface CostBreakdown {
  input_cost: number
  output_cost: number
  cache_read_cost: number
  cache_write_cost: number
  total_cost: number
}

export function calculateCost(model: string, usage: {
  input_tokens?: number; output_tokens?: number;
  cache_read_tokens?: number; cache_write_tokens?: number;
}): CostBreakdown {
  const p = getPricing(model)
  const ic = ((usage.input_tokens || 0) / 1_000_000) * p.input
  const oc = ((usage.output_tokens || 0) / 1_000_000) * p.output
  const rc = ((usage.cache_read_tokens || 0) / 1_000_000) * p.cache_read
  const wc = ((usage.cache_write_tokens || 0) / 1_000_000) * p.cache_write
  return {
    input_cost: +ic.toFixed(6),
    output_cost: +oc.toFixed(6),
    cache_read_cost: +rc.toFixed(6),
    cache_write_cost: +wc.toFixed(6),
    total_cost: +(ic + oc + rc + wc).toFixed(6),
  }
}

// Prepared statements
const logStmts = {
  insert: db.prepare(`
    INSERT INTO request_logs (created_at, model, client_id, input_tokens, output_tokens,
      cache_read_tokens, cache_write_tokens, input_cost, output_cost,
      cache_read_cost, cache_write_cost, total_cost, duration_ms, session_id)
    VALUES (@created_at, @model, @client_id, @input_tokens, @output_tokens,
      @cache_read_tokens, @cache_write_tokens, @input_cost, @output_cost,
      @cache_read_cost, @cache_write_cost, @total_cost, @duration_ms, @session_id)
  `),
  getSetting: db.prepare(`SELECT value FROM log_settings WHERE key = ?`),
  setSetting: db.prepare(`INSERT OR REPLACE INTO log_settings (key, value) VALUES (?, ?)`),
  purge: db.prepare(`DELETE FROM request_logs WHERE created_at < ?`),
}

export function recordRequestLog(params: {
  model: string; client_id: string; session_id?: string; duration_ms?: number;
  input_tokens?: number; output_tokens?: number;
  cache_read_tokens?: number; cache_write_tokens?: number;
}) {
  const cost = calculateCost(params.model, params)
  logStmts.insert.run({
    created_at: shanghaiNow(),
    model: params.model || '',
    client_id: params.client_id || '',
    input_tokens: params.input_tokens || 0,
    output_tokens: params.output_tokens || 0,
    cache_read_tokens: params.cache_read_tokens || 0,
    cache_write_tokens: params.cache_write_tokens || 0,
    ...cost,
    duration_ms: params.duration_ms || 0,
    session_id: params.session_id || '',
  })
}

export function queryRequestLogs(opts: {
  page?: number; pageSize?: number;
  model?: string; client_id?: string;
  date_from?: string; date_to?: string;
}) {
  const page = Math.max(1, opts.page || 1)
  const pageSize = Math.min(100, Math.max(1, opts.pageSize || 20))
  const conditions: string[] = []
  const params: any[] = []

  if (opts.model) { conditions.push('model LIKE ?'); params.push(`%${opts.model}%`) }
  if (opts.client_id) { conditions.push('client_id LIKE ?'); params.push(`%${opts.client_id}%`) }
  if (opts.date_from) { conditions.push('created_at >= ?'); params.push(opts.date_from) }
  if (opts.date_to) { conditions.push('created_at <= ?'); params.push(opts.date_to + ' 23:59:59') }

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : ''
  const countRow = db.prepare(`SELECT COUNT(*) as total FROM request_logs ${where}`).get(...params) as any
  const rows = db.prepare(
    `SELECT * FROM request_logs ${where} ORDER BY id DESC LIMIT ? OFFSET ?`
  ).all(...params, pageSize, (page - 1) * pageSize)

  return { total: countRow?.total || 0, page, pageSize, data: rows }
}

export function getLogStats(date_from?: string, date_to?: string) {
  const conditions: string[] = []
  const params: any[] = []
  if (date_from) { conditions.push('created_at >= ?'); params.push(date_from) }
  if (date_to) { conditions.push('created_at <= ?'); params.push(date_to + ' 23:59:59') }
  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : ''

  const summary = db.prepare(`
    SELECT COUNT(*) as total_requests,
      COALESCE(SUM(total_cost), 0) as total_cost,
      COALESCE(SUM(input_tokens), 0) as total_input_tokens,
      COALESCE(SUM(output_tokens), 0) as total_output_tokens,
      COALESCE(SUM(cache_read_tokens), 0) as total_cache_read_tokens,
      COALESCE(SUM(cache_write_tokens), 0) as total_cache_write_tokens,
      COALESCE(SUM(input_cost), 0) as total_input_cost,
      COALESCE(SUM(output_cost), 0) as total_output_cost,
      COALESCE(SUM(cache_read_cost), 0) as total_cache_read_cost,
      COALESCE(SUM(cache_write_cost), 0) as total_cache_write_cost
    FROM request_logs ${where}
  `).get(...params)

  const byModel = db.prepare(`
    SELECT model, COUNT(*) as requests, COALESCE(SUM(total_cost), 0) as cost,
      COALESCE(SUM(input_tokens), 0) as input_tokens,
      COALESCE(SUM(output_tokens), 0) as output_tokens
    FROM request_logs ${where} GROUP BY model ORDER BY cost DESC
  `).all(...params)

  const byDay = db.prepare(`
    SELECT SUBSTR(created_at, 1, 10) as date, COUNT(*) as requests,
      COALESCE(SUM(total_cost), 0) as cost
    FROM request_logs ${where} GROUP BY date ORDER BY date DESC LIMIT 30
  `).all(...params)

  // Today stats (Shanghai time)
  const today = shanghaiNow().slice(0, 10)
  const todayStats = db.prepare(`
    SELECT COUNT(*) as requests, COALESCE(SUM(total_cost), 0) as cost
    FROM request_logs WHERE created_at >= ?
  `).get(today) as any

  return { summary, byModel, byDay, today: todayStats }
}

export function getLogSetting(key: string): string {
  const row = logStmts.getSetting.get(key) as any
  return row?.value || ''
}

export function setLogSetting(key: string, value: string) {
  logStmts.setSetting.run(key, value)
}

export function purgeOldLogs() {
  const days = parseInt(getLogSetting('retention_days') || '7', 10)
  const cutoff = new Date(Date.now() - days * 86400000)
    .toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }).replace('T', ' ')
  const result = logStmts.purge.run(cutoff)
  if (result.changes > 0) console.log(`[Logs] Purged ${result.changes} old logs (>${days}d)`)
}

// Auto-purge on startup + every hour
purgeOldLogs()
setInterval(purgeOldLogs, 3600_000)
