/**
 * 从 JSON 文件迁移数据到 SQLite
 * 幂等操作: 相同 credential + provider 跳过重复插入
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { accountDAO } from './account-dao.js'
import { proxyDAO } from './proxy-dao.js'
import type { AccountCreate, ProxyCreate } from './types.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.join(__dirname, '..', '..', 'data')

interface MigrationReport {
  accounts: { inserted: number; skipped: number; errors: number }
  proxies: { inserted: number; skipped: number; errors: number }
}

function readJsonSafe(filePath: string): any {
  try {
    if (!fs.existsSync(filePath)) {
      console.log(`[Migrate] File not found: ${filePath}, skipping`)
      return null
    }
    const content = fs.readFileSync(filePath, 'utf-8')
    return JSON.parse(content)
  } catch (e) {
    console.error(`[Migrate] Error reading ${filePath}:`, e)
    return null
  }
}

function migrateClaudePool(): { inserted: number; skipped: number; errors: number } {
  const filePath = path.join(DATA_DIR, 'claude-pool.json')
  const data = readJsonSafe(filePath)
  if (!data?.accounts?.length) {
    console.log('[Migrate] claude-pool.json: no accounts to migrate')
    return { inserted: 0, skipped: 0, errors: 0 }
  }

  const items: AccountCreate[] = data.accounts.map((acc: any) => ({
    id: acc.id,
    provider: 'claude',
    label: acc.label || acc.email || null,
    credential: acc.cookie || acc.credential || acc.accessToken || '',
    credential_type: 'cookie',
    proxy_id: null,  // will need to be linked separately
    status: acc.status || 'active',
    tags: acc.tags ? JSON.stringify(acc.tags) : null,
    metadata: JSON.stringify({
      original: {
        email: acc.email,
        addedAt: acc.addedAt,
        lastUsedAt: acc.lastUsedAt,
        requestCount: acc.requestCount,
      }
    }),
  }))

  return accountDAO.bulkCreate(items)
}

function migrateCodexPool(): { inserted: number; skipped: number; errors: number } {
  const filePath = path.join(DATA_DIR, 'codex-pool.json')
  const data = readJsonSafe(filePath)
  if (!data?.accounts?.length) {
    console.log('[Migrate] codex-pool.json: no accounts to migrate')
    return { inserted: 0, skipped: 0, errors: 0 }
  }

  const items: AccountCreate[] = data.accounts.map((acc: any) => ({
    id: acc.id,
    provider: 'codex',
    label: acc.email || acc.label || null,
    credential: acc.accessToken || acc.credential || '',
    credential_type: 'access_token',
    proxy_id: null,  // will link by proxy URL matching
    status: acc.status || 'active',
    tags: acc.tags ? JSON.stringify(acc.tags) : null,
    metadata: JSON.stringify({
      original: {
        email: acc.email,
        accountId: acc.accountId,
        userId: acc.userId,
        plan: acc.plan,
        refreshToken: acc.refreshToken,
        expiresAt: acc.expiresAt,
        addedAt: acc.addedAt,
        lastUsedAt: acc.lastUsedAt,
        lastRefreshedAt: acc.lastRefreshedAt,
        requestCount: acc.requestCount,
        proxyId: acc.proxyId,
      }
    }),
  }))

  return accountDAO.bulkCreate(items)
}

function migrateCodexProxies(): { inserted: number; skipped: number; errors: number } {
  const filePath = path.join(DATA_DIR, 'codex-proxies.json')
  const data = readJsonSafe(filePath)
  if (!data?.proxies?.length) {
    console.log('[Migrate] codex-proxies.json: no proxies to migrate')
    return { inserted: 0, skipped: 0, errors: 0 }
  }

  let inserted = 0
  let skipped = 0
  let errors = 0

  for (const proxy of data.proxies) {
    try {
      // Check duplicate by URL
      const existing = proxyDAO.getByUrl(proxy.url)
      if (existing) {
        skipped++
        continue
      }
      proxyDAO.create({
        id: proxy.id,
        name: proxy.name || 'unnamed',
        url: proxy.url,
        status: proxy.status || 'active',
        tags: null,
      } as ProxyCreate)
      inserted++
    } catch (e) {
      console.error(`[Migrate] Error migrating proxy ${proxy.name}:`, e)
      errors++
    }
  }

  return { inserted, skipped, errors }
}

function migrateClaudeProxies(): { inserted: number; skipped: number; errors: number } {
  const filePath = path.join(DATA_DIR, 'claude-proxies.json')
  const data = readJsonSafe(filePath)
  if (!data?.proxies?.length) {
    console.log('[Migrate] claude-proxies.json: not found or empty, skipping')
    return { inserted: 0, skipped: 0, errors: 0 }
  }

  let inserted = 0
  let skipped = 0
  let errors = 0

  for (const proxy of data.proxies) {
    try {
      const existing = proxyDAO.getByUrl(proxy.url)
      if (existing) {
        skipped++
        continue
      }
      proxyDAO.create({
        id: proxy.id,
        name: proxy.name || 'unnamed',
        url: proxy.url,
        status: proxy.status || 'active',
        tags: null,
      } as ProxyCreate)
      inserted++
    } catch (e) {
      errors++
    }
  }

  return { inserted, skipped, errors }
}

export function migrateFromJson(): MigrationReport {
  console.log('[Migrate] Starting JSON -> SQLite migration...')
  console.log(`[Migrate] Data directory: ${DATA_DIR}`)

  // Migrate proxies first (accounts may reference them)
  const claudeProxies = migrateClaudeProxies()
  const codexProxies = migrateCodexProxies()
  const totalProxies = {
    inserted: claudeProxies.inserted + codexProxies.inserted,
    skipped: claudeProxies.skipped + codexProxies.skipped,
    errors: claudeProxies.errors + codexProxies.errors,
  }

  // Migrate accounts
  const claudeAccounts = migrateClaudePool()
  const codexAccounts = migrateCodexPool()
  const totalAccounts = {
    inserted: claudeAccounts.inserted + codexAccounts.inserted,
    skipped: claudeAccounts.skipped + codexAccounts.skipped,
    errors: claudeAccounts.errors + codexAccounts.errors,
  }

  const report: MigrationReport = {
    accounts: totalAccounts,
    proxies: totalProxies,
  }

  console.log('[Migrate] === Migration Report ===')
  console.log(`[Migrate] Proxies - inserted: ${totalProxies.inserted}, skipped: ${totalProxies.skipped}, errors: ${totalProxies.errors}`)
  console.log(`[Migrate] Accounts - inserted: ${totalAccounts.inserted}, skipped: ${totalAccounts.skipped}, errors: ${totalAccounts.errors}`)
  console.log('[Migrate] Migration complete. JSON files NOT deleted (still authoritative).')

  return report
}
