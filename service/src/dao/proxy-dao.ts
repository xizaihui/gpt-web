/**
 * ProxyDAO - 代理表 CRUD
 */
import { randomUUID } from 'crypto'
import { getDb } from './db.js'
import type { Proxy, ProxyCreate, ProxyUpdate, PageResult } from './types.js'

export class ProxyDAO {
  create(data: ProxyCreate): Proxy {
    const db = getDb()
    const now = Date.now()
    const id = data.id || randomUUID()
    const stmt = db.prepare(`
      INSERT INTO proxies (id, name, url, status, tags, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    stmt.run(id, data.name, data.url, data.status ?? 'active', data.tags ?? null, now, now)
    return this.getById(id)!
  }

  getById(id: string): Proxy | null {
    const db = getDb()
    const stmt = db.prepare('SELECT * FROM proxies WHERE id = ?')
    return (stmt.get(id) as Proxy) ?? null
  }

  update(id: string, data: ProxyUpdate): Proxy | null {
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

    const stmt = db.prepare(`UPDATE proxies SET ${fields.join(', ')} WHERE id = ?`)
    stmt.run(...values)
    return this.getById(id)
  }

  delete(id: string): boolean {
    const db = getDb()
    const stmt = db.prepare('DELETE FROM proxies WHERE id = ?')
    const result = stmt.run(id)
    return result.changes > 0
  }

  list(status?: string, page = 1, size = 50): PageResult<Proxy> {
    const db = getDb()
    const where = status ? 'WHERE status = ?' : ''
    const params: any[] = status ? [status] : []

    const countStmt = db.prepare(`SELECT COUNT(*) as total FROM proxies ${where}`)
    const { total } = countStmt.get(...params) as { total: number }

    const offset = (page - 1) * size
    const dataStmt = db.prepare(`SELECT * FROM proxies ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    const items = dataStmt.all(...params, size, offset) as Proxy[]

    return { items, total, page, size }
  }

  testAndUpdate(id: string, latencyMs: number | null, error: string | null): void {
    const db = getDb()
    const now = Date.now()
    const status = error ? 'error' : 'active'
    const stmt = db.prepare(`
      UPDATE proxies SET latency_ms = ?, last_tested_at = ?, last_error = ?, status = ?, updated_at = ? WHERE id = ?
    `)
    stmt.run(latencyMs, now, error, status, now, id)
  }

  getByUrl(url: string): Proxy | null {
    const db = getDb()
    const stmt = db.prepare('SELECT * FROM proxies WHERE url = ?')
    return (stmt.get(url) as Proxy) ?? null
  }
}

export const proxyDAO = new ProxyDAO()
