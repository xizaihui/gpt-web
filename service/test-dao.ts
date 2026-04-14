/**
 * DAO 层测试脚本
 * 运行: cd /opt/chatgpt-web && npx tsx service/test-dao.ts
 */
import { getDb, closeDb } from './src/dao/db.js'
import { runMigrations } from './src/dao/schema.js'
import { accountDAO } from './src/dao/account-dao.js'
import { proxyDAO } from './src/dao/proxy-dao.js'
import { usageLogDAO } from './src/dao/usage-log-dao.js'
import { auditDAO } from './src/dao/audit-dao.js'
import { adminUserDAO, hashPassword } from './src/dao/admin-user-dao.js'
import { migrateFromJson } from './src/dao/migrate-from-json.js'

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`FAIL: ${msg}`)
  console.log(`  PASS: ${msg}`)
}

async function main() {
  console.log('\n=== DAO Layer Test Suite ===')
  console.log('DB path uses existing chat.db\n')

  // Step 1: Run migrations
  console.log('--- 1. Schema Migrations ---')
  const t0 = Date.now()
  runMigrations()
  console.log(`  Migrations completed in ${Date.now() - t0}ms`)

  // Step 2: Test ProxyDAO
  console.log('\n--- 2. ProxyDAO ---')
  const proxy = proxyDAO.create({ name: 'test-proxy', url: 'socks5://test:1234@1.2.3.4:5555' })
  assert(!!proxy.id, 'create proxy')
  assert(proxy.name === 'test-proxy', 'proxy name')

  const proxyGet = proxyDAO.getById(proxy.id)
  assert(proxyGet?.id === proxy.id, 'getById proxy')

  proxyDAO.update(proxy.id, { name: 'test-proxy-updated' })
  const proxyUpdated = proxyDAO.getById(proxy.id)
  assert(proxyUpdated?.name === 'test-proxy-updated', 'update proxy')

  proxyDAO.testAndUpdate(proxy.id, 42, null)
  const proxyTested = proxyDAO.getById(proxy.id)
  assert(proxyTested?.latency_ms === 42, 'testAndUpdate proxy')

  const proxyList = proxyDAO.list()
  assert(proxyList.total >= 1, 'list proxies')

  // Step 3: Test AccountDAO
  console.log('\n--- 3. AccountDAO ---')
  const account = accountDAO.create({
    provider: 'test',
    label: 'test-account',
    credential: 'test-credential-12345',
    credential_type: 'api_key',
    proxy_id: proxy.id,
  })
  assert(!!account.id, 'create account')
  assert(account.provider === 'test', 'account provider')
  assert(account.proxy_id === proxy.id, 'account proxy_id')

  const accountGet = accountDAO.getById(account.id)
  assert(accountGet?.label === 'test-account', 'getById account')

  accountDAO.update(account.id, { label: 'updated-label', status: 'disabled' })
  const accountUpdated = accountDAO.getById(account.id)
  assert(accountUpdated?.label === 'updated-label', 'update account label')
  assert(accountUpdated?.status === 'disabled', 'update account status')

  accountDAO.updateStats(account.id, true)
  const accountStats = accountDAO.getById(account.id)
  assert(accountStats?.success_count === 1, 'updateStats success')

  accountDAO.updateStats(account.id, false, 'test error')
  const accountErr = accountDAO.getById(account.id)
  assert(accountErr?.error_count === 1, 'updateStats error')
  assert(accountErr?.last_error === 'test error', 'updateStats error message')

  accountDAO.updateQuota(account.id, { session_util: 0.5, seven_day_util: 0.3 })
  const accountQuota = accountDAO.getById(account.id)
  assert(!!accountQuota?.quota_snapshot, 'updateQuota')
  assert(!!accountQuota?.quota_synced_at, 'quota_synced_at set')

  const byProvider = accountDAO.getByProvider('test')
  assert(byProvider.length >= 1, 'getByProvider')

  const countTest = accountDAO.count('test')
  assert(countTest >= 1, 'count by provider')

  // Pagination
  const page1 = accountDAO.list({ provider: 'test' }, 1, 10)
  assert(page1.items.length >= 1, 'list with filter')
  assert(page1.total >= 1, 'list total')

  // Search
  const search = accountDAO.search('updated', 'test')
  assert(search.items.length >= 1, 'search')

  // Step 4: BulkCreate performance
  console.log('\n--- 4. BulkCreate Performance ---')
  const bulkItems = Array.from({ length: 100 }, (_, i) => ({
    provider: 'bench',
    label: `bench-${i}`,
    credential: `bench-cred-${i}-${Date.now()}`,
    credential_type: 'api_key',
  }))
  const t1 = Date.now()
  const bulkResult = accountDAO.bulkCreate(bulkItems)
  const bulkTime = Date.now() - t1
  console.log(`  BulkCreate 100 accounts: ${bulkTime}ms`)
  assert(bulkResult.inserted === 100, `bulkCreate inserted ${bulkResult.inserted}`)
  assert(bulkResult.skipped === 0, 'bulkCreate no skips')

  // Idempotent check
  const bulkResult2 = accountDAO.bulkCreate(bulkItems)
  assert(bulkResult2.skipped === 100, 'bulkCreate idempotent - all skipped')

  // Step 5: UsageLogDAO
  console.log('\n--- 5. UsageLogDAO ---')
  const logId = usageLogDAO.insert({
    account_id: account.id,
    provider: 'test',
    model: 'test-model',
    tokens_total: 100,
    latency_ms: 500,
    success: 1,
    session_util: 0.5,
    seven_day_util: 0.3,
  })
  assert(logId > 0, 'insert usage log')

  const t2 = Date.now()
  const bulkLogs = Array.from({ length: 100 }, (_, i) => ({
    account_id: account.id,
    provider: 'test',
    ts: Date.now() - i * 1000,
    model: 'test-model',
    tokens_total: 50 + i,
    latency_ms: 100 + i,
    success: i % 10 === 0 ? 0 : 1,
  }))
  const bulkLogCount = usageLogDAO.bulkInsert(bulkLogs)
  console.log(`  BulkInsert 100 usage logs: ${Date.now() - t2}ms`)
  assert(bulkLogCount === 100, 'bulkInsert usage logs')

  const logs = usageLogDAO.query(account.id)
  assert(logs.length >= 101, `query usage logs: ${logs.length}`)

  const agg24 = usageLogDAO.aggregate24h('test')
  assert(agg24.length >= 1, 'aggregate24h')

  // Step 6: AuditDAO
  console.log('\n--- 6. AuditDAO ---')
  const auditId = auditDAO.log({
    admin_user: 'test-admin',
    action: 'test.action',
    target_type: 'account',
    target_id: account.id,
    details: JSON.stringify({ test: true }),
  })
  assert(auditId > 0, 'log audit')

  const audits = auditDAO.query({ admin_user: 'test-admin' })
  assert(audits.items.length >= 1, 'query audit logs')

  // Step 7: AdminUserDAO
  console.log('\n--- 7. AdminUserDAO ---')
  adminUserDAO.ensureDefaultAdmin('test-password-123')
  const admin = adminUserDAO.getByUsername('admin')
  assert(!!admin, 'default admin created')

  const verified = adminUserDAO.verify('admin', 'test-password-123')
  assert(!!verified, 'verify password')

  const notVerified = adminUserDAO.verify('admin', 'wrong-password')
  assert(!notVerified, 'reject wrong password')

  const adminList = adminUserDAO.list()
  assert(adminList.total >= 1, 'list admin users')

  // Step 8: Cleanup test data
  console.log('\n--- 8. Cleanup ---')
  // Delete bench accounts
  const benchAccounts = accountDAO.getByProvider('bench')
  for (const ba of benchAccounts) {
    accountDAO.delete(ba.id)
  }
  console.log(`  Deleted ${benchAccounts.length} bench accounts`)

  // Delete test account (will cascade-remove proxy FK reference)
  accountDAO.delete(account.id)
  proxyDAO.delete(proxy.id)
  console.log('  Deleted test account and proxy')

  // Step 9: JSON Migration (dry run)
  console.log('\n--- 9. JSON Migration ---')
  const report = migrateFromJson()
  console.log(`  Accounts: inserted=${report.accounts.inserted}, skipped=${report.accounts.skipped}, errors=${report.accounts.errors}`)
  console.log(`  Proxies: inserted=${report.proxies.inserted}, skipped=${report.proxies.skipped}, errors=${report.proxies.errors}`)

  // Verify migrated data
  const codexAccounts = accountDAO.getByProvider('codex')
  console.log(`  Codex accounts in DB: ${codexAccounts.length}`)
  const allProxies = proxyDAO.list()
  console.log(`  Total proxies in DB: ${allProxies.total}`)

  // Re-run migration to test idempotency
  console.log('\n--- 10. Migration Idempotency ---')
  const report2 = migrateFromJson()
  assert(report2.accounts.inserted === 0, 'migration idempotent - no new accounts')
  assert(report2.proxies.inserted === 0, 'migration idempotent - no new proxies')

  console.log('\n=== All Tests Passed ===')
  closeDb()
}

main().catch(e => {
  console.error('TEST FAILED:', e)
  process.exit(1)
})
