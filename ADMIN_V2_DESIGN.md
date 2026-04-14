# ChatGPT-Web Admin V2 设计文档

> 版本: v2.0
> 日期: 2026-04-11
> 目标: 将现有散装 Admin 页面重构为统一、可扩展、带鉴权的账号池管理系统，支持万级账号规模、实时额度监控与多 Provider 统一抽象。

---

## 0. 术语与范围

| 术语 | 含义 |
|------|------|
| Provider | 上游服务提供方，当前包含 `claude`（ClewdR Cookie）、`codex`（ChatGPT）、`gemini` |
| Account | 一个可用于调用上游的凭据实体（Cookie / API Key / Token） |
| Pool | 某个 Provider 下所有 Account 的集合 |
| ClewdR | 外部 Claude 反代后端，地址 `http://38.150.32.190:8484` |
| Quota | Claude 的 `session_utilization` / `seven_day_utilization` 等额度字段 |
| Admin V2 | 本次重构的新后台，路由前缀 `/#/admin-v2/*`，API 前缀 `/api/v2/*` |

本次重构**不改动** `/api/chat` 等面向普通用户的路由，仅替换管理面。

---

## 1. 架构设计

### 1.1 现状问题

1. 双轨 Claude 系统（OAuth 号池 vs ClewdR Cookie），语义混乱
2. 无鉴权，任何人可访问管理接口
3. JSON 文件存储，无法扩展到万级
4. 无分页/搜索/批量操作
5. 无审计、无健康检查、无额度趋势
6. Provider 之间代码重复，无抽象

### 1.2 目标架构

```
前端 Vue 3 + Naive UI (/#/admin-v2/*)
  ├── Login (JWT)
  ├── Dashboard (汇总统计)
  ├── Pool (Provider Tab 切换: Claude/Codex/Gemini)
  ├── Proxies (统一代理池)
  ├── Logs (审计日志)
  └── Settings
         │
         │ HTTPS + Bearer Token
         ▼
API Gateway (Express: /api/v2)
  ├── Middleware: authJWT → rateLimiter → audit
  ├── /auth (登录/登出/改密)
  ├── /providers/:provider/accounts (统一 CRUD + 批量)
  ├── /proxies (代理管理)
  ├── /dashboard (统计汇总)
  ├── /audit (审计日志)
  └── /sse/quota-stream (实时额度推送)
         │
         ▼
DAO Layer (IProviderPool 接口)
  ├── AccountDAO
  ├── ProxyDAO
  ├── UsageLogDAO
  ├── AuditDAO
  └── AdminUserDAO
         │
         ▼
SQLite (WAL mode, 索引优化)
  + Background Workers
    ├── QuotaPoller (定时从 ClewdR 拉额度)
    ├── HealthChecker (探活)
    └── CleanupWorker (清理过期日志)
```

---

## 2. 数据模型

### 2.1 SQLite Schema

```sql
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA synchronous = NORMAL;

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
CREATE INDEX IF NOT EXISTS idx_accounts_last_used ON accounts(last_used_at DESC);
CREATE INDEX IF NOT EXISTS idx_accounts_quota_synced ON accounts(quota_synced_at);
CREATE INDEX IF NOT EXISTS idx_accounts_updated ON accounts(updated_at DESC);

-- 代理表
CREATE TABLE IF NOT EXISTS proxies (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    scheme      TEXT NOT NULL,
    host        TEXT NOT NULL,
    port        INTEGER NOT NULL,
    username    TEXT,
    password    TEXT,
    scope       TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'active',
    latency_ms  INTEGER,
    last_check  INTEGER,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_proxies_scope ON proxies(scope);
CREATE INDEX IF NOT EXISTS idx_proxies_status ON proxies(status);

-- 额度时序日志
CREATE TABLE IF NOT EXISTS usage_logs (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id   TEXT NOT NULL,
    provider     TEXT NOT NULL,
    ts           INTEGER NOT NULL,
    session_util REAL,
    seven_day_util REAL,
    model_breakdown TEXT,
    tokens_in    INTEGER,
    tokens_out   INTEGER,
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_usage_logs_account_ts ON usage_logs(account_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_usage_logs_ts ON usage_logs(ts DESC);

-- 账号事件
CREATE TABLE IF NOT EXISTS account_events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    details    TEXT,
    operator   TEXT,
    ts         INTEGER NOT NULL,
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_account_events_account_ts ON account_events(account_id, ts DESC);

-- 管理员用户
CREATE TABLE IF NOT EXISTS admin_users (
    id            TEXT PRIMARY KEY,
    username      TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'admin',
    last_login_at INTEGER,
    last_login_ip TEXT,
    enabled       INTEGER NOT NULL DEFAULT 1,
    created_at    INTEGER NOT NULL,
    updated_at    INTEGER NOT NULL
);

-- 审计日志
CREATE TABLE IF NOT EXISTS audit_logs (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    TEXT,
    username   TEXT,
    action     TEXT NOT NULL,
    resource   TEXT,
    details    TEXT,
    ip         TEXT,
    ts         INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_ts ON audit_logs(ts DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs(user_id, ts DESC);
```

### 2.2 DAO 接口

```typescript
interface IAccountDAO {
  list(filter: AccountFilter): Promise<PaginatedResult<Account>>
  getById(id: string): Promise<Account | null>
  create(account: CreateAccountInput): Promise<Account>
  createBatch(accounts: CreateAccountInput[]): Promise<BatchResult>
  update(id: string, updates: Partial<Account>): Promise<Account>
  delete(id: string): Promise<void>
  deleteBatch(ids: string[]): Promise<BatchResult>
  updateQuotaSnapshot(id: string, snapshot: QuotaSnapshot): Promise<void>
  getByProvider(provider: string, status?: string): Promise<Account[]>
}

interface AccountFilter {
  provider?: string
  status?: string
  search?: string
  tags?: string[]
  proxyId?: string
  page: number
  pageSize: number
  sortBy: string
  sortOrder: 'asc' | 'desc'
}

interface PaginatedResult<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}
```

---

## 3. API v2 规范

### 3.1 鉴权

```
POST /api/v2/auth/login      { username, password } → { token, expiresIn }
POST /api/v2/auth/logout      (Bearer token)
PUT  /api/v2/auth/password    { oldPassword, newPassword }
```

所有其他 `/api/v2/*` 路由需要 `Authorization: Bearer <jwt>` 头。

### 3.2 账号管理（统一接口）

```
GET    /api/v2/providers/:provider/accounts?page=1&pageSize=50&search=&status=&sortBy=created_at&order=desc
POST   /api/v2/providers/:provider/accounts           { credential, label?, proxy_id?, tags? }
POST   /api/v2/providers/:provider/accounts/batch      { credentials: string[], proxy_id?, tags? }
GET    /api/v2/providers/:provider/accounts/:id
PUT    /api/v2/providers/:provider/accounts/:id        { label?, proxy_id?, status?, tags? }
DELETE /api/v2/providers/:provider/accounts/:id
POST   /api/v2/providers/:provider/accounts/batch-delete  { ids: string[] }
POST   /api/v2/providers/:provider/accounts/batch-proxy   { ids: string[], proxy_id }
POST   /api/v2/providers/:provider/accounts/:id/test
POST   /api/v2/providers/:provider/accounts/:id/toggle    { status: 'active'|'disabled' }
```

Claude 专属：
```
POST   /api/v2/providers/claude/accounts/:id/refresh-quota
GET    /api/v2/providers/claude/quota-summary
```

### 3.3 代理管理

```
GET    /api/v2/proxies?scope=claude&status=active
POST   /api/v2/proxies                   { name, url, scope }
PUT    /api/v2/proxies/:id               { name?, url?, status? }
DELETE /api/v2/proxies/:id
POST   /api/v2/proxies/:id/test
```

### 3.4 仪表盘

```
GET    /api/v2/dashboard/stats           → { providers: { claude: {total, active, error, exhausted}, ... } }
GET    /api/v2/dashboard/alerts           → { alerts: [{type, account_id, message, ts}] }
GET    /api/v2/sse/quota-stream           → SSE: real-time quota updates
```

### 3.5 审计日志

```
GET    /api/v2/audit?page=1&pageSize=50&action=&user=
```

### 3.6 统一响应格式

```typescript
// 成功
{ success: true, data: T, meta?: { page, pageSize, total, totalPages } }

// 失败
{ success: false, error: { code: string, message: string, details?: any } }
```

---

## 4. 鉴权方案

### 4.1 实现

- bcrypt 哈希密码存储
- JWT (HS256, 24h 过期, secret 从 .env 读取)
- 首次启动自动创建默认管理员: `admin` / 随机密码（打印到控制台日志）
- 中间件 `authJWT` 验证 token，注入 `req.adminUser`
- 所有管理操作记录审计日志

### 4.2 .env 新增配置

```
ADMIN_JWT_SECRET=random-32-char-string
ADMIN_DEFAULT_PASSWORD=  # 留空则自动生成
ADMIN_TOKEN_EXPIRY=24h
```

---

## 5. 前端页面设计

### 5.1 路由结构

```
/#/admin-v2/login          → 登录页
/#/admin-v2/dashboard      → 仪表盘（默认首页）
/#/admin-v2/pool           → 号池管理（默认 Claude tab）
/#/admin-v2/pool?provider=claude
/#/admin-v2/pool?provider=codex
/#/admin-v2/pool?provider=gemini
/#/admin-v2/proxies        → 代理管理
/#/admin-v2/logs           → 审计日志
/#/admin-v2/settings       → 系统设置
```

### 5.2 号池管理页面（核心）

**顶部 Tab**: Claude | Codex | Gemini（切换 provider）

**工具栏**:
- 搜索框（模糊匹配 label/credential）
- 状态筛选下拉
- 批量添加按钮
- 批量删除/设代理按钮（选中后出现）
- 刷新按钮

**表格列**（Claude）:
- 复选框
- Label / Cookie 前缀（脱敏显示）
- 状态 badge
- Session 额度进度条（0-100%，颜色渐变）
- 7日额度进度条
- 重置倒计时
- 关联代理
- 最后使用时间
- 错误次数
- 操作（详情/启用禁用/删除/刷新额度）

**账号详情抽屉**（点击展开）:
- 基本信息
- 额度 24h/7d 趋势图（Recharts 折线图）
- 按模型分布（Opus/Sonnet/Haiku 饼图）
- 使用历史表格
- 事件时间线

**批量添加弹窗**:
- 大文本框（一行一个 cookie）
- 可选代理下拉
- 可选标签
- 导入结果展示（成功/失败/重复）

### 5.3 仪表盘

- 各 Provider 账号数统计卡片
- 健康账号 / 异常账号比例
- 全池额度使用率平均值
- 异常告警列表（额度快满、token 失效、代理不通）
- 最近操作审计列表

### 5.4 虚拟滚动

万级列表使用 `naive-ui` 的 `VirtualList` 或 `@tanstack/vue-virtual`，分页 + 虚拟滚动结合，每页最多 200 条。

---

## 6. Cookie 新增修复方案

### 6.1 根因分析

当前流程: 前端 → `POST /api/clewdr/cookies {cookie, proxy}` → 代理到 ClewdR `POST /api/cookie`

可能失败点:
1. ClewdR 验证 cookie 时超时（通过代理访问 claude.ai）
2. Cookie 格式前端未做预校验
3. ClewdR 返回的错误信息被吞
4. 重复 cookie 处理不当

### 6.2 修复方案

**前端**:
- 添加 cookie 格式前置校验（`sk-ant-sid` 前缀检查）
- 展示完整错误信息（不再用通用 toast）
- 支持批量添加（一行一个，自动去重去空行）
- 添加超时提示（ClewdR 验证可能需要 10-30s）
- 添加重试按钮

**后端**:
- `/api/v2/providers/claude/accounts` 添加时：
  1. 前置校验格式
  2. 检查本地去重
  3. 转发到 ClewdR 并设置 30s 超时
  4. 捕获并返回 ClewdR 完整错误
  5. 成功后写入本地 SQLite + 记录事件
- 批量添加使用 Promise.allSettled 并发（限制 5 并发）

---

## 7. 额度显示增强方案

### 7.1 ClewdR 返回的原始数据

```json
{
  "cookie": "sk-ant-sid02-xxx...",
  "status": "valid",
  "session_utilization": 0.35,
  "seven_day_utilization": 0.62,
  "models": ["claude-sonnet-4-20250514", "claude-opus-4-20250414"],
  "reset_at": 1712900000
}
```

### 7.2 前端展示

- **进度条**: Naive UI `NProgress`，颜色分级（<50% 绿、50-80% 黄、>80% 红）
- **重置倒计时**: 距离 `reset_at` 的倒计时组件（实时更新）
- **趋势图**: 使用 Recharts/Chart.js，从 usage_logs 拉 24h/7d 数据点
- **模型分布**: 饼图展示各模型使用占比
- **全池汇总**: Dashboard 卡片显示平均使用率、可用率

### 7.3 后台 Worker

```typescript
// QuotaPoller - 每 5 分钟执行一次
async function pollQuotas() {
  const accounts = await accountDAO.getByProvider('claude', 'active')
  const cookies = await fetchClewdrCookies(refresh=true)
  for (const cookie of cookies) {
    const account = matchAccount(cookie)
    if (account) {
      await accountDAO.updateQuotaSnapshot(account.id, {
        session_util: cookie.session_utilization,
        seven_day_util: cookie.seven_day_utilization,
        reset_at: cookie.reset_at,
        models: cookie.models
      })
      await usageLogDAO.insert({
        account_id: account.id,
        provider: 'claude',
        ts: Date.now(),
        session_util: cookie.session_utilization,
        seven_day_util: cookie.seven_day_utilization
      })
    }
  }
  // SSE 广播给前端
  broadcastQuotaUpdate(cookies)
}
```

---

## 8. 分阶段迁移计划

### 阶段 1: 修 Bug + 基础改善（1-2天）
- 修 Cookie 新增失败
- 改善错误展示
- 支持批量添加
- **验收**: Cookie 添加成功率 >95%，错误信息清晰

### 阶段 2: 数据层改造（2-3天）
- 创建新 SQLite 表
- 实现 DAO 层
- 从 JSON 文件/ClewdR 迁移数据到 SQLite
- QuotaPoller worker 上线
- **验收**: 数据一致性验证通过，旧 API 兼容

### 阶段 3: 后端 API v2 + 鉴权（2-3天）
- JWT 鉴权中间件
- 管理员账号初始化
- `/api/v2/*` 全部路由实现
- 审计日志中间件
- SSE 额度推送
- **验收**: Postman 全接口测试通过

### 阶段 4: 前端新 Admin（3-5天）
- 登录页
- 仪表盘
- 统一号池页面（含虚拟滚动、批量操作、详情抽屉）
- 代理管理页
- 审计日志页
- **验收**: 功能对比旧版 100% 覆盖 + 新功能可用

### 阶段 5: 灰度切换（1天）
- `/#/admin` → `/#/admin-v2` 重定向
- 保留旧代码 2 周
- 观察无问题后清理
- **验收**: 生产稳定运行 48h 无异常

---

## 9. 风险与回滚

### 9.1 回滚方案

- 每阶段开始前 `git commit` 打标签
- 旧 API 路由保持不动，新路由并行
- 旧前端页面保持不动，新路由 `/#/admin-v2`
- 回滚 = 切回旧路由，停用 v2 API

### 9.2 数据备份

- 每次改动前备份 `service/data/` 目录
- SQLite 用 `.backup` 命令定期备份
- JSON 文件作为最终回退源

### 9.3 不影响 ClewdR

- ClewdR (`/opt/clewdr/`) 完全独立，不做任何修改
- 仅通过 HTTP API 与 ClewdR 通信
- ClewdR 故障不影响本地 SQLite 中的状态数据
