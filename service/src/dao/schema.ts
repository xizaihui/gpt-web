/**
 * Schema 定义 + 迁移函数
 * 表名不加前缀 - 与现有 conversations/messages 表名不冲突
 */
import { getDb } from './db.js'

const SCHEMA_SQL = `
-- 账号表（统一所有 Provider）
CREATE TABLE IF NOT EXISTS accounts (
    id              TEXT PRIMARY KEY,
    provider        TEXT NOT NULL,
    label           TEXT,
    credential      TEXT NOT NULL,
    credential_type TEXT NOT NULL,
    proxy_id        TEXT,
    status          TEXT NOT NULL DEFAULT 'active',
    tags            TEXT,
    metadata        TEXT,
    quota_snapshot  TEXT,
    quota_synced_at INTEGER,
    last_used_at    INTEGER,
    last_error      TEXT,
    error_count     INTEGER NOT NULL DEFAULT 0,
    success_count   INTEGER NOT NULL DEFAULT 0,
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL,
    FOREIGN KEY (proxy_id) REFERENCES proxies(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_accounts_provider ON accounts(provider);
CREATE INDEX IF NOT EXISTS idx_accounts_provider_status ON accounts(provider, status);
CREATE INDEX IF NOT EXISTS idx_accounts_last_used ON accounts(last_used_at);
CREATE INDEX IF NOT EXISTS idx_accounts_credential ON accounts(provider, credential);

-- 代理表
CREATE TABLE IF NOT EXISTS proxies (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    url             TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'active',
    latency_ms      INTEGER,
    last_tested_at  INTEGER,
    last_error      TEXT,
    tags            TEXT,
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_proxies_status ON proxies(status);

-- 使用日志表
CREATE TABLE IF NOT EXISTS usage_logs (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id        TEXT NOT NULL,
    provider          TEXT NOT NULL,
    ts                INTEGER NOT NULL,
    model             TEXT,
    tokens_prompt     INTEGER,
    tokens_completion INTEGER,
    tokens_total      INTEGER,
    latency_ms        INTEGER,
    success           INTEGER NOT NULL DEFAULT 1,
    error_code        TEXT,
    session_util      REAL,
    seven_day_util    REAL,
    metadata          TEXT
);

CREATE INDEX IF NOT EXISTS idx_usage_logs_account ON usage_logs(account_id);
CREATE INDEX IF NOT EXISTS idx_usage_logs_ts ON usage_logs(ts);
CREATE INDEX IF NOT EXISTS idx_usage_logs_provider_ts ON usage_logs(provider, ts);

-- 审计日志表
CREATE TABLE IF NOT EXISTS audit_logs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    ts          INTEGER NOT NULL,
    admin_user  TEXT NOT NULL,
    action      TEXT NOT NULL,
    target_type TEXT,
    target_id   TEXT,
    ip          TEXT,
    user_agent  TEXT,
    details     TEXT,
    success     INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_ts ON audit_logs(ts);
CREATE INDEX IF NOT EXISTS idx_audit_logs_admin ON audit_logs(admin_user);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);

-- 管理员用户表
CREATE TABLE IF NOT EXISTS admin_users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'admin',
    created_at    INTEGER NOT NULL,
    last_login_at INTEGER,
    enabled       INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_admin_users_username ON admin_users(username);
`

export function runMigrations(): void {
  const db = getDb()
  console.log('[DAO] Running schema migrations...')
  
  // Execute all CREATE TABLE / CREATE INDEX statements
  // We need to split by semicolons and execute each separately
  // because better-sqlite3's exec() handles multiple statements fine
  db.exec(SCHEMA_SQL)
  
  console.log('[DAO] Schema migrations complete. Tables: accounts, proxies, usage_logs, audit_logs, admin_users')
}
