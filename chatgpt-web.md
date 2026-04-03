# ChatGPT Web — 项目文档

## 项目信息
- **源码路径**: `/opt/chatgpt-web/`
- **Git 仓库**: `git@github.com:xizaihui/gpt-web.git` (私有)
- **部署路径**: nginx 反代 `/opt/chatgpt-web/dist/`
- **Nginx 端口**: 8082
- **后端服务端口**: 3002
- **访问地址**: http://43.165.172.3:8082
- **技术栈**: Vue 3 + Naive UI + TailwindCSS + Express + SSE Streaming + SQLite
- **原始 fork**: https://github.com/Chanzhaoyu/chatgpt-web.git

## 构建 & 部署

```bash
# 前端构建
cd /opt/chatgpt-web && pnpm run build-only

# 后端构建
cd /opt/chatgpt-web/service && npx tsup src/index.ts --format esm --outDir build --external better-sqlite3

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
| 变量 | 说明 | 默认值 |
|------|------|--------|
| `AUTH_SECRET_KEY` | 鉴权密钥 (空=不鉴权) | (空) |
| `CORS_ORIGINS` | 允许的跨域来源(逗号分隔) | (空=允许全部) |
| `MAX_REQUEST_PER_HOUR` | 限流 (0=不限) | 0 |
| `OPENAI_API_KEY` | 服务端 API Key | (空) |
| `OPENAI_API_BASE_URL` | 服务端 API 地址 | (空) |
| `OPENAI_API_MODEL` | 默认模型 | `gpt-4o` |

## 架构概览

```
┌─────────────┐     ┌──────────────┐     ┌─────────────────┐
│  Vue 3 SPA  │────▶│  Express API │────▶│  OpenAI/Claude  │
│  (Nginx)    │     │  (PM2:3002)  │     │  Compatible API │
│  :8082      │     │              │     └─────────────────┘
└─────────────┘     │  SQLite DB   │
                    │  (chat.db)   │
                    └──────────────┘
```

## 核心文件 (改动过的)

### 前端
| 文件 | 行数 | 职责 |
|------|------|------|
| `src/views/chat/index.vue` | 859 | 主聊天页面 |
| `src/views/chat/components/ModelSelector.vue` | 107 | 模型选择器+下拉菜单 |
| `src/views/chat/components/ConfigModal.vue` | 103 | API 配置弹窗 |
| `src/components/common/Icon.vue` | 130 | 30+ 图标组件 |
| `src/views/chat/components/Message/index.vue` | 134 | 消息展示+操作栏 |
| `src/views/chat/components/Message/Text.vue` | 131 | Markdown 渲染+代码高亮 |
| `src/store/modules/chat/index.ts` | 343 | 聊天 store (Pinia → 后端 API) |
| `src/api/index.ts` | 260 | API 层 (SSE 流式 + 存储 CRUD) |
| `src/views/chat/layout/sider/index.vue` | 215 | 侧边栏 |
| `src/views/chat/layout/sider/List.vue` | 295 | 聊天历史列表 |
| `src/views/chat/layout/sider/Footer.vue` | 128 | 底部设置面板 |

### 后端
| 文件 | 行数 | 职责 |
|------|------|------|
| `service/src/index.ts` | 260 | Express 路由 (SSE + 存储 API) |
| `service/src/chatgpt/index.ts` | 418 | 双 API 路由 (OpenAI + Anthropic native) |
| `service/src/storage.ts` | 217 | SQLite 数据层 (better-sqlite3) |
| `service/ecosystem.config.cjs` | — | PM2 配置 |

## 存储架构

### SQLite (service/data/chat.db)
```sql
conversations (uuid PK, title, created_at, updated_at)
messages (id PK, conversation_id FK, "index", text, inversion, error, model, usage_json, ...)
```

### REST API
| Method | Path | 说明 |
|--------|------|------|
| GET | `/api/conversations` | 会话列表 |
| POST | `/api/conversations` | 创建会话 |
| PATCH | `/api/conversations/:uuid` | 改标题 |
| DELETE | `/api/conversations/:uuid` | 删会话 |
| GET | `/api/conversations/:uuid/messages` | 消息列表 |
| PUT | `/api/conversations/:uuid/messages/:index` | 写/更新消息 |
| DELETE | `/api/conversations/:uuid/messages/:index` | 删消息 |
| POST | `/api/conversations/import` | 批量导入 |
| POST | `/api/chat-process` | SSE 流式对话 |

所有 `/conversations` 路由受 `auth` 中间件保护。

### 前端存储策略
- **聊天数据**: 后端 SQLite，通过 API 读写
- **流式写入**: 500ms 防抖，流结束立即 flush
- **localStorage → SQLite 自动迁移**: 首次加载检测并迁移
- **Settings**: 仍在 localStorage (`settingsStorage`)
- **文件附件**: IndexedDB (base64 大文件)

## 流式架构
- **前端**: 原生 `fetch()` + `ReadableStream`, 逐行解析 SSE
- **后端**: `text/event-stream`, `data: {...}\n\n`, 结束 `data: [DONE]\n\n`
- **Claude 模型**: 自动路由到 Anthropic native `/v1/messages` API (支持 prompt caching)
- **其他模型**: OpenAI 兼容 `/v1/chat/completions`
- **token 统计**: 每条消息显示 输入/输出/总 + 缓存读(绿)/缓存写(橙)

## UI 设计 (1:1 ChatGPT 复刻)

### 侧边栏
- 浅灰背景 `#f9f9f9` + 右边框 `#e0e0e0`
- OpenAI logo + 折叠/新聊天/搜索
- 聊天历史按时间分组，支持置顶/重命名/删除
- 底部: 用户头像 + 上下文轮数设置 (滑块 0-50)

### 模型选择器 (按提供商分组)
- OpenAI: GPT-4o, GPT-4o Mini
- Anthropic: Claude Opus 4.6, Claude Sonnet 4.6
- Google: Gemini 2.5 Pro, Gemini 2.5 Flash
- DeepSeek: DeepSeek V3, DeepSeek R1

### 消息样式
- 用户: 灰色气泡 `#f4f4f4` rounded-[22px], 右对齐
- AI: 无背景, 左对齐, OpenAI 头像
- 操作栏: 模型名 + 复制/重新生成/赞/踩 (始终可见)
- 首 token 等待: 三点跳动动画

## 代码质量

### 已完成的优化
- [x] 上帝组件拆分 (1150→859 行)
- [x] Icon 组件统一管理 (40+ 内联 SVG → 10 个)
- [x] 流式逻辑抽取 (`streamChat` + `handleStreamError`)
- [x] `buildHistory` 合并为一个函数
- [x] TypeScript 类型修复 (HTMLTextAreaElement, AttachedFile interface)
- [x] 死代码清理 (useUsingContext, conversationList, showModelDropdown)
- [x] 事件监听泄漏修复 (Text.vue 事件委托, useScroll cleanup)
- [x] IndexedDB 存储文件附件 (不再塞 localStorage)
- [x] 后端错误信息不泄露 (结构化错误响应)
- [x] CORS 可配置
- [x] 存储 API 加鉴权
- [x] PM2 进程管理 + 开机自启
- [x] 硬编码 URL → 环境变量
- [x] CSS class 提取 (icon-btn, menu-item, menu-panel)
- [x] v-for key 修复

### 待做
- [ ] 单元测试
- [ ] TypeScript strict mode
- [ ] 用户系统 (移植 NewAPI 时做)

## NewAPI 移植计划
1. `VITE_DEFAULT_API_BASE_URL` 指向 NewAPI 地址
2. Settings store 初始化从 NewAPI 注入的 token 读取 apiKey/apiBaseUrl
3. 隐藏 ConfigModal (key 自动绑定，不需要手动配置)
4. 存储 API 的 auth 对接 NewAPI 用户鉴权
5. 按 user_id 隔离 SQLite 数据 (conversations 表加 user_id 字段)

## 备份
- `/opt/chatgpt-web-backup-20260402.tar.gz` (改动前备份)
