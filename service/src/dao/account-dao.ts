/**
 * AccountDAO - 账号表 CRUD
 */
import { randomUUID } from 'crypto'
import { getDb } from './db.js'
import type { Account, AccountCreate, AccountUpdate, AccountFilter, PageResult } from './types.js'

export class AccountDAO {
  create(data: AccountCreate): Account {
    const db = getDb()
    const now = Date.now()
    const id = data.id || randomUUID()
    const stmt = db.prepare(`
      INSERT INTO accounts (id, provider, label, credential, credential_type, proxy_id, status, tags, metadata, error_count, success_count, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)
    `)
    stmt.run(
      id,
      data.provider,
      data.label ?? null,
      data.credential,
      data.credential_type,
      data.proxy_id ?? null,
      data.status ?? 'active',
      data.tags ?? null,
      data.metadata ?? null,
      now,
      now
    )
    return this.getById(id)!
  }

  getById(id: string): Account | null {
    const db = getDb()
    const stmt = db.prepare('SELECT * FROM accounts WHERE id = ?')
    return (stmt.get(id) as Account) ?? null
  }

  getByProvider(provider: string, status?: string): Account[] {
    const db = getDb()
    if (status) {
      const stmt = db.prepare('SELECT * FROM accounts WHERE provider = ? AND status = ? ORDER BY created_at DESC')
      return stmt.all(provider, status) as Account[]
    }
    const stmt = db.prepare('SELECT * FROM accounts WHERE provider = ? ORDER BY created_at DESC')
    return stmt.all(provider) as Account[]
  }

  update(id: string, data: AccountUpdate): Account | null {
    const db = getDb()
    const fields: string[] = []
    const values: any[] = []

    for (const [key, value] of Object.entries(data)) {
      if (value !== undefined) {
        fields.push(`${key} = ?`)
        values.push(value)
      }
    }
    if (fields.length === 0) return this.getById(id)

    fields.push('updated_at = ?')
    values.push(Date.now())
    values.push(id)

    const stmt = db.prepare(`UPDATE accounts SET ${fields.join(', ')} WHERE id = ?`)
    stmt.run(...values)
    return this.getById(id)
  }

  delete(id: string): boolean {
    const db = getDb()
    const stmt = db.prepare('DELETE FROM accounts WHERE id = ?')
    const result = stmt.run(id)
    return result.changes > 0
  }

  list(filter: AccountFilter = {}, page = 1, size = 50): PageResult<Account> {
    const db = getDb()
    const conditions: string[] = []
    const params: any[] = []

    if (filter.provider) {
      conditions.push('provider = ?')
      params.push(filter.provider)
    }
    if (filter.status) {
      conditions.push('status = ?')
      params.push(filter.status)
    }
    if (filter.proxy_id) {
      conditions.push('proxy_id = ?')
      params.push(filter.proxy_id)
    }
    if (filter.search) {
      conditions.push('(label LIKE ? OR credential LIKE ?)')
      const like = `%${filter.search}%`
      params.push(like, like)
    }
    if (filter.tags && filter.tags.length > 0) {
      // Match any tag in the JSON array
      const tagConditions = filter.tags.map(() => "tags LIKE ?").join(' OR ')
      conditions.push(`(${tagConditions})`)
      for (const tag of filter.tags) {
        params.push(`%${tag}%`)
      }
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    const countStmt = db.prepare(`SELECT COUNT(*) as total FROM accounts ${where}`)
    const { total } = countStmt.get(...params) as { total: number }

    const offset = (page - 1) * size
    const dataStmt = db.prepare(`SELECT * FROM accounts ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    const items = dataStmt.all(...params, size, offset) as Account[]

    return { items, total, page, size }
  }

  count(provider?: string): number {
    const db = getDb()
    if (provider) {
      const stmt = db.prepare('SELECT COUNT(*) as total FROM accounts WHERE provider = ?')
      return (stmt.get(provider) as { total: number }).total
    }
    const stmt = db.prepare('SELECT COUNT(*) as total FROM accounts')
    return (stmt.get() as { total: number }).total
  }

  updateQuota(id: string, snapshot: object, sessionUtil?: number, sevenDayUtil?: number): void {
    const db = getDb()
    const now = Date.now()
    const stmt = db.prepare(`
      UPDATE accounts SET quota_snapshot = ?, quota_synced_at = ?, updated_at = ? WHERE id = ?
    `)
    stmt.run(JSON.stringify(snapshot), now, now, id)
  }

  updateStats(id: string, success: boolean, error?: string): void {
    const db = getDb()
    const now = Date.now()
    if (success) {
      const stmt = db.prepare(`
        UPDATE accounts SET success_count = success_count + 1, last_used_at = ?, updated_at = ? WHERE id = ?
      `)
      stmt.run(now, now, id)
    } else {
      const stmt = db.prepare(`
        UPDATE accounts SET error_count = error_count + 1, last_error = ?, last_used_at = ?, updated_at = ? WHERE id = ?
      `)
      stmt.run(error ?? null, now, now, id)
    }
  }

  bulkCreate(items: AccountCreate[]): { inserted: number; skipped: number; errors: number } {
    const db = getDb()
    const now = Date.now()
    let inserted = 0
    let skipped = 0
    let errors = 0

    const insertStmt = db.prepare(`
      INSERT INTO accounts (id, provider, label, credential, credential_type, proxy_id, status, tags, metadata, error_count, success_count, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)
    `)
    const checkStmt = db.prepare('SELECT id FROM accounts WHERE provider = ? AND credential = ?')

    const tx = db.transaction((items: AccountCreate[]) => {
      for (const data of items) {
        try {
          // Check for duplicate
          const existing = checkStmt.get(data.provider, data.credential)
          if (existing) {
            skipped++
            continue
          }
          insertStmt.run(
            data.id || randomUUID(),
            data.provider,
            data.label ?? null,
            data.credential,
            data.credential_type,
            data.proxy_id ?? null,
            data.status ?? 'active',
            data.tags ?? null,
            data.metadata ?? null,
            now,
            now
          )
          inserted++
        } catch (e) {
          errors++
        }
      }
    })

    tx(items)
    return { inserted, skipped, errors }
  }

  search(query: string, provider?: string, page = 1, size = 50): PageResult<Account> {
    return this.list({ search: query, provider }, page, size)
  }
}

export const accountDAO = new AccountDAO()
