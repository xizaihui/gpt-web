/**
 * DAO 层类型定义
 */

// ========== Account ==========
export interface Account {
  id: string
  provider: string
  label: string | null
  credential: string
  credential_type: string
  proxy_id: string | null
  status: string
  tags: string | null          // JSON array string
  metadata: string | null      // JSON object string
  quota_snapshot: string | null // JSON object string
  quota_synced_at: number | null
  last_used_at: number | null
  last_error: string | null
  error_count: number
  success_count: number
  created_at: number
  updated_at: number
}

export interface AccountCreate {
  id?: string
  provider: string
  label?: string | null
  credential: string
  credential_type: string
  proxy_id?: string | null
  status?: string
  tags?: string | null
  metadata?: string | null
}

export interface AccountUpdate {
  label?: string | null
  credential?: string
  credential_type?: string
  proxy_id?: string | null
  status?: string
  tags?: string | null
  metadata?: string | null
  quota_snapshot?: string | null
  quota_synced_at?: number | null
  last_used_at?: number | null
  last_error?: string | null
  error_count?: number
  success_count?: number
}

export interface AccountFilter {
  provider?: string
  status?: string
  proxy_id?: string
  search?: string  // search label or credential prefix
  tags?: string[]  // filter by tags (any match)
}

// ========== Proxy ==========
export interface Proxy {
  id: string
  name: string
  url: string
  status: string
  latency_ms: number | null
  last_tested_at: number | null
  last_error: string | null
  tags: string | null
  created_at: number
  updated_at: number
}

export interface ProxyCreate {
  id?: string
  name: string
  url: string
  status?: string
  tags?: string | null
}

export interface ProxyUpdate {
  name?: string
  url?: string
  status?: string
  latency_ms?: number | null
  last_tested_at?: number | null
  last_error?: string | null
  tags?: string | null
}

// ========== UsageLog ==========
export interface UsageLog {
  id: number
  account_id: string
  provider: string
  ts: number
  model: string | null
  tokens_prompt: number | null
  tokens_completion: number | null
  tokens_total: number | null
  latency_ms: number | null
  success: number  // 0 or 1
  error_code: string | null
  session_util: number | null
  seven_day_util: number | null
  metadata: string | null
}

export interface UsageLogInsert {
  account_id: string
  provider: string
  ts?: number
  model?: string | null
  tokens_prompt?: number | null
  tokens_completion?: number | null
  tokens_total?: number | null
  latency_ms?: number | null
  success?: number
  error_code?: string | null
  session_util?: number | null
  seven_day_util?: number | null
  metadata?: string | null
}

// ========== AuditLog ==========
export interface AuditLog {
  id: number
  ts: number
  admin_user: string
  action: string
  target_type: string | null
  target_id: string | null
  ip: string | null
  user_agent: string | null
  details: string | null  // JSON string
  success: number         // 0 or 1
}

export interface AuditLogInsert {
  admin_user: string
  action: string
  target_type?: string | null
  target_id?: string | null
  ip?: string | null
  user_agent?: string | null
  details?: string | null
  success?: number
}

export interface AuditFilter {
  admin_user?: string
  action?: string
  target_type?: string
  target_id?: string
  from?: number
  to?: number
}

// ========== AdminUser ==========
export interface AdminUser {
  id: number
  username: string
  password_hash: string
  role: string
  created_at: number
  last_login_at: number | null
  enabled: number  // 0 or 1
}

export interface AdminUserCreate {
  username: string
  password_hash: string
  role?: string
}

// ========== Pagination ==========
export interface PageResult<T> {
  items: T[]
  total: number
  page: number
  size: number
}
