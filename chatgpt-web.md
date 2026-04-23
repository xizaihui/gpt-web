# ChatGPT Web — 项目文档

## 项目信息
- **源码路径**: `/opt/chatgpt-web/`
- **Git 仓库**: `git@github.com:xizaihui/gpt-web.git` (私有, branch: main)
- **最新版本**: `v1.5.0` (tag: `fbdcc56`) + 后续 10 个 commit (截至 `7762a5c`)
- **部署路径**: nginx 反代 `/opt/chatgpt-web/dist/`
- **Nginx 端口**: 8082
- **后端服务端口**: 3002
- **访问地址**: http://43.165.172.3:8082
- **管理面板 (旧版)**: http://43.165.172.3:8082/#/admin/pool (号池) / /#/admin/proxies (代理)
- **管理面板 (V2)**: http://154.36.173.198:8082/#/admin-v2/ (统一后台，shadcn-admin 风格)
- **技术栈**: Vue 3 + Naive UI + TailwindCSS + Express + SSE Streaming + SQLite
- **原始 fork**: https://github.com/Chanzhaoyu/chatgpt-web.git

## 版本记录

### 后续增量更新 (2026-04-14 ~ 2026-04-23)

以下功能在 v1.5.0 之后以增量 commit 方式开发，尚未打 tag。

#### Admin V2 后台系统 (2026-04-14+)
全新统一管理后台，替代旧版分散的 admin 页面。
- **入口**: `/#/admin-v2/` (自动跳转 dashboard)
- **技术栈**: Vue 3 + TailwindCSS (纯手写，无 Naive UI 依赖)
- **设计风格**: shadcn-admin (zinc 中性色调, 圆角卡片, 数据表格)
- **侧栏导航**: 可折叠，8 个页面

**页面清单**:

| 路由 | 组件 | 功能 |
|------|------|------|
| `/admin-v2/dashboard` | Dashboard.vue (128行) | 全池汇总卡片 (总账号/健康/使用率/告警) + 使用趋势图 + Provider 分布饼图 + 最近操作 + 告警列表 |
| `/admin-v2/pool` | AccountPool.vue (324行) | 统一号池管理，Tab 切换 Claude/Codex/Gemini/Kiro 四个 Provider |
| `/admin-v2/proxies` | ProxyManager.vue (138行) | 代理节点管理 |
| `/admin-v2/logs` | RequestLogs.vue (425行) | ClewdR API 请求日志 + Headers 详情抽屉 |
| `/admin-v2/settings` | Settings.vue (142行) | 系统参数与告警阈值 |
| `/admin-v2/codex-pool` | CodexPool.vue (444行) | ChatGPT/Codex OAuth 号池管理 (独立页面) |
| `/admin-v2/audit` | AuditLogs.vue (503行) | 完整请求/响应审计日志 (ClewdR + OAI 双源)，支持筛选/详情/自动刷新 |
| `/admin-v2/clewdr-logs` | ClewdrSystemLogs.vue (429行) | ClewdR 实时系统日志 (SSH journalctl 远程拉取) |

**AccountPool.vue — 统一号池 (Claude Tab)**:
- 状态筛选: all / valid / exhausted / invalid
- 搜索: cookie / label 模糊匹配
- 批量操作: 全选 + 批量删除/启用/禁用
- 单行操作: 详情抽屉 / 启用禁用切换 / 删除 (window.confirm 二次确认)
- 汇总卡片: 总数 / 健康 / 耗尽 / 失效
- 批量添加: BatchAddDialog 组件，支持多行 cookie 粘贴 + 代理选择
- 数据源: ClewdR API (`/api/cookies`) 通过后端代理

**AccountPool.vue — Kiro Tab**:
- 内嵌 KiroPoolPanel.vue (624行)，功能最完整的 Provider 面板
- 账号列表: 来源/订阅类型/额度进度条/重置倒计时/代理/操作
- 额度显示: limit/used/remaining + 百分比进度条 + 颜色分级 (绿/黄/红)
- 🎁 赠送额度: free_trial 数据展示 (蓝色标签: used/limit · 到期日)
- 汇总卡片: 总账号/可用/总额度/已用/赠送额度
- 代理管理: 行内编辑代理 URL，保存/清除
- 账号测试: 单个账号连通性测试
- 配额刷新: 单个/全部刷新
- 使用历史: 24h/7d/30d 趋势图 (按账号筛选)
- **OAuth 登录流程**: 完整的 Kiro 账号添加向导
  - 启动登录 → 显示 SSH 端口转发命令 + 登录 URL
  - 自动轮询登录状态 (2秒间隔，5分钟超时倒计时)
  - 登录成功自动上架到号池
  - 支持取消/重试
- 删除: window.confirm 二次确认
- 启用/禁用: 即时切换
- 自动刷新: 60秒间隔

**AccountPool.vue — Codex/Gemini Tab**:
- 显示 "开发中" 占位页面
- Codex 有独立页面 `/admin-v2/codex-pool`

**子组件** (`admin-v2/components/`):
- `AccountDetailDrawer.vue` (157行) — 账号详情侧抽屉，5 个 Tab: 基本信息/额度/模型分布/使用历史/事件
- `BatchAddDialog.vue` (116行) — 批量添加 Cookie 对话框，多行粘贴 + 代理选择
- `QuotaProgressBar.vue` (41行) — 额度进度条，颜色分级
- `ResetCountdown.vue` (59行) — 额度重置倒计时
- `UsageTrendChart.vue` (138行) — 使用趋势折线图 (纯 SVG)
- `ModelDistributionPie.vue` (89行) — 模型分布饼图 (纯 SVG)
- `AlertList.vue` (61行) — 告警列表

**AuditLogs.vue — 审计日志**:
- 双数据源切换: ClewdR (SQLite) / OAI Gateway (PostgreSQL)
- 丰富筛选: 日期范围/模型/session_id/api_key_hash/client_type/cookie/状态/工具调用/流式
- 搜索范围: 全部/用户输入/AI回复
- 详情抽屉: 概览/请求体/响应体/原始数据 四个 Tab
- 概览 Tab: 用户输入卡片 (列出所有 user 消息，最后一条高亮标记 "← 触发本轮回复")
- 统计卡片: 总请求/今日/工具调用/流式比例
- 自动刷新: 可开关
- 分页: 30条/页

**ClewdrSystemLogs.vue — 系统日志**:
- SSH 远程拉取 ClewdR 服务器 journalctl 日志
- 服务状态显示: active/inactive/failed + 运行时间
- 筛选: grep 关键词 / 日志级别 / 时间范围 / 行数
- 自动刷新: 可配置间隔 (默认 5秒)
- 自动滚动到底部

**RequestLogs.vue — 请求日志**:
- ClewdR 请求日志列表 (来自 ClewdR SQLite 审计库)
- 筛选: 模型/session_id/日期范围
- Headers 详情抽屉: 查看完整请求/响应头
- 统计卡片
- 自动刷新

**CodexPool.vue — Codex 号池**:
- ChatGPT Plus OAuth 账号管理
- 账号列表: email/状态/token过期时间/代理/配额
- OAuth 添加: 启动授权 → 粘贴回调 URL → 完成绑定
- 操作: 刷新token/启用禁用/删除/代理绑定
- 配额查询: 单个/批量
- 同步: 从文件系统同步账号

**Layout.vue — 布局框架**:
- 可折叠侧栏 (60px/240px)
- 顶栏: 页面标题 + 描述 + Preview Build 标签
- 返回旧版 Admin 按钮

#### 前端 API 层 (src/api/index.ts)

**ClewdR 号池 API**:
- `fetchClewdrCookies(refresh?)` — 获取 cookie 列表 (valid/exhausted/invalid 分组)
- `addClewdrCookie(cookie, proxy?)` / `addClewdrCookieBatch(cookies[], proxy?)` — 添加
- `deleteClewdrCookie(cookie)` — 删除
- `updateClewdrCookie(data)` — 更新
- `disableClewdrCookie(cookie, proxy?)` / `enableClewdrCookie(cookie)` — 启用禁用
- `fetchDisabledClewdrCookies()` — 获取已禁用列表
- `fetchClewdrConfig()` / `updateClewdrConfig(data)` — ClewdR 配置
- `fetchClewdrModels()` / `testClewdr(model?)` — 模型列表/测试
- `fetchClewdrLogs(params?)` / `fetchClewdrLogStats(params?)` — 请求日志

**Kiro Gateway API**:
- `fetchKiroUsage(refresh?)` — 账号列表 + 额度 + 汇总
- `refreshKiroQuotas()` — 刷新所有配额
- `fetchKiroHistory(params)` — 使用历史 (hours/accountId/bucket)
- `fetchKiroPoolStatus()` / `fetchKiroSessions()` — 池状态/会话
- `disableKiroAccount(id)` / `enableKiroAccount(id)` — 启用禁用
- `testKiroAccount(id)` — 测试连通性
- `deleteKiroAccount(id)` — 删除
- `updateKiroAccountProxy(id, proxyUrl)` — 更新代理
- `uploadKiroAccount(filename, data, label?)` — 上传账号文件
- `startKiroLogin(label?)` — 启动 OAuth 登录
- `checkKiroLogin(label)` — 轮询登录状态
- `completeKiroLogin(label)` — 完成登录
- `cancelKiroLogin(label)` — 取消登录
- `listKiroLogins()` — 列出进行中的登录

**Codex 号池 API**:
- `fetchPoolStats()` / `fetchPoolAccounts()` — 统计/账号列表
- `syncPool()` — 同步
- `removePoolAccount(id)` / `updatePoolAccount(id, data)` — 删除/更新
- `refreshPoolAccount(id)` / `refreshAllPoolAccounts()` — 刷新 token
- `startOAuth()` / `completeOAuth(code, state, proxy)` — OAuth 流程
- `fetchAllQuotas()` — 批量配额查询

**代理 API**:
- `fetchProxies()` / `addProxy(name, url)` / `updateProxy(id, data)` / `deleteProxy(id)` / `testProxy(id)`

**审计 API** (直接 fetch，非 apiGet):
- `GET /api/audit/clewdr/logs` / `GET /api/audit/clewdr/logs/:id` — ClewdR 审计
- `GET /api/audit/oai/logs` / `GET /api/audit/oai/logs/:id` — OAI 审计
- `GET /api/audit/stats` / `GET /api/audit/distincts` — 统计/去重值
- `GET /api/audit/settings` / `POST /api/audit/settings` — 审计设置
- `POST /api/audit/purge` — 清理

#### 后端路由 (service/src/index.ts)

所有管理 API 均需 `adminAuth` 中间件 (Bearer token = `SECRET_TOKEN`)。

**ClewdR 代理路由** (`/clewdr/*`):
- 转发到 ClewdR 服务器 (38.150.32.190:8484)，后端做认证代理
- cookie CRUD + 配置 + 模型 + 测试 + 日志

**Kiro Gateway 路由** (`/kiro/*`):
- 转发到 kiro-gateway (本机 43.165.172.3:8000)
- 账号管理 + 额度 + 历史 + 会话 + 测试 + OAuth 登录流程
- 登录流程: start → poll → complete (后端启动临时 HTTP 服务器接收 OAuth 回调)

**Codex 路由** (`/codex/*`):
- 本地管理 (codex.ts)，OAuth PKCE 授权流
- 账号/代理 CRUD + token 刷新 + 配额查询

**Gemini 路由** (`/gemini/*`):
- 池状态 + 添加/禁用/启用/删除/测试/代理

**审计路由** (`/audit/*`):
- audit-api.ts 处理，连接远程 PostgreSQL
- ClewdR + OAI 双源审计日志

**系统日志路由**:
- `/clewdr/system-logs` — SSH 远程执行 journalctl
- `/clewdr/service-status` — SSH 远程查询 systemctl status

#### Prompt Cache Simulator (2026-04-15)
- **文件**: `service/src/cache-simulator.ts` (134行)
- OpenAI Gateway 的 prompt cache 模拟器
- 模拟 Anthropic 5 分钟 cache TTL 语义
- 计算 cache_read / cache_creation / uncached token 分布
- 用于 OpenAI 兼容接口的 usage 计费

**Commits:**
- `89c0880` feat: prompt cache simulator for OpenAI gateway
- `351eb23` fix: remove Anthropic cache_creation fields from OpenAI gateway usage
- `95fa637` fix: align cache simulator with OpenAI billing semantics
- `77a5ce0` fix: revert cache TTL to 300s (5min) - 1h too generous, losing money

#### Smooth Text Streaming (2026-04-16)
- 流式文本平滑输出: 12 chars/frame, ~750 chars/sec
- 防止大块文本一次性刷出

**Commits:**
- `bee907c` feat: smooth text streaming for Claude models
- `ca0675f` Revert "feat: smooth text streaming for Claude models"
- `59c04cb` feat: smooth text streaming buffer (12 chars/frame, ~750 chars/sec)

#### Remote Audit Log (2026-04-17)
- OAI Gateway 请求流式写入远程 PostgreSQL 审计库
- 与 ClewdR 审计共用同一个 PostgreSQL 实例

**Commits:**
- `3b1f13a` feat(audit): stream OAI gateway requests to remote postgres audit log

#### OpenAI Function Calling (2026-04-20)
- OpenAI Gateway 支持 function calling / tool_use
- 完整的工具调用转换层

**Commits:**
- `7762a5c` feat(openai-gateway): OpenAI function calling support

#### Free Trial 显示 (2026-04-23)
- Kiro 号池面板新增 free_trial 赠送额度显示
- 顶部汇总卡片: 🎁 赠送额度 (总量/已用)
- 每个账号额度列: 蓝色标签 `🎁 赠送 used/limit · 到期日`

### v1.5.0 (2026-04-04) — 浏览器指纹用户隔离
- **浏览器指纹匿名隔离**: 基于 canvas/WebGL/屏幕/时区等生成稳定 32 位 hex ID
- 每个浏览器独立聊天记录，无需登录注册
- `conversations` 表新增 `client_id` 列，自动迁移现有数据库
- 所有 API 请求携带 `X-Client-Id` header (包括 SSE 流式)
- 纯 JS FNV-1a hash (兼容 HTTP，不依赖 crypto.subtle)
- 旧数据迁移至 `legacy-owner`，新用户进来是空白

**Commits:**
- `fbdcc56` fix: replace crypto.subtle with pure JS hash for HTTP compatibility
- `94a76b1` fix: ensure clientId resolves before first API call + migrate legacy data
- `3f8f63d` feat: Browser fingerprint user isolation

### v1.4.0 (2026-04-03) — Loading 动画 + UI 打磨
- **Shimmer 加载动画**: 替换绿色弹跳球为 OpenAI 风格灰色闪烁条 (初始页面 + 消息等待)
- 流式中断后 loading 状态自动清理
- 暗色模式适配
- Nginx 缓存策略: `index.html` no-cache + `/assets/` 30天不可变缓存
- 模型选择器精简: ChatGPT Plus 组只显示 GPT-5.4 和 GPT-5.4 Mini
- 订阅标签页 UI 更新: 标题/描述改为中文，隐藏号池统计和管理入口
- 固定 Tab 内容高度 320px 防止切换跳动

**Commits:**
- `5fab3cf` fix: replace green bouncing dots with shimmer loader in index.html
- `399fb6b` ui: trim model selector to 2 codex models + OpenAI shimmer loading
- `3aac907` ui: remove GPT-5.3 Codex from subscription tab
- `70517dd` fix: fixed tab content height, reduce codex models to 3
- `2e8e54b` ui: add model list to subscription tab, fix tab height jump
- `0c5974e` ui: update subscription tab description, hide pool stats & admin link

### v1.3.0 (2026-04-03) — 思考/推理模式
- **Thinking 切换**: 输入框工具栏新增开关 (灰=关, 蓝色胶囊=开)
- 启用时向 Codex API 发送 `reasoning: {effort: 'high', summary: 'auto'}`
- 后端解析 `response.reasoning_summary_text.delta` SSE 事件
- 推理文本实时流式展示，可折叠思考块 (思考中旋转图标，完成后灯泡图标)
- 模型名追加 `-thinking` 后缀
- 全部 8 个 Codex 模型支持: gpt-5.4, gpt-5.4-mini, gpt-5.3-codex, gpt-5.2, gpt-5.2-codex, gpt-5.1, gpt-5.1-codex-max, gpt-5.1-codex-mini

**Commits:**
- `c1bcabc` fix: append -thinking to model name when reasoning enabled
- `4f80cd8` feat: Thinking/reasoning toggle + all 8 Codex models + proxy fixes

### v1.2.0 (2026-04-02) — 代理管理系统
- **独立代理池**: `codex-proxies.json` (与号池分离)
- 账号→代理绑定: `account.proxy` 存代理 ID
- `proxyFetch()` 使用 `undici.ProxyAgent` + `dispatcher`
- 支持 http://, https://, socks5:// 协议
- 所有 API 调用走代理: `chatWithCodex()`, `refreshAccessToken()`, `completeOAuthFlow()`, `queryAccountQuota()`
- 代理 CRUD API + 测试连接 (ipify.org → 出口 IP + 延迟)
- 前端管理页面: `/#/admin/proxies`
- 账号-代理绑定下拉菜单
- 依赖: `undici@8.0.1`

**Commits:**
- `64be1c1` feat: Proxy management system with per-account binding

### v1.1.0 (2026-04-02) — Codex OAuth 号池
- **ChatGPT Plus 订阅号池**: OAuth PKCE 授权流
- Codex Responses API (`/codex/responses`): 非 Chat Completions 格式
- Round-robin 负载均衡 (顺序轮转)
- Token 每 4 小时自动刷新 (生命周期 ~10 天)
- 实时配额显示 (`x-codex-*` 响应头)
- **Admin 面板**: shadcn-admin 风格 (zinc 中性色调, 数据表格)
- 号池管理: `/#/admin/pool`，支持添加/删除/启用/禁用/查看配额
- OAuth 回调: `localhost:1455`，用户粘贴回调 URL 完成绑定
- 3 个账号已同步

**Commits:**
- `2d5a408` refactor: Redesign admin panel - shadcn-admin style
- `dad1212` feat: Real-time quota display in account pool admin
- `8ff7630` feat: Full Codex account pool with admin panel + OAuth flow
- `8bec2fe` feat: ChatGPT Plus subscription mode via Codex OAuth

### v1.0.0 (2026-04-02) — 基础功能完成
- SSE 流式对话 (fetch + ReadableStream)
- 双 API 路由: OpenAI compatible + Anthropic native Messages API
- Claude 模型 prompt caching 支持
- SQLite 持久化 (conversations + messages)
- 500ms 防抖流式写入
- 上下文管理 (滑块 0-50 轮)
- Token 统计 + 缓存读写指示器
- 附件菜单 + 最近文件子菜单
- 40+ 图标组件统一管理
- PM2 进程管理 + 开机自启
- 代码审计 11 项修复

**Commits:**
- `d17f461` feat: merge API config into sidebar settings panel
- `cfee4b1` docs: update project documentation
- `dde6ccd` refactor: complete code audit fixes

---

## 构建 & 部署

```bash
# 前端构建
cd /opt/chatgpt-web && pnpm run build-only

# 后端构建
cd /opt/chatgpt-web/service && npx tsup

# PM2 管理
pm2 restart chatgpt-web    # 重启
pm2 logs chatgpt-web       # 查日志
pm2 status                 # 状态
pm2 save                   # 保存进程列表(开机自启)
```

## 环境变量

### 前端 (.env)
| 变量 | 说明 | 默认值 |
|------|------|--------|
| `VITE_GLOB_API_URL` | 后端 API 前缀 | `/api` |
| `VITE_DEFAULT_API_BASE_URL` | 默认 AI API 地址 | (空) |

### 后端 (service/.env)
| 变量 | 说明 | 当前值 |
|------|------|--------|
| `AUTH_SECRET_KEY` | 鉴权密钥 (空=不鉴权) | (空, 测试阶段) |
| `CORS_ORIGINS` | 允许的跨域来源 | (空=允许全部) |
| `MAX_REQUEST_PER_HOUR` | 限流 (0=不限) | 0 |
| `OPENAI_API_KEY` | 服务端 API Key | sk-your-key-here |
| `OPENAI_API_BASE_URL` | 服务端 API 地址 | https://api.catapi.top/v1 |
| `OPENAI_API_MODEL` | 默认模型 | gpt-4o |
| `SITE_URL` | 站点地址 (OAuth 回调) | http://43.165.172.3:8082 |

## 架构概览

```
┌─────────────┐     ┌──────────────┐     ┌─────────────────┐
│  Vue 3 SPA  │────▶│  Express API │────▶│  OpenAI/Claude  │
│  (Nginx)    │     │  (PM2:3002)  │     │  Compatible API │
│  :8082      │     │              │     └─────────────────┘
└─────────────┘     │  SQLite DB   │     ┌─────────────────┐
   X-Client-Id      │  (chat.db)   │────▶│  Codex API      │
   per-browser      │              │     │  (ChatGPT Plus) │
                    │  codex-pool  │     └─────────────────┘
                    │  codex-proxy │            ▲
                    └──────────────┘            │
                                          ProxyAgent
                                        (undici socks5)
```

## 核心文件

### 前端
| 文件 | 职责 |
|------|------|
| `src/views/chat/index.vue` | 主聊天页面 |
| `src/views/chat/components/ModelSelector.vue` | 模型选择器 (按提供商分组 + Codex) |
| `src/views/chat/components/ConfigModal.vue` | API 配置弹窗 |
| `src/components/common/Icon.vue` | 40+ 图标组件 |
| `src/views/chat/components/Message/index.vue` | 消息展示+操作栏+思考块 |
| `src/views/chat/components/Message/Text.vue` | Markdown 渲染+代码高亮 |
| `src/store/modules/chat/index.ts` | 聊天 store (Pinia → 后端 API) |
| `src/api/index.ts` | API 层 (SSE 流式 + 存储 CRUD + X-Client-Id) |
| `src/utils/fingerprint.ts` | 浏览器指纹生成 (FNV-1a hash) |
| `src/views/chat/layout/sider/index.vue` | 侧边栏 |
| `src/views/chat/layout/sider/List.vue` | 聊天历史列表 |
| `src/views/chat/layout/sider/Footer.vue` | 底部设置面板 + 订阅模式切换 |
| `src/views/admin/Layout.vue` | Admin 布局 (shadcn-admin 风格) |
| `src/views/admin/Pool.vue` | 号池管理页 |
| `src/views/admin/Proxies.vue` | 代理管理页 |

### 后端
| 文件 | 职责 |
|------|------|
| `service/src/index.ts` | Express 路由 (SSE + 存储 + Codex + Proxy API) |
| `service/src/chatgpt/index.ts` | 双 API 路由 (OpenAI + Anthropic native) |
| `service/src/storage.ts` | SQLite 数据层 (better-sqlite3, client_id 隔离) |
| `service/src/codex.ts` | Codex 号池管理 (~900行, OAuth + 代理 + 负载均衡) |

### 数据文件
| 文件 | 说明 |
|------|------|
| `service/data/chat.db` | SQLite 聊天数据库 |
| `service/data/codex-pool.json` | Codex OAuth 账号池 |
| `service/data/codex-proxies.json` | 代理池 |

## 存储架构

### SQLite (service/data/chat.db)
```sql
conversations (uuid PK, client_id, title, created_at, updated_at)
  -- client_id: 浏览器指纹 ID, 用于隔离不同用户的数据
  -- 索引: idx_conversations_client ON (client_id)

messages (id PK, conversation_id FK, "index", text, inversion, error, loading,
          model, date_time, usage_json, request_options, conversation_options, created_at)
  -- 索引: idx_messages_conv ON (conversation_id)
```

### REST API — 聊天存储
| Method | Path | 说明 |
|--------|------|------|
| GET | `/api/conversations` | 会话列表 (按 X-Client-Id 隔离) |
| POST | `/api/conversations` | 创建会话 |
| PATCH | `/api/conversations/:uuid` | 改标题 |
| DELETE | `/api/conversations/:uuid` | 删会话 |
| DELETE | `/api/conversations` | 清空所有会话 |
| GET | `/api/conversations/:uuid/messages` | 消息列表 |
| PUT | `/api/conversations/:uuid/messages/:index` | 写/更新消息 |
| DELETE | `/api/conversations/:uuid/messages/:index` | 删消息 |
| DELETE | `/api/conversations/:uuid/messages` | 清空对话消息 |
| POST | `/api/conversations/import` | 批量导入 |
| POST | `/api/chat-process` | SSE 流式对话 |

### REST API — Codex 号池 & 代理
| Method | Path | 说明 |
|--------|------|------|
| GET | `/api/codex/pool/stats` | 号池统计 |
| GET | `/api/codex/pool/accounts` | 账号列表 (token 脱敏) |
| POST | `/api/codex/pool/accounts/:email/toggle` | 启用/禁用账号 |
| DELETE | `/api/codex/pool/accounts/:email` | 删除账号 |
| POST | `/api/codex/pool/accounts/:email/quota` | 查询配额 |
| POST | `/api/codex/oauth/start` | 发起 OAuth 授权 |
| POST | `/api/codex/oauth/callback` | 完成 OAuth 回调 |
| GET | `/api/codex/proxies` | 代理列表 |
| POST | `/api/codex/proxies` | 添加代理 |
| PATCH | `/api/codex/proxies/:id` | 更新代理 |
| DELETE | `/api/codex/proxies/:id` | 删除代理 |
| POST | `/api/codex/proxies/:id/test` | 测试代理连接 |

## Codex 号池设计

### 支持的模型
- **前端展示**: GPT-5.4, GPT-5.4 Mini
- **后端支持**: gpt-5.4, gpt-5.4-mini, gpt-5.3-codex, gpt-5.2, gpt-5.2-codex, gpt-5.1, gpt-5.1-codex-max, gpt-5.1-codex-mini
- **不支持**: gpt-4o, o3, o4-mini, gpt-4.1 (Cloudflare 拦截)

### 关键设计
- **请求格式**: Codex Responses API (非 Chat Completions) — `input: [{role, content}]` + `instructions`
- **负载均衡**: Round-robin 顺序轮转
- **Token 刷新**: 每 4 小时自动刷新 (生命周期 ~10 天, 到期前 30 分钟)
- **OAuth 回调**: `localhost:1455` — 用户粘贴回调 URL 完成绑定
- **思考模式**: `reasoning: {effort: 'high', summary: 'auto'}` (非独立模型)
- **代理**: 账号绑定代理 ID, `proxyFetch()` 使用 `undici.ProxyAgent`

## BaseURL /v1 规则
- **OpenAI compatible**: 有 `/v1` 则拼 `/chat/completions`, 无则拼 `/v1/chat/completions`
- **Claude native**: 先去掉 `/v1` 再拼 `/v1/messages` — 带不带都行

## UI 设计 (1:1 ChatGPT 复刻)

### 模型选择器 (按提供商分组)
- **API 模式**: GPT-4o, GPT-4o Mini / Claude Opus 4.6, Sonnet 4.6 / Gemini 2.5 Pro, Flash / DeepSeek V3, R1
- **订阅模式 (ChatGPT Plus)**: GPT-5.4, GPT-5.4 Mini + Thinking 开关

### 加载动画
- **页面初始化**: OpenAI 风格灰色 shimmer 条 (替换绿色弹跳球)
- **消息等待**: shimmer 骨架加载器
- **暗色模式**: 适配

### Admin 面板

**旧版 (v1)**: 入口隐藏 (直接 URL 访问: `/#/admin/pool`, `/#/admin/proxies`)，Naive UI 组件

**新版 (V2)**: `/#/admin-v2/`，shadcn-admin 风格，纯 TailwindCSS
- 8 个页面: 仪表盘 / 统一号池 / 代理 / 请求日志 / 设置 / Codex号池 / 审计日志 / 系统日志
- 统一号池支持 4 个 Provider Tab: Claude / Codex / Gemini / Kiro
- Kiro 面板功能最完整: OAuth 登录 + 额度管理 + 代理 + 历史趋势
- 审计日志支持 ClewdR + OAI 双源，详情抽屉含完整请求/响应体

## Nginx 配置
- 路径: `/etc/nginx/sites-enabled/chatgpt-web.conf`
- `index.html`: `no-cache, no-store, must-revalidate`
- `/assets/`: `max-age=2592000, immutable` (30 天)

## 后端文件结构 (service/src/)

| 文件 | 行数 | 职责 |
|------|------|------|
| `index.ts` | 1147 | Express 主入口，所有路由定义，adminAuth 中间件 |
| `codex.ts` | 1029 | Codex/ChatGPT OAuth 号池管理，token 刷新，配额查询 |
| `claude-pool.ts` | 952 | ClewdR cookie 号池管理，代理转发 |
| `openai-gateway.ts` | 861 | OpenAI 兼容网关，请求转换 + 流式 + function calling |
| `storage.ts` | 480 | SQLite 存储层 (conversations, messages) |
| `audit.ts` | 483 | 审计日志提取 (ClewdR response → first_user_message 等) |
| `audit-api.ts` | 318 | 审计 API handlers (PostgreSQL 远程查询) |
| `clewdr-logs-ssh.ts` | 200 | SSH 远程执行 journalctl 拉取 ClewdR 系统日志 |
| `cache-simulator.ts` | 134 | Prompt cache 模拟器 (5min TTL) |
| `types.ts` | 28 | 类型定义 |

## 前端文件结构 (src/views/admin-v2/)

| 文件 | 行数 | 职责 |
|------|------|------|
| `Layout.vue` | 113 | 布局框架: 可折叠侧栏 + 顶栏 |
| `Dashboard.vue` | 128 | 仪表盘: 汇总卡片 + 趋势图 + 饼图 + 告警 |
| `AccountPool.vue` | 324 | 统一号池: Claude/Codex/Gemini/Kiro Tab 切换 |
| `KiroPoolPanel.vue` | 624 | Kiro 号池面板: 完整 CRUD + OAuth 登录 + 历史 |
| `CodexPool.vue` | 444 | Codex 号池: OAuth + token 管理 + 配额 |
| `AuditLogs.vue` | 503 | 审计日志: 双源 + 筛选 + 详情抽屉 |
| `ClewdrSystemLogs.vue` | 429 | 系统日志: SSH journalctl + 自动刷新 |
| `RequestLogs.vue` | 425 | 请求日志: ClewdR headers 详情 |
| `ProxyManager.vue` | 138 | 代理管理 |
| `Settings.vue` | 142 | 系统设置 |
| `components/AccountDetailDrawer.vue` | 157 | 账号详情侧抽屉 (5 Tab) |
| `components/BatchAddDialog.vue` | 116 | 批量添加 Cookie 对话框 |
| `components/UsageTrendChart.vue` | 138 | 使用趋势折线图 (纯 SVG) |
| `components/ModelDistributionPie.vue` | 89 | 模型分布饼图 (纯 SVG) |
| `components/AlertList.vue` | 61 | 告警列表 |
| `components/ResetCountdown.vue` | 59 | 额度重置倒计时 |
| `components/QuotaProgressBar.vue` | 41 | 额度进度条 |

## 待做
- [ ] 重新启用 `AUTH_SECRET_KEY`
- [ ] NewAPI 集成: 自动注入 apiBaseUrl/apiKey, 隐藏手动配置, SQLite 加 user_id
- [ ] 单元测试
- [ ] TypeScript strict mode
- [ ] Admin V2: Codex/Gemini Tab 接入 (当前显示 "开发中")
- [ ] Admin V2: AccountDetailDrawer 接入真实历史/事件数据 (当前为 mock)
- [ ] Admin V2: Dashboard 最近操作接入真实审计数据 (当前为示例)

## 备份
- `/opt/chatgpt-web-backup-20260402.tar.gz` (改动前备份)
