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
