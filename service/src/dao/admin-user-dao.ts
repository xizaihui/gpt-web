/**
 * AdminUserDAO - 管理员用户表
 */
import { createHash } from 'crypto'
import { getDb } from './db.js'
import type { AdminUser, AdminUserCreate, PageResult } from './types.js'

/**
 * Simple password hashing using SHA-256 + salt
 * For production, consider bcrypt or argon2
 */
function hashPassword(password: string, salt?: string): string {
  const s = salt || Math.random().toString(36).substring(2, 15)
  const hash = createHash('sha256').update(s + password).digest('hex')
  return `${s}:${hash}`
}

function verifyPassword(password: string, storedHash: string): boolean {
  const [salt] = storedHash.split(':')
  const computed = hashPassword(password, salt)
  return computed === storedHash
}

export class AdminUserDAO {
  create(data: AdminUserCreate): AdminUser {
    const db = getDb()
    const now = Date.now()
    const stmt = db.prepare(`
      INSERT INTO admin_users (username, password_hash, role, created_at, enabled)
      VALUES (?, ?, ?, ?, 1)
    `)
    const result = stmt.run(
      data.username,
      data.password_hash,
      data.role ?? 'admin',
      now
    )
    return this.getById(Number(result.lastInsertRowid))!
  }

  getById(id: number): AdminUser | null {
    const db = getDb()
    const stmt = db.prepare('SELECT * FROM admin_users WHERE id = ?')
    return (stmt.get(id) as AdminUser) ?? null
  }

  getByUsername(username: string): AdminUser | null {
    const db = getDb()
    const stmt = db.prepare('SELECT * FROM admin_users WHERE username = ?')
    return (stmt.get(username) as AdminUser) ?? null
  }

  verify(username: string, password: string): AdminUser | null {
    const user = this.getByUsername(username)
    if (!user || !user.enabled) return null
    if (!verifyPassword(password, user.password_hash)) return null
    return user
  }

  updateLastLogin(id: number): void {
    const db = getDb()
    const stmt = db.prepare('UPDATE admin_users SET last_login_at = ? WHERE id = ?')
    stmt.run(Date.now(), id)
  }

  list(page = 1, size = 50): PageResult<Omit<AdminUser, 'password_hash'>> {
    const db = getDb()
    const countStmt = db.prepare('SELECT COUNT(*) as total FROM admin_users')
    const { total } = countStmt.get() as { total: number }

    const offset = (page - 1) * size
    const dataStmt = db.prepare('SELECT id, username, role, created_at, last_login_at, enabled FROM admin_users ORDER BY created_at DESC LIMIT ? OFFSET ?')
    const items = dataStmt.all(size, offset) as Omit<AdminUser, 'password_hash'>[]

    return { items, total, page, size }
  }

  delete(id: number): boolean {
    const db = getDb()
    const stmt = db.prepare('DELETE FROM admin_users WHERE id = ?')
    const result = stmt.run(id)
    return result.changes > 0
  }

  /**
   * Create a default admin user if none exists
   */
  ensureDefaultAdmin(password = 'admin123'): void {
    const existing = this.getByUsername('admin')
    if (existing) return
    const hash = hashPassword(password)
    this.create({ username: 'admin', password_hash: hash, role: 'superadmin' })
    console.log('[DAO] Created default admin user: admin')
  }
}

export const adminUserDAO = new AdminUserDAO()
export { hashPassword, verifyPassword }
