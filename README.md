# Equal Ask

Equal Ask 是一个自用的 AI API 中转与管理系统，用来统一管理多个上游 Provider，并对外提供 OpenAI / Anthropic 兼容接口。它的核心目标是把多个低 RPM 的上游模型组织起来，通过模型级轮询提升整体可用 RPM，同时保留尽量透明的请求转发能力。

项目适合直接部署在个人服务器上，通过 `IP + 端口` 访问后台和对外 API，不依赖域名。

## 核心能力

- Provider 管理：维护多个上游 API Provider、分组、模型列表、密钥和自定义端点。
- 模型轮询：同一模型可在多个 Provider 之间按顺序轮询，降低单个上游 RPM 限制带来的影响。
- API Key 管理：为外部客户端创建独立代理密钥，支持权限范围、轮询开关和限速配置。
- 客户端标签：Provider 和代理密钥都可以标记用途，例如普通、Codex、Claude Code、OpenClaw，用于更明确地筛选可用上游。
- OpenAI 兼容接口：提供 `/v1/chat/completions`、`/v1/responses`、`/v1/embeddings`、`/v1/models`。
- Anthropic 兼容接口：提供 `/v1/messages`、`/v1/messages/count_tokens`、`/v1/models`。
- 后台鉴权：管理页面需要登录，外部 `/v1/*` 接口使用代理 API Key。
- 日志与统计：记录请求链路、Provider 尝试情况、成功失败状态、模型分布和调用统计。
- 健康检查：提供 `/api/health` 和 `/v1/health` 便于部署探活。

## 项目结构

```text
equal_ask/
  backend/      Node.js + Express 后端服务
  frontend/     Vue 3 + Vite 管理后台
  data/         SQLite 数据库、日志和历史数据
  scripts/      兼容性检查和辅助脚本
  document/     项目文档
```

## 快速启动

安装依赖：

```bash
cd backend
npm install

cd ../frontend
npm install
```

构建前端：

```bash
cd frontend
npm run build
```

启动后端：

```bash
cd backend
npm start
```

默认服务地址：

```text
http://localhost:3000
```

生产环境中可以直接通过：

```text
http://服务器IP:3000
```

访问后台管理页面和 `/v1/*` 兼容接口。

## 首次登录

后端启动时会检查管理员用户。如果数据库中还没有用户，会自动创建默认管理员。

建议首次部署时设置环境变量：

```bash
ADMIN_USERNAME=admin
ADMIN_PASSWORD=your-strong-password
```

如果没有设置 `ADMIN_PASSWORD`，服务会在启动日志中输出一次性生成的初始密码。登录后可以在后台的密码管理中修改。

## 基本配置流程

1. 登录后台。
2. 在 API 管理中添加 Provider，填写上游 base URL、API Key、协议类型、模型列表和用途标签。
3. 在轮询配置中刷新并确认可轮询模型池。
4. 在 API Key 管理中创建对外代理密钥，选择用途标签和可访问范围。
5. 在外部客户端中使用代理密钥调用本系统的 `/v1/*` 接口。

## Provider 与协议说明

Provider 的协议和用途标签决定它会被哪些客户端使用：

- 普通 OpenAI 兼容 Provider：用于 `/v1/chat/completions`、`/v1/responses` 等 OpenAI 风格调用。
- Claude / Anthropic Provider：用于 `/v1/messages` 和 Claude Code 等 Anthropic 风格调用。
- Codex Provider：用于 Codex 或其他 OpenAI 兼容客户端。
- OpenClaw Provider：用于标记 OpenClaw 相关上游。

如果上游明确支持 Claude Code 或 Anthropic 协议，需要确保 Provider 至少满足以下条件之一：

- `apiType` 设置为 `anthropic`
- 勾选 Claude 用途标签
- 自定义 chat endpoint 指向 `/v1/messages`

如果上游只支持 OpenAI 协议，即使模型名称相同，也不能直接作为 Claude Code 的纯透传上游使用。

## 对外 API

OpenAI 兼容客户端：

```text
Base URL: http://服务器IP:3000/v1
Authorization: Bearer <代理 API Key>
```

常用接口：

```text
GET  /v1/models
POST /v1/chat/completions
POST /v1/responses
POST /v1/embeddings
GET  /v1/health
```

Claude / Anthropic 兼容客户端：

```text
Base URL: http://服务器IP:3000
x-api-key: <代理 API Key>
anthropic-version: 2023-06-01
```

常用接口：

```text
GET  /v1/models
POST /v1/messages
POST /v1/messages/count_tokens
GET  /v1/health
```

## 轮询策略

系统以模型为单位维护轮询状态。假设 5 个 Provider 都提供同一个模型 `A`，外部请求模型 `A` 时，系统会按顺序在这 5 个 Provider 之间轮流选择，而不是固定使用某一个 Provider。

轮询会结合以下条件过滤 Provider：

- Provider 是否启用
- 模型是否可见
- API Key 权限范围
- Provider 分组和轮询范围
- 客户端用途标签
- 模型失败计数和禁用状态

后台提供手动重置某个模型轮询位置的功能。

## 健康检查

管理侧探活：

```text
GET /api/health
```

外部 API 探活：

```text
GET /v1/health
```

`/v1/health` 需要携带代理 API Key。

## 兼容性检查

项目提供 Anthropic 兼容性检查脚本：

```bash
EQUAL_ASK_BASE_URL=http://服务器IP:3000 \
EQUAL_ASK_API_KEY=你的代理密钥 \
node scripts/check-anthropic-compat.js
```

可选指定模型：

```bash
EQUAL_ASK_MODEL=claude-sonnet-4-5
```

该脚本会检查：

- `/v1/models`
- `/v1/models/:model`
- `/v1/messages/count_tokens`
- `/v1/messages`

## 数据与日志

运行数据默认保存在 `data/` 目录：

- `data/app.db`：SQLite 数据库
- `data/logs/`：请求日志
- 旧 JSON 配置会在启动时迁移到 SQLite

部署时建议定期备份 `data/` 目录。

## 注意事项

- 本系统负责中转、鉴权、轮询和日志，不会凭空让上游支持不存在的协议。
- Claude Code 是否可用取决于上游是否真正支持 Anthropic `/v1/messages` 协议。
- Codex 是否可用取决于上游是否真正支持 OpenAI 兼容接口和相关工具调用能力。
- 直接暴露公网 IP + 端口时，建议使用强密码、限制代理密钥权限，并只开放必要端口。
