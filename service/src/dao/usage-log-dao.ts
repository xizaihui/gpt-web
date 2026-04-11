/**
 * UsageLogDAO - 使用日志表
 */
import { getDb } from './db.js'
import type { UsageLog, UsageLogInsert } from './types.js'

export class UsageLogDAO {
  insert(data: UsageLogInsert): number {
    const db = getDb()
    const stmt = db.prepare(`
      INSERT INTO usage_logs (account_id, provider, ts, model, tokens_prompt, tokens_completion, tokens_total, latency_ms, success, error_code, session_util, seven_day_util, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    const result = stmt.run(
      data.account_id,
      data.provider,
      data.ts ?? Date.now(),
      data.model ?? null,
      data.tokens_prompt ?? null,
      data.tokens_completion ?? null,
      data.tokens_total ?? null,
      data.latency_ms ?? null,
      data.success ?? 1,
      data.error_code ?? null,
      data.session_util ?? null,
      data.seven_day_util ?? null,
      data.metadata ?? null
    )
    return Number(result.lastInsertRowid)
  }

  bulkInsert(items: UsageLogInsert[]): number {
    const db = getDb()
    const stmt = db.prepare(`
      INSERT INTO usage_logs (account_id, provider, ts, model, tokens_prompt, tokens_completion, tokens_total, latency_ms, success, error_code, session_util, seven_day_util, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    let count = 0
    const tx = db.transaction((items: UsageLogInsert[]) => {
      for (const data of items) {
        stmt.run(
          data.account_id,
          data.provider,
          data.ts ?? Date.now(),
          data.model ?? null,
          data.tokens_prompt ?? null,
          data.tokens_completion ?? null,
          data.tokens_total ?? null,
          data.latency_ms ?? null,
          data.success ?? 1,
          data.error_code ?? null,
          data.session_util ?? null,
          data.seven_day_util ?? null,
          data.metadata ?? null
        )
        count++
      }
    })
    tx(items)
    return count
  }

  query(accountId: string, from?: number, to?: number): UsageLog[] {
    const db = getDb()
    const conditions = ['account_id = ?']
    const params: any[] = [accountId]

    if (from !== undefined) {
      conditions.push('ts >= ?')
      params.push(from)
    }
    if (to !== undefined) {
      conditions.push('ts <= ?')
      params.push(to)
    }

    const where = conditions.join(' AND ')
    const stmt = db.prepare(`SELECT * FROM usage_logs WHERE ${where} ORDER BY ts DESC LIMIT 1000`)
    return stmt.all(...params) as UsageLog[]
  }

  aggregate24h(provider?: string): { account_id: string; total_requests: number; avg_latency: number; success_rate: number }[] {
    const db = getDb()
    const since = Date.now() - 24 * 60 * 60 * 1000
    const providerFilter = provider ? 'AND provider = ?' : ''
    const params: any[] = [since]
    if (provider) params.push(provider)

    const stmt = db.prepare(`
      SELECT 
        account_id,
        COUNT(*) as total_requests,
        AVG(latency_ms) as avg_latency,
        CAST(SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) AS REAL) / COUNT(*) as success_rate
      FROM usage_logs
      WHERE ts >= ? ${providerFilter}
      GROUP BY account_id
      ORDER BY total_requests DESC
    `)
    return stmt.all(...params) as any[]
  }

  aggregate7d(provider?: string): { account_id: string; total_requests: number; avg_latency: number; success_rate: number }[] {
    const db = getDb()
    const since = Date.now() - 7 * 24 * 60 * 60 * 1000
    const providerFilter = provider ? 'AND provider = ?' : ''
    const params: any[] = [since]
    if (provider) params.push(provider)

    const stmt = db.prepare(`
      SELECT 
        account_id,
        COUNT(*) as total_requests,
        AVG(latency_ms) as avg_latency,
        CAST(SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) AS REAL) / COUNT(*) as success_rate
      FROM usage_logs
      WHERE ts >= ? ${providerFilter}
      GROUP BY account_id
      ORDER BY total_requests DESC
    `)
    return stmt.all(...params) as any[]
  }
}

export const usageLogDAO = new UsageLogDAO()
