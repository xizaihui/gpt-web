/**
 * AuditDAO - 审计日志表
 */
import { getDb } from './db.js'
import type { AuditLog, AuditLogInsert, AuditFilter, PageResult } from './types.js'

export class AuditDAO {
  log(data: AuditLogInsert): number {
    const db = getDb()
    const stmt = db.prepare(`
      INSERT INTO audit_logs (ts, admin_user, action, target_type, target_id, ip, user_agent, details, success)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    const result = stmt.run(
      Date.now(),
      data.admin_user,
      data.action,
      data.target_type ?? null,
      data.target_id ?? null,
      data.ip ?? null,
      data.user_agent ?? null,
      data.details ?? null,
      data.success ?? 1
    )
    return Number(result.lastInsertRowid)
  }

  query(filter: AuditFilter = {}, page = 1, size = 50): PageResult<AuditLog> {
    const db = getDb()
    const conditions: string[] = []
    const params: any[] = []

    if (filter.admin_user) {
      conditions.push('admin_user = ?')
      params.push(filter.admin_user)
    }
    if (filter.action) {
      conditions.push('action = ?')
      params.push(filter.action)
    }
    if (filter.target_type) {
      conditions.push('target_type = ?')
      params.push(filter.target_type)
    }
    if (filter.target_id) {
      conditions.push('target_id = ?')
      params.push(filter.target_id)
    }
    if (filter.from !== undefined) {
      conditions.push('ts >= ?')
      params.push(filter.from)
    }
    if (filter.to !== undefined) {
      conditions.push('ts <= ?')
      params.push(filter.to)
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    const countStmt = db.prepare(`SELECT COUNT(*) as total FROM audit_logs ${where}`)
    const { total } = countStmt.get(...params) as { total: number }

    const offset = (page - 1) * size
    const dataStmt = db.prepare(`SELECT * FROM audit_logs ${where} ORDER BY ts DESC LIMIT ? OFFSET ?`)
    const items = dataStmt.all(...params, size, offset) as AuditLog[]

    return { items, total, page, size }
  }
}

export const auditDAO = new AuditDAO()
