# ChatGPT Web — 项目文档

## 项目信息
- **源码路径**: `/opt/chatgpt-web/`
- **Git 仓库**: `git@github.com:xizaihui/gpt-web.git` (私有, branch: main)
- **最新版本**: `v1.5.0` (tag: `fbdcc56`)
- **部署路径**: nginx 反代 `/opt/chatgpt-web/dist/`
- **Nginx 端口**: 8082
- **后端服务端口**: 3002
- **访问地址**: http://43.165.172.3:8082
- **管理面板**: http://43.165.172.3:8082/#/admin/pool (号池) / /#/admin/proxies (代理)
- **技术栈**: Vue 3 + Naive UI + TailwindCSS + Express + SSE Streaming + SQLite
- **原始 fork**: https://github.com/Chanzhaoyu/chatgpt-web.git

## 版本记录

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

### Admin 面板 (shadcn-admin 风格)
- 入口隐藏 (直接 URL 访问: `/#/admin/pool`, `/#/admin/proxies`)
- zinc 中性色调, 圆角卡片, 数据表格

## Nginx 配置
- 路径: `/etc/nginx/sites-enabled/chatgpt-web.conf`
- `index.html`: `no-cache, no-store, must-revalidate`
- `/assets/`: `max-age=2592000, immutable` (30 天)

## 待做
- [ ] 重新启用 `AUTH_SECRET_KEY`
- [ ] NewAPI 集成: 自动注入 apiBaseUrl/apiKey, 隐藏手动配置, SQLite 加 user_id
- [ ] 单元测试
- [ ] TypeScript strict mode

## 备份
- `/opt/chatgpt-web-backup-20260402.tar.gz` (改动前备份)
